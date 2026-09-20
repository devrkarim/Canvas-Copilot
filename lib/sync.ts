/**
 * Pull Canvas → SQLite, then run the LLM extractors on anything new:
 *  - syllabus → office hours / late policy / weights (+ office-hour calendar proposals)
 *  - announcements → schedule-change proposals
 */
import { addDays, subDays, formatISO } from "date-fns";
import * as canvas from "@/lib/canvas/api";
import { db, nowIso, setPref, getPref, createProposal, proposalExists, type AssignmentRow, type CourseRow } from "@/lib/db";
import { extractSyllabus } from "@/lib/extract/syllabus";
import { extractActions, type AnnouncementAction } from "@/lib/extract/announcement";
import { llmConfigured } from "@/lib/llm";
import { occurrenceRange, weeksUntil, zonedToUtc, TZ, dayName } from "@/lib/time";

export interface SyncReport {
  courses: number;
  /** Active courses skipped because they aren't starred in Canvas. */
  coursesHidden: number;
  /** False when the student has starred nothing, so every course was synced. */
  favoritesSet: boolean;
  assignments: number;
  announcements: number;
  newAnnouncements: number;
  calendarEvents: number;
  syllabiExtracted: number;
  proposalsCreated: number;
  warnings: string[];
}

/**
 * The courses Canvas Copilot is allowed to see: the ones starred on the Canvas
 * dashboard. Canvas itself falls back to "all enrolled courses" when a student
 * has starred nothing (see GET /users/self/favorites/courses), and we match that
 * rather than showing an empty app — `favoritesSet: false` tells the UI to say so.
 */
export function favoriteCourses<T extends { is_favorite?: boolean }>(
  courses: T[],
): { visible: T[]; hidden: number; favoritesSet: boolean } {
  const starred = courses.filter((c) => c.is_favorite);
  if (starred.length === 0) return { visible: courses, hidden: 0, favoritesSet: false };
  return { visible: starred, hidden: courses.length - starred.length, favoritesSet: true };
}

export async function runSync(opts: { extract?: boolean } = {}): Promise<SyncReport> {
  const extract = opts.extract ?? true;
  const report: SyncReport = {
    courses: 0, coursesHidden: 0, favoritesSet: true,
    assignments: 0, announcements: 0, newAnnouncements: 0,
    calendarEvents: 0, syllabiExtracted: 0, proposalsCreated: 0, warnings: [],
  };
  const conn = db();
  const ts = nowIso();

  // ---- me ----
  const me = await canvas.getMe();
  setPref("me_id", String(me.id));
  setPref("me_name", me.name);

  // ---- courses (starred only) ----
  const active = (await canvas.listCourses()).filter((c) => !c.access_restricted_by_date);
  const { visible: courses, hidden, favoritesSet } = favoriteCourses(active);
  report.coursesHidden = hidden;
  report.favoritesSet = favoritesSet;
  setPref("courses_hidden", String(hidden));
  setPref("courses_total", String(active.length));
  setPref("favorites_set", favoritesSet ? "1" : "0");

  const upsertCourse = conn.prepare(`
    INSERT INTO courses(id, name, course_code, term_name, term_end, syllabus_body, syllabus_available, synced_at)
    VALUES(@id, @name, @course_code, @term_name, @term_end, @syllabus_body, @syllabus_available, @synced_at)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, course_code=excluded.course_code, term_name=excluded.term_name, term_end=excluded.term_end,
      syllabus_body=excluded.syllabus_body, syllabus_available=excluded.syllabus_available, synced_at=excluded.synced_at
  `);
  for (const c of courses) {
    const body = c.syllabus_body?.trim() ?? "";
    upsertCourse.run({
      id: c.id,
      name: c.name,
      course_code: c.course_code ?? null,
      term_name: c.term?.name ?? null,
      term_end: c.term?.end_at ?? c.end_at ?? null,
      syllabus_body: body || null,
      syllabus_available: body ? 1 : 0,
      synced_at: ts,
    });
    report.courses++;
  }
  const courseIds = courses.map((c) => c.id);

  // Drop courses (and their data) the student un-starred or is no longer enrolled in.
  if (courseIds.length > 0) {
    const stale = (conn.prepare("SELECT id FROM courses").all() as { id: number }[])
      .map((r) => r.id)
      .filter((id) => !courseIds.includes(id));
    for (const id of stale) {
      for (const t of ["assignments", "announcements", "office_hours"]) conn.prepare(`DELETE FROM ${t} WHERE course_id = ?`).run(id);
      conn.prepare("DELETE FROM courses WHERE id = ?").run(id);
    }
    // Effort estimates and study blocks hang off assignments that just went away.
    for (const t of ["forecasts", "study_blocks"]) {
      conn.prepare(`DELETE FROM ${t} WHERE assignment_id NOT IN (SELECT id FROM assignments)`).run();
    }
  }

  // ---- instructors (needed for messaging) ----
  const setInstructor = conn.prepare(
    "UPDATE courses SET instructor_name = ?, instructor_email = ?, instructor_user_id = ? WHERE id = ?",
  );
  for (const id of courseIds) {
    try {
      const people = await canvas.listInstructors(id);
      const teacher =
        people.find((p) => p.enrollments?.some((e) => e.type === "TeacherEnrollment")) ?? people[0];
      if (teacher) setInstructor.run(teacher.name, teacher.email ?? null, teacher.id, id);
    } catch (e) {
      report.warnings.push(`instructors for course ${id}: ${(e as Error).message}`);
    }
  }

  // ---- assignments ----
  const upsertAssignment = conn.prepare(`
    INSERT INTO assignments(id, course_id, name, description, due_at, points_possible, submission_types, html_url, submitted, score, missing, synced_at)
    VALUES(@id, @course_id, @name, @description, @due_at, @points_possible, @submission_types, @html_url, @submitted, @score, @missing, @synced_at)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, description=excluded.description, due_at=excluded.due_at, points_possible=excluded.points_possible,
      submission_types=excluded.submission_types, html_url=excluded.html_url, submitted=excluded.submitted,
      score=excluded.score, missing=excluded.missing, synced_at=excluded.synced_at
  `);
  const NON_SUBMITTABLE = new Set(["none", "on_paper", "not_graded", "wiki_page", "attendance"]);
  for (const id of courseIds) {
    const assignments = await canvas.listAssignments(id);
    const seen: number[] = [];
    for (const a of assignments) {
      if (a.published === false) continue;
      seen.push(a.id);
      const s = a.submission;
      const submitted = Boolean(s && (s.submitted_at || s.workflow_state === "graded" || s.excused));
      const submittable = (a.submission_types ?? []).some((t) => !NON_SUBMITTABLE.has(t));
      const pastDue = Boolean(a.due_at && new Date(a.due_at) < new Date());
      upsertAssignment.run({
        id: a.id,
        course_id: id,
        name: a.name,
        description: a.description,
        due_at: a.due_at,
        points_possible: a.points_possible,
        submission_types: JSON.stringify(a.submission_types ?? []),
        html_url: a.html_url,
        submitted: submitted ? 1 : 0,
        score: s?.score ?? null,
        missing: (s?.missing ?? (pastDue && !submitted && submittable)) ? 1 : 0,
        synced_at: ts,
      });
      report.assignments++;
    }
    // Assignments deleted/unpublished in Canvas since last sync.
    const stmt = conn.prepare(`DELETE FROM assignments WHERE course_id = ? AND id NOT IN (${seen.map(() => "?").join(",") || "-1"})`);
    stmt.run(id, ...seen);
  }
  // Re-derive `missing` from scratch before trusting Canvas's list below.
  conn.prepare("UPDATE assignments SET missing = 0 WHERE submitted = 1").run();
  // Canvas's own "missing" list is authoritative where available. It spans every
  // course, but only updates rows we already store, so un-starred ones stay out.
  try {
    const missing = await canvas.listMissing();
    const mark = conn.prepare("UPDATE assignments SET missing = 1 WHERE id = ?");
    for (const m of missing) mark.run(m.id);
  } catch (e) {
    report.warnings.push(`missing_submissions: ${(e as Error).message}`);
  }

  // ---- announcements (last 30 days) ----
  const now = new Date();
  const anns = await canvas.listAnnouncements(
    courseIds,
    formatISO(subDays(now, 30), { representation: "date" }),
    formatISO(addDays(now, 1), { representation: "date" }),
  );
  const insertAnn = conn.prepare(`
    INSERT INTO announcements(id, course_id, title, message, posted_at, html_url, processed, synced_at)
    VALUES(@id, @course_id, @title, @message, @posted_at, @html_url, 0, @synced_at)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title, message=excluded.message, synced_at=excluded.synced_at
  `);
  const existingIds = new Set(
    (conn.prepare("SELECT id FROM announcements").all() as { id: number }[]).map((r) => r.id),
  );
  for (const a of anns) {
    const courseId = Number(a.context_code.replace("course_", ""));
    if (!existingIds.has(a.id)) report.newAnnouncements++;
    insertAnn.run({
      id: a.id, course_id: courseId, title: a.title, message: a.message,
      posted_at: a.posted_at, html_url: a.html_url, synced_at: ts,
    });
    report.announcements++;
  }

  // ---- calendar (user + courses, next 28 days) ----
  const contextCodes = [`user_${me.id}`, ...courseIds.map((id) => `course_${id}`)];
  try {
    const events = await canvas.listCalendarEvents(
      contextCodes,
      formatISO(subDays(now, 1), { representation: "date" }),
      formatISO(addDays(now, 28), { representation: "date" }),
    );
    conn.prepare("DELETE FROM calendar_events").run();
    const insertEvt = conn.prepare(`
      INSERT INTO calendar_events(id, title, start_at, end_at, location_name, context_code, synced_at)
      VALUES(?, ?, ?, ?, ?, ?, ?)
    `);
    for (const e of events) {
      if (e.workflow_state === "deleted") continue;
      insertEvt.run(e.id, e.title, e.start_at, e.end_at, e.location_name ?? null, e.context_code, ts);
      report.calendarEvents++;
    }
  } catch (e) {
    report.warnings.push(`calendar_events: ${(e as Error).message}`);
  }

  setPref("last_sync", ts);

  if (extract && llmConfigured()) {
    report.syllabiExtracted = await extractNewSyllabi(report);
    report.proposalsCreated += await processNewAnnouncements(report);
  } else if (extract) {
    report.warnings.push("ANTHROPIC_API_KEY not set — skipped syllabus/announcement extraction");
  }

  return report;
}

// ---------------------------------------------------------------------------

async function extractNewSyllabi(report: SyncReport): Promise<number> {
  const conn = db();
  const courses = conn
    .prepare("SELECT * FROM courses WHERE syllabus_available = 1")
    .all() as CourseRow[];
  let count = 0;
  const meId = getPref("me_id");

  for (const c of courses) {
    // Re-extract only if the syllabus text changed since last time.
    const hash = simpleHash(c.syllabus_body ?? "");
    if (getPref(`syllabus_hash:${c.id}`) === hash) continue;

    try {
      const termYear = c.term_end ? new Date(c.term_end).getFullYear() : new Date().getFullYear();
      const facts = await extractSyllabus(c.name, c.syllabus_body ?? "", termYear);
      if (!facts) continue;

      conn
        .prepare(
          `UPDATE courses SET late_policy = ?, grading_weights = ?, exam_dates = ?, syllabus_extracted_at = ?,
             instructor_email = COALESCE(instructor_email, ?), instructor_name = COALESCE(instructor_name, ?)
           WHERE id = ?`,
        )
        .run(
          facts.latePolicy, JSON.stringify(facts.gradingWeights), JSON.stringify(facts.examDates), nowIso(),
          facts.instructorEmail, facts.instructorName, c.id,
        );

      conn.prepare("DELETE FROM office_hours WHERE course_id = ?").run(c.id);
      const insertOh = conn.prepare(`
        INSERT OR IGNORE INTO office_hours(course_id, instructor, day_of_week, start_time, end_time, location, modality)
        VALUES(?, ?, ?, ?, ?, ?, ?)
      `);
      for (const oh of facts.officeHours) {
        insertOh.run(c.id, oh.instructor, oh.dayOfWeek, oh.start, oh.end, oh.location, oh.modality);

        // Propose a weekly recurring calendar slot for the rest of the term.
        const source = `syllabus:${c.id}:${oh.instructor}:${oh.dayOfWeek}:${oh.start}`;
        if (meId && !proposalExists(source, "calendar_create")) {
          const { start: first, end } = occurrenceRange(oh.dayOfWeek, oh.start, oh.end, TZ());
          const count = Math.max(1, Math.min(20, weeksUntil(c.term_end)));
          createProposal(
            "calendar_create",
            {
              context_code: `user_${meId}`,
              title: `${oh.instructor} office hours — ${c.course_code ?? c.name}`,
              start_at: first.toISOString(),
              end_at: end.toISOString(),
              location_name: oh.location ?? undefined,
              description: `Extracted from the ${c.name} syllabus (${oh.modality}).`,
              duplicate: { count: count - 1, interval: 1, frequency: "weekly" },
            },
            `The ${c.name} syllabus lists ${oh.instructor}'s office hours on ${dayName(oh.dayOfWeek)} ${oh.start}–${oh.end}${oh.location ? ` at ${oh.location}` : ""}. Add a weekly reminder for the remaining ${count} weeks of the term?`,
            source,
          );
          report.proposalsCreated++;
        }
      }
      setPref(`syllabus_hash:${c.id}`, hash);
      count++;
    } catch (e) {
      report.warnings.push(`syllabus extraction for ${c.name}: ${(e as Error).message}`);
    }
  }
  return count;
}

async function processNewAnnouncements(report: SyncReport): Promise<number> {
  const conn = db();
  const pending = conn
    .prepare("SELECT * FROM announcements WHERE processed = 0 ORDER BY posted_at ASC")
    .all() as Array<{ id: number; course_id: number; title: string; message: string | null; posted_at: string | null }>;
  const meId = getPref("me_id");
  let created = 0;

  for (const ann of pending) {
    const course = conn.prepare("SELECT * FROM courses WHERE id = ?").get(ann.course_id) as CourseRow | undefined;
    const assignments = conn
      .prepare("SELECT id, name, due_at FROM assignments WHERE course_id = ?")
      .all(ann.course_id) as Pick<AssignmentRow, "id" | "name" | "due_at">[];

    try {
      const result = await extractActions({
        courseName: course?.name ?? `course ${ann.course_id}`,
        title: ann.title,
        messageHtml: ann.message ?? "",
        postedAt: ann.posted_at,
        assignments,
        timezone: TZ(),
      });
      conn
        .prepare("UPDATE announcements SET processed = 1, actions = ? WHERE id = ?")
        .run(JSON.stringify(result), ann.id);

      for (const action of result?.actions ?? []) {
        if (!meId) break;
        const p = actionToProposal(action, ann, course);
        if (!p) continue;
        const source = `announcement:${ann.id}:${action.kind}:${p.key}`;
        if (proposalExists(source, p.type)) continue;
        createProposal(p.type, { context_code: `user_${meId}`, ...p.payload }, p.rationale, source);
        created++;
      }
    } catch (e) {
      report.warnings.push(`announcement ${ann.id}: ${(e as Error).message}`);
    }
  }
  return created;
}

function actionToProposal(
  action: AnnouncementAction,
  ann: { id: number; title: string },
  course: CourseRow | undefined,
): { type: "calendar_create" | "calendar_update"; key: string; payload: Record<string, unknown>; rationale: string } | null {
  const code = course?.course_code ?? course?.name ?? "course";
  const via = `Announcement "${ann.title}" in ${course?.name ?? "your course"}`;
  switch (action.kind) {
    case "due_date_change": {
      const due = new Date(action.newDueAt);
      if (isNaN(due.getTime())) return null;
      return {
        type: "calendar_update",
        key: String(action.assignmentId ?? action.assignmentName),
        payload: {
          assignment_id: action.assignmentId,
          title: `${action.assignmentName} due (${code})`,
          start_at: new Date(due.getTime() - 30 * 60 * 1000).toISOString(),
          end_at: due.toISOString(),
          description: `${via}: ${action.summary}`,
        },
        rationale: `${via} says the due date for "${action.assignmentName}" is now ${due.toLocaleString("en-US", { timeZone: TZ() })}. Update your calendar?`,
      };
    }
    case "cancelled_class": {
      const bounds = allDay(action.date);
      if (!bounds) return null;
      return {
        type: "calendar_create",
        key: action.date,
        payload: {
          title: `No class — ${code}`,
          ...bounds,
          description: `${via}: ${action.summary}`,
        },
        rationale: `${via}: class on ${action.date} is cancelled. Mark it on your calendar?`,
      };
    }
    case "room_change": {
      const bounds = allDay(action.date ?? todayIso());
      if (!bounds) return null;
      return {
        type: "calendar_create",
        key: action.date ?? "permanent",
        payload: {
          title: `${code} → ${action.newLocation}`,
          ...bounds,
          description: `${via}: ${action.summary}`,
        },
        rationale: `${via}: class location changed to ${action.newLocation}${action.date ? ` on ${action.date}` : ""}. Add a note to your calendar?`,
      };
    }
    case "new_event": {
      if (isNaN(new Date(action.startAt).getTime()) || isNaN(new Date(action.endAt).getTime())) return null;
      return {
        type: "calendar_create",
        key: action.title,
        payload: {
          title: `${action.title} (${code})`,
          start_at: action.startAt,
          end_at: action.endAt,
          location_name: action.location ?? undefined,
          description: `${via}: ${action.summary}`,
        },
        rationale: `${via} announces "${action.title}" on ${new Date(action.startAt).toLocaleString("en-US", { timeZone: TZ() })}. Add it to your calendar?`,
      };
    }
  }
}

/** Canvas all-day event bounds for a YYYY-MM-DD date in the student's timezone. */
function allDay(date: string): { start_at: string; end_at: string; all_day: true } | null {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const start = zonedToUtc(+m[1], +m[2], +m[3], 0, 0, TZ());
  return { start_at: start.toISOString(), end_at: start.toISOString(), all_day: true };
}

function todayIso() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ() }); // YYYY-MM-DD
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return String(h);
}

/**
 * One tool set shared by chat and the daily briefing. Read tools query
 * SQLite; write tools only create *proposals* (see lib/proposals.ts).
 */
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { convert } from "html-to-text";
import {
  db, getPref, createProposal, listProposals, courseHasSyllabus, syllabusReadable,
  type AssignmentRow, type AnnouncementRow, type CalendarEventRow, type CourseRow, type OfficeHoursRow, type StudyBlockRow,
} from "@/lib/db";
import { buildForecast, freeSlots, type Interval } from "@/lib/forecast";
import { addDaysUtc, fmtDateTime, fmtDate, nextOccurrence, partsInTz, zonedToUtc, parseHm, dayName, TZ } from "@/lib/time";

// ---------- helpers ----------

function courses(): CourseRow[] {
  return db().prepare("SELECT * FROM courses ORDER BY name").all() as CourseRow[];
}

function findCourse(query: string | number | undefined): CourseRow | undefined {
  if (query === undefined || query === null || query === "") return undefined;
  const all = courses();
  if (typeof query === "number" || /^\d+$/.test(String(query))) {
    return all.find((c) => c.id === Number(query));
  }
  const q = String(query).toLowerCase().replace(/\s+/g, "");
  return (
    all.find((c) => (c.course_code ?? "").toLowerCase().replace(/\s+/g, "") === q) ??
    all.find((c) => c.name.toLowerCase().replace(/\s+/g, "").includes(q)) ??
    all.find((c) => (c.course_code ?? "").toLowerCase().replace(/\s+/g, "").includes(q))
  );
}

function courseLabel(c: CourseRow | undefined, id?: number) {
  return c ? `${c.course_code ?? ""} ${c.name}`.trim() : `course ${id}`;
}

const courseArg = z
  .string()
  .optional()
  .describe("Course code, name fragment, or numeric id. Omit for all courses.");

function json(v: unknown) {
  return JSON.stringify(v, null, 1);
}

function eager<T extends object>(tool: T): T & { eager_input_streaming: true } {
  return { ...tool, eager_input_streaming: true };
}

// ---------- read tools ----------

const getCourses = betaZodTool({
  name: "get_courses",
  description: "List the student's active courses with ids, codes, instructor, whether a syllabus is available, and extracted late policy / grading weights.",
  inputSchema: z.object({}),
  run: async () =>
    json(
      courses().map((c) => ({
        id: c.id, code: c.course_code, name: c.name, term: c.term_name, term_end: c.term_end,
        instructor: c.instructor_name, instructor_email: c.instructor_email,
        syllabus_available: courseHasSyllabus(c),
        syllabus_source: c.syllabus_source,
        late_policy: c.late_policy, grading_weights: c.grading_weights ? JSON.parse(c.grading_weights) : null,
        exam_dates: c.exam_dates ? JSON.parse(c.exam_dates) : null,
      })),
    ),
});

const getUpcomingAssignments = betaZodTool({
  name: "get_upcoming_assignments",
  description: "Assignments due within the next N days (default 7) that are not yet submitted, with due dates, points and links. Use for 'what's due', reminders, and planning.",
  inputSchema: z.object({
    days: z.number().int().min(1).max(60).default(7),
    course: courseArg,
    include_submitted: z.boolean().default(false),
  }),
  run: async ({ days, course, include_submitted }) => {
    const c = findCourse(course);
    if (course && !c) return `No course matches "${course}". Call get_courses to see options.`;
    const now = new Date().toISOString();
    const until = addDaysUtc(new Date(), days).toISOString();
    const rows = db()
      .prepare(
        `SELECT * FROM assignments WHERE due_at IS NOT NULL AND due_at >= ? AND due_at <= ?
         ${c ? "AND course_id = @cid" : ""} ${include_submitted ? "" : "AND submitted = 0"} ORDER BY due_at ASC`,
      )
      .all(...(c ? [now, until, { cid: c.id }] : [now, until])) as AssignmentRow[];
    const byId = new Map(courses().map((x) => [x.id, x]));
    return json(
      rows.map((a) => ({
        id: a.id, name: a.name, course: courseLabel(byId.get(a.course_id), a.course_id),
        due_at: a.due_at, due_local: fmtDateTime(a.due_at, TZ()), points: a.points_possible,
        submitted: Boolean(a.submitted), url: a.html_url,
      })),
    );
  },
});

const getMissingAssignments = betaZodTool({
  name: "get_missing_assignments",
  description: "Assignments that are past due and were never submitted (missing). Use before drafting a message to a professor.",
  inputSchema: z.object({ course: courseArg }),
  run: async ({ course }) => {
    const c = findCourse(course);
    const rows = db()
      .prepare(`SELECT * FROM assignments WHERE missing = 1 AND submitted = 0 ${c ? "AND course_id = ?" : ""} ORDER BY due_at DESC`)
      .all(...(c ? [c.id] : [])) as AssignmentRow[];
    const byId = new Map(courses().map((x) => [x.id, x]));
    return json(
      rows.map((a) => {
        const cr = byId.get(a.course_id);
        return {
          id: a.id, name: a.name, course: courseLabel(cr, a.course_id), course_id: a.course_id,
          due_at: a.due_at, due_local: fmtDateTime(a.due_at, TZ()), points: a.points_possible,
          instructor: cr?.instructor_name, late_policy: cr?.late_policy, url: a.html_url,
        };
      }),
    );
  },
});

const getAnnouncements = betaZodTool({
  name: "get_announcements",
  description: "Recent course announcements (plain text) with any schedule changes that were extracted from them.",
  inputSchema: z.object({
    course: courseArg,
    days: z.number().int().min(1).max(60).default(7),
  }),
  run: async ({ course, days }) => {
    const c = findCourse(course);
    const since = addDaysUtc(new Date(), -days).toISOString();
    const rows = db()
      .prepare(`SELECT * FROM announcements WHERE COALESCE(posted_at, synced_at) >= ? ${c ? "AND course_id = ?" : ""} ORDER BY COALESCE(posted_at, synced_at) DESC`)
      .all(...(c ? [since, c.id] : [since])) as AnnouncementRow[];
    const byId = new Map(courses().map((x) => [x.id, x]));
    return json(
      rows.map((a) => ({
        id: a.id, course: courseLabel(byId.get(a.course_id), a.course_id), title: a.title,
        posted: fmtDateTime(a.posted_at, TZ()),
        text: convert(a.message ?? "", { wordwrap: false }).slice(0, 1200),
        extracted: a.actions ? JSON.parse(a.actions) : null, url: a.html_url,
      })),
    );
  },
});

const getCalendar = betaZodTool({
  name: "get_calendar",
  description: "Calendar events (classes, personal events, exams) for the next N days, plus the current week's planned study blocks.",
  inputSchema: z.object({ days: z.number().int().min(1).max(28).default(7) }),
  run: async ({ days }) => {
    const now = new Date().toISOString();
    const until = addDaysUtc(new Date(), days).toISOString();
    const events = db()
      .prepare("SELECT * FROM calendar_events WHERE start_at >= ? AND start_at <= ? ORDER BY start_at ASC")
      .all(now, until) as CalendarEventRow[];
    const blocks = db()
      .prepare("SELECT sb.*, a.name AS assignment_name FROM study_blocks sb JOIN assignments a ON a.id = sb.assignment_id WHERE sb.start_at >= ? AND sb.start_at <= ? ORDER BY sb.start_at")
      .all(now, until) as Array<StudyBlockRow & { assignment_name: string }>;
    return json({
      events: events.map((e) => ({
        id: e.id, title: e.title, start: fmtDateTime(e.start_at, TZ()), end: fmtDateTime(e.end_at, TZ()),
        start_at: e.start_at, end_at: e.end_at, location: e.location_name, context: e.context_code,
      })),
      study_blocks: blocks.map((b) => ({
        assignment: b.assignment_name, start: fmtDateTime(b.start_at, TZ()), end: fmtDateTime(b.end_at, TZ()),
      })),
    });
  },
});

const getSyllabus = betaZodTool({
  name: "get_syllabus",
  description: "Full syllabus text for a course (if the Syllabus tab exists), plus extracted facts. Use for policy questions (late work, grading, attendance, exams).",
  inputSchema: z.object({ course: z.string().describe("Course code, name fragment, or id") }),
  run: async ({ course }) => {
    const c = findCourse(course);
    if (!c) return `No course matches "${course}". Call get_courses to see options.`;
    if (c.syllabus_source === "link_only") {
      return `${courseLabel(c)}'s Syllabus tab is only a link to an attachment that couldn't be read (wrong file type, locked, or too large), so I don't have its policies.`;
    }
    // Falls back to the raw tab HTML for rows synced before syllabus_text existed.
    const text = c.syllabus_text ?? (c.syllabus_body ? convert(c.syllabus_body, { wordwrap: false }) : "");
    if (!syllabusReadable(c.syllabus_source) && !text) {
      return `${courseLabel(c)} has no Syllabus tab content in Canvas, so I can't read its policies.`;
    }
    return json({
      course: courseLabel(c),
      source: c.syllabus_source === "pdf" ? "syllabus PDF attached to the Syllabus tab" : "Syllabus tab",
      late_policy: c.late_policy, grading_weights: c.grading_weights ? JSON.parse(c.grading_weights) : null,
      exam_dates: c.exam_dates ? JSON.parse(c.exam_dates) : null,
      syllabus_text: text.slice(0, 12000),
    });
  },
});

const getOfficeHours = betaZodTool({
  name: "get_office_hours",
  description: "Office hours extracted from each course's syllabus (instructor, weekday, time, location).",
  inputSchema: z.object({ course: courseArg }),
  run: async ({ course }) => {
    const c = findCourse(course);
    if (course && !c) return `No course matches "${course}".`;
    const rows = db()
      .prepare(`SELECT * FROM office_hours ${c ? "WHERE course_id = ?" : ""} ORDER BY course_id, day_of_week, start_time`)
      .all(...(c ? [c.id] : [])) as OfficeHoursRow[];
    if (rows.length === 0) {
      return c
        ? `No office hours found in the ${courseLabel(c)} syllabus${courseHasSyllabus(c) ? "" : c.syllabus_source === "link_only" ? " (its Syllabus tab is only an unreadable attachment)" : " (no syllabus tab)"}.`
        : "No office hours have been extracted yet. Run a sync, or the syllabi may not list them.";
    }
    const byId = new Map(courses().map((x) => [x.id, x]));
    return json(
      rows.map((o) => ({
        course: courseLabel(byId.get(o.course_id), o.course_id), instructor: o.instructor,
        day: dayName(o.day_of_week), start: o.start_time, end: o.end_time, location: o.location, modality: o.modality,
        next: fmtDateTime(nextOccurrence(o.day_of_week, o.start_time, TZ()).toISOString(), TZ()),
      })),
    );
  },
});

const findOfficeHoursSlot = betaZodTool({
  name: "find_office_hours_slot",
  description: "Find office-hours times in the next N days when the student is actually free (no calendar conflicts). Returns concrete slots to attend.",
  inputSchema: z.object({
    course: z.string().describe("Course code, name fragment, or id"),
    days: z.number().int().min(1).max(21).default(7),
  }),
  run: async ({ course, days }) => {
    const c = findCourse(course);
    if (!c) return `No course matches "${course}".`;
    const hours = db().prepare("SELECT * FROM office_hours WHERE course_id = ?").all(c.id) as OfficeHoursRow[];
    if (hours.length === 0) return `No office hours are listed in the ${courseLabel(c)} syllabus.`;
    const tz = TZ();
    const busy: Interval[] = (db().prepare("SELECT * FROM calendar_events WHERE start_at IS NOT NULL AND end_at IS NOT NULL").all() as CalendarEventRow[])
      .map((e) => ({ start: new Date(e.start_at!), end: new Date(e.end_at!) }));

    const results: Array<{ instructor: string; when: string; free_window: string; location: string | null }> = [];
    for (const oh of hours) {
      for (let d = 0; d < days; d++) {
        const day = addDaysUtc(new Date(), d);
        const p = partsInTz(day, tz);
        if (p.weekday !== oh.day_of_week) continue;
        const s = parseHm(oh.start_time), e = parseHm(oh.end_time);
        const start = zonedToUtc(p.year, p.month, p.day, s.h, s.m, tz);
        const end = zonedToUtc(p.year, p.month, p.day, e.h, e.m, tz);
        if (end < new Date()) continue;
        const free = freeSlots(start, 1, busy, tz, [{ start: oh.start_time, end: oh.end_time }], 20)
          .filter((f) => f.start < end && f.end > start);
        for (const f of free) {
          results.push({
            instructor: oh.instructor,
            when: fmtDate(start.toISOString(), tz),
            free_window: `${fmtDateTime(f.start.toISOString(), tz)} – ${new Date(f.end).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })}`,
            location: oh.location,
          });
        }
      }
    }
    return results.length ? json(results) : `Office hours exist for ${courseLabel(c)} but every slot in the next ${days} days conflicts with your calendar.`;
  },
});

const getWorkloadForecast = betaZodTool({
  name: "get_workload_forecast",
  description: "Estimated hours per upcoming assignment and a study plan packed into the student's free time for a week. week_offset 0 = this week, 1 = next week. Flags overload.",
  inputSchema: z.object({ week_offset: z.number().int().min(0).max(4).default(0) }),
  run: async ({ week_offset }) => {
    const f = await buildForecast({ weekOffset: week_offset, tz: TZ() });
    return json({
      week: `${fmtDate(f.weekStart, TZ())} – ${fmtDate(f.weekEnd, TZ())}`,
      total_estimated_hours: f.totalEstimatedHours, total_free_hours: f.totalFreeHours, overloaded: f.overloaded,
      hours_per_day: f.hoursPerDay.map((d) => `${d.label}: ${d.hours}h planned of ${d.freeHours}h free`),
      tasks: f.tasks.map((t) => ({
        name: t.name, course: t.course, due: fmtDateTime(t.dueAt, TZ()), est_hours: t.estimatedHours,
        difficulty: t.difficulty, unscheduled_hours: t.unscheduledHours, why: t.reasoning,
      })),
      study_blocks: f.blocks.map((b) => `${fmtDateTime(b.startAt, TZ())} (${b.hours}h): ${b.assignmentName} [${b.courseCode}]`),
    });
  },
});

const getPendingProposals = betaZodTool({
  name: "get_pending_proposals",
  description: "Calendar changes and messages waiting for the student's approval in the Proposals inbox.",
  inputSchema: z.object({}),
  run: async () =>
    json(
      listProposals("pending").map((p) => ({
        id: p.id, type: p.type, rationale: p.rationale, source: p.source, created: fmtDateTime(p.created_at, TZ()),
      })),
    ),
});

// ---------- write tools (proposals only) ----------

const proposeCalendarEvent = betaZodTool({
  name: "propose_calendar_event",
  description:
    "Propose adding an event to the student's Canvas calendar (study block, reminder, office-hours visit, exam). " +
    "Nothing is written until the student approves it in the Proposals inbox — tell them that.",
  inputSchema: z.object({
    title: z.string(),
    start_at: z.string().describe("ISO 8601 datetime with timezone offset"),
    end_at: z.string().describe("ISO 8601 datetime with timezone offset"),
    location: z.string().optional(),
    description: z.string().optional(),
    rationale: z.string().describe("One sentence the student sees explaining why"),
    repeat_weekly_count: z.number().int().min(0).max(20).default(0).describe("Extra weekly repeats (0 = one-off)"),
  }),
  run: async (input) => {
    const meId = getPref("me_id");
    if (!meId) return "Canvas hasn't been synced yet, so I don't know your user id. Ask the student to run a sync first.";
    const p = createProposal(
      "calendar_create",
      {
        context_code: `user_${meId}`, title: input.title, start_at: input.start_at, end_at: input.end_at,
        location_name: input.location, description: input.description,
        ...(input.repeat_weekly_count > 0 ? { duplicate: { count: input.repeat_weekly_count, interval: 1, frequency: "weekly" } } : {}),
      },
      input.rationale,
      "chat",
    );
    return `Proposal #${p.id} created (calendar event "${input.title}" at ${fmtDateTime(input.start_at, TZ())}). It will be added once the student approves it in the Proposals inbox.`;
  },
});

const proposeMessage = betaZodTool({
  name: "propose_message",
  description:
    "Draft a Canvas Inbox message to a course's instructor (e.g. about a missed assignment or an extension). " +
    "Write a polite, specific, concise message; reference the assignment and the syllabus late policy if known. " +
    "It is only sent after the student approves it in the Proposals inbox.",
  inputSchema: z.object({
    course: z.string().describe("Course code, name fragment, or id"),
    subject: z.string(),
    body: z.string().describe("Plain-text message body, signed with the student's name"),
    rationale: z.string().describe("One sentence the student sees explaining why"),
    assignment_id: z.number().optional(),
  }),
  run: async (input) => {
    const c = findCourse(input.course);
    if (!c) return `No course matches "${input.course}".`;
    if (!c.instructor_user_id) return `I don't have a Canvas user id for the ${courseLabel(c)} instructor, so I can't address a message. The draft is:\n\nSubject: ${input.subject}\n\n${input.body}`;
    const p = createProposal(
      "message",
      { recipient_ids: [c.instructor_user_id], recipient_name: c.instructor_name, subject: input.subject, body: input.body, course_id: c.id },
      input.rationale,
      input.assignment_id ? `missing:${input.assignment_id}` : "chat",
    );
    return `Proposal #${p.id} created: message to ${c.instructor_name ?? "the instructor"} — "${input.subject}". The student can review, edit and send it from the Proposals inbox.`;
  },
});

// ---------- exports ----------

export const readTools = [
  getCourses, getUpcomingAssignments, getMissingAssignments, getAnnouncements, getCalendar,
  getSyllabus, getOfficeHours, findOfficeHoursSlot, getWorkloadForecast, getPendingProposals,
].map(eager);

export const writeTools = [proposeCalendarEvent, proposeMessage].map(eager);

export const allTools = [...readTools, ...writeTools];

export function studentContext(): string {
  const name = getPref("me_name") ?? "the student";
  const lastSync = getPref("last_sync");
  const list = courses().map((c) => `- ${c.course_code ?? ""} ${c.name} (id ${c.id})${c.instructor_name ? `, instructor ${c.instructor_name}` : ""}${courseHasSyllabus(c) ? "" : c.syllabus_source === "link_only" ? ", syllabus attachment unreadable" : ", no syllabus tab"}`).join("\n");
  const now = new Date();
  const hidden = Number(getPref("courses_hidden") ?? 0);
  const favoritesSet = getPref("favorites_set") !== "0";
  const scope = !favoritesSet
    ? "The student has starred no courses in Canvas, so every enrolled course is listed above."
    : `These are the courses the student starred (favorited) in Canvas — the only ones you can see.` +
      (hidden > 0
        ? ` ${hidden} other enrolled course${hidden === 1 ? " is" : "s are"} un-starred and completely invisible to you.`
        : "") +
      " If the student asks about a course that isn't listed, tell them to star it in Canvas and re-sync; never guess at its contents.";
  return (
    `Student: ${name}. Timezone: ${TZ()}. Last Canvas sync: ${lastSync ? fmtDateTime(lastSync, TZ()) : "never"}.\n` +
    `Courses:\n${list || "(none synced yet)"}\n` +
    `${scope}\n` +
    `Current date/time: ${now.toLocaleString("en-US", { timeZone: TZ(), dateStyle: "full", timeStyle: "short" })}.`
  );
}

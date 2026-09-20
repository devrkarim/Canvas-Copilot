/**
 * Weekly workload forecast:
 *   1. estimateEffort()      — LLM estimates hours per upcoming assignment (cached in `forecasts`)
 *   2. allocateToFreeSlots() — pure TS: packs work into free study windows, earliest deadline first
 */
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { convert } from "html-to-text";
import { anthropic, parseDefaults, llmConfigured } from "@/lib/llm";
import { db, nowIso, type AssignmentRow, type CalendarEventRow, type CourseRow, type ForecastRow } from "@/lib/db";
import { addDaysUtc, partsInTz, startOfDayTz, zonedToUtc, parseHm } from "@/lib/time";

const EffortSchema = z.object({
  estimates: z.array(
    z.object({
      assignmentId: z.number(),
      estimatedHours: z.number().min(0.25).max(40),
      difficulty: z.enum(["light", "moderate", "heavy"]),
      suggestedStartDaysBefore: z.number().int().min(0).max(21),
      reasoning: z.string().describe("One short sentence"),
    }),
  ),
});

export interface Task {
  assignment: AssignmentRow;
  course: CourseRow | undefined;
  forecast: ForecastRow;
}

export interface StudyBlock {
  assignmentId: number;
  assignmentName: string;
  courseCode: string;
  startAt: string;
  endAt: string;
  hours: number;
}

export interface ForecastResult {
  weekStart: string;
  weekEnd: string;
  tasks: Array<{
    assignmentId: number;
    name: string;
    course: string;
    dueAt: string | null;
    estimatedHours: number;
    difficulty: string;
    scheduledHours: number;
    unscheduledHours: number;
    reasoning: string | null;
  }>;
  blocks: StudyBlock[];
  hoursPerDay: Array<{ date: string; label: string; hours: number; freeHours: number }>;
  totalEstimatedHours: number;
  totalFreeHours: number;
  overloaded: boolean;
}

/** Upcoming, unsubmitted assignments due within `horizonDays`. */
export function upcomingTasks(horizonDays = 14): Array<{ assignment: AssignmentRow; course: CourseRow | undefined }> {
  const conn = db();
  const now = new Date().toISOString();
  const until = addDaysUtc(new Date(), horizonDays).toISOString();
  const rows = conn
    .prepare(
      "SELECT * FROM assignments WHERE submitted = 0 AND due_at IS NOT NULL AND due_at >= ? AND due_at <= ? ORDER BY due_at ASC",
    )
    .all(now, until) as AssignmentRow[];
  const courses = new Map(
    (conn.prepare("SELECT * FROM courses").all() as CourseRow[]).map((c) => [c.id, c]),
  );
  return rows.map((a) => ({ assignment: a, course: courses.get(a.course_id) }));
}

/** Ensure every task has a fresh effort estimate. One LLM call for all missing ones. */
export async function estimateEffort(
  tasks: Array<{ assignment: AssignmentRow; course: CourseRow | undefined }>,
): Promise<Map<number, ForecastRow>> {
  const conn = db();
  const existing = new Map(
    (conn.prepare("SELECT * FROM forecasts").all() as ForecastRow[]).map((f) => [f.assignment_id, f]),
  );
  const staleBefore = addDaysUtc(new Date(), -3).toISOString();
  const need = tasks.filter((t) => {
    const f = existing.get(t.assignment.id);
    return !f || f.updated_at < staleBefore;
  });

  if (need.length > 0 && llmConfigured()) {
    const lines = need.map((t) => {
      const desc = convert(t.assignment.description ?? "", { wordwrap: false }).slice(0, 600);
      return (
        `- id=${t.assignment.id} | course="${t.course?.name ?? t.assignment.course_id}" | name="${t.assignment.name}"` +
        ` | points=${t.assignment.points_possible ?? "?"} | types=${t.assignment.submission_types ?? "[]"}` +
        ` | due=${t.assignment.due_at}\n  description: ${desc || "(none)"}`
      );
    });
    const response = await anthropic().messages.parse({
      ...parseDefaults,
      system:
        "You estimate how many focused hours a typical undergraduate needs to complete each assignment. " +
        "Use the name, description, point value and submission type. Small quizzes/readings: 0.5–1.5h; problem sets: 2–5h; " +
        "essays/projects: 4–15h; exams: study time 3–10h. Return one estimate per assignment id given.",
      messages: [{ role: "user", content: `Assignments:\n${lines.join("\n")}` }],
      output_config: { ...parseDefaults.output_config, format: zodOutputFormat(EffortSchema) },
    });
    const upsert = conn.prepare(`
      INSERT INTO forecasts(assignment_id, estimated_hours, difficulty, suggested_start_days_before, reasoning, updated_at)
      VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(assignment_id) DO UPDATE SET estimated_hours=excluded.estimated_hours, difficulty=excluded.difficulty,
        suggested_start_days_before=excluded.suggested_start_days_before, reasoning=excluded.reasoning, updated_at=excluded.updated_at
    `);
    for (const e of response.parsed_output?.estimates ?? []) {
      upsert.run(e.assignmentId, e.estimatedHours, e.difficulty, e.suggestedStartDaysBefore, e.reasoning, nowIso());
      existing.set(e.assignmentId, {
        assignment_id: e.assignmentId, estimated_hours: e.estimatedHours, difficulty: e.difficulty,
        suggested_start_days_before: e.suggestedStartDaysBefore, reasoning: e.reasoning, updated_at: nowIso(),
      });
    }
  }

  // Fallback heuristic for anything still missing (no API key, or model skipped one).
  for (const t of tasks) {
    if (!existing.has(t.assignment.id)) {
      const pts = t.assignment.points_possible ?? 10;
      const hours = Math.min(12, Math.max(0.5, pts / 10));
      existing.set(t.assignment.id, {
        assignment_id: t.assignment.id, estimated_hours: hours, difficulty: hours > 4 ? "heavy" : hours > 1.5 ? "moderate" : "light",
        suggested_start_days_before: Math.ceil(hours / 2), reasoning: "heuristic (points/10)", updated_at: nowIso(),
      });
    }
  }
  return existing;
}

// ---------------------------------------------------------------------------
// Slot allocation (pure)

export interface Interval { start: Date; end: Date }

export function studyWindows(): Array<{ start: string; end: string }> {
  const raw = process.env.STUDY_WINDOWS || "09:00-12:00,14:00-18:00,19:00-22:00";
  return raw.split(",").map((w) => {
    const [start, end] = w.trim().split("-");
    return { start, end };
  });
}

/** Free intervals across [from, from+days) after removing busy events, ≥ minMinutes each. */
export function freeSlots(
  from: Date,
  days: number,
  busy: Interval[],
  tz: string,
  windows = studyWindows(),
  minMinutes = 30,
): Interval[] {
  const out: Interval[] = [];
  busy = busy.filter((b) => b.end.getTime() > b.start.getTime()); // drop zero-length / inverted
  const dayStart = startOfDayTz(from, tz);
  for (let d = 0; d < days; d++) {
    const day = addDaysUtc(dayStart, d);
    const p = partsInTz(day, tz);
    for (const w of windows) {
      const ws = parseHm(w.start), we = parseHm(w.end);
      let cursor = zonedToUtc(p.year, p.month, p.day, ws.h, ws.m, tz);
      const end = zonedToUtc(p.year, p.month, p.day, we.h, we.m, tz);
      if (cursor < from) cursor = new Date(Math.ceil(from.getTime() / 900000) * 900000); // round up to 15 min
      const overlapping = busy
        .filter((b) => b.start < end && b.end > cursor)
        .sort((a, b) => a.start.getTime() - b.start.getTime());
      for (const b of overlapping) {
        if (b.start > cursor) out.push({ start: cursor, end: b.start });
        if (b.end > cursor) cursor = b.end;
      }
      if (end > cursor) out.push({ start: cursor, end });
    }
  }
  return out.filter((s) => (s.end.getTime() - s.start.getTime()) / 60000 >= minMinutes);
}

/** Earliest-deadline-first packing into free slots; blocks capped at maxBlockHours. */
export function allocate(
  tasks: Task[],
  slots: Interval[],
  maxBlockHours = 2,
): { blocks: StudyBlock[]; remaining: Map<number, number> } {
  const MIN_BLOCK = 0.25;
  const remaining = new Map<number, number>(tasks.map((t) => [t.assignment.id, t.forecast.estimated_hours]));
  const blocks: StudyBlock[] = [];
  const byDue = [...tasks].sort(
    (a, b) => new Date(a.assignment.due_at!).getTime() - new Date(b.assignment.due_at!).getTime(),
  );

  for (const slot of slots) {
    let cursor = slot.start;
    while ((slot.end.getTime() - cursor.getTime()) / 3600000 >= 0.5) {
      // Earliest-due task that still has work and is due after this slot starts.
      const task = byDue.find(
        (t) => (remaining.get(t.assignment.id) ?? 0) >= MIN_BLOCK && new Date(t.assignment.due_at!) > cursor,
      );
      if (!task) break;
      const slotHours = (slot.end.getTime() - cursor.getTime()) / 3600000;
      const left = remaining.get(task.assignment.id)!;
      // Quarter-hour blocks; a leftover smaller than MIN_BLOCK is absorbed into this block.
      let hours = Math.floor(Math.min(maxBlockHours, slotHours, left) / MIN_BLOCK) * MIN_BLOCK;
      if (left - hours < MIN_BLOCK && left <= slotHours) hours = left;
      if (hours < MIN_BLOCK) break;
      const end = new Date(cursor.getTime() + hours * 3600000);
      blocks.push({
        assignmentId: task.assignment.id,
        assignmentName: task.assignment.name,
        courseCode: task.course?.course_code ?? task.course?.name ?? "",
        startAt: cursor.toISOString(),
        endAt: end.toISOString(),
        hours: Math.round(hours * 4) / 4,
      });
      remaining.set(task.assignment.id, Math.max(0, left - hours));
      cursor = end;
    }
  }
  return { blocks, remaining };
}

// ---------------------------------------------------------------------------

export async function buildForecast(opts: { weekOffset?: number; tz: string; horizonDays?: number }): Promise<ForecastResult> {
  const conn = db();
  const tz = opts.tz;
  const weekOffset = opts.weekOffset ?? 0;
  const from = weekOffset === 0 ? new Date() : addDaysUtc(startOfDayTz(new Date(), tz), 7 * weekOffset);
  const to = addDaysUtc(startOfDayTz(from, tz), 7);

  const upcoming = upcomingTasks(opts.horizonDays ?? 14 + 7 * weekOffset).filter(
    (t) => new Date(t.assignment.due_at!) > from,
  );
  const forecasts = await estimateEffort(upcoming);
  const tasks: Task[] = upcoming.map((t) => ({ ...t, forecast: forecasts.get(t.assignment.id)! }));

  const busy: Interval[] = (conn.prepare("SELECT * FROM calendar_events WHERE start_at IS NOT NULL").all() as CalendarEventRow[])
    .filter((e) => e.start_at && e.end_at)
    .map((e) => ({ start: new Date(e.start_at!), end: new Date(e.end_at!) }))
    .filter((b) => b.end > b.start);

  const slots = freeSlots(from, 7, busy, tz);
  const { blocks, remaining } = allocate(tasks, slots);

  // Persist the plan for this week so chat/briefing can read it.
  const weekStart = startOfDayTz(from, tz).toISOString();
  conn.prepare("DELETE FROM study_blocks WHERE week_start = ?").run(weekStart);
  const ins = conn.prepare("INSERT INTO study_blocks(assignment_id, start_at, end_at, week_start) VALUES(?, ?, ?, ?)");
  for (const b of blocks) ins.run(b.assignmentId, b.startAt, b.endAt, weekStart);

  const hoursPerDay = Array.from({ length: 7 }, (_, i) => {
    const day = addDaysUtc(startOfDayTz(from, tz), i);
    const next = addDaysUtc(day, 1);
    const hours = blocks
      .filter((b) => new Date(b.startAt) >= day && new Date(b.startAt) < next)
      .reduce((s, b) => s + b.hours, 0);
    const freeHours = slots
      .filter((s) => s.start >= day && s.start < next)
      .reduce((s, sl) => s + (sl.end.getTime() - sl.start.getTime()) / 3600000, 0);
    return {
      date: day.toISOString(),
      label: day.toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }),
      hours: Math.round(hours * 4) / 4,
      freeHours: Math.round(freeHours * 4) / 4,
    };
  });

  const totalEstimatedHours = tasks.reduce((s, t) => s + t.forecast.estimated_hours, 0);
  const totalFreeHours = hoursPerDay.reduce((s, d) => s + d.freeHours, 0);

  return {
    weekStart,
    weekEnd: to.toISOString(),
    tasks: tasks.map((t) => ({
      assignmentId: t.assignment.id,
      name: t.assignment.name,
      course: t.course?.course_code ?? t.course?.name ?? String(t.assignment.course_id),
      dueAt: t.assignment.due_at,
      estimatedHours: t.forecast.estimated_hours,
      difficulty: t.forecast.difficulty,
      scheduledHours: Math.round((t.forecast.estimated_hours - (remaining.get(t.assignment.id) ?? 0)) * 4) / 4,
      unscheduledHours: Math.round((remaining.get(t.assignment.id) ?? 0) * 4) / 4,
      reasoning: t.forecast.reasoning,
    })),
    blocks,
    hoursPerDay,
    totalEstimatedHours: Math.round(totalEstimatedHours * 4) / 4,
    totalFreeHours: Math.round(totalFreeHours * 4) / 4,
    overloaded: [...remaining.values()].some((r) => r > 0.01),
  };
}

import { describe, it, expect } from "vitest";
import { freeSlots, allocate, type Task } from "@/lib/forecast";
import { zonedToUtc, nextOccurrence, partsInTz } from "@/lib/time";

const TZ = "America/New_York";
const windows = [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "18:00" }];

describe("freeSlots", () => {
  it("subtracts busy events from study windows", () => {
    const from = zonedToUtc(2026, 9, 21, 8, 0, TZ); // Monday 08:00
    const busy = [{ start: zonedToUtc(2026, 9, 21, 10, 0, TZ), end: zonedToUtc(2026, 9, 21, 11, 0, TZ) }];
    const slots = freeSlots(from, 1, busy, TZ, windows);
    const local = slots.map((s) => [partsInTz(s.start, TZ).hour, partsInTz(s.end, TZ).hour]);
    expect(local).toEqual([[9, 10], [11, 12], [14, 18]]);
  });

  it("never returns a slot that overlaps a busy interval", () => {
    const from = zonedToUtc(2026, 9, 21, 0, 0, TZ);
    const busy = Array.from({ length: 7 }, (_, d) => ({
      start: zonedToUtc(2026, 9, 21 + d, 9, 30, TZ), end: zonedToUtc(2026, 9, 21 + d, 15, 0, TZ),
    }));
    for (const s of freeSlots(from, 7, busy, TZ, windows)) {
      for (const b of busy) expect(s.start >= b.end || s.end <= b.start).toBe(true);
    }
  });
});

function task(id: number, hours: number, dueIso: string): Task {
  return {
    assignment: { id, course_id: 1, name: `A${id}`, description: null, due_at: dueIso, points_possible: 10, submission_types: "[]", html_url: null, submitted: 0, score: null, missing: 0, synced_at: "" },
    course: undefined,
    forecast: { assignment_id: id, estimated_hours: hours, difficulty: "moderate", suggested_start_days_before: 1, reasoning: null, updated_at: "" },
  };
}

describe("allocate", () => {
  it("schedules earliest deadline first and caps blocks at 2h", () => {
    const from = zonedToUtc(2026, 9, 21, 8, 0, TZ);
    const slots = freeSlots(from, 2, [], TZ, windows);
    const t1 = task(1, 3, zonedToUtc(2026, 9, 23, 23, 59, TZ).toISOString());
    const t2 = task(2, 1, zonedToUtc(2026, 9, 22, 12, 0, TZ).toISOString()); // due sooner
    const { blocks, remaining } = allocate([t1, t2], slots);
    expect(blocks[0].assignmentId).toBe(2);
    expect(Math.max(...blocks.map((b) => b.hours))).toBeLessThanOrEqual(2);
    expect(remaining.get(1)).toBeCloseTo(0);
    expect(remaining.get(2)).toBeCloseTo(0);
  });

  it("does not schedule work after its deadline and reports the shortfall", () => {
    const from = zonedToUtc(2026, 9, 21, 8, 0, TZ);
    const slots = freeSlots(from, 3, [], TZ, windows);
    const t = task(1, 20, zonedToUtc(2026, 9, 21, 12, 0, TZ).toISOString()); // due at noon day 1
    const { blocks, remaining } = allocate([t], slots);
    for (const b of blocks) expect(new Date(b.startAt) < new Date(t.assignment.due_at!)).toBe(true);
    expect(remaining.get(1)!).toBeGreaterThan(0);
  });
});

describe("nextOccurrence", () => {
  it("returns the coming weekday at the requested wall-clock time", () => {
    const from = zonedToUtc(2026, 9, 21, 15, 0, TZ); // Monday 15:00
    const d = nextOccurrence(2, "14:00", TZ, from); // Tuesday 14:00
    const p = partsInTz(d, TZ);
    expect([p.weekday, p.hour, p.minute, p.day]).toEqual([2, 14, 0, 22]);
    const sameDayLater = nextOccurrence(1, "16:00", TZ, from);
    expect(partsInTz(sameDayLater, TZ).day).toBe(21);
    const sameDayEarlier = nextOccurrence(1, "14:00", TZ, from);
    expect(partsInTz(sameDayEarlier, TZ).day).toBe(28);
  });
});

import { describe, it, expect } from "vitest";
import { freeSlots, allocate, type Task } from "@/lib/forecast";
import { zonedToUtc, partsInTz, occurrenceRange } from "@/lib/time";

const TZ = "America/New_York";
const hours = (s: { start: Date; end: Date }) => (s.end.getTime() - s.start.getTime()) / 3600000;

describe("DST", () => {
  it("fall-back day (Nov 1 2026) still yields a 3h 09:00-12:00 window", () => {
    const from = zonedToUtc(2026, 11, 1, 0, 0, TZ);
    const slots = freeSlots(from, 1, [], TZ, [{ start: "09:00", end: "12:00" }]);
    expect(slots).toHaveLength(1);
    expect(hours(slots[0])).toBe(3);
    expect(partsInTz(slots[0].start, TZ).hour).toBe(9);
  });
  it("spring-forward day (Mar 8 2026) window that spans the gap is 1h shorter in real time", () => {
    const from = zonedToUtc(2026, 3, 8, 0, 0, TZ);
    const slots = freeSlots(from, 1, [], TZ, [{ start: "01:00", end: "04:00" }]);
    expect(hours(slots[0])).toBe(2); // 02:00 doesn't exist
  });
  it("zonedToUtc for a nonexistent local time (02:30 on spring-forward) does not throw and lands after the gap", () => {
    const d = zonedToUtc(2026, 3, 8, 2, 30, TZ);
    expect(d.getTime()).toBeGreaterThan(zonedToUtc(2026, 3, 8, 1, 59, TZ).getTime());
  });
});

describe("freeSlots edge cases", () => {
  const day = (h: number, m = 0) => zonedToUtc(2026, 9, 21, h, m, TZ);
  const W = [{ start: "09:00", end: "12:00" }, { start: "19:00", end: "22:00" }];

  it("from after all windows today → no slots today", () => {
    expect(freeSlots(day(22, 30), 1, [], TZ, W)).toHaveLength(0);
  });
  it("busy event fully covering a window removes it", () => {
    const slots = freeSlots(day(0), 1, [{ start: day(8), end: day(13) }], TZ, W);
    expect(slots.map(hours)).toEqual([3]);
  });
  it("busy event spanning midnight into the next day is respected", () => {
    const busy = [{ start: day(21), end: zonedToUtc(2026, 9, 22, 10, 0, TZ) }];
    const slots = freeSlots(day(0), 2, busy, TZ, W);
    const local = slots.map((s) => [partsInTz(s.start, TZ).day, partsInTz(s.start, TZ).hour, partsInTz(s.end, TZ).hour]);
    expect(local).toEqual([[21, 9, 12], [21, 19, 21], [22, 10, 12], [22, 19, 22]]);
  });
  it("zero-length and inverted busy intervals are ignored, unsorted input is fine", () => {
    const busy = [{ start: day(10), end: day(10) }, { start: day(11), end: day(10, 30) }, { start: day(9, 30), end: day(10) }];
    const slots = freeSlots(day(0), 1, busy, TZ, W);
    expect(slots.map(hours)).toEqual([0.5, 2, 3]);
  });
  it("rounds a mid-window start up to the next 15 minutes", () => {
    const slots = freeSlots(day(9, 7), 1, [], TZ, W);
    expect(partsInTz(slots[0].start, TZ).minute).toBe(15);
  });
});

function task(id: number, h: number, due: Date): Task {
  return {
    assignment: { id, course_id: 1, name: `A${id}`, description: null, due_at: due.toISOString(), points_possible: 10, submission_types: "[]", html_url: null, submitted: 0, score: null, missing: 0, synced_at: "" },
    course: undefined,
    forecast: { assignment_id: id, estimated_hours: h, difficulty: "light", suggested_start_days_before: 1, reasoning: null, updated_at: "" },
  };
}

describe("allocate edge cases", () => {
  const from = zonedToUtc(2026, 9, 21, 8, 0, TZ);
  const slots = freeSlots(from, 3, [], TZ, [{ start: "09:00", end: "12:00" }]);
  it("no tasks → no blocks", () => {
    expect(allocate([], slots).blocks).toEqual([]);
  });
  it("no slots → everything unscheduled", () => {
    const { blocks, remaining } = allocate([task(1, 2, zonedToUtc(2026, 9, 25, 0, 0, TZ))], []);
    expect(blocks).toEqual([]);
    expect(remaining.get(1)).toBe(2);
  });
  it("does not emit sub-15-minute crumbs", () => {
    const { blocks } = allocate([task(1, 2.05, zonedToUtc(2026, 9, 25, 0, 0, TZ))], slots);
    for (const b of blocks) expect(b.hours).toBeGreaterThanOrEqual(0.25);
  });
  it("a task already past due gets no blocks", () => {
    const { blocks, remaining } = allocate([task(1, 2, zonedToUtc(2026, 9, 20, 0, 0, TZ))], slots);
    expect(blocks).toEqual([]);
    expect(remaining.get(1)).toBe(2);
  });
});

describe("office-hours occurrence while currently inside the window", () => {
  it("start and end must be on the same day", () => {
    const now = zonedToUtc(2026, 9, 22, 14, 30, TZ); // Tuesday 14:30, inside 14:00–15:30
    const { start, end } = occurrenceRange(2, "14:00", "15:30", TZ, now);
    expect(end.getTime() - start.getTime()).toBe(90 * 60000);
    expect(partsInTz(start, TZ).day).toBe(partsInTz(end, TZ).day);
    // malformed (end before start) falls back to a one-hour slot instead of a negative range
    const bad = occurrenceRange(2, "14:00", "13:00", TZ, now);
    expect(bad.end.getTime() - bad.start.getTime()).toBe(60 * 60000);
  });
});

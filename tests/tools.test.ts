/**
 * Exercises the LLM tool `run` functions against the seeded demo database
 * (no model calls: the tools are plain functions over SQLite).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { allTools } from "@/lib/tools";
import { listProposals } from "@/lib/db";

type Tool = { name: string; run: (input: Record<string, unknown>) => Promise<string> };
const tool = (name: string) => allTools.find((t) => t.name === name) as unknown as Tool;
const runJson = async (name: string, input: Record<string, unknown> = {}) => JSON.parse(await tool(name).run(input));

beforeAll(async () => {
  await import("../scripts/seed-demo.ts");
});

describe("read tools", () => {
  it("get_courses lists the three demo courses with syllabus flags", async () => {
    const courses = await runJson("get_courses");
    expect(courses.map((c: { code: string }) => c.code).sort()).toEqual(["CHEM 122", "CS 101", "ENGL 240"]);
    expect(courses.find((c: { code: string }) => c.code === "ENGL 240").syllabus_available).toBe(false);
  });

  it("get_upcoming_assignments filters by course and excludes submitted", async () => {
    const all = await runJson("get_upcoming_assignments", { days: 14, include_submitted: false });
    expect(all.every((a: { submitted: boolean }) => !a.submitted)).toBe(true);
    const cs = await runJson("get_upcoming_assignments", { days: 14, course: "cs101", include_submitted: false });
    expect(cs.every((a: { course: string }) => a.course.startsWith("CS 101"))).toBe(true);
    expect(cs.length).toBeGreaterThan(0);
  });

  it("get_missing_assignments returns HW2 with the late policy attached", async () => {
    const missing = await runJson("get_missing_assignments");
    expect(missing).toHaveLength(1);
    expect(missing[0].name).toContain("HW2");
    expect(missing[0].late_policy).toMatch(/10%/);
  });

  it("get_syllabus explains when a course has no syllabus tab", async () => {
    const text = await tool("get_syllabus").run({ course: "ENGL 240" });
    expect(text).toMatch(/no Syllabus tab/);
    const cs = await runJson("get_syllabus", { course: "CS 101" });
    expect(cs.late_policy).toBeTruthy();
    expect(cs.syllabus_text).toMatch(/Office hours/);
  });

  it("get_office_hours and find_office_hours_slot work for CS 101", async () => {
    const oh = await runJson("get_office_hours", { course: "CS 101" });
    expect(oh.map((o: { instructor: string }) => o.instructor)).toContain("Dr. Priya Nair");
    const slots = await tool("find_office_hours_slot").run({ course: "CS 101", days: 7 });
    expect(slots).toMatch(/Priya Nair|Marcus Lee|conflicts/);
  });

  it("get_workload_forecast returns a plan without calling the model", async () => {
    const f = await runJson("get_workload_forecast", { week_offset: 0 });
    expect(f.tasks.length).toBeGreaterThan(0);
    expect(f.study_blocks.length).toBeGreaterThan(0);
    expect(typeof f.overloaded).toBe("boolean");
  });
});

describe("write tools only create proposals", () => {
  it("propose_calendar_event creates a pending proposal", async () => {
    const before = listProposals("pending").length;
    const out = await tool("propose_calendar_event").run({
      title: "Study for midterm", start_at: "2026-09-25T14:00:00-04:00", end_at: "2026-09-25T16:00:00-04:00",
      rationale: "Midterm is in 12 days.", repeat_weekly_count: 0,
    });
    expect(out).toMatch(/Proposal #\d+ created/);
    expect(listProposals("pending").length).toBe(before + 1);
  });

  it("propose_message addresses the course instructor", async () => {
    const out = await tool("propose_message").run({
      course: "CS 101", subject: "HW2 submission", body: "Hi Dr. Nair, ...", rationale: "HW2 is missing.", assignment_id: 1002,
    });
    expect(out).toMatch(/message to Dr\. Priya Nair/);
    const p = listProposals("pending").find((x) => x.source === "missing:1002");
    expect(p).toBeTruthy();
    expect(JSON.parse(p!.payload).recipient_ids).toEqual([9001]);
  });
});

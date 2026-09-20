/**
 * Integration test: runSync() against a mock Canvas server with adversarial data.
 * No LLM calls (extract: false).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { favoriteCourses, runSync } from "@/lib/sync";
import { db, getPref } from "@/lib/db";
import { canvasGetAll, CanvasError } from "@/lib/canvas/client";

const past = (d: number) => new Date(Date.now() - d * 864e5).toISOString();
const future = (d: number) => new Date(Date.now() + d * 864e5).toISOString();

// 12 courses → exceeds Canvas's 10-context-code cap; #12 is date-restricted; #11 has no syllabus.
const courses = Array.from({ length: 12 }, (_, i) => ({
  id: 100 + i + 1,
  name: `Course ${i + 1}`,
  course_code: `C${i + 1}`,
  workflow_state: "available",
  syllabus_body: i === 10 ? null : `<p>Office hours Tue 2-3pm. Late policy: 10%/day. Course ${i + 1}</p>`,
  term: { id: 1, name: "Fall", start_at: past(30), end_at: future(60) },
  access_restricted_by_date: i === 11,
}));

let dropCourse101 = false;
/** null = student has starred nothing, so Canvas reports no favorites at all. */
let favoriteIds: Set<number> | null = null;
let rateLimitOnce = true;
const requests: string[] = [];
let contextCodeMax = 0;

const server = http.createServer((req, res) => {
  const url = new URL(req.url!, "http://x");
  requests.push(url.pathname);
  const json = (body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(200, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  const codes = url.searchParams.getAll("context_codes[]");
  contextCodeMax = Math.max(contextCodeMax, codes.length);
  if (codes.length > 10) {
    res.writeHead(400); return res.end(JSON.stringify({ errors: [{ message: "too many context codes" }] }));
  }

  if (url.pathname === "/api/v1/users/self") return json({ id: 7, name: "Test Student" });

  if (url.pathname === "/api/v1/courses") {
    // Paginate 2 pages via Link header; simulate one rate-limit 403 on page 2.
    const page = Number(url.searchParams.get("page") ?? 1);
    if (page === 2 && rateLimitOnce) {
      rateLimitOnce = false;
      res.writeHead(403, { "Content-Type": "text/plain" }); return res.end("403 Forbidden (Rate Limit Exceeded)");
    }
    // Canvas only returns `is_favorite` when include[]=favorites is asked for.
    const wantsFavorites = url.searchParams.getAll("include[]").includes("favorites");
    const list = (dropCourse101 ? courses.filter((c) => c.id !== 101) : courses).map((c) =>
      wantsFavorites && favoriteIds ? { ...c, is_favorite: favoriteIds.has(c.id) } : c,
    );
    const pages = [list.slice(0, 6), list.slice(6)];
    const next = page === 1 ? `<http://localhost:${port}/api/v1/courses?page=2&per_page=100>; rel="next"` : "";
    return json(pages[page - 1] ?? [], next ? { Link: next } : {});
  }

  let m = url.pathname.match(/^\/api\/v1\/courses\/(\d+)\/users$/);
  if (m) return json([{ id: 9000 + Number(m[1]), name: `Prof ${m[1]}`, email: null, enrollments: [{ type: "TeacherEnrollment", role: "TeacherEnrollment" }] }]);

  m = url.pathname.match(/^\/api\/v1\/courses\/(\d+)\/assignments$/);
  if (m) {
    const cid = Number(m[1]);
    if (cid === 102) return json([
      { id: 20, course_id: 102, name: "102 homework", published: true, due_at: future(4), points_possible: 20, submission_types: ["online_upload"], html_url: "u" },
    ]);
    if (cid !== 101) return json([]);
    return json([
      { id: 1, course_id: cid, name: "Unpublished draft", published: false, due_at: future(1), points_possible: 10, submission_types: ["online_upload"], html_url: "u" },
      { id: 2, course_id: cid, name: "No due date", published: true, due_at: null, points_possible: 10, submission_types: ["online_upload"], html_url: "u" },
      { id: 3, course_id: cid, name: "Past-due paper exam", published: true, due_at: past(2), points_possible: 100, submission_types: ["on_paper"], html_url: "u",
        submission: { id: 30, assignment_id: 3, workflow_state: "unsubmitted", submitted_at: null, score: null, grade: null } },
      { id: 4, course_id: cid, name: "Past-due upload, no submission object", published: true, due_at: past(2), points_possible: 50, submission_types: ["online_upload"], html_url: "u" },
      { id: 5, course_id: cid, name: "Excused", published: true, due_at: past(2), points_possible: 50, submission_types: ["online_upload"], html_url: "u",
        submission: { id: 50, assignment_id: 5, workflow_state: "unsubmitted", submitted_at: null, score: null, grade: null, excused: true } },
      { id: 6, course_id: cid, name: "Graded without submitted_at", published: true, due_at: past(1), points_possible: 50, submission_types: ["online_quiz"], html_url: "u",
        submission: { id: 60, assignment_id: 6, workflow_state: "graded", submitted_at: null, score: 45, grade: "45" } },
      { id: 7, course_id: cid, name: "Upcoming", published: true, due_at: future(3), points_possible: 50, submission_types: ["online_upload"], html_url: "u",
        submission: { id: 70, assignment_id: 7, workflow_state: "unsubmitted", submitted_at: null, score: null, grade: null, missing: false } },
    ]);
  }

  if (url.pathname === "/api/v1/users/self/missing_submissions") return json([{ id: 4, name: "Past-due upload, no submission object" }]);

  if (url.pathname === "/api/v1/announcements") {
    return json(codes.includes("course_101")
      ? [
          { id: 501, title: "Normal", message: "<p>hi</p>", posted_at: past(1), context_code: "course_101", html_url: "a" },
          { id: 502, title: "Delayed post (null posted_at)", message: "<p>later</p>", posted_at: null, context_code: "course_101", html_url: "a" },
        ]
      : []);
  }

  if (url.pathname === "/api/v1/calendar_events") {
    return json(codes.includes("user_7")
      ? [
          { id: 800, title: "Live", start_at: future(1), end_at: future(1), context_code: "user_7", workflow_state: "active" },
          { id: 801, title: "Deleted", start_at: future(1), end_at: future(1), context_code: "user_7", workflow_state: "deleted" },
        ]
      : []);
  }

  m = url.pathname.match(/^\/api\/v1\/courses\/(\d+)\/tabs$/);
  if (m) return json([]);

  res.writeHead(404); res.end("{}");
});

let port = 0;
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as { port: number }).port;
  process.env.CANVAS_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.CANVAS_TOKEN = "test-token";
  process.env.TZ = "America/New_York";
});
afterAll(() => server.close());

describe("favoriteCourses", () => {
  it("keeps only starred courses and counts the rest", () => {
    const r = favoriteCourses([{ is_favorite: true }, { is_favorite: false }, {}]);
    expect(r).toEqual({ visible: [{ is_favorite: true }], hidden: 2, favoritesSet: true });
  });

  it("treats 'nothing starred' as 'everything visible', like Canvas does", () => {
    const all = [{ is_favorite: false }, {}];
    expect(favoriteCourses(all)).toEqual({ visible: all, hidden: 0, favoritesSet: false });
    expect(favoriteCourses([])).toEqual({ visible: [], hidden: 0, favoritesSet: false });
  });
});

describe("runSync against mock Canvas", () => {
  it("survives pagination, a rate-limit 403, and >10 context codes", async () => {
    const report = await runSync({ extract: false });
    expect(report.courses).toBe(11); // 12 minus the date-restricted one
    expect(contextCodeMax).toBeLessThanOrEqual(10);
    expect(report.warnings.filter((w) => !w.startsWith("ANTHROPIC"))).toEqual([]);
    expect(getPref("me_name")).toBe("Test Student");
  });

  it("classifies assignments correctly", () => {
    const rows = db().prepare("SELECT id, submitted, missing, due_at FROM assignments WHERE course_id = 101 ORDER BY id").all() as Array<{ id: number; submitted: number; missing: number; due_at: string | null }>;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[1]).toBeUndefined();                 // unpublished skipped
    expect(byId[2].due_at).toBeNull();               // kept, no due date
    expect(byId[3].missing).toBe(0);                 // on_paper exam is not "missing"
    expect(byId[4].missing).toBe(1);                 // past due, no submission → missing (and confirmed by Canvas)
    expect(byId[5].submitted).toBe(1);               // excused counts as done
    expect(byId[5].missing).toBe(0);
    expect(byId[6].submitted).toBe(1);               // graded quiz without submitted_at
    expect(byId[7].missing).toBe(0);
  });

  it("keeps announcements with null posted_at and drops deleted calendar events", () => {
    const anns = db().prepare("SELECT id, posted_at FROM announcements ORDER BY id").all() as Array<{ id: number; posted_at: string | null }>;
    expect(anns.map((a) => a.id)).toEqual([501, 502]);
    const evts = db().prepare("SELECT id FROM calendar_events").all() as Array<{ id: number }>;
    expect(evts.map((e) => e.id)).toEqual([800]);
  });

  it("marks syllabus availability per course and records the instructor", () => {
    const c111 = db().prepare("SELECT syllabus_available, instructor_user_id FROM courses WHERE id = 111").get() as { syllabus_available: number; instructor_user_id: number };
    expect(c111.syllabus_available).toBe(0);
    expect(c111.instructor_user_id).toBe(9111);
    const c101 = db().prepare("SELECT syllabus_available FROM courses WHERE id = 101").get() as { syllabus_available: number };
    expect(c101.syllabus_available).toBe(1);
  });

  it("removes a course (and its assignments/announcements) after the student drops it", async () => {
    dropCourse101 = true;
    await runSync({ extract: false });
    expect(db().prepare("SELECT COUNT(*) n FROM courses WHERE id = 101").get()).toEqual({ n: 0 });
    expect(db().prepare("SELECT COUNT(*) n FROM assignments WHERE course_id = 101").get()).toEqual({ n: 0 });
    expect(db().prepare("SELECT COUNT(*) n FROM announcements WHERE course_id = 101").get()).toEqual({ n: 0 });
  });

  it("syncs only starred courses and counts the rest as hidden", async () => {
    favoriteIds = new Set([102, 103]);
    const report = await runSync({ extract: false });

    expect(report.favoritesSet).toBe(true);
    expect(report.courses).toBe(2);
    expect(report.coursesHidden).toBe(8); // 10 active (101 dropped, 112 date-restricted)
    const ids = (db().prepare("SELECT id FROM courses ORDER BY id").all() as { id: number }[]).map((r) => r.id);
    expect(ids).toEqual([102, 103]);
    expect(getPref("courses_hidden")).toBe("8");
    expect(getPref("courses_total")).toBe("10");
    expect(getPref("favorites_set")).toBe("1");
    expect(db().prepare("SELECT COUNT(*) n FROM assignments WHERE course_id = 102").get()).toEqual({ n: 1 });
  });

  it("purges a course's data (and its orphaned forecasts) when it is un-starred", async () => {
    db().prepare("INSERT INTO forecasts(assignment_id, estimated_hours, difficulty, suggested_start_days_before, updated_at) VALUES(20, 2, 'medium', 2, ?)")
      .run(new Date().toISOString());

    favoriteIds = new Set([103]);
    await runSync({ extract: false });

    expect((db().prepare("SELECT id FROM courses").all() as { id: number }[]).map((r) => r.id)).toEqual([103]);
    expect(db().prepare("SELECT COUNT(*) n FROM assignments WHERE course_id = 102").get()).toEqual({ n: 0 });
    expect(db().prepare("SELECT COUNT(*) n FROM forecasts WHERE assignment_id = 20").get()).toEqual({ n: 0 });
  });

  it("falls back to every course when the student has starred nothing", async () => {
    favoriteIds = null;
    const report = await runSync({ extract: false });

    expect(report.favoritesSet).toBe(false);
    expect(report.courses).toBe(10);
    expect(report.coursesHidden).toBe(0);
    expect(getPref("favorites_set")).toBe("0");
  });

  it("surfaces non-rate-limit HTTP errors as CanvasError with status", async () => {
    await expect(canvasGetAll("/api/v1/nope")).rejects.toBeInstanceOf(CanvasError);
    await expect(canvasGetAll("/api/v1/nope")).rejects.toMatchObject({ status: 404 });
  });
});

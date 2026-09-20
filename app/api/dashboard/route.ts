import { db, courseHasSyllabus, type AssignmentRow, type AnnouncementRow, type CourseRow, type OfficeHoursRow } from "@/lib/db";
import { addDaysUtc, TZ, dayName } from "@/lib/time";
import { convert } from "html-to-text";

export const dynamic = "force-dynamic";

export async function GET() {
  const conn = db();
  const now = new Date().toISOString();
  const week = addDaysUtc(new Date(), 7).toISOString();
  const courses = conn.prepare("SELECT * FROM courses ORDER BY name").all() as CourseRow[];
  const byId = new Map(courses.map((c) => [c.id, c]));
  const label = (id: number) => byId.get(id)?.course_code ?? byId.get(id)?.name ?? String(id);

  const upcoming = (conn
    .prepare("SELECT * FROM assignments WHERE submitted = 0 AND due_at >= ? AND due_at <= ? ORDER BY due_at")
    .all(now, week) as AssignmentRow[]).map((a) => ({ id: a.id, name: a.name, course: label(a.course_id), due_at: a.due_at, points: a.points_possible, url: a.html_url }));
  const missing = (conn
    .prepare("SELECT * FROM assignments WHERE missing = 1 AND submitted = 0 ORDER BY due_at DESC LIMIT 10")
    .all() as AssignmentRow[]).map((a) => ({ id: a.id, name: a.name, course: label(a.course_id), due_at: a.due_at, points: a.points_possible, url: a.html_url }));
  const announcements = (conn
    .prepare("SELECT * FROM announcements ORDER BY posted_at DESC LIMIT 8")
    .all() as AnnouncementRow[]).map((a) => ({
      id: a.id, title: a.title, course: label(a.course_id), posted_at: a.posted_at, url: a.html_url,
      text: convert(a.message ?? "", { wordwrap: false }).slice(0, 240),
      actions: a.actions ? JSON.parse(a.actions) : null,
    }));
  const officeHours = (conn.prepare("SELECT * FROM office_hours ORDER BY day_of_week, start_time").all() as OfficeHoursRow[]).map((o) => ({
    ...o, course: label(o.course_id), day: dayName(o.day_of_week),
  }));

  return Response.json({
    timezone: TZ(),
    courses: courses.map((c) => ({
      id: c.id, code: c.course_code, name: c.name, instructor: c.instructor_name,
      syllabus: courseHasSyllabus(c), syllabusSource: c.syllabus_source, latePolicy: c.late_policy,
    })),
    upcoming, missing, announcements, officeHours,
  });
}

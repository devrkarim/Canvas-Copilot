/**
 * GET /api/courses/:id — everything known about one course, including the full
 * syllabus text. The dashboard only ever showed a two-line snippet; this is the
 * endpoint behind the course detail page.
 */
import { db, courseHasSyllabus, type CourseRow, type OfficeHoursRow } from "@/lib/db";
import { canvasBaseUrl } from "@/lib/canvas/client";
import { dayName, TZ } from "@/lib/time";

export const dynamic = "force-dynamic";

interface Weight { name: string; percent: number }
interface Exam { name: string; date: string | null; notes: string | null }

/** Extracted JSON columns are model output — never assume they parse or match. */
function parseList<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const courseId = Number(id);
  if (!Number.isInteger(courseId) || courseId <= 0) {
    return Response.json({ error: "invalid course id" }, { status: 400 });
  }

  const conn = db();
  const course = conn.prepare("SELECT * FROM courses WHERE id = ?").get(courseId) as CourseRow | undefined;
  if (!course) {
    return Response.json({ error: "Course not found. It may not be starred in Canvas — star it and re-sync." }, { status: 404 });
  }

  const officeHours = (
    conn.prepare("SELECT * FROM office_hours WHERE course_id = ? ORDER BY day_of_week, start_time").all(courseId) as OfficeHoursRow[]
  ).map((o) => ({ ...o, day: dayName(o.day_of_week) }));

  const base = canvasBaseUrl();
  return Response.json({
    timezone: TZ(),
    id: course.id,
    code: course.course_code,
    name: course.name,
    term: course.term_name,
    instructor: course.instructor_name,
    instructorEmail: course.instructor_email,
    canvasUrl: base ? `${base}/courses/${course.id}` : null,
    canvasSyllabusUrl: base ? `${base}/courses/${course.id}/assignments/syllabus` : null,
    syllabus: {
      readable: courseHasSyllabus(course),
      source: course.syllabus_source,
      text: course.syllabus_text,
      extractedAt: course.syllabus_extracted_at,
    },
    latePolicy: course.late_policy,
    gradingWeights: parseList<Weight>(course.grading_weights),
    examDates: parseList<Exam>(course.exam_dates),
    officeHours,
  });
}

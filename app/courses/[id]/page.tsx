"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Markdown } from "../../components/Markdown";
import { Card, Empty, Pill } from "../../components/ui";

interface CourseDetail {
  timezone: string;
  id: number;
  code: string | null;
  name: string;
  term: string | null;
  instructor: string | null;
  instructorEmail: string | null;
  canvasUrl: string | null;
  canvasSyllabusUrl: string | null;
  syllabus: {
    readable: boolean;
    source: "html" | "pdf" | "link_only" | "none" | null;
    text: string | null;
    extractedAt: string | null;
  };
  latePolicy: string | null;
  gradingWeights: Array<{ name: string; percent: number }>;
  examDates: Array<{ name: string; date: string | null; notes: string | null }>;
  officeHours: Array<{ id: number; instructor: string; day: string; start_time: string; end_time: string; location: string | null; modality: string | null }>;
}

export default function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/courses/${id}`)
      .then(async (r) => ({ ok: r.ok, body: await r.json() }))
      .then(({ ok, body }) => {
        if (!alive) return;
        if (ok) setCourse(body);
        else setError(body.error ?? "Could not load this course.");
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => { alive = false; };
  }, [id]);

  if (error) {
    return (
      <div className="space-y-4">
        <Back />
        <Card title="Course unavailable"><Empty>{error}</Empty></Card>
      </div>
    );
  }
  if (!course) return <div className="space-y-4"><Back /><p className="text-sm text-zinc-500">Loading…</p></div>;

  const { syllabus } = course;

  return (
    <div className="space-y-4">
      <Back />

      <div className="page-heading">
        <div>
        {course.code && <p className="eyebrow">{course.code}</p>}
        <h1>{course.name}</h1>
        <p className="text-sm text-zinc-500 mt-1">
          {course.instructor ? (
            course.instructorEmail
              ? <a href={`mailto:${course.instructorEmail}`} className="underline">{course.instructor}</a>
              : course.instructor
          ) : "Instructor unknown"}
          {course.term ? ` · ${course.term}` : ""}
          {course.canvasUrl && <> · <a href={course.canvasUrl} target="_blank" rel="noreferrer" className="underline">Open in Canvas →</a></>}
        </p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Grading weights">
          {course.gradingWeights.length === 0 ? <Empty>None found in the syllabus.</Empty> : (
            <ul className="space-y-2 text-sm">
              {course.gradingWeights.map((w, i) => (
                <li key={i}>
                  <div className="flex justify-between gap-2">
                    <span>{w.name}</span>
                    <span className="text-zinc-500 tabular-nums">{w.percent}%</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-xs bg-zinc-100 dark:bg-zinc-800">
                    <div className="h-full rounded-xs bg-teal-600 dark:bg-teal-400" style={{ width: `${Math.min(100, Math.max(0, w.percent))}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Exams">
          {course.examDates.length === 0 ? <Empty>No exam dates found in the syllabus.</Empty> : (
            <ul className="space-y-2 text-sm">
              {course.examDates.map((e, i) => (
                <li key={i}>
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">{e.name}</span>
                    <span className="text-zinc-500 whitespace-nowrap">{e.date ?? "date TBD"}</span>
                  </div>
                  {e.notes && <div className="text-zinc-500">{e.notes}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Office hours">
        {course.officeHours.length === 0 ? <Empty>None found in the syllabus.</Empty> : (
          <ul className="space-y-1.5 text-sm">
            {course.officeHours.map((o) => (
              <li key={o.id}>
                <Pill tone="blue">{o.day}</Pill> {o.instructor}: {o.start_time}–{o.end_time}
                {o.location && (
                  <> · {/^https?:\/\//.test(o.location)
                    ? <a href={o.location} target="_blank" rel="noreferrer" className="underline break-all">{o.location}</a>
                    : o.location}</>
                )}
                {o.modality && o.modality !== "unknown" ? ` (${o.modality.replace("_", " ")})` : ""}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Late policy">
        {course.latePolicy
          ? <p className="text-sm whitespace-pre-wrap">{course.latePolicy}</p>
          : <Empty>No late policy found in the syllabus.</Empty>}
      </Card>

      <Card title="Syllabus" action={<SyllabusBadge source={syllabus.source} />}>
        {!syllabus.readable || !syllabus.text ? (
          <Empty>
            {syllabus.source === "link_only"
              ? "The Syllabus tab is only an attachment that couldn't be read (wrong file type, locked, or too large)."
              : "This course has no Syllabus tab content in Canvas."}
            {course.canvasSyllabusUrl && <> <a href={course.canvasSyllabusUrl} target="_blank" rel="noreferrer" className="underline">See it in Canvas →</a></>}
          </Empty>
        ) : (
          <>
            {/* PDF transcriptions come back as markdown; tab text is plain, so keep its line breaks. */}
            {syllabus.source === "pdf"
              ? <div className="prose-chat text-sm"><Markdown>{syllabus.text}</Markdown></div>
              : <div className="text-sm whitespace-pre-wrap">{syllabus.text}</div>}
            <p className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 text-xs text-zinc-500">
              {syllabus.source === "pdf"
                ? "Read from the PDF attached to this course's Syllabus tab."
                : "Read from this course's Syllabus tab."}
              {course.canvasSyllabusUrl && <> <a href={course.canvasSyllabusUrl} target="_blank" rel="noreferrer" className="underline">View the original →</a></>}
            </p>
          </>
        )}
      </Card>
    </div>
  );
}

function Back() {
  return <Link href="/" className="text-sm text-zinc-500 hover:underline">← Dashboard</Link>;
}

function SyllabusBadge({ source }: { source: CourseDetail["syllabus"]["source"] }) {
  if (source === "pdf") return <Pill tone="green">from PDF</Pill>;
  if (source === "html") return <Pill tone="green">from Syllabus tab</Pill>;
  if (source === "link_only") return <Pill tone="amber">attachment unreadable</Pill>;
  return <Pill>no syllabus</Pill>;
}

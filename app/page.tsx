"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Markdown } from "./components/Markdown";
import { Button, Card, Empty, Pill, fmt } from "./components/ui";

interface Status {
  canvasConfigured: boolean; llmConfigured: boolean; discordConfigured: boolean; timezone: string;
  me: string | null; lastSync: string | null;
  courseScope: { favoritesSet: boolean; hidden: number; total: number; canvasCoursesUrl: string | null };
  counts: { courses: number; assignments: number; announcements: number; officeHours: number; pendingProposals: number; missing: number };
}
interface Dash {
  timezone: string;
  courses: Array<{ id: number; code: string | null; name: string; instructor: string | null; syllabus: boolean; syllabusSource: "html" | "pdf" | "link_only" | "none" | null; latePolicy: string | null }>;
  upcoming: Array<{ id: number; name: string; course: string; due_at: string | null; points: number | null; url: string | null }>;
  missing: Array<{ id: number; name: string; course: string; due_at: string | null; points: number | null; url: string | null }>;
  announcements: Array<{ id: number; title: string; course: string; posted_at: string | null; text: string; url: string | null; actions: { tldr?: string; actions?: Array<{ kind: string; summary: string }> } | null }>;
  officeHours: Array<{ id: number; course: string; instructor: string; day: string; start_time: string; end_time: string; location: string | null }>;
}
interface Briefing { id: number; content: string; created_at: string; delivered_to: string | null }

export default function Dashboard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [dash, setDash] = useState<Dash | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(0);

  const load = useCallback(() => {
    return Promise.all([
      fetch("/api/status").then((r) => r.json()),
      fetch("/api/dashboard").then((r) => r.json()),
      fetch("/api/briefing").then((r) => r.json()),
    ]).then(([s, d, b]) => {
      setStatus(s); setDash(d); setBriefing(b); setNowMs(Date.now());
    });
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/status").then((r) => r.json()),
      fetch("/api/dashboard").then((r) => r.json()),
      fetch("/api/briefing").then((r) => r.json()),
    ]).then(([s, d, b]) => {
      if (!alive) return;
      setStatus(s); setDash(d); setBriefing(b); setNowMs(Date.now());
    });
    return () => { alive = false; };
  }, []);

  async function sync() {
    setBusy("sync"); setMsg(null);
    const r = await fetch("/api/sync", { method: "POST" });
    const j = await r.json();
    const scope = !j.favoritesSet
      ? `Synced all ${j.courses} courses (none are starred in Canvas)`
      : `Synced ${j.courses} starred course${j.courses === 1 ? "" : "s"}${j.coursesHidden ? `, skipped ${j.coursesHidden} un-starred` : ""}`;
    setMsg(r.ok
      ? `${scope}, ${j.assignments} assignments, ${j.announcements} announcements (${j.newAnnouncements} new), ${j.calendarEvents} events. ${j.syllabiExtracted} syllabi read${j.syllabiFromPdf ? ` (${j.syllabiFromPdf} from PDF)` : ""}, ${j.proposalsCreated} proposals created.${j.warnings?.length ? ` Warnings: ${j.warnings.join("; ")}` : ""}`
      : `Sync failed: ${j.error}`);
    setBusy(null); load();
  }

  async function sendBriefing() {
    setBusy("briefing"); setMsg(null);
    const r = await fetch("/api/briefing", { method: "POST" });
    const j = await r.json();
    setMsg(r.ok ? `Briefing generated${j.delivered?.length ? ` and sent to ${j.delivered.join(", ")}` : " (no delivery channel configured — shown below)"}.` : `Briefing failed: ${j.error}`);
    setBusy(null); load();
  }

  const tz = status?.timezone;
  const today = new Date(nowMs); const tomorrow = new Date(nowMs + 36 * 3600 * 1000);
  const dueSoon = dash?.upcoming.filter((a) => a.due_at && new Date(a.due_at) <= tomorrow) ?? [];
  const later = dash?.upcoming.filter((a) => a.due_at && new Date(a.due_at) > tomorrow) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">
          {status?.me ? `Hi, ${status.me.split(" ")[0]}` : "Dashboard"}
        </h1>
        <span className="text-sm text-zinc-500">
          {status?.lastSync ? `Last sync ${fmt(status.lastSync, tz)}` : "Not synced yet"}
        </span>
        <div className="ml-auto flex gap-2">
          <Button onClick={sync} disabled={busy !== null || !status?.canvasConfigured}>{busy === "sync" ? "Syncing…" : "Sync Canvas"}</Button>
          <Button variant="ghost" onClick={sendBriefing} disabled={busy !== null || !status?.llmConfigured}>{busy === "briefing" ? "Writing…" : "Send briefing now"}</Button>
        </div>
      </div>

      {status && (!status.canvasConfigured || !status.llmConfigured) && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 p-3 text-sm">
          {!status.canvasConfigured && <p>⚠️ Set <code>CANVAS_BASE_URL</code> and <code>CANVAS_TOKEN</code> in <code>.env.local</code>, then restart.</p>}
          {!status.llmConfigured && <p>⚠️ Set <code>ANTHROPIC_API_KEY</code> in <code>.env.local</code> to enable chat, extraction and briefings.</p>}
        </div>
      )}
      {msg && <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 text-sm">{msg}</div>}

      {status && status.counts.pendingProposals > 0 && (
        <Link href="/proposals" className="block rounded-lg border border-blue-300 bg-blue-50 dark:bg-blue-950 dark:border-blue-800 p-3 text-sm">
          🔔 <b>{status.counts.pendingProposals}</b> proposed change{status.counts.pendingProposals === 1 ? "" : "s"} waiting for your approval →
        </Link>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Due today & tomorrow">
          {dueSoon.length === 0 ? <Empty>Nothing due in the next 36 hours.</Empty> : (
            <ul className="space-y-2 text-sm">
              {dueSoon.map((a) => (
                <li key={a.id} className="flex justify-between gap-2">
                  <span><Pill tone="red">{a.course}</Pill> <a href={a.url ?? "#"} target="_blank" className="hover:underline">{a.name}</a></span>
                  <span className="text-zinc-500 whitespace-nowrap">{fmt(a.due_at, tz)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Later this week">
          {later.length === 0 ? <Empty>Nothing else due this week.</Empty> : (
            <ul className="space-y-2 text-sm">
              {later.map((a) => (
                <li key={a.id} className="flex justify-between gap-2">
                  <span><Pill>{a.course}</Pill> <a href={a.url ?? "#"} target="_blank" className="hover:underline">{a.name}</a></span>
                  <span className="text-zinc-500 whitespace-nowrap">{fmt(a.due_at, tz)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Missing" action={dash?.missing.length ? <Link href="/chat?q=Draft a message to my professor about my missing assignments" className="text-sm underline">Draft a message →</Link> : undefined}>
          {!dash?.missing.length ? <Empty>No missing assignments. 🎉</Empty> : (
            <ul className="space-y-2 text-sm">
              {dash.missing.map((a) => (
                <li key={a.id} className="flex justify-between gap-2">
                  <span><Pill tone="amber">{a.course}</Pill> {a.name}</span>
                  <span className="text-zinc-500 whitespace-nowrap">was due {fmt(a.due_at, tz)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Office hours (from syllabi)">
          {!dash?.officeHours.length ? <Empty>No office hours extracted yet — sync with a syllabus that lists them.</Empty> : (
            <ul className="space-y-1.5 text-sm">
              {dash.officeHours.map((o) => (
                <li key={o.id}><Pill tone="blue">{o.course}</Pill> {o.instructor}: {o.day} {o.start_time}–{o.end_time}{o.location ? ` · ${o.location}` : ""}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Recent announcements">
        {!dash?.announcements.length ? <Empty>No announcements synced.</Empty> : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 text-sm">
            {dash.announcements.map((a) => (
              <li key={a.id} className="py-2">
                <div className="flex justify-between gap-2">
                  <span><Pill>{a.course}</Pill> <a href={a.url ?? "#"} target="_blank" className="font-medium hover:underline">{a.title}</a></span>
                  <span className="text-zinc-500 whitespace-nowrap">{fmt(a.posted_at, tz)}</span>
                </div>
                <p className="text-zinc-600 dark:text-zinc-400 mt-1">{a.actions?.tldr ?? a.text}</p>
                {a.actions?.actions?.map((x, i) => (
                  <p key={i} className="mt-1"><Pill tone="green">{x.kind.replaceAll("_", " ")}</Pill> <span className="text-zinc-700 dark:text-zinc-300">{x.summary}</span></p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Latest briefing${briefing ? ` · ${fmt(briefing.created_at, tz)}` : ""}`}>
        {!briefing ? <Empty>No briefing yet. Click “Send briefing now” or wait for the {process.env.NEXT_PUBLIC_BRIEFING_HOUR ?? "7:00"} schedule.</Empty> : (
          <div className="prose-chat text-sm"><Markdown>{briefing.content}</Markdown></div>
        )}
      </Card>

      <Card title="Courses">
        {!dash?.courses.length ? <Empty>No courses synced.</Empty> : (
          <ul className="grid sm:grid-cols-2 gap-2 text-sm">
            {dash.courses.map((c) => (
              <li key={c.id}>
                <Link href={`/courses/${c.id}`}
                  className="block h-full rounded-lg border border-zinc-100 dark:border-zinc-800 p-2 hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <div className="font-medium">{c.code ?? ""} {c.name}</div>
                  <div className="text-zinc-500">{c.instructor ?? "instructor unknown"} · {syllabusLabel(c.syllabus, c.syllabusSource)}</div>
                  {/* Teaser only — the full policy and syllabus live on the course page. */}
                  {c.latePolicy && <div className="text-zinc-600 dark:text-zinc-400 mt-1 line-clamp-2">Late policy: {c.latePolicy}</div>}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <CourseScope status={status} shown={dash?.courses.length ?? 0} />
      </Card>

      <p className="text-xs text-zinc-400">Today is {today.toLocaleDateString("en-US", { timeZone: tz, dateStyle: "full" })} · timezone {tz}</p>
    </div>
  );
}

/** Says what we actually hold, not just whether the Syllabus tab has any HTML in it. */
function syllabusLabel(readable: boolean, source: Dash["courses"][number]["syllabusSource"]): string {
  if (source === "pdf") return "syllabus ✓ (from PDF)";
  if (source === "link_only") return "syllabus attached, unreadable";
  return readable ? "syllabus ✓" : "no syllabus tab";
}

/**
 * The one place that explains the app's scope: Canvas Copilot reads only the
 * courses starred on the Canvas dashboard. Sits under the course list as a quiet
 * footnote rather than a banner, so it stays true without nagging.
 */
function CourseScope({ status, shown }: { status: Status | null; shown: number }) {
  if (!status?.lastSync) return null;
  const { favoritesSet, hidden, canvasCoursesUrl, total } = status.courseScope;
  const star = <span className="text-amber-500">★</span>;
  const link = canvasCoursesUrl && (
    <a href={canvasCoursesUrl} target="_blank" rel="noreferrer" className="underline hover:text-zinc-600 dark:hover:text-zinc-300">
      Star courses in Canvas →
    </a>
  );

  return (
    <p className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 text-xs text-zinc-500">
      {!favoritesSet ? (
        <>
          {star} You haven&apos;t starred any courses in Canvas, so all {total} are included.
          Canvas Copilot follows your stars — star the ones you care about to narrow this down. {link}
        </>
      ) : hidden > 0 ? (
        <>
          {star} Showing your {shown} starred Canvas course{shown === 1 ? "" : "s"} · {hidden} hidden.
          Canvas Copilot only reads starred courses. {link}
        </>
      ) : (
        <>
          {star} Showing all {shown} of your starred Canvas courses. Canvas Copilot only reads
          starred courses — un-star one in Canvas and it disappears here on the next sync. {link}
        </>
      )}
    </p>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Empty, Pill, fmt } from "../components/ui";

interface Forecast {
  weekStart: string; weekEnd: string;
  tasks: Array<{ assignmentId: number; name: string; course: string; dueAt: string | null; estimatedHours: number; difficulty: string; scheduledHours: number; unscheduledHours: number; reasoning: string | null }>;
  blocks: Array<{ assignmentId: number; assignmentName: string; courseCode: string; startAt: string; endAt: string; hours: number }>;
  hoursPerDay: Array<{ date: string; label: string; hours: number; freeHours: number }>;
  totalEstimatedHours: number; totalFreeHours: number; overloaded: boolean;
}

export default function ForecastPage() {
  const [week, setWeek] = useState(0);
  const [data, setData] = useState<(Forecast & { week: number }) | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const loading = recomputing || !data || data.week !== week;

  const fetchWeek = useCallback((w: number) => {
    return fetch(`/api/forecast?week=${w}`).then(async (r) => {
      const j = await r.json();
      if (r.ok) setData({ ...j, week: w }); else setMsg(j.error);
    });
  }, []);
  useEffect(() => {
    let alive = true;
    fetch(`/api/forecast?week=${week}`).then(async (r) => {
      const j = await r.json();
      if (!alive) return;
      if (r.ok) setData({ ...j, week }); else setMsg(j.error);
    });
    return () => { alive = false; };
  }, [week]);

  async function load() {
    setRecomputing(true); setMsg(null);
    await fetchWeek(week);
    setRecomputing(false);
  }

  async function addToCalendar() {
    if (!data) return;
    const r = await fetch("/api/forecast/propose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blocks: data.blocks }) });
    const j = await r.json();
    setMsg(r.ok ? `${j.created} study block${j.created === 1 ? "" : "s"} proposed — approve them in Proposals.` : j.error);
  }

  const maxH = Math.max(1, ...(data?.hoursPerDay.map((d) => Math.max(d.hours, d.freeHours)) ?? [1]));
  const byDay = new Map<string, Forecast["blocks"]>();
  for (const b of data?.blocks ?? []) {
    const k = new Date(b.startAt).toDateString();
    byDay.set(k, [...(byDay.get(k) ?? []), b]);
  }

  return (
    <div className="space-y-4">
      <div className="page-heading">
        <div><p className="eyebrow">Make room to focus</p><h1>Your week</h1><p className="text-sm text-zinc-500 dark:text-zinc-400 mt-3">See your workload. Find time to study.</p></div>
        <div className="flex gap-1 text-sm">
          {[0, 1, 2].map((w) => (
            <button key={w} aria-pressed={week === w} onClick={() => setWeek(w)} className={`px-3 py-2.5 rounded-md ${week === w ? "bg-teal-700 text-white dark:bg-teal-400 dark:text-zinc-950" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
              {w === 0 ? "This week" : w === 1 ? "Next week" : "In 2 weeks"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={load} disabled={loading}>{loading ? "Estimating…" : "Refresh"}</Button>
          <Button onClick={addToCalendar} disabled={loading || !data?.blocks.length}>Propose study plan</Button>
        </div>
      </div>
      {msg && <div className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3 text-sm">{msg}</div>}

      {data && (
        <>
          <div className={`rounded-md p-3 text-sm border ${data.overloaded ? "border-red-300 bg-red-50 dark:bg-red-950 dark:border-red-800" : "border-green-300 bg-green-50 dark:bg-green-950 dark:border-green-800"}`}>
            <p className="font-medium mb-1">{new Date(data.weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {new Date(data.weekEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
            <b>{data.totalEstimatedHours}h</b> estimated · <b>{data.totalFreeHours}h</b> available.
            <p className="mt-1">{data.overloaded ? "A busy week. Consider starting earlier." : "Your study plan fits."}</p>
          </div>

          <Card title="Daily study time" action={<span className="text-xs text-zinc-500"><span className="text-blue-600 dark:text-blue-400">Blue: planned</span> · Gray: available · Red: over capacity</span>}>
            <div className="grid grid-cols-7 gap-2 items-end h-40">
              {data.hoursPerDay.map((d) => (
                <div key={d.date} className="flex flex-col items-center justify-end h-full gap-1">
                  <div className="w-full flex items-end justify-center gap-1 h-full">
                    <div className="w-4 bg-zinc-300 dark:bg-zinc-700 rounded-t" style={{ height: `${(d.freeHours / maxH) * 100}%` }} title={`${d.freeHours}h free`} />
                    <div className={`w-4 rounded-t ${d.hours > d.freeHours ? "bg-red-500" : "bg-blue-500"}`} style={{ height: `${(d.hours / maxH) * 100}%` }} title={`${d.hours}h planned`} />
                  </div>
                  <div className="text-[11px] text-zinc-500 text-center leading-tight">{d.label.split(",")[0]}<br />{d.hours}h</div>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            <Card title="Assignments">
              {data.tasks.length === 0 ? <Empty>Nothing due in this window.</Empty> : (
                <ul className="space-y-2 text-sm">
                  {data.tasks.map((t) => (
                    <li key={t.assignmentId} className="rounded-md border border-zinc-100 dark:border-zinc-800 p-2">
                      <div className="flex flex-col gap-2">
                        <span><Pill>{t.course}</Pill> {t.name}</span>
                        <span className="text-zinc-500 whitespace-nowrap">{fmt(t.dueAt)}</span>
                      </div>
                      <div className="text-zinc-600 dark:text-zinc-400 mt-1">
                        ~{t.estimatedHours}h · <Pill tone={t.difficulty === "heavy" ? "red" : t.difficulty === "moderate" ? "amber" : "green"}>{t.difficulty}</Pill>
                        {t.unscheduledHours > 0 && <span className="text-red-600 dark:text-red-400"> · {t.unscheduledHours}h unscheduled</span>}
                      </div>
                      {t.reasoning && <details className="text-xs text-zinc-500 dark:text-zinc-400 mt-2"><summary>About this estimate</summary><p className="mt-1">{t.reasoning}</p></details>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Study plan">
              {data.blocks.length === 0 ? <Empty>No study blocks available for this week.</Empty> : (
                <div className="space-y-3 text-sm">
                  {[...byDay.entries()].map(([day, blocks]) => (
                    <div key={day}>
                      <div className="font-medium text-zinc-700 dark:text-zinc-300">{new Date(blocks[0].startAt).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</div>
                      <ul className="mt-1 space-y-1">
                        {blocks.map((b, i) => (
                          <li key={i} className="flex flex-col sm:flex-row gap-2 py-2">
                            <span className="text-zinc-500 dark:text-zinc-400 sm:w-36 shrink-0 whitespace-nowrap">
                              {new Date(b.startAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}–{new Date(b.endAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                            </span>
                            <span><Pill tone="blue">{b.courseCode}</Pill> {b.assignmentName} <span className="text-zinc-400">({b.hours}h)</span></span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Empty, Pill, fmt } from "../components/ui";

interface Proposal {
  id: number;
  type: "calendar_create" | "calendar_update" | "message";
  payload: Record<string, unknown>;
  rationale: string;
  source: string;
  status: "pending" | "approved" | "rejected" | "failed";
  result: Record<string, unknown> | null;
  created_at: string;
}

const TYPE_LABEL = { calendar_create: "Add to calendar", calendar_update: "Update calendar", message: "Send message" } as const;
const TYPE_TONE = { calendar_create: "blue", calendar_update: "amber", message: "green" } as const;

export default function ProposalsPage() {
  const [items, setItems] = useState<Proposal[]>([]);
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const [busy, setBusy] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<number, { subject: string; body: string }>>({});
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    return fetch(`/api/proposals${tab === "pending" ? "?status=pending" : ""}`).then((r) => r.json()).then(setItems);
  }, [tab]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/proposals${tab === "pending" ? "?status=pending" : ""}`).then((r) => r.json()).then((j) => { if (alive) setItems(j); });
    return () => { alive = false; };
  }, [tab]);

  async function act(p: Proposal, action: "approve" | "reject") {
    setBusy(p.id); setErr(null);
    const edit = edits[p.id];
    const body: { action: string; payload?: unknown } = { action };
    if (action === "approve" && p.type === "message" && edit) body.payload = { subject: edit.subject, body: edit.body };
    const r = await fetch(`/api/proposals/${p.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) setErr((await r.json()).error ?? "failed");
    setBusy(null); load();
  }

  return (
    <div className="space-y-4">
      <div className="page-heading">
        <div><p className="eyebrow">You decide</p><h1>Proposals</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-3">Review changes before they reach Canvas.</p></div>
        <div className="ml-auto flex gap-1 text-sm">
          {(["pending", "all"] as const).map((t) => (
            <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)} className={`px-4 py-2.5 rounded-md ${tab === t ? "bg-teal-700 text-white dark:bg-teal-400 dark:text-zinc-950" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
              {t === "pending" ? "Pending" : "History"}
            </button>
          ))}
        </div>
      </div>
      {err && <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950 dark:border-red-800 p-3 text-sm">{err}</div>}

      {items.length === 0 ? <Card title={tab === "pending" ? "All caught up" : "History"}><Empty>{tab === "pending" ? "No changes to review. Sync Canvas or ask in Chat." : "No past proposals."}</Empty></Card> : (
        <div className="space-y-3">
          {items.map((p) => (
            <Card key={p.id} title={`#${p.id} · ${TYPE_LABEL[p.type]}`} action={
              <div className="flex items-center gap-2">
                <Pill tone={TYPE_TONE[p.type]}>{p.type === "message" ? "Message" : "Calendar"}</Pill>
                {p.status !== "pending" && <Pill tone={p.status === "approved" ? "green" : p.status === "failed" ? "red" : "zinc"}>{p.status}</Pill>}
              </div>
            }>
              <p className="text-sm mb-3">{p.rationale}</p>

              {p.type !== "message" ? (
                <div className="text-sm rounded-md bg-zinc-50 dark:bg-zinc-800/60 p-3 space-y-1">
                  <div><b>{String(p.payload.title)}</b></div>
                  <div className="text-zinc-600 dark:text-zinc-400">
                    {fmt(String(p.payload.start_at))} → {fmt(String(p.payload.end_at))}
                    {p.payload.location_name ? ` · ${String(p.payload.location_name)}` : ""}
                    {p.payload.duplicate ? ` · repeats weekly ×${(p.payload.duplicate as { count: number }).count + 1}` : ""}
                  </div>
                  {p.payload.description ? <div className="text-zinc-500">{String(p.payload.description)}</div> : null}
                </div>
              ) : (
                <div className="text-sm space-y-2">
                  <div className="text-zinc-500">To: {String(p.payload.recipient_name ?? "instructor")} (Canvas Inbox)</div>
                  {p.status === "pending" ? (
                    <>
                      <input
                        aria-label="Message subject"
                        className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1"
                        value={edits[p.id]?.subject ?? String(p.payload.subject)}
                        onChange={(e) => setEdits((s) => ({ ...s, [p.id]: { subject: e.target.value, body: s[p.id]?.body ?? String(p.payload.body) } }))}
                      />
                      <textarea
                        aria-label="Message body"
                        rows={8}
                        className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 font-sans"
                        value={edits[p.id]?.body ?? String(p.payload.body)}
                        onChange={(e) => setEdits((s) => ({ ...s, [p.id]: { subject: s[p.id]?.subject ?? String(p.payload.subject), body: e.target.value } }))}
                      />
                    </>
                  ) : (
                    <div className="rounded-md bg-zinc-50 dark:bg-zinc-800/60 p-3 whitespace-pre-wrap"><b>{String(p.payload.subject)}</b>{"\n\n"}{String(p.payload.body)}</div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 mt-4">
                {p.status === "pending" ? (
                  <>
                    <Button onClick={() => act(p, "approve")} disabled={busy === p.id}>{busy === p.id ? "Working…" : p.type === "message" ? "Send" : "Approve"}</Button>
                    <Button variant="danger" onClick={() => act(p, "reject")} disabled={busy === p.id}>Reject</Button>
                  </>
                ) : p.result?.error ? (
                  <span className="text-sm text-red-600">{String(p.result.error)}</span>
                ) : p.result?.html_url ? (
                  <a className="text-sm underline" href={String(p.result.html_url)} target="_blank">View in Canvas</a>
                ) : null}
                <span className="w-full sm:w-auto sm:ml-auto text-xs text-zinc-500 dark:text-zinc-400">{fmt(p.created_at)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Markdown } from "../components/Markdown";
import { Button } from "../components/ui";

/** What we render. `history` is the raw API message list we replay to the server. */
interface Turn { role: "user" | "assistant"; text: string; tools: string[]; error?: string }

const SUGGESTIONS = [
  "What's due this week?",
  "What should I work on first?",
  "Any course updates?",
  "When are office hours?",
  "How heavy is next week?",
  "Draft a message about missed work",
];

export default function ChatPage() {
  return (
    <Suspense>
      <Chat />
    </Suspense>
  );
}

function Chat() {
  const params = useSearchParams();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [history, setHistory] = useState<unknown[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);

  useEffect(() => {
    if (turns.length > 0) bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  useEffect(() => {
    const q = params.get("q");
    if (q && !seeded.current) {
      seeded.current = true;
      send(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    const nextHistory = [...history, { role: "user", content: q }];
    setTurns((t) => [...t, { role: "user", text: q, tools: [] }, { role: "assistant", text: "", tools: [] }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextHistory }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(j.error ?? "request failed");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let appended: unknown[] | null = null;

      const update = (fn: (t: Turn) => Turn) =>
        setTurns((all) => {
          const copy = [...all];
          copy[copy.length - 1] = fn(copy[copy.length - 1]);
          return copy;
        });

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const ev = raw.match(/^event: (.+)$/m)?.[1];
          const data = raw.match(/^data: (.+)$/m)?.[1];
          if (!ev || !data) continue;
          const payload = JSON.parse(data);
          if (ev === "text") update((t) => ({ ...t, text: t.text + payload.text }));
          else if (ev === "tool") update((t) => ({ ...t, tools: [...t.tools, payload.name] }));
          else if (ev === "history") appended = payload.messages;
          else if (ev === "error") update((t) => ({ ...t, error: payload.message }));
        }
      }
      // Only commit the turn if the server confirmed a complete history; otherwise drop it
      // so the next message doesn't replay a half-finished turn.
      if (appended) setHistory([...nextHistory, ...appended]);
    } catch (e) {
      setTurns((all) => {
        const copy = [...all];
        copy[copy.length - 1] = { ...copy[copy.length - 1], error: (e as Error).message };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-shell flex flex-col">
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {turns.length === 0 && (
          <div className="chat-intro space-y-5">
            <p className="eyebrow">Your course assistant</p>
            <h1>A little help. A clearer plan.</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Ask about deadlines, course updates, or your next step.</p>
            <div className="grid sm:grid-cols-2 gap-3 pt-3">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)}
                  className="suggestion">
                  {s}<span aria-hidden="true" className="float-right text-teal-600 dark:text-teal-300">↗</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`min-w-0 rounded-md px-4 py-2.5 text-sm ${
              t.role === "user"
                ? "max-w-[80%] bg-teal-700 text-white dark:bg-teal-900"
                : "max-w-[92%] bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800"
            }`}>
              {t.tools.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {t.tools.map((name, j) => (
                    <span key={j} className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-mono">
                      {name.replaceAll("_", " ")}
                    </span>
                  ))}
                </div>
              )}
              {t.role === "assistant" ? (
                t.text ? <div className="prose-chat"><Markdown>{t.text}</Markdown></div>
                : !t.error && <span className="text-zinc-400">{t.tools.length ? "Reading…" : "Thinking…"}</span>
              ) : (
                <span className="whitespace-pre-wrap">{t.text}</span>
              )}
              {t.error && <p className="text-red-600 dark:text-red-400 mt-1">{t.error}</p>}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="flex flex-wrap gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-800"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Message to your course assistant"
          placeholder="What can I help with?"
          className="min-w-0 flex-1 rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-sm focus:ring-2 focus:ring-teal-500"
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !input.trim()}>{busy ? "…" : "Send"}</Button>
        {turns.length > 0 && <Button variant="ghost" onClick={() => { setTurns([]); setHistory([]); }}>New chat</Button>}
      </form>
    </div>
  );
}

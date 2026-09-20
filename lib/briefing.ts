/**
 * Daily briefing: the tool runner reads the same tools chat uses and writes
 * a short morning digest, which we store and (optionally) push to Discord.
 */
import { anthropic, betaDefaults, textOf } from "@/lib/llm";
import { readTools, studentContext } from "@/lib/tools";
import { db, nowIso, type BriefingRow } from "@/lib/db";

const SYSTEM = `You are Canvas Copilot, a student's academic assistant. Write today's morning brief.

Rules:
- Use the tools to get real data; never invent courses, assignments or dates.
- Format as Markdown with exactly these sections, in order, omitting a section only if it is empty:
  **Due today / tomorrow**, **Coming up this week**, **Missing**, **New announcements** (last 24h — one line each, note any schedule changes), **Waiting for your approval** (pending proposals), **Today's study blocks**.
- Under 180 words. Bullets, no preamble, no sign-off. Times in the student's timezone.
- No emoji anywhere in the output.
- If something is overdue or the week looks overloaded, say so plainly in one line at the top.`;

export async function buildBriefing(): Promise<BriefingRow> {
  const runner = anthropic().beta.messages.toolRunner({
    ...betaDefaults,
    max_tokens: 16000,
    system: `${SYSTEM}\n\n${studentContext()}`,
    tools: readTools,
    messages: [{ role: "user", content: "Write my morning brief for today." }],
    max_iterations: 12,
  });

  let text = "";
  for await (const message of runner) {
    if (message.stop_reason === "refusal") break;
    text = textOf(message) || text;
  }
  const final = await runner.done();
  text = textOf(final) || text || "_(no content)_";

  const info = db()
    .prepare("INSERT INTO briefings(content, created_at) VALUES(?, ?)")
    .run(text, nowIso());
  return db().prepare("SELECT * FROM briefings WHERE id = ?").get(info.lastInsertRowid) as BriefingRow;
}

export async function deliverBriefing(b: BriefingRow): Promise<string[]> {
  const delivered: string[] = [];
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (webhook) {
    // Discord caps content at 2000 chars.
    const content = `**Morning brief — ${new Date(b.created_at).toLocaleDateString("en-US", { timeZone: process.env.TZ || "America/New_York", weekday: "long", month: "short", day: "numeric" })}**\n\n${b.content}`.slice(0, 1990);
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error(`Discord webhook failed: ${res.status}`);
    delivered.push("discord");
  }
  db().prepare("UPDATE briefings SET delivered_to = ? WHERE id = ?").run(delivered.join(",") || null, b.id);
  return delivered;
}

export function latestBriefing(): BriefingRow | undefined {
  return db().prepare("SELECT * FROM briefings ORDER BY id DESC LIMIT 1").get() as BriefingRow | undefined;
}

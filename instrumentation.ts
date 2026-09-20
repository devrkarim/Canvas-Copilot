/**
 * Runs once at server start: schedules the daily briefing (BRIEFING_CRON, default 07:00).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const cron = (await import("node-cron")).default;
  const { buildBriefing, deliverBriefing } = await import("@/lib/briefing");
  const { runSync } = await import("@/lib/sync");
  const { canvasConfigured } = await import("@/lib/canvas/client");
  const { llmConfigured } = await import("@/lib/llm");

  const expr = process.env.BRIEFING_CRON || "0 7 * * *";
  if (!cron.validate(expr)) {
    console.warn(`[briefing] invalid BRIEFING_CRON "${expr}" — scheduler disabled`);
    return;
  }
  cron.schedule(
    expr,
    async () => {
      if (!canvasConfigured() || !llmConfigured()) return;
      try {
        await runSync();
        const b = await buildBriefing();
        const to = await deliverBriefing(b);
        console.log(`[briefing] sent #${b.id} to ${to.join(",") || "nobody (stored only)"}`);
      } catch (e) {
        console.error("[briefing] failed:", (e as Error).message);
      }
    },
    { timezone: process.env.TZ || "America/New_York" },
  );
  console.log(`[briefing] scheduled "${expr}" (${process.env.TZ || "America/New_York"})`);
}

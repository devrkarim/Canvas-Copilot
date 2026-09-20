import { db, getPref } from "@/lib/db";
import { canvasConfigured } from "@/lib/canvas/client";
import { llmConfigured } from "@/lib/llm";
import { TZ } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET() {
  const conn = db();
  const count = (sql: string) => (conn.prepare(sql).get() as { n: number }).n;
  return Response.json({
    canvasConfigured: canvasConfigured(),
    llmConfigured: llmConfigured(),
    discordConfigured: Boolean(process.env.DISCORD_WEBHOOK_URL),
    timezone: TZ(),
    me: getPref("me_name"),
    lastSync: getPref("last_sync"),
    counts: {
      courses: count("SELECT COUNT(*) n FROM courses"),
      assignments: count("SELECT COUNT(*) n FROM assignments"),
      announcements: count("SELECT COUNT(*) n FROM announcements"),
      officeHours: count("SELECT COUNT(*) n FROM office_hours"),
      pendingProposals: count("SELECT COUNT(*) n FROM proposals WHERE status = 'pending'"),
      missing: count("SELECT COUNT(*) n FROM assignments WHERE missing = 1 AND submitted = 0"),
    },
  });
}

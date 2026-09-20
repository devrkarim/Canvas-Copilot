import { db, getPref } from "@/lib/db";
import { canvasBaseUrl, canvasConfigured } from "@/lib/canvas/client";
import { llmConfigured } from "@/lib/llm";
import { TZ } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function GET() {
  const conn = db();
  const count = (sql: string) => (conn.prepare(sql).get() as { n: number }).n;
  const base = canvasBaseUrl();
  return Response.json({
    canvasConfigured: canvasConfigured(),
    llmConfigured: llmConfigured(),
    discordConfigured: Boolean(process.env.DISCORD_WEBHOOK_URL),
    timezone: TZ(),
    me: getPref("me_name"),
    lastSync: getPref("last_sync"),
    // Which Canvas courses this app can see at all. `favoritesSet: false` means the
    // student has starred nothing, so Canvas's own fallback (all courses) applies.
    courseScope: {
      favoritesSet: getPref("favorites_set") !== "0",
      hidden: Number(getPref("courses_hidden") ?? 0),
      total: Number(getPref("courses_total") ?? 0),
      canvasCoursesUrl: base ? `${base}/courses` : null,
    },
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

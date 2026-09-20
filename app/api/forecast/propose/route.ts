/** POST { blocks: StudyBlock[] } — turn a study plan into calendar proposals (one per block). */
import { z } from "zod";
import { createProposal, getPref, proposalExists } from "@/lib/db";
import { fmtDateTime, TZ } from "@/lib/time";

const iso = z.string().refine((s) => !isNaN(new Date(s).getTime()), "invalid datetime");
const Body = z.object({
  blocks: z.array(
    z.object({
      assignmentId: z.number().int(),
      assignmentName: z.string().min(1),
      courseCode: z.string().default(""),
      startAt: iso,
      endAt: iso,
      hours: z.number().positive(),
    }),
  ).max(200),
});

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const meId = getPref("me_id");
  if (!meId) return Response.json({ error: "Sync Canvas first" }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid body" }, { status: 400 });
  let created = 0;
  for (const b of parsed.data.blocks) {
    if (new Date(b.endAt) <= new Date(b.startAt)) continue;
    const source = `forecast:${b.assignmentId}:${b.startAt}`;
    if (proposalExists(source, "calendar_create")) continue;
    createProposal(
      "calendar_create",
      {
        context_code: `user_${meId}`,
        title: `Study: ${b.assignmentName}${b.courseCode ? ` (${b.courseCode})` : ""}`,
        start_at: b.startAt,
        end_at: b.endAt,
        description: "Planned by Canvas Copilot's weekly workload forecast.",
      },
      `Block ${b.hours}h on ${fmtDateTime(b.startAt, TZ())} for "${b.assignmentName}".`,
      source,
    );
    created++;
  }
  return Response.json({ created });
}

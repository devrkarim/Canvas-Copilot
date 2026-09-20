import { buildBriefing, deliverBriefing, latestBriefing } from "@/lib/briefing";
import { llmConfigured } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(latestBriefing() ?? null);
}

/** Build a fresh briefing now and push it to configured channels. */
export async function POST() {
  if (!llmConfigured()) return Response.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 500 });
  try {
    const b = await buildBriefing();
    const delivered = await deliverBriefing(b).catch((e) => [`delivery failed: ${(e as Error).message}`]);
    return Response.json({ ...b, delivered });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

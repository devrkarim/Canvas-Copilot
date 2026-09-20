import { runSync } from "@/lib/sync";
import { canvasConfigured } from "@/lib/canvas/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!canvasConfigured()) {
    return Response.json({ error: "CANVAS_BASE_URL / CANVAS_TOKEN not set" }, { status: 500 });
  }
  const url = new URL(req.url);
  const extract = url.searchParams.get("extract") !== "0";
  try {
    const report = await runSync({ extract });
    return Response.json(report);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

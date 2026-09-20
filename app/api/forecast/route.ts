import { buildForecast } from "@/lib/forecast";
import { TZ } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get("week") ?? 0);
  const week = Number.isFinite(raw) ? Math.min(8, Math.max(0, Math.trunc(raw))) : 0;
  try {
    return Response.json(await buildForecast({ weekOffset: week, tz: TZ() }));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const POST = GET;

import { approveProposal, rejectProposal } from "@/lib/proposals";
import { db, getProposal } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { action: "approve" | "reject", payload?: object }  — payload lets the user edit a draft before approving */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pid = Number(id);
  if (!Number.isInteger(pid) || pid <= 0) return Response.json({ error: "invalid proposal id" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; payload?: unknown };
  try {
    if (body.payload && typeof body.payload === "object") {
      const existing = getProposal(pid);
      if (!existing) return Response.json({ error: "not found" }, { status: 404 });
      const merged = { ...JSON.parse(existing.payload), ...(body.payload as object) };
      db().prepare("UPDATE proposals SET payload = ? WHERE id = ?").run(JSON.stringify(merged), pid);
    }
    if (body.action !== "approve" && body.action !== "reject") {
      return Response.json({ error: 'action must be "approve" or "reject"' }, { status: 400 });
    }
    const p = body.action === "reject" ? rejectProposal(pid) : await approveProposal(pid);
    return Response.json({ ...p, payload: JSON.parse(p.payload), result: p.result ? JSON.parse(p.result) : null });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

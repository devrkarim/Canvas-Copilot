import { listProposals, type ProposalStatus } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status") as ProposalStatus | null;
  return Response.json(listProposals(status ?? undefined).map((p) => ({ ...p, payload: JSON.parse(p.payload), result: p.result ? JSON.parse(p.result) : null })));
}

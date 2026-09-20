/**
 * The ONLY code path that writes to Canvas. Proposals are created by the LLM
 * tools / sync; a human approves them here.
 */
import * as canvas from "@/lib/canvas/api";
import { db, getProposal, resolveProposal, getPref, type ProposalRow } from "@/lib/db";

export interface CalendarCreatePayload {
  context_code: string;
  title: string;
  start_at: string;
  end_at: string;
  description?: string;
  location_name?: string;
  all_day?: boolean;
  duplicate?: { count: number; interval?: number; frequency: "daily" | "weekly" | "monthly" };
}

export interface CalendarUpdatePayload extends CalendarCreatePayload {
  event_id?: number; // if known; otherwise we look for an event we created with the same title
  assignment_id?: number | null;
}

export interface MessagePayload {
  recipient_ids: number[];
  recipient_name?: string;
  subject: string;
  body: string;
  course_id?: number;
}

export async function approveProposal(id: number): Promise<ProposalRow> {
  const p = getProposal(id);
  if (!p) throw new Error(`proposal ${id} not found`);
  if (p.status !== "pending") throw new Error(`proposal ${id} is already ${p.status}`);

  try {
    const result = await execute(p);
    resolveProposal(id, "approved", result);
  } catch (e) {
    resolveProposal(id, "failed", { error: (e as Error).message });
    throw e;
  }
  return getProposal(id)!;
}

export function rejectProposal(id: number): ProposalRow {
  const p = getProposal(id);
  if (!p) throw new Error(`proposal ${id} not found`);
  resolveProposal(id, "rejected");
  return getProposal(id)!;
}

async function execute(p: ProposalRow): Promise<unknown> {
  const payload = JSON.parse(p.payload);
  switch (p.type) {
    case "calendar_create": {
      const body = payload as CalendarCreatePayload;
      const created = await canvas.createCalendarEvent({
        context_code: body.context_code,
        title: body.title,
        description: body.description,
        start_at: body.start_at,
        end_at: body.end_at,
        location_name: body.location_name,
        all_day: body.all_day,
        ...(body.duplicate && body.duplicate.count > 0 ? { duplicate: body.duplicate } : {}),
      });
      cacheEvent(created);
      return { event_id: created.id, html_url: created.html_url };
    }
    case "calendar_update": {
      const body = payload as CalendarUpdatePayload;
      const existingId = body.event_id ?? findOwnEventIdByTitle(body.title);
      if (existingId) {
        const updated = await canvas.updateCalendarEvent(existingId, {
          title: body.title,
          start_at: body.start_at,
          end_at: body.end_at,
          description: body.description,
          location_name: body.location_name,
        });
        cacheEvent(updated);
        return { event_id: updated.id, updated: true };
      }
      const created = await canvas.createCalendarEvent({
        context_code: body.context_code ?? `user_${getPref("me_id")}`,
        title: body.title,
        description: body.description,
        start_at: body.start_at,
        end_at: body.end_at,
        location_name: body.location_name,
      });
      cacheEvent(created);
      return { event_id: created.id, created: true };
    }
    case "message": {
      const body = payload as MessagePayload;
      const convs = await canvas.sendConversation(body.recipient_ids, body.subject, body.body);
      return { conversation_ids: convs.map((c) => c.id) };
    }
    default:
      throw new Error(`unknown proposal type ${p.type}`);
  }
}

function findOwnEventIdByTitle(title: string): number | undefined {
  const meId = getPref("me_id");
  const row = db()
    .prepare("SELECT id FROM calendar_events WHERE title = ? AND context_code = ? LIMIT 1")
    .get(title, `user_${meId}`) as { id: number } | undefined;
  return row?.id;
}

function cacheEvent(e: { id: number; title: string; start_at: string | null; end_at: string | null; location_name?: string | null; context_code: string }) {
  db()
    .prepare(
      `INSERT INTO calendar_events(id, title, start_at, end_at, location_name, context_code, synced_at)
       VALUES(?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, start_at=excluded.start_at, end_at=excluded.end_at, location_name=excluded.location_name`,
    )
    .run(e.id, e.title, e.start_at, e.end_at, e.location_name ?? null, e.context_code, new Date().toISOString());
}

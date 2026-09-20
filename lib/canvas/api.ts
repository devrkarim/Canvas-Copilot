/**
 * Typed wrappers over the Canvas endpoints this app uses.
 * Read calls here are only invoked by /api/sync and the proposal executor —
 * the LLM tools read from SQLite so chat stays fast and rate limits stay low.
 */
import { CanvasError, canvasGet, canvasGetAll, canvasPost, canvasPut } from "./client";
import type {
  CanvasAnnouncement,
  CanvasAssignment,
  CanvasCalendarEvent,
  CanvasConversation,
  CanvasCourse,
  CanvasEnrollmentUser,
  CanvasFile,
  CanvasTab,
  CanvasUser,
} from "./types";

// ---------- me ----------
export const getMe = () => canvasGet<CanvasUser>("/api/v1/users/self");

// ---------- courses ----------
/**
 * Every active course, each tagged with `is_favorite` (the star on the Canvas
 * dashboard). Sync keeps only the starred ones; the rest are counted so the UI
 * can say how many are being left out. See `favoriteCourses` in lib/sync.ts.
 */
export const listCourses = () =>
  canvasGetAll<CanvasCourse>("/api/v1/courses", {
    enrollment_state: "active",
    include: ["syllabus_body", "term", "favorites"],
    state: ["available"],
  });

export const listTabs = (courseId: number) =>
  canvasGetAll<CanvasTab>(`/api/v1/courses/${courseId}/tabs`);

export const listInstructors = (courseId: number) =>
  canvasGetAll<CanvasEnrollmentUser>(`/api/v1/courses/${courseId}/users`, {
    enrollment_type: ["teacher", "ta"],
    include: ["email", "enrollments"],
  });

// ---------- files ----------

/**
 * Metadata for a course file. Callers pass ids parsed out of syllabus HTML, so
 * the path is rebuilt here from integers only — an absolute URL lifted from that
 * HTML is never fetched with our token.
 */
export const getFile = (courseId: number, fileId: number) =>
  canvasGet<CanvasFile>(`/api/v1/courses/${courseId}/files/${fileId}`);

/** Download file bytes from the signed `url` on a CanvasFile. Sends no credentials. */
export async function downloadFile(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new CanvasError(`file download failed: ${res.status}`, res.status);
  return new Uint8Array(await res.arrayBuffer());
}

// ---------- assignments ----------
export const listAssignments = (courseId: number) =>
  canvasGetAll<CanvasAssignment>(`/api/v1/courses/${courseId}/assignments`, {
    include: ["submission"],
    order_by: "due_at",
  });

export const listMissing = () =>
  canvasGetAll<CanvasAssignment>("/api/v1/users/self/missing_submissions", {
    include: ["course"],
    filter: ["submittable"],
  });

/** Canvas caps `context_codes[]` at 10 per request on several endpoints; fan out and merge. */
async function chunkedByContext<T>(codes: string[], fetchChunk: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < codes.length; i += 10) out.push(...(await fetchChunk(codes.slice(i, i + 10))));
  return out;
}

// ---------- announcements ----------
export const listAnnouncements = (courseIds: number[], startDate: string, endDate: string) =>
  chunkedByContext(courseIds.map((id) => `course_${id}`), (chunk) =>
    canvasGetAll<CanvasAnnouncement>("/api/v1/announcements", {
      context_codes: chunk,
      start_date: startDate,
      end_date: endDate,
      active_only: true,
    }),
  );

// ---------- calendar ----------
export const listCalendarEvents = (
  contextCodes: string[],
  startDate: string,
  endDate: string,
  type: "event" | "assignment" = "event",
) =>
  chunkedByContext(contextCodes, (chunk) =>
    canvasGetAll<CanvasCalendarEvent>("/api/v1/calendar_events", {
      context_codes: chunk,
      start_date: startDate,
      end_date: endDate,
      type,
    }),
  );

export interface NewCalendarEvent {
  context_code: string; // e.g. "user_123"
  title: string;
  description?: string;
  start_at: string; // ISO
  end_at: string; // ISO
  location_name?: string;
  all_day?: boolean;
  /** Canvas recurrence: creates `count` copies every `interval` `frequency`s. */
  duplicate?: { count: number; interval?: number; frequency: "daily" | "weekly" | "monthly" };
}

export const createCalendarEvent = (event: NewCalendarEvent) =>
  canvasPost<CanvasCalendarEvent>("/api/v1/calendar_events", { calendar_event: event });

export const updateCalendarEvent = (
  eventId: number,
  patch: Partial<Omit<NewCalendarEvent, "duplicate" | "context_code">>,
) => canvasPut<CanvasCalendarEvent>(`/api/v1/calendar_events/${eventId}`, { calendar_event: patch });

// ---------- messaging (Canvas Inbox) ----------
export const sendConversation = (recipientIds: number[], subject: string, body: string) =>
  canvasPost<CanvasConversation[]>("/api/v1/conversations", {
    recipients: recipientIds.map(String),
    subject,
    body,
    force_new: true,
  });

/**
 * SQLite store (better-sqlite3). One file at data/app.db.
 * All LLM tools read from here; /api/sync writes Canvas data in.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = process.env.APP_DB_PATH || path.join(process.cwd(), "data", "app.db");

// Cache across Next.js hot reloads in dev.
const globalForDb = globalThis as unknown as { __db?: Database.Database };

export function db(): Database.Database {
  if (globalForDb.__db) return globalForDb.__db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const conn = new Database(DB_PATH);
  conn.pragma("journal_mode = WAL");
  conn.exec(SCHEMA);
  globalForDb.__db = conn;
  return conn;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS prefs (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  course_code TEXT,
  term_name TEXT,
  term_end TEXT,
  syllabus_body TEXT,
  syllabus_available INTEGER NOT NULL DEFAULT 0,
  syllabus_extracted_at TEXT,
  instructor_name TEXT,
  instructor_email TEXT,
  instructor_user_id INTEGER,
  late_policy TEXT,
  grading_weights TEXT,
  exam_dates TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  due_at TEXT,
  points_possible REAL,
  submission_types TEXT,
  html_url TEXT,
  submitted INTEGER NOT NULL DEFAULT 0,
  score REAL,
  missing INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assignments_due ON assignments(due_at);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  posted_at TEXT,
  html_url TEXT,
  processed INTEGER NOT NULL DEFAULT 0,
  actions TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  start_at TEXT,
  end_at TEXT,
  location_name TEXT,
  context_code TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS office_hours (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  instructor TEXT NOT NULL,
  day_of_week INTEGER NOT NULL,   -- 0=Sunday .. 6=Saturday
  start_time TEXT NOT NULL,       -- "HH:mm"
  end_time TEXT NOT NULL,
  location TEXT,
  modality TEXT,
  UNIQUE(course_id, instructor, day_of_week, start_time)
);

CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,             -- calendar_create | calendar_update | message
  payload TEXT NOT NULL,          -- JSON
  rationale TEXT NOT NULL,
  source TEXT NOT NULL,           -- announcement:<id> | chat | syllabus:<course_id> | forecast | missing:<assignment_id>
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS forecasts (
  assignment_id INTEGER PRIMARY KEY,
  estimated_hours REAL NOT NULL,
  difficulty TEXT NOT NULL,
  suggested_start_days_before INTEGER NOT NULL,
  reasoning TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  week_start TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS briefings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  delivered_to TEXT,
  created_at TEXT NOT NULL
);
`;

// ---------- helpers ----------

export const nowIso = () => new Date().toISOString();

export function getPref(key: string): string | null {
  const row = db().prepare("SELECT value FROM prefs WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setPref(key: string, value: string) {
  db()
    .prepare("INSERT INTO prefs(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

// ---------- row types ----------

export interface CourseRow {
  id: number;
  name: string;
  course_code: string | null;
  term_name: string | null;
  term_end: string | null;
  syllabus_body: string | null;
  syllabus_available: number;
  syllabus_extracted_at: string | null;
  instructor_name: string | null;
  instructor_email: string | null;
  instructor_user_id: number | null;
  late_policy: string | null;
  grading_weights: string | null;
  exam_dates: string | null;
  synced_at: string;
}

export interface AssignmentRow {
  id: number;
  course_id: number;
  name: string;
  description: string | null;
  due_at: string | null;
  points_possible: number | null;
  submission_types: string | null;
  html_url: string | null;
  submitted: number;
  score: number | null;
  missing: number;
  synced_at: string;
}

export interface AnnouncementRow {
  id: number;
  course_id: number;
  title: string;
  message: string | null;
  posted_at: string | null;
  html_url: string | null;
  processed: number;
  actions: string | null;
  synced_at: string;
}

export interface CalendarEventRow {
  id: number;
  title: string;
  start_at: string | null;
  end_at: string | null;
  location_name: string | null;
  context_code: string | null;
  synced_at: string;
}

export interface OfficeHoursRow {
  id: number;
  course_id: number;
  instructor: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  location: string | null;
  modality: string | null;
}

export type ProposalType = "calendar_create" | "calendar_update" | "message";
export type ProposalStatus = "pending" | "approved" | "rejected" | "failed";

export interface ProposalRow {
  id: number;
  type: ProposalType;
  payload: string;
  rationale: string;
  source: string;
  status: ProposalStatus;
  result: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface ForecastRow {
  assignment_id: number;
  estimated_hours: number;
  difficulty: string;
  suggested_start_days_before: number;
  reasoning: string | null;
  updated_at: string;
}

export interface StudyBlockRow {
  id: number;
  assignment_id: number;
  start_at: string;
  end_at: string;
  week_start: string;
}

export interface BriefingRow {
  id: number;
  content: string;
  delivered_to: string | null;
  created_at: string;
}

// ---------- proposals ----------

export function createProposal(
  type: ProposalType,
  payload: unknown,
  rationale: string,
  source: string,
): ProposalRow {
  const info = db()
    .prepare(
      "INSERT INTO proposals(type, payload, rationale, source, status, created_at) VALUES(?, ?, ?, ?, 'pending', ?)",
    )
    .run(type, JSON.stringify(payload), rationale, source, nowIso());
  return db().prepare("SELECT * FROM proposals WHERE id = ?").get(info.lastInsertRowid) as ProposalRow;
}

export function listProposals(status?: ProposalStatus): ProposalRow[] {
  return (
    status
      ? db().prepare("SELECT * FROM proposals WHERE status = ? ORDER BY created_at DESC").all(status)
      : db().prepare("SELECT * FROM proposals ORDER BY created_at DESC LIMIT 100").all()
  ) as ProposalRow[];
}

export function getProposal(id: number): ProposalRow | undefined {
  return db().prepare("SELECT * FROM proposals WHERE id = ?").get(id) as ProposalRow | undefined;
}

export function resolveProposal(id: number, status: ProposalStatus, result?: unknown) {
  db()
    .prepare("UPDATE proposals SET status = ?, result = ?, resolved_at = ? WHERE id = ?")
    .run(status, result === undefined ? null : JSON.stringify(result), nowIso(), id);
}

/** True if an identical pending proposal already exists (dedupe on re-sync). */
export function proposalExists(source: string, type: ProposalType): boolean {
  const row = db()
    .prepare("SELECT 1 FROM proposals WHERE source = ? AND type = ? AND status IN ('pending','approved') LIMIT 1")
    .get(source, type);
  return Boolean(row);
}

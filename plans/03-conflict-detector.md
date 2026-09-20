# Feature 3 — Syllabus ↔ Canvas discrepancy & schedule conflict detector

**Owner:** teammate C · **Branch:** `feat/conflicts` · **Depends on:** the scaffold being on `main`. Nothing else, and nobody else. No new Canvas endpoints.

## Before you start

```bash
git checkout main && git pull
git log --oneline -1          # must show the chore/feature-scaffold commit — if not, wait
git checkout -b feat/conflicts
npm install && npm run seed && npm test     # confirm a green baseline before you change anything
```

You own exactly these paths and may not create or edit anything else:

```
lib/features/conflicts/**   app/conflicts/**   app/api/conflicts/**
app/components/cards/ConflictsCard.tsx   scripts/seed-conflicts.ts
tests/conflicts.test.ts   docs/features/conflicts.md
```

Run `npm run check:ownership` before every commit; it fails the moment you touch someone else's file. The stubs you're filling in (`lib/features/conflicts/{schema,tools,sync}.ts`) already exist and are already wired into the app — you never edit a registry, a nav bar, `lib/db.ts`, or `package.json`.

**Read-only dependencies** (import freely, never edit): `@/lib/db` (including `createProposal`), `@/lib/time`, `@/lib/llm`, `@/lib/tools/shared`.

**Never create:** a shared helper outside your folder (`lib/utils.ts`, `lib/features/common.ts`, `tests/helpers.ts`, …). If you want something another feature also wants, write your own copy inside `lib/features/conflicts/`.

One caution specific to this feature: it reads data that features 1, 2 and 4 don't own either — `courses.exam_dates`, `announcements.actions`, `calendar_events`. All of it is read-only for you. Never `UPDATE` a core table outside `scripts/seed-conflicts.ts`.

## The pitch

> ⚠️ **CS 101 midterm: the syllabus says Oct 10, Canvas says Oct 12.**
> → *"Hi Dr. Nair — the syllabus lists the midterm on Friday Oct 10, but the Canvas calendar shows Oct 12. Which is correct?"* — drafted, one click to send.

> ⚠️ **Two exams on Oct 14** (CHEM 122 midterm and CS 101 midterm).
> ⚠️ **ENGL essay is due at 2:00 PM Thursday — you're in CHEM lab 1–4 PM.**

Nobody notices these until it's too late. The data to catch all of them is already in the database and currently unused: `courses.exam_dates` is extracted by the syllabus extractor and never read; `announcements.actions` holds extracted date changes; `calendar_events` is only used as busy time.

## Scope

**In:** four detectors, a `conflicts` table with a review workflow (open/dismissed/resolved), LLM-drafted clarifying questions routed through the existing proposals inbox, `/conflicts` page, chat tools, dashboard card.
**Out (backlog):** editing Canvas due dates, auto-resolving in favour of one source, travel/commute time modelling.

## Files you own

```
lib/features/conflicts/schema.ts     ← fill in the stub
lib/features/conflicts/detect.ts     ← new: PURE detectors over plain inputs
lib/features/conflicts/store.ts      ← new: loads core rows, persists findings
lib/features/conflicts/draft.ts      ← new: LLM-drafted clarifying question
lib/features/conflicts/sync.ts       ← fill in the stub
lib/features/conflicts/tools.ts      ← fill in the stub
app/api/conflicts/route.ts           ← GET  /api/conflicts
app/api/conflicts/scan/route.ts      ← POST /api/conflicts/scan
app/api/conflicts/[id]/route.ts      ← POST /api/conflicts/:id  { action }
app/conflicts/page.tsx               ← replace the stub
app/components/cards/ConflictsCard.tsx
scripts/seed-conflicts.ts
tests/conflicts.test.ts
docs/features/conflicts.md
```

Read-only on everything core; the only writes outside your tables go through `createProposal(...)`.

## Data model (`CONFLICTS_SCHEMA`)

```sql
CREATE TABLE IF NOT EXISTS conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT NOT NULL UNIQUE,   -- stable hash of (kind + the ids involved + the dates compared)
  kind TEXT NOT NULL,                 -- 'syllabus_vs_canvas' | 'announcement_vs_canvas'
                                      -- | 'double_booked_exam' | 'due_during_event'
  severity TEXT NOT NULL,             -- 'high' | 'medium' | 'low'
  course_id INTEGER,
  title TEXT NOT NULL,                -- "CS 101 midterm date disagrees"
  detail TEXT NOT NULL,               -- JSON: { sources: [{label, value, origin}], assignmentIds, eventIds, dates }
  explanation TEXT NOT NULL,          -- deterministic one-liner for the UI
  status TEXT NOT NULL DEFAULT 'open',-- 'open' | 'dismissed' | 'resolved'
  proposal_id INTEGER,                -- set once a clarifying question has been drafted
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_conflicts_status ON conflicts(status, severity);
```

`fingerprint` is what makes re-scanning idempotent: a scan upserts by fingerprint, bumps `last_seen_at`, and never resurrects something the student dismissed. A conflict whose fingerprint stops appearing in a scan gets `status = 'resolved'` (with `resolved_at`), so the list self-cleans when the professor fixes the date.

## The detectors (`detect.ts` — pure functions over plain arrays)

Keep every detector a pure function `(inputs) => Finding[]`. No `db()` calls in this file; `store.ts` loads the rows and passes them in. This is what makes the feature fully testable without Canvas or an API key.

### D1 · `syllabus_vs_canvas`

Inputs: `courses.exam_dates` (JSON `[{name, date, notes}]`, already extracted), `assignments` (name + `due_at`), `calendar_events` (title + `start_at`).

1. For each syllabus exam entry with a non-null `date`, find the best matching Canvas item by normalised name similarity (lowercase, strip punctuation, token overlap; `"Midterm Exam"` ↔ `"Midterm"`). Require ≥ 0.5 token overlap or an explicit keyword hit (`midterm`, `final`, `exam`, `quiz N`).
2. Compare dates **in the student's timezone** using `partsInTz` from `@/lib/time` — compare calendar days, not instants, or every evening deadline looks like an off-by-one.
3. Differ by ≥ 1 day → finding, severity `high`. Differ by 0 → no finding. No match at all → severity `low` finding of the same kind ("the syllabus lists a midterm on Oct 10; nothing in Canvas matches") — that case is real and useful.

### D2 · `announcement_vs_canvas`

Inputs: `announcements.actions` (JSON written by `lib/extract/announcement.ts`; `due_date_change` actions carry `assignmentId`/`assignmentName` and `newDueAt`), plus current `assignments.due_at`.

An announcement said HW3 moved to Friday; three days later Canvas still says Wednesday. Severity `high` if the announcement is the newer source. Skip when a pending `calendar_update` proposal for that assignment already exists (check `proposals.source LIKE 'announcement:%'`) — that's the existing flow's job, and double-reporting is noise.

### D3 · `double_booked_exam`

Inputs: assignments + calendar events classified as assessments (name/title matches `exam|midterm|final|quiz|test`), across all courses.

Two or more on the same local day → one finding listing them, severity `high` if both are exams, `medium` if one is a quiz.

### D4 · `due_during_event`

Inputs: `assignments.due_at` + `calendar_events` with both `start_at` and `end_at`.

Deadline falls inside a calendar event (class, lab, exam) → severity `medium`, explanation *"ENGL essay is due 2:00 PM Thu, while you're in CHEM lab 1:00–4:00 PM."* Ignore all-day events (`start_at === end_at`, which is how `lib/sync.ts` encodes them) and ignore events whose title matches the assignment's own course+name (Canvas mirrors assignment deadlines into the calendar; those are not conflicts). **Test that false-positive case explicitly** — it's the one that will otherwise flood the list.

## Clarifying question drafting (`draft.ts`)

One structured-output call (`zodOutputFormat` + `parseDefaults`, same shape as `lib/extract/syllabus.ts`):

```ts
const QuestionSchema = z.object({
  subject: z.string(),
  body: z.string().describe("Polite, 3–5 sentences, states both sources and dates explicitly, asks which is correct, signs with the student's name"),
});
```

Then `createProposal("message", { recipient_ids: [course.instructor_user_id], … }, rationale, `conflict:${fingerprint}`)` and store the returned id in `conflicts.proposal_id`. Guard on `instructor_user_id` being null (ENGL 240 in the demo data is a good test of that branch). When `llmConfigured()` is false, fall back to a template body built from `detail` — the feature must still demo without a key.

## Sync hook

```ts
export async function syncConflicts(ctx: FeatureSyncCtx) {
  const found = scanAll();          // pure detectors + upsert by fingerprint
  if (found.high > 0) ctx.warnings.push(`${found.high} schedule conflict(s) need review`);
}
```

Cheap and deterministic — no LLM, so it runs on every sync. Drafting is on-demand only (the student clicks the button or asks in chat).

## API routes

| Route | Behaviour |
|---|---|
| `GET /api/conflicts?status=open` | `{ timezone, conflicts: [{ id, kind, severity, title, explanation, detail, status, proposalId, firstSeenAt }], counts: { open, dismissed, resolved } }` |
| `POST /api/conflicts/scan` | re-run the detectors; `{ created, updated, resolved }` |
| `POST /api/conflicts/:id` | `{ action: "dismiss" \| "reopen" \| "draft_question" }`; `draft_question` returns `{ proposalId }` |

## Chat tools (`tools.ts`)

| Tool | Input | Returns |
|---|---|---|
| `get_conflicts` | `{ severity?: "high"\|"medium"\|"low", course?: courseArg }` | Open conflicts with both conflicting values spelled out |
| `draft_clarifying_question` | `{ conflict_id: number }` | Creates the message proposal (goes in the **write** array) |

Write the `get_conflicts` description so the model checks it on "is there anything I should worry about this week?" — that phrasing should surface a date conflict, and it makes the chat demo land.

## UI

**`/conflicts` page:**
- Severity-ordered list. Each card shows the two sources side by side — a small two-column comparison (`Syllabus: Fri Oct 10` | `Canvas: Sun Oct 12`) is far more convincing than prose, and it's the screenshot that ends up on the slide.
- Buttons: **Ask the professor** (→ draft → link to `/proposals`), **Dismiss**, and for resolved ones a muted "resolved ✓" row behind a toggle.
- A **Re-scan** button wired to `POST /api/conflicts/scan`, mirroring the Forecast page's "Recompute".
- Empty state: "No conflicts found across 3 courses, 10 assignments and 12 calendar events." Say what was checked — an empty list with no context reads like a broken feature.

**`ConflictsCard.tsx`:** amber/red `Card` with the count of open high-severity conflicts and the top one's title, linking to `/conflicts`. Returns `null` when the count is 0.

## Seed data (`scripts/seed-conflicts.ts`)

Delete only `conflicts`. The demo seed already gives you courses, assignments, announcements with extracted actions, and a class schedule — so **this script should mostly add the raw ingredients, then run the real scan**, proving the detectors work rather than faking their output:

1. `UPDATE courses SET exam_dates = ...` for CS 101 so the syllabus midterm lands two days off the Canvas one (D1).
2. Insert a calendar event for a CHEM exam on the same day as the CS midterm (D3).
3. Insert a lab event that brackets an existing assignment deadline (D4).
4. Call your own `scanAll()` so `conflicts` is populated by the detectors themselves.

For D2, check what `scripts/seed-demo.ts` already writes into `announcements.actions`; if one of its `due_date_change` actions is already inconsistent with the seeded `assignments.due_at`, D2 fires for free — otherwise nudge one assignment's `due_at`.

## Tests (`tests/conflicts.test.ts`)

Pure detector tests (hand-built inputs, no seed, no timezone surprises — pass an explicit `tz`):
- D1 fires at a 2-day gap, stays silent at 0, and produces the `low` "no Canvas match" variant
- D1 does **not** fire for an 11 PM deadline vs a same-day syllabus date (the off-by-one trap)
- D3 groups three same-day assessments into one finding, not three
- D4 ignores all-day events (`start_at === end_at`) and ignores Canvas's mirror of the assignment's own deadline
- fingerprints are stable across runs and unique across kinds

Seeded/store tests:
- scan → dismiss → re-scan leaves the conflict dismissed (never resurrected)
- a conflict that disappears from a scan is marked `resolved`, not deleted
- `draft_clarifying_question` on a course with no `instructor_user_id` returns a helpful message instead of throwing

## Demo (30 s)

1. `/conflicts` → "CS 101 midterm: syllabus says Oct 10, Canvas says Oct 12."
2. **Ask the professor** → `/proposals` → the draft names both dates → **Send**.
3. Scroll: "Two exams on Oct 14" and "essay due during CHEM lab."

## Risks

| Risk | Mitigation |
|---|---|
| Name matching produces false positives ("Quiz 1" ↔ "Quiz 11") | Token-overlap threshold + trailing-number equality required when both names end in a number. Unit-test that exact pair. |
| Timezone off-by-one makes every evening deadline a "conflict" | All comparisons via `partsInTz(date, tz)` on `{year, month, day}`; never compare ISO strings or raw `Date` objects. |
| Noise buries the real finding | Severity ordering, dismissal that sticks, and suppression of anything the announcement-proposal flow already covers. |
| `exam_dates` is empty without an API key | Your seed script writes it directly, so the whole feature demos on seed data alone. |

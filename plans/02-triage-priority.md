# Part 1 of 3 — Late-policy-aware triage + extension requests

**Owner:** teammate B · **Branch:** `feat/triage` · **Depends on:** the scaffold being on `main`. Nothing else, and nobody else.

This file plus §2.5, §3 and §4 of `plans/README.md` is your complete assignment. You will not need to ask anyone anything to finish it.

## Before you start

```bash
git checkout main && git pull
git log --oneline -1          # must show the chore/feature-scaffold commit — if not, wait
git checkout -b feat/triage
npm install && npm run seed && npm test     # confirm a green baseline before you change anything
```

You own exactly these paths and may not create or edit anything else:

```
lib/features/triage/**   app/triage/**   app/api/triage/**
app/components/cards/TriageCard.tsx   app/components/course/CourseTriageSection.tsx
scripts/seed-triage.ts   tests/triage.test.ts   docs/features/triage.md
```

Run `npm run check:ownership` before every commit; it fails the moment you touch someone else's file. The stubs you're filling in (`lib/features/triage/{schema,tools,sync}.ts`, both UI components) already exist and are already wired into the app — you never edit a registry, a nav bar, a page, `lib/db.ts`, or `package.json`.

**Read-only dependencies** (import freely, never edit): `@/lib/db`, `@/lib/time`, `@/lib/llm`, `@/lib/forecast`, `@/lib/tools/shared`, `@/app/components/ui`, `@/app/components/Markdown`, and `@/lib/features/grades/weights` (see Step 3).

**Never create:** a shared helper outside your folder (`lib/utils.ts`, `lib/features/common.ts`, `tests/helpers.ts`, …). If you want something another feature also wants, write your own copy inside `lib/features/triage/`.

### The four repo facts this feature is built on

Read `plans/README.md` §2.5 in full; these four are the ones you'll hit within the first hour.

1. **Only starred courses are in the database.** `runSync` deletes everything else. So iterate the `courses` table; never ask Canvas for a course list. (This feature makes no Canvas calls at all.)
2. **`courses.late_policy` is null for any course whose syllabus couldn't be read** — `syllabus_source` is `link_only` (tab was just an unreadable attachment) or `none`. That's a large fraction of real courses. A null late policy means *"we don't know this course's policy"*, never *"this course has no late penalty"*, and the difference is the whole feature's credibility. Use `courseHasSyllabus(c)` from `@/lib/db` to tell the two apart, and report coverage in the UI (Step 1).
3. **Dynamic route params are a Promise** in Next 16 — you don't have a dynamic route, but if you add one, copy `app/api/proposals/[id]/route.ts`.
4. **Markdown renders through `<Markdown>`** from `@/app/components/Markdown` inside `<div className="prose-chat">` — relevant when you preview a drafted extension email.

Also: your feature is the top line of the repo's `to-do.md` ("add extension feature"), so the extension-request half is not optional garnish — it's the half that was explicitly asked for.

## The pitch

Every study app tells you *what's due*. This one tells you *what to do first, and what it costs you not to*:

> **Do this first: CHEM 122 problem set (due in 9 h, 3.0% of your final grade, no late credit at all).**
> Delaying it one hour past the deadline costs **3.0 points of final grade** — the policy is all-or-nothing.
> Next: ENGL essay (due in 2 days, 12% of grade, one-third letter grade per day late → **0.35 pts/hour** once late).

Then, because it knows the policy and the deadline: a one-click **extension request** draft, sent through the existing proposals inbox.

## Scope

**In:** structured late-policy extraction, a deterministic risk/priority score, a ranked `/triage` page, "what happens if I'm N hours late" explanations, chat tools, extension-request drafting, dashboard card.
**Out (backlog):** calendar rescheduling, negotiating with the professor, anything that writes to Canvas outside the proposals path.

## Files you own

```
lib/features/triage/schema.ts      ← fill in the stub
lib/features/triage/policy.ts      ← new: late-policy text → structured model (LLM, cached)
lib/features/triage/weight.ts      ← new: grade weight per assignment (Canvas, with syllabus fallback)
lib/features/triage/score.ts       ← new: PURE scoring math, no db, no network
lib/features/triage/store.ts       ← new: reads core tables, writes your tables
lib/features/triage/sync.ts        ← fill in the stub
lib/features/triage/tools.ts       ← fill in the stub
app/api/triage/route.ts            ← GET  /api/triage
app/api/triage/refresh/route.ts    ← POST /api/triage/refresh
app/api/triage/extension/route.ts  ← POST /api/triage/extension
app/triage/page.tsx                ← replace the stub
app/components/cards/TriageCard.tsx           ← dashboard card
app/components/course/CourseTriageSection.tsx ← this course's deadlines + policy, on /courses/[id]
scripts/seed-triage.ts
tests/triage.test.ts
docs/features/triage.md
```

You read `courses`, `assignments`, `calendar_events`, `forecasts` and `study_blocks`; you write only `late_policies` and `triage_scores`, plus `createProposal(...)` for extension drafts.

## Data model (`TRIAGE_SCHEMA`)

```sql
CREATE TABLE IF NOT EXISTS late_policies (
  course_id INTEGER PRIMARY KEY,
  accepts_late INTEGER NOT NULL DEFAULT 0,
  penalty_type TEXT NOT NULL,        -- 'none' | 'percent_per_day' | 'percent_per_hour'
                                     -- | 'letter_per_day' | 'flat_percent' | 'no_credit' | 'unknown'
  percent_per_unit REAL,             -- 10 = "10% per day"; for letter_per_day, points-equivalent
  grace_hours REAL NOT NULL DEFAULT 0,
  max_days REAL,                     -- accepted up to N days late; NULL = unbounded
  max_penalty_percent REAL,          -- cap, e.g. "at most 30%"
  applies_to TEXT,                   -- free text: "lab reports only", NULL = everything
  unknown_reason TEXT,               -- NULL | not_stated | syllabus_unreadable | no_syllabus
  confidence REAL NOT NULL DEFAULT 0,
  quote TEXT,                        -- the sentence this came from, for the UI
  source_hash TEXT NOT NULL,         -- hash of courses.late_policy; re-extract only when it changes
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS triage_scores (
  assignment_id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL,
  grade_weight_percent REAL,         -- share of the FINAL grade this assignment is worth
  hours_until_due REAL,
  estimated_hours REAL,
  loss_per_hour_late REAL,           -- final-grade points lost per hour of delay past the deadline
  risk_score REAL NOT NULL,          -- the ranking number
  band TEXT NOT NULL,                -- 'now' | 'today' | 'this_week' | 'later' | 'lost_cause'
  reason TEXT NOT NULL,              -- one sentence, deterministic, shown in the UI
  computed_at TEXT NOT NULL
);
```

## Step 1 — Structured late policy (`policy.ts`)

`courses.late_policy` is already extracted free text, e.g.
`"Late work loses 10% per day, up to 3 days. After that, no credit without a documented excuse."`

One structured-output call per course, cached on `source_hash`. Follow `lib/extract/syllabus.ts` exactly: `zodOutputFormat` + `parseDefaults` from `@/lib/llm`.

```ts
const LatePolicySchema = z.object({
  acceptsLate: z.boolean(),
  penaltyType: z.enum(["none","percent_per_day","percent_per_hour","letter_per_day","flat_percent","no_credit","unknown"]),
  percentPerUnit: z.number().nullable(),
  graceHours: z.number().nullable(),
  maxDays: z.number().nullable(),
  maxPenaltyPercent: z.number().nullable(),
  appliesTo: z.string().nullable().describe("If the policy only covers some work types, say which"),
  confidence: z.number().min(0).max(1),
  quote: z.string().nullable().describe("The sentence from the policy this is based on"),
});
```

Calibration rules to put in the system prompt:
- `letter_per_day`: "one-third letter grade per day" ≈ 3.33 percentage points/day → set `penaltyType: "letter_per_day"`, `percentPerUnit: 3.33`.
- "no late work accepted" → `acceptsLate: false, penaltyType: "no_credit"`.
- Anything ambiguous → `penaltyType: "unknown"`, `confidence < 0.5`.

**Must degrade without an API key.** When `llmConfigured()` is false, or the course has no `late_policy`, write a row with `penaltyType: "unknown"`, `confidence: 0`. The scorer then falls back to a pure deadline+points ranking and the UI says *"late policy unknown — ranked by deadline and weight only."* Half of your test suite runs on this path.

**Distinguish the three reasons a policy is unknown**, because they have different fixes and the student can act on two of them. Store the reason in `late_policies.applies_to`… no — add a dedicated column, `unknown_reason TEXT`, to your own table:

| `courses.syllabus_source` | `late_policy` | `unknown_reason` | What the UI says |
|---|---|---|---|
| `html` / `pdf` | non-null | `null` | the real policy |
| `html` / `pdf` | null | `not_stated` | "the syllabus doesn't state a late policy" |
| `link_only` | null | `syllabus_unreadable` | "this course's syllabus is an attachment Canvas Copilot couldn't read" |
| `none` | null | `no_syllabus` | "this course has no syllabus in Canvas" |

Use `courseHasSyllabus(c)` (from `@/lib/db`) plus `c.syllabus_source` to pick between the last three. This is a small amount of extra code that buys the feature its honesty: a ranked list that quietly assumed "no penalty" for every unreadable syllabus would be confidently wrong on the courses that matter most.

## Step 2 — The score (`score.ts`, pure)

```ts
export interface ScoreInput {
  assignmentId: number; courseId: number;
  pointsPossible: number | null;
  gradeWeightPercent: number | null;   // share of final grade, see Step 3
  dueAt: string | null;
  now: Date;
  submitted: boolean;
  estimatedHours: number;              // from the existing `forecasts` table, else points/10
  policy: LatePolicy;
  freeHoursBeforeDue: number;          // from the existing free-slot logic
}

export function lossPerHourLate(weightPercent: number, policy: LatePolicy): number;
export function lossIfLateBy(weightPercent: number, policy: LatePolicy, hoursLate: number): number;
export function scoreOne(input: ScoreInput): { riskScore: number; band: string; reason: string; lossPerHour: number };
export function rank(inputs: ScoreInput[]): Array<ReturnType<typeof scoreOne> & { assignmentId: number }>;
```

Scoring shape (keep it explainable — a judge will ask how it works):

```
risk = weightPercent
     × urgency(hoursUntilDue, estimatedHours, freeHoursBeforeDue)
     × (1 + latePenaltyMultiplier)
```

- `urgency` rises sharply once `freeHoursBeforeDue < estimatedHours` — "you no longer have time to finish this" is the real signal, and the free-slot math for it already exists in `lib/forecast.ts` (`freeSlots`, exported).
- `latePenaltyMultiplier` is 0 for a generous policy, large for `no_credit`.
- `lossPerHourLate`: `percent_per_day` → `weight × percentPerUnit/100 / 24`; `no_credit`/`flat_percent` → the whole cliff at `graceHours`, so report it as *"−3.0 pts the moment it's late"*, not as a per-hour rate. Model this explicitly; don't average a cliff into a slope.
- Bands: `now` (can't finish in remaining free time, or due < 12 h), `today`, `this_week`, `later`, `lost_cause` (past due and the policy gives no credit — de-prioritise instead of nagging).
- `reason` is generated deterministically from the inputs (template strings), **not** by the LLM, so it can't hallucinate a policy.

## Step 3 — Weight per assignment

You need "what share of the final grade is this assignment worth." There are two sources, and the scaffold has already set up the seam so you can write both today, in one pass, with no coordination:

```ts
// lib/features/triage/weight.ts   (yours)
import { weightForAssignment } from "@/lib/features/grades/weights";

export function weightFor(assignment: AssignmentRow, course: CourseRow, siblings: AssignmentRow[]):
  { percent: number; approximate: boolean } {
  const canvas = weightForAssignment(assignment.id);          // real Canvas group weights
  if (canvas) return { percent: canvas.percent, approximate: false };
  return { ...syllabusWeight(assignment, course, siblings), approximate: true };   // your fallback
}
```

`weightForAssignment` is a **stub that returns `null` today** — feature 1 fills in the body on its own branch and your code starts getting real numbers with zero changes on your side. Import it, don't reimplement it, and don't wait for it.

Your fallback, `syllabusWeight()`, uses `courses.grading_weights` (already populated by the existing syllabus extractor):

1. Match the assignment to a weight group by keyword (`"HW"`/`"Homework"`/`"Problem set"` → Homework; `"Essay"`/`"Paper"` → Essays; `"Midterm"`/`"Final"`/`"Exam"` → Exams). Keep the matcher in `score.ts` as a pure exported function so it's testable.
2. Split the group's percent across the assignments matched to it in that course: `weight = groupPercent / countInGroup`.
3. No match or no weights → `points_possible / totalCoursePoints × 100`.

Carry `approximate` all the way to the UI and show `≈` in front of approximate percentages — that flag is the difference between "the syllabus says homework is 40% and you have 8 of them" and "Canvas says this assignment is 3.1% of your grade".

Test both branches: with `grade_groups` empty (the default in your seed) you exercise the fallback; monkey-patch or stub `weightForAssignment` in one test to return a value and assert `approximate: false` wins.

## Step 4 — Sync hook + recompute

```ts
export async function syncTriage(ctx: FeatureSyncCtx) {
  await refreshPolicies(ctx.extract);   // LLM, only where source_hash changed
  recomputeScores();                    // pure, cheap — safe to run on every request too
}
```

`recomputeScores()` must be fast and side-effect-light: `GET /api/triage` calls it on every load (scores go stale by the hour, not by the sync).

## API routes

| Route | Behaviour |
|---|---|
| `GET /api/triage?horizon=14` · `&course=<id>` | `{ timezone, ranked: [{ assignmentId, name, course, courseId, dueAt, hoursUntilDue, weightPercent, weightApproximate, estimatedHours, lossPerHour, lossCurve, lossIfOneDayLate, band, reason, policy: { summary, quote, confidence, unknownReason } }], policyCoverage: { known, notStated, unreadable, noSyllabus } }`. `?course=` filters to one course — that's what `CourseTriageSection` calls. |
| `POST /api/triage/refresh` | re-extract policies (LLM) + recompute; `{ error }` when the key is missing |
| `POST /api/triage/extension` | body `{ assignmentId, reason?, days? }` → creates a `message` proposal via `createProposal` and returns `{ proposalId }` |

For the extension draft, mirror `propose_message` in `lib/tools/index.ts`: look up `courses.instructor_user_id`, and return a helpful error (not a 500) when it's missing. `source` string: `extension:<assignmentId>` so `proposalExists` dedupes re-requests. Use the LLM to write the body when available; otherwise fall back to a template. The draft must reference the actual policy quote and the concrete deadline.

## Chat tools (`tools.ts`)

| Tool | Input | Returns |
|---|---|---|
| `get_triage` | `{ limit?: number, course?: courseArg }` | The ranked list with reasons — the answer to "what should I work on first?" |
| `explain_late_cost` | `{ assignment: string, hours_late?: number, days_late?: number }` | "Turning the CHEM problem set in 1 day late costs 3.0 points of your final grade — the syllabus says no late problem sets at all." Include the quote. |
| `draft_extension_request` | `{ assignment: string, reason: string, requested_days: number }` | Creates the proposal, returns "#12 is waiting in your Proposals inbox" |

`draft_extension_request` goes in the **write** array; the other two in **read**. The chat system prompt already tells the model to weigh due date, points and effort for "what should I do first" — a strong `get_triage` description will make it reach for your tool instead of hand-rolling.

## UI

**`/triage` page:**
- A ranked list, band-grouped with headers **Do now / Today / This week / Later**, each row: course pill, name, due countdown ("in 9 h"), weight ("3.0% of final"), and the deterministic reason line.
- A cost strip per row: *"−3.0 pts if late at all"* (cliff, red) or *"−0.14 pts/hour once late"* (slope, amber) or *"no penalty for 48 h"* (green).
- A **"what if I'm late?"** slider (0–72 h) that redraws the projected loss for the selected row — pure client-side math against `lossIfLateBy` values returned by the API (return a small precomputed curve, e.g. losses at 0/6/12/24/48/72 h, so the page needs no extra round trips).
- **"Request an extension"** button per row → `POST /api/triage/extension` → link to `/proposals`.
- A footnote (not a banner — the dashboard already has one about course scope) when any course lacks a policy, naming the reason: *"2 courses have no readable late policy: CHEM 122's syllabus is an unreadable attachment, ENGL 240 has no syllabus in Canvas. Those are ranked by deadline and weight only."* Link each course name to `/courses/<id>`, where the student can see the syllabus state for themselves.

**`TriageCard.tsx`:** top 3 rows with the band colour and the one-line reason, linking to `/triage`. Returns `null` when nothing is upcoming.

**`CourseTriageSection.tsx`:** on `/courses/[id]`, a `Card title="What's at stake"` sitting right under the course's "Late policy" card — which shows the *raw* syllabus text, while yours shows what that text actually costs: this course's upcoming assignments ranked, each with its loss figure, plus the **Request an extension** button. When `unknownReason` is set, render that instead of numbers. Fetch `/api/triage?course=<id>`; return `null` when the course has nothing upcoming.

## Seed data (`scripts/seed-triage.ts`)

Delete only `late_policies` and `triage_scores`. Then insert structured policies for the three demo courses that match their syllabus text in `scripts/seed-demo.ts`:

- CS 101 → `percent_per_day`, 10%/day, `maxDays: 3`
- CHEM 122 → `no_credit` for problem sets (`appliesTo: "problem sets"`), and note the 48 h/20% lab variation in `quote` — a good demo of the `appliesTo` caveat
- ENGL 240 → **no row at all.** `seed-demo.ts` deliberately gives ENGL 240 no syllabus, so it's your free test of the `unknown_reason` path. Set its `courses.syllabus_source` to `'none'` in your seed (that column is null in `seed-demo` rows, since that script predates it) and let your own code classify it.

Add a fourth case by hand if you want the `syllabus_unreadable` state on screen for the demo: `UPDATE courses SET syllabus_source = 'link_only', late_policy = NULL WHERE id = 202` in your seed, which turns CHEM into the "we couldn't read this syllabus" example. Pick one of the two — don't make every demo course broken.

Leave `triage_scores` empty — it's recomputed on load. That proves the recompute path works from a cold start.

## Tests (`tests/triage.test.ts`)

Pure `score.ts` tests (no seed):
- a cliff policy (`no_credit`) ranks above a generous one at equal weight and deadline
- `lossIfLateBy` respects `graceHours` (zero loss inside the grace window) and `maxPenaltyPercent` (capped)
- `maxDays` exceeded → item lands in `lost_cause`, not `now`
- `unknown` policy never produces `NaN` and still yields a sane ordering
- keyword→weight-group matcher: "HW3" → Homework, "Final Exam" → Exams, unmatched falls back to points share
- `weightFor` prefers a non-null `weightForAssignment` result (`approximate: false`) and falls back to the syllabus estimate when it returns `null`
- `freeHoursBeforeDue < estimatedHours` promotes an item to the `now` band even when it's 3 days out

Seeded tests (`seed-demo` then `seed-triage`):
- `get_triage` returns items in non-increasing `riskScore`
- `explain_late_cost` for the CHEM problem set quotes "No late submissions"
- `draft_extension_request` creates exactly one pending proposal, and a second identical call doesn't duplicate it
- a course with `syllabus_source = 'none'` yields `unknownReason: "no_syllabus"` and still appears in the ranking (ranked by deadline and weight), rather than being dropped or scored as penalty-free
- `policyCoverage` counts add up to the number of courses — the quickest guard against a course silently vanishing from triage

## Demo (30 s)

1. `/triage` → "Do now: CHEM problem set — 3.0% of your final, and there's no late credit at all."
2. Drag the late slider → the ENGL essay's loss curve slopes; CHEM's is a cliff at hour 0.
3. Click **Request an extension** → `/proposals` → the draft cites the actual syllabus sentence → **Send**.

## Risks

| Risk | Mitigation |
|---|---|
| Policy extraction is wrong and the student trusts a bad number | Always show `quote` + a confidence pill next to any number; refuse to show a per-hour cost when `confidence < 0.5`. |
| Most real courses have an unreadable syllabus, so the feature looks empty | The `unknown_reason` states turn "empty" into "here's exactly why, and here's the Canvas link" — and the ranking still works from deadline + weight alone. Build that path first, not last. |
| The weight estimate is approximate | Label it `≈` everywhere, and explain the source in a tooltip ("from the syllabus grading table"). It upgrades itself to Canvas's real weights, with no code change on your side, once feature 1 merges. |
| Score feels arbitrary to judges | The `reason` string names the two or three inputs that drove the ranking; the formula is three multiplicands and fits on a slide. |

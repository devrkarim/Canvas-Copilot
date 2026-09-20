# Feature 1 — Grade what-if calculator + grade-drop alerts

**Owner:** you · **Branch:** `feat/grades` · **Depends on:** Task 0 (which you also did)

## Before you start

```bash
git checkout main && git pull
git log --oneline -1          # must be the chore/feature-scaffold commit
git checkout -b feat/grades
```

You own exactly these paths, and nothing else — run `npm run check:ownership` before each commit:

```
lib/features/grades/**   app/grades/**   app/api/grades/**
app/components/cards/GradesCard.tsx   scripts/seed-grades.ts
tests/grades.test.ts   docs/features/grades.md
```

Teammate B's branch imports `lib/features/grades/weights.ts` from the scaffold. **Its signature is frozen** — see "The weight contract" below. You may fill in the body freely; you may not change the exported shape without telling B first.

## The pitch

> "I have an 88.4% in CHEM 122. What do I need on the final to keep an A−?"
> → **"You need 91.2% on the final (worth 35%). If you get an 85 you land at 86.1% (B+)."**

Plus: every sync diffs your grades against the last snapshot, so the dashboard can say *"CHEM dropped 91 → 88 because HW4 came back 0/20 — it's marked missing."*

This is the judges' favourite because it is exact, verifiable arithmetic on their real data, and because the answer is actionable.

## Scope

**In:** per-course current grade, weighted-group breakdown, required-score solver, scenario what-ifs, grade change/drop detection, chat tools, `/grades` page, dashboard card.
**Out (backlog):** rubric checklists, feedback digest, GPA across courses, drop-lowest-N rules beyond what Canvas reports.

## Files you own

```
lib/features/grades/schema.ts     ← fill in the stub
lib/features/grades/canvas.ts     ← new: your Canvas endpoint wrappers
lib/features/grades/store.ts      ← new: reads/writes your tables
lib/features/grades/compute.ts    ← new: PURE math, no db, no network
lib/features/grades/weights.ts    ← fill in the stub — FROZEN SIGNATURE, feature 2 imports it
lib/features/grades/sync.ts       ← fill in the stub
lib/features/grades/tools.ts      ← fill in the stub
app/api/grades/route.ts           ← GET  /api/grades
app/api/grades/whatif/route.ts    ← POST /api/grades/whatif
app/api/grades/refresh/route.ts   ← POST /api/grades/refresh
app/grades/page.tsx               ← replace the stub
app/components/cards/GradesCard.tsx
scripts/seed-grades.ts
tests/grades.test.ts
docs/features/grades.md
```

Do not touch anything else. In particular you do **not** add columns to `assignments` — your scores live in `grade_items`, keyed by `assignment_id`.

## Data model (`GRADES_SCHEMA`)

```sql
CREATE TABLE IF NOT EXISTS grade_groups (
  id INTEGER PRIMARY KEY,            -- Canvas assignment_group id
  course_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  group_weight REAL,                 -- percent; NULL when the course isn't weighted
  drop_lowest INTEGER NOT NULL DEFAULT 0,
  drop_highest INTEGER NOT NULL DEFAULT 0,
  position INTEGER,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS grade_items (
  assignment_id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL,
  group_id INTEGER,
  name TEXT NOT NULL,
  points_possible REAL,
  score REAL,                        -- NULL = not graded yet
  graded_at TEXT,
  excused INTEGER NOT NULL DEFAULT 0,
  missing INTEGER NOT NULL DEFAULT 0,
  omit_from_final_grade INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grade_items_course ON grade_items(course_id);

CREATE TABLE IF NOT EXISTS grade_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  computed_score REAL,               -- what compute.ts derived
  canvas_score REAL,                 -- enrollment.grades.current_score, when available
  graded_count INTEGER NOT NULL,
  captured_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grade_snapshots_course ON grade_snapshots(course_id, captured_at);

CREATE TABLE IF NOT EXISTS grade_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  kind TEXT NOT NULL,                -- 'drop' | 'rise' | 'new_grade'
  delta REAL,                        -- percentage points, signed
  from_score REAL,
  to_score REAL,
  cause TEXT,                        -- "HW4 came back 0/20 (marked missing)"
  assignment_id INTEGER,
  seen INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
```

## Canvas endpoints (`lib/features/grades/canvas.ts`)

Build on `canvasGet` / `canvasGetAll` from `@/lib/canvas/client` — do not edit `lib/canvas/api.ts`.

```ts
// Groups + their assignments + your submission, in one call per course.
export const listAssignmentGroups = (courseId: number) =>
  canvasGetAll<CanvasAssignmentGroup>(`/api/v1/courses/${courseId}/assignment_groups`, {
    include: ["assignments", "submission", "score_statistics"],
    override_assignment_dates: false,
  });

// Canvas's own current/final score, to cross-check our math.
export const listMyEnrollments = () =>
  canvasGetAll<CanvasEnrollment>("/api/v1/users/self/enrollments", { state: ["active"] });

// Tells you whether the course weights groups at all.
export const getCourseGradingFlags = (courseId: number) =>
  canvasGet<{ id: number; apply_assignment_group_weights?: boolean }>(`/api/v1/courses/${courseId}`);
```

Declare the response shapes as local interfaces in this file (`CanvasAssignmentGroup`, `CanvasEnrollment`) — `lib/canvas/types.ts` is frozen.

Relevant fields: `assignment_group.group_weight`, `.rules.drop_lowest`, `assignment.omit_from_final_grade`, `submission.score`, `.graded_at`, `.excused`, `.missing`, `enrollment.grades.current_score`.

## The math (`compute.ts` — pure, no imports from `lib/db`)

This file is the heart of the feature and the easiest thing to unit-test. Keep it free of I/O.

```ts
export interface Item { assignmentId: number; groupId: number | null; pointsPossible: number | null;
                        score: number | null; excused: boolean; omit: boolean }
export interface Group { id: number; name: string; weight: number | null; dropLowest: number; dropHighest: number }

/** Group percentage after applying drop rules; null when nothing is graded in it. */
export function groupPercent(group: Group, items: Item[]): number | null;

/** Current course grade. Weighted when any group has a weight, else total points. */
export function courseGrade(groups: Group[], items: Item[], weighted: boolean): {
  percent: number | null;
  letter: string;
  perGroup: Array<{ group: Group; percent: number | null; earned: number; possible: number; weightUsed: number }>;
  /** Weights renormalised over groups that actually have graded work — this is the subtle bit. */
  gradedWeightTotal: number;
};

/** "What do I need on the remaining work in `groupId` to end at `targetPercent`?" */
export function requiredScore(args: {
  groups: Group[]; items: Item[]; weighted: boolean;
  targetPercent: number; scopeGroupId?: number; scopeAssignmentIds?: number[];
}): { requiredPercent: number | null; achievable: boolean; alreadyLocked: boolean; explanation: string };

/** Apply hypothetical scores and recompute. */
export function simulate(groups: Group[], items: Item[], weighted: boolean,
                         overrides: Array<{ assignmentId: number; score: number }>): number | null;

export function letterFor(percent: number, scale?: Array<{ letter: string; min: number }>): string;
export const DEFAULT_SCALE = [ { letter: "A", min: 93 }, { letter: "A-", min: 90 }, /* … */ ];
```

Edge cases the tests must cover — these are where naive implementations get it wrong:

1. **Ungraded work is excluded, not treated as zero.** A course with one 10/10 quiz is 100%, not 4%.
2. **Weight renormalisation.** If Homework (40%) is the only graded group so far, the current grade is the homework percentage, not 40% of it.
3. **Excused items and `omit_from_final_grade` items drop out of both numerator and denominator.**
4. **`drop_lowest`** removes the item with the worst *percentage*, applied only to graded items.
5. **Unweighted courses** (`apply_assignment_group_weights === false`) use plain total points.
6. **`requiredPercent > 100`** → `achievable: false` with an explanation ("even a 100% on the final leaves you at 89.4%").
7. **Zero remaining points** → `alreadyLocked: true`.
8. **Points-possible of 0** must not divide by zero.

## The weight contract (`weights.ts`)

Task 0 created this file returning `null`; teammate B is already importing it. Fill in the body:

```ts
export function weightForAssignment(assignmentId: number): AssignmentWeight | null {
  // 1. load the grade_item + its grade_group; null if either is missing
  // 2. null if the course isn't weighted (group_weight IS NULL for every group)
  // 3. percent = group.group_weight / (number of items in that group that count
  //    toward the grade: excused and omit_from_final_grade excluded)
  // 4. round to 2 decimals; return { percent, source: "canvas", approximate: false }
}
```

Rules that keep B's fallback correct:

- **Return `null` rather than guessing.** Grades not synced, course unweighted, assignment has no group → `null`, and B falls back to the syllabus estimate. A wrong number is worse than no number here, because B's UI labels `null`-derived values with a visible `≈`.
- **Never throw.** B calls this inside a ranking loop over every assignment; an exception would take down `/api/triage`. Wrap the db access in try/catch and return `null` on error.
- **Keep it cheap** — same loop. Do one prepared query, or memoise per request; don't recompute the whole course grade per call.
- **Don't change the exported shape.** If you genuinely need to (say you want to express "approximate" weights too), message B *before* pushing, because it's a compile error on their branch.

Test both directions explicitly: with `grade_groups` empty it returns `null` for every id; after `seed-grades` it returns a plausible percent for a seeded CS 101 homework, and the per-course sum across all counted items is ≈100.

## Sync hook (`sync.ts`)

```ts
export async function syncGrades(ctx: FeatureSyncCtx) {
  if (!canvasConfigured()) return;          // seed-only mode: silently skip
  for (const course of allCourses()) {
    const groups = await listAssignmentGroups(course.id);
    upsertGroupsAndItems(course.id, groups);
  }
  attachCanvasScores(await listMyEnrollments());
  detectChanges();                           // writes grade_alerts, then a fresh grade_snapshots row
}
```

`detectChanges()`: for each course, compare `courseGrade(...)` against the most recent snapshot.
- Δ ≤ −1.0 point → `kind: 'drop'`; Δ ≥ +1.0 → `'rise'`; new graded items with no score change → `'new_grade'`.
- **Cause attribution:** find `grade_items` whose `graded_at` is newer than the last snapshot, rank by the size of their effect on the final grade (use `simulate()` to remove each candidate), and describe the top one: `"HW4 came back 0/20 (marked missing) — that's −3.1 points"`.
- Never create an alert on the very first snapshot for a course.

## API routes

| Route | Behaviour |
|---|---|
| `GET /api/grades` | `{ timezone, courses: [{ id, code, name, percent, letter, weighted, perGroup, ungradedCount, canvasScore, lastAlert }], alerts: [...] }` |
| `POST /api/grades/whatif` | body `{ course, target?: number \| letter, scope?: { groupId? , assignmentIds? }, overrides?: [{assignmentId, score}] }` → `{ requiredPercent, achievable, projectedPercent, projectedLetter, explanation }` |
| `POST /api/grades/refresh` | runs the sync hook for grades only; returns counts; 409-style JSON error `{ error }` when Canvas isn't configured |

Follow the existing route style: `export const dynamic = "force-dynamic"`, `Response.json(...)`, errors as `{ error: string }` with a status.

## Chat tools (`tools.ts`)

Wrap each with `eager` from `@/lib/tools/shared`, and reuse `findCourse` / `courseLabel` / `courseArg` from there.

| Tool | Input | Returns |
|---|---|---|
| `get_grades` | `{ course?: courseArg }` | Current percent + letter per course, per-group breakdown, count of ungraded items, whether the course is weighted |
| `what_if_grade` | `{ course, target?: string, scope_group?: string, scope_assignment?: string, hypothetical_scores?: [{assignment, score}] }` | The solver result in one sentence plus the numbers. Accept `target` as `"A-"` or `"90"`. |
| `get_grade_alerts` | `{ days?: number }` | Recent drops/rises with the attributed cause — this is what makes the morning brief say something useful |

Tool descriptions matter more than the code here; write them so the model reaches for `what_if_grade` on "can I still get an A" phrasing, and note in the description that ungraded work is excluded from the current grade.

## UI

**`/grades` page** — reuse `Card`, `Pill`, `Button`, `fmt` from `@/app/components/ui`; match `app/forecast/page.tsx` structure (client component, `useEffect` fetch, `msg` banner).

- One card per course: big percent + letter, a weight bar (each group sized by weight, filled by performance), "3 items not yet graded".
- A **what-if panel**: pick a course, pick a target letter from a `<select>`, and see *"You need **91.2%** on the remaining Final (35% of the grade)."* Underneath, a list of ungraded items with number inputs for hypothetical scores and a live projected grade (call `/api/grades/whatif` on change, debounced ~300 ms).
- An **alerts strip** at the top when `grade_alerts.seen = 0`, with a "mark read" button.

**`GradesCard.tsx`** — a compact `Card title="Grades"`: one line per course (`CS 101 · 91.4% A−`), with a red/green delta pill when there's a recent alert, and a link to `/grades`. Render `null` until `/api/grades` returns at least one course with a percent, so the dashboard stays clean pre-sync.

## Seed data (`scripts/seed-grades.ts`)

Delete only `grade_groups`, `grade_items`, `grade_snapshots`, `grade_alerts`. Then, against the existing demo courses (101 CS, 202 CHEM, 303 ENGL):

- Groups matching each course's syllabus weights in `scripts/seed-demo.ts` (CS: Homework 40 / Midterm 25 / Final 35; CHEM: Problem sets 20 / Labs 30 / Exams 50; ENGL: Essays 60 / Participation 15 / Final 25), with `drop_lowest = 1` on CS Homework so the drop rule is demoable.
- Graded items that reproduce a realistic mid-semester picture, plus **ungraded** finals and midterms so the solver has something to solve for.
- Give CHEM a 0/20 missing problem set and **two snapshots** (an older one at ~91%, a current one at ~88%) plus the matching `grade_alerts` row, so the drop alert demos without any sync.
- Make ENGL unweighted-ish/sparse so the "not enough graded work yet" path renders.

## Tests (`tests/grades.test.ts`)

```ts
beforeAll(async () => {
  await import("../scripts/seed-demo.ts");
  await import("../scripts/seed-grades.ts");
});
```

Cover, in `compute.ts` (pure, fast, no seed needed):
- weighted vs unweighted courses
- weight renormalisation with only one group graded
- excused / `omit_from_final_grade` exclusion
- `drop_lowest` picks the worst *percentage*, not the worst points
- `requiredScore` → unachievable path (`>100`) and locked path (nothing left)
- `simulate` monotonicity: raising a hypothetical score never lowers the projected grade
- zero `points_possible` doesn't produce `NaN`

And over the seeded db:
- `get_grades` returns three courses, CHEM ≈ 88
- `what_if_grade` for `{course: "CHEM 122", target: "A-"}` returns a number between 0 and 100 with `achievable` correctly set
- `get_grade_alerts` surfaces the CHEM drop with the missing problem set named
- `weightForAssignment` returns `null` for an unknown id and a sane percent for a seeded CS 101 homework; the counted items in one group sum to that group's weight (this is the contract teammate B depends on — if it regresses, their triage numbers silently go wrong)

## Demo (30 s)

1. `/grades` → "CHEM 122 dropped 91 → 88; HW4 came back 0/20."
2. What-if panel → target **A−** → "you need 91.2% on the final."
3. Type 85 into the final → projected 86.1%, B+.
4. Chat: *"Can I still get an A in chem if I ace the final?"* → same numbers, in a sentence.

## Risks

| Risk | Mitigation |
|---|---|
| Canvas grade math has institution-specific rules (grading periods, late policy deductions applied server-side) | Show `canvas_score` beside our `computed_score` and label ours "estimated". If they diverge >1 point, say so in the UI rather than hiding it. |
| Letter-grade scale varies by school | `DEFAULT_SCALE` constant + allow a per-course override stored in `prefs` (`grade_scale:<course_id>`), which is an append-only key you already own. |
| Big courses → one API call per course on every sync | Only `assignment_groups` per course (already one call each); reuse `submission` from the same include instead of a second pass. |

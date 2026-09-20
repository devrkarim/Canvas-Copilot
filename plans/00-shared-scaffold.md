# Task 0 — Shared scaffold (you, first, alone, merged before anyone else branches)

**Owner:** you
**Branch:** `chore/feature-scaffold`
**Size:** ~300 lines, almost all stubs. 60–90 minutes.
**Blocking:** all four feature branches. Nobody — including you — starts a feature until this is on `main`.

**When it's merged**, message B, C and D:

> Scaffold is on `main`. `git checkout main && git pull`, confirm `git log --oneline -1` shows the scaffold commit, then branch: B → `feat/triage` (plans/02), C → `feat/conflicts` (plans/03), D → `feat/study` (plans/04). Read `plans/README.md` §3–4 and your own plan; you don't need anything else. Run `npm run check:ownership` before each commit.

Then you start `plans/01-grade-whatif.md` on `feat/grades`, in parallel with them.

## Why

Four features all want to: create tables, register chat tools, hook into sync, add a nav link, add a dashboard card, add a seed script. If each person edits `lib/db.ts` / `lib/tools/index.ts` / `Nav.tsx` / `app/page.tsx` / `package.json`, every pair of branches conflicts.

So Task 0 edits each of those files **once**, wiring in four empty, pre-named stubs. After that, every shared file is frozen and each member only fills in files nobody else touches.

## Directory layout this creates

```
lib/features/
  schemas.ts            ← registry: pure SQL strings (imported by lib/db.ts)
  tools.ts              ← registry: chat tools
  sync.ts               ← registry: post-sync hooks
  grades/   schema.ts  tools.ts  sync.ts  weights.ts   (stubs — you; weights.ts is read by feature 2)
  triage/   schema.ts  tools.ts  sync.ts               (stubs — teammate B)
  conflicts/schema.ts  tools.ts  sync.ts               (stubs — teammate C)
  study/    schema.ts  tools.ts  sync.ts               (stubs — teammate D)
app/components/cards/
  GradesCard.tsx  TriageCard.tsx  ConflictsCard.tsx  StudyCard.tsx   (stubs)
app/components/FeatureCards.tsx
app/grades/page.tsx  app/triage/page.tsx  app/conflicts/page.tsx  app/study/page.tsx  (stubs)
scripts/seed-grades.ts  seed-triage.ts  seed-conflicts.ts  seed-study.ts            (stubs)
scripts/check-ownership.mjs
docs/features/.gitkeep
```

Every one of those stubs exists so that nobody ever has to edit a file someone else owns. Create all of them in this one PR, even the three you'll never touch again.

## Step 1 — Schema registry

`lib/features/schemas.ts`:

```ts
/**
 * Feature table definitions. PURE STRINGS ONLY.
 * lib/db.ts imports this, and lib/db.ts must stay dependency-free so that
 * `npm run seed` (node --experimental-strip-types) can load it. Hence the
 * explicit ./x.ts specifiers and no imports of anything but sibling schemas.
 */
import { GRADES_SCHEMA } from "./grades/schema.ts";
import { TRIAGE_SCHEMA } from "./triage/schema.ts";
import { CONFLICTS_SCHEMA } from "./conflicts/schema.ts";
import { STUDY_SCHEMA } from "./study/schema.ts";

export const FEATURE_SCHEMAS = [GRADES_SCHEMA, TRIAGE_SCHEMA, CONFLICTS_SCHEMA, STUDY_SCHEMA];
```

Each of the four stubs, e.g. `lib/features/grades/schema.ts`:

```ts
/** Owner: you (plans/01). Tables for the grade what-if calculator. */
export const GRADES_SCHEMA = ``;
```

`lib/db.ts` — the only edit (two lines):

```ts
import { FEATURE_SCHEMAS } from "./features/schemas.ts";   // top of file
// ...inside db(), right after conn.exec(SCHEMA):
for (const s of FEATURE_SCHEMAS) if (s.trim()) conn.exec(s);
```

Everything is `CREATE TABLE IF NOT EXISTS`, so this is additive and safe on an existing `data/app.db`.

## Step 2 — Tool registry (+ extract shared helpers)

`lib/tools/index.ts` currently keeps `findCourse` / `courseLabel` / `courseArg` / `json` / `eager` private. Move them verbatim into a new `lib/tools/shared.ts` and export them:

```ts
// lib/tools/shared.ts — helpers shared by core tools and all feature tools.
import { z } from "zod";
import { db, type CourseRow } from "@/lib/db";

export function courses(): CourseRow[] { /* moved verbatim */ }
export function findCourse(query: string | number | undefined): CourseRow | undefined { /* moved verbatim */ }
export function courseLabel(c: CourseRow | undefined, id?: number) { /* moved verbatim */ }
export const courseArg = z.string().optional().describe("Course code, name fragment, or numeric id. Omit for all courses.");
export function json(v: unknown) { return JSON.stringify(v, null, 1); }
export function eager<T extends object>(tool: T): T & { eager_input_streaming: true } { return { ...tool, eager_input_streaming: true }; }
```

`lib/features/tools.ts`:

```ts
// Feature tool registry. Each feature owns one file under lib/features/<f>/tools.ts.
// HARD RULE for feature authors: those files import helpers from "@/lib/tools/shared",
// never from "@/lib/tools" — importing the index is a circular import and breaks
// the chat route at runtime.
import { gradeTools } from "./grades/tools";
import { triageTools } from "./triage/tools";
import { conflictTools } from "./conflicts/tools";
import { studyTools } from "./study/tools";

/** A feature's tools. `unknown[]` keeps the registry independent of the SDK's
 *  per-tool generic types; lib/tools/index.ts casts once at the boundary. */
export interface FeatureToolSet { read: unknown[]; write: unknown[] }

const all: FeatureToolSet[] = [gradeTools, triageTools, conflictTools, studyTools];
export const featureReadTools = all.flatMap((f) => f.read);
export const featureWriteTools = all.flatMap((f) => f.write);
```

Each stub, e.g. `lib/features/grades/tools.ts`:

```ts
import type { FeatureToolSet } from "../tools";
/** Owner: you (plans/01). Chat + briefing tools for grades. Wrap each with eager(). */
export const gradeTools: FeatureToolSet = { read: [], write: [] };
```

`lib/tools/index.ts` — the only edits: import the helpers from `./shared`, re-export them for back-compat, and append the feature tools. Declare the core arrays first so there's a concrete type to cast to:

```ts
import { featureReadTools, featureWriteTools } from "@/lib/features/tools";

const coreReadTools = [
  getCourses, getUpcomingAssignments, getMissingAssignments, getAnnouncements, getCalendar,
  getSyllabus, getOfficeHours, findOfficeHoursSlot, getWorkloadForecast, getPendingProposals,
].map(eager);
const coreWriteTools = [proposeCalendarEvent, proposeMessage].map(eager);

export const readTools = [...coreReadTools, ...(featureReadTools as typeof coreReadTools)];
export const writeTools = [...coreWriteTools, ...(featureWriteTools as typeof coreWriteTools)];
export const allTools = [...readTools, ...writeTools];
```

A single downcast from `unknown[]` at one boundary, rather than four features fighting the SDK's generics. Verify with `npm run typecheck` before moving on — this is the one step in Task 0 that can fail to compile.

> **Circular-import rule** (already in the comment above, and repeated in each feature plan): feature tool files import `@/lib/tools/shared`, never `@/lib/tools`.

## Step 2b — The grade-weight seam (`lib/features/grades/weights.ts`)

This is the only thing one feature needs from another, and creating it now — as a stub with its final signature — is what lets B start immediately and never touch your code.

```ts
/**
 * Share of a course's final grade that one assignment carries, derived from
 * synced Canvas assignment groups.
 *
 * Owner: you (filled in by plans/01). Consumer: feature 2 (triage), which imports
 * this from day one and falls back to its own syllabus-based estimate on null.
 *
 * ⚠️ SIGNATURE IS FROZEN. Changing it breaks feat/triage. Fill in the body, not the shape.
 */
export interface AssignmentWeight {
  /** Percentage points of the final course grade, e.g. 3.0 for "3% of the grade". */
  percent: number;
  source: "canvas";
  approximate: false;
}

/** Returns null when grades have not been synced, when the course isn't weighted,
 *  or when the assignment has no group — the caller must handle null. */
export function weightForAssignment(_assignmentId: number): AssignmentWeight | null {
  return null; // implemented in plans/01
}
```

Do not add a `lib/features/weights.ts` at the top level and do not re-export it from anywhere else — one path, `@/lib/features/grades/weights`, is what B's plan names.

## Step 3 — Sync hook registry

`lib/features/sync.ts`:

```ts
export interface FeatureSyncCtx {
  /** Push human-readable problems here; they surface in the sync banner. */
  warnings: string[];
  /** False when extraction was skipped or ANTHROPIC_API_KEY is missing — skip LLM work. */
  extract: boolean;
}

import { syncGrades } from "./grades/sync";
import { syncTriage } from "./triage/sync";
import { syncConflicts } from "./conflicts/sync";
import { syncStudy } from "./study/sync";

const hooks: Array<[string, (ctx: FeatureSyncCtx) => Promise<void>]> = [
  ["grades", syncGrades], ["triage", syncTriage], ["conflicts", syncConflicts], ["study", syncStudy],
];

/** Runs after the core sync. One feature failing never fails the sync. */
export async function runFeatureSyncs(ctx: FeatureSyncCtx) {
  for (const [name, fn] of hooks) {
    try { await fn(ctx); } catch (e) { ctx.warnings.push(`${name}: ${(e as Error).message}`); }
  }
}
```

Stub, e.g. `lib/features/grades/sync.ts`:

```ts
import type { FeatureSyncCtx } from "../sync";
/** Owner: you (plans/01). */
export async function syncGrades(_ctx: FeatureSyncCtx): Promise<void> {}
```

`lib/sync.ts` — the only edit, immediately before `return report;` in `runSync`:

```ts
await runFeatureSyncs({ warnings: report.warnings, extract: extract && llmConfigured() });
```

> Note the ctx-object indirection: it exists so `lib/features/sync.ts` doesn't import `SyncReport` from `lib/sync.ts`, which would be a cycle.

## Step 4 — Nav + stub pages

`app/components/Nav.tsx` — extend `links` to the final eight, once:

```ts
const links = [
  { href: "/", label: "Dashboard" },
  { href: "/chat", label: "Chat" },
  { href: "/proposals", label: "Proposals" },
  { href: "/forecast", label: "Forecast" },
  { href: "/grades", label: "Grades" },
  { href: "/triage", label: "Triage" },
  { href: "/conflicts", label: "Conflicts" },
  { href: "/study", label: "Study" },
];
```

The header already has `overflow-x-auto`, so eight links are fine.

Create four stub pages so nothing 404s, e.g. `app/grades/page.tsx`:

```tsx
export default function GradesPage() {
  return <p className="text-sm text-zinc-500">Grades — coming soon.</p>;
}
```

## Step 5 — Dashboard card slot

`app/components/cards/GradesCard.tsx` (and the other three):

```tsx
"use client";
/** Owner: you (plans/01). Return null until implemented — the dashboard renders this as-is. */
export function GradesCard() { return null; }
```

`app/components/FeatureCards.tsx`:

```tsx
"use client";
import { GradesCard } from "./cards/GradesCard";
import { TriageCard } from "./cards/TriageCard";
import { ConflictsCard } from "./cards/ConflictsCard";
import { StudyCard } from "./cards/StudyCard";

export function FeatureCards() {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <GradesCard /><TriageCard /><ConflictsCard /><StudyCard />
    </div>
  );
}
```

`app/page.tsx` — the only edit: import it and drop `<FeatureCards />` in one place, right after the existing 2×2 grid (the block that ends with the "Office hours (from syllabi)" card) and before `<Card title="Recent announcements">`.

Each card fetches its own `/api/<feature>` endpoint in a `useEffect` and renders `null` while empty, so a feature that isn't merged yet costs nothing.

## Step 6 — Seed scripts + package.json

Stub, e.g. `scripts/seed-grades.ts`:

```ts
/**
 * Owner: you (plans/01). Adds grade demo data on top of `npm run seed`.
 * Always: delete only THIS feature's tables, then insert. Run after seed-demo.
 */
import { db } from "../lib/db.ts";
const conn = db();
void conn;
```

`package.json` — the only edit, all five lines at once:

```json
"seed:grades": "node --experimental-strip-types --no-warnings scripts/seed-grades.ts",
"seed:triage": "node --experimental-strip-types --no-warnings scripts/seed-triage.ts",
"seed:conflicts": "node --experimental-strip-types --no-warnings scripts/seed-conflicts.ts",
"seed:study": "node --experimental-strip-types --no-warnings scripts/seed-study.ts",
"seed:all": "npm run seed && npm run seed:grades && npm run seed:triage && npm run seed:conflicts && npm run seed:study",
"check:ownership": "node scripts/check-ownership.mjs"
```

## Step 7 — Briefing prompt seam

`lib/briefing.ts` — the only edit, one bullet added to `SYSTEM` so all four features can surface urgent items in the morning brief without anyone else touching this file:

```
- Before the sections, if any tool reports an urgent item (a grade drop, a high-risk deadline, a schedule conflict), lead with a single **Heads-up** line.
```

## Step 8 — The ownership guard (`scripts/check-ownership.mjs`)

This is what turns "please don't touch other people's files" into something mechanical. It infers the feature from the current branch name and fails if the diff against `main` steps outside that feature's six paths.

```js
#!/usr/bin/env node
// Fails if the current branch touches files outside its feature's paths.
// Usage: npm run check:ownership          (infers feature from the branch name)
//        npm run check:ownership -- study (explicit)
import { execSync } from "node:child_process";

const OWNED = {
  grades:    [/^lib\/features\/grades\//, /^app\/grades\//, /^app\/api\/grades\//,
              /^app\/components\/cards\/GradesCard\.tsx$/, /^scripts\/seed-grades\.ts$/,
              /^tests\/grades\.test\.ts$/, /^docs\/features\/grades\.md$/],
  triage:    [/^lib\/features\/triage\//, /^app\/triage\//, /^app\/api\/triage\//,
              /^app\/components\/cards\/TriageCard\.tsx$/, /^scripts\/seed-triage\.ts$/,
              /^tests\/triage\.test\.ts$/, /^docs\/features\/triage\.md$/],
  conflicts: [/^lib\/features\/conflicts\//, /^app\/conflicts\//, /^app\/api\/conflicts\//,
              /^app\/components\/cards\/ConflictsCard\.tsx$/, /^scripts\/seed-conflicts\.ts$/,
              /^tests\/conflicts\.test\.ts$/, /^docs\/features\/conflicts\.md$/],
  study:     [/^lib\/features\/study\//, /^app\/study\//, /^app\/api\/study\//,
              /^app\/components\/cards\/StudyCard\.tsx$/, /^scripts\/seed-study\.ts$/,
              /^tests\/study\.test\.ts$/, /^docs\/features\/study\.md$/],
};

const sh = (c) => execSync(c, { encoding: "utf8" }).trim();
const branch = sh("git rev-parse --abbrev-ref HEAD");
const feature = process.argv[2] ?? branch.replace(/^feat\//, "");

if (!OWNED[feature]) {
  console.log(`check:ownership — no rules for "${feature}" (branch ${branch}); skipping.`);
  process.exit(0);
}

const lines = (c) => sh(c).split("\n").filter(Boolean);
const base = sh("git merge-base main HEAD");
const changed = [...new Set([
  ...lines(`git diff --name-only ${base} HEAD`),        // committed on this branch
  ...lines("git diff --name-only HEAD"),                // staged + unstaged
  ...lines("git ls-files --others --exclude-standard"), // untracked new files
])];

const stray = changed.filter((f) => !OWNED[feature].some((re) => re.test(f)));

if (stray.length) {
  console.error(`\n❌ feat/${feature} touches ${stray.length} file(s) it does not own:\n`);
  for (const f of stray) console.error(`   ${f}`);
  console.error(`\nThese are owned by someone else or frozen after the scaffold.`);
  console.error(`Revert them (git checkout ${base} -- <file>) or raise it in the group chat.`);
  console.error(`See plans/README.md §4.2.\n`);
  process.exit(1);
}
console.log(`✅ feat/${feature}: ${changed.length} changed file(s), all owned.`);
```

Also add `docs/features/.gitkeep`, and append to `AGENTS.md`:

```
## Feature branches (see plans/README.md)
Frozen after chore/feature-scaffold: lib/db.ts, lib/tools/index.ts, lib/tools/shared.ts,
lib/sync.ts, lib/briefing.ts, lib/canvas/**, lib/features/{schemas,tools,sync}.ts,
app/page.tsx, app/components/{Nav,ui,FeatureCards}.tsx,
app/api/{status,dashboard,sync,chat,briefing,proposals,forecast}/**,
scripts/seed-demo.ts, package.json, README.md, .github/**.
Own only: lib/features/<yours>/**, app/<yours>/**, app/api/<yours>/**,
app/components/cards/<Yours>Card.tsx, scripts/seed-<yours>.ts, tests/<yours>.test.ts,
docs/features/<yours>.md.   Run `npm run check:ownership` before every commit.
```

## Step 9 — Rewrite CODEOWNERS and the PR template

Both currently encode the **old layer-based split** (A = Canvas/data, B = LLM, C = planner, D = frontend), which contradicts the feature-vertical ownership this plan sets up — under the existing file, `/app/components/` and `/scripts/` belong entirely to `@person-d`, so all four feature branches would request review from the wrong person.

Replace the body of `.github/CODEOWNERS` with:

```
# Feature-vertical ownership (see plans/README.md §4.2).
# Everything not listed below is shared: it was set by chore/feature-scaffold and is frozen.

# Shared / frozen — you review any change to these
/lib/                       @you
/app/                       @you
/scripts/                   @you
/.github/                   @you
/package.json               @you
/README.md                  @you

# Feature 1 — grades (you)
/lib/features/grades/               @you
/app/grades/                        @you
/app/api/grades/                    @you
/app/components/cards/GradesCard.tsx @you
/scripts/seed-grades.ts             @you
/tests/grades.test.ts               @you
/docs/features/grades.md            @you

# Feature 2 — triage (B)
/lib/features/triage/               @person-b
/app/triage/                        @person-b
/app/api/triage/                    @person-b
/app/components/cards/TriageCard.tsx @person-b
/scripts/seed-triage.ts             @person-b
/tests/triage.test.ts               @person-b
/docs/features/triage.md            @person-b

# Feature 3 — conflicts (C)   … same seven lines with conflicts/ConflictsCard/@person-c
# Feature 4 — study (D)       … same seven lines with study/StudyCard/@person-d
```

CODEOWNERS is last-match-wins, so the broad `/lib/` rule must come *before* the feature rules — that way a stray edit to a frozen file lands on your review queue, while feature paths route to their owner.

Replace the `## Area` block in `.github/pull_request_template.md`:

```markdown
## Feature
- [ ] 0 scaffold  - [ ] 1 grades  - [ ] 2 triage  - [ ] 3 conflicts  - [ ] 4 study

## Checks
- [ ] `npm run typecheck`  - [ ] `npm test`  - [ ] `npm run lint`
- [ ] `npm run check:ownership` passes (no files outside my feature's paths)
- [ ] Works on seed data with no CANVAS_TOKEN and no ANTHROPIC_API_KEY
- [ ] I did not edit a frozen file (plans/README.md §4.2)
```

## Acceptance

- [ ] `npm run typecheck`, `npm run lint`, `npm test` all green (existing tests untouched)
- [ ] `npm run seed` still works (this is the canary for the `lib/db.ts` import — if the `@/` alias crept in, it fails here)
- [ ] `npm run seed:all` runs and is a no-op beyond `seed`
- [ ] `npm run check:ownership` runs on `chore/feature-scaffold` and prints the "no rules, skipping" line (the scaffold branch is deliberately exempt)
- [ ] Sanity-check the guard: `git checkout -b feat/triage && touch lib/db.ts && npm run check:ownership` exits 1 and names `lib/db.ts`; then delete the branch
- [ ] `lib/features/grades/weights.ts` exists, exports `weightForAssignment` returning `null`, and typechecks — teammate B's branch depends on this file existing
- [ ] `npm run dev`: all eight nav links load, the dashboard is visually unchanged
- [ ] Chat still answers "what's due this week?" (proves the tool registry didn't break the runner)
- [ ] Merged to `main`, and the kickoff message at the top of this file has been sent to B, C and D

Then, and only then, start `plans/01-grade-whatif.md`.

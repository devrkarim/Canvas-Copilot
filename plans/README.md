# Canvas Copilot — feature gap analysis & 4-way parallel build plan

Written against commit `9890824` (the current `main`).

This folder contains:

| File | Who | What it is |
|---|---|---|
| `README.md` (this file) | everyone reads | What's already built, what isn't, which 4 features we're building, who owns what, and the rules that keep merges clean |
| `00-shared-scaffold.md` | **you** | **Task 0** — a single PR that must land on `main` *before* anyone else starts. It carves out the seams so the four features never touch the same lines. |
| `01-grade-whatif.md` | **you** | Grade what-if calculator + grade-drop alerts |
| `02-triage-priority.md` | teammate B | Late-policy-aware prioritization + extension requests |
| `03-conflict-detector.md` | teammate C | Syllabus ↔ Canvas discrepancy & schedule conflict detector |
| `04-study-pack.md` | teammate D | Module digest, flashcards & quiz prep |

**Reading order.** You read `00` then `01` and do both. Each teammate reads this file (sections 3 and 4 only) plus their own numbered plan, and needs nothing else — no plan requires coordinating with another person mid-build.

---

## 1. What is already implemented

Verified by reading the source, not the README claims.

| Planned feature | Status | Where |
|---|---|---|
| Assignment reminders (upcoming / missing) | ✅ Done | `lib/tools/index.ts` (`get_upcoming_assignments`, `get_missing_assignments`), `app/page.tsx`, `lib/briefing.ts` |
| Announcements → calendar proposals | ✅ Done | `lib/extract/announcement.ts`, `lib/sync.ts:271` (`processNewAnnouncements`) |
| Missed assignment → drafted instructor message | ✅ Done | `propose_message` tool + `lib/proposals.ts` |
| Syllabus reading (office hours, late policy, weights, exam dates) | ✅ Done | `lib/extract/syllabus.ts`, `lib/sync.ts:203` |
| Office hours → calendar + "when am I free for office hours" | ✅ Done | `find_office_hours_slot`, syllabus-driven `calendar_create` proposals |
| Daily briefing | ✅ Done (Discord only) | `lib/briefing.ts`, `instrumentation.ts` cron |
| Weekly workload forecast + study plan packing | ✅ Done | `lib/forecast.ts`, `app/forecast/page.tsx` |
| Natural-language chat over everything | ✅ Done | `app/api/chat/route.ts` + shared tool set |
| Human-in-the-loop proposals inbox | ✅ Done | `lib/proposals.ts`, `app/proposals/page.tsx` |

## 2. What is **not** implemented

| Planned feature | Status | Notes |
|---|---|---|
| **Grade "what-if" calculator** | ❌ Not started | `courses.grading_weights` is extracted from the syllabus but never used for math. No assignment groups, no per-course grade, no solver. |
| **Late-policy-aware prioritization** | ❌ Not started | `courses.late_policy` is stored as free text only. No structured penalty model, no "expected grade loss per hour of delay" ranking. |
| **Syllabus vs Canvas discrepancy detector** | ❌ Not started | `courses.exam_dates` is extracted and then never compared to anything. |
| **Conflict detection** (two exams one day, assignment due during an event) | ❌ Not started | Calendar events are stored but only used as *busy* blocks by the planner. |
| **Grade posted / grade drop alerts** | ❌ Not started | `assignments.score` is synced but never diffed across syncs. |
| **Module digest** (pages/files/PDF slides → summary, flashcards) | ❌ Not started | No `modules`, `pages`, or `files` endpoints wrapped. |
| **Quiz prep** | ❌ Not started | No `quizzes` endpoint wrapped. |
| **Rubric → checklist** | ❌ Not started | No rubric data pulled. |
| **Feedback digest** (submission comments + rubric assessments) | ❌ Not started | No submission comments pulled. |
| **Extension request drafting** (pre-deadline, late-policy aware) | ❌ Not started | The generic `propose_message` tool exists, but there is no pre-deadline flow. |
| **Discussion board assistant** | ❌ Not started | No `discussion_topics` endpoint. |
| **Group project coordinator** | ❌ Not started | No Groups API. |
| **Peer review reminders** | ❌ Not started | No peer-review endpoint. |
| **Semester heatmap of crunch weeks** | ⚠️ Partial | Forecast covers 3 weeks with a per-day bar chart; no semester-wide view. |
| **Briefing via SMS / email** | ⚠️ Partial | Discord webhook only. |
| **Office-hours visit with pre-drafted question** | ⚠️ Partial | Slot matching works; the question draft does not exist. |
| **Export calendar to Google Calendar / ICS** | ❌ Not started | — |

## 3. The 4 features we're building

Chosen for (a) demo impact, (b) *disjoint data domains* so four people can work at once, and (c) each one fitting in a single person's hackathon-sized slice.

| # | Feature | Owner | Data domain it owns | New Canvas endpoints? | Plan |
|---|---|---|---|---|---|
| 0 | Shared scaffold | **you** | — | No | `00-shared-scaffold.md` |
| 1 | **Grade what-if calculator + grade-drop alerts** | **you** | assignment groups, scores, grade snapshots | Yes (`assignment_groups`, `enrollments`) | `01-grade-whatif.md` |
| 2 | **Late-policy-aware triage + extension requests** | teammate B | structured late policies, priority scores | No | `02-triage-priority.md` |
| 3 | **Discrepancy & conflict detector** | teammate C | cross-source conflicts | No | `03-conflict-detector.md` |
| 4 | **Module digest, flashcards & quiz prep** | teammate D | modules, pages, files, quizzes | Yes (`modules`, `pages`, `files`, `quizzes`) | `04-study-pack.md` |

Deliberately left in the backlog (not assigned to anyone): feedback digest, rubric checklist, discussion board, group coordinator, peer reviews, ICS export, SMS/email briefing, semester heatmap. Any of these is a good stretch task once a member's own feature is green.

## 4. How we keep merges clean

### 4.1 The one rule

> **After Task 0 lands, no feature branch may edit a file it does not own.**

Everything each feature needs from the shared codebase is pre-wired by Task 0 as an empty stub that exactly one person owns. If you find yourself wanting to edit `lib/db.ts`, `lib/tools/index.ts`, `lib/sync.ts`, `app/page.tsx`, `app/components/Nav.tsx`, `scripts/seed-demo.ts` or `package.json` — stop and post in the group chat instead. Those six files are frozen.

### 4.2 Ownership map

Exactly six paths per feature. Nothing outside this table may be created or edited on a feature branch.

| # | Path glob | Owner |
|---|---|---|
| 1 | `lib/features/grades/**`, `app/grades/**`, `app/api/grades/**`, `app/components/cards/GradesCard.tsx`, `scripts/seed-grades.ts`, `tests/grades.test.ts`, `docs/features/grades.md` | you |
| 2 | `lib/features/triage/**`, `app/triage/**`, `app/api/triage/**`, `app/components/cards/TriageCard.tsx`, `scripts/seed-triage.ts`, `tests/triage.test.ts`, `docs/features/triage.md` | B |
| 3 | `lib/features/conflicts/**`, `app/conflicts/**`, `app/api/conflicts/**`, `app/components/cards/ConflictsCard.tsx`, `scripts/seed-conflicts.ts`, `tests/conflicts.test.ts`, `docs/features/conflicts.md` | C |
| 4 | `lib/features/study/**`, `app/study/**`, `app/api/study/**`, `app/components/cards/StudyCard.tsx`, `scripts/seed-study.ts`, `tests/study.test.ts`, `docs/features/study.md` | D |
| — | Everything else (frozen after Task 0) | you |

Every glob is touched by exactly one branch, so git never has to merge a single file. Task 0 installs `npm run check:ownership`, which fails a branch that steps outside its own row — run it before every commit and you cannot create a conflict by accident.

**The one file every feature reads but only you write:** `lib/features/grades/weights.ts`. See §4.5.

### 4.3 Hard constraints everyone follows

1. **No `ALTER TABLE` on core tables.** Never add a column to `courses`, `assignments`, `announcements`, `calendar_events`, `office_hours`, `proposals`, `forecasts`, `study_blocks` or `briefings`. Put your data in your own tables, keyed by the core row's id.
2. **Read core tables freely; write only your own.** The single exception is `createProposal(...)` from `lib/db.ts` — that's the sanctioned way to produce a calendar change or a message, and it appends rows, so it never conflicts.
3. **Never write to Canvas directly.** `lib/proposals.ts` stays the only writer. If your feature needs a new *kind* of write, it becomes a proposal with an existing `type` (`calendar_create` / `calendar_update` / `message`).
4. **Feature tools import from `lib/tools/shared.ts`, never from `lib/tools/index.ts`** — importing the index creates a circular import and will break the chat route at runtime.
5. **Anything imported (even transitively) by `lib/db.ts` must be dependency-free and use relative `./x.ts` specifiers** — `npm run seed` runs under `node --experimental-strip-types`, which does not understand the `@/` alias. This applies to `lib/features/*/schema.ts`.
6. **Your seed script deletes only your own tables**, then inserts. Tests run `scripts/seed-demo.ts` first, then your seed, against one shared `data/test.db` with `fileParallelism: false`.
7. **One feature = one branch = one PR.** Branch names: `feat/grades`, `feat/triage`, `feat/conflicts`, `feat/study`.
8. **Don't edit `README.md`.** Write `docs/features/<yours>.md` instead; the scaffold owner folds them into the README in the final integration PR. Same for `.env.example` — it's gitignored (`.gitignore` line 34 ignores `.env*`), so document your env vars in your own `docs/features/<yours>.md` and mention them in the PR body.
9. **Never create a new shared file.** No `lib/features/common.ts`, no `lib/utils.ts`, no `app/components/cards/shared.tsx`, no new `tests/helpers.ts`. If two features would want the same helper, each writes its own copy inside its own folder — 20 duplicated lines are cheaper than a merge conflict and a cross-team dependency. The only shared helpers are the ones Task 0 creates.
10. **Run `npm run check:ownership` before every commit.** It diffs your branch against `main` and fails if you touched a path outside your row in §4.2. Treat a failure as "stop and ask in the group chat", never as "override it".

### 4.4 Timeline

```
YOU: Task 0 (scaffold)  ──►  merged to main
                             │
                             ├─► you send B, C, D: "scaffold is on main, pull and branch"
                             │
        ┌────────────────────┼──────────────┬──────────────┐
        │                    │              │              │
   YOU: 01 grades       B: 02 triage   C: 03 conflicts  D: 04 study
        │                    │              │              │
        └────────────────────┼──────────────┴──────────────┘
                             │   (fully parallel; no one waits on anyone,
                             │    no branch touches another branch's files)
                             │
                  merge in any order — zero conflicts by construction
                             │
                  YOU: integration PR (README, demo script)
```

Your 01 runs *concurrently* with the teammates' branches. Nothing in 02–04 waits for it, and nothing in 01 waits for them.

### 4.5 The cross-feature seam, pre-resolved in Task 0

Feature 2 (triage) needs "what share of the final grade is this assignment worth." Feature 1 (grades) is the thing that knows the real answer, from Canvas assignment groups. If B imported that lazily we'd get either a blocked teammate or a post-merge integration PR — so Task 0 removes the problem instead.

Task 0 creates **`lib/features/grades/weights.ts`** with its final signature and a body that returns `null`:

```ts
export interface AssignmentWeight { percent: number; source: "canvas"; approximate: false }
/** Share of the course's final grade this assignment carries, from synced Canvas
 *  assignment groups. Returns null when grades haven't been synced — callers must
 *  fall back to their own estimate. SIGNATURE IS FROZEN: feature 2 imports this. */
export function weightForAssignment(assignmentId: number): AssignmentWeight | null { return null; }
```

- **B imports it on day one** and writes the fallback path (syllabus `grading_weights` + keyword matcher) behind it. B's branch compiles and its tests pass against the stub, today, with feature 1 nowhere in sight.
- **You fill the body in during 01.** B's code does not change by one character; it simply starts getting real Canvas weights once your PR lands.
- **The signature is frozen.** If you need to change it, that's a conversation with B before you push, not after.

No post-merge integration PR, no pairing session, no ordering requirement between the two branches.

### 4.6 Why this is conflict-free, precisely

A git merge conflict needs two branches to change *the same lines of the same file*. After Task 0:

| Category | Files | Touched by |
|---|---|---|
| Shared plumbing | `lib/db.ts`, `lib/sync.ts`, `lib/briefing.ts`, `lib/tools/index.ts`, `lib/tools/shared.ts`, `lib/features/{schemas,tools,sync}.ts`, `app/page.tsx`, `app/components/{Nav,FeatureCards}.tsx`, `package.json`, `.github/**` | Task 0 only — **frozen afterwards** |
| Feature 1 | the six `grades` paths | your `feat/grades` only |
| Feature 2 | the six `triage` paths | B's `feat/triage` only |
| Feature 3 | the six `conflicts` paths | C's `feat/conflicts` only |
| Feature 4 | the six `study` paths | D's `feat/study` only |

The four feature branches have **pairwise empty file intersections**, so merging them is a fast-forward of disjoint file sets in any order. The two places where four features would normally collide are handled by pre-created stubs rather than by edits:

- **New tables** — each feature fills in its own `lib/features/<f>/schema.ts`; the registry `lib/features/schemas.ts` already imports all four and never changes again.
- **New chat tools / sync hooks / nav links / dashboard cards / seed scripts** — same pattern: the registry lists all four up front, each stub is filled in by exactly one person.

Three residual risks, and what closes each:

1. *Someone edits a frozen file anyway.* → `npm run check:ownership` + CODEOWNERS review requests (both installed by Task 0).
2. *Two people independently invent the same helper file.* → constraint 9 above: never create a shared file; duplicate instead.
3. *A teammate branches before Task 0 lands.* → don't send the "pull and branch" message until it's merged to `main`, and have them confirm `git log --oneline -1` shows the scaffold commit before they start (step 0 of each plan).

`data/app.db` is gitignored, so nobody's local database is a merge hazard either — but note that everyone's db gains all four feature tables as soon as they pull Task 0, since `CREATE TABLE IF NOT EXISTS` runs for every registered schema.

## 5. Definition of done (every feature)

- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean
- [ ] `npm test` green, including your new `tests/<feature>.test.ts`
- [ ] Works end-to-end on seed data alone (`npm run seed && npm run seed:<feature>`), with no `CANVAS_TOKEN` and no `ANTHROPIC_API_KEY` — degrade gracefully, never crash
- [ ] Your page renders, your dashboard card renders, your chat tools answer at least two natural-language questions
- [ ] `docs/features/<feature>.md` written: what it does, env vars, demo steps
- [ ] A 30-second slice of the demo script that a judge can follow

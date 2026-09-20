# Canvas Copilot — feature gap analysis & parallel build plan

Re-verified against commit `ad88578` (current `main`, after the starred-courses, PDF-syllabus, course-page, chat-formatting and parallel-sync work).

**Four builders, five plan files. You do two; each teammate does exactly one.**

| File | Who | What it is |
|---|---|---|
| `README.md` (this file) | everyone reads §3–4 | What's built, what isn't, the repo invariants every plan must respect, who owns what, and the rules that keep merges clean |
| `00-shared-scaffold.md` | **you** | **Task 0** — one PR that must land on `main` *before* anyone else starts. It carves out the seams so the features never touch the same lines. |
| `01-grade-whatif.md` | **you** | Grade what-if calculator + grade-drop alerts |
| `02-triage-priority.md` | **Part 1 → teammate B** | Late-policy-aware prioritization + extension requests |
| `03-conflict-detector.md` | **Part 2 → teammate C** | Syllabus ↔ Canvas discrepancy & schedule conflict detector |
| `04-study-pack.md` | **Part 3 → teammate D** | Module digest, flashcards & quiz prep |

**Reading order.** You read `00`, do it, merge it, then do `01`. Each teammate reads §3 and §4 of this file plus their own plan file — that is the complete set of instructions for their part. No plan requires asking another person anything mid-build.

---

## 1. What is already implemented

Verified by reading the source, not the README claims.

| Planned feature | Status | Where |
|---|---|---|
| Assignment reminders (upcoming / missing) | Done | `lib/tools/index.ts` (`get_upcoming_assignments`, `get_missing_assignments`), `app/page.tsx`, `lib/briefing.ts` |
| Announcements → calendar proposals | Done | `lib/extract/announcement.ts`, `processNewAnnouncements()` in `lib/sync.ts` |
| Missed assignment → drafted instructor message | Done | `propose_message` tool + `lib/proposals.ts` |
| Syllabus reading (office hours, late policy, weights, exam dates) | Done | `lib/extract/syllabus.ts`, `extractNewSyllabi()` in `lib/sync.ts` |
| Office hours → calendar + "when am I free for office hours" | Done | `find_office_hours_slot`, syllabus-driven `calendar_create` proposals |
| Daily briefing | Done (Discord only) | `lib/briefing.ts`, `instrumentation.ts` cron |
| Weekly workload forecast + study plan packing | Done | `lib/forecast.ts`, `app/forecast/page.tsx` |
| Natural-language chat over everything | Done | `app/api/chat/route.ts` + shared tool set |
| Human-in-the-loop proposals inbox | Done | `lib/proposals.ts`, `app/proposals/page.tsx` |
| **Starred-courses-only scope** | Done | `favoriteCourses()` in `lib/sync.ts`, `courseScope` in `/api/status`, the `CourseScope` footnote in `app/page.tsx` |
| **Syllabus PDFs read and transcribed** | Done | `syllabusFileRef` / `pdfToText` in `lib/extract/syllabus.ts`, `resolveSyllabus` in `lib/sync.ts`, `courses.syllabus_text` / `syllabus_source` |
| **Course detail page** (syllabus viewer, weights, exams, office hours, late policy) | Done | `app/courses/[id]/page.tsx`, `app/api/courses/[id]/route.ts` |
| **GFM chat/briefing formatting** | Done | `app/components/Markdown.tsx` (`remark-gfm`), `.prose-chat` in `globals.css` |
| **Parallel Canvas sync** | Done | `mapLimit` + `CANVAS_CONCURRENCY` in `lib/sync.ts`, 24 h instructor TTL |

## 2. What is **not** implemented

| Planned feature | Status | Notes |
|---|---|---|
| **Grade "what-if" calculator** | Not started | `courses.grading_weights` is extracted from the syllabus but never used for math. No assignment groups, no per-course grade, no solver. |
| **Late-policy-aware prioritization** | Not started | `courses.late_policy` is stored as free text only. No structured penalty model, no "expected grade loss per hour of delay" ranking. |
| **Syllabus vs Canvas discrepancy detector** | Not started | `courses.exam_dates` is extracted and then never compared to anything. |
| **Conflict detection** (two exams one day, assignment due during an event) | Not started | Calendar events are stored but only used as *busy* blocks by the planner. |
| **Grade posted / grade drop alerts** | Not started | `assignments.score` is synced but never diffed across syncs. |
| **Module digest** (pages/files/PDF slides → summary, flashcards) | Not started | No `modules` or `pages` endpoints wrapped. Note the file plumbing now *does* exist — `getFile` / `downloadFile` in `lib/canvas/api.ts` and `pdfToText` in `lib/extract/syllabus.ts` — so this got noticeably cheaper. |
| **Quiz prep** | Not started | No `quizzes` endpoint wrapped. |
| **Rubric → checklist** | Not started | No rubric data pulled. |
| **Feedback digest** (submission comments + rubric assessments) | Not started | No submission comments pulled. |
| **Extension request drafting** (pre-deadline, late-policy aware) | Not started | The generic `propose_message` tool exists, but there is no pre-deadline flow. This is the top line of `to-do.md` — Part 1 delivers it. |
| **Discussion board assistant** | Not started | No `discussion_topics` endpoint. |
| **Group project coordinator** | Not started | No Groups API. |
| **Peer review reminders** | Not started | No peer-review endpoint. |
| **Semester heatmap of crunch weeks** | Partial | Forecast covers 3 weeks with a per-day bar chart; no semester-wide view. |
| **Briefing via SMS / email** | Partial | Discord webhook only. |
| **Office-hours visit with pre-drafted question** | Partial | Slot matching works; the question draft does not exist. |
| **Export calendar to Google Calendar / ICS** | Not started | — |

Also open, from `to-do.md` / `personal-to-do.md` and deliberately **not** part of anyone's plan (they're yours, and they touch frozen files): chat persistence across tab changes, user-supplied Canvas token / Discord webhook / university selection, the syllabus file-picking heuristics, briefing speed, Gradescope.

## 2.5 Repo invariants every part must respect

These are recent and none of them are in the original feature descriptions. All three parts are written against them; this section is the summary, and each plan repeats the ones it depends on.

1. **Only starred courses exist.** `runSync` keeps the courses the student starred on their Canvas dashboard (`favoriteCourses()` in `lib/sync.ts`); un-starred ones are deleted from the `courses` table along with their assignments, announcements and office hours. Consequences: never assume a course id resolves, never fan out over "all enrolled courses", and don't write new UI copy re-explaining the scope — `CourseScope` in `app/page.tsx` already does, once.
2. **A syllabus may be unreadable, and that is a distinct state.** `courses.syllabus_source` is `html | pdf | link_only | none`. `link_only` means the Syllabus tab held nothing but an attachment that couldn't be read. Use `courseHasSyllabus(c)` from `@/lib/db`, never `syllabus_available` (which is true even for a tab that's just a link). Anything derived from a syllabus — `late_policy`, `grading_weights`, `exam_dates`, `office_hours` — is therefore **legitimately null for some courses**, and "null" must surface as *"no readable syllabus for this course"*, never as *"no late penalty"* or *"no conflicts"*.
3. **Readable syllabus prose is `courses.syllabus_text`**, not `syllabus_body` (which is raw tab HTML, often just a link). For rows synced before that column existed, fall back to converting `syllabus_body` — see `get_syllabus` in `lib/tools/index.ts` for the exact pattern.
4. **Per-course Canvas fan-out goes through `mapLimit`**, exported from `@/lib/sync`, at `CANVAS_CONCURRENCY` (Task 0 exports that constant). Canvas signals throttling with a `403` containing "Rate Limit", which `lib/canvas/client.ts` retries with backoff — slowly. Don't write your own `Promise.all` over every course.
5. **Dynamic route params are a Promise.** Next 16: `export async function POST(req: Request, { params }: { params: Promise<{ id: string }> })`, then `const { id } = await params;`. Copy `app/api/proposals/[id]/route.ts` verbatim as your template.
6. **Model output renders through `<Markdown>`** from `@/app/components/Markdown` (react-markdown + remark-gfm), wrapped in `<div className="prose-chat">`. Plain `ReactMarkdown` mangles tables.
7. **Core schema changes go through `ADDED_COLUMNS` in `lib/db.ts`** — which is frozen. You do not add columns to core tables at all; your feature's data lives in your own tables, registered via `FEATURE_SCHEMAS` (Task 0).
8. **`data/app.db` persists across branches.** Your `CREATE TABLE IF NOT EXISTS` runs on an existing database that already has other people's feature tables in it. Never `DROP` anything you don't own.

## 3. The features we're building

Chosen for (a) demo impact, (b) *disjoint data domains* so four people can work at once, and (c) each one fitting in a single person's hackathon-sized slice. All four are still unimplemented on `ad88578`.

| # | Feature | Owner | Data domain it owns | New Canvas endpoints? | Plan |
|---|---|---|---|---|---|
| 0 | Shared scaffold | **you** | — | No | `00-shared-scaffold.md` |
| 1 | **Grade what-if calculator + grade-drop alerts** | **you** | assignment groups, scores, grade snapshots | Yes (`assignment_groups`, `enrollments`) | `01-grade-whatif.md` |
| **Part 1** | **Late-policy-aware triage + extension requests** | teammate B | structured late policies, priority scores | No | `02-triage-priority.md` |
| **Part 2** | **Discrepancy & conflict detector** | teammate C | cross-source conflicts | No | `03-conflict-detector.md` |
| **Part 3** | **Module digest, flashcards & quiz prep** | teammate D | modules, pages, files, quizzes | Yes (`modules`, `pages`, `quizzes`) | `04-study-pack.md` |

Each part is independently demoable and independently mergeable. If a teammate drops out, you lose that part and nothing else — no other plan imports from it.

Deliberately left in the backlog (not assigned to anyone): feedback digest, rubric checklist, discussion board, group coordinator, peer reviews, ICS export, SMS/email briefing, semester heatmap. Any of these is a good stretch task once a member's own feature is green.

## 4. How we keep merges clean

### 4.1 The one rule

> **After Task 0 lands, no feature branch may edit a file it does not own.**

Everything each feature needs from the shared codebase is pre-wired by Task 0 as an empty stub that exactly one person owns. If you find yourself wanting to edit `lib/db.ts`, `lib/tools/index.ts`, `lib/sync.ts`, `app/page.tsx`, `app/components/Nav.tsx`, `scripts/seed-demo.ts` or `package.json` — stop and post in the group chat instead. Those six files are frozen.

### 4.2 Ownership map

Exactly eight paths per feature. Nothing outside this table may be created or edited on a feature branch.

| Feature | Path glob | Owner |
|---|---|---|
| grades | `lib/features/grades/**`, `app/grades/**`, `app/api/grades/**`, `app/components/cards/GradesCard.tsx`, `app/components/course/CourseGradesSection.tsx`, `scripts/seed-grades.ts`, `tests/grades.test.ts`, `docs/features/grades.md` | you |
| triage (Part 1) | `lib/features/triage/**`, `app/triage/**`, `app/api/triage/**`, `app/components/cards/TriageCard.tsx`, `app/components/course/CourseTriageSection.tsx`, `scripts/seed-triage.ts`, `tests/triage.test.ts`, `docs/features/triage.md` | B |
| conflicts (Part 2) | `lib/features/conflicts/**`, `app/conflicts/**`, `app/api/conflicts/**`, `app/components/cards/ConflictsCard.tsx`, `app/components/course/CourseConflictsSection.tsx`, `scripts/seed-conflicts.ts`, `tests/conflicts.test.ts`, `docs/features/conflicts.md` | C |
| study (Part 3) | `lib/features/study/**`, `app/study/**`, `app/api/study/**`, `app/components/cards/StudyCard.tsx`, `app/components/course/CourseStudySection.tsx`, `scripts/seed-study.ts`, `tests/study.test.ts`, `docs/features/study.md` | D |
| — | Everything else (frozen after Task 0) | you |

The `app/components/course/*Section.tsx` file is each feature's slot on the **course detail page** (`/courses/[id]`), which is new since the last revision of these plans. Task 0 creates all four as stubs that render `null`, so the page itself is never edited again.

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

Part 1 (triage) needs "what share of the final grade is this assignment worth." Feature 1 (grades, yours) is the thing that knows the real answer, from Canvas assignment groups. If B imported that lazily we'd get either a blocked teammate or a post-merge integration PR — so Task 0 removes the problem instead.

Task 0 creates **`lib/features/grades/weights.ts`** with its final signature and a body that returns `null`:

```ts
export interface AssignmentWeight { percent: number; source: "canvas"; approximate: false }
/** Share of the course's final grade this assignment carries, from synced Canvas
 *  assignment groups. Returns null when grades haven't been synced — callers must
 *  fall back to their own estimate. SIGNATURE IS FROZEN: Part 1 (triage) imports this. */
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
| Shared plumbing | `lib/db.ts`, `lib/sync.ts`, `lib/briefing.ts`, `lib/tools/index.ts`, `lib/tools/shared.ts`, `lib/features/{schemas,tools,sync}.ts`, `lib/canvas/**`, `lib/extract/**`, `app/page.tsx`, `app/courses/[id]/page.tsx`, `app/api/courses/**`, `app/components/{Nav,ui,Markdown,FeatureCards}.tsx`, `app/components/course/CourseSections.tsx`, `package.json`, `.github/**` | Task 0 only — **frozen afterwards** |
| Feature 1 | the eight `grades` paths | your `feat/grades` only |
| Part 1 | the eight `triage` paths | B's `feat/triage` only |
| Part 2 | the eight `conflicts` paths | C's `feat/conflicts` only |
| Part 3 | the eight `study` paths | D's `feat/study` only |

The four feature branches have **pairwise empty file intersections**, so merging them is a fast-forward of disjoint file sets in any order. Every place where features would normally collide is handled by a pre-created stub rather than by an edit:

- **New tables** — each feature fills in its own `lib/features/<f>/schema.ts`; the registry `lib/features/schemas.ts` already imports all four and never changes again.
- **New chat tools, sync hooks, nav links, dashboard cards, course-page sections, seed scripts** — same pattern: the registry lists all four up front, each stub is filled in by exactly one person.

Three residual risks, and what closes each:

1. *Someone edits a frozen file anyway.* → `npm run check:ownership` + CODEOWNERS review requests (both installed by Task 0).
2. *Two people independently invent the same helper file.* → constraint 9 above: never create a shared file; duplicate instead.
3. *A teammate branches before Task 0 lands.* → don't send the "pull and branch" message until it's merged to `main`, and have them confirm `git log --oneline -1` shows the scaffold commit before they start (step 0 of each plan).

`data/app.db` is gitignored, so nobody's local database is a merge hazard either — but note that everyone's db gains all four feature tables as soon as they pull Task 0, since `CREATE TABLE IF NOT EXISTS` runs for every registered schema. That's also why nobody may `DROP` a table they don't own (§2.5.8).

One thing that is *not* a merge conflict but will still bite: `main` moves while you build. Rebase on `main` daily (`git fetch && git rebase origin/main`) — since you only own untouched paths, a rebase is always clean, and it means you find out early if a frozen file changed underneath you.

## 5. Definition of done (every feature)

- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean
- [ ] `npm test` green, including your new `tests/<feature>.test.ts`
- [ ] `npm run check:ownership` passes — no file outside your row in §4.2
- [ ] Works end-to-end on seed data alone (`npm run seed && npm run seed:<feature>`), with no `CANVAS_TOKEN` and no `ANTHROPIC_API_KEY` — degrade gracefully, never crash
- [ ] Your page renders, your dashboard card renders, your course-page section renders, your chat tools answer at least two natural-language questions
- [ ] A course with `syllabus_source = 'link_only'` and a course with `'none'` both render a truthful state, not a silent empty list (§2.5.2)
- [ ] `docs/features/<feature>.md` written: what it does, env vars, demo steps
- [ ] A 30-second slice of the demo script that a judge can follow

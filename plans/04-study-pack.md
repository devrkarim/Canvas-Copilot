# Part 3 of 3 — Module digest, flashcards & quiz prep

**Owner:** teammate D · **Branch:** `feat/study` · **Depends on:** the scaffold being on `main`. Nothing else, and nobody else.

This file plus §2.5, §3 and §4 of `plans/README.md` is your complete assignment. You will not need to ask anyone anything to finish it.

**Good news before you start:** the hardest part of this feature — downloading a Canvas file and turning a PDF into text — already exists in the repo and is yours to import. See "Content extraction" below. Your predecessor plan assumed you'd write it from scratch; you won't.

## Before you start

```bash
git checkout main && git pull
git log --oneline -1          # must show the chore/feature-scaffold commit — if not, wait
git checkout -b feat/study
npm install && npm run seed && npm test     # confirm a green baseline before you change anything
```

You own exactly these paths and may not create or edit anything else:

```
lib/features/study/**   app/study/**   app/api/study/**
app/components/cards/StudyCard.tsx   app/components/course/CourseStudySection.tsx
scripts/seed-study.ts   tests/study.test.ts   docs/features/study.md
```

Run `npm run check:ownership` before every commit; it fails the moment you touch someone else's file. The stubs you're filling in (`lib/features/study/{schema,tools,sync}.ts`, both UI components) already exist and are already wired into the app — you never edit a registry, a nav bar, a page, `lib/db.ts`, or `package.json`.

**Read-only dependencies** (import freely, never edit):

| Import | From | Why you need it |
|---|---|---|
| `canvasGet`, `canvasGetAll`, `CanvasError`, `canvasConfigured` | `@/lib/canvas/client` | your own endpoint wrappers |
| `getFile`, `downloadFile` | `@/lib/canvas/api` | **already written** — file metadata + signed-URL download |
| `pdfToText` | `@/lib/extract/syllabus` | **already written** — PDF → text via a document content block |
| `mapLimit`, `CANVAS_CONCURRENCY` | `@/lib/sync` | per-course fan-out at the throttle-safe rate |
| `anthropic`, `parseDefaults`, `MODEL`, `llmConfigured` | `@/lib/llm` | generation |
| `db`, `getPref` | `@/lib/db` | your tables |
| `Card`, `Button`, `Pill`, `Empty`, `fmt` | `@/app/components/ui` | UI |
| `Markdown` | `@/app/components/Markdown` | rendering the digest (GFM tables; plain ReactMarkdown mangles them) |

**Never create:** a shared helper outside your folder, and in particular do **not** add your endpoints to `lib/canvas/api.ts` or your response types to `lib/canvas/types.ts` — both are frozen. Your wrappers and interfaces live in `lib/features/study/canvas.ts`.

### The four repo facts this feature is built on

1. **Only starred courses exist** (`plans/README.md` §2.5.1). Iterate the `courses` table; never list enrollments. Clean up orphaned rows at the top of your sync hook — `DELETE FROM modules WHERE course_id NOT IN (SELECT id FROM courses)`, and the same for `module_items`, `quizzes`, `study_packs` — mirroring what `runSync` already does for `forecasts` / `study_blocks`.
2. **Fan out with `mapLimit(ids, CANVAS_CONCURRENCY, …)`**, catching per course so one disabled Modules tab doesn't kill the sync. `lib/sync.ts` is the worked example.
3. **File download and PDF transcription already exist** — `getFile` / `downloadFile` / `pdfToText`. Don't add a PDF parser, and don't fetch a signed URL with the Canvas bearer token (`downloadFile` deliberately sends no credentials).
4. **Markdown renders through `<Markdown>`** inside `<div className="prose-chat">`.

Do the Canvas reconnaissance in your first hour (see Risks): if Modules or Quizzes are disabled on the sandbox course, you want to know before you build against them, not after. The feature is designed to demo fully from seed data either way.

## The pitch

> **Quiz Friday in CHEM 122 (20 min, 2 attempts, covers Module 6: Thermochemistry).**
> Here's a 200-word digest of this week's slides and pages, 12 flashcards, and 8 practice questions with answers — generated from the actual course material.

This is the only one of the four features that touches course *content* rather than metadata, so it shares no tables and no endpoints with the others.

## Scope

**In:** sync modules + their items, pull text from Pages and (where feasible) PDF/DOCX files, one structured LLM call per module → digest + flashcards + practice questions, quiz metadata, a `/study` page with a flashcard flipper and a practice quiz, chat tools, dashboard card.
**Out (backlog):** taking real Canvas quizzes, video transcripts, spaced-repetition scheduling, uploading answers.

## Files you own

```
lib/features/study/schema.ts       ← fill in the stub
lib/features/study/canvas.ts       ← new: modules / pages / files / quizzes wrappers
lib/features/study/content.ts      ← new: item → plain text (HTML strip, PDF handling)
lib/features/study/generate.ts     ← new: structured-output digest + cards + questions
lib/features/study/store.ts        ← new: your tables
lib/features/study/sync.ts         ← fill in the stub
lib/features/study/tools.ts        ← fill in the stub
app/api/study/route.ts             ← GET  /api/study
app/api/study/generate/route.ts    ← POST /api/study/generate
app/api/study/refresh/route.ts     ← POST /api/study/refresh
app/study/page.tsx                 ← replace the stub
app/components/cards/StudyCard.tsx
scripts/seed-study.ts
tests/study.test.ts
docs/features/study.md
```

## Data model (`STUDY_SCHEMA`)

```sql
CREATE TABLE IF NOT EXISTS modules (
  id INTEGER PRIMARY KEY,            -- Canvas module id
  course_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  position INTEGER,
  unlock_at TEXT,
  state TEXT,                        -- Canvas workflow/completion state when available
  items_count INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS module_items (
  id INTEGER PRIMARY KEY,            -- Canvas module item id
  module_id INTEGER NOT NULL,
  course_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL,                -- Page | File | Assignment | Quiz | ExternalUrl | SubHeader | Discussion
  position INTEGER,
  page_url TEXT,                     -- for Page items
  content_id INTEGER,                -- file/assignment/quiz id
  html_url TEXT,
  text TEXT,                         -- extracted plain text, NULL until fetched
  text_source TEXT,                  -- 'page' | 'file_pdf' | 'file_text' | 'assignment' | 'unavailable'
  fetched_at TEXT,
  synced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_module_items_module ON module_items(module_id);

CREATE TABLE IF NOT EXISTS quizzes (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  due_at TEXT,
  unlock_at TEXT,
  time_limit INTEGER,                -- minutes
  allowed_attempts INTEGER,
  question_count INTEGER,
  points_possible REAL,
  html_url TEXT,
  description TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_packs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  module_id INTEGER,
  quiz_id INTEGER,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,             -- markdown digest
  key_terms TEXT NOT NULL,           -- JSON [{term, definition}]
  flashcards TEXT NOT NULL,          -- JSON [{front, back, sourceItemId}]
  practice TEXT NOT NULL,            -- JSON [{question, choices[]|null, answer, explanation, sourceItemId}]
  source_item_ids TEXT NOT NULL,     -- JSON number[]
  source_hash TEXT NOT NULL,         -- regenerate only when the underlying text changed
  created_at TEXT NOT NULL,
  UNIQUE(module_id, quiz_id, source_hash)
);
```

## Canvas endpoints (`lib/features/study/canvas.ts`)

Build on `canvasGet` / `canvasGetAll` from `@/lib/canvas/client`; declare local response interfaces (`lib/canvas/types.ts` is frozen).

```ts
listModules(courseId)            // /api/v1/courses/:id/modules?include[]=items&include[]=content_details
listModuleItems(courseId, modId) // /api/v1/courses/:id/modules/:mid/items  (fallback when include[]=items truncates)
getPage(courseId, pageUrl)       // /api/v1/courses/:id/pages/:url          → { body: html }
listQuizzes(courseId)            // /api/v1/courses/:id/quizzes
```

**You do not write a file wrapper.** `getFile(courseId, fileId)` and `downloadFile(signedUrl)` already exist in `lib/canvas/api.ts` (added for the syllabus-PDF work), and `CanvasFile` is already typed in `lib/canvas/types.ts` — `display_name`, `"content-type"`, `size`, `url`, `updated_at`, `locked_for_user`. Import them.

Notes that will save you an hour:
- `include[]=items` is capped (Canvas omits items for large modules); if `items` is absent but `items_count > 0`, fall back to `listModuleItems`.
- Modules are frequently **disabled** for a course → Canvas returns 404/403. Catch `CanvasError`, push a warning, continue. Never let one course kill the sync.
- `downloadFile` sends **no** credentials, deliberately: the `url` on a `CanvasFile` is already signed, and adding the bearer token can 401. Don't "fix" that by routing it through `canvasGet`.
- If you parse file links out of page HTML, extract the `/courses/<n>/files/<n>` ids and pass those to `getFile` rather than fetching the URL you found. `syllabusFileRef` in `lib/extract/syllabus.ts` is the reference implementation, including its same-origin check — a hostile absolute URL in course content must never be fetched with the Canvas token.
- Classic quizzes live at `/quizzes`; New Quizzes appear as assignments with `submission_types: ["external_tool"]`. If `/quizzes` is empty, fall back to assignments whose name matches `quiz|exam|test` so the feature still has something to prep for.

## Content extraction (`content.ts`)

| Item type | How to get text |
|---|---|
| `Page` | `getPage` → `convert(body, { wordwrap: false })` via `html-to-text` (already a dependency) |
| `Assignment` | reuse `assignments.description` from the core DB — no extra call |
| `File` (PDF) | `getFile` → guards → `downloadFile(file.url)` → `pdfToText(file.display_name, bytes)` |
| `File` (text/markdown/html) | `downloadFile` → decode → `convert` when HTML |
| `File` (pptx/docx/other) | mark `text_source = 'unavailable'` and skip — don't sink time into parsers |
| `ExternalUrl`, `SubHeader`, `Discussion` | title only |

Cap per item at ~20 000 characters and per module at ~60 000; truncate with a marker. Store the result in `module_items.text` with `fetched_at`, so regeneration is free and tests can run with zero network.

**PDFs are already solved.** `pdfToText(filename, bytes)` in `lib/extract/syllabus.ts` streams the PDF to the model as a base64 `document` content block and returns transcribed text (or `null` on refusal / too-short output). It handles scanned and image-only PDFs, because the model reads the document natively. Do not write a PDF parser, and do not reimplement this — import it.

Copy the guard sequence from `resolveSyllabus` in `lib/sync.ts`, which is the same problem solved once already, in this order:

```ts
const file = await getFile(courseId, fileId);
if (file["content-type"] !== "application/pdf") return unavailable("not a PDF");
if (file.locked_for_user || !file.url)          return unavailable("locked");
if (file.size > MAX_PDF_BYTES)                  return unavailable(`${(file.size / 1e6).toFixed(1)} MB — too large`);
const text = await pdfToText(file.display_name, await downloadFile(file.url));
if (!text)                                      return unavailable("could not transcribe");
```

Use the same 10 MB ceiling (`MAX_SYLLABUS_PDF_BYTES` is the precedent; define your own constant, don't import a private one). Cache on a fingerprint of `file.id | file.updated_at | file.size` exactly as `resolveSyllabus` does, so a module's slides are transcribed once and not on every sync — transcription is the single most expensive thing this feature does.

Each `unavailable(reason)` path writes `text_source = 'unavailable'` and stores the reason; the UI shows it per item ("Lecture 6 slides — locked in Canvas"). Silent skips are what make a study pack quietly incomplete.

## Generation (`generate.ts`)

One structured-output call per pack (`zodOutputFormat` + `parseDefaults` from `@/lib/llm`, matching `lib/extract/syllabus.ts`):

```ts
const StudyPackSchema = z.object({
  summary: z.string().describe("150–250 word markdown digest of what this module covers"),
  keyTerms: z.array(z.object({ term: z.string(), definition: z.string() })).max(15),
  flashcards: z.array(z.object({ front: z.string(), back: z.string(), sourceItemId: z.number().nullable() })).min(5).max(20),
  practice: z.array(z.object({
    question: z.string(),
    choices: z.array(z.string()).nullable().describe("4 options for multiple choice; null for short answer"),
    answer: z.string(),
    explanation: z.string(),
    sourceItemId: z.number().nullable(),
  })).min(5).max(12),
});
```

System prompt requirements:
- Ground everything in the supplied material; if the material doesn't cover something, don't invent it.
- When quiz metadata is supplied (time limit, question count, points), match the practice set's style and difficulty to it.
- `sourceItemId` must reference one of the supplied item ids, so the UI can link each card back to the slide or page it came from. That traceability is what makes a judge believe the output.

`source_hash` = hash of the concatenated item texts + quiz id. Same hash → return the cached pack instead of spending a call.

## Sync hook

```ts
import { mapLimit, CANVAS_CONCURRENCY } from "@/lib/sync";

export async function syncStudy(ctx: FeatureSyncCtx) {
  dropOrphans();                        // rows for courses the student un-starred
  if (!canvasConfigured()) return;
  const ids = allCourseIds();           // starred courses only — that's all the table holds
  await mapLimit(ids, CANVAS_CONCURRENCY, async (id) => {
    try { upsertModules(id, await listModules(id)); }
    catch (e) { ctx.warnings.push(`modules for course ${id}: ${(e as Error).message}`); }
    try { upsertQuizzes(id, await listQuizzes(id)); } catch { /* quizzes often disabled */ }
  });
  await fetchTextForCurrentModules();   // only the current + next module per course, and only items with text IS NULL
}
```

`dropOrphans()` is four `DELETE FROM <your table> WHERE course_id NOT IN (SELECT id FROM courses)` statements. `runSync` prunes its own tables when a course is un-starred but knows nothing about yours.

**Never generate packs during sync.** Generation is expensive and slow; it happens on the `/study` page button or via chat. "Current module" = the highest-position module already unlocked (`unlock_at` in the past or null).

## API routes

| Route | Behaviour |
|---|---|
| `GET /api/study` · `?course=<id>` | `{ timezone, courses: [{ id, code, modules: [{ id, name, itemCount, textReady, unavailableCount, hasPack, packId }], upcomingQuizzes: [{ id, title, dueAt, timeLimit, allowedAttempts, questionCount, moduleId }] }] }`. `?course=` filters to one course — that's what `CourseStudySection` calls. |
| `POST /api/study/generate` | body `{ moduleId?, quizId?, force?: boolean }` → the full pack. Returns the cached pack unless `force`. `{ error }` with a clear message when `ANTHROPIC_API_KEY` is missing or no text could be extracted. |
| `POST /api/study/refresh` | modules/quizzes/text sync for this feature only |

Generation can take 20–40 s. Either stream it (mirror the SSE pattern in `app/api/chat/route.ts`) or return fast with a "generating…" state and poll — **pick one in the first hour**, because it shapes the page. Recommended: plain `await` with a clear spinner and an honest "this takes about 30 seconds" label; SSE is nicer but it is not where this feature's demo value is.

## Chat tools (`tools.ts`)

| Tool | Input | Returns |
|---|---|---|
| `get_modules` | `{ course?: courseArg, current_only?: boolean }` | Modules and their items, so the model can answer "what are we covering this week?" |
| `get_quizzes` | `{ course?: courseArg, days?: number }` | Upcoming quizzes with time limit, attempts, question count — "how long is Friday's quiz?" |
| `get_study_pack` | `{ course?: courseArg, module?: string, quiz?: string }` | An existing pack's digest + a few cards (read-only; never generates) |
| `create_study_pack` | `{ course, module?: string, quiz?: string }` | Generates and saves, returns the digest + a pointer to `/study` (goes in the **write** array — it spends tokens) |

Note in the `create_study_pack` description that it takes ~30 seconds, so the model warns the student instead of silently stalling the chat.

## UI

**`/study` page:**
- Left: course → module list, each row showing item count, a "text ready" tick, and a **Generate study pack** button (or **View pack** when one exists).
- Right, when a pack is selected:
  - **Digest** — markdown via `<Markdown>` from `@/app/components/Markdown`, wrapped in `<div className="prose-chat">`, inside the shared `Card`. (Not raw `ReactMarkdown`: the digest will contain GFM tables and plain react-markdown renders them as one run-on paragraph. `app/courses/[id]/page.tsx` shows the pattern for model-generated prose.)
  - **Flashcards** — one card at a time, click to flip, ←/→ to move, a "known / review" counter kept in component state (no persistence in v1), plus a small source link per card back to the Canvas item.
  - **Practice** — questions with hidden answers; reveal per question, then a score at the end.
- **Upcoming quizzes** strip at the top: title, due date, time limit, attempts, and a **Prep for this quiz** button that generates a pack scoped to the quiz's module.

**`StudyCard.tsx`:** "Next quiz: CHEM 122 Thermochemistry — Fri, 20 min, 2 attempts" + either "Study pack ready →" or a **Prep** button. Returns `null` when there's no upcoming quiz and no current module.

**`CourseStudySection.tsx`:** on `/courses/[id]`, a `Card title="Modules & study packs"` listing that course's modules with their item counts and pack status, plus its upcoming quizzes. This is the section that makes the course page feel complete — the page currently shows what the *syllabus* says about a course; this shows what's actually in it week to week. Fetch `/api/study?course=<id>`; return `null` when the course has no modules and no quizzes (a course with Modules disabled must not leave a dead empty card on the page).

## Seed data (`scripts/seed-study.ts`)

Delete only `modules`, `module_items`, `quizzes`, `study_packs`. Then, for the demo courses:

- CS 101: two modules ("Module 5: Recursion", "Module 6: Sorting") with 4–5 items each, `text` **pre-filled** with a few paragraphs of realistic lecture prose (so generation has real input without any network).
- CHEM 122: "Module 6: Thermochemistry" + a quiz due in 3 days (20 min, 2 attempts, 15 questions) — this is the headline demo.
- One pre-generated `study_packs` row for the CHEM module (hand-written summary, 6 flashcards, 5 practice questions) so the flashcard UI demos with **no API key at all**.
- One item with `text_source = 'unavailable'` so the "couldn't read this file" state is visible.

## Tests (`tests/study.test.ts`)

No network, no model calls — inject fixtures, don't hit Canvas.

If you do want an integration test of `syncStudy` against Canvas, don't invent a harness: `tests/sync.test.ts` already stands up a mock Canvas HTTP server (`node:http`, `CANVAS_BASE_URL` pointed at it) with adversarial fixtures, pagination and a rate-limit case. Copy its setup into your own file rather than importing from it — per §4.3.9, no shared test helpers.

- `content.ts`: HTML page → clean text; truncation marker appears past the cap; unsupported file type → `'unavailable'`
- `source_hash` is stable for the same inputs and changes when an item's text changes (this is the caching contract)
- `store.ts`: upserting modules twice doesn't duplicate items; an item removed from Canvas disappears from `module_items`
- `get_study_pack` returns the seeded CHEM pack; `get_quizzes` returns the seeded quiz with its time limit and attempts
- `get_modules` with `current_only` picks the unlocked, highest-position module
- Generation is tested only for its **prompt assembly** (item text concatenated, ids preserved, cap respected) — factor `buildPrompt()` out of `generate.ts` so the model call itself is never invoked in tests
- the PDF guard chain: non-PDF content type, `locked_for_user`, oversize, and a `pdfToText` returning `null` each produce `text_source = 'unavailable'` with a distinct stored reason, and none of them throw
- `dropOrphans()` removes modules, items, quizzes and packs for a course id that's no longer in `courses`, and leaves everything else untouched

## Demo (30 s)

1. `/study` → "Quiz Friday in CHEM 122 — 20 min, 2 attempts, 15 questions."
2. **Prep for this quiz** → digest appears (or the cached pack on the no-key path).
3. Flip three flashcards; answer two practice questions; click a card's source link → the Canvas page it came from.

## Risks

| Risk | Mitigation |
|---|---|
| Modules/Files/Quizzes are disabled in the sandbox course | Every call wrapped in try/catch with a warning; the seed script pre-fills text so the demo never depends on live content. Verify early which tabs your Canvas sandbox actually exposes — do this on day one. |
| Generation is slow and dominates the demo | Cache by `source_hash`, pre-generate the CHEM pack in the seed, and pre-warm the real one before demoing. |
| PDF handling eats the whole day | It no longer can: `getFile` + `downloadFile` + `pdfToText` are written and proven on syllabi. Still ship pages-only first (`text_source = 'page'`) and turn PDFs on once the end-to-end flow is green. |
| Transcription cost/latency on every sync | Fingerprint-and-cache exactly as `resolveSyllabus` does (`file.id \| updated_at \| size`); only re-transcribe when the file actually changed. |
| Hallucinated practice answers | Require `sourceItemId` on every card and question, show the source link in the UI, and say "generated from your course materials — verify before you rely on it" in the page footer. |

# Canvas Copilot

An LLM assistant on top of the Canvas LMS REST API that keeps a student on track.

| Feature | How it works |
|---|---|
| **Assignment reminders** | Upcoming/missing assignments on the dashboard, in chat, and in the daily brief |
| **Announcements → calendar** | Each new announcement is read by Claude; schedule changes (due-date moves, cancelled classes, room changes, new events) become **proposals** you approve before anything is written to Canvas |
| **Syllabus reading** | If a course has a Syllabus tab, Claude extracts office hours, late policy, grading weights and exam dates |
| **Office hours → calendar** | Extracted office hours are proposed as weekly recurring calendar slots; chat can find office-hour times you're actually free |
| **Daily briefing** | A morning digest written by Claude from live data, pushed to Discord (or just shown in the app) on a cron schedule |
| **Weekly workload forecast** | Claude estimates hours per assignment; a planner packs the work into your free study windows (earliest deadline first) and flags overload |
| **Natural-language chat** | "What's due this week?", "When are Prof. Lee's office hours?", "Draft a message about the HW I missed" — all backed by tools over your Canvas data |

**Design rule:** the model never writes to Canvas directly. Every calendar change or message is a *proposal* in SQLite; the **Proposals** page executes it on approval (`lib/proposals.ts` is the only code path that writes).

## Stack

Next.js 16 (App Router, TypeScript) · `@anthropic-ai/sdk` (tool runner + structured outputs, `claude-opus-5`) · SQLite via `better-sqlite3` · `node-cron` · Tailwind.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev                  # http://localhost:3000
```

`.env.local`:

| Variable | Notes |
|---|---|
| `CANVAS_BASE_URL` | e.g. `https://yourschool.instructure.com` |
| `CANVAS_TOKEN` | Canvas → Account → Settings → **+ New Access Token** |
| `ANTHROPIC_API_KEY` | from console.anthropic.com |
| `DISCORD_WEBHOOK_URL` | optional — where the daily brief is sent |
| `BRIEFING_CRON` | default `0 7 * * *` |
| `TZ` | your timezone, e.g. `America/Los_Angeles` |
| `STUDY_WINDOWS` | free-time windows the planner may use, e.g. `09:00-12:00,14:00-18:00,19:00-22:00` |

Then open the dashboard and click **Sync Canvas**. Sync pulls courses, assignments, announcements and calendar into `data/app.db`, reads every syllabus, and turns new announcements into proposals.

### No Canvas token handy? Use the demo data

```bash
npm run seed
```

Seeds three fake courses (one without a syllabus tab), ten assignments (one missing), three announcements with extracted actions, a class schedule, and three pending proposals. Everything except the model-backed features (chat, briefing, extraction) works without any keys.

### Getting a sandbox Canvas

If your institution's Canvas doesn't let you create tokens, sign up for **Canvas Free-for-Teacher** (`canvas.instructure.com/register`), create a course with a syllabus (office hours + late policy), a few assignments (one past due), and two announcements ("HW3 moved to Friday", "no class Tuesday"). Enroll a second account as a student and use *that* account's token.

## Project layout

```
lib/canvas/        Canvas REST client (bearer auth, Link pagination) + typed endpoint wrappers
lib/db.ts          SQLite schema + proposal helpers
lib/llm.ts         Anthropic client + shared defaults (adaptive thinking, server-side fallbacks)
lib/extract/       syllabus.ts, announcement.ts — structured-output extractors
lib/sync.ts        Canvas → SQLite, then runs extractors and creates proposals
lib/forecast.ts    effort estimation (LLM) + free-slot allocation (pure TS)
lib/tools/         one betaZodTool set shared by chat and the briefing
lib/briefing.ts    tool-runner-generated morning brief + Discord delivery
lib/proposals.ts   approve/reject — the only Canvas writer
app/api/*          chat (SSE), sync, proposals, forecast, briefing, status, dashboard
app/               dashboard, chat, proposals inbox, forecast pages
instrumentation.ts cron scheduler for the daily brief
scripts/seed-demo.ts   demo data
tests/             vitest: slot allocation, tool layer
```

## Scripts

```bash
npm run dev        # dev server
npm test           # vitest (allocator + tool tests over seeded data)
npm run typecheck  # tsc --noEmit
npm run seed       # load demo data into data/app.db
```

## API endpoints

| Route | Purpose |
|---|---|
| `POST /api/sync` | pull Canvas → DB, extract syllabi/announcements (`?extract=0` to skip LLM) |
| `POST /api/chat` | SSE stream: `text`, `tool`, `history`, `error`, `done` |
| `GET /api/proposals?status=pending` · `POST /api/proposals/:id` `{action, payload?}` | inbox |
| `GET /api/forecast?week=0` · `POST /api/forecast/propose` | workload plan / add study blocks as proposals |
| `GET/POST /api/briefing` | latest brief / build + deliver now |
| `GET /api/status`, `GET /api/dashboard` | UI data |

## Demo script (≈3 min)

1. Dashboard → **Sync Canvas** → point at the proposals banner: "the announcement said HW3 moved, here's the proposed calendar change."
2. Proposals → approve the due-date change and the office-hours slot → open Canvas calendar, show the events.
3. Chat → "What should I work on first today?" → "When can I go to office hours this week?" → "Draft a message about the assignment I missed" → Proposals → edit → **Send** → show it in the instructor's Canvas Inbox.
4. Forecast → the overload bar chart → **Add study plan to calendar**.
5. Dashboard → **Send briefing now** → show the Discord message.

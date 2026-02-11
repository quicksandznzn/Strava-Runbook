# AGENTS.md

Repository-level working rules for AI agents in this project.

## 1. Scope and Source of Truth

- Project: `Run Strava` (local single-user running dashboard).
- Keep this file as the main repo policy.
- Product/usage docs live in `README.md`.
- API and model contracts live in `src/shared/types.ts`.

## 2. Skill Directory Policy

- Canonical skill content location: `.agents/skills/`.
- Claude compatibility mirror: `.claude/skills/` (symlinks to `.agents/skills/*`).
- Do not duplicate skill content across multiple folders.
- Do not edit third-party skill files unless explicitly upgrading or patching a known issue.

## 3. Tech Stack and Runtime

- Frontend: React + Vite + TypeScript + Recharts + Leaflet
- Backend: Node.js + Express + TypeScript
- Database: SQLite (`better-sqlite3`)
- CLI: Commander + TypeScript (`tsx`)
- Tests: Vitest + Testing Library + Supertest

## 4. Hard Business Rules (Must Follow)

- Sync and process `Run` activities only.
- Timezone must be `Asia/Shanghai` (UTC+8) for display, filtering, and trend grouping.
- Units must stay: distance `km`, pace `min/km`.
- Strava sync must be idempotent (upsert by `strava_id`).
- AI analysis must be persisted; regenerate must replace previous result.
- Missing route/HR/splits must degrade gracefully (API + UI), never crash.

## 5. Directory Conventions

- `src/web`: frontend pages/components
- `src/server`: Express API
- `src/cli`: Strava sync CLI
- `src/db`: schema/repository/db init
- `src/shared`: shared types and helpers
- `data/`: local DB files (never commit)
- `docs/`: README images and docs assets

## 6. Required Commands

- Install: `npm install`
- Dev (web + api): `npm run dev`
- Web only: `npm run dev:web`
- API only: `npm run dev:api`
- Sync full: `npm run strava:sync -- --full`
- Sync incremental: `npm run strava:sync -- --from YYYY-MM-DD`
- Test: `npm run test`
- Coverage: `npm run test:coverage`
- Build/typecheck: `npm run build`

## 7. Change Rules

- Make small, scoped changes; avoid unrelated refactors.
- If API changes:
  - update `src/shared/types.ts`
  - update API section in `README.md`
  - add/update server tests
- If DB schema changes:
  - keep init/migration path safe for existing local DB
  - validate repository queries against updated schema
- If UI behavior changes:
  - update/add frontend tests
  - verify empty/loading/error states

## 8. API Baseline (Current)

- `GET /api/health`
- `GET /api/summary`
- `GET /api/trends/weekly`
- `GET /api/filters/calendar`
- `GET /api/activities`
- `GET /api/activities/:id`
- `GET /api/activities/:id/analysis`
- `POST /api/activities/:id/analysis`

## 9. Security and Data Hygiene

- Never commit `.env` or any secrets.
- Never commit `data/*.db`.
- Do not log tokens in CLI or API error output.
- Keep `.gitignore` aligned with local runtime artifacts.

## 10. Git and Definition of Done

- Commit prefixes: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`.
- Do not mix unrelated changes in one commit.
- Before finishing a task:
  - run relevant tests (`npm run test` minimum for code changes)
  - run `npm run build` for type/build-impacting changes
  - ensure README is updated when commands/API/behavior changed

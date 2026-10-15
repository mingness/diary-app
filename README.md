# 修行日記 · Cultivation Diary

A private, bilingual (繁體中文 / English) diary platform with supervision by course leaders, plus a shared
daily-count (報數) activity. Diaries are encrypted at rest; account administrators never see their content.

- What it does: [docs/project_prompt.md](docs/project_prompt.md)
- How it's built: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), screens in [docs/FRONTEND.md](docs/FRONTEND.md)
- Working on it: [AGENTS.md](AGENTS.md)

**Status:** Phase A, slice 7 of 10 done: skeleton; core domain; users and sign-in; SYS_ADMIN user management,
activity log, Attention list and optional email alerts; the diary (encrypted entries, drafts, 提交/更新 with
history, limits, sanitising) and SYS_ADMIN document management; the leader API (review lists, calendar,
reading submitted entries with a read audit, comments, sharing requests and approvals); open diaries. Features arrive slice by slice (see the
delivery plan in ARCHITECTURE.md §11).

## Quick start

Requires Node 22 (see `.nvmrc`) and Docker with Compose.

```sh
npm ci
npm run dev:setup      # writes .env with throwaway development keys
npm run db:up          # PostgreSQL on 127.0.0.1:55432
npm run dev            # API on http://localhost:3000
npm run seed -- --reset # sample users; every password is password123
curl localhost:3000/readyz
```

Then open http://localhost:3000/docs to browse and try every API endpoint (development and staging only).

Or run everything in containers: `docker compose up -d --wait --build`.

## Tests

```sh
npm test                  # all tests (needs `npm run db:up` for the integration half)
npm run test:unit         # no database needed
npm run test:integration  # needs `npm run db:up`
npm run test:watch        # unit tests, re-run on save
npm run test:coverage     # all tests plus a coverage report in coverage/
npm run test:functional   # against the running stack (local only; see server/test/functional/README.md)
npm run check             # everything CI runs before the Docker and secret-scan stages
```

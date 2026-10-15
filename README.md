# 修行日記 · Cultivation Diary

A private, bilingual (繁體中文 / English) diary platform with supervision by course leaders, plus a shared
daily-count (報數) activity. Diaries are encrypted at rest; account administrators never see their content.

- What it does: [docs/project_prompt.md](docs/project_prompt.md)
- How it's built: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), screens in [docs/FRONTEND.md](docs/FRONTEND.md)
- Working on it: [AGENTS.md](AGENTS.md)

**Status:** Phase A done (slices 1–10): skeleton; core domain; users and sign-in; SYS_ADMIN user management,
activity log, Attention list and optional email alerts; the diary (encrypted entries, drafts, 提交/更新 with
history, limits, sanitising) and SYS_ADMIN document management; the leader API (review lists, calendar,
reading submitted entries with a read audit, comments, sharing requests and approvals); open diaries; the account API (profile, appearance, password, devices); 報數 (count, progress, auto-submit at
02:00 Beijing, SYS_ADMIN tools); translation through an optional OpenAI-compatible provider. Phase B (the web
app) has begun: the app shell (themes, text sizes, both languages); sign-in, registration, forgot password
and authenticator setup; my diary, the entry view, the editor (photos, limits, 提交/更新, history) and open
diaries; the leaders' review (calendar, students, reading pane with their comment, share approvals)
(slices 11–14). Next: the SYS_ADMIN screens. Features arrive slice
by slice (see the delivery plan in ARCHITECTURE.md §11).

## Quick start

Requires Node 22 (see `.nvmrc`) and Docker with Compose.

```sh
npm ci
npm run dev:setup      # writes .env with throwaway development keys
npm run db:up          # PostgreSQL on 127.0.0.1:55432
npm run dev            # API on http://localhost:3000
npm run seed -- --reset # sample users; every password is password123
curl localhost:3000/readyz
npm run dev:web        # the web app on http://localhost:5173 (forwards /api to :3000)
```

Then open http://localhost:5173 and sign in as `chenmd` (a normal user), `leader.lin` (a leader) or `admin`;
with the dev defaults the CAPTCHA answer is always 3 (`CAPTCHA_FIXED`) and admins need no authenticator code
(`SKIP_TOTP`). http://localhost:3000/docs lets you
browse and try every API endpoint (development and staging only).

Or run everything in containers: `docker compose up -d --wait --build`, then open http://localhost:8080.

## Tests

```sh
npm test                  # all tests (needs `npm run db:up` for the integration half)
npm run test:unit         # no database needed
npm run test:integration  # needs `npm run db:up`
npm run test:watch        # unit tests, re-run on save
npm run test:coverage     # all tests plus a coverage report in coverage/
npm run test:functional   # against the running stack (local only; see server/test/functional/README.md)
npm run test:e2e          # the web app in a browser, on its own throwaway stack (see web/e2e/README.md)
npm run check             # everything CI runs before the Docker and secret-scan stages
```

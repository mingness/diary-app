# AGENTS.md

Working notes for anyone (human or AI) changing this repo. Read `docs/project_prompt.md` (what to build),
`docs/project_prompt_engineering.md` (how), `docs/ARCHITECTURE.md` and `docs/FRONTEND.md` (the design) first.
Keep this file up to date when commands, conventions or pitfalls change.

## Commands

| Task                                                   | Command                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Install                                                | `npm ci` (Node version in `.nvmrc`; `fnm use` / `nvm use`)                                              |
| First-time setup                                       | `npm run dev:setup` (writes `.env` with throwaway keys; never commit it)                                |
| Start the database                                     | `npm run db:up`                                                                                         |
| Run the API with reload                                | `npm run dev` (http://localhost:3000, needs the database)                                               |
| API explorer (try every endpoint in the browser)       | http://localhost:3000/docs (OpenAPI JSON at `/docs/json`)                                               |
| Run the whole stack in Docker                          | `docker compose up -d --wait --build`                                                                   |
| Everything CI checks                                   | `npm run check`                                                                                         |
| Format / lint / types                                  | `npm run format`, `npm run lint`, `npm run typecheck`                                                   |
| Unit tests (no database)                               | `npm run test:unit`                                                                                     |
| Integration tests                                      | `npm run test:integration` (needs `npm run db:up`; each file gets a fresh database)                     |
| All tests / unit tests on save                         | `npm test`, `npm run test:watch`                                                                        |
| Coverage report (all tests; HTML in `coverage/`)       | `npm run test:coverage`                                                                                 |
| Functional tests (live stack, real config; local only) | `npm run test:functional` after `docker compose restart server`; see `server/test/functional/README.md` |
| Sample users and entries (dev; wipes)                  | `npm run seed -- --reset` (every password is `password123`; admins' authenticator keys are printed)     |
| Current code for a seeded admin's authenticator key    | `npm run cli -w server -- totp-code <key>`                                                              |
| First admin / recovery (production, in the container)  | `node server/dist/cli.js create-sysadmin <name>` · `set-password <name>` · `reset-totp <name>`          |
| New migration after editing `server/src/db/schema.ts`  | `npm run db:generate -w server`, then review the SQL                                                    |
| Stop the database                                      | `npm run db:down` (add `-v` to `docker compose down` to wipe data)                                      |

## Layout

- `shared/`: zod schemas and types used by both server and web. Error codes live here.
- `server/src/`: `main.ts` (process entry), `app.ts` (builds Fastify; tests use it), `config.ts`, `db/`,
  `routes/`. Pure logic lives in `server/src/domain/` (crypto, authz, diary, count) with no HTTP or DB code;
  rules shared with the web app (e.g. 報數 input) live in `shared/src/`.
- `server/test/unit/` and `server/test/integration/`; helpers in `server/test/helpers/`. The test scripts also
  work from inside `server/` (`npm test`, `npm run test:unit`, …); they share the root `vitest.config.ts`.
- `db/migrations/`: generated SQL plus `meta/_journal.json`. Append-only once shipped.

## Conventions

- **Plan first, small slices.** Follow the delivery plan in `docs/ARCHITECTURE.md` §11. Each slice ends with
  `npm run check` green and `docker compose up` working. Nothing half-built is reachable.
- **Test layers:** unit (pure logic, no I/O), integration (the app on a fresh database, with a controllable
  clock), functional (the running stack over real HTTP with its real configuration; for behaviour like per-IP
  rate limits that only means something end to end; local only).
- **Tests ship with the code.** A bug fix starts with a failing test. Integration tests cover every role,
  allowed and denied.
- **What to test.** Unit tests pin exact input → output where the spec defines it (permission tables, 報數
  input, Beijing dates) and exercise the error paths that are hard to hit for real (tampered data, missing
  keys, bad config). Integration tests check that the pieces work together, not logic the unit tests already
  prove. Before adding a test, name the bug only it would catch. Skip tests of Node or library behaviour,
  copies of the code's own tables, repeats of an exhaustive table's rows, and names that promise more than
  the test checks.
- **Ask before:** adding a runtime dependency, changing encryption or key handling, changing the auth flow, or
  writing a destructive migration.
- **Routes declare zod schemas** for params, body and every response (use `app.withTypeProvider<ZodTypeProvider>()`).
  That validates requests and feeds the API explorer; a route without a response schema is incomplete.
- **Auth in routes:** guard with `onRequest: requireAuth()` or `onRequest: requireCapability(...)` from
  `server/src/plugins/auth.ts` (not `preHandler`, which runs after body validation, so anonymous callers would
  get 400 instead of 401),
  and read the session with `authOf(request)`. Anything that changes data automatically needs the
  `X-CSRF-Token` header. Never trust a role or user ID sent in a request body.
- **Time and randomness** come from the context (`ctx.clock()`, `ctx.captchaQuestion()`), never `new Date()`
  inside services, so tests can control them.
- **Errors:** always `{code, message, requestId}`. Codes come from `ErrorCode` in `shared/`; the web app
  translates them. Never put stack traces or secrets in responses.
- **Logging:** structured, via `request.log` / `app.log`. Never log passwords, tokens, keys, diary content,
  comments or profile fields; the redaction list in `server/src/logging.ts` is a backstop, not permission.
- **Diary content** is only handled in `server/src/services/diary/`: bodies go through `inspectBody` (sanitise +
  measure) before anything else, are sealed with the entry's DEK and the matching `fieldAad` label, and are
  never logged. Limit values come from `shared/src/limits.ts`.
- **The diary keyring** is only for `server/src/services/diary/`; lint enforces it (tested in
  `server/test/unit/lint-rules.test.ts`). Never work around the rule.
- **Activity events:** record them with `recordActivity`/`recordLogin` wrapped in `safely(...)` so a logging
  failure never breaks the user's request. `detail` holds small facts only (device label, reason, which
  limit); never content, titles or profile fields.
- **Scheduled jobs** live in `server/src/jobs.ts` and run via `server/src/scheduler.ts` (started by `main.ts`
  only). Tests call a job's function directly, or `runJob` to check run records and locking.
- **Email** goes through `ctx.mailer`; tests pass a `FakeMailer` to `createTestApp({ mailer })`. Without
  `SMTP_URL` there is no mailer and alerts stay in the app.
- **Race conditions** (e.g. the last-admin rules) are tested at the service level with simultaneous calls over
  several rounds; over HTTP the first request usually finishes first and hides the race.
- **Config:** only through `loadConfig` in `server/src/config.ts`. Add every new variable to `.env.example`
  with a comment, and to `scripts/dev-setup.mjs` if it is a secret.
- **Comments** explain why, not what. Public functions get a doc comment.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).

## Known pitfalls

- **VS Code as a Flatpak** (this machine): the editor's terminal is sandboxed and can't see the `docker`
  command. Use `flatpak-spawn --host docker compose …` from that terminal, or a normal system terminal. Ports
  published by containers (5432 → 55432, 3000) are reachable from inside the sandbox.
- **Git hooks can't find Node** (`npx`/`node: command not found` on commit): your git client's PATH lacks
  Node (common with VS Code as a Flatpak, or nvm/fnm set up only in interactive shells). Create a git-ignored
  `lefthook-local.yml` containing `rc: ./.lefthook-node.sh`, and in that script put Node on PATH (for fnm:
  `eval "$(fnm env --shell bash)"`). Then run `npx lefthook install`, which bakes the rc line into the hook.
- **Node version:** the system Node may be newer than `.nvmrc`. Use `fnm use` (or `fnm exec --using=22 …`).
  The production image pins the same version.
- **Empty journal:** `db/migrations/meta/_journal.json` exists even with no migrations, so `/readyz` can tell
  "never migrated" from "up to date". Don't delete it.
- **Dev-only audit warnings:** `npm audit` reports moderate issues in an old esbuild inside `drizzle-kit`
  (dev tool only, never shipped or served). CI fails only on production-dependency findings.
- **`.env` and gitleaks:** a local secret scan of the working tree flags `.env`. That's expected (it's
  git-ignored and holds throwaway keys); CI scans git history, which must stay clean.

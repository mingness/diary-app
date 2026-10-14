# AGENTS.md

Working notes for anyone (human or AI) changing this repo. Read `docs/project_prompt.md` (what to build),
`docs/project_prompt_engineering.md` (how), `docs/ARCHITECTURE.md` and `docs/FRONTEND.md` (the design) first.
Keep this file up to date when commands, conventions or pitfalls change.

## Commands

| Task                                                  | Command                                                                             |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Install                                               | `npm ci` (Node version in `.nvmrc`; `fnm use` / `nvm use`)                          |
| First-time setup                                      | `npm run dev:setup` (writes `.env` with throwaway keys; never commit it)            |
| Start the database                                    | `npm run db:up`                                                                     |
| Run the API with reload                               | `npm run dev` (http://localhost:3000, needs the database)                           |
| API explorer (try every endpoint in the browser)      | http://localhost:3000/docs (OpenAPI JSON at `/docs/json`)                           |
| Run the whole stack in Docker                         | `docker compose up -d --wait --build`                                               |
| Everything CI checks                                  | `npm run check`                                                                     |
| Format / lint / types                                 | `npm run format`, `npm run lint`, `npm run typecheck`                               |
| Unit tests (no database)                              | `npm run test:unit`                                                                 |
| Integration tests                                     | `npm run test:integration` (needs `npm run db:up`; each file gets a fresh database) |
| All tests / unit tests on save                        | `npm test`, `npm run test:watch`                                                    |
| Coverage report (all tests; HTML in `coverage/`)      | `npm run test:coverage`                                                             |
| New migration after editing `server/src/db/schema.ts` | `npm run db:generate -w server`, then review the SQL                                |
| Stop the database                                     | `npm run db:down` (add `-v` to `docker compose down` to wipe data)                  |

## Layout

- `shared/`: zod schemas and types used by both server and web. Error codes live here.
- `server/src/`: `main.ts` (process entry), `app.ts` (builds Fastify; tests use it), `config.ts`, `db/`,
  `routes/`. Pure logic will live in `server/src/domain/` with no HTTP or DB code.
- `server/test/unit/` and `server/test/integration/`; helpers in `server/test/helpers/`. The test scripts also
  work from inside `server/` (`npm test`, `npm run test:unit`, …); they share the root `vitest.config.ts`.
- `db/migrations/`: generated SQL plus `meta/_journal.json`. Append-only once shipped.

## Conventions

- **Plan first, small slices.** Follow the delivery plan in `docs/ARCHITECTURE.md` §11. Each slice ends with
  `npm run check` green and `docker compose up` working. Nothing half-built is reachable.
- **Tests ship with the code.** A bug fix starts with a failing test. Integration tests cover every role,
  allowed and denied.
- **Ask before:** adding a runtime dependency, changing encryption or key handling, changing the auth flow, or
  writing a destructive migration.
- **Routes declare zod schemas** for params, body and every response (use `app.withTypeProvider<ZodTypeProvider>()`).
  That validates requests and feeds the API explorer; a route without a response schema is incomplete.
- **Errors:** always `{code, message, requestId}`. Codes come from `ErrorCode` in `shared/`; the web app
  translates them. Never put stack traces or secrets in responses.
- **Logging:** structured, via `request.log` / `app.log`. Never log passwords, tokens, keys, diary content,
  comments or profile fields; the redaction list in `server/src/logging.ts` is a backstop, not permission.
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

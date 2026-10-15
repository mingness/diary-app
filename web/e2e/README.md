# End-to-end tests

**Local only, not part of CI** (ARCHITECTURE §10): run them before merging a change with UI.

Playwright drives the built web app in a browser at 360 px and 1280 px, in both languages (four projects; see
`../playwright.config.ts`). Each project signs in as its own seeded user.

## Their own stack

The tests never touch the development stack. They run against a separate Compose project,
`cultivation-diary-e2e`, with its own database and the ports in `stack.env` (app on http://localhost:8081).
Global setup, on every run:

1. builds and starts that stack, recreating the server so its per-IP limits start fresh;
2. wipes and reseeds its database, keeping the admins' new authenticator keys in `.auth/seed.json`;
3. signs each project's user in once and saves the session in `.auth/`, so tests needn't use the form.

The stack keeps running afterwards so the next run starts faster.

## Running

```sh
npx playwright install chromium   # once
npm run test:e2e                  # about 35 s, including the stack
npm run e2e:down                  # remove the test stack and its data when you're done
```

Needs `.env` from `npm run dev:setup` (it reads `POSTGRES_PASSWORD` and relies on `CAPTCHA_FIXED=true`).
From a sandboxed editor terminal without `docker` (AGENTS.md, known pitfalls), set the command:
`DOCKER="flatpak-spawn --host docker" npm run test:e2e`.

## Limits

The server's per-IP limits are real: 60 CAPTCHAs and 20 sign-ins a minute, 10 registrations and 5
forgot-password requests an hour. They reset with each run, but tests that use them heavily run in one
project only.

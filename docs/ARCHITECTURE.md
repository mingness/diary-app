# 修行日記 (Cultivation Diary) — Architecture

> Status: **draft for review**, derived from `docs/project_prompt.md` (§1–11, *what*) and
> `docs/project_prompt_engineering.md` (§12, *how*), both revised 2026-10-14 to match the decisions below.
> The screens are designed in `docs/FRONTEND.md` (decisions F1–F6 agreed); §5 and §7 below include what those
> screens need. Implementation follows the delivery plan in §11: backend first, then the frontend.
> Open items are marked in §12; each agreed decision becomes an ADR in `docs/decisions/`.

## 1. Goals and non-goals

**Goals**
- A private, bilingual (繁體中文 default / English) diary platform, 修行日記, with supervision: users write
  encrypted diaries; course leaders read *submitted* entries and comment; sharing needs a leader's approval.
- A collective daily-count activity (报数) with a 10,000,000 goal and a nightly auto-submit (§7).
- Installable on phones as a web app (manifest + service worker), with an Android wrapper only as a fallback.
- Built to §12: tested, observable, no secrets in git, CI-gated, reproducible.

**Non-goals**
- Protecting diaries from people with server access. The server holds the keys (§6), so anyone who can read
  the server's secrets can read diaries. `docs/SECURITY.md` must say so plainly.
- Courses (isolated groups of users). The app behaves as one course for now. Keep the schema open to adding a
  `courses` table later, but build nothing for it.
- Email verification (§4.2), multi-tenant support.

### 1.1 Changes from the original spec (agreed 2026-10-14, now folded into the spec)

| Original | Now |
|---|---|
| Exactly one SUPER_ADMIN reads every diary, including drafts | **COURSE_LEADER**, one or more. Leaders read *submitted* entries only and comment; each leader has their own comment. |
| Exactly one SYS_ADMIN | **One or more**, with TOTP required. The last one cannot be deleted or demoted. |
| DEK wrapped with a password-derived key *and* the SUPER_ADMIN key | **Option A (§6):** random DEK per document, wrapped by server-held keys only. Passwords are for login only. |
| Android WebView app with APK self-update | **Installable web app**; the Android wrapper is a fallback (D10). |
| 200+ seeded users, admins "system-generated" | Test environment only. Production starts empty, and the first SYS_ADMIN is created with a CLI command. |
| Title 日记 | **修行日記** (English: Cultivation Diary) |
| The user picks a diary's date | The server sets it to the creation date (Beijing); several entries per date; no backdating (D22) |
| One 提交 button for every submit | 提交 for the first submit, **更新** for later updates (D22) |
| No usage limits | Daily and per-entry limits (D21), SYS_ADMIN-only deletes (D24), SYS_ADMIN activity log, Attention list and email alerts (D26, D27) |

## 2. Stack (D1, agreed)

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript (strict)**, server and web | §12.9 static types; one language across the repo |
| Runtime | **Node.js 22 LTS**, pinned in `.nvmrc` | Built-in `crypto`: AES-GCM, HKDF, `randomInt`, `timingSafeEqual` |
| HTTP | **Fastify** | Schema-validated routes, body limits, pino logging, request IDs |
| Validation | **zod**, in `/shared` for server and web | One schema for server validation and client types |
| DB | **PostgreSQL 16** (pinned tag) | Real DB in integration tests (§12.5) |
| DB access | **Drizzle ORM** on `pg`; `drizzle-zod` | Typed schema, parameterised by construction |
| Migrations | **drizzle-kit** generates SQL into `/db/migrations`; applied at startup | Versioned SQL files, never edited after shipping (§12.6) |
| Password hash | **argon2id** (`@node-rs/argon2`) | §12.4 |
| HTML sanitising | **sanitize-html** on the server (editor tags only) | Stored-XSS defence for shared entries |
| Web | **React 19 + Vite**, react-router (data router) | Static build, served by nginx in the `web` container. React 19 rather than 18: 18 no longer gets fixes, and nothing we use needs 18 (changed 2026-10-15) |
| Server state (web) | **TanStack Query** (F4, agreed) | Polling that pauses, retries, cache invalidation after writes; see FRONTEND.md §10 |
| Rich text (web) | **Tiptap** on ProseMirror (F4, agreed) | Replaces deprecated `execCommand`; its schema mirrors the server's sanitiser allowlist |
| PWA | **vite-plugin-pwa** (Workbox) | Manifest, service worker and update prompt |
| Tests | **Vitest**, **Playwright**; Postgres from `docker compose` locally and a service container in CI | §12.5; each test file gets its own fresh database; injectable clock and RNG |
| Email | **nodemailer** over SMTP (D27) | Admin alert emails from a QQ or 163 mailbox; no extra DNS setup |
| API explorer | **OpenAPI** generated from the zod route schemas, shown with **Swagger UI** (dev and staging only) | The "dashboard" for checking the API by hand before there is a frontend, at `/docs`. Agreed (D20); `API_DOCS` turns it on or off |
| Lint/format | ESLint + Prettier, **lefthook** pre-commit, **gitleaks** | §12.3, §12.9 |

Any runtime dependency not listed here needs approval (§12.1).

## 3. Repository layout

```
/server            Fastify API. Pure modules in src/domain (crypto, authz, diary, sharing, count) have no HTTP code
/web               React app + PWA (strings only in src/i18n)
/shared            zod schemas and types shared by server and web
/db/migrations     generated by drizzle-kit, reviewed, append-only
/deploy            compose files, reverse proxy with TLS, server setup (written fresh)
/scripts           dev-setup (throwaway keys), seed, backup, restore, rotate-keys
/docs              ARCHITECTURE.md, decisions/, RUNBOOK.md, SECURITY.md, PRIVACY.md
/.github/workflows ci.yml, release.yml, deploy.yml
AGENTS.md          build/test/run commands, conventions, pitfalls
```

`/android` is added only if D10 calls for it.

## 4. Components

```
 Browser / installed web app
        │  HTTPS, HttpOnly session cookie, CSRF header
        ▼
   reverse proxy (TLS, CSP, rate limits, body limit, denies /internal/)
        │ /api                         └──► web static assets + manifest + service worker
        ▼
   server (Fastify)
     ├─ routes/          validate → load actor → authz → domain → shape response
     ├─ domain/crypto    keyring, DEK wrap/unwrap, AES-GCM (pure)
     ├─ domain/authz     policy: can(actor, action, resource) (pure, default-deny)
     ├─ domain/diary     lifecycle, history cap, sharing state machine, comments
     ├─ domain/count     trim/clamp, count-date window, aggregation, auto-submit job
     ├─ domain/limits    daily and per-entry limits, attention rules (pure)
     ├─ alerts           Attention list, email outbox sender (SMTP, optional)
     ├─ scheduler        02:00 count job, activity retention, alert sender;
     │                   Asia/Shanghai, injected clock, advisory lock
     ├─ cli              create-sysadmin, rotate-keys, run-count-job
     └─ db/              Drizzle schema + queries
        ▼
   PostgreSQL
```

## 5. Data model

All timestamps are `timestamptz`. "Today" for counting is the date in **Asia/Shanghai**.

All `id`s are **UUIDs generated by the server** before insert, not database sequences. Each ciphertext is
bound to its record's ID (§6.2), so the ID must exist before encrypting; UUIDs also stop anyone guessing
other entries' IDs by counting.

```
users
  id, username UNIQUE (immutable), email UNIQUE NULL
  role ENUM(NORMAL_USER, COURSE_LEADER, SYS_ADMIN)   -- one role per account
  password_hash                           -- argon2id PHC string (parameters inside, upgraded on login)
  reset_pending BOOL                      -- §4.3 lock-out: login refused, old hash kept until an admin resets
  totp_secret_ct/nonce NULL, totp_enabled_at NULL    -- secret encrypted with the profile DEK; required for SYS_ADMIN
  totp_last_step NULL                     -- last accepted code's time step, so a code can't be replayed
  font_size SMALLINT DEFAULT 18, theme ENUM(light, dark, system) DEFAULT system
  profile_ct, profile_nonce, profile_dek_wrapped     -- {familyName, givenName, address, photo}
  created_at, updated_at

documents
  id, owner_id FK CASCADE
  title (plaintext, §3)                   -- the submitted title (before the first submit, the working title)
  draft_title NULL                        -- a pending title change leaders don't see until 更新
  diary_date DATE                         -- set by the server from created_at (Asia/Shanghai); never from the client
  content_ct, content_nonce               -- last *submitted* content; leaders see only this
  draft_ct, draft_nonce, draft_saved_at   -- owner only, never shown to leaders
  first_submitted_at NULL                 -- NULL = never submitted = invisible to leaders
  last_submitted_at NULL
  CHECKs: ciphertext/nonce pairs set together; content exists iff first_submitted_at is set; only submitted
  entries can be anything but private
  access ENUM(private, wait_for_open, open)
  access_decided_by FK users NULL, access_decided_at NULL   -- last sharing change; for a waiting entry, the request
  dek_wrapped, key_version
  created_at, updated_at
  INDEX (diary_date) WHERE first_submitted_at IS NOT NULL, INDEX (owner_id, diary_date), INDEX (access)

document_versions                         -- max 3 per document, enforced in one transaction
  id, document_id FK CASCADE, version_no, content_ct, content_nonce, created_at

comments                                  -- at most one per (document, leader)
  id, document_id FK CASCADE, author_id FK users
  body_ct, body_nonce                     -- encrypted with the document's DEK
  state ENUM(draft, submitted), submitted_at NULL, created_at, updated_at
  seen_by_owner_at NULL                   -- set when the owner opens the entry; drives the "new comment" marker
  UNIQUE (document_id, author_id)

count_entries
  id, user_id FK CASCADE, daily_count INT CHECK (1..1080), count_date DATE, submitted_at, auto BOOL
  INDEX (user_id, count_date)             -- count_date is today or up to 5 days earlier, checked by the server

count_settings
  user_id PK, auto_submit BOOL, saved_count INT CHECK (0..1080), updated_at

daily_usage                               -- counters for the daily caps and warning levels (D21, D28); survive deletes, so an admin delete refunds nothing
  user_id FK CASCADE, day DATE, kind ENUM(create, submit, update, comment), n INT   -- comment: warn only, no cap
  PRIMARY KEY (user_id, day, kind)        -- checked and incremented in the same transaction as the write

activity_events                           -- metadata only, never content; kept 90 days; never shown to the user it describes
  id, user_id FK SET NULL, username       -- username kept so events survive the user's deletion
  kind                                    -- entry_created/submitted/updated, count_entry, limit_reached, elevated_activity,
                                          -- login, login_failed, new_device, password_changed
  detail JSONB NULL                       -- e.g. {limit: "submit"}; no content, titles or profile fields
  created_at
  INDEX (user_id, created_at), INDEX (kind, created_at)

alerts                                    -- the Attention list and the email outbox
  id, user_id FK SET NULL, username, rule, created_at
  handled_by FK users NULL, handled_at NULL
  emailed_at NULL, email_attempts INT, last_error NULL

job_runs                                  -- one row per run of each daily job, so missed or failed runs show
  id, job, started_at, finished_at NULL, status ENUM(running, ok, failed)
  summary JSONB NULL                      -- counts only, e.g. {"deleted": 12}
  error NULL

sessions
  id_hash (SHA-256 of the cookie value), user_id, kind ENUM(browser, device)
  device_label                            -- from the user agent at login ("iPhone · Safari"); no IP geolocation
  csrf_token, mfa ENUM(not_required, pending, enrolment_required, verified)
  created_at, last_seen_at, expires_at, revoked_at NULL

read_audit                                -- security log only; never shown to diary owners; kept 90 days
  id, leader_id FK SET NULL, leader_username, document_id FK CASCADE, read_at
                                          -- one row per leader read of an entry or its history

captchas
  id, answer_hash (HMAC under SESSION_SECRET), expires_at   -- single use, 5 minutes
```

Deleting a user deletes their documents (spec). Deleting a leader keeps their *submitted* comments, shown as
"former leader" (D18).

## 6. Encryption (Option A, agreed)

### 6.1 What it protects, and what it doesn't

| Threat | Protected? | By what |
|---|---|---|
| Stolen DB dump or backup | **Yes**, even with weak passwords | Keys never live in the DB |
| SQL injection or read-only DB access | **Yes** | Same |
| SYS_ADMIN, through the app | **Yes** | Authz; SYS_ADMIN code never loads the diary key (tested) |
| Anyone with server access + secrets | **No** | Out of scope (§1); documented in SECURITY.md |
| A stolen leader account | Partly | 30-day cap on leader device sessions, optional TOTP, internal read audit log |

### 6.2 Keys

| Key | Where | Used for |
|---|---|---|
| `DIARY_KEYRING` | Server secret: `v2:<hex>,v1:<hex>`, current key first | Wraps each document DEK |
| `PROFILE_KEYRING` | Server secret, same format | Wraps each profile DEK |
| `SESSION_SECRET` | Server secret | CSRF token derivation |
| `CRON_SECRET` | Server secret | Bearer token for `/internal/count/auto-run` |
| `SMTP_URL` | Server secret, optional | Sending admin alert emails; holds the mailbox's SMTP authorization code (授权码), never its password |
| DEK | 32 random bytes per document and per profile, stored wrapped | AES-256-GCM over content, drafts, versions, comments and profiles |

- Every encryption uses a random 96-bit nonce.
- The associated data binds each ciphertext to where it belongs (`doc:{id}:draft`, `comment:{id}`), so
  ciphertexts can't be moved between rows.
- A wrapped DEK starts with its key version, so `scripts/rotate-keys` can re-wrap in batches. The script is
  idempotent and resumable, and the RUNBOOK documents it. Content itself is never re-encrypted.
- **Key custody:** losing `DIARY_KEYRING` loses every diary. The keys are generated by `scripts/dev-setup` (dev)
  or by hand (prod), stored offline and separately from DB backups, and their recovery is rehearsed (RUNBOOK).

### 6.3 Consequences

- Passwords only authenticate. Self-service changes, admin resets and forgot-password never touch encrypted
  data, and users never lose access to their old entries. The spec's "admin reset makes old documents
  unreadable" no longer applies.
- Sessions are plain random tokens. No key material is held per session.
- Structural separation: only `domain/diary` imports the diary keyring. A lint rule (import restriction) plus a
  test that calls every SYS_ADMIN endpoint and greps the responses for seeded plaintext enforce it.
- **Profile fields are covered too:** family/given name, address and photo are encrypted with a per-user DEK
  wrapped by `PROFILE_KEYRING`. Username and email stay plaintext, because login and uniqueness checks need them.
  The server decrypts names where screens need them (the count table, leader lists).

## 7. Authorisation

Default deny. Every route declares an action, and the pure function `can(actor, action, resource)` decides
using `actor.role`, `isOwner`, and the document's `first_submitted_at` and `access`.

### 7.1 Who can read an entry

| Reader | Can read when |
|---|---|
| Owner | Always, including draft and history |
| COURSE_LEADER (not the owner) | `first_submitted_at` is set. They see the submitted content, history versions, all submitted comments, and their own draft comment. Never the owner's unsubmitted draft. |
| Other NORMAL_USERs | `access = open`: submitted content + submitted comments |
| SYS_ADMIN | Never. Metadata only (title, date, owner, access state) |

### 7.2 Sharing state machine

```
owner:   private ──request──► wait_for_open ──withdraw──► private
leader:  wait_for_open ──approve (confirm dialog)──► open      (any leader, on their own entries too)
leader:  wait_for_open ──decline──► private
either:  open ──revoke──► private
```

Only submitted entries can be shared. All transitions are server-enforced; access fields in draft or submit
bodies are ignored.

### 7.3 Endpoint matrix

| Endpoint | Anon | NORMAL_USER | COURSE_LEADER | SYS_ADMIN |
|---|---|---|---|---|
| `GET /api/auth/captcha`; `POST /api/auth/login`, `/register`, `/forgot-password` | ✅ rate-limited | – | – | – |
| `POST /api/auth/logout`; `GET/PUT /api/me` (includes `storageBytes`); `POST /api/me/password`; `GET/DELETE /api/me/sessions…` | – | ✅ | ✅ | ✅ |
| `POST /api/me/totp/setup`, `/confirm` | – | ✅ optional | ✅ optional | ✅ required |
| `GET /api/documents/mine?month=` → per entry `state, access, commentCount, hasUnseenComment` | – | ✅ | ✅ | ❌ |
| `POST /api/documents`, `PUT /:id/draft`, `POST /:id/submit` (first submit or update) | – | own, daily limits | own, daily limits | ❌ |
| `GET /api/documents/open?month=` | – | ✅ | ✅ | ❌ |
| `GET /api/documents/:id`, `/:id/versions` | – | per §7.1 | per §7.1 | ❌ |
| `POST /api/documents/:id/access` (`request`/`withdraw`/`revoke`) | – | own | own | ❌ |
| `POST /api/documents/:id/access` (`approve`/`decline`/`revoke`) | – | ❌ | ✅ submitted, own included | ❌ |
| `GET /api/leader/documents?date=&page=&size=`, `?user=&month=` and `?unread=true&page=&size=` → per entry `myCommentState, otherLeaderCommented, unread, access` | – | ❌ | ✅ submitted only | ❌ |
| `GET /api/leader/calendar?month=` → submitted-entry count per day | – | ❌ | ✅ | ❌ |
| `GET /api/leader/open-requests` | – | ❌ | ✅ | ❌ |
| `GET /api/leader/users?month=` → names + entries this month | – | ❌ | ✅ | ❌ |
| `PUT /api/documents/:id/comments/mine` (`{body, state}`) | – | ❌ | ✅ submitted, own included | ❌ |
| `GET /api/admin/users?q=&role=&status=&page=&size=`; `GET /api/admin/users/:id` | – | ❌ | ❌ | ✅ incl. decrypted profiles |
| `POST /api/admin/users`; `PATCH /api/admin/users/:id` (role, email, profile; never username) | – | ❌ | ❌ | ✅ not demoting the last SYS_ADMIN |
| `DELETE /api/admin/users/:id`; `POST /api/admin/users/batch-delete` (NORMAL_USER only) | – | ❌ | ❌ | ✅ not yourself, not the last SYS_ADMIN |
| `POST /api/admin/users/:id/password` (chosen or generated; unlocks reset-pending); `DELETE /api/admin/users/:id/totp` | – | ❌ | ❌ | ✅ (TOTP: not your own) |
| `GET /api/admin/documents?user&date`, `DELETE /:id` | – | ❌ | ❌ | ✅ metadata only |
| `GET /api/count/summary`, `/latest`; `POST /api/count` (`{count, countDate}`); `GET/PUT /api/count/settings` | – | ✅ | ✅ | ✅ |
| `GET /api/admin/count/users`, `PUT /:u/auto`, `DELETE /:u/entries?from=&to=`, `GET /job-runs`, `POST /run-now` | – | ❌ | ❌ | ✅ |
| `GET /api/admin/attention?status=`, `/attention/status`, `POST /api/admin/attention/:id/handled`; `GET /api/admin/activity?userId=&kind=&from=&to=`, `/activity/summary?sort=` | – | ❌ | ❌ | ✅ metadata only |
| `POST /api/admin/users/:id/sign-out-all`, `/lock` | – | ❌ | ❌ | ✅ (lock: not yourself, never the last usable SYS_ADMIN) |
| `POST /api/translate` (`{documentId}` or `{commentId}`, direction) | – | readable only, rate-limited | same | ❌ |
| `POST /internal/count/auto-run` | Bearer `CRON_SECRET`, internal network only | | | |
| `GET /healthz`, `/readyz` | ✅ | | | |

Translate takes an **id**, not free text. The server checks read access and decrypts the text itself, which
keeps the endpoint from becoming a free LLM proxy.

Because each account has exactly one role, separation of duties is automatic: a SYS_ADMIN account can never read
diaries. A leader's own entries follow the owner rows and the leader rows alike: leaders may comment on and decide sharing
for any submitted entry, their own included, and the review lists include their own entries.

## 8. Feature design notes

### 8.1 Bootstrapping and environments

- **Production** starts with an empty DB. `docker compose exec server node dist/cli.js create-sysadmin <username>`
  prompts for a password and prints a TOTP enrolment QR code in the terminal. From then on, SYS_ADMINs create
  leaders and other admins in the UI.
- **Dev/test seed** (`scripts/seed`, refused when `NODE_ENV=production`): matches the spec's §11 seed list.
  Seeded passwords, keys and TOTP secrets are throwaway.

### 8.2 Auth and sessions

- **CAPTCHA (§4.1):** server-rendered SVG whose glyphs are paths. The answer is never sent to the client and is
  stored hashed; each CAPTCHA is single-use and refreshes on failure.
- **Rate limits:** per IP at the proxy, per username in the app.
- **Forgot password (§4.3):** always answers "已經提交給管理員", so it doesn't reveal which usernames exist.
  It needs the CAPTCHA and is rate-limited, because anyone can lock any account by name. SYS_ADMIN accounts
  can't be locked from this public form (otherwise anyone could lock every admin out); a locked-out admin is
  recovered by another admin or the CLI (`set-password`, `reset-totp`).
- **Accounts:** usernames are 3–32 characters (letters, digits, `.` `_` `-`), unique ignoring case; passwords
  8–256 characters. Failed logins answer the same and take the same time for unknown users, wrong passwords
  and locked accounts. Five failures for a username within 15 minutes block it for the rest of the window;
  the same applies to wrong authenticator codes, which also end the half-open session. These counters, and
  the per-IP limits, live in memory: right for the single server instance we plan to run. Moving them to the
  database is not scheduled; it becomes necessary only if we ever run several instances behind a load
  balancer. A SYS_ADMIN issues a password from an alphabet without look-alike characters using
  `crypto.randomInt`. It is shown once, and all of the user's sessions are revoked.
- **Sessions:** an HttpOnly, Secure, SameSite=Lax cookie holds a random token; the DB stores only its hash.
  Plus a CSRF header.
  - **Browser session:** 12 h idle timeout.
  - **"Remember this device"**, the device token: 90-day sliding expiry. It's listed under Account → Devices
    and can be revoked there.
  - Leaders and SYS_ADMINs: device sessions capped at 30 days.
  - Waiting for an authenticator code: 5 minutes.
  - Production uses the `__Host-sid` cookie name, which browsers only accept with Secure, path=/ and no domain.
  - Signing in replaces any session the browser already had (prevents session fixation).
- **TOTP:** required for SYS_ADMIN, enrolled on first login (or through the CLI for the first admin); optional
  for others. Recovery is another SYS_ADMIN resetting it, or the CLI for the last admin.
  - `SKIP_TOTP=true` (development only, written by `dev-setup`; the server refuses to start with it in
    production) skips the code at sign-in, so admins use a password alone locally. The e2e stack forces it
    off, so the browser tests still go through the authenticator (agreed 2026-10-15).
  - Password changes and resets revoke all the user's sessions except the current one. Changing one's own
    password needs the current one; wrong guesses share the sign-in throttle, so a stolen session can't be
    used to guess it.

### 8.3 Diary

- **Editor (§5.2):** Tiptap with only the extensions matching the allowlisted tags (`p, h1–h3, b, strong, u,
  span[style=font-family|font-size], img[src=data:image/(jpeg|png|webp)], br`). The server sanitiser uses the
  same allowlist, so anything the editor can produce survives sanitising unchanged.
- **Buttons:** the draft/submit enable logic is a unit-tested reducer. Auto-draft runs every 5 minutes while
  there are unsaved changes. The submit button reads 提交 until `first_submitted_at` is set, then 更新.
- **Entry date (D22):** `diary_date` is the Asia/Shanghai date of `created_at`, set on insert. Create and draft
  bodies carry no date, so backdating is impossible rather than merely validated.
- **Images (D6, agreed):**
  - The client downscales any image over 500 KB or 1600 px on its long edge to fit within 1600 px, as JPEG at
    quality 0.8, stepping down to 0.6 until it's under 500 KB. Re-encoding also drops EXIF/GPS data.
  - A notice reports the change, e.g. "圖片已縮小：4032×3024 (3.2 MB) → 1600×1200 (310 KB)".
  - The server caps each image at 1 MB, each document at 8 MB and each request at 10 MB.
  - At most **2 images per entry** (D21), counted in the sanitised body of drafts and submissions alike.
- **Limits (D21):** the values live in `shared/src/limits.ts`, so the editor's counter and the server agree.
  - Daily, per user, per Asia/Shanghai date: 20 creates, 20 first submissions, 50 updates, tracked in
    `daily_usage` within the write's transaction.
  - Per entry: 2 images; 5,000 characters of visible body text after sanitising, **whitespace not counted**
    (`visibleCharCount` in `shared/src/limits.ts`; the editor and the server then agree exactly however each
    represents paragraph breaks). A draft over 5,000 characters still saves; only submit/update is refused, so
    text is never lost.
  - Submitting exactly what is already submitted (same title and body) changes nothing and counts nothing, so
    a double click is harmless.
  - A refused write returns `LIMIT_REACHED` with `{limit, resetsAt}` (409), records a `limit_reached` activity
    event, and raises an alert only for a daily cap (D28). Warning levels below the caps flag without refusing
    (§8.9).
  - No storage quota. `storageBytes` is the sum of the user's ciphertext sizes (content, draft, versions,
    comments on their entries, profile), computed on request; cache it only if it proves slow.
- **Deleting (D24):** users can't delete entries. Only a SYS_ADMIN deletes, immediately, cascading to
  versions and comments.
- **Comments:** each leader has at most one comment per entry, which they can save as a draft or submit, and edit
  again later. The owner and permitted readers see all submitted comments, each labelled with its leader's name.
  A submitted comment the owner hasn't opened yet (`seen_by_owner_at` is NULL) shows as new and raises the
  有新批注 toast.
  - A comment has one body and one state, so saving a submitted comment as a draft takes it back out of the
    owner's view until it is submitted again. Resubmitting changed text marks it new for the owner again;
    resubmitting identical text changes nothing.
  - Comments have the entry's per-entry limits (D21): 2 photos, image and body byte caps, and 5,000 visible
    characters on submit (a draft may be longer). Refusals are recorded as for entries, and
    submitted comments count toward the daily comment warning level (D28). A submitted comment also needs some visible text or a photo.
  - The owner's `GET /api/documents/:id` returns submitted comments with `isNew` and then marks exactly those
    seen. A leader's own comment is always `myComment`, never one of `comments`, in either view; on their own
    entry it is never marked new.

### 8.4 Pages

Designed in `docs/FRONTEND.md`: role-based tab bar on phones and top bar on desktop; a read view before the
editor (F1); cards on phones and tables on desktop (F2); approve/decline buttons for open requests (F3);
traditional characters throughout (F5); no offline writing in v1 (F6).

### 8.5 报数

- App-wide: one shared total (agreed).
- `normaliseDailyCount` in `shared/src/count.ts` trims non-digits and clamps to 1–1080, returning notices. The same function runs in
  the client (UX) and the server (enforcement), and DB CHECKs are the backstop.
- **Count date (D23):** today or up to 5 days earlier (Asia/Shanghai), from `countDateChoices` in
  `shared/src/count.ts` (the summary returns the allowed dates for the chips); never in the future. Manual entries are limited to 20 per user per `count_date` (the auto entry is exempt), so backdating
  can't multiply the limit; the 5th warns (`COUNT_WARNING`).
- **A report replaces the day's number:** every total uses each user's latest report per `count_date`
  (`DISTINCT ON … ORDER BY seq DESC`; `seq` is an identity column, because two reports can share a timestamp).
  All rows are kept as traffic. The auto job skips users who already reported for today. Auto-submit always uses today. "Today's count" and "first count date" use
  `count_date`.
- SYS_ADMINs can delete a user's count entries by `count_date` range, so cleaning up after a hijacked account
  keeps the user's honest history.
- The scheduler fires at 02:00 Asia/Shanghai using an injected clock and `pg_try_advisory_lock`, and records a
  `job_runs` row. A missed or failed run shows a banner to SYS_ADMINs: the latest run failed, or no run
  succeeded within 15 minutes of the last 02:00. A manual entry also becomes the user's saved number.
- `POST /internal/count/auto-run` (Bearer `CRON_SECRET`, compared in constant time) runs the same job for an
  external cron. The proxy must not route `/internal/` from the internet (Phase C).

### 8.6 Translation (§8)

The server calls an OpenAI-compatible API (base URL, key and model from env) with a 10-second timeout, which
returns 504 and a toast. It's rate-limited per user and faked in tests. PRIVACY.md must say that translating
sends that text to a third-party provider.

- **Optional:** `TRANSLATE_API_URL`, `TRANSLATE_API_KEY` and `TRANSLATE_MODEL`, all three or none (https only in
  production). Without them `POST /api/translate` answers 503 `translation_unavailable`, and `GET /api/me`
  reports `features.translation: false` so the app greys out the buttons. `ctx.translator` is
  the seam, like `ctx.mailer`; it uses Node's `fetch`, so no new dependency.
- **What is sent:** the text the caller may read, as `toPlainText` of the sanitised body (no markup, no images):
  the owner's newest version (their draft if pending), otherwise the last submitted one; a submitted comment,
  or a leader's own draft comment. Translating is not reading: no read audit, nothing marked seen.
- **Failures:** 504 `translation_timeout`, 502 `translation_failed`; the text and the provider's error body are
  never logged. Capped at 60 translations per user per hour (429) and 10,000 characters (413), in
  `TRANSLATE_LIMITS`; reaching the cap doesn't flag the account (it's cost control, not a misuse signal).
- The prompt asks for Traditional Chinese, keeps Buddhist terms and paragraph breaks, and treats the text as
  text, never as instructions.

### 8.7 Installable web app (primary mobile path)

- **Manifest:** name and short name (D8), icons (192/512 + maskable), `display: standalone`, theme colour.
- **Service worker:** precaches **only the app shell** (HTML/JS/CSS/fonts/icons). `/api/*` is network-only and
  never cached, so diary content never sits in the device cache. When a new version is waiting, a toast offers
  "新版本可用 — 重新載入", which replaces §9's self-update.
- **Install UX:** use `beforeinstallprompt` where the browser supports it (Chrome-based browsers); elsewhere
  (iOS Safari, many Chinese-OEM browsers) show a short how-to sheet. In WeChat's built-in browser, show "open in
  browser" guidance, because installing isn't possible there.
- **Staying logged in:** the "remember this device" session cookie (§8.2) is shared by the installed app and
  the site, and is not subject to Safari's 7-day storage purge (HttpOnly server cookie).
- **Font size (§9):** becomes a per-user setting in Account, stored server-side.
- **Fonts and assets** are bundled, with no CDN (§12.4).

### 8.8 Android fallback (only if D10 says so)

A minimal Kotlin WebView that loads the **remote** HTTPS site, not bundled assets. The site updates itself as
it does for every other user, so the APK only changes when the wrapper changes. It uses the same session
cookies, so no credentials are stored on the device. It needs a file chooser for image inserts. Self-update
follows §9, with a SHA-256 check and signer-match check before installing (§12.4).

### 8.9 Activity, Attention list and alerts (D26, D27)

- **Activity log:** routes record `activity_events` for the kinds listed in §5. Recording never breaks the
  request it describes (a failure is logged and the request carries on). Failed logins are recorded only for
  usernames that exist: a mistyped username is often a password typed into the wrong box. A device is "new"
  when the account hasn't signed in from the same coarse device label in 90 days. Metadata only: the same rule as
  logging (no content, comments, titles or profile fields), with a test that greps events for seeded
  plaintext. A nightly job deletes events older than 90 days. PRIVACY.md says what is recorded and for how long.
- **Attention rules** (pure, in `domain/limits/attention.ts`; the thresholds are constants in
  `shared/src/warning-levels.ts`, to tune after real use): a `limit_reached` for a daily cap (not the per-entry
  limits, which honest writers meet); `elevated_activity`, a daily warning level reached (D28); a burst of
  `login_failed` for one username; several `new_device` events in one day. A rule
  that fires creates one `alerts` row, not one per event, while an unhandled alert for the same user and rule
  exists.
- **In-app first:** the Attention list (badge with the unhandled count) is always on and is the source of
  truth. It works with no email configured.
- **Thresholds (initial):** 10 failed logins for one username within an hour; 3 new devices within 24 hours;
  per day 10 creates, 10 first submissions, 25 updates, 40 submitted comments. A daily warning is counted in
  `daily_usage` with the write and fires on the write whose count lands exactly on the level, so concurrent
  writes produce one event; the route records it after the commit. All in `shared/src/warning-levels.ts`.
- **Locking** can't target yourself, and two admins locking each other at once can't leave nobody able to
  sign in (admin rows are locked and counted in one transaction, as for demotion).
- **Email, optional:** when `SMTP_URL` is set, a scheduler task sends unsent alerts to every SYS_ADMIN's account
  email, with retries, at most one email per flagged user per hour, plus a daily summary. Sending never runs in
  the request that raised the alert, so a slow or failed mailbox can't affect users. Failures are recorded on
  the alert and shown to SYS_ADMINs. Emails carry the username and rule only, written in 繁體中文 then English
  in the same message (the server doesn't know a reader's language), from the server string table (§8.10).
  - Mailbox: a dedicated QQ or 163 account (whichever the SYS_ADMINs use, for reliable delivery), SMTP enabled,
    sending with its authorization code: `smtps://<address>:<code>@smtp.qq.com:465` or `…@smtp.163.com:465`,
    with `MAIL_FROM` set to the same address. Sending from the provider's own domain avoids SPF/DKIM setup.
  - From Hong Kong (D9) these servers are reachable on port 465. The provider could still flag logins from a
    non-mainland IP; failed sends make that visible, and the in-app list keeps working.
  - Dev and CI leave `SMTP_URL` unset (alerts stay in-app), and tests fake the mailer. A Mailpit container can
    be added to the dev compose file to see real emails locally.
- The admin screen shows the mode: "Email alerts: off", or on with the recipient count and last send.

### 8.10 i18n

`web/src/i18n/{zh-Hant,en}.ts` share a typed key set, so a missing key fails the type check. The server
returns error codes, not display strings.

The one exception is alert email, which the server writes itself. Its text lives in
`server/src/i18n/{zh-Hant,en}.ts`, with the same typed-key pattern: one subject and body per attention rule, plus
the daily summary. These two string tables are the only places user-facing wording lives, so wording reviews
cover just those files.

## 9. Observability and operations (§12.7)

- pino JSON logs. A request ID goes into the `X-Request-Id` header and appears in error toasts.
- Logs redact passwords, cookies, content, comments and profile fields. A test greps the captured logs for
  seeded plaintext.
- **Activity log** for SYS_ADMINs (§8.9), metadata only, kept 90 days.
- **Read audit log:** every time a leader opens an entry, the server records (leader, document, time). It's a
  security log for investigating a stolen leader account and is **not shown to diary owners** (agreed). It
  also gives each leader their own 未讀 list (entries they haven't opened since the last submission; last 90
  days, the log's retention; never their own entries), agreed 2026-10-15.
- Error responses use the shape `{code, message, requestId}`.
- **Health checks:** `/healthz` reports that the process is up. `/readyz` checks the DB, that migrations are
  current, and that the keyrings are loaded and valid.
- **Fail-fast config:** in production the server refuses to start if a secret is missing, malformed, or equal
  to a value from `.env.example`. It logs the variable name only.
- **Backups:** a nightly `pg_dump`, encrypted to an offline recipient. The restore is tested in CI. Keyrings
  are backed up separately.

## 10. CI/CD and deploy (§12.8)

- **`ci.yml`** runs on every push and PR: format → lint → typecheck → unit → integration (Postgres service) →
  build the server and web images and smoke-test the stack → gitleaks → `npm audit`.
- **Playwright e2e** runs locally, not in CI (decided 2026-10-15): against `docker compose`, in both
  languages, at 360 px and 1280 px, including (from slice 17) PWA install and an offline shell check. Run it
  before merging a change with UI. This departs from engineering standards §12.5/§12.8, which put it in CI.
- **`release.yml`** runs on `v*` tags. It pushes an immutably tagged server image (with the web build inside or
  alongside) to a registry.
- **Deploy is written fresh.** It runs compose on the server with a TLS-terminating reverse proxy, and the
  `/internal/` paths are blocked at the proxy. A deploy backs up the DB, pulls the tag, migrates and checks
  `/readyz`. A one-command rollback returns to the previous tag. Hosting is planned for Hong Kong (D9).

## 11. Delivery plan

**Always deployable.** Every slice ends with `main` green and runnable: `docker compose up` brings up a working
stack, `/healthz` and `/readyz` pass, migrations apply from empty, and the seed loads. Nothing half-built is
reachable; unfinished routes simply don't exist yet.

### Phase A: backend first, proven by tests

Each slice delivers its API, its unit and integration tests (every role, allowed and denied), its seed data, and
its entries in the API explorer (D20), so it can be checked by hand before any screen exists.

1. **Skeleton:** workspaces, toolchain pins, lint/format/hooks, CI, compose dev stack, `scripts/dev-setup`,
   fail-fast config, structured logging with request IDs, error shape, `/healthz` + `/readyz`, migrations at
   startup, `AGENTS.md`.
2. **Core domain:** crypto keyring + DEK, authz policy table, sharing state machine, count input rules. Pure
   modules, unit-tested exhaustively.
3. **Users and auth:** schema, `create-sysadmin` CLI, CAPTCHA, login/logout, sessions and devices, register,
   forgot password, TOTP, rate limits, seed users. Activity events for logins, failed logins and new devices.
4. **SYS_ADMIN API:** users and roles, password resets, the lint rules keeping the diary keyring out of admin
   code, activity log and summary, Attention list, sign-out-all and lock, the scheduler (`job_runs`,
   advisory locks, retention) and the email sender (optional SMTP). *(Done; step 3's activity events for
   logins, failed logins and new devices were added here.)*
5. **Diary API:** create, draft, submit and update, history cap, sanitising, size caps, server-set entry date,
   daily and per-entry limits, storage usage extended to entries, seed entries in every state; SYS_ADMIN
   document metadata and deletes, and the "no plaintext for SYS_ADMIN" test (it discovers every GET endpoint
   from the OpenAPI document). *(Done. The comments table exists already, so list counts are real; the
   comment API arrives in slice 6. Until slices 6–7 add the leader and reader views, an entry answers 404 to
   anyone but its owner.)*
6. **Leader API:** lists, calendar counts, comments, open approvals, read audit. *(Done. The whole sharing
   endpoint `POST /api/documents/:id/access` arrived here, owner actions included, because approvals need
   requests and the seed now goes through it.)*
7. **Open diaries API:** the month list of open entries and the reader view of an open entry. *(Done. The
   list carries no content; expanding a row reads the entry through `GET /api/documents/:id`, which checks
   access again. Readers' reads aren't audited: the audit is for leaders.)*
8. **Account API:** profile, password change, devices, preferences. *(Done. A wrong current password answers
   `wrong_password` (403, not 401, so the app doesn't treat it as signed out) and counts toward the same
   per-username throttle as sign-in.)*
9. **報數 API:** summary, latest, settings, count date and per-date limit, admin list, delete by date range,
   scheduler, job runs. *(Done. One auto entry per user per date, enforced by a unique index, so running the
   job again the same day changes nothing. Only manual entries are `count_entry` activity. Reaching the
   per-date cap flags the account like the daily caps.)*
10. **Translation API** (faked in tests). *(Done. The app's error handler now passes deliberate `HttpError`s
    through at 5xx too, so 502/503/504 keep their codes; only unexpected errors become `internal_error`.)*

### Phase B: frontend, iteratively, against seeded data

The dev stack runs the real API with seed data, so every screen is built against realistic content in all
states. Each slice is one screen group, with Playwright e2e tests at 360 px and 1280 px in both languages.

11. **App shell:** tokens, themes, text sizes, i18n, tab bar/top bar, toasts, error states. *(Done. The
    `web` container (nginx) serves the build, sets the CSP and forwards `/api`; it is the reverse proxy that
    Phase C adds TLS to. Tabs appear as their screens are built; until then every landing goes to 我的,
    which has appearance and sign-out. Playwright visual snapshots (FRONTEND.md §5) are deferred: CJK fonts
    differ between machines, so they need a pinned browser image first.)*
12. **Login, register, forgot password.** *(Done, with the authenticator step and first-time authenticator
    setup for SYS_ADMINs. Registration takes no photo yet; it arrives with the account page in slice 16.)*
13. **My diary, entry view, editor** (Tiptap, image downscaling, photo and length limits, 提交/更新).
    *(Done, with 開放日記 (no slice listed it; it reuses the entry view). A new entry is created by its first
    save, not by 撰寫日記, so an abandoned blank page uses none of the 20 daily creates. Stored HTML is shown
    through a read-only editor with the same schema, so the browser drops anything outside the allowlist a
    second time. The CSP now allows inline style attributes (`style-src-attr`) for the font and size spans;
    `<style>` and scripts stay blocked. Font sizes are `85%`, `1.25em` and `1.5em`, because the sanitiser's
    pattern rejects `125%`; `web/test/sanitiser-agreement.test.ts` checks every toolbar value against it.
    Leaders' own diaries use these screens; the leader's review and comment editor are slice 14.)*
14. **Leader review and open requests.** *(Done. 批閱 opens on today's submitted entries; the day, page,
    page size, student and open entry live in the address. Three panes on desktop, two on tablets, and on
    phones an entry opens full screen. The comment editor shares the diary editor's toolbar and photo
    handling; its autosave only runs while the comment isn't submitted, since saving a submitted comment as a
    draft takes it away from the student. The requests badge polls every minute. Leaders' tabs: 批閱 · 申請 ·
    日記 · 我的 on phones, plus 開放日記 on desktop; 報數 joins in slice 16. Afterwards (2026-10-15): 上一篇 /
    下一篇 and a 連續閱讀 feed on every list, one page-level guard for unsaved comments (`UnsavedGuard`), and
    開放日記 read-only for leaders, with their own comment listed there. Then 開放日記 became a filtered,
    read-only feed (calendar day and author, worked out from the month's list; no page per entry), and the
    leaders got 未讀 (`?unread=true`, from the read audit). Finally (agreed 2026-10-15, "fewest clicks"):
    every list is a continuous feed; 開放申請 became a filter of the one 批閱 tab; no page per entry and no
    one-at-a-time view, so the stepper and reading pane are gone.)*
15. **SYS_ADMIN screens**, including Attention and activity. *(Done, except 報數管理, which comes with 報數 in
    slice 16. Password resets became a filter of 用戶 (the 等待重設 count is its tab's badge) rather than a tab.
    Tabs: 注意 · 用戶 · 日記管理 · 我的. The e2e setup signs in one SYS_ADMIN (`admin2`, with its
    authenticator code) shared by every project; `admin` stays for the sign-in form test, since a code can't
    be used twice.)*
16. **報數 and account.** *(Done. `GET /api/count/summary` gained `mine` (my number and manual reports for
    each allowed date). 報數 is a tab for every role, SYS_ADMINs included; 報數管理 is a link from it. The
    account page has profile (photo resized in the browser), appearance, storage, password (a sheet), the
    SYS_ADMIN authenticator status (self-reset still deferred, Q1), devices, and sign-out.)*
17. **Installable web app:** manifest, service worker, update toast, install help. Then the phone check for D10.

### Phase C: production

18. **Ops:** deploy to Hong Kong with TLS, backup/restore, key rotation, RUNBOOK, SECURITY.md, PRIVACY.md,
    release pipeline. Includes two rate-limit tasks that only matter once there is a reverse proxy:
    - Tell the server to trust the proxy's `X-Forwarded-For` (and nothing else), otherwise every visitor
      appears to come from the proxy's address and shares one per-IP limit.
    - Add coarse per-IP limits at the proxy as a first line of defence. (A staging deploy can come earlier, as soon as slice 3 is done, to exercise the pipeline.)

Each slice ships with tests, both languages where it has UI, permission tests per role, and doc updates (§12.10).

## 12. Decisions

| # | Question | Status |
|---|---|---|
| D1 | Stack | **Agreed**: §2 |
| D2 | Start fresh | **Agreed**: branch `new-site`; deploy written fresh |
| D3 | Profile encryption | **Agreed**: Option A, profile DEK wrapped by `PROFILE_KEYRING` |
| D4 | Mobile auto-login without storing passwords | **Agreed**: "remember this device" session |
| D6 | Image downscale and caps | **Agreed**: §8.3 |
| D8 | App title | **Agreed**: 修行日記 |
| D9 | Hosting region | **Agreed: Hong Kong** (no ICP filing needed, low latency to the mainland) |
| D10 | Is the Android wrapper needed? | Open: decide after testing install on users' actual phones |
| D11 | Courses | **Dropped for now**: one global COURSE_LEADER role |
| D12 | Second factor | **Agreed**: TOTP required for SYS_ADMIN, optional for others |
| D13 | 报数 scope | **Agreed**: app-wide |
| D14 | Show owners who read their entry | **Agreed: no**. The read audit stays internal |
| D18 | A leader account is deleted | **Agreed**: submitted comments stay, labelled "former leader"; drafts are deleted |
| D19 | Can a COURSE_LEADER keep a diary? | **Agreed: yes**. Other leaders read and comment on it. Changed 2026-10-15: a leader may also comment on and approve sharing for their own entry, so the leader rules have no own-entry exception |
| D20 | API explorer for checking the backend by hand | **Agreed**: `@fastify/swagger` + `@fastify/swagger-ui` + `fastify-type-provider-zod` (OpenAPI from the zod schemas; assets bundled, no CDN). On by default outside production, off in production; staging sets `API_DOCS=true` |
| D21 | Usage limits against a hijacked account | **Agreed**: per user per day 20 creates, 20 first submissions, 50 updates; per entry 2 photos and 5,000 characters (framed as care for the reading leader); 20 manual count reports per count date (a report replaces that date's number, so this only limits traffic; changed 2026-10-15). §8.3, §8.5 |
| D22 | Entry dates and the submit button | **Agreed**: date = creation date, set by the server; several entries per date; no backdating. 提交 for the first submit, then 更新 |
| D23 | Backdating counts | **Agreed**: up to 5 days back; the count limit applies per count date |
| D24 | Deleting entries | **Agreed**: SYS_ADMIN only, immediate. No user delete or trash until asked for |
| D25 | Storage quota | **Agreed: none**. Daily limits and image caps bound storage; usage is shown to the user and to SYS_ADMINs |
| D26 | Spotting odd behaviour | **Agreed**: metadata-only activity log (90 days), Attention list with simple rules, sign-out-all, lock, delete counts by date range. §8.9 |
| D27 | Alerting SYS_ADMINs | **Agreed**: in-app Attention list always; email via SMTP (`nodemailer`, approved) from a QQ/163 mailbox when `SMTP_URL` is set. Web Push rejected: Android push is blocked in mainland China |
| D28 | Warning levels separate from caps | **Agreed**: limits exist to spot misuse, keep leaders' reading load manageable and keep entries lean. Caps refuse; warning levels (about half the caps, plus 40 submitted comments a day) only flag the account, once a day. Per-entry refusals no longer flag. Comments have the entry's per-entry limits. §8.3, §8.9 |
| Q1 | SYS_ADMIN resetting their own authenticator (spec §4.4 "set up / reset") | **Deferred** (2026-10-15): another SYS_ADMIN or the CLI resets it. Revisit once the frontend is built |
| F1–F6 | Frontend decisions | **Agreed**: see FRONTEND.md §11 |

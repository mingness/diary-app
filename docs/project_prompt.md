# Diary App (日记) — Requirements & Flow Specification

> **Purpose:** a complete functional specification for an AI coding agent to build this application **from scratch** (web + Android). It describes *what the app must do and how it flows* — not how the existing code is written.
> Consolidated from the original requirement rounds (old project `F:\ai_workspace\diary_webapp`) and the deployed, many-times-revised behavior (`F:\ai_workspace\diary-app`).
> App title: **日记 (Diary)** · Languages: 繁體中文 (default) / English, switchable everywhere.

---

## 1. Product Thinking

This is a private diary platform with a supervision workflow:

1. **Users write diaries** privately. Content is encrypted so that even the system operator's ordinary admin cannot read it.
2. **A supervisor (SUPER_ADMIN)** can read every diary and attach **comments (批注)** to them. A comment is invisible to the user until the supervisor submits it.
3. **Users may volunteer to share** a diary. Sharing needs supervisor approval. Once approved ("Open"), any user can read that diary's content and submitted comment.
4. Separately, everyone participates in a collective **报数 (daily count)** activity: each user reports a daily number, contributing to a global progress goal of 10,000,000, with an optional automatic daily submission.
5. A **web app** serves all of this; an **Android app** wraps the same web app and adds self-update capability.

**Golden rules:**
- Every modification resumes from what is already saved in the database — never from a blank state.
- Only the person who owns the data (or SUPER_ADMIN for diaries) may read it in plaintext. SYS_ADMIN manages accounts and metadata but must **never** see diary content or comments.
- When changing the app, touch only the feature in question — never disturb already-tested functionality.

## 2. Users & Roles

| Role | Count | Purpose |
|---|---|---|
| NORMAL_USER | 200+ (seeded test users) | Write diaries, read open diaries, report counts |
| SYS_ADMIN | exactly 1, system-generated | Manage users & documents (metadata only), reset passwords |
| SUPER_ADMIN | exactly 1, system-generated | Read all diaries, write comments, approve sharing |

## 3. Data Concepts & Security Requirements

**user profile** — username (immutable), password, email, address, photo (auto-resized to 300×300 on selection), family name, given name.

**document (diary)** — title (stored in plaintext), content (**encrypted**), date, comment (**encrypted**, written only by SUPER_ADMIN), submitted flag (draft vs submitted), comment-submitted flag, accessibility state (`Private` / `Wait for open` / `Open`), and up to **3 submitted history versions**.

**count entry** — username, daily count (positive integer, 1–1080), submit time, auto-submit flag.

**Encryption requirements (non-negotiable):**
- Diary `content` and `comment` are encrypted with **AES-256-GCM**.
- Every document has its own random data key (DEK).
- The DEK is stored twice: once wrapped with the owner's master key (derived from the owner's login password via PBKDF2), once with a global SUPER_ADMIN master key (kept in server-side secrets).
- Title stays plaintext. Profile fields are encrypted with the owner's master key.
- Consequence to design for: if a password is reset *by the admin*, the old user master key is lost — the user's old documents then remain readable only through the SUPER_ADMIN wrap. A **self-service** password change must re-wrap all the user's document keys so the user keeps access.
- The login password itself is stored as a hash, never in plaintext-recoverable form; a special `RESET_PENDING` state marks a locked-out user.

## 4. Authentication & Account Flows

### 4.1 Login
- Username + password + **human verification** (CAPTCHA). CAPTCHA failure refreshes the question automatically.
- CAPTCHA = a distorted image of a simple **addition or subtraction** question (never ×/÷). Image styling: gradient background, ~200 random colored noise dots, per-character random rotation/skew/color, 5 Bézier interference curves, 15 faint decoy characters. A "更新" refresh button sits beside it.
- A **radio choice 日记 / 报数 (default 报数)** decides where login lands: 报数 → counting page; 日记 → role home (SUPER_ADMIN → admin home, SYS_ADMIN → management home, else user home).
- The Android app may auto-login with saved credentials (no captcha) and remembers the last mode.
- Rate-limit login attempts per IP.

### 4.2 Registration
- CAPTCHA required; **no email verification**; password entered twice and must match; all profile fields settable; on success → login page.

### 4.3 Forgot password
1. User submits username → account is marked `RESET_PENDING` and the user cannot log in.
2. Message shown: "已經提交給管理員" (submitted to the admin).
3. SYS_ADMIN sees the pending-reset list and issues a new password — a generated random 8-character password (ambiguity-free alphabet) or a manually typed one. The new password is shown once to the admin.

### 4.4 Account page (all roles)
- View/edit profile (username read-only); photo picked from local files and resized to 300×300.
- Change password: current password + new password + confirm; mismatch → "两次密码输入不同", nothing changes.
- Logout.

## 5. Diary Document Flow

### 5.1 Lifecycle
```
create → edit → 暂存 (draft, any number of times, auto-saved every 5 min)
       → 提交 (submit; keeps the previous content as a history version, max 3)
→ optional: request open → Wait for open → SUPER_ADMIN confirms → Open
                                              └ or denies/reverts → Private
SUPER_ADMIN reads → writes comment draft (invisible) → submits comment (visible)
```

### 5.2 Editor (used for diary content and for SUPER_ADMIN's comment)
- Title input on top; rich-text body: font family, font size, underline, bold, headings (Title, H1–H3), insert local image.
- Images **> 500 KB are lossy-compressed (resolution may be reduced)** before insertion; images are embedded inline with the text.
- Bottom buttons **暂存 | 提交 | 历史版本**:
  - Both start disabled; become active as soon as the text (or title/date/open-access) changes.
  - 暂存 saves a draft (`submitted = false`), then deactivates itself while 提交 becomes active. Auto-draft every 5 minutes while dirty.
  - 提交 saves, archives the previous content into history (max 3 versions), sets `submitted = true`, then deactivates. Re-entering an already-submitted document does not re-activate 提交.
  - 历史版本 lists the stored versions (version number + time + content) and can collapse.
- **No cursor-jump-to-start bug** is acceptable in the comment editor — the initial text must load without moving the caret.
- After submitting, content must survive re-entry exactly as saved.

### 5.3 Sharing (open-access) flow
```
NORMAL_USER checks the open box  → state = 'Wait for open'  (a request)
SUPER_ADMIN checks it (with a confirm dialog) → state = 'Open'
Either party unchecks            → state = 'Private'
```
- The checkbox shows checked for both `Open` and `Wait for open`; default unchecked.
- `Open` means content **and** submitted comment readable in plaintext by all normal users.

### 5.4 Comment visibility
- SUPER_ADMIN 暂存 comment → invisible to the user.
- SUPER_ADMIN 提交 comment → visible; the user sees it under the diary content, with translation buttons.

## 6. Pages & Behaviors

### 6.1 Document lists (shared component, two modes)
- **By user:** that user's documents, newest date first, one month per page with prev/next month and prev/next year buttons. Rows: title, date, comment-present mark (✅/❌), expand toggle (+/−), access badge in own mode (🔓 Open green / ⏳ Wait for open orange / 🔒 Private gray).
- **By date** (SUPER_ADMIN): all users' documents for a date, `n` per page (default 20, `n` editable 1–100), numeric page navigation.
- **Expanded row format:** a meta line of **values only, separated by tabs — no key names**: title, date, [username], family name-given name (when present), [accessibility], comment mark. Below it the content (sanitized, `'(encrypted)'` placeholder if unreadable), then translation buttons, then — if a comment exists — the label `Comment:` above the comment text with its own translation buttons.
- **Click semantics:** in **My Diary**, clicking the title opens the editor; in **Open Diary**, clicking the title only expands/collapses — never opens an editor.

### 6.2 NORMAL_USER home
- Top-left 攥写日记 button → editor. Top-right avatar + name → account page.
- My Diary / Open Diary toggle; document list below; 30-second polling that raises a toast (5 s) — `有新文档！` for a new own document, `有新批注！` when a submitted comment appears on an own diary — and refreshes the list. **Polling must never run while the user is in the editor.**

### 6.3 SUPER_ADMIN home
- **Calendar** (Chinese weekday headers, month navigation, today & selected highlighted). Immediately after login, **today's document list is shown directly below the calendar** without clicking a date; clicking a date shows that date's list; clicking a user shows that user's list; clicking a document opens the comment editor.
- Document rows expand with all info including family name-given name.

### 6.4 SUPER_ADMIN comment editor
- Shows the document's title, content, date; the editor edits the comment; 暂存/提交 per §5.4.
- Contains the approval checkbox: only `Open` counts as checked; turning it on requires a confirm dialog; a `Wait for open` document shows the hint "⏳ 用户已申请开放，等待确认".

### 6.5 SYS_ADMIN home (sequential sections)
1. **User management** — list users; fuzzy search by username with `?` / `*`; add a user (username + password required, others optional; a generated password is shown once); edit everything except username; delete a user (confirm) — deleting a user **deletes all their documents**; batch delete of normal users.
2. **Document management** — search by username and/or date, delete documents; content/comments are shown as encrypted/metadata only.
3. **报数 admin list** — shows **all** users; per-row toggle of the user's auto-submit flag; per-row button to delete all of a user's count entries (confirm).
4. **Pending password resets** — the `RESET_PENDING` list with the generate/manual password flow (§4.3).

### 6.6 SYS_ADMIN user-profile editor
- Email (unique), family/given name, address, optional new password (shown once after save), photo upload/delete; delete-user button.

## 7. 报数 (Counting) Flow

### 7.1 Count page layout
```
标题: 合计报数
TOTAL COMPLETED總完成: <total> | REPORTED_TODAY今日報告: <today> (entries紀錄: <n>) | GOAL COUNT目標數: 10,000,000
<blue progress bar>  total / goal (xx.xx%)
今日报数 | <number box> | <manual submit> | <auto submit checkbox>
<latest-20 entries table>
```
- Progress = all-time total ÷ 10,000,000 × 100%. Table columns: Username (family+given name if known), Today's Count, Total, First Count Date, Latest Submit Time. Adjacent rows alternate light / sky-blue; auto-submit users shown in blue; table auto-refreshes (≈ every minute / on submit).

### 7.2 Input rules
- Daily count: digits only, invalid characters trimmed with a notice, value clamped to **1–1080** with a notice.
- Manual submit → new entry + refresh all figures and the table; the value also becomes the user's saved default for auto-submit.
- Auto-submit checkbox persists immediately (reverts on failure). The typed value is saved continuously (debounced) so the nightly job always uses the latest number.

### 7.3 Auto-submit job
- **Every day at 02:00 Beijing time** the server automatically submits one entry for every user whose auto-submit is on and whose saved count is positive, using the current time as submit time.
- On the hosted deployment this runs as a platform cron hitting a protected internal endpoint (Bearer secret, mounted outside normal authentication); on a self-hosted server an in-process scheduler fires at the same time. SUPER_ADMIN can also trigger it manually.

### 7.4 Diary ↔ count navigation
- Diary pages have a 报数 button → count page; the count page has a "Go Diary" button → role home, and the user chip → profile.
- The count page header shows the **logo** (green variant, 400×80) with `countTitle` beneath it (`\n` renders as line breaks).

## 8. Translation Feature

- Below diary content and below comments: two buttons in the submit-button style —
  - **翻译**: translate the text from English to 繁體中文 (expert level)
  - **Translate**: translate from 繁體中文 to English (expert level)
- The result is displayed as **plain text below the buttons — never inside a text box**; a new click replaces it; buttons disable while translating.
- Powered by an OpenAI-compatible chat API (base URL, key, model kept in server-side config/env — **never hardcoded or committed**). Server translates, times out gracefully (504 on timeout), and requires login.

## 9. Android App Behavior

- A thin WebView wrapper embedding the built web frontend from local assets (relative paths, hash routing under `file://`).
- On start, injects into the page: the **server URL** (user-configurable in Settings, with a LAN default), a font-size setting (12/14/16/18), and saved credentials; re-injected on every page load.
- WebView must allow file access for the embedded assets, accept cookies, keep state on rotation (no recreate), handle the back key as web-back, and provide a **file chooser** so the editor's image insertion works.
- **Settings screen:** server URL, font size, Save, Test Connection (health endpoint), app version text, and an **更新 Update** button in the submit-button style:
  - Checks the server's app-version endpoint (JSON `{"version":"yyyyMMddHHmmss"}`).
  - Up to date → toast `已经是最新版。`
  - Newer → toast `正在下载更新`, download the APK from the same server, then **install it automatically** (package-installer intent via FileProvider; on Android 8+ route the user to "install unknown apps" permission if missing).
- An update dialog also auto-appears on launch (with an 忽略/ignore option remembered per version).
- Version numbers are build timestamps — always increasing, compared numerically with full precision.
- Server endpoints needed: version check, APK download, health check.

## 10. UX Conventions (accumulated user requirements)

1. Single right-top **language toggle** (shows the *other* language's name) on every page; default 繁體中文; never two separate buttons.
2. Buttons 翻译 / Translate / 更新 must match the **submit** button style.
3. All rows/tables show values plainly; no key-name labels except the `Comment:` label.
4. Editing always resumes saved content; drafts auto-save; nothing is lost on navigation.
5. Invalid numeric input is trimmed and reported to the user, never silently accepted.
6. Notifications are toasts; polling and notifications must not disturb editing.
7. Bilingual UI throughout; new strings go through the translation table.
8. Secrets (API keys) live in configuration, never in client code or the repository.

## 11. Acceptance Checklist

- [ ] Login: captcha (+/− only) verified; failure refreshes image; RESET_PENDING user blocked; mode radio (default 报数) routes correctly.
- [ ] Diary: create → draft (manual + 5-min auto) → submit (max 3 history versions) → cannot resubmit; content never lost; image >500 KB compressed on insert.
- [ ] Sharing: user request → Wait for open → admin confirm → Open; open diary + submitted comment readable by another user; uncheck returns to Private.
- [ ] Comments: draft invisible, submitted visible; no caret jump; translations render as plain text.
- [ ] SYS_ADMIN: can search/add/edit/delete users, reset passwords, query/delete documents — but sees no plaintext content or comments.
- [ ] SUPER_ADMIN: sees today's documents immediately after login; calendar/user navigation reaches the comment editor; can open/approve documents.
- [ ] Self password change keeps old documents readable; admin reset is understood to leave old documents user-unreadable (admin-only).
- [ ] 报数: clamped 1–1080 input; manual submit updates everything; auto-submit toggle persists; admin list shows all users with toggle + delete-entries; auto job runs at 02:00 Beijing.
- [ ] Android: local assets load against the configured server; settings persist; test connection works; update button behaves per §9; file chooser feeds the editor.
- [ ] Seed data: 1 SUPER_ADMIN, 1 SYS_ADMIN, several NORMAL_USERs with encrypted sample diaries (including one Open, two Wait for open, one draft) for immediate testing.

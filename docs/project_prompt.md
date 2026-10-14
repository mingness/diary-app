# Diary App (修行日記) — Requirements & Flow Specification

> **Purpose:** a complete functional specification for an AI coding agent to build this application **from scratch** (a web app, installable on phones). It describes *what the app must do and how it flows* — not how the existing code is written.
> Consolidated from the original requirement rounds (old project `F:\ai_workspace\diary_webapp`) and the deployed, many-times-revised behavior (`F:\ai_workspace\diary-app`).
> **Revised 2026-10-14:** multiple course leaders and SYS_ADMINs, server-held encryption keys, installable web app instead of an Android app; usage limits and
> SYS_ADMIN activity alerts. Design decisions are recorded in `docs/ARCHITECTURE.md`.
> App title: **修行日記** (English: **Cultivation Diary**) · Languages: 繁體中文 (default) / English, switchable everywhere.

---

## 1. Product Thinking

This is a private diary platform with a supervision workflow:

1. **Users write diaries** privately. Content is encrypted at rest, and the administrators who manage accounts (SYS_ADMIN) can never read it.
2. **Course leaders (COURSE_LEADER)** — one or more — can read every *submitted* diary and attach **comments (批注)** to them. A user's unsubmitted drafts are never visible to leaders. A comment is invisible to the user until its leader submits it.
3. **Users may volunteer to share** a diary. Sharing needs a course leader's approval. Once approved ("Open"), any logged-in user can read that diary's content and submitted comments.
4. Separately, everyone participates in a collective **报数 (daily count)** activity: each user reports a daily number, contributing to a global progress goal of 10,000,000, with an optional automatic daily submission.
5. A **web app** serves all of this and can be **installed on a phone's home screen** (web app manifest). An Android wrapper app is a fallback, built only if installing the web app proves impractical for the users (§9).

**Golden rules:**
- Every modification resumes from what is already saved in the database — never from a blank state.
- Only the person who owns the data (or a course leader, for submitted diaries) may read it in plaintext. SYS_ADMIN manages accounts and metadata but must **never** see diary content or comments.
- When changing the app, touch only the feature in question — never disturb already-tested functionality.

## 2. Users & Roles

| Role | Count | Purpose |
|---|---|---|
| NORMAL_USER | any | Write diaries, read open diaries, report counts |
| COURSE_LEADER | one or more | Read all submitted diaries, write comments, approve sharing; may keep their own diary |
| SYS_ADMIN | one or more (the last one cannot be deleted or demoted) | Manage users & documents (metadata only), reset passwords, administer 报数 |

- Each account has exactly one role. A COURSE_LEADER may also keep their own diary, exactly like a NORMAL_USER. Other leaders read and comment on it; a leader never comments on or approves sharing for their own diary. (With only one leader, that leader's diaries cannot be opened for sharing.)
- SYS_ADMIN accounts must log in with a second factor (authenticator app, TOTP).
- **Production starts empty.** The first SYS_ADMIN is created with a server command-line tool. SYS_ADMINs then create other accounts and assign roles; normal users may also self-register.
- **Test environments** are seeded with sample accounts and diaries (§11). The seed must refuse to run against production.
- Courses (separate, isolated groups of users each with their own leaders) are **out of scope** for now; the whole app behaves as a single course. The design should not make adding them later unduly hard.

## 3. Data Concepts & Security Requirements

**user profile** — username (immutable), password, email, address, photo (auto-resized to 300×300 on selection), family name, given name, preferred font size.

**document (diary)** — title (stored in plaintext), content (**encrypted**), date (the Beijing date on which the entry was **created**, set by the server; a user may write several entries on one date, but can never choose or change the date), submitted flag (never submitted / submitted), current unsubmitted draft (**encrypted**), accessibility state (`Private` / `Wait for open` / `Open`), and up to **3 submitted history versions** (**encrypted**).

**comment** — belongs to one document and one course leader; text (**encrypted**); state (draft / submitted). Each course leader has at most one comment per document, which they may edit and resubmit.

**count entry** — username, daily count (positive integer, 1–1080), count date (today or up to 5 days earlier, Beijing time), submit time, auto-submit flag.

**Encryption requirements (non-negotiable):**
- Diary content, drafts, history versions and comments are encrypted with **AES-256-GCM**, with a unique random nonce per encryption.
- Every document has its own random data key (DEK).
- Each DEK is stored wrapped (encrypted) by a **server-held diary key** that lives in server-side secrets, never in the database or the repository. Key versions are recorded so the diary key can be rotated by re-wrapping DEKs.
- Profile fields (family/given name, address, photo) are encrypted the same way, with their own per-user DEK wrapped by a separate server-held profile key. Username and email stay plaintext (needed for login and uniqueness); titles stay plaintext.
- Passwords are used **only to authenticate** and are stored as a slow hash (argon2id). Password changes and resets never affect encrypted data: users always keep access to their old diaries.
- Who can read what is enforced by the server's permission checks on every request. Code paths that serve SYS_ADMIN must never decrypt diary content or comments.
- A locked-out user awaiting a password reset is marked `RESET_PENDING`.
- Consequence to design for: losing the server-held diary key loses every diary. Its backup and rotation are operational requirements (see §12.3 of the engineering standards).

## 4. Authentication & Account Flows

### 4.1 Login
- Username + password + **human verification** (CAPTCHA). CAPTCHA failure refreshes the question automatically. SYS_ADMIN additionally enters a 6-digit authenticator code.
- CAPTCHA = a distorted image of a simple **addition or subtraction** question (never ×/÷). Image styling: gradient background, ~200 random colored noise dots, per-character random rotation/skew/color, 5 Bézier interference curves, 15 faint decoy characters. A "更新" refresh button sits beside it. The answer must never be sent to the client in readable form.
- A **radio choice 修行日記 / 报数 (default 报数)** decides where login lands: 报数 → counting page; 修行日記 → role home (COURSE_LEADER → leader home, SYS_ADMIN → management home, else user home). The last choice is remembered on the device.
- A **"remember this device"** option keeps the user logged in on that device (browser or installed app) for up to 90 days of inactivity, without storing the password. Devices are listed on the account page and can be signed out individually.
- Rate-limit login attempts per IP and per username.

### 4.2 Registration
- CAPTCHA required; **no email verification**; password entered twice and must match; all profile fields settable; creates a NORMAL_USER; on success → login page.

### 4.3 Forgot password
1. User submits username → account is marked `RESET_PENDING` and the user cannot log in.
2. Message shown: "已經提交給管理員" (submitted to the admin) — shown whether or not the username exists.
3. SYS_ADMIN sees the pending-reset list and issues a new password — a generated random 8-character password (ambiguity-free alphabet) or a manually typed one. The new password is shown once to the admin. All of the user's existing sessions are signed out.

### 4.4 Account page (all roles)
- View/edit profile (username read-only); photo picked from local files and resized to 300×300.
- Text size: 標準 / 大 / 特大 / 超大 (16 / 18 / 20 / 22 px), default 大 (18 px). Many users are older; every page must stay usable at the largest size.
- Change password: current password + new password + confirm; mismatch → "两次密码输入不同", nothing changes. Other sessions are signed out.
- Signed-in devices, each with a sign-out button.
- Storage used: the total size of the user's entries (including drafts and history versions) and profile photo. Shown for information only; there is no storage limit (§5.5).
- Theme: light / dark / follow the device.
- SYS_ADMIN: set up / reset the authenticator app.
- Logout.

## 5. Diary Document Flow

### 5.1 Lifecycle
```
create → edit → 暂存 (draft, any number of times, auto-saved every 5 min)   ← visible to the owner only
       → 提交 (first submit)                                                  ← now visible to course leaders
       → 更新 (update; keeps the previous content as a history version, max 3)
→ optional: request open → Wait for open → a course leader confirms → Open
                                                └ or denies/reverts → Private
course leader reads → writes comment draft (invisible) → submits comment (visible)
```
- After a diary has been submitted, the owner may keep editing and drafting; course leaders continue to see the **last submitted** version until the owner updates it.
- **No backdating.** An entry records a thought of the moment, so its date is the day it was created. An entry started on Monday and submitted on Saturday keeps Monday's date; an entry first written on Saturday is dated Saturday. The help text says so.

### 5.2 Editor (used for diary content and for a course leader's comment)
- Title input on top; rich-text body: font family, font size, underline, bold, headings (Title, H1–H3), insert local image.
- Images are processed before insertion so phone photos need no manual preparation: any image over 500 KB or over 1600 px on its long edge is **automatically downscaled** (to fit 1600 px) and lossy-compressed, and the user is told what was done (original and new size). Photo metadata (including location) is removed. Images are embedded inline with the text. The server rejects images and documents over its size limits with a clear message.
- Bottom buttons **暂存 | 提交 | 历史版本**:
  - Both start disabled; become active as soon as the text (or title/open-access) changes.
  - 暂存 saves a draft, then deactivates itself while 提交 becomes active. Auto-draft every 5 minutes while dirty.
  - 提交 saves, marks the document submitted, then deactivates. Once the document has been submitted, the button reads **更新** (update): it saves, archives the previous submitted content into history (max 3 versions), then deactivates. Re-entering an already-submitted document does not re-activate it until something changes.
  - 历史版本 lists the stored versions (version number + time + content) and can collapse.
- **No cursor-jump-to-start bug** is acceptable in the comment editor — the initial text must load without moving the caret.
- After submitting, content must survive re-entry exactly as saved.
- All rich text is sanitized on the server against an allowlist of the editor's own tags and attributes, before storing and before display.

### 5.3 Sharing (open-access) flow
```
NORMAL_USER checks the open box  → state = 'Wait for open'  (a request)
A COURSE_LEADER checks it (with a confirm dialog) → state = 'Open'
Owner or any COURSE_LEADER unchecks → state = 'Private'
```
- The checkbox shows checked for both `Open` and `Wait for open`; default unchecked.
- Only a submitted diary can be shared.
- `Open` means content **and** all submitted comments readable by all logged-in users.
- The server enforces these transitions; a normal user can never set `Open` directly.

### 5.4 Comment visibility
- A course leader's 暂存 comment → invisible to the user and to other leaders.
- A course leader's 提交 comment → visible to the owner (and, for Open diaries, to all readers), under the diary content, labelled with the leader's name, with translation buttons. Other course leaders also see it.
- Owners are not told which leaders have read their diary.
- If a leader's account is deleted, their submitted comments remain, labelled as from a former leader; their unsubmitted comment drafts are deleted.

### 5.5 Limits
Limits stop a hijacked account (stolen session, malware) from flooding the app. The daily ones are set high enough that an honest user, even one catching up on a week's entries on a Saturday, never reaches them. The per-entry ones are deliberate, and are presented kindly.

| Limit | Value | Notes |
|---|---|---|
| New entries created | 20 per user per day | |
| First submissions (提交) | 20 per user per day | A SYS_ADMIN deleting an entry does not give its submission back |
| Updates (更新) of submitted entries | 50 per user per day | A hidden backstop: stops a hijacked account pushing every real version out of the 3-version history |
| Photos | 2 per entry | Applies to drafts and submissions. The image button is disabled after the second photo, with a short note. Encourages choosing the best photos |
| Body length | 5,000 characters per entry | Visible text after sanitising, not HTML. Framed as care for the leader who reads it, e.g. "日記以精簡為佳，方便導師細讀" / "A focused entry is easier for your leader to read closely" (final wording reviewed by a native speaker). A counter appears from 80% |

- "Day" is the Beijing calendar date; daily limits reset at midnight Beijing time.
- **Nothing is ever lost at a limit.** A draft over 5,000 characters still saves; only 提交/更新 is blocked until it is shortened. When a daily limit is reached, the message says which limit and when it resets, and the text in the editor stays.
- **No storage limit.** Storage is bounded by the daily limits and photo sizes. Each user sees their own usage (§4.4), and SYS_ADMINs see everyone's (§6.5).
- Reaching any limit is recorded as an activity event and flags the account for SYS_ADMINs (§6.5).
- The server enforces every limit; the client mirrors them so the user is warned before writing.

### 5.6 Deleting entries
- Users cannot delete their own entries (kept simple until asked for). Only a SYS_ADMIN deletes entries (§6.5), and deletion is immediate.

## 6. Pages & Behaviors

### 6.1 Document lists (shared component, two modes)
- **By user:** that user's documents, newest date first, one month per page with prev/next month and prev/next year buttons. Rows: title, date, comment-present mark (✅/❌), expand toggle (+/−), access badge in own mode (🔓 Open green / ⏳ Wait for open orange / 🔒 Private gray).
- **By date** (COURSE_LEADER): all users' submitted documents for a date, `n` per page (default 20, `n` editable 1–100), numeric page navigation.
- **Expanded row format:** a meta line of **values only, separated by tabs — no key names**: title, date, [username], family name-given name (when present), [accessibility], comment mark. Below it the content (sanitized), then translation buttons, then — if submitted comments exist — the label `Comment:` above each comment (leader's name, then text) with its own translation buttons.
- **Click semantics:** in **My Diary**, clicking the title opens the editor; in **Open Diary**, clicking the title only expands/collapses — never opens an editor.

### 6.2 NORMAL_USER home
- Top-left 攥写日记 button → editor. Top-right avatar + name → account page.
- My Diary / Open Diary toggle; document list below; 30-second polling that raises a toast (5 s) — `有新文档！` for a new own document, `有新批注！` when a submitted comment appears on an own diary — and refreshes the list. **Polling must never run while the user is in the editor**, and pauses while the app is in the background.

### 6.3 COURSE_LEADER home
- **Calendar** (Chinese weekday headers, month navigation, today & selected highlighted). Immediately after login, **today's submitted documents are shown directly below the calendar** without clicking a date; clicking a date shows that date's list; clicking a user shows that user's list; clicking a document opens the comment editor.
- A list of diaries waiting for open approval (`Wait for open`), with a count.
- Document rows expand with all info including family name-given name.

### 6.4 COURSE_LEADER comment editor
- Shows the document's title, last submitted content, date, and the other leaders' submitted comments; the editor edits this leader's own comment; 暂存/提交 per §5.4.
- Contains the approval checkbox: only `Open` counts as checked; turning it on requires a confirm dialog; a `Wait for open` document shows the hint "⏳ 用户已申请开放，等待确认".

### 6.5 SYS_ADMIN home (sequential sections)
1. **User management** — list users; fuzzy search by username with `?` / `*`; add a user (username + password + role required, others optional; a generated password is shown once); edit everything except username, including role; delete a user (confirm) — deleting a user **deletes all their documents**; batch delete of normal users. The last SYS_ADMIN cannot be deleted or demoted.
2. **Document management** — search by username and/or date, delete documents; only metadata is shown (title, date, owner, state) — never content or comments.
3. **报数 admin list** — shows **all** users; per-row toggle of the user's auto-submit flag; per-row button to delete a user's count entries, all of them or those in a count-date range (confirm); status of the last auto-submit run, and a button to run it now.
4. **Pending password resets** — the `RESET_PENDING` list with the generate/manual password flow (§4.3).
5. **Attention and activity** — for spotting a hijacked account. Everything here is **metadata only**; no diary content, comments or profile fields.
   - **Activity log:** per user and time — entry created / submitted / updated, count entry, limit reached, login, failed login, new device, password changed. Kept 90 days. Never shown to the user it describes.
   - **Activity summary:** per-user totals for today and the last 7 days (entries, submissions, updates, count entries, storage used), sortable, so spikes stand out.
   - **Attention list** (badge with a count): accounts flagged by simple rules — reached any limit, a burst of failed logins, several new devices in a day. A SYS_ADMIN marks an item as handled.
   - **Response actions:** sign the user out of all devices; lock the account (marks it `RESET_PENDING`, so it needs a new password from a SYS_ADMIN, §4.3); delete count entries by date range.
   - **Alerts:** the Attention list in the app is always on and is the full record. When email is configured, each new flag is also emailed to every SYS_ADMIN's account email (at most one email per flagged user per hour, plus a daily summary), so the alert reaches their phone. Emails contain usernames and event types only. The screen shows whether email alerts are on.

### 6.6 SYS_ADMIN user-profile editor
- Role, email (unique), family/given name, address, optional new password (shown once after save), photo upload/delete; delete-user button.

## 7. 报数 (Counting) Flow

### 7.1 Count page layout
```
标题: 合计报数
<progress card>  TOTAL COMPLETED總完成: <total>  (largest figure on the page)
                 <blue progress bar>
                 GOAL COUNT目標數: 10,000,000   |   xx.xx% completed (both in large type)
REPORTED_TODAY今日報告: <today> (entries紀錄: <n>)
今日报数 | <count date, default today> | <number box> | <manual submit> | <auto submit checkbox>
<latest-20 entries table>
```
- The total is the most prominent figure, with the goal and percentage in large type below the bar; there is no separate goal tile.
- 报数 is app-wide: one shared total for all users.
- Progress = all-time total ÷ 10,000,000 × 100%. "Today" is the current date in Beijing time. Table columns: Username (family+given name if known), Today's Count, Total, First Count Date, Latest Submit Time. Adjacent rows alternate light / sky-blue; auto-submit users shown in blue; table auto-refreshes (≈ every minute / on submit).

### 7.2 Input rules
- Daily count: digits only, invalid characters trimmed with a notice, value clamped to **1–1080** with a notice. The server enforces the same rules.
- Manual submit → new entry + refresh all figures and the table; the value also becomes the user's saved default for auto-submit.
- **Count date:** defaults to today; the user may pick any of the previous 5 days (Beijing time) to report a missed day. Never a future date.
- **Limit:** at most **10 manual entries per user per count date** (the auto-submitted entry does not count toward it). The limit is per count date, not per submit day, so backdating cannot multiply it. Reaching it is recorded as an activity event (§6.5).
- "Today's Count" and "First Count Date" use the count date; "Latest Submit Time" uses the submit time.
- Auto-submit checkbox persists immediately (reverts on failure). The typed value is saved continuously (debounced) so the nightly job always uses the latest number.

### 7.3 Auto-submit job
- **Every day at 02:00 Beijing time** the server automatically submits one entry for every user whose auto-submit is on and whose saved count is positive, using the current time as submit time and today as count date.
- An in-process scheduler fires at that time; a protected internal endpoint (Bearer secret, mounted outside normal authentication, not reachable from the public internet) can trigger the same job for an external cron. A SYS_ADMIN can also trigger it manually. Each run is recorded, and a missed or failed run is visible to SYS_ADMINs.

### 7.4 Diary ↔ count navigation
- Diary pages have a 报数 button → count page; the count page has a "Go Diary" button → role home, and the user chip → profile.
- The count page header shows the **logo** (green variant, 400×80) with `countTitle` beneath it (`\n` renders as line breaks).

## 8. Translation Feature

- Below diary content and below comments: two buttons in the submit-button style —
  - **翻译**: translate the text from English to 繁體中文 (expert level)
  - **Translate**: translate from 繁體中文 to English (expert level)
- The result is displayed as **plain text below the buttons — never inside a text box**; a new click replaces it; buttons disable while translating.
- Powered by an OpenAI-compatible chat API (base URL, key, model kept in server-side config/env — **never hardcoded or committed**). Server translates, times out gracefully (504 on timeout), requires login, and only translates text the requesting user is allowed to read. The privacy notice states that translated text is sent to an external provider.

## 9. Installing on Phones

### 9.1 Installable web app (primary)
- The web app has a **web app manifest** (name 修行日記, icons, standalone display, theme colour) and a service worker, so users can add it to their home screen and open it like an app.
- The service worker caches **only the app's own files** (pages, scripts, styles, fonts, icons) — never diary content or any API response.
- When a new version is deployed, the installed app shows a toast offering to reload into it; no manual update step is needed.
- Where the browser offers an install prompt, an "install" button appears; otherwise (e.g. iPhone Safari, many Android phone-maker browsers) a short how-to explains "add to home screen". Inside WeChat's built-in browser, the page explains how to open it in a real browser.
- The installed app stays logged in via "remember this device" (§4.1).
- Image insertion must work from the phone's photo library and camera.

### 9.2 Android wrapper (fallback, only if needed)
Build this only if testing on the users' actual phones shows the installable web app is impractical.
- A thin WebView wrapper that loads the **hosted** site over HTTPS (not bundled files), so it updates with the site.
- Accepts cookies (sessions persist), keeps state on rotation, handles the back key as web-back, and provides a **file chooser** so the editor's image insertion works. Never stores the user's password.
- Settings screen: server URL, Test Connection (health endpoint), app version text, and an **更新 Update** button in the submit-button style:
  - Checks the server's app-version endpoint (JSON `{"version":"yyyyMMddHHmmss"}`).
  - Up to date → toast `已经是最新版。`
  - Newer → toast `正在下载更新`, download the APK over HTTPS, verify its checksum and signer, then **install it** (package-installer intent via FileProvider; on Android 8+ route the user to "install unknown apps" permission if missing).
- An update dialog also auto-appears on launch (with an 忽略/ignore option remembered per version).
- Version numbers are build timestamps — always increasing, compared numerically with full precision.

## 10. UX Conventions (accumulated user requirements)

1. Single right-top **language toggle** (shows the *other* language's name) on every page; default 繁體中文; never two separate buttons.
2. Buttons 翻译 / Translate / 更新 must match the **submit** button style.
3. All rows/tables show values plainly; no key-name labels except the `Comment:` label.
4. Editing always resumes saved content; drafts auto-save; nothing is lost on navigation.
5. Invalid numeric input is trimmed and reported to the user, never silently accepted.
6. Notifications are toasts; polling and notifications must not disturb editing.
7. Bilingual UI throughout; new strings go through the translation table.
8. Secrets (API keys) live in configuration, never in client code or the repository.
9. Every page works on a 360 px-wide phone screen; phones are the primary device for users, while leaders and SYS_ADMINs mostly use a computer.
10. Light and dark themes; neutral, warm default palette. Navigation stays simple: few top-level destinations, large touch targets, clear labels with icons.

## 11. Acceptance Checklist

- [ ] Login: captcha (+/− only) verified; failure refreshes image; RESET_PENDING user blocked; SYS_ADMIN needs an authenticator code; mode radio (default 报数) routes correctly per role; "remember this device" keeps the user logged in and can be revoked.
- [ ] Diary: create → draft (manual + 5-min auto) → submit → button reads 更新 → update (max 3 history versions) → cannot update until changed; content never lost; large phone photos are downscaled automatically with a notice.
- [ ] Limits: entry date is set by the server and cannot be changed; 20 creates, 20 first submissions and 50 updates per day; 2 photos and 5,000 characters per entry (drafts over the limit still save); every limit enforced by the server, with a clear message and no lost text.
- [ ] Deleting: users have no delete action; only a SYS_ADMIN deletes entries. Storage used is shown on the account page.
- [ ] Leaders: a never-submitted diary is invisible to course leaders; after submitting, leaders see the submitted version, not later drafts.
- [ ] Sharing: user request → Wait for open → leader confirm → Open; open diary + submitted comments readable by another user; uncheck returns to Private; a normal user cannot set Open directly.
- [ ] Comments: several leaders can comment on one diary; a draft is invisible to the user and other leaders; submitted comments are visible with the leader's name; no caret jump; translations render as plain text.
- [ ] SYS_ADMIN: can search/add/edit/delete users and change roles, reset passwords, query/delete documents — but receives no plaintext content or comments from any endpoint; the last SYS_ADMIN cannot be removed.
- [ ] COURSE_LEADER: sees today's submitted documents immediately after login; calendar/user navigation reaches the comment editor; can approve open requests.
- [ ] Password change and admin reset both keep the user's old documents readable by the user.
- [ ] 报数: clamped 1–1080 input (client and server); count date today or up to 5 days back; at most 10 manual entries per count date; manual submit updates everything; auto-submit toggle persists; admin list shows all users with toggle + delete-entries (all or by date range) + last-run status; auto job runs at 02:00 Beijing.
- [ ] Attention: reaching a limit, failed-login bursts and new-device bursts flag the account in the SYS_ADMIN Attention list; with email configured, SYS_ADMINs also get a throttled email; activity views and emails contain no content; sign-out-all and lock work.
- [ ] Installable: the app can be added to the home screen on Android and iPhone, opens standalone, stays logged in, picks up new versions, and never caches diary content.
- [ ] Seed data (test environments only): 2 SYS_ADMINs, 2 COURSE_LEADERs, several NORMAL_USERs with encrypted sample diaries (including one Open, two Wait for open, one never-submitted draft, one submitted diary with a later unsubmitted draft, and comments in draft and submitted state from different leaders).

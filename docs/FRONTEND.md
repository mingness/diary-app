# 修行日記 — Frontend Design

> Status: **agreed 2026-10-14** (F1–F6 accepted). Mockups: the "修行日記 screens" design canvas (link in the PR / ask the author).
> Source of truth for behaviour is `docs/project_prompt.md`; this doc decides *how it looks and is navigated*,
> and lists what each screen needs from the API so `docs/ARCHITECTURE.md` §5/§7 can be revised to match.
> Items marked **F#** need a decision.

## 1. Principles

1. **Phone first for users, desktop first for leaders and admins.** Every screen still works at 360 px.
2. **Readable for older users.** Default text is 18 px, with sizes up to 22 px. Everything is sized in `rem`, so
   the text-size setting and browser zoom scale the whole UI. Nothing breaks at 22 px or 200 % zoom.
3. **Few places to go.** At most 4–5 top-level destinations per role, always visible, with an icon and a text
   label. No hamburger menus and no gestures that are the only way to do something.
4. **One obvious action per screen.** Primary buttons are full width on phones, at least 52 px tall.
5. **Calm and neutral.** A warm paper-and-brown palette in light and dark themes, no decoration, and a serif face
   for diary text so entries read like a journal.
6. **Never lose writing.** A visible save status, autosave, and a warning before leaving with unsaved changes.

## 2. Visual system

### 2.1 Colour tokens

Defined once as CSS custom properties on `:root` and switched by `[data-theme]`, which follows the device unless
the user picks a theme. All text/background pairs meet WCAG AA (4.5:1). Status colours differ in lightness, not
just hue.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F6F2EC` | `#1A1714` | page |
| `--surface` | `#FFFFFF` | `#24201C` | cards, bars |
| `--surface-2` | `#EFE8DF` | `#2F2A25` | toolbars, table heads |
| `--text` | `#2B2622` | `#EEE7DE` | body |
| `--muted` | `#665C53` | `#B5A99C` | secondary text |
| `--border` | `#D9CEC1` | `#40382F` | dividers, inputs |
| `--primary` | `#7A4E24` | `#D9A36B` | primary buttons, active nav |
| `--on-primary` | `#FFFFFF` | `#1A1714` | text on primary |
| `--primary-soft` | `#F1E6D8` | `#3A2F24` | selected states |
| `--green` / `--green-soft` | `#2F6B3A` / `#E3EFE3` | `#8CC79A` / `#22342A` | Open, success |
| `--amber` / `--amber-soft` | `#8A5300` / `#F7EBD6` | `#E8B465` / `#3A2E1C` | Wait for open, warnings |
| `--blue` / `--blue-soft` | `#2F5D8C` / `#E2EBF4` | `#8DB4DE` / `#1F2C3A` | comments, info, 報數 progress, auto-submit names |
| `--danger` | `#A63A2A` | `#F09A8A` | delete, logout |
| `--focus` | `#2F5D8C` | `#8DB4DE` | 3 px focus ring |

### 2.2 Type

- **Fonts are system fonts only.** CJK web fonts run to megabytes and can't come from a CDN (§12.4).
  - UI: `"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", system-ui, sans-serif`.
  - Diary and comment text: `"Songti TC", "Noto Serif TC", "PMingLiU", serif`.
- **Editor font choices** (明體 / 黑體 / 楷體) map to these stacks. 楷體 falls back to the serif stack where a Kai
  font isn't installed, so it may look the same as 明體 on some phones (accepted; noted in the editor help).
- **Scale** (multiples of the user's base size): small ×0.85, base ×1, large ×1.15, title ×1.35, display ×1.75.
- **Text-size setting:** 標準 16 / 大 18 (default) / 特大 20 / 超大 22. It's stored per user on the server and
  cached in `localStorage` so the first paint is right.

### 2.3 Shape and spacing

- Spacing on a 4 px grid. Corner radii: 10 px for inputs, 12–14 px for cards, pill-shaped chips.
- Touch targets are at least 44×44 px; primary actions at least 52 px tall.
- Icons are inline stroke SVGs (24 px grid, 1.8 px stroke) from a small local set. No emoji in the UI, so the
  spec's ✅ ❌ 🔓 ⏳ 🔒 become icons plus text chips.

## 3. Navigation

| Role | Phone (< 768 px): bottom tab bar | Desktop (≥ 1024 px): top bar |
|---|---|---|
| NORMAL_USER | 日記 · 開放日記 · 報數 · 我的 | same four, as top links |
| COURSE_LEADER | 批閱 · 申請 (badge) · 日記 · 報數 · 我的 | 批閱 · 開放申請 (badge) · 我的日記 · 開放日記 · 報數 · avatar |
| SYS_ADMIN | 用戶 (badge) · 日記 · 報數 · 重設 (badge) · 我的 | 注意 (badge) · 用戶 · 日記管理 · 報數管理 · 密碼重設 (badge) · username |

- The tab bar replaces the spec's My Diary / Open Diary toggle and its scattered header buttons (§6.2, §7.4).
  "Go Diary" from the count page is simply the 日記 tab.
- The language toggle (spec §10.1) sits top right on every screen and shows the other language's name.
- Between 768 and 1024 px, the tab bar stays and the leader and admin screens use two panes instead of three.
- Detail screens (editor, entry, comment) replace the tab bar with a back button. The back button and the
  browser/phone back always return to the list you came from, at the same month and scroll position.

## 4. Screens

Each screen lists what it needs from the API. The API column feeds the ARCHITECTURE.md revision.

### 4.1 Login, register, forgot password (all)

- **Login fields:** username, password (show/hide), CAPTCHA image + 更新 + answer, destination choice
  (修行日記 / 報數, default 報數, remembered), "記住此裝置" (default on), 登入.
- **Errors** show inline above the button, and a failed CAPTCHA reloads the image.
- **TOTP step:** if the account needs a second factor (SYS_ADMIN), a second step asks for the 6-digit code.
- **Register:** the same visual pattern, with username, family and given name, address, password twice and CAPTCHA.
- **Forgot password:** username, then the confirmation "已經提交給管理員".
- **API:** `GET captcha → {id, svg}`; `POST login → {user, needsTotp?}`; `POST login/totp`; `POST register`;
  `POST forgot-password`.

### 4.2 My diary (users and leaders)

- **Top:** the 撰寫日記 button, full width, then month navigation (« ‹ 2026 年 10 月 › », year jumps at the ends).
- **Entry cards**, newest first, each showing:
  - title and date (with weekday)
  - a state chip: 草稿・未提交 / 已提交 / 已提交・有未提交的修改
  - an access chip: 私人 / 等待開放 / 已開放
  - a comment chip ("2 則批注"), marked when there is a comment the owner hasn't seen yet
- Tapping a card opens the entry (4.4), **F1**.
- **Polling** every 30 s while the screen is visible. New comments raise the toast 有新批注！ and refresh the
  list. Polling stops in editors and background tabs.
- **Empty month:** "這個月還沒有日記" plus the write button.
- **API:** `GET documents/mine?month=` → per entry: `id, title, date, state, access, commentCount,
  hasUnseenComment`. **New:** "unseen" needs a per-owner seen marker (§6).

### 4.3 Editor (users and leaders, own entries)

- **Header:** back, title, and a save status ("已暫存 10:42" / "儲存中…" / "未儲存的修改" / "離線，稍後再試").
- **Fields:** title, the date shown read-only (set when the entry was created; a short help line explains that
  entries can't be backdated), then a toolbar that wraps on phones (font, paragraph style, size, B, U, 圖片).
- **Body** in the serif face.
- **Image insert:** the picker accepts the photo library and camera. After downscaling (ARCHITECTURE §8.3) an
  info notice reports original → new size and that location data was removed. After the second photo the 圖片
  button is disabled, with the note "每篇最多 2 張相片".
- **Length:** from 4,000 characters a quiet counter appears ("4,200 / 5,000"), turning amber, never red, near the
  limit, with the kindly framed line from spec §5.5. Over 5,000, 暫存 still works and 提交/更新 is disabled with
  the reason.
- **Limits reached:** a notice names the limit and when it resets (midnight Beijing time); the text stays in the
  editor.
- **Share request:** a checkbox row "申請開放給大家閱讀", disabled with a hint until the entry has been
  submitted once.
- **Sticky bottom bar:** 暫存 (secondary), 提交 (primary; reads **更新** once the entry has been submitted),
  歷史版本. Enable and disable follow spec §5.2.
- **History** opens as a bottom sheet (phone) or side panel (desktop) listing the versions, each expandable.
- **Leaving with unsaved changes** shows a confirm dialog. Autosave runs every 5 minutes, plus when the app
  goes to the background (`visibilitychange`), so a phone being locked doesn't lose text.
- **API:** `GET documents/:id` (with draft), `PUT draft`, `POST submit`, `GET versions`, `POST access`.
  Limit values come from `shared/src/limits.ts`.

### 4.4 Entry view (owner, leaders, readers of open entries)

- **Read-only:** title, a meta row of values only (date, author for non-owners, access chip, comment count),
  then the body.
- **Translation:** 翻譯 and Translate buttons, with the result shown as plain text below them.
- **Comments:** the `Comment:` label, then one card per submitted comment (leader name, date, text, its own
  translate buttons).
- **Owner actions:** 編輯 (opens 4.3), and the share request toggle.
- **Open Diary tab:** the same screen without the owner actions, reached from a list of open entries by month.
- **API:** `GET documents/:id` → content + submitted comments `{id, authorName, submittedAt, body}`;
  `POST translate {documentId|commentId, direction}`.

### 4.5 報數 (all)

- **Header:** the logo (400×80 placeholder) and 合計報數.
- **Stats:** one progress card leads. The all-time total is the largest number on the page; under it, a thick
  progress bar; under that, the goal (10,000,000) and the percentage completed side by side, in large type. Below it, a slim "reported today"
  row (sum + number of entries). There is no separate goal tile (agreed).
- **Input card:** 今日報數 with a numeric keypad, a date choice (今天 by default, or one of the previous 5 days,
  shown as short weekday chips), 提交, and the 自動報數 checkbox with "每天北京時間凌晨 2:00". After 10 entries for
  the chosen date, 提交 is disabled with the reason.
  Trimming and clamping happen as the user types, with the notice in a live region.
- **Latest 20:** on phones this is a list, not a 5-column table. Each row shows name and today's count, then a
  muted line "總計 · 首次 · 最近". Rows alternate colours and auto-submit names are blue (spec §7.1). On desktop
  it's a real table with the spec's columns.
- **API:** `GET count/summary`, `GET count/latest`, `GET/PUT count/settings`, `POST count`.

### 4.6 Account (all)

- **Profile:** photo (picked and resized to 300×300 in the browser), name, address, email, 儲存.
- **Appearance:** text size (with a live preview) and theme (淺色 / 深色 / 跟隨裝置).
- **Storage used:** one information row ("已使用 12.4 MB"), no limit or warning.
- **Signed-in devices:** device name from the user agent, "this device" marker, last used, and 登出 for each.
- **Rows:** change password (a sheet), "加到手機主畫面" (the install how-to), 登出.
- **SYS_ADMIN:** an authenticator section.
- **API:** `GET/PUT me` (including `fontSize`, `theme`), `POST me/password`, `GET/DELETE me/sessions`,
  `POST me/totp/*`.

### 4.7 Leader review (desktop first)

Three panes, which stack on narrow screens:

1. **Calendar:** Chinese weekday headers, today ringed, a dot on days with submitted entries. Below it, the
   學員 list with search and monthly counts.
2. **Day list:** opens on today. Each row shows title and author, plus chips for comment state (尚無批注 / 我的
   批注：草稿 / 我已批注 / 其他導師已批注) and 申請開放. Picking a user instead lists their entries by month.
   Paging follows spec §6.1 (20 per page, adjustable).
3. **Reading pane:** the entry, translate buttons, other leaders' comments, then **my comment** with a small
   toolbar, 暫存 and 提交批注. For a `Wait for open` entry, an amber bar offers 批准開放 (with a confirm
   dialog) and 婉拒, **F3**.

- **On a phone:** 批閱 is calendar + day list; tapping an entry opens the reading pane full screen.
- **開放申請 tab:** a queue of pending requests, oldest first, each opening the reading pane.
- **Leaders' own diaries:** under 我的日記, identical to 4.2.
- **API:** `GET leader/calendar?month=` → `{date: count}`; `GET leader/documents?date=&page=&size=` and
  `?user=&month=` → per entry `id, title, authorName, myCommentState, otherLeaderCommented, access`;
  `GET leader/users?month=` → names + counts; `GET leader/open-requests`; `PUT comments/mine`;
  `POST access approve|decline|revoke`.

### 4.8 SYS_ADMIN (desktop first)

- **注意 (Attention):** on desktop its own top-bar item; on phones the top of the 用戶 tab (the tab carries
  the badge). Unhandled flags, newest first: username, rule ("已達每日提交上限", "多次登入失敗", "一天內多個新裝置"),
  time, and actions 查看活動 / 登出所有裝置 / 鎖定帳戶 (confirm) / 已處理. A status line shows whether email
  alerts are on ("電郵通知：未設定" or the recipient count and last send).
- **Activity:** per user, a 7-day summary (entries, submissions, updates, count entries, storage) and the event
  list. Metadata only.
- **用戶:** search with `?` / `*`, a role filter, and a table (checkbox, username, name, role chip, status
  including "等待重設密碼" and "已啟用驗證器", storage used, created date, 編輯 / 刪除). Batch delete applies to selected
  normal users only. Side cards show pending resets and the last auto-submit run.
- **新增 / 編輯用戶:** role, email, names, address, photo, and an optional new password (generated passwords are
  shown once in a dialog with a copy button).
- **日記管理:** search by username and/or date; the table shows title, date, owner and state; delete with confirm.
- **報數管理:** all users, an auto-submit toggle per row, delete entries per row (all, or a count-date range;
  confirm), job-run history,
  and 立即執行.
- **密碼重設:** the pending list. Each row has 產生 (an 8-character password shown once) or a typed password.
- **API:** as in ARCHITECTURE §7.3. User rows need `role, status, totpEnabled, storageBytes, createdAt`.

## 5. Components

`AppShell` (role-aware tabs/top bar), `LanguageToggle`, `Button` (primary / secondary / quiet / danger),
`Chip`, `EntryCard`, `MonthNav`, `Calendar`, `RichEditor`, `SaveStatus`, `Notice`, `Toast` (live region; shows
"錯誤代碼：abc123" on failures), `TranslateBlock`, `CommentCard`, `CommentEditor`, `SegmentedControl`,
`CheckboxRow`, `CountInput`, `StatTile`, `ProgressBar`, `DataTable` (scrolls sideways in its own box),
`ConfirmDialog`, `Sheet` (bottom sheet on phone, side panel on desktop), `InstallHelp`, `EmptyState`,
`ErrorState`.

Every component is built and checked in both themes and at 16 and 22 px. Each one gets a Playwright visual
snapshot at 360 px and 1280 px.

## 6. Implications for the backend (folded into ARCHITECTURE.md §5, §7.3)

1. **Unseen comments:** add `comments.seen_by_owner_at`, set when the owner opens the entry. It drives the
   comment chip and replaces client-side diffing for the 有新批注 toast.
2. **Leader list fields:** `myCommentState` and `otherLeaderCommented` per entry, computed in the list query.
3. **Calendar counts:** a month → per-day count endpoint for submitted entries.
4. **User preferences:** `users.theme` (`light | dark | system`) next to `font_size`.
5. **Device labels:** derived from the user agent at login. No IP geolocation (it would need another
   dependency); the mockup's location text will be dropped.
6. **Monthly counts per user** for the leader's 學員 list.

## 7. Strings and language

- The spec mixes simplified and traditional characters (暂存, 报数, 两次密码输入不同, 翻译, 历史版本,
  有新文档). The zh-Hant table uses traditional throughout: 暫存, 報數, 兩次密碼輸入不同, 翻譯, 歷史版本,
  有新文件 / 有新批注. "攥写日记" in spec §6.2 is a typo for **撰寫日記** (F5, agreed).
- English UI name: **Cultivation Diary** for 修行日記 (agreed). 報數 is "Count", 批注 is
  "comment", 導師 is "course leader" ("Leader …" before a name), and 學員 is "student".
- Every string lives in `web/src/i18n/{zh-Hant,en}.ts` (alert emails, written by the server, use
  `server/src/i18n/`; ARCHITECTURE §8.10). Dates use `Intl.DateTimeFormat` with the active locale
  (10月14日 週三 / Wed 14 Oct).

## 8. Accessibility checklist

- Real `<button>`, `<a>` and `<label>`/`<input>` elements; icon-only buttons have `aria-label`.
- Focus is always visible (3 px ring), and dialogs trap focus and return it on close.
- Save status, count notices and toasts are announced in `aria-live` regions.
- No information is carried by colour alone; chips always include text.
- Motion is reduced when `prefers-reduced-motion` is set.
- The e2e suite runs axe checks on every screen in both themes.

## 9. Installable app UX

- After the user's third visit on a phone browser that supports installing, a dismissible banner offers
  "加到主畫面" once. The Account page always has the how-to.
- When a new version is ready, a toast offers "新版本可用 — 重新載入". It's never shown while an editor has
  unsaved changes; it waits until they're saved.
- With no connection, the app shell shows "目前離線" instead of the browser's error page. Nothing is written
  offline in v1 (F6, agreed). This is a deliberate simplification: offline writing needs a local queue of
  drafts plus conflict handling when the same entry changed on another device. Add it once the design has
  settled and real use shows people losing connection while writing.

## 10. Frontend libraries (F4, agreed)

| Library | For |
|---|---|
| **TanStack Query** | Everything the screens fetch from or send to the API |
| **Tiptap** (on ProseMirror) | The rich-text editor for diary entries and comments |
| **vite-plugin-pwa** | Manifest + service worker (already in the approved stack) |

Styling uses plain CSS modules plus the custom properties above, with no CSS framework.

### 10.1 Why TanStack Query

The screens need several data behaviours that are easy to get subtly wrong by hand:

- **Polling that pauses.** The spec wants a 30 s check for new entries and comments that never runs in the
  editor (§6.2) and should stop when the app is in the background. TanStack Query does this with a per-query
  `refetchInterval` that is off unless the screen is mounted, and it already pauses when the tab is hidden.
- **Refreshing after a change.** After 提交, the list, the entry and the comment counts must all update. Mutations
  invalidate the affected queries by key, so there is no hand-written "remember to reload X" code to miss.
- **Retries and errors.** Flaky phone connections get automatic, limited retries; failures surface once, with the
  request ID for the error toast (§12.7).
- **No duplicate requests.** Two components asking for the same data share one request and one cache entry.
- **Testability.** Hooks can be tested against a fake API without a browser.

Alternatives considered: **plain `fetch` + React state** would reimplement all of the above, and the old app's
polling and refresh bugs came from exactly that code. **SWR** is similar but smaller; it has weaker support
for mutations and cache invalidation, which this app relies on. **Redux Toolkit Query** is capable but brings
Redux, which nothing else here needs. TanStack Query is about 13 kB gzipped, framework-agnostic in its core, and
the most widely used option, so maintenance risk is low.

### 10.2 Why Tiptap

The editor is the hardest component in the app and the one most likely to lose a user's writing:

- **The old approach is deprecated.** The spec's editor (contentEditable + `document.execCommand`) relies on a
  browser API that is officially deprecated, behaves differently across browsers, and caused the spec's own
  caret-jump bug (§5.2).
- **A document model, not raw HTML.** Tiptap is built on ProseMirror, which keeps a structured document and
  renders it, so loading saved text never moves the cursor, and undo/redo works reliably on phones.
- **Exactly the allowed formatting.** We enable only the extensions the spec lists: paragraph, headings
  H1–H3, bold, underline, font family, font size and image. Pasted content is reduced to that schema, and the
  server's sanitiser uses the same allowlist, so what the editor produces always survives sanitising unchanged.
  This closes the stored-XSS gap in the old app.
- **Images.** A small custom node lets us run the downscaling step (ARCHITECTURE §8.3) on insert, show the
  "picture made smaller" notice, and enforce the size caps before anything is sent.
- **Mobile and CJK input.** ProseMirror handles input methods (IMEs) such as Chinese input correctly, which
  is a well-known weakness of hand-rolled contentEditable editors.

Alternatives considered: **Lexical** (Meta) is good but younger, with fewer ready-made extensions and more of
its own conventions. **Quill** has a fixed model that is harder to restrict to an exact allowlist, and its v2
ecosystem is still settling. **Slate** is flexible but low-level, so we would be writing much of the editor
ourselves. **Plain ProseMirror** is what Tiptap wraps; Tiptap saves a large amount of setup code without hiding
ProseMirror when we need it. Tiptap's core and the extensions we need are MIT-licensed; we use none of its
paid cloud features.

## 11. Decisions

| # | Question | Decision (all agreed 2026-10-14) |
|---|---|---|
| F1 | Tapping an own entry: open the editor directly (spec §6.1) or a read view with 編輯? | **Read view** first, because that's where comments and translations live, and it avoids accidental edits |
| F2 | List style: the spec's table with ✅/❌ and +/− expand, or cards with chips? | **Cards** on phones; leaders and admins keep tables on desktop. The values-only rule still holds |
| F3 | Approving an open request: the spec's checkbox, or explicit 批准開放 / 婉拒 buttons? | **Buttons**, plus the confirm dialog on approve; the current state is shown as a chip |
| F4 | Libraries in §10 | Approve TanStack Query and Tiptap |
| F5 | zh-Hant strings in traditional characters throughout, fixing 攥写 → 撰寫 | Yes |
| F6 | Offline writing (queue drafts while offline) | Not in v1; show an offline notice. Revisit after real use |

/**
 * 报数 (Counting/Reporting) feature routes.
 *
 * Tables:
 *   count_entries  — one row per submission (manual or auto)
 *   count_settings — per-user auto-submit preference + default daily_count
 *
 * Endpoints:
 *   GET  /api/count/stats       — global stats for the layout
 *   GET  /api/count/entries     — latest 20 entries with per-user aggregates
 *   POST /api/count/submit      — submit a new entry for the current user
 *   GET  /api/count/settings    — get current user's auto-submit settings
 *   PUT  /api/count/settings    — update current user's auto-submit settings
 *   GET  /api/count/auto-submit-list — admin: list ALL users with their auto_submit status
 *   PUT  /api/count/admin-settings/:userName — admin: toggle auto_submit for any user
 *   DELETE /api/count/entries/:userName — admin: delete all count entries of a user
 *   POST /api/count/auto-run    — internal: run the daily 0:00 auto-submit
 */
import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import { getAdminProfileOverride } from '../services/userService.js';
import db from '../db/index.js';

const router = Router();
const COUNT_GOAL = 10_000_000;

router.use(authMiddleware);

/** Format a Date as "YYYY-MM-DD HH:MM:SS" in server local time. */
function formatLocalTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Format a Date as "YYYY-MM-DD" in server local time. */
function formatLocalDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Return aggregated stats used by the layout header. */
async function getStats() {
  const totalRow = await db.prepare(
    `SELECT COALESCE(SUM(daily_count), 0) AS total FROM count_entries`
  ).get();

  const today = formatLocalDate(new Date());
  const todayRow = await db.prepare(
    `SELECT COALESCE(SUM(daily_count), 0) AS total,
            COUNT(DISTINCT user_name) AS users
       FROM count_entries
      WHERE submit_time LIKE ?`
  ).get(`${today}%`);

  const sumCountTotal = Number(totalRow.total) || 0;
  const sumCountToday = Number(todayRow.total) || 0;
  const sumEntryToday = Number(todayRow.users) || 0;
  const progress = COUNT_GOAL > 0 ? (sumCountTotal / COUNT_GOAL) * 100 : 0;

  return {
    goal: COUNT_GOAL,
    sumCountTotal,
    sumCountToday,
    sumEntryToday,
    progress: Math.round(progress * 100) / 100,
  };
}

/** Get a user's display name from admin_profile_overrides (plaintext cache). */
async function getDisplayName(userName) {
  const override = await getAdminProfileOverride(userName);
  if (override && (override.familyName || override.givenName)) {
    return `${override.familyName || ''} ${override.givenName || ''}`.trim();
  }
  return userName;
}

/** GET /api/count/stats */
router.get('/stats', async (req, res) => {
  const stats = await getStats();
  res.json(stats);
});

/** GET /api/count/entries — latest 20 entries with per-user aggregates. */
router.get('/entries', async (req, res) => {
  const rows = await db.prepare(
    `SELECT ce.id, ce.user_name, ce.daily_count, ce.submit_time, ce.auto_submit
       FROM count_entries ce
   ORDER BY ce.id DESC
      LIMIT 20`
  ).all();

  // Per-user aggregates
  const userAggMap = new Map();
  for (const row of rows) {
    if (userAggMap.has(row.user_name)) continue;
    const agg = await db.prepare(
      `SELECT COALESCE(SUM(daily_count), 0) AS total,
              MIN(submit_time) AS first_time,
              MAX(submit_time) AS latest_time
         FROM count_entries
        WHERE user_name = ?`
    ).get(row.user_name);
    userAggMap.set(row.user_name, agg);
  }

  const entries = [];
  for (const row of rows) {
    const agg = userAggMap.get(row.user_name);
    const displayName = await getDisplayName(row.user_name);
    entries.push({
      id: row.id,
      userName: row.user_name,
      displayName,
      dailyCount: row.daily_count,
      totalCount: Number(agg.total) || 0,
      firstCountDate: agg.first_time ? agg.first_time.slice(0, 10) : '',
      latestCountDate: agg.latest_time ? agg.latest_time.slice(0, 19) : '',
      submitTime: row.submit_time,
      autoSubmit: !!row.auto_submit,
    });
  }

  res.json({ entries });
});

/** POST /api/count/submit — submit a new entry for the current user. */
router.post('/submit', async (req, res) => {
  const userName = req.user.user_name;
  const { dailyCount, autoSubmit } = req.body;

  if (!Number.isInteger(dailyCount) || dailyCount <= 0) {
    return res.status(400).json({ error: 'dailyCount must be a positive integer', errorZh: '今日报数必须是正整数' });
  }

  const submitTime = formatLocalTime(new Date());
  await db.prepare(
    `INSERT INTO count_entries (user_name, daily_count, submit_time, auto_submit)
     VALUES (?, ?, ?, ?)`
  ).run(userName, dailyCount, submitTime, autoSubmit ? 1 : 0);

  // Persist the user's auto-submit preference + daily_count for future auto-submits.
  await db.prepare(
    `INSERT INTO count_settings (user_name, auto_submit, daily_count, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_name) DO UPDATE SET
       auto_submit = EXCLUDED.auto_submit,
       daily_count = EXCLUDED.daily_count,
       updated_at = EXCLUDED.updated_at`
  ).run(
    userName,
    autoSubmit ? 1 : 0,
    dailyCount,
    formatLocalTime(new Date())
  );

  const stats = await getStats();
  res.json({ success: true, stats });
});

/** GET /api/count/settings — current user's auto-submit settings. */
router.get('/settings', async (req, res) => {
  const userName = req.user.user_name;
  const row = await db.prepare(
    `SELECT auto_submit, daily_count FROM count_settings WHERE user_name = ?`
  ).get(userName);
  res.json({
    autoSubmit: !!(row && row.auto_submit),
    dailyCount: row ? Number(row.daily_count) || 0 : 0,
  });
});

/** PUT /api/count/settings — update current user's auto-submit settings. */
router.put('/settings', async (req, res) => {
  const userName = req.user.user_name;
  const { autoSubmit, dailyCount } = req.body;
  const auto = autoSubmit ? 1 : 0;
  const count = Number.isInteger(dailyCount) && dailyCount > 0 ? dailyCount : 0;

  await db.prepare(
    `INSERT INTO count_settings (user_name, auto_submit, daily_count, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_name) DO UPDATE SET
       auto_submit = EXCLUDED.auto_submit,
       daily_count = EXCLUDED.daily_count,
       updated_at = EXCLUDED.updated_at`
  ).run(userName, auto, count, formatLocalTime(new Date()));

  res.json({ success: true, autoSubmit: !!auto, dailyCount: count });
});

/** GET /api/count/auto-submit-list — list ALL users with their auto-submit status (admin only). */
router.get('/auto-submit-list', requireRole('SYS_ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  // Join all users with their count_settings (if any) and aggregated entry stats.
  const rows = await db.prepare(
    `SELECT u.user_name,
            COALESCE(cs.auto_submit, 0) AS auto_submit,
            COALESCE(cs.daily_count, 0) AS daily_count,
            COALESCE(cs.updated_at, '') AS updated_at,
            agg.total_count,
            agg.latest_time
       FROM users u
       LEFT JOIN count_settings cs ON cs.user_name = u.user_name
       LEFT JOIN (
         SELECT user_name, SUM(daily_count) AS total_count, MAX(submit_time) AS latest_time
           FROM count_entries
          GROUP BY user_name
       ) agg ON agg.user_name = u.user_name
   ORDER BY u.user_name ASC`
  ).all();

  const list = [];
  for (const row of rows) {
    const displayName = await getDisplayName(row.user_name);
    list.push({
      userName: row.user_name,
      displayName,
      autoSubmit: !!row.auto_submit,
      dailyCount: Number(row.daily_count) || 0,
      updatedAt: row.updated_at || '',
      totalCount: Number(row.total_count) || 0,
      latestCountDate: row.latest_time ? row.latest_time.slice(0, 16) : '',
    });
  }
  res.json({ list, count: list.length });
});

/** PUT /api/count/admin-settings/:userName — admin toggles auto_submit for any user. */
router.put('/admin-settings/:userName', requireRole('SYS_ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const targetUserName = req.params.userName;
  const { autoSubmit, dailyCount } = req.body;
  const auto = autoSubmit ? 1 : 0;

  // If dailyCount not provided (or invalid), keep the existing value (or 0 if none).
  let count = Number.isInteger(dailyCount) && dailyCount > 0 ? dailyCount : 0;
  if (count === 0) {
    const existing = await db.prepare(
      `SELECT daily_count FROM count_settings WHERE user_name = ?`
    ).get(targetUserName);
    count = existing ? Number(existing.daily_count) || 0 : 0;
  }

  await db.prepare(
    `INSERT INTO count_settings (user_name, auto_submit, daily_count, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_name) DO UPDATE SET
       auto_submit = EXCLUDED.auto_submit,
       daily_count = CASE WHEN EXCLUDED.daily_count > 0 THEN EXCLUDED.daily_count ELSE count_settings.daily_count END,
       updated_at = EXCLUDED.updated_at`
  ).run(targetUserName, auto, count, formatLocalTime(new Date()));

  res.json({ success: true, autoSubmit: !!auto, dailyCount: count });
});

/** DELETE /api/count/entries/:userName — admin deletes all count entries of a user. */
router.delete('/entries/:userName', requireRole('SYS_ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const targetUserName = req.params.userName;
  const result = await db.prepare(
    `DELETE FROM count_entries WHERE user_name = ?`
  ).run(targetUserName);
  const stats = await getStats();
  res.json({ success: true, deleted: result.changes, stats });
});

/**
 * Run the daily 0:00 auto-submit job.
 * Submits a new entry for every user with auto_submit = true.
 * @returns {object} summary { submitted, skipped, errors }
 */
export async function runAutoSubmitJob() {
  const settings = await db.prepare(
    `SELECT user_name, daily_count FROM count_settings WHERE auto_submit = 1 AND daily_count > 0`
  ).all();

  const submitTime = formatLocalTime(new Date());
  let submitted = 0;
  const errors = [];

  for (const s of settings) {
    try {
      await db.prepare(
        `INSERT INTO count_entries (user_name, daily_count, submit_time, auto_submit)
         VALUES (?, ?, ?, 1)`
      ).run(s.user_name, Number(s.daily_count), submitTime);
      submitted += 1;
    } catch (err) {
      errors.push({ userName: s.user_name, error: String(err?.message || err) });
    }
  }

  const stats = await getStats();
  console.log(`[count] auto-submit @ ${submitTime}: submitted=${submitted}, errors=${errors.length}`);
  return { submitted, skipped: settings.length - submitted, errors, stats };
}

/** Internal endpoint to trigger the auto-submit job (for manual testing / cron). */
router.post('/auto-run', async (req, res) => {
  // Vercel Cron sends: Authorization: Bearer <CRON_SECRET>
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || '';
  const isVercelCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  // Only allow SUPER_ADMIN to trigger manually (or a valid cron secret)
  if (!isVercelCron && req.userRole !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const result = await runAutoSubmitJob();
  res.json(result);
});

export default router;

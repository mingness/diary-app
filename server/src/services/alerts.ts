/**
 * The Attention list and alert emails (spec §6.5.5, D27).
 *
 * The in-app list is always on and is the full record. Email is optional: a scheduled task sends unsent alerts
 * to every SYS_ADMIN's account email, at most one email per flagged user per hour, with retries. Sending never
 * happens in the request that raised the alert, so a slow or broken mailbox can't affect users.
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  sql,
} from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { alerts, users } from '../db/schema.js';
import type { AlertRule } from '../domain/limits/attention.js';
import { EMAIL_LANGUAGES } from '../i18n/index.js';

const HOUR = 60 * 60 * 1000;
/** After this many failed sends an alert stops retrying; it stays in the list with its error. */
export const MAX_EMAIL_ATTEMPTS = 5;

export type AlertRow = typeof alerts.$inferSelect;

export async function listAlerts(ctx: AppContext, status: 'open' | 'handled' | 'all') {
  const where =
    status === 'open'
      ? isNull(alerts.handledAt)
      : status === 'handled'
        ? isNotNull(alerts.handledAt)
        : undefined;
  return ctx.db.select().from(alerts).where(where).orderBy(desc(alerts.createdAt)).limit(500);
}

/** Marks an alert handled. Returns false if there is no such open alert. */
export async function markHandled(ctx: AppContext, id: string, actorId: string): Promise<boolean> {
  const rows = await ctx.db
    .update(alerts)
    .set({ handledAt: ctx.clock(), handledBy: actorId })
    .where(and(eq(alerts.id, id), isNull(alerts.handledAt)))
    .returning({ id: alerts.id });
  return rows.length > 0;
}

/** Account emails of SYS_ADMINs who can act on an alert. */
async function adminRecipients(ctx: AppContext): Promise<string[]> {
  const rows = await ctx.db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.role, 'SYS_ADMIN'), eq(users.resetPending, false), isNotNull(users.email)));
  return rows.map((r) => r.email).filter((e): e is string => !!e);
}

/** For the admin screen: whether email alerts are on, to how many, and whether sending is failing. */
export async function alertStatus(ctx: AppContext) {
  const [open] = await ctx.db.select({ n: count() }).from(alerts).where(isNull(alerts.handledAt));
  const [last] = await ctx.db.select({ at: max(alerts.emailedAt) }).from(alerts);
  const [failing] = await ctx.db
    .select({ n: count() })
    .from(alerts)
    .where(and(isNull(alerts.emailedAt), isNotNull(alerts.lastError)));
  return {
    openCount: open?.n ?? 0,
    email: {
      configured: ctx.mailer !== null,
      recipients: ctx.mailer ? (await adminRecipients(ctx)).length : 0,
      lastSentAt: last?.at?.toISOString() ?? null,
      failing: failing?.n ?? 0,
    },
  };
}

function alertEmail(username: string, rules: readonly AlertRule[]) {
  const [zh, en] = EMAIL_LANGUAGES;
  const section = (t: typeof zh) =>
    [t.alertIntro(username), ...rules.map((r) => `- ${t.rule[r]}`), '', t.alertAction].join('\n');
  return {
    subject: `[${zh.appName}] ${zh.alertSubject(username)} / ${en.alertSubject(username)}`,
    text: `${section(zh)}\n\n————————\n\n${section(en)}\n`,
  };
}

/**
 * Scheduled task: emails unsent alerts, one message per flagged user, skipping users emailed within the last
 * hour (their alerts wait and go out together later). Returns counts for the job log.
 */
export async function sendPendingAlertEmails(
  ctx: AppContext,
): Promise<{ sent: number; failed: number; waiting: number }> {
  const result = { sent: 0, failed: 0, waiting: 0 };
  if (!ctx.mailer) return result;
  const recipients = await adminRecipients(ctx);
  if (recipients.length === 0) return result;

  const now = ctx.clock();
  const pending = await ctx.db
    .select()
    .from(alerts)
    .where(and(isNull(alerts.emailedAt), lt(alerts.emailAttempts, MAX_EMAIL_ATTEMPTS)))
    .orderBy(asc(alerts.createdAt));

  const byUser = new Map<string, AlertRow[]>();
  for (const alert of pending) {
    const key = alert.userId ?? `deleted:${alert.username}`;
    byUser.set(key, [...(byUser.get(key) ?? []), alert]);
  }

  for (const group of byUser.values()) {
    const first = group[0];
    if (!first) continue;
    if (first.userId) {
      const [recent] = await ctx.db
        .select({ n: count() })
        .from(alerts)
        .where(
          and(
            eq(alerts.userId, first.userId),
            gte(alerts.emailedAt, new Date(now.getTime() - HOUR)),
          ),
        );
      if ((recent?.n ?? 0) > 0) {
        result.waiting += group.length;
        continue;
      }
    }
    const ids = group.map((a) => a.id);
    try {
      const rules = [...new Set(group.map((a) => a.rule))];
      await ctx.mailer.send({ to: recipients, ...alertEmail(first.username, rules) });
      await ctx.db
        .update(alerts)
        .set({ emailedAt: now, lastError: null, emailAttempts: sql`${alerts.emailAttempts} + 1` })
        .where(inArray(alerts.id, ids));
      result.sent += 1;
    } catch (err) {
      const message =
        err instanceof Error
          ? `${(err as { code?: string }).code ?? ''} ${err.message}`
          : 'unknown';
      await ctx.db
        .update(alerts)
        .set({
          lastError: message.trim().slice(0, 200),
          emailAttempts: sql`${alerts.emailAttempts} + 1`,
        })
        .where(inArray(alerts.id, ids));
      result.failed += 1;
    }
  }
  return result;
}

/** Scheduled task, once a day: a short summary for SYS_ADMINs, sent only when there is something to report. */
export async function sendDailySummary(ctx: AppContext): Promise<{ sent: number }> {
  if (!ctx.mailer) return { sent: 0 };
  const recipients = await adminRecipients(ctx);
  if (recipients.length === 0) return { sent: 0 };
  const now = ctx.clock();
  const [open] = await ctx.db.select({ n: count() }).from(alerts).where(isNull(alerts.handledAt));
  const [fresh] = await ctx.db
    .select({ n: count() })
    .from(alerts)
    .where(gte(alerts.createdAt, new Date(now.getTime() - 24 * HOUR)));
  const openCount = open?.n ?? 0;
  const newCount = fresh?.n ?? 0;
  if (openCount === 0 && newCount === 0) return { sent: 0 };
  const [zh, en] = EMAIL_LANGUAGES;
  const section = (t: typeof zh) =>
    [t.summaryOpen(openCount), t.summaryNew(newCount), '', t.alertAction].join('\n');
  await ctx.mailer.send({
    to: recipients,
    subject: `[${zh.appName}] ${zh.summarySubject(openCount)} / ${en.summarySubject(openCount)}`,
    text: `${section(zh)}\n\n————————\n\n${section(en)}\n`,
  });
  return { sent: 1 };
}

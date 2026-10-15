/**
 * SYS_ADMIN activity log, summary and Attention list (spec §6.5.5). Metadata only.
 */
import { z } from 'zod';
import { Role } from './roles.js';

export const ActivityKind = z.enum([
  'entry_created',
  'entry_submitted',
  'entry_updated',
  'count_entry',
  'limit_reached',
  /** A daily warning level was reached; detail {usage, count}. */
  'elevated_activity',
  'login',
  'login_failed',
  'new_device',
  'password_changed',
]);
export type ActivityKind = z.infer<typeof ActivityKind>;

export const AlertRule = z.enum([
  'limit_reached',
  'elevated_activity',
  'login_failures',
  'new_devices',
]);
export type AlertRule = z.infer<typeof AlertRule>;

export const ActivityEvent = z.object({
  id: z.uuid(),
  userId: z.uuid().nullable(),
  username: z.string(),
  kind: ActivityKind,
  /** Small facts such as {"device": "iPhone · Safari"} or {"reason": "password"}; never content. */
  detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).nullable(),
  createdAt: z.iso.datetime(),
});

export const ActivityQuery = z.object({
  userId: z.uuid().optional(),
  kind: ActivityKind.optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(200).default(50),
});

export const ActivityList = z.object({
  events: z.array(ActivityEvent),
  total: z.number().int(),
  page: z.number().int(),
  size: z.number().int(),
});

const Tally = z.object({
  entries: z.number().int(),
  submissions: z.number().int(),
  updates: z.number().int(),
  countEntries: z.number().int(),
});

export const ActivitySummaryQuery = z.object({
  sort: z.enum(['today', 'week', 'storage']).default('today'),
});

/** Per-user totals for today and the last 7 days (Beijing dates), so spikes stand out. */
export const ActivitySummary = z.object({
  rows: z.array(
    z.object({
      userId: z.uuid(),
      username: z.string(),
      role: Role,
      today: Tally,
      week: Tally,
      storageBytes: z.number().int(),
    }),
  ),
});

export const AlertItem = z.object({
  id: z.uuid(),
  userId: z.uuid().nullable(),
  username: z.string(),
  rule: AlertRule,
  createdAt: z.iso.datetime(),
  handledAt: z.iso.datetime().nullable(),
  email: z.enum(['not_configured', 'pending', 'sent', 'failing', 'gave_up']),
  lastError: z.string().nullable(),
});

export const AlertListQuery = z.object({
  status: z.enum(['open', 'handled', 'all']).default('open'),
});
export const AlertList = z.object({ alerts: z.array(AlertItem) });

export const AlertStatus = z.object({
  openCount: z.number().int(),
  email: z.object({
    configured: z.boolean(),
    recipients: z.number().int(),
    lastSentAt: z.iso.datetime().nullable(),
    failing: z.number().int(),
  }),
});

export const AlertIdParams = z.object({ id: z.uuid() });

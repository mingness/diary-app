/**
 * Words for the admin screens' codes: roles, flags and activity details (metadata only). Written out as maps
 * rather than built from the code, so the type check proves every code has words, and no string is unused.
 */
import type { ActivityKind, AlertRule, Role } from '@diary/shared';
import type { MessageKey } from '../../i18n/index.js';

const ROLE: Record<Role, MessageKey> = {
  NORMAL_USER: 'admin.role.NORMAL_USER',
  COURSE_LEADER: 'admin.role.COURSE_LEADER',
  SYS_ADMIN: 'admin.role.SYS_ADMIN',
};

const RULE: Record<AlertRule, MessageKey> = {
  limit_reached: 'attention.rule.limit_reached',
  elevated_activity: 'attention.rule.elevated_activity',
  login_failures: 'attention.rule.login_failures',
  new_devices: 'attention.rule.new_devices',
};

const KIND: Record<ActivityKind, MessageKey> = {
  entry_created: 'activity.kind.entry_created',
  entry_submitted: 'activity.kind.entry_submitted',
  entry_updated: 'activity.kind.entry_updated',
  count_entry: 'activity.kind.count_entry',
  limit_reached: 'activity.kind.limit_reached',
  elevated_activity: 'activity.kind.elevated_activity',
  login: 'activity.kind.login',
  login_failed: 'activity.kind.login_failed',
  new_device: 'activity.kind.new_device',
  password_changed: 'activity.kind.password_changed',
};

/** What a limit or warning level counts: the limits (shared/src/limits.ts) and the usage kinds. */
const WHAT: Record<string, MessageKey> = {
  create: 'activity.what.create',
  submit: 'activity.what.submit',
  update: 'activity.what.update',
  images: 'activity.what.images',
  chars: 'activity.what.chars',
  count: 'activity.what.count',
  comment: 'activity.what.comment',
};

const REASON: Record<string, MessageKey> = {
  password: 'activity.reason.password',
  locked: 'activity.reason.locked',
  throttled: 'activity.reason.throttled',
  totp: 'activity.reason.totp',
};

const BY: Record<string, MessageKey> = { self: 'activity.by.self', admin: 'activity.by.admin' };

export const roleKey = (role: Role): MessageKey => ROLE[role];
export const ruleKey = (rule: AlertRule): MessageKey => RULE[rule];
export const kindKey = (kind: ActivityKind): MessageKey => KIND[kind];

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/**
 * An event's small facts in words: "上限：首次提交", "密碼錯誤", the device name. Anything unexpected is
 * shown as written rather than hidden.
 */
export function describeDetail(
  detail: Readonly<Record<string, string | number | boolean>> | null,
  t: T,
): string {
  if (!detail) return '';
  const what = (value: unknown) => {
    const key = WHAT[String(value)];
    return key ? t(key) : String(value);
  };
  const parts: string[] = [];
  for (const [key, value] of Object.entries(detail)) {
    const reason = key === 'reason' ? REASON[String(value)] : undefined;
    const by = key === 'by' ? BY[String(value)] : undefined;
    if (key === 'limit') parts.push(t('activity.limit', { what: what(value) }));
    else if (key === 'usage') {
      parts.push(t('activity.usage', { what: what(value), n: Number(detail.count) }));
    } else if (key === 'count' && 'usage' in detail) continue;
    else if (reason) parts.push(t(reason));
    else if (by) parts.push(t(by));
    else if (key === 'device') parts.push(String(value));
    else parts.push(`${key}: ${String(value)}`);
  }
  return parts.join(' · ');
}

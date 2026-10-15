/** Words for the admin screens' codes: roles, flags and activity details (metadata only). */
import type { MessageKey } from '../../i18n/index.js';

export const roleKey = (role: string) => `admin.role.${role}` as MessageKey;
export const ruleKey = (rule: string) => `attention.rule.${rule}` as MessageKey;
export const kindKey = (kind: string) => `activity.kind.${kind}` as MessageKey;

const WHAT = ['create', 'submit', 'update', 'images', 'chars', 'count', 'comment'];
const REASONS = ['password', 'locked', 'throttled', 'totp'];

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
  const what = (value: unknown) =>
    WHAT.includes(String(value))
      ? t(`activity.what.${String(value)}` as MessageKey)
      : String(value);
  const parts: string[] = [];
  for (const [key, value] of Object.entries(detail)) {
    if (key === 'limit') parts.push(t('activity.limit', { what: what(value) }));
    else if (key === 'usage')
      parts.push(t('activity.usage', { what: what(value), n: Number(detail.count) }));
    else if (key === 'count' && 'usage' in detail) continue;
    else if (key === 'reason' && REASONS.includes(String(value)))
      parts.push(t(`activity.reason.${String(value)}` as MessageKey));
    else if (key === 'by' && (value === 'self' || value === 'admin'))
      parts.push(t(`activity.by.${value}`));
    else if (key === 'device') parts.push(String(value));
    else parts.push(`${key}: ${String(value)}`);
  }
  return parts.join(' · ');
}

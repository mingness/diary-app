import { describe, expect, it } from 'vitest';
import { format, type MessageKey } from '../src/i18n/messages.js';
import { zhHant } from '../src/i18n/zh-Hant.js';
import { describeDetail } from '../src/screens/admin/labels.js';

const t = (key: MessageKey, vars?: Record<string, string | number>) => format(zhHant, key, vars);

describe('describeDetail (activity facts in words; metadata only)', () => {
  it('names limits, sign-in failures, password changes and devices', () => {
    expect(describeDetail({ limit: 'submit' }, t)).toBe('上限：首次提交');
    expect(describeDetail({ reason: 'totp' }, t)).toBe('驗證碼錯誤');
    expect(describeDetail({ by: 'admin' }, t)).toBe('由管理員設定');
    expect(describeDetail({ device: 'iPhone · Safari' }, t)).toBe('iPhone · Safari');
  });

  it('reads a warning level as one fact, not two', () => {
    expect(describeDetail({ usage: 'comment', count: 40 }, t)).toBe('提交批注 已達 40 次');
  });

  it('shows anything unexpected as written rather than hiding it', () => {
    expect(describeDetail({ limit: 'new-kind', other: 3 }, t)).toBe('上限：new-kind · other: 3');
    expect(describeDetail(null, t)).toBe('');
  });
});

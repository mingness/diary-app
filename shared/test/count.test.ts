import { describe, expect, it } from 'vitest';
import { DAILY_COUNT_MAX, DailyCount, normaliseDailyCount } from '../src/count.js';

describe('normaliseDailyCount', () => {
  it.each([
    // [input, value, text, notices]
    ['108', 108, '108', []],
    ['1', 1, '1', []],
    ['1080', 1080, '1080', []],
    ['007', 7, '7', []],
    ['', null, '', []],
    ['1081', 1080, '1080', ['clamped_to_max']],
    ['99999', 1080, '1080', ['clamped_to_max']],
    ['0', 1, '1', ['clamped_to_min']],
    ['000', 1, '1', ['clamped_to_min']],
    ['10a8', 108, '108', ['non_digits_removed']],
    ['-5', 5, '5', ['non_digits_removed']],
    ['1.5', 15, '15', ['non_digits_removed']],
    ['1,080', 1080, '1080', ['non_digits_removed']],
    [' 108 ', 108, '108', ['non_digits_removed']],
    ['abc', null, '', ['non_digits_removed']],
    ['12x3456', 1080, '1080', ['non_digits_removed', 'clamped_to_max']],
    ['-0', 1, '1', ['non_digits_removed', 'clamped_to_min']],
  ] as const)('%j → %j', (input, value, text, notices) => {
    expect(normaliseDailyCount(input)).toEqual({ value, text, notices });
  });

  it('accepts full-width digits from Chinese input methods without a notice', () => {
    expect(normaliseDailyCount('１０８')).toEqual({ value: 108, text: '108', notices: [] });
    expect(normaliseDailyCount('２０００')).toEqual({
      value: 1080,
      text: '1080',
      notices: ['clamped_to_max'],
    });
  });

  it('does not overflow on absurdly long input', () => {
    const result = normaliseDailyCount('9'.repeat(400));
    expect(result.value).toBe(DAILY_COUNT_MAX);
    expect(result.notices).toEqual(['clamped_to_max']);
  });

  it('is idempotent: normalising its own output changes nothing', () => {
    for (const input of ['10a8', '99999', '0', '１０８', 'x', '']) {
      const once = normaliseDailyCount(input);
      expect(normaliseDailyCount(once.text)).toEqual({ ...once, notices: [] });
    }
  });
});

describe('DailyCount (API schema)', () => {
  it.each([1, 540, 1080])('accepts %d', (n) => expect(DailyCount.safeParse(n).success).toBe(true));
  it.each([0, 1081, -1, 1.5, Number.NaN, '108'])('rejects %j', (n) =>
    expect(DailyCount.safeParse(n).success).toBe(false),
  );
});

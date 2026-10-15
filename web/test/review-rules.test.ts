import { describe, expect, it } from 'vitest';
import { pageList } from '../src/components/Pagination.js';
import { monthGrid, weekdayNames } from '../src/lib/dates.js';
import { commentButtons, mayAutosave } from '../src/screens/review/rules.js';

const base = { dirty: false, busy: false, state: 'none' as const, hasContent: false, chars: 0 };

describe('commentButtons (spec §5.4)', () => {
  it('needs text or a photo before 提交批注, but lets an empty draft save', () => {
    expect(commentButtons({ ...base, dirty: true })).toEqual({
      draft: true,
      submit: false,
      submitLabel: 'submit',
      submitBlockedBy: 'empty',
    });
    expect(commentButtons({ ...base, dirty: true, hasContent: true, chars: 3 }).submit).toBe(true);
  });

  it('offers 提交批注 for a saved draft, and 更新批注 once the student sees one', () => {
    expect(commentButtons({ ...base, state: 'draft', hasContent: true, chars: 3 })).toMatchObject({
      draft: false,
      submit: true,
      submitLabel: 'submit',
    });
    expect(
      commentButtons({ ...base, state: 'submitted', hasContent: true, chars: 3 }),
    ).toMatchObject({ submit: false, submitLabel: 'update' });
  });

  it('blocks submitting over 5,000 characters', () => {
    expect(
      commentButtons({ ...base, dirty: true, hasContent: true, chars: 5001 }).submitBlockedBy,
    ).toBe('tooLong');
  });
});

describe('mayAutosave', () => {
  it('never saves a submitted comment as a draft, which would hide it from the student', () => {
    expect(mayAutosave('submitted', true)).toBe(false);
    expect(mayAutosave('draft', true)).toBe(true);
    expect(mayAutosave('none', true)).toBe(true);
    expect(mayAutosave('draft', false)).toBe(false);
  });
});

describe('monthGrid', () => {
  it('starts weeks on Sunday with blanks around the month', () => {
    // October 2026 starts on a Thursday and has 31 days.
    const weeks = monthGrid('2026-10');
    expect(weeks[0]).toEqual([null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(weeks).toHaveLength(5);
    expect(weeks[4]).toEqual([
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
    ]);
  });

  it('handles leap-year February', () => {
    expect(monthGrid('2028-02').flat().filter(Boolean)).toHaveLength(29);
  });
});

describe('weekdayNames (spec §6.3: Chinese weekday headers)', () => {
  it('starts on Sunday', () => {
    expect(weekdayNames('zh-Hant')).toEqual(['日', '一', '二', '三', '四', '五', '六']);
    expect(weekdayNames('en')[0]).toBe('Sun');
  });
});

describe('pageList', () => {
  it('keeps the first, the last and the neighbours of the current page', () => {
    expect(pageList(1, 1)).toEqual([1]);
    expect(pageList(1, 4)).toEqual([1, 2, null, 4]);
    expect(pageList(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageList(10, 10)).toEqual([1, null, 9, 10]);
  });
});

import { describe, expect, it } from 'vitest';
import { newsBetween } from '../src/screens/diary/MyDiaryScreen.js';
import { counterTone, editorButtons, plannedSize } from '../src/screens/diary/rules.js';
import { FONTS, fontKeyOf, sizeKeyOf } from '../src/screens/diary/schema.js';

const base = { dirty: false, busy: false, submittedOnce: false, pendingDraft: false, chars: 10 };

describe('editorButtons (spec §5.2)', () => {
  it('starts with both off, and turns both on with a change', () => {
    expect(editorButtons(base)).toMatchObject({
      draft: false,
      submit: false,
      submitLabel: 'submit',
    });
    expect(editorButtons({ ...base, dirty: true })).toMatchObject({ draft: true, submit: true });
  });

  it('after 暫存 turns 暫存 off but leaves 提交 on for the saved draft', () => {
    expect(editorButtons({ ...base, pendingDraft: true })).toMatchObject({
      draft: false,
      submit: true,
    });
  });

  it('reads 更新 once submitted, and stays off on re-entry until something changes', () => {
    expect(editorButtons({ ...base, submittedOnce: true })).toMatchObject({
      submit: false,
      submitLabel: 'update',
    });
  });

  it('blocks 提交 over 5,000 characters but still lets 暫存 save', () => {
    expect(editorButtons({ ...base, dirty: true, chars: 5001 })).toEqual({
      draft: true,
      submit: false,
      submitLabel: 'submit',
      submitBlockedBy: 'tooLong',
    });
    expect(editorButtons({ ...base, dirty: true, chars: 5000 }).submit).toBe(true);
  });

  it('turns everything off while a save is in flight', () => {
    expect(editorButtons({ ...base, dirty: true, busy: true })).toMatchObject({
      draft: false,
      submit: false,
    });
  });
});

describe('counterTone (FRONTEND.md §4.3)', () => {
  it('appears from 4,000, turns amber near 5,000 and stays amber over it', () => {
    expect(counterTone(3999)).toBe('hidden');
    expect(counterTone(4000)).toBe('quiet');
    expect(counterTone(4749)).toBe('quiet');
    expect(counterTone(4750)).toBe('near');
    expect(counterTone(5001)).toBe('over');
  });
});

describe('plannedSize (ARCHITECTURE §8.3)', () => {
  it('fits the long edge within 1600 px and leaves smaller photos their size', () => {
    expect(plannedSize(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(plannedSize(3024, 4032)).toEqual({ width: 1200, height: 1600 });
    expect(plannedSize(1200, 800)).toEqual({ width: 1200, height: 800 });
  });
});

describe('fonts and sizes read back from stored HTML', () => {
  it('recognise a font however the browser re-quoted it', () => {
    expect(fontKeyOf(FONTS.kai)).toBe('kai');
    expect(fontKeyOf("'Songti TC', 'Noto Serif TC', PMingLiU, serif")).toBe('serif');
    expect(fontKeyOf('Arial')).toBeNull();
    expect(fontKeyOf(undefined)).toBeNull();
  });

  it('fall back to normal for sizes the toolbar doesn’t offer', () => {
    expect(sizeKeyOf('1.25em')).toBe('large');
    expect(sizeKeyOf('13px')).toBe('normal');
  });
});

describe('newsBetween (spec §6.2 toasts)', () => {
  const row = (id: string, hasUnseenComment = false) => ({ id, hasUnseenComment });

  it('notices a new entry and a newly unseen comment, not one already known', () => {
    expect(newsBetween([row('a')], [row('a'), row('b')])).toEqual({
      newEntry: true,
      newComment: false,
    });
    expect(newsBetween([row('a')], [row('a', true)])).toEqual({
      newEntry: false,
      newComment: true,
    });
    expect(newsBetween([row('a', true)], [row('a', true)])).toEqual({
      newEntry: false,
      newComment: false,
    });
  });
});

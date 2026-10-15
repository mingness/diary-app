/**
 * The editor's rules as pure functions, so they can be tested exactly (spec §5.2, §5.5; ARCHITECTURE §8.3).
 */
import { ENTRY_LIMITS } from '@diary/shared';

export interface ButtonInput {
  /** The editor differs from what was last saved. */
  dirty: boolean;
  /** A save or submit is in flight. */
  busy: boolean;
  /** The entry has been submitted at least once, so the button reads 更新. */
  submittedOnce: boolean;
  /** A saved working copy that leaders haven't seen yet (the server's `draft`). */
  pendingDraft: boolean;
  /** Visible characters, whitespace excluded. */
  chars: number;
}

export type SubmitBlock = 'unchanged' | 'tooLong' | null;

export interface Buttons {
  draft: boolean;
  submit: boolean;
  submitLabel: 'submit' | 'update';
  /** Why 提交/更新 is off when there is something to send. */
  submitBlockedBy: SubmitBlock;
}

/**
 * 暫存 is on while there are unsaved changes. 提交/更新 is on while there is anything leaders haven't seen
 * (unsaved changes or a saved draft) and the entry is within the length limit; a draft over the limit still
 * saves, so writing is never lost.
 */
export function editorButtons(input: ButtonInput): Buttons {
  const hasNews = input.dirty || input.pendingDraft;
  const tooLong = input.chars > ENTRY_LIMITS.chars;
  return {
    draft: input.dirty && !input.busy,
    submit: hasNews && !tooLong && !input.busy,
    submitLabel: input.submittedOnce ? 'update' : 'submit',
    submitBlockedBy: hasNews && tooLong ? 'tooLong' : null,
  };
}

export type CounterTone = 'hidden' | 'quiet' | 'near' | 'over';

/** The length counter appears from 4,000 characters and turns amber near the limit; never red (FRONTEND §4.3). */
export function counterTone(chars: number): CounterTone {
  if (chars < ENTRY_LIMITS.charsCounterFrom) return 'hidden';
  if (chars > ENTRY_LIMITS.chars) return 'over';
  if (chars >= ENTRY_LIMITS.chars * 0.95) return 'near';
  return 'quiet';
}

/** Photos over this size or long edge are made smaller before they're inserted (ARCHITECTURE §8.3). */
export const IMAGE_MAX_EDGE = 1600;
export const IMAGE_TARGET_BYTES = 500_000;
/** JPEG qualities tried in turn until the photo is under the target size. */
export const IMAGE_QUALITIES = [0.8, 0.7, 0.6] as const;

/**
 * The size a photo is drawn at. Every photo is re-encoded, even a small one, because that is what removes its
 * metadata (location included); only large ones are scaled down.
 */
export function plannedSize(width: number, height: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= IMAGE_MAX_EDGE) return { width, height };
  const scale = IMAGE_MAX_EDGE / longEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

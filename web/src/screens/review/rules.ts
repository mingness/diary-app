/** The comment editor's buttons (spec §5.2, §5.4), as a pure function so it can be tested exactly. */
import { ENTRY_LIMITS } from '@diary/shared';

export type CommentState = 'none' | 'draft' | 'submitted';

export interface CommentButtonInput {
  dirty: boolean;
  busy: boolean;
  /** What the server holds for this leader's comment. */
  state: CommentState;
  /** Some visible text or a photo: a submitted comment needs one or the other. */
  hasContent: boolean;
  chars: number;
}

export interface CommentButtons {
  draft: boolean;
  submit: boolean;
  submitLabel: 'submit' | 'update';
  submitBlockedBy: 'empty' | 'tooLong' | null;
}

/**
 * 暫存 while there are unsaved changes. 提交批注 while there is something the student hasn't seen (changes, or
 * a saved draft), with content, within the length limit; it reads 更新批注 when the student sees an earlier one.
 */
export function commentButtons(input: CommentButtonInput): CommentButtons {
  const hasNews = input.dirty || input.state === 'draft';
  const tooLong = input.chars > ENTRY_LIMITS.chars;
  const blockedBy = !hasNews ? null : !input.hasContent ? 'empty' : tooLong ? 'tooLong' : null;
  return {
    draft: input.dirty && !input.busy,
    submit: hasNews && blockedBy === null && !input.busy,
    submitLabel: input.state === 'submitted' ? 'update' : 'submit',
    submitBlockedBy: blockedBy,
  };
}

/**
 * Autosave may only keep a draft a draft: saving a submitted comment as a draft would take it away from the
 * student, so it only runs while the comment isn't submitted.
 */
export function mayAutosave(state: CommentState, dirty: boolean): boolean {
  return dirty && state !== 'submitted';
}

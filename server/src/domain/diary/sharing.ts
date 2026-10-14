/**
 * The sharing ("open access") state machine, docs/ARCHITECTURE.md §7.2 and spec §5.3:
 *
 *   owner:   private ──request──► wait_for_open ──withdraw──► private
 *   leader:  wait_for_open ──approve──► open
 *   leader:  wait_for_open ──decline──► private
 *   either:  open ──revoke──► private
 *
 * Only submitted entries can be shared. Who counts as owner or leader for a given entry is decided by the
 * authorisation policy (canOnDocument); this module only decides which changes each party may make from
 * which state.
 */
import type { Access } from '@diary/shared';

export type AccessEvent = 'request' | 'withdraw' | 'approve' | 'decline' | 'revoke';
export type Party = 'owner' | 'leader';

export type TransitionResult =
  | { readonly ok: true; readonly next: Access }
  | { readonly ok: false; readonly reason: 'not_submitted' | 'invalid_transition' };

interface Rule {
  readonly from: Access;
  readonly by: readonly Party[];
  readonly to: Access;
}

const RULES: Readonly<Record<AccessEvent, Rule>> = {
  request: { from: 'private', by: ['owner'], to: 'wait_for_open' },
  withdraw: { from: 'wait_for_open', by: ['owner'], to: 'private' },
  approve: { from: 'wait_for_open', by: ['leader'], to: 'open' },
  decline: { from: 'wait_for_open', by: ['leader'], to: 'private' },
  revoke: { from: 'open', by: ['owner', 'leader'], to: 'private' },
};

export function transitionAccess(
  current: Access,
  event: AccessEvent,
  party: Party,
  submitted: boolean,
): TransitionResult {
  if (!submitted) return { ok: false, reason: 'not_submitted' };
  const rule = RULES[event];
  if (rule.from !== current || !rule.by.includes(party)) {
    return { ok: false, reason: 'invalid_transition' };
  }
  return { ok: true, next: rule.to };
}

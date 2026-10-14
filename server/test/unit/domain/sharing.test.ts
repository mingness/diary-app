/** Every state × event × party × submitted combination of the sharing state machine (ARCHITECTURE.md §7.2). */
import { describe, expect, it } from 'vitest';
import type { Access } from '@diary/shared';
import {
  transitionAccess,
  type AccessEvent,
  type Party,
} from '../../../src/domain/diary/sharing.js';

const STATES: Access[] = ['private', 'wait_for_open', 'open'];
const EVENTS: AccessEvent[] = ['request', 'withdraw', 'approve', 'decline', 'revoke'];
const PARTIES: Party[] = ['owner', 'leader'];

// The only allowed transitions, written out by hand: "state/event/party" → next state.
const ALLOWED: Record<string, Access> = {
  'private/request/owner': 'wait_for_open',
  'wait_for_open/withdraw/owner': 'private',
  'wait_for_open/approve/leader': 'open',
  'wait_for_open/decline/leader': 'private',
  'open/revoke/owner': 'private',
  'open/revoke/leader': 'private',
};

const cases = STATES.flatMap((state) =>
  EVENTS.flatMap((event) => PARTIES.map((party) => [state, event, party] as const)),
);

describe('transitionAccess for submitted entries', () => {
  it.each(cases)('%s + %s by %s', (state, event, party) => {
    const next = ALLOWED[`${state}/${event}/${party}`];
    const result = transitionAccess(state, event, party, true);
    expect(result).toEqual(next ? { ok: true, next } : { ok: false, reason: 'invalid_transition' });
  });
});

describe('transitionAccess for never-submitted entries', () => {
  it.each(cases)('%s + %s by %s is refused as not_submitted', (state, event, party) => {
    expect(transitionAccess(state, event, party, false)).toEqual({
      ok: false,
      reason: 'not_submitted',
    });
  });
});

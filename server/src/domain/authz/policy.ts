/**
 * Who may see and do what (docs/ARCHITECTURE.md §7). Pure functions over plain facts, so every rule is
 * unit-tested directly and every route asks the same questions. Default deny: anything not granted here is
 * refused.
 *
 * Two kinds of question:
 *  - Role capabilities, for whole areas of the app (e.g. "can open the SYS_ADMIN user list").
 *  - Document rules, which also depend on the actor's relation to one entry and that entry's state.
 */
import type { Access, Role } from '@diary/shared';

export interface Actor {
  readonly id: string;
  readonly role: Role;
}

/** The facts about a diary entry that permissions depend on. Never includes content. */
export interface DocumentFacts {
  readonly ownerId: string;
  /** True once the owner has submitted at least once. Leaders never see a never-submitted entry. */
  readonly submitted: boolean;
  readonly access: Access;
}

// ---------------------------------------------------------------------------------------------------------
// Role capabilities

export const Capability = {
  /** Write one's own diary entries. */
  WriteDiary: 'diary.write',
  /** List and read entries that are open to everyone. */
  ReadOpenDiaries: 'diary.read_open',
  /** The leader review screens: calendar, day lists, open requests, comments. */
  LeaderReview: 'leader.review',
  ManageUsers: 'admin.users',
  ManagePasswordResets: 'admin.password_resets',
  /** Document metadata only: title, date, owner, state. Never content. */
  ManageDocuments: 'admin.documents',
  ManageCount: 'admin.count',
  /** Activity log, summary and Attention list: metadata only (spec §6.5.5). */
  ReviewActivity: 'admin.activity',
  /** Report and view 報數. */
  Count: 'count.participate',
  /** Translate text the actor is already allowed to read. */
  Translate: 'translate',
} as const;
export type Capability = (typeof Capability)[keyof typeof Capability];

const C = Capability;

const ROLE_CAPABILITIES: Readonly<Record<Role, ReadonlySet<Capability>>> = {
  NORMAL_USER: new Set([C.WriteDiary, C.ReadOpenDiaries, C.Count, C.Translate]),
  // Leaders may keep their own diary too (D19).
  COURSE_LEADER: new Set([C.WriteDiary, C.ReadOpenDiaries, C.LeaderReview, C.Count, C.Translate]),
  // SYS_ADMIN never gets anything that reads diary content: no diary, no open diaries, no translation.
  SYS_ADMIN: new Set([
    C.ManageUsers,
    C.ManagePasswordResets,
    C.ManageDocuments,
    C.ManageCount,
    C.ReviewActivity,
    C.Count,
  ]),
};

export function hasCapability(actor: Actor, capability: Capability): boolean {
  return ROLE_CAPABILITIES[actor.role].has(capability);
}

// ---------------------------------------------------------------------------------------------------------
// Documents

/**
 * How much of an entry the actor may see:
 *  - `owner`: everything, including the unsubmitted draft and history.
 *  - `leader`: the last submitted content, history, all submitted comments and their own draft comment.
 *  - `reader`: an open entry's submitted content and submitted comments.
 *  - `metadata`: title, date, owner and state only (SYS_ADMIN).
 *  - `null`: nothing; the entry doesn't exist as far as this actor is concerned.
 */
export type DocumentView = 'owner' | 'leader' | 'reader' | 'metadata';

export function documentView(actor: Actor, doc: DocumentFacts): DocumentView | null {
  if (actor.role === 'SYS_ADMIN') return 'metadata';
  if (actor.id === doc.ownerId) return 'owner';
  if (!doc.submitted) return null;
  if (actor.role === 'COURSE_LEADER') return 'leader';
  if (doc.access === 'open') return 'reader';
  return null;
}

export const DocumentAction = {
  /** Save a draft or submit. */
  Edit: 'edit',
  ReadVersions: 'read_versions',
  /** Write or update one's own comment. */
  Comment: 'comment',
  RequestOpen: 'request_open',
  WithdrawOpen: 'withdraw_open',
  ApproveOpen: 'approve_open',
  DeclineOpen: 'decline_open',
  RevokeOpen: 'revoke_open',
  Delete: 'delete',
} as const;
export type DocumentAction = (typeof DocumentAction)[keyof typeof DocumentAction];

/**
 * Whether the actor may perform `action` on the entry. This checks WHO may act; whether the entry's current
 * state allows the change (e.g. approving something that isn't waiting) is the sharing state machine's job.
 */
export function canOnDocument(actor: Actor, action: DocumentAction, doc: DocumentFacts): boolean {
  const isOwner = actor.id === doc.ownerId && actor.role !== 'SYS_ADMIN';
  // A leader acting as a leader: never on their own entry, and only once it has been submitted.
  const asLeader = actor.role === 'COURSE_LEADER' && !isOwner && doc.submitted;

  switch (action) {
    case DocumentAction.Edit:
    case DocumentAction.RequestOpen:
    case DocumentAction.WithdrawOpen:
      return isOwner;
    case DocumentAction.ReadVersions:
    case DocumentAction.RevokeOpen:
      return isOwner || asLeader;
    case DocumentAction.Comment:
    case DocumentAction.ApproveOpen:
    case DocumentAction.DeclineOpen:
      return asLeader;
    case DocumentAction.Delete:
      // The spec gives deleting entries to SYS_ADMIN (§6.5), which needs no access to content.
      return actor.role === 'SYS_ADMIN';
    default:
      return false;
  }
}

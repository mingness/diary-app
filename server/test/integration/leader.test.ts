/**
 * The leader's side of the diary (spec §5.3, §5.4, §6.3; docs/ARCHITECTURE.md §7): reading submitted entries,
 * comments, review lists and sharing decisions, against a real database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  DAILY_WARNINGS,
  ENTRY_LIMITS,
  ErrorBody,
  EntryView,
  LeaderEntryView,
  LeaderCalendar,
  LeaderDocumentList,
  LeaderUserList,
  MyDocumentList,
  OpenRequestList,
  OwnerEntryView,
  type Profile,
} from '@diary/shared';
import { activityEvents, alerts, comments, readAudit } from '../../src/db/schema.js';
import { purgeExpired } from '../../src/jobs.js';
import { saveMyComment } from '../../src/services/diary/comments.js';
import { changeAccess } from '../../src/services/sharing.js';
import { EMPTY_PROFILE } from '../../src/services/profiles.js';
import { createUser } from '../../src/services/users.js';
import {
  as,
  createTestApp,
  DAY,
  login,
  signedInAdmin,
  TEST_PASSWORD,
  type Signin,
  type TestApp,
} from '../helpers/app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t?.close();
});

type Role = 'NORMAL_USER' | 'COURSE_LEADER';
let n = 0;
async function person(role: Role = 'NORMAL_USER', profile: Profile = EMPTY_PROFILE) {
  const username = `p${++n}x${Date.now() % 10000}`;
  const user = await createUser(t.ctx, { username, password: TEST_PASSWORD, role, profile });
  const signin = await login(t.app, username, TEST_PASSWORD, { remember: true });
  return { ...signin, id: user.id, role, username };
}
type Who = Pick<Signin, 'cookie' | 'csrf'>;

const call = (who: Who | null, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  t.app.inject({ method, url, headers: who ? as(who) : {}, ...(payload ? { payload } : {}) });
const code = (res: { json: () => unknown }) => ErrorBody.parse(res.json()).code;
const view = async (who: Who, id: string) =>
  EntryView.parse((await call(who, 'GET', `/api/documents/${id}`)).json());
const ownerView = async (who: Who, id: string) => OwnerEntryView.parse(await view(who, id));
const leaderView = async (who: Who, id: string) => LeaderEntryView.parse(await view(who, id));
const comment = (who: Who, id: string, body: string, state: 'draft' | 'submitted') =>
  call(who, 'PUT', `/api/documents/${id}/comments/mine`, { body, state });
const access = (who: Who, id: string, action: string) =>
  call(who, 'POST', `/api/documents/${id}/access`, { action });

/** An entry by `owner`, submitted with `body` unless `submitted` is false. */
async function entry(owner: Who, title: string, body: string, submitted = true): Promise<string> {
  const { id } = (await call(owner, 'POST', '/api/documents', { title, body })).json();
  if (submitted) await call(owner, 'POST', `/api/documents/${id}/submit`, { title, body });
  return id;
}

describe('reading as a leader (spec §5.1, docs/ARCHITECTURE.md §7.1)', () => {
  it('sees the last submitted version only, never the owner’s draft or a never-submitted entry', async () => {
    const owner = await person('NORMAL_USER', {
      ...EMPTY_PROFILE,
      familyName: '陳',
      givenName: '明德',
    });
    const leader = await person('COURSE_LEADER');
    const id = await entry(owner, '晨起', '<p>submitted text</p>');
    await call(owner, 'PUT', `/api/documents/${id}/draft`, {
      title: 'renamed',
      body: '<p>DRAFT-ONLY</p>',
    });
    const seen = await view(leader, id);
    expect(seen).toMatchObject({
      view: 'leader',
      title: '晨起',
      body: '<p>submitted text</p>',
      author: { id: owner.id, name: '陳明德' },
      myComment: null,
    });
    expect(JSON.stringify(seen)).not.toContain('DRAFT-ONLY');

    const never = await entry(owner, 'unsent', '<p>x</p>', false);
    expect((await call(leader, 'GET', `/api/documents/${never}`)).statusCode).toBe(404);
    expect(code(await comment(leader, never, '<p>hi</p>', 'draft'))).toBe('not_found');
  });

  it('can read history versions; every leader read is audited, and owners never see it', async () => {
    const owner = await person();
    const leader = await person('COURSE_LEADER');
    const id = await entry(owner, 'v', '<p>one</p>');
    await call(owner, 'POST', `/api/documents/${id}/submit`, { title: 'v', body: '<p>two</p>' });
    await view(leader, id);
    const versions = await call(leader, 'GET', `/api/documents/${id}/versions`);
    expect(versions.json().versions.map((v: { body: string }) => v.body)).toEqual(['<p>one</p>']);
    // The owner's own reads aren't audited.
    await view(owner, id);
    const reads = await t.ctx.db.select().from(readAudit).where(eq(readAudit.documentId, id));
    expect(reads.map((r) => r.leaderId)).toEqual([leader.id, leader.id]);
    expect(JSON.stringify(await view(owner, id))).not.toContain(leader.username);
  });

  it('a leader’s own entry: owner view, and they may comment on it and open it like any other', async () => {
    const leader = await person('COURSE_LEADER');
    const id = await entry(leader, 'mine', '<p>x</p>');
    expect((await comment(leader, id, '<p>note to self</p>', 'submitted')).statusCode).toBe(200);
    // Their own comment is `myComment` (not one of `comments`) and never "new" to them.
    const own = await ownerView(leader, id);
    expect(own).toMatchObject({ comments: [], myComment: { body: '<p>note to self</p>' } });
    const list = MyDocumentList.parse(
      (await call(leader, 'GET', '/api/documents/mine?month=2026-10')).json(),
    );
    expect(list.documents.find((d) => d.id === id)).toMatchObject({
      commentCount: 1,
      hasUnseenComment: false,
    });
    // Still request first, then approve: the state machine is the same for everyone.
    expect(code(await access(leader, id, 'approve'))).toBe('invalid_transition');
    await access(leader, id, 'request');
    expect((await access(leader, id, 'approve')).json()).toEqual({ access: 'open' });
    // Another leader reads it as a leader, comment included.
    expect((await leaderView(await person('COURSE_LEADER'), id)).comments).toMatchObject([
      { body: '<p>note to self</p>' },
    ]);
  });
});

describe('comments (spec §5.4)', () => {
  it('a draft is seen by its leader only; once submitted, by the owner (as new) and other leaders', async () => {
    const owner = await person();
    const [l1, l2] = [
      await person('COURSE_LEADER', { ...EMPTY_PROFILE, familyName: '林', givenName: '慧君' }),
      await person('COURSE_LEADER'),
    ];
    const id = await entry(owner, 'c', '<p>x</p>');

    const drafted = await comment(l1, id, '<p>draft words</p>', 'draft');
    expect(drafted.json()).toMatchObject({ state: 'draft', submittedAt: null });
    expect((await ownerView(owner, id)).comments).toEqual([]);
    expect((await leaderView(l2, id)).comments).toEqual([]);
    expect((await leaderView(l1, id)).myComment?.body).toBe('<p>draft words</p>');

    await comment(l1, id, '<p onclick="x()">well done</p>', 'submitted');
    const first = await ownerView(owner, id);
    expect(first.comments).toMatchObject([
      { authorName: '林慧君', body: '<p>well done</p>', isNew: true },
    ]);
    // Opening the entry marked it seen.
    expect((await ownerView(owner, id)).comments[0]).toMatchObject({ isNew: false });
    const l2view = await leaderView(l2, id);
    expect(l2view.comments).toMatchObject([{ authorName: '林慧君' }]);
    expect(l2view.myComment).toBeNull();
    // A leader's own submitted comment is `myComment`, not repeated in `comments`.
    const l1view = await leaderView(l1, id);
    expect(l1view.comments).toEqual([]);
  });

  it('a changed resubmission is new again; resubmitting the same text is not', async () => {
    const owner = await person();
    const leader = await person('COURSE_LEADER');
    const id = await entry(owner, 'r', '<p>x</p>');
    await comment(leader, id, '<p>a</p>', 'submitted');
    await ownerView(owner, id);
    await comment(leader, id, '<p>a</p>', 'submitted');
    expect((await ownerView(owner, id)).comments[0]?.isNew).toBe(false);
    await comment(leader, id, '<p>b</p>', 'submitted');
    const list = MyDocumentList.parse(
      (await call(owner, 'GET', '/api/documents/mine?month=2026-10')).json(),
    );
    expect(list.documents.find((d) => d.id === id)?.hasUnseenComment).toBe(true);
    expect((await ownerView(owner, id)).comments[0]).toMatchObject({
      body: '<p>b</p>',
      isNew: true,
    });
  });

  it('saving a submitted comment as a draft takes it out of the owner’s view', async () => {
    const owner = await person();
    const leader = await person('COURSE_LEADER');
    const id = await entry(owner, 'd', '<p>x</p>');
    await comment(leader, id, '<p>shown</p>', 'submitted');
    await comment(leader, id, '<p>being edited</p>', 'draft');
    expect((await view(owner, id)).comments).toEqual([]);
  });

  it('refuses an empty submitted comment, and is stored encrypted', async () => {
    const owner = await person();
    const leader = await person('COURSE_LEADER');
    const id = await entry(owner, 'e', '<p>x</p>');
    expect(code(await comment(leader, id, '<p> </p>', 'submitted'))).toBe('validation_failed');
    await comment(leader, id, '<p>COMMENT-SECRET-5</p>', 'submitted');
    const { rows } = await t.testDb.database.pool.query(
      "SELECT string_agg(row_to_json(c)::text, '') AS text FROM comments c",
    );
    expect(rows[0].text).not.toContain('COMMENT-SECRET-5');
  });

  it('has the entry limits: characters on submit (the draft still saves), photos always', async () => {
    const owner = await person();
    const leader = await person('COURSE_LEADER');
    const id = await entry(owner, 'limits', '<p>x</p>');
    const tooLong = `<p>${'念'.repeat(ENTRY_LIMITS.chars + 1)}</p>`;
    expect((await comment(leader, id, tooLong, 'draft')).statusCode).toBe(200);
    const refused = await comment(leader, id, tooLong, 'submitted');
    expect(refused.statusCode).toBe(409);
    expect(ErrorBody.parse(refused.json()).details).toMatchObject({ limit: 'chars' });
    expect((await leaderView(leader, id)).myComment?.state).toBe('draft');
    const photo = `<img src="data:image/png;base64,${Buffer.alloc(10, 1).toString('base64')}">`;
    const tooMany = await comment(leader, id, photo.repeat(ENTRY_LIMITS.images + 1), 'draft');
    expect(ErrorBody.parse(tooMany.json()).details).toMatchObject({ limit: 'images' });
    // Honest writers meet these limits: refused kindly, logged, but not flagged.
    const flagged = await t.ctx.db.select().from(alerts).where(eq(alerts.userId, leader.id));
    expect(flagged).toEqual([]);
  });

  it(`flags a leader once on reaching ${DAILY_WARNINGS.comment} submitted comments a day; drafts don't count`, async () => {
    const owner = await person();
    const leader = await person('COURSE_LEADER');
    const id = await entry(owner, 'busy', '<p>x</p>');
    const flags = () => t.ctx.db.select().from(alerts).where(eq(alerts.userId, leader.id));
    for (let i = 1; i < DAILY_WARNINGS.comment; i++) {
      await comment(leader, id, `<p>draft ${i}</p>`, 'draft');
      await comment(leader, id, `<p>v${i}</p>`, 'submitted');
    }
    expect(await flags()).toEqual([]);
    await comment(leader, id, '<p>one more</p>', 'submitted');
    await comment(leader, id, '<p>and another</p>', 'submitted');
    expect((await flags()).map((f) => f.rule)).toEqual(['elevated_activity']);
    const events = await t.ctx.db
      .select()
      .from(activityEvents)
      .where(
        and(eq(activityEvents.userId, leader.id), eq(activityEvents.kind, 'elevated_activity')),
      );
    expect(events.map((e) => e.detail)).toEqual([
      { usage: 'comment', count: DAILY_WARNINGS.comment },
    ]);
  });

  it('a deleted leader’s submitted comment stays, from a former leader, for owner and other leaders', async () => {
    const owner = await person();
    const [gone, stays] = [await person('COURSE_LEADER'), await person('COURSE_LEADER')];
    const id = await entry(owner, 'f', '<p>x</p>');
    await comment(gone, id, '<p>parting words</p>', 'submitted');
    const admin = await signedInAdmin(t);
    expect((await call(admin, 'GET', `/api/admin/users/${gone.id}`)).statusCode).toBe(200);
    await t.app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${gone.id}`,
      headers: as(admin),
    });
    for (const who of [owner, stays]) {
      expect((await view(who, id)).comments).toMatchObject([
        { authorName: null, body: '<p>parting words</p>' },
      ]);
    }
  });

  it('one comment per leader, even when the first two saves race', async () => {
    const owner = await person();
    const leader = await person('COURSE_LEADER');
    for (let round = 0; round < 10; round++) {
      const id = await entry(owner, `race${round}`, '<p>x</p>');
      await Promise.all(
        ['a', 'b', 'c'].map((s) =>
          saveMyComment(t.ctx, leader, id, { body: `<p>${s}</p>`, state: 'submitted' }),
        ),
      );
      const rows = await t.ctx.db.select().from(comments).where(eq(comments.documentId, id));
      expect(rows).toHaveLength(1);
      // And it decrypts: the stored ciphertext is bound to the row's own ID.
      expect((await view(owner, id)).comments).toHaveLength(1);
    }
  });
});

describe('review lists (spec §6.3)', () => {
  it('the day list: every submitted entry with my comment state and other leaders’ comments, paged', async () => {
    const [me, other] = [await person('COURSE_LEADER'), await person('COURSE_LEADER')];
    const [u1, u2] = [await person(), await person()];
    const mine = await entry(me, 'my own', '<p>x</p>');
    const unsent = await entry(u1, 'unsent', '<p>x</p>', false);
    const a = await entry(u1, 'a', '<p>x</p>');
    const b = await entry(u2, 'b', '<p>x</p>');
    const c = await entry(u2, 'c', '<p>x</p>');
    await comment(me, a, '<p>draft</p>', 'draft');
    await comment(me, b, '<p>sent</p>', 'submitted');
    await comment(other, b, '<p>sent</p>', 'submitted');
    await comment(other, c, '<p>only a draft</p>', 'draft');

    const all = LeaderDocumentList.parse(
      (await call(me, 'GET', '/api/leader/documents?date=2026-10-14&size=100')).json(),
    );
    const ids = all.documents.map((d) => d.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(unsent);
    const row = (id: string) => all.documents.find((d) => d.id === id);
    expect([a, b, c].map((id) => [row(id)?.myCommentState, row(id)?.otherLeaderCommented])).toEqual(
      [
        ['draft', false],
        ['submitted', true],
        ['none', false],
      ],
    );

    const page2 = LeaderDocumentList.parse(
      (await call(me, 'GET', '/api/leader/documents?date=2026-10-14&size=2&page=2')).json(),
    );
    expect(page2.total).toBe(all.total);
    expect(page2.documents.map((d) => d.id)).toEqual(ids.slice(2, 4));
  });

  it('one user’s month, the calendar counts and the 學員 list', async () => {
    const me = await person('COURSE_LEADER');
    const u = await person();
    const a = await entry(u, 'a', '<p>x</p>');
    await entry(u, 'unsent', '<p>x</p>', false);
    const byUser = LeaderDocumentList.parse(
      (await call(me, 'GET', `/api/leader/documents?user=${u.id}&month=2026-10`)).json(),
    );
    expect(byUser.documents.map((d) => d.id)).toEqual([a]);
    expect(
      (await call(me, 'GET', `/api/leader/documents?user=${u.id}&month=2026-09`)).json().documents,
    ).toEqual([]);

    const before = LeaderCalendar.parse(
      (await call(me, 'GET', '/api/leader/calendar?month=2026-10')).json(),
    ).counts['2026-10-14'];
    await entry(u, 'b', '<p>x</p>');
    await entry(me, 'my own counts too', '<p>x</p>');
    const after = LeaderCalendar.parse(
      (await call(me, 'GET', '/api/leader/calendar?month=2026-10')).json(),
    ).counts['2026-10-14'];
    expect((after ?? 0) - (before ?? 0)).toBe(2);

    const admin = await signedInAdmin(t);
    const users = LeaderUserList.parse(
      (await call(me, 'GET', '/api/leader/users?month=2026-10')).json(),
    ).users;
    expect(users.find((x) => x.id === u.id)?.entries).toBe(2);
    expect(users.find((x) => x.id === me.id)?.entries).toBe(1);
    expect(users.map((x) => x.id)).not.toContain(admin.id);
  });

  it('needs either a date, or a user and a month', async () => {
    const me = await person('COURSE_LEADER');
    for (const q of ['', '?month=2026-10', `?user=${me.id}`]) {
      expect((await call(me, 'GET', `/api/leader/documents${q}`)).statusCode).toBe(400);
    }
  });

  it('only leaders can use the review lists or comment', async () => {
    const owner = await person();
    const id = await entry(owner, 'x', '<p>x</p>');
    const urls = [
      '/api/leader/documents?date=2026-10-14',
      '/api/leader/calendar?month=2026-10',
      '/api/leader/users?month=2026-10',
      '/api/leader/open-requests',
    ];
    for (const [who, status] of [
      [null, 401],
      [await person(), 403],
      [await signedInAdmin(t), 403],
    ] as const) {
      for (const url of urls) expect((await call(who, 'GET', url)).statusCode, url).toBe(status);
      expect(
        (await call(who, 'PUT', `/api/documents/${id}/comments/mine`, { body: '', state: 'draft' }))
          .statusCode,
      ).toBe(status);
    }
  });
});

describe('sharing (spec §5.3, docs/ARCHITECTURE.md §7.2)', () => {
  it('owner asks → leader approves → anyone revokes; the queue lists the oldest request first', async () => {
    const owner = await person();
    const leader = await person('COURSE_LEADER');
    const draftOnly = await entry(owner, 'unsent', '<p>x</p>', false);
    expect(code(await access(owner, draftOnly, 'request'))).toBe('not_submitted');

    const first = await entry(owner, 'first', '<p>x</p>');
    const second = await entry(owner, 'second', '<p>x</p>');
    expect((await access(owner, second, 'request')).json()).toEqual({ access: 'wait_for_open' });
    t.clock.advance(60_000);
    await access(owner, first, 'request');
    const queue = OpenRequestList.parse(
      (await call(leader, 'GET', '/api/leader/open-requests')).json(),
    ).documents.map((d) => d.id);
    expect(queue.indexOf(second)).toBeLessThan(queue.indexOf(first));

    // A user can never open their own entry; a leader can't approve twice.
    expect(code(await access(owner, second, 'approve'))).toBe('forbidden');
    expect((await access(leader, second, 'approve')).json()).toEqual({ access: 'open' });
    expect(code(await access(leader, second, 'approve'))).toBe('invalid_transition');
    expect((await access(leader, second, 'revoke')).json()).toEqual({ access: 'private' });

    expect((await access(leader, first, 'decline')).json()).toEqual({ access: 'private' });
    await access(owner, first, 'request');
    expect((await access(owner, first, 'withdraw')).json()).toEqual({ access: 'private' });
    // Someone else's private entry stays invisible.
    expect(code(await access(await person(), first, 'request'))).toBe('not_found');
  });

  it('two leaders deciding at once: exactly one wins', async () => {
    const owner = await person();
    const [l1, l2] = [await person('COURSE_LEADER'), await person('COURSE_LEADER')];
    for (let round = 0; round < 10; round++) {
      const id = await entry(owner, `decide${round}`, '<p>x</p>');
      await changeAccess(t.ctx, owner, id, 'request');
      const results = await Promise.allSettled([
        changeAccess(t.ctx, l1, id, 'approve'),
        changeAccess(t.ctx, l2, id, 'decline'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    }
  });
});

describe('read audit retention', () => {
  it('is purged with activity after 90 days', async () => {
    const owner = await person();
    const leader = await person('COURSE_LEADER');
    const id = await entry(owner, 'old', '<p>x</p>');
    await view(leader, id);
    t.clock.advance(91 * DAY);
    // A leader's remembered device lasts 30 days, so sign in again.
    await view(await login(t.app, leader.username, TEST_PASSWORD), id);
    expect((await purgeExpired(t.ctx)).reads).toBeGreaterThanOrEqual(1);
    const left = await t.ctx.db.select().from(readAudit).where(eq(readAudit.documentId, id));
    expect(left).toHaveLength(1);
  });
});

describe('new for me: entries a leader hasn’t read yet (FRONTEND.md §4.7)', () => {
  const unread = async (who: Who) =>
    LeaderDocumentList.parse(
      (await call(who, 'GET', '/api/leader/documents?unread=true&size=100')).json(),
    ).documents.map((d) => d.id);

  it('lists what I haven’t opened since it was last submitted, for me alone, and again after an update', async () => {
    const owner = await person();
    const [me, other] = [await person('COURSE_LEADER'), await person('COURSE_LEADER')];
    const older = await entry(owner, 'older', '<p>a</p>');
    t.clock.advance(60_000);
    const newer = await entry(owner, 'newer', '<p>b</p>');
    const draft = await entry(owner, 'draft', '<p>c</p>', false);

    // Newest first; never-submitted entries aren't reviewable at all.
    const before = await unread(me);
    expect(before.indexOf(newer)).toBeLessThan(before.indexOf(older));
    expect(before).not.toContain(draft);

    await leaderView(me, older);
    expect(await unread(me)).not.toContain(older);
    expect(await unread(other)).toContain(older);

    t.clock.advance(60_000);
    await call(owner, 'POST', `/api/documents/${older}/submit`, {
      title: 'older',
      body: '<p>a2</p>',
    });
    expect(await unread(me)).toContain(older);
  });

  it('never counts a leader’s own entries, and marks rows in the other lists too', async () => {
    const [me, owner] = [await person('COURSE_LEADER'), await person()];
    const mine = await entry(me, 'mine', '<p>m</p>');
    const theirs = await entry(owner, 'theirs', '<p>t</p>');
    expect(await unread(me)).not.toContain(mine);

    const today = (await ownerView(owner, theirs)).diaryDate;
    const day = async () =>
      LeaderDocumentList.parse(
        (await call(me, 'GET', `/api/leader/documents?date=${today}&size=100`)).json(),
      ).documents;
    const flag = async (id: string) => (await day()).find((d) => d.id === id)?.unread;
    expect(await flag(mine)).toBe(false);
    expect(await flag(theirs)).toBe(true);
    await leaderView(me, theirs);
    expect(await flag(theirs)).toBe(false);
  });

  it('leaves out entries older than the read record, which is kept 90 days', async () => {
    const owner = await person();
    const old = await entry(owner, 'old', '<p>o</p>');
    t.clock.advance(91 * DAY);
    // Sessions have expired meanwhile; a fresh leader signs in.
    const me = await person('COURSE_LEADER');
    expect(await unread(me)).not.toContain(old);
  });

  it('takes exactly one way of choosing the list', async () => {
    const me = await person('COURSE_LEADER');
    const res = await call(me, 'GET', '/api/leader/documents?unread=true&date=2026-10-01');
    expect(res.statusCode).toBe(400);
    expect(code(res)).toBe('validation_failed');
  });
});

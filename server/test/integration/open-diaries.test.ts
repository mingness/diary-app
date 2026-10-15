/**
 * Open diaries (spec §5.3, §6.1; docs/ARCHITECTURE.md §7.1): once a leader approves sharing, any signed-in user
 * reads the submitted version and submitted comments, and nothing more.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ErrorBody, OpenDocumentList, ReaderEntryView } from '@diary/shared';
import { readAudit } from '../../src/db/schema.js';
import { EMPTY_PROFILE } from '../../src/services/profiles.js';
import { createUser } from '../../src/services/users.js';
import {
  as,
  createTestApp,
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

let n = 0;
async function person(role: 'NORMAL_USER' | 'COURSE_LEADER' = 'NORMAL_USER') {
  const username = `o${++n}x${Date.now() % 10000}`;
  const user = await createUser(t.ctx, {
    username,
    password: TEST_PASSWORD,
    role,
    profile: { ...EMPTY_PROFILE, familyName: '吳', givenName: `${n}` },
  });
  return { ...(await login(t.app, username, TEST_PASSWORD)), id: user.id, username };
}
type Who = Pick<Signin, 'cookie' | 'csrf'>;

const call = (who: Who | null, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
  t.app.inject({ method, url, headers: who ? as(who) : {}, ...(payload ? { payload } : {}) });
const code = (res: { json: () => unknown }) => ErrorBody.parse(res.json()).code;
const openList = async (who: Who, month = '2026-10') =>
  OpenDocumentList.parse((await call(who, 'GET', `/api/documents/open?month=${month}`)).json())
    .documents;

let leader: Awaited<ReturnType<typeof person>>;
beforeAll(async () => {
  leader = await person('COURSE_LEADER');
});

/** A submitted entry by `owner`, opened by the leader unless `share` says otherwise. */
async function entry(
  owner: Who,
  title: string,
  body: string,
  share: 'open' | 'wait_for_open' | 'private' = 'open',
): Promise<string> {
  const { id } = (await call(owner, 'POST', '/api/documents', { title, body })).json();
  await call(owner, 'POST', `/api/documents/${id}/submit`, { title, body });
  if (share !== 'private')
    await call(owner, 'POST', `/api/documents/${id}/access`, { action: 'request' });
  if (share === 'open')
    await call(leader, 'POST', `/api/documents/${id}/access`, { action: 'approve' });
  return id;
}

describe('reading an open entry (spec §5.3)', () => {
  it('shows the submitted version and submitted comments only, and is not audited', async () => {
    const owner = await person();
    const id = await entry(owner, '公開', '<p>shared text</p>');
    await call(owner, 'PUT', `/api/documents/${id}/draft`, {
      title: 'pending title',
      body: '<p>OWNER-DRAFT</p>',
    });
    await call(leader, 'PUT', `/api/documents/${id}/comments/mine`, {
      body: '<p>visible comment</p>',
      state: 'submitted',
    });
    await call(await person('COURSE_LEADER'), 'PUT', `/api/documents/${id}/comments/mine`, {
      body: '<p>LEADER-DRAFT</p>',
      state: 'draft',
    });

    const reader = await person();
    const res = await call(reader, 'GET', `/api/documents/${id}`);
    const seen = ReaderEntryView.parse(res.json());
    expect(seen).toMatchObject({
      view: 'reader',
      title: '公開',
      body: '<p>shared text</p>',
      author: { id: owner.id },
      comments: [{ body: '<p>visible comment</p>' }],
    });
    expect(res.body).not.toContain('OWNER-DRAFT');
    expect(res.body).not.toContain('LEADER-DRAFT');
    expect(res.body).not.toContain('pending title');
    // History stays with the owner and leaders.
    expect((await call(reader, 'GET', `/api/documents/${id}/versions`)).statusCode).toBe(403);
    // The read audit is for leaders' reads only.
    const reads = await t.ctx.db.select().from(readAudit).where(eq(readAudit.documentId, id));
    expect(reads).toEqual([]);
  });

  it('a private or waiting entry stays invisible, and so does one closed again', async () => {
    const owner = await person();
    const reader = await person();
    const privateId = await entry(owner, 'private', '<p>x</p>', 'private');
    const waitingId = await entry(owner, 'waiting', '<p>x</p>', 'wait_for_open');
    const openId = await entry(owner, 'open', '<p>x</p>');
    for (const id of [privateId, waitingId]) {
      expect((await call(reader, 'GET', `/api/documents/${id}`)).statusCode).toBe(404);
    }
    expect((await call(reader, 'GET', `/api/documents/${openId}`)).statusCode).toBe(200);
    await call(owner, 'POST', `/api/documents/${openId}/access`, { action: 'revoke' });
    expect((await call(reader, 'GET', `/api/documents/${openId}`)).statusCode).toBe(404);
  });

  it('a reader can read but never write, comment or change sharing', async () => {
    const owner = await person();
    const reader = await person();
    const id = await entry(owner, 'look only', '<p>x</p>');
    const attempts = [
      ['PUT', `/api/documents/${id}/draft`, { title: 'x', body: '<p>x</p>' }, 'not_found'],
      ['POST', `/api/documents/${id}/submit`, { title: 'x', body: '<p>x</p>' }, 'not_found'],
      [
        'PUT',
        `/api/documents/${id}/comments/mine`,
        { body: '<p>x</p>', state: 'submitted' },
        'forbidden',
      ],
      ['POST', `/api/documents/${id}/access`, { action: 'revoke' }, 'forbidden'],
    ] as const;
    for (const [method, url, payload, expected] of attempts) {
      expect(code(await call(reader, method, url, payload)), url).toBe(expected);
    }
  });
});

describe('the 開放日記 list (spec §6.1)', () => {
  it('lists open entries for the month, mine included, with submitted-comment counts', async () => {
    const owner = await person();
    const me = await person();
    const theirs = await entry(owner, 'theirs', '<p>x</p>');
    const mine = await entry(me, 'mine', '<p>x</p>');
    const waiting = await entry(owner, 'waiting', '<p>x</p>', 'wait_for_open');
    await call(leader, 'PUT', `/api/documents/${theirs}/comments/mine`, {
      body: '<p>sent</p>',
      state: 'submitted',
    });
    await call(await person('COURSE_LEADER'), 'PUT', `/api/documents/${theirs}/comments/mine`, {
      body: '<p>draft</p>',
      state: 'draft',
    });

    const list = await openList(me);
    const ids = list.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining([theirs, mine]));
    expect(ids).not.toContain(waiting);
    expect(list.find((d) => d.id === theirs)).toMatchObject({
      title: 'theirs',
      author: { id: owner.id, username: owner.username },
      commentCount: 1,
    });
    expect(await openList(me, '2026-09')).toEqual([]);
  });

  it('is for diary keepers: anonymous callers get 401, SYS_ADMINs 403', async () => {
    expect((await call(null, 'GET', '/api/documents/open?month=2026-10')).statusCode).toBe(401);
    const admin = await signedInAdmin(t);
    expect((await call(admin, 'GET', '/api/documents/open?month=2026-10')).statusCode).toBe(403);
    expect((await call(leader, 'GET', '/api/documents/open?month=2026-10')).statusCode).toBe(200);
  });
});

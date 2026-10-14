/** The owner's diary (spec §5, §5.5, docs/ARCHITECTURE.md §8.3) against a real database. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  DAILY_LIMITS,
  ENTRY_LIMITS,
  ErrorBody,
  MeResponse,
  MyDocumentList,
  OwnDocument,
} from '@diary/shared';
import { activityEvents, alerts, comments, documents } from '../../src/db/schema.js';
import { EMPTY_PROFILE } from '../../src/services/profiles.js';
import { createUser } from '../../src/services/users.js';
import {
  as,
  createTestApp,
  DAY,
  HOUR,
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
async function writer(role: 'NORMAL_USER' | 'COURSE_LEADER' = 'NORMAL_USER') {
  const username = `w${++n}x${Date.now() % 10000}`;
  const user = await createUser(t.ctx, {
    username,
    password: TEST_PASSWORD,
    role,
    profile: EMPTY_PROFILE,
  });
  // Remembered device, because some tests move the clock forward by days.
  const signin = await login(t.app, username, TEST_PASSWORD, { remember: true });
  return { ...signin, id: user.id, username };
}

type Who = Pick<Signin, 'cookie' | 'csrf'>;
const create = (who: Who, body: Record<string, unknown> = {}) =>
  t.app.inject({ method: 'POST', url: '/api/documents', headers: as(who), payload: body });
const draft = (who: Who, id: string, title: string, body: string) =>
  t.app.inject({
    method: 'PUT',
    url: `/api/documents/${id}/draft`,
    headers: as(who),
    payload: { title, body },
  });
const submit = (who: Who, id: string, title: string, body: string) =>
  t.app.inject({
    method: 'POST',
    url: `/api/documents/${id}/submit`,
    headers: as(who),
    payload: { title, body },
  });
const read = (who: Who, id: string) =>
  t.app.inject({ method: 'GET', url: `/api/documents/${id}`, headers: as(who) });
const code = (res: { json: () => unknown }) => ErrorBody.parse(res.json());
const doc = (res: { json: () => unknown }) => OwnDocument.parse(res.json());
const png = (bytes: number) =>
  `<img src="data:image/png;base64,${Buffer.alloc(bytes, 1).toString('base64')}">`;

describe('lifecycle (spec §5.1, §5.2)', () => {
  it('create → 暫存 → 提交 → draft again → 更新, with what leaders would see at each step', async () => {
    const w = await writer();
    const created = doc(await create(w, { title: '晨起', body: '<p>初稿</p>' }));
    expect(created).toMatchObject({ state: 'draft', access: 'private', submitted: null });
    expect(created.draft).toMatchObject({ title: '晨起', body: '<p>初稿</p>' });

    const drafted = doc(await draft(w, created.id, '晨起靜坐', '<p>第二稿</p>'));
    expect(drafted.draft?.body).toBe('<p>第二稿</p>');

    const submitted = doc(await submit(w, created.id, '晨起靜坐', '<p>定稿</p>'));
    expect(submitted).toMatchObject({ state: 'submitted', draft: null });
    expect(submitted.submitted).toMatchObject({ title: '晨起靜坐', body: '<p>定稿</p>' });

    const pending = doc(await draft(w, created.id, '新標題', '<p>修改中</p>'));
    expect(pending.state).toBe('submitted_with_draft');
    // Leaders keep seeing the submitted version, title included, until 更新.
    expect(pending.submitted).toMatchObject({ title: '晨起靜坐', body: '<p>定稿</p>' });

    const updated = doc(await submit(w, created.id, '新標題', '<p>修改後</p>'));
    expect(updated).toMatchObject({ state: 'submitted', draft: null });
    expect(updated.submitted?.title).toBe('新標題');
  });

  it('a draft identical to the submitted version leaves nothing pending', async () => {
    const w = await writer();
    const { id } = doc(await create(w, { title: 't', body: '<p>x</p>' }));
    await submit(w, id, 't', '<p>x</p>');
    expect(doc(await draft(w, id, 't', '<p>x</p>')).state).toBe('submitted');
  });

  it('dates the entry by its creation day in Beijing, ignores any date sent, and never changes it', async () => {
    const w = await writer();
    // The test clock starts at 02:00 UTC = 10:00 in Beijing on 2026-10-14.
    const res = await create(w, { title: 'x', body: '', diaryDate: '2020-01-01' });
    const created = doc(res);
    expect(created.diaryDate).toBe('2026-10-14');
    t.clock.advance(3 * DAY);
    expect(doc(await submit(w, created.id, 'x', '<p>later</p>')).diaryDate).toBe('2026-10-14');
  });

  it('several entries can share a date', async () => {
    const w = await writer();
    const a = doc(await create(w, { title: 'a' }));
    const b = doc(await create(w, { title: 'b' }));
    expect(a.diaryDate).toBe(b.diaryDate);
    expect(a.id).not.toBe(b.id);
  });

  it('sanitises on the way in: what is stored and shown is safe', async () => {
    const w = await writer();
    const { id } = doc(await create(w, { title: 'x' }));
    const res = doc(await submit(w, id, 'x', '<p onclick="x()">ok</p><script>steal()</script>'));
    expect(res.submitted?.body).toBe('<p>ok</p>');
  });
});

describe('history versions (spec §5.2)', () => {
  it('keeps the newest 3 earlier versions, newest first', async () => {
    const w = await writer();
    const { id } = doc(await create(w, { title: 'v' }));
    for (const v of ['1', '2', '3', '4', '5']) await submit(w, id, 'v', `<p>v${v}</p>`);
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/documents/${id}/versions`,
      headers: as(w),
    });
    expect(
      res.json().versions.map((v: { versionNo: number; body: string }) => [v.versionNo, v.body]),
    ).toEqual([
      [4, '<p>v4</p>'],
      [3, '<p>v3</p>'],
      [2, '<p>v2</p>'],
    ]);
  });

  it('submitting exactly what is already submitted adds no version and counts nothing', async () => {
    const w = await writer();
    const { id } = doc(await create(w, { title: 'd' }));
    await submit(w, id, 'd', '<p>same</p>');
    await submit(w, id, 'd', '<p>same</p>');
    const versions = await t.app.inject({
      method: 'GET',
      url: `/api/documents/${id}/versions`,
      headers: as(w),
    });
    expect(versions.json().versions).toEqual([]);
    const events = await t.ctx.db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.userId, w.id));
    expect(events.filter((e) => e.kind === 'entry_updated')).toHaveLength(0);
  });
});

describe('privacy', () => {
  it('stores content, drafts and versions encrypted; equal texts give different ciphertexts', async () => {
    const w = await writer();
    const secret = '念佛時的秘密心事 SECRET-77';
    const a = doc(await create(w, { title: 'a', body: `<p>${secret}</p>` }));
    await submit(w, a.id, 'a', `<p>${secret}</p>`);
    await submit(w, a.id, 'a', `<p>${secret} v2</p>`);
    await draft(w, a.id, 'a', `<p>${secret} draft</p>`);
    const b = doc(await create(w, { title: 'b', body: `<p>${secret}</p>` }));
    const { rows } = await t.testDb.database.pool.query(
      `SELECT string_agg(row_to_json(d)::text, '') AS docs,
              (SELECT string_agg(row_to_json(v)::text, '') FROM document_versions v) AS versions
         FROM documents d`,
    );
    expect(rows[0].docs).not.toContain('SECRET-77');
    expect(rows[0].versions).not.toContain('SECRET-77');
    const [rowA, rowB] = await Promise.all(
      [a.id, b.id].map(
        async (id) => (await t.ctx.db.select().from(documents).where(eq(documents.id, id)))[0]!,
      ),
    );
    expect(rowA!.dekWrapped.equals(rowB!.dekWrapped)).toBe(false);
  });

  it('nobody but the owner can read an entry yet (leaders and readers arrive in slices 6 and 7)', async () => {
    const owner = await writer();
    const { id } = doc(await create(owner, { title: 'mine' }));
    await submit(owner, id, 'mine', '<p>x</p>');
    for (const other of [await writer(), await writer('COURSE_LEADER')]) {
      for (const res of [
        await read(other, id),
        await draft(other, id, 'hijack', '<p>x</p>'),
        await submit(other, id, 'hijack', '<p>x</p>'),
      ]) {
        expect(res.statusCode).toBe(404);
      }
    }
    expect(doc(await read(owner, id)).submitted?.title).toBe('mine');
  });

  it('SYS_ADMINs have no diary of their own and cannot use these endpoints', async () => {
    const admin = await signedInAdmin(t);
    expect((await create(admin, { title: 'x' })).statusCode).toBe(403);
  });
});

describe('per-entry limits (spec §5.5)', () => {
  it(`refuses 提交 over ${ENTRY_LIMITS.chars} characters, but the draft still saves`, async () => {
    const w = await writer();
    const { id } = doc(await create(w, { title: 'long' }));
    const tooLong = `<p>${'念'.repeat(ENTRY_LIMITS.chars + 1)}</p>`;
    expect(doc(await draft(w, id, 'long', tooLong)).draft?.body).toBe(tooLong);
    const res = await submit(w, id, 'long', tooLong);
    expect(res.statusCode).toBe(409);
    expect(code(res)).toMatchObject({ code: 'limit_reached', details: { limit: 'chars' } });
    // Exactly at the limit is fine; whitespace doesn't count.
    const atLimit = `<p>${'念 '.repeat(ENTRY_LIMITS.chars)}</p>`;
    expect((await submit(w, id, 'long', atLimit)).statusCode).toBe(200);
  });

  it(`refuses more than ${ENTRY_LIMITS.images} photos, in drafts too`, async () => {
    const w = await writer();
    const { id } = doc(await create(w, { title: 'p' }));
    expect((await draft(w, id, 'p', png(10) + png(10))).statusCode).toBe(200);
    const res = await draft(w, id, 'p', png(10) + png(10) + png(10));
    expect(code(res)).toMatchObject({ code: 'limit_reached', details: { limit: 'images' } });
  });

  it('refuses a photo over 1 MB (the editor shrinks them far below that)', async () => {
    const w = await writer();
    const { id } = doc(await create(w, { title: 'big' }));
    const res = await draft(w, id, 'big', png(ENTRY_LIMITS.imageBytes + 1));
    expect(res.statusCode).toBe(413);
    expect(code(res).code).toBe('too_large');
  });
});

describe('daily limits (spec §5.5)', () => {
  it(`allows ${DAILY_LIMITS.create} new entries a day, then explains when it resets; nothing is refunded`, async () => {
    const w = await writer();
    const ids: string[] = [];
    for (let i = 0; i < DAILY_LIMITS.create; i++)
      ids.push(doc(await create(w, { title: `e${i}` })).id);
    // A SYS_ADMIN deleting one gives nothing back.
    const admin = await signedInAdmin(t, { remember: true });
    await t.app.inject({
      method: 'DELETE',
      url: `/api/admin/documents/${ids[0]}`,
      headers: as(admin),
    });
    const refused = await create(w, { title: 'one too many' });
    expect(refused.statusCode).toBe(409);
    // Next midnight in Beijing: 2026-10-14 16:00 UTC from wherever the clock is today.
    const { details } = code(refused);
    expect(details?.limit).toBe('create');
    expect(new Date(String(details?.resetsAt)).getUTCHours()).toBe(16);
    t.clock.advance(DAY);
    expect((await create(w, { title: 'tomorrow' })).statusCode).toBe(201);
  });

  it('counts atomically: many simultaneous creates never exceed the limit', async () => {
    const w = await writer();
    const results = await Promise.all(
      Array.from({ length: DAILY_LIMITS.create + 8 }, () => create(w, { title: 'rush' })),
    );
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(DAILY_LIMITS.create);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(8);
  });

  it(`allows ${DAILY_LIMITS.update} updates a day; a refused one keeps the submitted text and flags the account`, async () => {
    const w = await writer();
    const { id } = doc(await create(w, { title: 'u' }));
    await submit(w, id, 'u', '<p>0</p>');
    for (let i = 1; i <= DAILY_LIMITS.update; i++) {
      expect((await submit(w, id, 'u', `<p>${i}</p>`)).statusCode, `update ${i}`).toBe(200);
    }
    const refused = await submit(w, id, 'u', '<p>one more</p>');
    expect(code(refused)).toMatchObject({ code: 'limit_reached', details: { limit: 'update' } });
    expect(doc(await read(w, id)).submitted?.body).toBe(`<p>${DAILY_LIMITS.update}</p>`);
    const flags = await t.ctx.db.select().from(alerts).where(eq(alerts.userId, w.id));
    expect(flags.map((a) => a.rule)).toEqual(['limit_reached']);
    const [event] = await t.ctx.db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.userId, w.id), eq(activityEvents.kind, 'limit_reached')));
    expect(event!.detail).toEqual({ limit: 'update' });
  });
});

describe('my month list (spec §6.1)', () => {
  it('lists my entries for a Beijing month, newest first, with the newest title and comment counts', async () => {
    const w = await writer();
    const old = doc(await create(w, { title: 'September' }));
    await t.ctx.db
      .update(documents)
      .set({ diaryDate: '2026-09-30' })
      .where(eq(documents.id, old.id));
    const first = doc(await create(w, { title: 'first' }));
    await submit(w, first.id, 'first', '<p>a</p>');
    await draft(w, first.id, 'first, renamed', '<p>b</p>');
    t.clock.advance(HOUR);
    const second = doc(await create(w, { title: 'second' }));
    // Two submitted comments, one already seen by the owner; plus a leader's unseen draft, which doesn't count.
    const now = t.clock.now();
    const leaderIds = await Promise.all(
      [1, 2, 3].map(async () => (await writer('COURSE_LEADER')).id),
    );
    await t.ctx.db.insert(comments).values(
      leaderIds.map((authorId, i) => ({
        id: crypto.randomUUID(),
        documentId: first.id,
        authorId,
        bodyCt: Buffer.from('x'),
        bodyNonce: Buffer.alloc(12),
        state: i < 2 ? ('submitted' as const) : ('draft' as const),
        submittedAt: i < 2 ? now : null,
        seenByOwnerAt: i === 0 ? now : null,
        createdAt: now,
        updatedAt: now,
      })),
    );
    const list = MyDocumentList.parse(
      (
        await t.app.inject({
          method: 'GET',
          url: '/api/documents/mine?month=2026-10',
          headers: as(w),
        })
      ).json(),
    );
    expect(
      list.documents.map((d) => [d.title, d.state, d.commentCount, d.hasUnseenComment]),
    ).toEqual(
      expect.arrayContaining([
        ['first, renamed', 'submitted_with_draft', 2, true],
        ['second', 'draft', 0, false],
      ]),
    );
    expect(list.documents.map((d) => d.id)).not.toContain(old.id);
    expect(list.documents.find((d) => d.id === second.id)).toBeDefined();
  });
});

describe('activity and storage', () => {
  it('records entry_created / submitted / updated, with no content in the events', async () => {
    const w = await writer();
    const { id } = doc(await create(w, { title: 'act', body: '<p>PRIVATE-TEXT-9</p>' }));
    await submit(w, id, 'act', '<p>PRIVATE-TEXT-9</p>');
    await submit(w, id, 'act', '<p>PRIVATE-TEXT-9 v2</p>');
    const events = await t.ctx.db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.userId, w.id));
    expect(events.map((e) => e.kind).filter((k) => k.startsWith('entry'))).toEqual([
      'entry_created',
      'entry_submitted',
      'entry_updated',
    ]);
    expect(JSON.stringify(events)).not.toContain('PRIVATE-TEXT-9');
    expect(JSON.stringify(events)).not.toContain('act');
  });

  it('counts entries, drafts and versions in storage used', async () => {
    const w = await writer();
    const before = MeResponse.parse(
      (await t.app.inject({ method: 'GET', url: '/api/me', headers: as(w) })).json(),
    ).user.storageBytes;
    const { id } = doc(await create(w, { title: 's', body: png(50_000) }));
    await submit(w, id, 's', png(50_000));
    const after = MeResponse.parse(
      (await t.app.inject({ method: 'GET', url: '/api/me', headers: as(w) })).json(),
    ).user.storageBytes;
    expect(after - before).toBeGreaterThan(50_000);
  });
});

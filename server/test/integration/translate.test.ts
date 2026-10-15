/**
 * The translate endpoint (spec §8): only text the caller may read, as plain text, with clear failures and a
 * per-user cap. The provider is faked.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ErrorBody, TRANSLATE_LIMITS } from '@diary/shared';
import { readAudit } from '../../src/db/schema.js';
import { EMPTY_PROFILE } from '../../src/services/profiles.js';
import { FakeTranslator, TranslationError } from '../../src/services/translator.js';
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

const fake = new FakeTranslator();
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ translator: fake });
});
afterAll(async () => {
  await t?.close();
});

let n = 0;
async function person(role: 'NORMAL_USER' | 'COURSE_LEADER' = 'NORMAL_USER') {
  const username = `tr${++n}x${Date.now() % 10000}`;
  await createUser(t.ctx, { username, password: TEST_PASSWORD, role, profile: EMPTY_PROFILE });
  return login(t.app, username, TEST_PASSWORD);
}
type Who = Pick<Signin, 'cookie' | 'csrf'>;

const call = (who: Who | null, method: 'POST' | 'PUT' | 'GET', url: string, payload?: object) =>
  t.app.inject({ method, url, headers: who ? as(who) : {}, ...(payload ? { payload } : {}) });
const translate = (who: Who | null, target: object, direction = 'zh_to_en') =>
  call(who, 'POST', '/api/translate', { ...target, direction });
const code = (res: { json: () => unknown }) => ErrorBody.parse(res.json()).code;
/** The text the provider received for this request, or null when it wasn't called. */
async function sent(who: Who | null, target: object): Promise<string | null> {
  const before = fake.requests.length;
  const res = await translate(who, target);
  if (res.statusCode !== 200) return `HTTP ${res.statusCode}`;
  return fake.requests.length > before ? (fake.requests.at(-1)?.text ?? null) : null;
}

let owner: Signin;
let leader: Signin;
let docId: string;
beforeAll(async () => {
  owner = await person();
  leader = await person('COURSE_LEADER');
  const res = await call(owner, 'POST', '/api/documents', { title: 't', body: '' });
  docId = res.json().id;
  await call(owner, 'POST', `/api/documents/${docId}/submit`, {
    title: 't',
    body: '<p>已提交<b>的</b>內容</p><p>第二段</p>',
  });
  await call(owner, 'PUT', `/api/documents/${docId}/draft`, { title: 't', body: '<p>草稿</p>' });
});

describe('what each reader gets translated (spec §8)', () => {
  it('the owner: their newest version; a leader: the submitted version, as plain text', async () => {
    expect(await sent(owner, { documentId: docId })).toBe('草稿');
    const auditsBefore = (
      await t.ctx.db.select().from(readAudit).where(eq(readAudit.documentId, docId))
    ).length;
    expect(await sent(leader, { documentId: docId })).toBe('已提交的內容\n第二段');
    // Translating isn't reading: no audit row, nothing marked seen.
    const auditsAfter = await t.ctx.db
      .select()
      .from(readAudit)
      .where(eq(readAudit.documentId, docId));
    expect(auditsAfter).toHaveLength(auditsBefore);
  });

  it('another user only once the entry is open; never a SYS_ADMIN', async () => {
    const other = await person();
    expect(await sent(other, { documentId: docId })).toBe('HTTP 404');
    await call(owner, 'POST', `/api/documents/${docId}/access`, { action: 'request' });
    await call(leader, 'POST', `/api/documents/${docId}/access`, { action: 'approve' });
    expect(await sent(other, { documentId: docId })).toBe('已提交的內容\n第二段');
    expect(await sent(await signedInAdmin(t), { documentId: docId })).toBe('HTTP 403');
    expect(await sent(null, { documentId: docId })).toBe('HTTP 401');
  });

  it('comments: submitted ones for anyone who can read the entry; a draft only for its author', async () => {
    const other = await person('COURSE_LEADER');
    const submitted = await call(leader, 'PUT', `/api/documents/${docId}/comments/mine`, {
      body: '<p>寫得好</p>',
      state: 'submitted',
    });
    expect(submitted.statusCode).toBe(200);
    await call(other, 'PUT', `/api/documents/${docId}/comments/mine`, {
      body: '<p>還在想</p>',
      state: 'draft',
    });
    const comments = await t.testDb.database.pool.query<{ id: string; state: string }>(
      'SELECT id, state::text FROM comments WHERE document_id = $1',
      [docId],
    );
    const idOf = (state: string) => comments.rows.find((c) => c.state === state)!.id;
    expect(await sent(owner, { commentId: idOf('submitted') })).toBe('寫得好');
    expect(await sent(owner, { commentId: idOf('draft') })).toBe('HTTP 404');
    expect(await sent(other, { commentId: idOf('draft') })).toBe('還在想');
  });

  it('never sends images or markup, and sends nothing for an empty entry', async () => {
    const png = `<img src="data:image/png;base64,${Buffer.alloc(30, 1).toString('base64')}">`;
    const res = await call(owner, 'POST', '/api/documents', {
      title: 'pic',
      body: `<p>看${png}圖</p>`,
    });
    expect(await sent(owner, { documentId: res.json().id })).toBe('看圖');
    const empty = await call(owner, 'POST', '/api/documents', { title: 'empty', body: '' });
    expect((await translate(owner, { documentId: empty.json().id })).json()).toEqual({ text: '' });
  });
});

describe('failures and limits', () => {
  it('a slow provider is a 504, a broken one a 502; the next request works again', async () => {
    try {
      fake.failWith = new TranslationError('timeout');
      expect(code(await translate(owner, { documentId: docId }))).toBe('translation_timeout');
      expect((await translate(owner, { documentId: docId })).statusCode).toBe(504);
      fake.failWith = new TranslationError('failed');
      expect(code(await translate(owner, { documentId: docId }))).toBe('translation_failed');
    } finally {
      fake.failWith = null;
    }
    expect((await translate(owner, { documentId: docId }, 'en_to_zh')).json()).toEqual({
      text: '[en_to_zh] 草稿',
    });
  });

  it(`allows ${TRANSLATE_LIMITS.perUserPerHour} per user per hour, then 429; others are unaffected`, async () => {
    const busy = await person();
    const res = await call(busy, 'POST', '/api/documents', { title: 'x', body: '<p>x</p>' });
    const target = { documentId: res.json().id };
    for (let i = 0; i < TRANSLATE_LIMITS.perUserPerHour; i++) await translate(busy, target);
    expect(code(await translate(busy, target))).toBe('rate_limited');
    expect((await translate(owner, { documentId: docId })).statusCode).toBe(200);
    t.clock.advance(60 * 60 * 1000 + 1);
    expect((await translate(busy, target)).statusCode).toBe(200);
  });

  it('refuses a text too long to translate without calling the provider', async () => {
    const res = await call(owner, 'POST', '/api/documents', {
      title: 'long',
      body: `<p>${'念'.repeat(TRANSLATE_LIMITS.maxChars + 1)}</p>`,
    });
    const before = fake.requests.length;
    expect(code(await translate(owner, { documentId: res.json().id }))).toBe('too_large');
    expect(fake.requests).toHaveLength(before);
  });

  it('never logs the text', () => {
    const logs = t.logs.join('\n');
    for (const text of ['草稿', '已提交', '寫得好', '還在想']) expect(logs).not.toContain(text);
  });
});

describe('without a provider configured', () => {
  it('answers 503 translation_unavailable, and /api/me says translation is off', async () => {
    const plain = await createTestApp();
    try {
      await createUser(plain.ctx, {
        username: 'nobody1',
        password: TEST_PASSWORD,
        role: 'NORMAL_USER',
        profile: EMPTY_PROFILE,
      });
      const who = await login(plain.app, 'nobody1');
      const res = await plain.app.inject({
        method: 'POST',
        url: '/api/translate',
        headers: as(who),
        payload: { documentId: crypto.randomUUID(), direction: 'zh_to_en' },
      });
      expect(ErrorBody.parse(res.json()).code).toBe('translation_unavailable');
      // The app greys out the translate buttons from this.
      const me = await plain.app.inject({ method: 'GET', url: '/api/me', headers: as(who) });
      expect(me.json().features).toEqual({ translation: false });
      const configured = await t.app.inject({ method: 'GET', url: '/api/me', headers: as(owner) });
      expect(configured.json().features).toEqual({ translation: true });
    } finally {
      await plain.close();
    }
  });
});

/**
 * The SYS_ADMIN guarantee (spec §2, engineering standards §12.4): no endpoint a SYS_ADMIN can call ever returns
 * diary content, drafts, history or comments. Endpoints are discovered from the API's own OpenAPI document, so
 * a new admin endpoint is covered automatically without anyone remembering to add it here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_DOCS_PATH } from '../../src/app.js';
import { saveMyComment } from '../../src/services/diary/comments.js';
import { createDocument, saveDraft, submitDocument } from '../../src/services/diary/documents.js';
import { EMPTY_PROFILE } from '../../src/services/profiles.js';
import { createUser } from '../../src/services/users.js';
import {
  as,
  createTestApp,
  login,
  signedInAdmin,
  TEST_PASSWORD,
  type TestApp,
} from '../helpers/app.js';

const MARKERS = {
  content: 'MARKER-CONTENT-4f1c',
  version: 'MARKER-VERSION-8a2e',
  draft: 'MARKER-DRAFT-c9d3',
  comment: 'MARKER-COMMENT-27b6',
};

let t: TestApp;
let ownerId: string;
let documentId: string;
let leaderId: string;

beforeAll(async () => {
  t = await createTestApp();
  const owner = await createUser(t.ctx, {
    username: 'np_owner',
    password: TEST_PASSWORD,
    role: 'NORMAL_USER',
    profile: EMPTY_PROFILE,
  });
  const leader = await createUser(t.ctx, {
    username: 'np_leader',
    password: TEST_PASSWORD,
    role: 'COURSE_LEADER',
    profile: EMPTY_PROFILE,
  });
  ownerId = owner.id;
  leaderId = leader.id;
  const { document } = await createDocument(t.ctx, ownerId, { title: 'plain title', body: '' });
  documentId = document.id;
  await submitDocument(t.ctx, ownerId, documentId, {
    title: 'plain title',
    body: `<p>${MARKERS.version}</p>`,
  });
  await submitDocument(t.ctx, ownerId, documentId, {
    title: 'plain title',
    body: `<p>${MARKERS.content}</p>`,
  });
  await saveDraft(t.ctx, ownerId, documentId, {
    title: 'plain title',
    body: `<p>${MARKERS.draft}</p>`,
  });
  await saveMyComment(t.ctx, leader, documentId, {
    body: `<p>${MARKERS.comment}</p>`,
    state: 'submitted',
  });
});
afterAll(async () => {
  await t?.close();
});

interface Operation {
  parameters?: { in: string; name: string }[];
}

describe('SYS_ADMIN never receives diary text', () => {
  it('positive control: the owner does see the content, draft and comment', async () => {
    const owner = await login(t.app, 'np_owner');
    const body = (
      await t.app.inject({ method: 'GET', url: `/api/documents/${documentId}`, headers: as(owner) })
    ).body;
    expect(body).toContain(MARKERS.content);
    expect(body).toContain(MARKERS.draft);
    expect(body).toContain(MARKERS.comment);
  });

  it('from any GET endpoint in the API, with real IDs filled in', async () => {
    const admin = await signedInAdmin(t);
    const spec = (await t.app.inject({ method: 'GET', url: `${API_DOCS_PATH}/json` })).json() as {
      paths: Record<string, Record<string, Operation>>;
    };

    // Every ID an admin might pass: the owner, the leader, the entry and the admin themself.
    const ids = [ownerId, leaderId, documentId, admin.id];
    const queries = ['', `?userId=${ownerId}`, `?username=np_owner`, '?status=all', '?size=100'];
    const urls = new Set<string>();
    for (const [path, methods] of Object.entries(spec.paths)) {
      if (!methods.get || path.startsWith(API_DOCS_PATH)) continue;
      const template = path.replace(/\{(\w+)\}/g, ':$1');
      const variants = template.includes(':')
        ? ids.map((id) => template.replace(/:\w+/g, id))
        : [template];
      for (const url of variants) for (const q of queries) urls.add(url + q);
    }

    let adminEndpointsAnswered = 0;
    for (const url of urls) {
      const res = await t.app.inject({ method: 'GET', url, headers: as(admin) });
      if (url.startsWith('/api/admin') && res.statusCode === 200) adminEndpointsAnswered++;
      for (const marker of Object.values(MARKERS)) {
        expect(res.body, `${url} (${res.statusCode}) leaked ${marker}`).not.toContain(marker);
      }
    }
    // Guard against a vacuous pass: the admin endpoints really were exercised.
    expect(adminEndpointsAnswered).toBeGreaterThanOrEqual(10);
  });

  it('document management shows the title and metadata only', async () => {
    const admin = await signedInAdmin(t);
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/admin/documents?username=np_owner',
      headers: as(admin),
    });
    const [entry] = res.json().documents;
    expect(entry).toMatchObject({
      id: documentId,
      title: 'plain title',
      state: 'submitted_with_draft',
    });
    expect(Object.keys(entry).sort()).toEqual(
      [
        'access',
        'createdAt',
        'diaryDate',
        'id',
        'ownerId',
        'ownerUsername',
        'state',
        'title',
        'updatedAt',
      ].sort(),
    );
  });

  it('and nothing secret was ever logged', () => {
    const logs = t.logs.join('\n');
    for (const marker of Object.values(MARKERS)) expect(logs).not.toContain(marker);
  });
});

describe('SYS_ADMIN document management', () => {
  it('deletes an entry immediately, with its versions and comments', async () => {
    const admin = await signedInAdmin(t);
    const { document } = await createDocument(t.ctx, ownerId, { title: 'to delete', body: '' });
    await submitDocument(t.ctx, ownerId, document.id, { title: 'to delete', body: '<p>1</p>' });
    await submitDocument(t.ctx, ownerId, document.id, { title: 'to delete', body: '<p>2</p>' });
    await saveMyComment(t.ctx, { id: leaderId, role: 'COURSE_LEADER' }, document.id, {
      body: '<p>c</p>',
      state: 'submitted',
    });
    const res = await t.app.inject({
      method: 'DELETE',
      url: `/api/admin/documents/${document.id}`,
      headers: as(admin),
    });
    expect(res.statusCode).toBe(200);
    const { rows } = await t.testDb.database.pool.query(
      `SELECT (SELECT count(*) FROM documents WHERE id = $1)::int AS d,
              (SELECT count(*) FROM document_versions WHERE document_id = $1)::int AS v,
              (SELECT count(*) FROM comments WHERE document_id = $1)::int AS c`,
      [document.id],
    );
    expect(rows[0]).toEqual({ d: 0, v: 0, c: 0 });
  });

  it('is closed to everyone else', async () => {
    const owner = await login(t.app, 'np_owner');
    for (const res of [
      await t.app.inject({ method: 'GET', url: '/api/admin/documents', headers: as(owner) }),
      await t.app.inject({
        method: 'DELETE',
        url: `/api/admin/documents/${documentId}`,
        headers: as(owner),
      }),
    ]) {
      expect(res.statusCode).toBe(403);
    }
  });
});

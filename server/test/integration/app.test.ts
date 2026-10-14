import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ErrorBody, ReadyBody, REQUEST_ID_HEADER } from '@diary/shared';
import { API_DOCS_PATH, buildApp, BODY_LIMIT_BYTES } from '../../src/app.js';
import { createDatabase } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { loadConfig } from '../../src/config.js';
import { createTestDatabase, type TestDatabase } from '../helpers/database.js';

const migrationsDir = loadConfig({
  DATABASE_URL: 'postgres://unused',
  DIARY_KEYRING: `v1:${'1'.repeat(64)}`,
  PROFILE_KEYRING: `v1:${'2'.repeat(64)}`,
  SESSION_SECRET: '3'.repeat(64),
  CRON_SECRET: '4'.repeat(32),
}).migrationsDir;

/** Collects every log line the app writes, to check what does and doesn't get logged. */
function captureLogs() {
  const lines: string[] = [];
  return { lines, stream: { write: (line: string) => void lines.push(line) } };
}

describe('server skeleton', () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  const logs = captureLogs();

  beforeAll(async () => {
    testDb = await createTestDatabase();
    app = await buildApp({
      config: { logLevel: 'info', migrationsDir, apiDocs: true },
      database: testDb.database,
      logStream: logs.stream,
    });
    // Test-only routes, registered before the app is ready.
    app.get('/test/boom', async () => {
      throw new Error('secret internal detail');
    });
    app.post('/test/echo', async (request) => {
      request.log.info({ password: 'hunter2', content: 'my private diary' }, 'handler log');
      return { ok: true };
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await testDb?.drop();
  });

  describe('readiness', () => {
    it('reports not ready before migrations have run', async () => {
      const res = await app.inject({ method: 'GET', url: '/readyz' });
      expect(res.statusCode).toBe(503);
      expect(ReadyBody.parse(res.json())).toEqual({
        status: 'not_ready',
        checks: { database: true, migrations: false },
      });
    });

    it('reports ready once migrations are applied from an empty database', async () => {
      await runMigrations(testDb.database, migrationsDir);
      const res = await app.inject({ method: 'GET', url: '/readyz' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ready', checks: { database: true, migrations: true } });
    });

    it('applying migrations twice is a no-op', async () => {
      await expect(runMigrations(testDb.database, migrationsDir)).resolves.toBeUndefined();
    });

    it('reports the database as down when it cannot be reached', async () => {
      const unreachable = createDatabase('postgres://nobody:nothing@127.0.0.1:1/none');
      const downApp = await buildApp({
        config: { logLevel: 'fatal', migrationsDir, apiDocs: false },
        database: unreachable,
      });
      try {
        const res = await downApp.inject({ method: 'GET', url: '/readyz' });
        expect(res.statusCode).toBe(503);
        expect(res.json()).toEqual({
          status: 'not_ready',
          checks: { database: false, migrations: false },
        });
      } finally {
        await downApp.close();
        await unreachable.close();
      }
    });
  });

  it('GET /healthz answers without touching the database', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  describe('errors', () => {
    it('unknown routes return the standard error shape with the request ID', async () => {
      const res = await app.inject({ method: 'GET', url: '/nope' });
      expect(res.statusCode).toBe(404);
      const body = ErrorBody.parse(res.json());
      expect(body.code).toBe('not_found');
      expect(body.requestId).toBe(res.headers[REQUEST_ID_HEADER]);
    });

    it('internal errors hide details from the client but log them', async () => {
      const res = await app.inject({ method: 'GET', url: '/test/boom' });
      expect(res.statusCode).toBe(500);
      const body = ErrorBody.parse(res.json());
      expect(body).toEqual({
        code: 'internal_error',
        message: 'Internal error',
        requestId: res.headers[REQUEST_ID_HEADER],
      });
      expect(res.body).not.toContain('secret internal detail');
      expect(res.body).not.toContain('at ');
      const logged = logs.lines.find(
        (line) => line.includes(body.requestId) && line.includes('"err"'),
      );
      expect(logged).toContain('secret internal detail');
    });

    it('oversized bodies are rejected with payload_too_large', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/test/echo',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ blob: 'x'.repeat(BODY_LIMIT_BYTES + 1) }),
      });
      expect(res.statusCode).toBe(413);
      expect(res.json().code).toBe('payload_too_large');
    });
  });

  describe('request IDs', () => {
    it('ignores a client-supplied request ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { [REQUEST_ID_HEADER]: 'forged-id' },
      });
      expect(res.headers[REQUEST_ID_HEADER]).not.toBe('forged-id');
      expect(res.headers[REQUEST_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('logging', () => {
    it('redacts secrets and diary content that a handler logs, and never logs bodies or cookies', async () => {
      await app.inject({
        method: 'POST',
        url: '/test/echo',
        headers: { cookie: 'session=abc123secret', authorization: 'Bearer tok3n' },
        payload: { password: 'hunter2', content: 'my private diary' },
      });
      const all = logs.lines.join('\n');
      expect(all).toContain('handler log');
      expect(all).not.toContain('hunter2');
      expect(all).not.toContain('my private diary');
      expect(all).not.toContain('abc123secret');
      expect(all).not.toContain('tok3n');
    });
  });

  describe('API explorer', () => {
    it('publishes an OpenAPI document generated from the route schemas', async () => {
      const res = await app.inject({ method: 'GET', url: `${API_DOCS_PATH}/json` });
      expect(res.statusCode).toBe(200);
      const spec = res.json();
      expect(spec.openapi).toMatch(/^3\./);
      expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/healthz', '/readyz']));
      expect(spec.paths['/readyz'].get.responses).toHaveProperty('503');
      // Test-only routes have no schema but still appear; real routes must always declare one.
      expect(
        spec.paths['/healthz'].get.responses['200'].content['application/json'].schema,
      ).toBeDefined();
    });

    it('serves the explorer page itself from bundled assets', async () => {
      const res = await app.inject({ method: 'GET', url: `${API_DOCS_PATH}/` });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).not.toMatch(/https?:\/\/(cdn|unpkg|cdnjs)/);
    });

    it('is absent when API_DOCS is off (production default)', async () => {
      const unused = createDatabase('postgres://nobody:nothing@127.0.0.1:1/none');
      const prodApp = await buildApp({
        config: { logLevel: 'fatal', migrationsDir, apiDocs: false },
        database: unused,
      });
      try {
        for (const url of [API_DOCS_PATH, `${API_DOCS_PATH}/`, `${API_DOCS_PATH}/json`]) {
          expect((await prodApp.inject({ method: 'GET', url })).statusCode).toBe(404);
        }
      } finally {
        await prodApp.close();
        await unused.close();
      }
    });
  });
});

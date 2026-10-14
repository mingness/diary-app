/**
 * `GET /healthz`: the process is up (no dependencies checked).
 * `GET /readyz`: the database answers and has every migration this build ships with. Deploys wait on this.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { HealthBody, ReadyBody } from '@diary/shared';
import { migrationsAreCurrent } from '../db/migrate.js';

const DB_CHECK_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref()),
  ]);
}

export function healthRoutes(app: FastifyInstance, deps: { pool: pg.Pool; migrationsDir: string }) {
  const routes = app.withTypeProvider<ZodTypeProvider>();

  routes.get(
    '/healthz',
    {
      schema: {
        tags: ['health'],
        summary: 'The process is up',
        response: { 200: HealthBody },
      },
    },
    async () => ({ status: 'ok' as const }),
  );

  routes.get(
    '/readyz',
    {
      schema: {
        tags: ['health'],
        summary: 'The database answers and every migration in this build has been applied',
        response: { 200: ReadyBody, 503: ReadyBody },
      },
    },
    async (request, reply) => {
      let database = false;
      let migrations = false;
      try {
        await withTimeout(deps.pool.query('SELECT 1'), DB_CHECK_TIMEOUT_MS);
        database = true;
        migrations = await withTimeout(
          migrationsAreCurrent(deps.pool, deps.migrationsDir),
          DB_CHECK_TIMEOUT_MS,
        );
      } catch (err) {
        request.log.warn({ err }, 'readiness check failed');
      }
      const ready = database && migrations;
      return reply
        .code(ready ? 200 : 503)
        .send({ status: ready ? 'ready' : 'not_ready', checks: { database, migrations } });
    },
  );
}

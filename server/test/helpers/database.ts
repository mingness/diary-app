/**
 * Gives each integration test file its own empty database on the test Postgres server
 * (`npm run db:up` locally, a service container in CI). Migrations are applied from scratch, as §12.5 asks.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDatabase, type Database } from '../../src/db/client.js';

export interface TestDatabase {
  readonly url: string;
  readonly database: Database;
  drop(): Promise<void>;
}

function adminUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Run `npm run db:up` and use the value from .env.example.',
    );
  }
  return url;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const admin = new pg.Client({ connectionString: adminUrl() });
  await admin.connect();
  const name = `test_${randomBytes(6).toString('hex')}`;
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const url = new URL(adminUrl());
  url.pathname = `/${name}`;
  const database = createDatabase(url.toString());

  return {
    url: url.toString(),
    database,
    async drop() {
      await database.close();
      const cleanup = new pg.Client({ connectionString: adminUrl() });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await cleanup.end();
    },
  };
}

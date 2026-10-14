/** PostgreSQL connection pool and the Drizzle instance on top of it. */
import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

export interface Database {
  readonly pool: pg.Pool;
  readonly db: Db;
  close(): Promise<void>;
}

export function createDatabase(databaseUrl: string): Database {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
  });
  // An idle client erroring (e.g. the DB restarted) must not crash the process; the next query reconnects.
  pool.on('error', () => {});
  return { pool, db: drizzle(pool, { schema }), close: () => pool.end() };
}

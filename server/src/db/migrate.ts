/**
 * Versioned migrations (engineering standards §12.6). Applied automatically at startup; `/readyz` reports
 * whether the database has every migration that ships with this build.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client.js';

interface Journal {
  entries: { tag: string }[];
}

async function shippedMigrationCount(migrationsDir: string): Promise<number> {
  const raw = await readFile(path.join(migrationsDir, 'meta', '_journal.json'), 'utf8');
  return (JSON.parse(raw) as Journal).entries.length;
}

/** Applies every pending migration. Drizzle runs them in a transaction and records them in drizzle.__drizzle_migrations. */
export async function runMigrations(database: Database, migrationsDir: string): Promise<void> {
  await migrate(database.db, { migrationsFolder: migrationsDir });
}

/** True when the database has exactly the migrations this build ships with. */
export async function migrationsAreCurrent(pool: pg.Pool, migrationsDir: string): Promise<boolean> {
  const shipped = await shippedMigrationCount(migrationsDir);
  const { rows } = await pool.query<{ applied: string | null }>(
    `SELECT CASE WHEN to_regclass('drizzle.__drizzle_migrations') IS NULL THEN NULL
            ELSE (SELECT count(*)::text FROM drizzle.__drizzle_migrations) END AS applied`,
  );
  // No bookkeeping table means migrations never ran, even if this build ships none.
  if (rows[0]?.applied == null) return false;
  return Number(rows[0].applied) === shipped;
}

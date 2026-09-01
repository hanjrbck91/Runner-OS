/**
 * Database client + migration application.
 *
 * Tests use pglite (real Postgres in-process; no server). Production (M07-D)
 * builds the same Drizzle db over node-postgres/Neon and applies the same
 * migration SQL. Repositories depend only on the Drizzle `Db`, so they are
 * driver-portable.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Db = ReturnType<typeof drizzle>;

/** Read the authoritative migration DDL (single source: migrations/0001_init.sql). */
export function loadInitSql(): string {
  const url = new URL('../../../migrations/0001_init.sql', import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf8');
}

/** Read the Auth.js tables migration (migrations/0002_auth.sql). */
export function loadAuthSql(): string {
  const url = new URL('../../../migrations/0002_auth.sql', import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf8');
}

/**
 * Create a fresh in-process Postgres (pglite) with migrations applied.
 * @param opts.withAuth also apply 0002_auth.sql (Auth.js tables).
 */
export async function createTestDatabase(opts?: { withAuth?: boolean }): Promise<{ db: Db; client: PGlite }> {
  const client = new PGlite();
  await client.exec(loadInitSql()); // multi-statement DDL incl. plpgsql triggers
  if (opts?.withAuth) await client.exec(loadAuthSql());
  const db = drizzle(client);
  return { db, client };
}

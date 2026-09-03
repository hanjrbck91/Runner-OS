/**
 * Production dependency wiring for route handlers. Builds the API `Env` from
 * environment configuration: a node-postgres/Neon pool -> Drizzle -> the
 * @runner-os/database Postgres adapters -> core services.
 *
 * Route handlers depend on the framework-free `Env`; this file is the only
 * place that touches the concrete driver. Not typechecked/tested in M07-D
 * (needs `pg` + a live DATABASE_URL); the repo Db type is finalized when the
 * production client lands with a real Neon connection.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { createPgDependencies, getOrCreateUserByEmail } from '@runner-os/database';
import type { Env } from './server/handlers.js';

let pool: Pool | undefined;
let cachedDb: ReturnType<typeof drizzle> | undefined;
let cached: Env | undefined;

/** Lazily construct one node-postgres pool + Drizzle db (no connection until a query). */
export function getAuthDb(): ReturnType<typeof drizzle> {
  if (cachedDb) return cachedDb;
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  cachedDb = drizzle(pool);
  return cachedDb;
}

export function getEnv(): Env {
  if (cached) return cached;
  const allowedEmail = process.env.AUTH_ALLOWED_EMAIL;
  if (!allowedEmail) throw new Error('AUTH_ALLOWED_EMAIL is not configured');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');

  const tz = process.env.USER_TIMEZONE ?? 'Asia/Kolkata';
  const rawDb = getAuthDb();
  const db = rawDb as unknown as Parameters<typeof createPgDependencies>[0];
  const deps = createPgDependencies(db, { timezone: tz });

  cached = {
    deps,
    allowedEmail,
    getUserId: (email: string) => getOrCreateUserByEmail(db, email),
    // Run a unit of work in ONE Postgres transaction (used by plan-import commit
    // for atomic all-or-nothing writes).
    withTransaction: <T>(fn: (d: typeof deps) => Promise<T>): Promise<T> =>
      rawDb.transaction((tx) => fn(createPgDependencies(tx as unknown as Parameters<typeof createPgDependencies>[0], { timezone: tz }))),
  };
  return cached;
}

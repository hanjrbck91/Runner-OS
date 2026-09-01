import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { createTestDatabase, type Db } from '@runner-os/database';
import { authSchema } from '../src/auth-schema.js';

/**
 * Verifies Auth.js persistence against REAL Postgres (pglite) via the Drizzle
 * adapter over the 0002_auth.sql tables. Proves magic-link storage works
 * without SMTP/Vercel: verification tokens + users persist and read back.
 */
let db: Db;
let adapter: ReturnType<typeof DrizzleAdapter>;

beforeEach(async () => {
  const t = await createTestDatabase({ withAuth: true });
  db = t.db;
  adapter = DrizzleAdapter(db, authSchema);
});

describe('M07-F — Auth.js Drizzle adapter persistence', () => {
  it('0002 auth tables exist alongside the domain schema', async () => {
    const r = (await db.execute(sql`select table_name from information_schema.tables where table_schema='public' and table_name like 'auth_%' order by table_name`)) as unknown as { rows: { table_name: string }[] };
    expect(r.rows.map((x) => x.table_name)).toEqual(['auth_account', 'auth_session', 'auth_user', 'auth_verification_token']);
    // domain triggers/indexes from 0001 still present
    const d = (await db.execute(sql`select indexname from pg_indexes where indexname='uq_daily_active'`)) as unknown as { rows: unknown[] };
    expect(d.rows.length).toBe(1);
  });

  it('verification token: create -> use (single-use), and consumed', async () => {
    const expires = new Date(Date.now() + 60_000);
    await adapter.createVerificationToken!({ identifier: 'runner@os.local', token: 'tok-123', expires });
    const used = await adapter.useVerificationToken!({ identifier: 'runner@os.local', token: 'tok-123' });
    expect(used?.identifier).toBe('runner@os.local');
    // second use returns null (already consumed)
    const again = await adapter.useVerificationToken!({ identifier: 'runner@os.local', token: 'tok-123' });
    expect(again).toBeNull();
  });

  it('user: create -> getUserByEmail persists', async () => {
    const created = await adapter.createUser!({ id: globalThis.crypto.randomUUID(), email: 'runner@os.local', emailVerified: null } as never);
    expect(created.email).toBe('runner@os.local');
    const fetched = await adapter.getUserByEmail!('runner@os.local');
    expect(fetched?.email).toBe('runner@os.local');
    const missing = await adapter.getUserByEmail!('nobody@os.local');
    expect(missing).toBeNull();
  });
});

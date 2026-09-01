import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createServices, type RunnerServices, type UserContext } from '@runner-os/core';
import { createTestDatabase, createPgDependencies, ensureUser, type Db } from '../src/index.js';

const DATE = '2026-08-31';
let db: Db;
let svc: RunnerServices;
let ctx: UserContext;

beforeEach(async () => {
  const t = await createTestDatabase();
  db = t.db;
  const userId = globalThis.crypto.randomUUID();
  await ensureUser(db, userId, `u+${userId}@runneros.local`);
  ctx = { userId, actor: 'tester@runneros' };
  svc = createServices(createPgDependencies(db));
});

async function unwrap<T>(p: Promise<{ ok: boolean; data: T; error: unknown }>): Promise<T> {
  const r = await p; if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.data;
}
async function activeCount(date: string): Promise<number> {
  const r = (await db.execute(sql`select count(*)::int as c from daily_logs where deleted_at is null and log_date=${date}`)) as unknown as { rows: { c: number }[] };
  return r.rows[0]!.c;
}

describe('M07-C — real Postgres repositories (pglite)', () => {
  it('schema: exactly the six operational tables exist', async () => {
    const r = (await db.execute(sql`select table_name from information_schema.tables where table_schema='public' order by table_name`)) as unknown as { rows: { table_name: string }[] };
    const names = r.rows.map((x) => x.table_name);
    expect(names).toEqual(['audit_log', 'daily_logs', 'period_reflections', 'plan_versions', 'user_config', 'users']);
  });

  it('daily create -> read -> field-aware update -> audit, through services + PG', async () => {
    const a = await unwrap(svc.daily.save(ctx, { date: DATE, fields: { weight: 76.2, sleepHours: 7 } }));
    expect(a.id).toBeTruthy();
    expect(a.date).toBe(DATE);
    await new Promise((r) => setTimeout(r, 5));
    const b = await unwrap(svc.daily.save(ctx, { date: DATE, fields: { weight: 76.0 } }));
    expect(b.weight).toBe(76.0);
    expect(b.sleepHours).toBe(7);        // preserved
    expect(b.id).toBe(a.id);
    expect(b.createdAt).toBe(a.createdAt);
    const audits = await db.execute(sql`select action, field_changed from audit_log where entity_id=${a.id} and action='UPDATE'`) as unknown as { rows: { field_changed: string }[] };
    expect(audits.rows.map((x) => x.field_changed)).toEqual(['weight']);
  });

  it('NO_FIELDS: blank create rejected, no row written', async () => {
    const r = await svc.daily.save(ctx, { date: DATE, fields: {} });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe('NO_FIELDS');
    expect(await activeCount(DATE)).toBe(0);
  });

  it('CONCURRENCY: two concurrent creates never produce two active rows', async () => {
    const [x, y] = await Promise.all([
      svc.daily.save(ctx, { date: DATE, fields: { weight: 76 } }),
      svc.daily.save(ctx, { date: DATE, fields: { sleepHours: 7 } }),
    ]);
    expect(x.ok && y.ok).toBe(true);
    expect(await activeCount(DATE)).toBe(1);
    const merged = await unwrap(svc.daily.getForDate(ctx, DATE));
    expect(merged?.weight).toBe(76);
    expect(merged?.sleepHours).toBe(7);
  });

  it('CONCURRENCY: partial-unique index is the DB authority (raw double insert rejected)', async () => {
    const id1 = globalThis.crypto.randomUUID();
    const id2 = globalThis.crypto.randomUUID();
    const now = new Date().toISOString();
    await db.execute(sql`insert into daily_logs (id,user_id,log_date,weight,created_at,updated_at) values (${id1},${ctx.userId},${DATE},70,${now},${now})`);
    await expect(
      db.execute(sql`insert into daily_logs (id,user_id,log_date,weight,created_at,updated_at) values (${id2},${ctx.userId},${DATE},71,${now},${now})`),
    ).rejects.toThrow(/unique|duplicate/i);
    expect(await activeCount(DATE)).toBe(1);
  });

  it('soft delete: DB partial-unique still allows a fresh active row after deletion; deleted excluded', async () => {
    const d = await unwrap(svc.daily.save(ctx, { date: DATE, fields: { weight: 76 } }));
    await unwrap(svc.daily.softDelete(ctx, d.id));
    expect(await svc.daily.getForDate(ctx, DATE).then((r) => r.data)).toBeNull();
    // a new active record for the same date is now permitted (deleted excluded from index)
    const d2 = await unwrap(svc.daily.save(ctx, { date: DATE, fields: { weight: 75 } }));
    expect(d2.id).not.toBe(d.id);
    expect(await activeCount(DATE)).toBe(1);
  });

  it('immutability trigger: created_at and plan snapshots cannot be updated', async () => {
    const v1 = await unwrap(svc.plans.createVersion(ctx, { planDate: DATE, fields: { runPlan: '6 KM EASY' } }));
    const d = await unwrap(svc.daily.save(ctx, { date: DATE, fields: { weight: 76 } }));
    expect(d.planIdSnapshot).toBe(v1.id);
    await expect(db.execute(sql`update daily_logs set created_at=now() where id=${d.id}`)).rejects.toThrow(/immutable/i);
    await expect(db.execute(sql`update daily_logs set plan_version_snapshot=9 where id=${d.id}`)).rejects.toThrow(/immutable/i);
  });

  it('append-only trigger: audit_log rejects update and delete', async () => {
    await unwrap(svc.daily.save(ctx, { date: DATE, fields: { weight: 76 } }));
    await expect(db.execute(sql`update audit_log set reason='x'`)).rejects.toThrow(/append-only/i);
    await expect(db.execute(sql`delete from audit_log`)).rejects.toThrow(/append-only/i);
  });

  it('CHECK constraints reject out-of-range values at the DB', async () => {
    const now = new Date().toISOString();
    const bad = (col: string, val: string) =>
      db.execute(sql.raw(`insert into daily_logs (id,user_id,log_date,${col},created_at,updated_at) values ('${globalThis.crypto.randomUUID()}','${ctx.userId}','2026-09-0${Math.floor(Math.random()*9)+1}',${val},'${now}','${now}')`));
    await expect(bad('pain_score', '9')).rejects.toThrow(/check|ck_daily_pain/i);
    await expect(bad('run_rpe', '20')).rejects.toThrow(/check|ck_daily_rpe/i);
    await expect(bad('weight', '-1')).rejects.toThrow(/check|ck_daily_weight/i);
    await expect(bad('nutrition_adherence', `'MEH'`)).rejects.toThrow(/check|ck_daily_nutrition/i);
  });

  it('plan versioning end-to-end: v1 preserved, v2 authoritative, snapshot immutable', async () => {
    const v1 = await unwrap(svc.plans.createVersion(ctx, { planDate: DATE, effectiveFrom: '2026-08-01', fields: { runPlan: '8 KM TEMPO' } }));
    const d = await unwrap(svc.daily.save(ctx, { date: DATE, fields: { weight: 76 } }));
    expect(d.planVersionSnapshot).toBe(1);
    const v2 = await unwrap(svc.plans.createVersion(ctx, { planDate: DATE, effectiveFrom: DATE, fields: { runPlan: '7 KM EASY' } }));
    expect(v2.version).toBe(2);
    const resolved = await unwrap(svc.plans.getForDate(ctx, DATE));
    expect(resolved.id).toBe(v2.id);
    const versions = await unwrap(svc.plans.getVersionsForDate(ctx, DATE));
    expect(versions.length).toBe(2);
    expect(versions.find((x) => x.version === 1)!.isActive).toBe(false);
    // historical snapshot untouched
    const dAfter = await unwrap(svc.daily.getForDate(ctx, DATE));
    expect(dAfter?.planIdSnapshot).toBe(v1.id);
    expect(dAfter?.planVersionSnapshot).toBe(1);
  });

  it('aggregation over PG: weekly metrics + completion + human context', async () => {
    await svc.plans.createVersion(ctx, { planDate: '2026-09-14', fields: { runPlan: '8km', gymPlan: 'push' } });
    await svc.plans.createVersion(ctx, { planDate: '2026-09-16', fields: { runPlan: '5km', gymPlan: 'pull' } });
    await unwrap(svc.daily.save(ctx, { date: '2026-09-14', fields: { runActualKm: 8, gymDone: true, weight: 76, sleepHours: 7, runRpe: 6, painScore: 1, nutritionAdherence: 'ON' } }));
    await unwrap(svc.daily.save(ctx, { date: '2026-09-16', fields: { runActualKm: 5, gymDone: false, weight: 75.5, sleepHours: 6, runRpe: 5, painScore: 0, nutritionAdherence: 'MOST' } }));
    const now = new Date().toISOString();
    await svc.aggregation.getWeekly(ctx, '2026-09-14'); // compute-on-read
    // add human reflection + waist
    const deps = createPgDependencies(db);
    await deps.reflections.upsert({ userId: ctx.userId, periodType: 'WEEK', periodKey: 'WEEK_2026-09-14', reflectionText: 'solid week', audioObjectKey: null, waist: 81, createdAt: now, updatedAt: now });
    const w = await unwrap(svc.aggregation.getWeekly(ctx, '2026-09-14'));
    expect(w.totalRunningKm).toBe(13);
    expect(w.numberOfRuns).toBe(2);
    expect(w.numberOfGymSessions).toBe(1);
    expect(w.completionPercentage).toBe(75);
    expect(w.missedSessions).toBe(1);
    expect(w.reflectionText).toBe('solid week');
    expect(w.waist).toBe(81);
  });

  it('monthly waist change reads weekly reflections (week-start boundary)', async () => {
    const now = new Date().toISOString();
    const deps = createPgDependencies(db);
    await deps.reflections.upsert({ userId: ctx.userId, periodType: 'WEEK', periodKey: 'WEEK_2026-09-07', reflectionText: null, audioObjectKey: null, waist: 82, createdAt: now, updatedAt: now });
    await deps.reflections.upsert({ userId: ctx.userId, periodType: 'WEEK', periodKey: 'WEEK_2026-09-14', reflectionText: null, audioObjectKey: null, waist: 81, createdAt: now, updatedAt: now });
    const m = await unwrap(svc.aggregation.getMonthly(ctx, 2026, 9));
    expect(m.waistChange).toBe(-1);
  });
});

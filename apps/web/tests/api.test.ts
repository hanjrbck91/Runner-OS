import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDatabase, createPgDependencies, getOrCreateUserByEmail, type Db } from '@runner-os/database';
import { localDateInTimezone } from '@runner-os/core';
import * as H from '../src/server/handlers.js';
import type { Env } from '../src/server/handlers.js';

const ALLOWED = 'runner@os.local';
const valid = { email: ALLOWED };
const other = { email: 'intruder@example.com' };

let db: Db;
let env: Env;

beforeEach(async () => {
  const t = await createTestDatabase();
  db = t.db;
  const deps = createPgDependencies(db);
  env = {
    deps, allowedEmail: ALLOWED, getUserId: (e) => getOrCreateUserByEmail(db, e),
    // Exercise the atomic commit path (real pglite transaction).
    withTransaction: (fn) => db.transaction((tx) => fn(createPgDependencies(tx as unknown as Parameters<typeof createPgDependencies>[0]))),
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const body = (r: { body: unknown }): any => r.body;

describe('M07-D — API handlers', () => {
  it('T1 unauthenticated -> 401', async () => {
    const r = await H.today(env, { session: null });
    expect(r.status).toBe(401);
    expect(body(r).error.code).toBe('UNAUTHENTICATED');
  });

  it('T2 authenticated Today -> 200, no-plan state', async () => {
    const r = await H.today(env, { session: valid });
    expect(r.status).toBe(200);
    expect(body(r).ok).toBe(true);
    expect(body(r).data.planStatus).toBe('NONE');
    expect(body(r).data.daily).toBeNull();
  });

  it('T3 unauthorized email -> 403', async () => {
    const r = await H.today(env, { session: other });
    expect(r.status).toBe(403);
    expect(body(r).error.code).toBe('FORBIDDEN');
  });

  it('T4 Today date is server-derived in Asia/Kolkata', async () => {
    const r = await H.today(env, { session: valid });
    expect(body(r).data.date).toBe(localDateInTimezone(new Date(), 'Asia/Kolkata'));
  });

  it('T5 weight save reaches core + persists', async () => {
    const s = await H.saveWeight(env, { session: valid, body: { weight: 76, sleep: 7 } });
    expect(s.status).toBe(200);
    const t = await H.today(env, { session: valid });
    expect(body(t).data.daily.weight).toBe(76);
    expect(body(t).data.daily.sleepHours).toBe(7);
  });

  it('T6 run save', async () => {
    const s = await H.saveRun(env, { session: valid, body: { km: 8, rpe: 6, pain: 1 } });
    expect(s.status).toBe(200);
    const t = await H.today(env, { session: valid });
    expect(body(t).data.daily.runActualKm).toBe(8);
    expect(body(t).data.daily.painScore).toBe(1);
  });

  it('T7 gym save', async () => {
    const s = await H.saveGym(env, { session: valid, body: { completed: true } });
    expect(s.status).toBe(200);
    expect(body(await H.today(env, { session: valid })).data.daily.gymDone).toBe(true);
  });

  it('T7b gym OFF (false) persists on a NEW day (not treated as no-value)', async () => {
    const s = await H.saveGym(env, { session: valid, body: { completed: false } });
    expect(s.status).toBe(200);
    expect(body(await H.today(env, { session: valid })).data.daily.gymDone).toBe(false);
  });

  it('T7c weekly reflects gym completion', async () => {
    await H.saveGym(env, { session: valid, body: { completed: true } });
    const w = await H.weekly(env, { session: valid });
    expect(body(w).data.numberOfGymSessions).toBe(1);
  });

  it('T8 note save', async () => {
    const s = await H.saveNote(env, { session: valid, body: { note: 'felt strong' } });
    expect(s.status).toBe(200);
    expect(body(await H.today(env, { session: valid })).data.daily.noteText).toBe('felt strong');
  });

  it('T9 weekly read -> derived metrics', async () => {
    await H.saveRun(env, { session: valid, body: { km: 10, rpe: 6 } });
    const r = await H.weekly(env, { session: valid });
    expect(r.status).toBe(200);
    expect(body(r).data.totalRunningKm).toBe(10);
    expect(body(r).data.weekId).toMatch(/^WEEK_/);
  });

  it('T10 invalid payload -> 400 (transport + domain)', async () => {
    expect((await H.saveWeight(env, { session: valid, body: { weight: {} } })).status).toBe(400); // zod
    const r = await H.saveRun(env, { session: valid, body: { pain: 9 } });                          // core range
    expect(r.status).toBe(400);
    expect(body(r).error.code).toBe('VALIDATION');
  });

  it('T11 invalid calendar date -> 400, never reaches repo', async () => {
    const r = await H.plan(env, { session: valid, query: { date: '2026-13-40' } });
    expect(r.status).toBe(400);
    expect(body(r).error.code).toBe('BAD_DATE');
  });

  it('T12 omitted field preserved on later partial save', async () => {
    await H.saveWeight(env, { session: valid, body: { weight: 76, sleep: 7 } });
    await H.saveNote(env, { session: valid, body: { note: 'x' } }); // omits weight/sleep
    const t = await H.today(env, { session: valid });
    expect(body(t).data.daily.weight).toBe(76);
    expect(body(t).data.daily.sleepHours).toBe(7);
    expect(body(t).data.daily.noteText).toBe('x');
  });

  it('T13 null/empty clears the field', async () => {
    await H.saveNote(env, { session: valid, body: { note: 'hello' } });
    await H.saveNote(env, { session: valid, body: { note: null } });
    expect(body(await H.today(env, { session: valid })).data.daily.noteText).toBeNull();
    await H.saveNote(env, { session: valid, body: { note: 'again' } });
    await H.saveNote(env, { session: valid, body: { note: '' } });
    expect(body(await H.today(env, { session: valid })).data.daily.noteText).toBeNull();
  });

  it('T14 user isolation by authenticated userId', async () => {
    await H.saveWeight(env, { session: valid, body: { weight: 76 } });
    const envB: Env = { ...env, allowedEmail: other.email };
    const tB = await H.today(envB, { session: other });
    expect(body(tB).data.daily).toBeNull();                 // B cannot see A's data
    expect(body(await H.today(env, { session: valid })).data.daily.weight).toBe(76);
  });

  it('T15 system/unknown fields rejected at transport', async () => {
    expect((await H.saveWeight(env, { session: valid, body: { weight: 76, userId: 'x' } })).status).toBe(400);
    expect((await H.saveWeight(env, { session: valid, body: { weight: 76, id: 'x' } })).status).toBe(400);
  });

  it('T16 integrity (ambiguous plan) -> 409', async () => {
    const userId = await env.getUserId(ALLOWED);
    const now = new Date().toISOString();
    const d = localDateInTimezone(new Date(), 'Asia/Kolkata');
    for (const v of [1, 2]) {
      await db.execute(sql`insert into plan_versions (id,user_id,plan_date,version,run_plan,effective_from,is_active,created_at,updated_at)
        values (${globalThis.crypto.randomUUID()},${userId},${d},${v},'x',${d},true,${now},${now})`);
    }
    const r = await H.plan(env, { session: valid, query: { date: d } });
    expect(r.status).toBe(409);
    expect(body(r).error.code).toBe('PLAN_AMBIGUOUS');
  });

  it('T18 clear-only create is rejected (no blank row via {field:null})', async () => {
    const r = await H.saveWeight(env, { session: valid, body: { weight: null } });
    expect(r.status).toBe(400);
    expect(body(r).error.code).toBe('NO_FIELDS');
    // nothing persisted
    const t = await H.today(env, { session: valid });
    expect(body(t).data.daily).toBeNull();
  });

  it('T21 CSV export: unauth 401; authed returns text/csv with stable header', async () => {
    const un = await H.exportWeek(env, { session: null });
    expect(un.status).toBe(401);
    expect(un.csv).toBeUndefined();
    await H.saveRun(env, { session: valid, body: { km: 8, rpe: 6 } });
    const ex = await H.exportWeek(env, { session: valid });
    expect(ex.status).toBe(200);
    expect(typeof ex.csv).toBe('string');
    expect(ex.csv!.split('\r\n')[0]).toBe('date,week_number,phase,plan_version,plan_status,planned_session,planned_gym,actual_km,rpe,pain,gym_completed,weight_kg,sleep_hours,nutrition,note,expected_sessions,completed_sessions');
    expect(ex.csv).toContain('8'); // actual km present
  });

  it('T22 export contains only the authenticated user\'s data', async () => {
    await H.saveRun(env, { session: valid, body: { km: 12 } });         // user A
    const envB: Env = { ...env, allowedEmail: other.email };
    const ex = await H.exportWeek(envB, { session: other });            // user B
    expect(ex.status).toBe(200);
    expect(ex.csv).not.toContain('12'); // none of A's actuals leak into B's export
  });

  it('T23 note/form-state isolation: each log writes only its own fields', async () => {
    await H.saveRun(env, { session: valid, body: { km: 8, rpe: 6 } });
    await H.saveNote(env, { session: valid, body: { note: 'legs heavy' } });
    let day = body(await H.today(env, { session: valid })).data.daily;
    expect(day.runActualKm).toBe(8);   // note save did not touch run
    expect(day.gymDone).toBeNull();    // ...or gym
    expect(day.noteText).toBe('legs heavy');
    await H.saveGym(env, { session: valid, body: { completed: true } });
    day = body(await H.today(env, { session: valid })).data.daily;
    expect(day.noteText).toBe('legs heavy'); // gym save did not touch note
    expect(day.runActualKm).toBe(8);          // ...or run
    expect(day.gymDone).toBe(true);
  });

  // ---- MC-025 plan import ----
  const IMP_HEADER = 'date,week_number,phase,day,session_type,planned_distance_km,target_pace,target_effort,planned_duration,workout_description,planned_status,plan_version,coach_notes';
  const fut = (n: number): string => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const impRow = (date: string, wk: number, phase: string, session: string, km: number | string, status = 'planned'): string =>
    `${date},${wk},${phase},Monday,${session},${km},,RPE 3-4,,${session},${status},TMM-v1,notes`;
  const impCsv = (): string => [
    IMP_HEADER,
    impRow(fut(3), 1, 'Rebuild', 'Easy', 7),
    impRow(fut(5), 1, 'Rebuild', 'Strength', '', 'strength'),
    impRow(fut(7), 1, 'Rebuild', 'Long', 12),
  ].join('\n') + '\n';

  it('T24 import endpoints require auth (401)', async () => {
    expect((await H.importPlanPreview(env, { session: null, body: { csv: impCsv() } })).status).toBe(401);
    expect((await H.importPlanCommit(env, { session: null, body: { csv: impCsv() } })).status).toBe(401);
    expect((await H.planOverview(env, { session: null })).status).toBe(401);
  });

  it('T25 valid import: preview then commit creates plan versions; overview reflects it', async () => {
    const pv = await H.importPlanPreview(env, { session: valid, body: { csv: impCsv() } });
    expect(pv.status).toBe(200);
    expect(body(pv).data.valid).toBe(true);
    const c = await H.importPlanCommit(env, { session: valid, body: { csv: impCsv() } });
    expect(c.status).toBe(200);
    expect(body(c).data.versionsCreated).toBe(3);
    const ov = await H.planOverview(env, { session: valid });
    expect(ov.status).toBe(200);
    expect(body(ov).data.hasPlan).toBe(true);
    expect(body(ov).data.totalWeeks).toBe(1);
    // Imported plan resolves through the existing /plan handler.
    const p = await H.plan(env, { session: valid, query: { date: fut(3) } });
    expect(p.status).toBe(200);
    expect(body(p).data.runPlan).toContain('Easy');
  });

  it('T26 malformed import rejected (400) with zero DB writes', async () => {
    const r = await H.importPlanCommit(env, { session: valid, body: { csv: 'foo,bar\n1,2\n' } });
    expect(r.status).toBe(400);
    expect(body(r).error.code).toBe('IMPORT_INVALID');
    const ov = await H.planOverview(env, { session: valid });
    expect(body(ov).data.hasPlan).toBe(false); // nothing written
  });

  it('T27 import is user-scoped (B cannot see A\'s imported plan)', async () => {
    await H.importPlanCommit(env, { session: valid, body: { csv: impCsv() } });
    const envB: Env = { ...env, allowedEmail: other.email };
    const ov = await H.planOverview(envB, { session: other });
    expect(body(ov).data.hasPlan).toBe(false);
  });

  it('T28 duplicate create-import -> 409 conflict; REPLACE overwrites (atomic, no duplicates)', async () => {
    await H.importPlanCommit(env, { session: valid, body: { csv: impCsv() } });
    // Same file again in create mode is refused.
    const dup = await H.importPlanCommit(env, { session: valid, body: { csv: impCsv() } });
    expect(dup.status).toBe(409);
    expect(body(dup).error.code).toBe('IMPORT_CONFLICT');
    // Replace mode succeeds and does not duplicate.
    const rep = await H.importPlanCommit(env, { session: valid, body: { csv: impCsv(), mode: 'replace' } });
    expect(rep.status).toBe(200);
    expect(body(rep).data.versionsCreated).toBe(3);
    const ov = await H.planOverview(env, { session: valid });
    expect(body(ov).data.totalWeeks).toBe(1);
    const p = await H.plan(env, { session: valid, query: { date: fut(3) } });
    expect(p.status).toBe(200); // still exactly one active version per date
  });

  it('T29 body nutrition + run pain location persist (MC-028 exposed fields)', async () => {
    const b = await H.saveWeight(env, { session: valid, body: { weight: 75, nutrition: 'MOST' } });
    expect(b.status).toBe(200);
    const r = await H.saveRun(env, { session: valid, body: { km: 8, pain: 2, painLocation: 'left knee' } });
    expect(r.status).toBe(200);
    const day = body(await H.today(env, { session: valid })).data.daily;
    expect(day.nutritionAdherence).toBe('MOST');
    expect(day.painScore).toBe(2);
    expect(day.painLocation).toBe('left knee');
    // Invalid nutrition rejected at transport.
    expect((await H.saveWeight(env, { session: valid, body: { nutrition: 'SOMETIMES' } })).status).toBe(400);
  });

  it('T17 no DB internals leak; 404 mapping; safe error shape', async () => {
    const r = await H.plan(env, { session: valid, query: { date: '2026-01-15' } });
    expect(r.status).toBe(404);
    expect(body(r).error.code).toBe('NOT_FOUND');
    const json = JSON.stringify(r.body);
    expect(json).not.toMatch(/stack|pg|drizzle|node_modules|select \*/i);
    expect(Object.keys(body(r).error).sort()).toEqual(['code', 'details', 'message'].filter((k) => k in body(r).error));
  });
});

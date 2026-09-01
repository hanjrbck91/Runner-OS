import { describe, it, expect, beforeEach } from 'vitest';
import { createServices, type RunnerServices, type UserContext, type DailyRecord } from '../src/index.js';
import { createInMemoryDependencies, type InMemoryHarness } from '../src/adapters/memory/index.js';

const ctx: UserContext = { userId: 'u1', actor: 'tester@runneros' };
let deps: InMemoryHarness;
let svc: RunnerServices;
beforeEach(() => { deps = createInMemoryDependencies(); svc = createServices(deps); });

async function unwrap<T>(p: Promise<{ ok: boolean; data: T; error: unknown }>): Promise<T> {
  const r = await p; if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.data;
}
async function saveDay(date: string, fields: Record<string, unknown>) {
  const r = await svc.daily.save(ctx, { date, fields }); if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.data;
}

describe('AggregationService (compute-on-read, derived)', () => {
  it('weekly metrics', async () => {
    await saveDay('2026-08-31', { weight: 76, sleepHours: 7, runActualKm: 8, runRpe: 6, gymDone: true, painScore: 0, nutritionAdherence: 'ON' });
    await saveDay('2026-09-02', { weight: 75.5, sleepHours: 6, runActualKm: 5, runRpe: 5, gymDone: false, painScore: 1, nutritionAdherence: 'MOST' });
    await saveDay('2026-09-05', { weight: 75, sleepHours: 8, runActualKm: 12, runRpe: 7, gymDone: true, painScore: 2, nutritionAdherence: 'OFF' });
    const w = await unwrap(svc.aggregation.getWeekly(ctx, '2026-08-31'));
    expect(w.averageWeight).toBe(75.5);
    expect(w.weightTrend).toBe(-1);
    expect(w.totalRunningKm).toBe(25);
    expect(w.longestRun).toBe(12);
    expect(w.numberOfRuns).toBe(3);
    expect(w.numberOfGymSessions).toBe(2);
    expect(w.averageSleep).toBe(7);
    expect(w.averageRpe).toBe(6);
    expect(w.painFlagCount).toBe(2);
    expect(w.nutritionAdherence).toBe(0.5);
  });

  it('monthly metrics', async () => {
    await saveDay('2026-09-02', { weight: 75.5, sleepHours: 6, runActualKm: 5, runRpe: 5, painScore: 1, nutritionAdherence: 'MOST' });
    await saveDay('2026-09-05', { weight: 75, sleepHours: 8, runActualKm: 12, runRpe: 7, gymDone: true, painScore: 2, nutritionAdherence: 'OFF' });
    const m = await unwrap(svc.aggregation.getMonthly(ctx, 2026, 9));
    expect(m.weightChange).toBe(-0.5);
    expect(m.totalRunningKm).toBe(17);
    expect(m.longestRun).toBe(12);
    expect(m.averageSleep).toBe(7);
    expect(m.averageRpe).toBe(6);
    expect(m.nutritionAdherence).toBe(0.25);
    expect(m.painTrend).toBe('2 flags; first 1 last 2');
    expect(m.trainingConsistency).toBeNull(); // no plan
    expect(m.waistChange).toBeNull();
  });

  it('soft-deleted excluded from derived metrics', async () => {
    await saveDay('2026-08-31', { runActualKm: 8 });
    const del = await saveDay('2026-09-02', { runActualKm: 5 });
    expect((await unwrap(svc.aggregation.getWeekly(ctx, '2026-08-31'))).totalRunningKm).toBe(13);
    await svc.daily.softDelete(ctx, del.id);
    const w = await unwrap(svc.aggregation.getWeekly(ctx, '2026-08-31'));
    expect(w.totalRunningKm).toBe(8);
    expect(w.numberOfRuns).toBe(1);
  });

  it('human context preserved and merged; idempotent on read', async () => {
    await saveDay('2026-08-31', { runActualKm: 8 });
    const now = deps.clock.now().toISOString();
    await deps.reflections.upsert({ userId: 'u1', periodType: 'WEEK', periodKey: 'WEEK_2026-08-31', reflectionText: 'Hard week.', audioObjectKey: null, waist: 82, createdAt: now, updatedAt: now });
    const w1 = await unwrap(svc.aggregation.getWeekly(ctx, '2026-08-31'));
    const w2 = await unwrap(svc.aggregation.getWeekly(ctx, '2026-08-31'));
    expect(w1.reflectionText).toBe('Hard week.');
    expect(w1.waist).toBe(82);
    expect(w2).toEqual(w1);                       // pure read, no drift
    expect(deps.reflections.records.length).toBe(1); // recompute never stores derived
  });

  it('completion & missed from plan vs actuals', async () => {
    await svc.plans.createVersion(ctx, { planDate: '2026-09-14', fields: { runPlan: '8km', gymPlan: 'push' } });
    await svc.plans.createVersion(ctx, { planDate: '2026-09-16', fields: { runPlan: '5km', gymPlan: 'pull' } });
    await saveDay('2026-09-14', { runActualKm: 8, gymDone: true });
    await saveDay('2026-09-16', { runActualKm: 5, gymDone: false });
    const w = await unwrap(svc.aggregation.getWeekly(ctx, '2026-09-14'));
    expect(w.completionPercentage).toBe(75);
    expect(w.missedSessions).toBe(1);
  });

  it('ambiguous plan -> integrity error (not zeroed)', async () => {
    const now = deps.clock.now().toISOString();
    const base = { userId: 'u1', planDate: '2026-09-15', phase: null, runPlan: 'x', longRunPlan: null, qualityPlan: null, gymPlan: null, recoveryPlan: null, mileageTarget: null, bodyCompositionTarget: null, milestone: null, weekNumber: null, effectiveFrom: '2026-09-01', effectiveTo: null, isActive: true, createdAt: now, updatedAt: now };
    deps.plans.records.push({ id: 'a', version: 1, ...base }, { id: 'b', version: 2, ...base });
    await saveDay('2026-09-15', { runActualKm: 8 });
    const w = await svc.aggregation.getWeekly(ctx, '2026-09-14');
    expect(w.ok).toBe(false); expect(w.error?.code).toBe('PLAN_AMBIGUOUS');
  });

  it('duplicate active daily -> INTEGRITY_DUPLICATE', async () => {
    const now = deps.clock.now().toISOString();
    const rec = (id: string): DailyRecord => ({ id, userId: 'u1', date: '2026-08-31', weight: null, sleepHours: null, painScore: null, painLocation: null, runActualKm: 5, runRpe: null, gymDone: null, nutritionAdherence: null, noteText: null, planIdSnapshot: null, planVersionSnapshot: null, createdAt: now, updatedAt: now, deletedAt: null });
    deps.daily.records.push(rec('x'), rec('y'));
    const w = await svc.aggregation.getWeekly(ctx, '2026-08-31');
    expect(w.ok).toBe(false); expect(w.error?.code).toBe('INTEGRITY_DUPLICATE');
  });

  it('row-order independence + missing data + waist insufficient', async () => {
    await saveDay('2026-09-05', { weight: 75, runActualKm: 12 });
    await saveDay('2026-08-31', { weight: 76, runActualKm: 8 });
    const a = await unwrap(svc.aggregation.getWeekly(ctx, '2026-08-31'));
    deps.daily.records.reverse();
    const b = await unwrap(svc.aggregation.getWeekly(ctx, '2026-08-31'));
    expect(b.weightTrend).toBe(a.weightTrend);
    expect(b.totalRunningKm).toBe(a.totalRunningKm);

    await saveDay('2026-09-12', { noteText: 'note only' }); // different week, missing metrics
    const w = await unwrap(svc.aggregation.getWeekly(ctx, '2026-09-12'));
    expect(w.averageWeight).toBeNull();
    expect(w.totalRunningKm).toBe(0);
    expect(w.longestRun).toBeNull();
  });
});

describe('TodayService', () => {
  it('no plan -> NONE', async () => {
    const t = await unwrap(svc.today.getToday(ctx, '2026-08-31'));
    expect(t.planStatus).toBe('NONE');
    expect(t.plan).toBeNull();
    expect(t.daily).toBeNull();
    expect(t.dateLabel).toBe('MON 31 AUG');
  });
  it('with plan -> FOUND with week/phase', async () => {
    await svc.plans.createVersion(ctx, { planDate: '2026-08-31', fields: { runPlan: '6 KM EASY', phase: 'REBUILD', weekNumber: 1, gymPlan: 'UPPER A' } });
    await svc.daily.save(ctx, { date: '2026-08-31', fields: { weight: 76 } });
    const t = await unwrap(svc.today.getToday(ctx, '2026-08-31'));
    expect(t.planStatus).toBe('FOUND');
    expect(t.plan?.runPlan).toBe('6 KM EASY');
    expect(t.phase).toBe('REBUILD');
    expect(t.weekNumber).toBe(1);
    expect(t.daily?.weight).toBe(76);
  });
  it('ambiguous plan -> AMBIGUOUS status', async () => {
    const now = deps.clock.now().toISOString();
    const base = { userId: 'u1', planDate: '2026-08-31', phase: null, runPlan: 'x', longRunPlan: null, qualityPlan: null, gymPlan: null, recoveryPlan: null, mileageTarget: null, bodyCompositionTarget: null, milestone: null, weekNumber: null, effectiveFrom: '2026-08-01', effectiveTo: null, isActive: true, createdAt: now, updatedAt: now };
    deps.plans.records.push({ id: 'a', version: 1, ...base }, { id: 'b', version: 2, ...base });
    const t = await unwrap(svc.today.getToday(ctx, '2026-08-31'));
    expect(t.planStatus).toBe('AMBIGUOUS');
    expect(t.plan).toBeNull();
  });
});

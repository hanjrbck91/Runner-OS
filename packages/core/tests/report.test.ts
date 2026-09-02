import { describe, it, expect, beforeEach } from 'vitest';
import { createServices, buildWeeklyReport, reportToCsv, COACH_CSV_COLUMNS, type RunnerServices, type UserContext } from '../src/index.js';
import { createInMemoryDependencies, type InMemoryHarness } from '../src/adapters/memory/index.js';

const ctx: UserContext = { userId: 'u1', actor: 'tester' };
const DATE = '2026-08-31'; // Monday; week 2026-08-31..2026-09-06

let deps: InMemoryHarness;
let svc: RunnerServices;
beforeEach(() => { deps = createInMemoryDependencies(); svc = createServices(deps); });

async function unwrap<T>(p: Promise<{ ok: boolean; data: T; error: unknown }>): Promise<T> {
  const r = await p; if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.data;
}

describe('MC-024 — Coach report + CSV', () => {
  it('combines PLAN + ACTUAL keeping them separate; expected/completed', async () => {
    await unwrap(svc.plans.createVersion(ctx, { planDate: DATE, fields: { runPlan: '6 KM EASY', gymPlan: 'LOWER A', weekNumber: 1, phase: 'REBUILD' } }));
    await unwrap(svc.daily.save(ctx, { date: DATE, fields: { runActualKm: 5, runRpe: 6, painScore: 1, gymDone: false, weight: 76 } }));
    const rep = await unwrap(buildWeeklyReport(deps, ctx, DATE));
    const row = rep.days.find((r) => r.date === DATE)!;
    expect(row.plannedSession).toBe('6 KM EASY');
    expect(row.plannedGym).toBe('LOWER A');
    expect(row.actualKm).toBe(5);           // planned 6 NOT copied into actual
    expect(row.gymCompleted).toBe(false);
    expect(row.weekNumber).toBe(1);
    expect(row.phase).toBe('REBUILD');
    expect(row.planStatus).toBe('FOUND');
    expect(row.expectedSessions).toBe(2);   // run + gym expected
    expect(row.completedSessions).toBe(1);  // run done, gym not
  });

  it('CSV: stable columns; missing vs zero vs false preserved', async () => {
    // logged 0 km + gym false on DATE; no entry on the next day
    await unwrap(svc.daily.save(ctx, { date: DATE, fields: { runActualKm: 0, gymDone: false } }));
    const rep = await unwrap(buildWeeklyReport(deps, ctx, DATE));
    const csv = reportToCsv(rep);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe(COACH_CSV_COLUMNS.join(','));
    const idx = (c: string) => COACH_CSV_COLUMNS.indexOf(c as never);
    const rowFor = (d: string) => lines.slice(1).map((l) => l.split(',')).find((c) => c[0] === d)!;
    const r0 = rowFor(DATE);
    expect(r0[idx('actual_km')]).toBe('0');        // logged zero, NOT missing
    expect(r0[idx('gym_completed')]).toBe('false'); // false, NOT missing
    const r1 = rowFor('2026-09-01');                // no daily
    expect(r1[idx('actual_km')]).toBe('');          // missing != 0
    expect(r1[idx('gym_completed')]).toBe('');       // missing != false
    expect(r1[idx('weight_kg')]).toBe('');
  });

  it('a later plan version never rewrites historical actuals', async () => {
    await unwrap(svc.plans.createVersion(ctx, { planDate: DATE, effectiveFrom: DATE, fields: { runPlan: '8 KM' } }));
    await unwrap(svc.daily.save(ctx, { date: DATE, fields: { runActualKm: 6 } }));
    const before = (await unwrap(buildWeeklyReport(deps, ctx, DATE))).days.find((r) => r.date === DATE)!;
    expect(before.actualKm).toBe(6);
    // change the plan going forward
    await unwrap(svc.plans.createVersion(ctx, { planDate: DATE, effectiveFrom: '2026-09-06', fields: { runPlan: '7 KM' } }));
    const after = (await unwrap(buildWeeklyReport(deps, ctx, DATE))).days.find((r) => r.date === DATE)!;
    expect(after.actualKm).toBe(6); // actual is truthful & immutable
  });

  it('user isolation: report only sees the authenticated user data', async () => {
    await unwrap(svc.daily.save(ctx, { date: DATE, fields: { weight: 76 } }));
    const other: UserContext = { userId: 'u2', actor: 'other' };
    const repOther = await unwrap(buildWeeklyReport(deps, other, DATE));
    expect(repOther.days.every((r) => r.weightKg === null && r.actualKm === null)).toBe(true);
    const repMine = await unwrap(buildWeeklyReport(deps, ctx, DATE));
    expect(repMine.days.find((r) => r.date === DATE)!.weightKg).toBe(76);
  });
});

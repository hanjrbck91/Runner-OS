import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createServices, resolvePlanForDate, type RunnerServices, type UserContext,
} from '../src/index.js';
import { createInMemoryDependencies, type InMemoryHarness } from '../src/adapters/memory/index.js';

const ctx: UserContext = { userId: 'u1', actor: 'tester' };
const other: UserContext = { userId: 'u2', actor: 'other' };

// FixedClock default today (Asia/Kolkata) = 2026-08-31; the plan starts 2026-09-07 (future).
const HEADER = 'date,week_number,phase,day,session_type,planned_distance_km,target_pace,target_effort,planned_duration,workout_description,planned_status,plan_version,coach_notes';
function row(date: string, wk: number | string, phase: string, session: string, km: string | number = '', status = 'planned', label = 'TMM-v1'): string {
  return `${date},${wk},${phase},Monday,${session},${km},,RPE 3-4,,${session},${status},${label},notes`;
}
function csv(...rows: string[]): string { return [HEADER, ...rows].join('\n') + '\n'; }

let deps: InMemoryHarness;
let svc: RunnerServices;
beforeEach(() => { deps = createInMemoryDependencies(); svc = createServices(deps); });

async function unwrap<T>(p: Promise<{ ok: boolean; data: T; error: unknown }>): Promise<T> {
  const r = await p; if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.data;
}

describe('MC-025 — plan import', () => {
  const good = csv(
    row('2026-09-07', 1, 'Rebuild', 'Rest', '', 'rest'),
    row('2026-09-08', 1, 'Rebuild', 'Easy', 7),
    row('2026-09-09', 1, 'Rebuild', 'Strength', '', 'strength'),
    row('2026-09-13', 1, 'Rebuild', 'Long', 12),
  );

  it('valid CSV: preview valid, correct stats, ZERO writes on preview', async () => {
    const pv = await unwrap(svc.planImport.preview(ctx, good));
    expect(pv.valid).toBe(true);
    expect(pv.rowCount).toBe(4);
    expect(pv.weekCount).toBe(1);
    expect(pv.totalPlannedKm).toBe(19);
    expect(pv.dateRange).toEqual({ start: '2026-09-07', end: '2026-09-13' });
    expect(deps.plans.records.length).toBe(0); // preview never writes
  });

  it('successful commit creates one new plan version per row', async () => {
    const res = await unwrap(svc.planImport.commit(ctx, good));
    expect(res.versionsCreated).toBe(4);
    expect(res.weekCount).toBe(1);
    expect(res.effectiveFrom).toBe('2026-09-07');
    expect(deps.plans.records.length).toBe(4);
  });

  it('imported plan resolves through resolvePlanForDate() + getForDate()', async () => {
    await unwrap(svc.planImport.commit(ctx, good));
    const versions = await deps.plans.listByPlanDate(ctx.userId, '2026-09-08');
    const r = resolvePlanForDate(versions, '2026-09-08');
    expect(r.status).toBe('FOUND');
    const plan = await unwrap(svc.plans.getForDate(ctx, '2026-09-08'));
    expect(plan.runPlan).toContain('Easy');
    expect(plan.mileageTarget).toBe(7);
    expect(plan.weekNumber).toBe(1);
    // Long run maps to longRunPlan, strength to gymPlan, rest to recoveryPlan.
    expect((await unwrap(svc.plans.getForDate(ctx, '2026-09-13'))).longRunPlan).toContain('Long');
    expect((await unwrap(svc.plans.getForDate(ctx, '2026-09-09'))).gymPlan).toContain('Strength');
    expect((await unwrap(svc.plans.getForDate(ctx, '2026-09-07'))).recoveryPlan).toContain('Rest');
  });

  it('malformed CSV (unexpected columns) is rejected', async () => {
    const r = await svc.planImport.preview(ctx, 'foo,bar\n1,2\n');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('IMPORT_INVALID');
  });

  it('missing required column is rejected', async () => {
    const noWeek = HEADER.replace(',week_number', '');
    const r = await svc.planImport.preview(ctx, `${noWeek}\n2026-09-08,Rebuild,Monday,Easy,7,,,,,planned,TMM,notes\n`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/missing required column/);
  });

  it('invalid date -> row error, not valid', async () => {
    const pv = await unwrap(svc.planImport.preview(ctx, csv(row('2026-13-40', 1, 'Rebuild', 'Easy', 7))));
    expect(pv.valid).toBe(false);
    expect(pv.errors.some((e) => e.field === 'date')).toBe(true);
  });

  it('invalid numeric distance -> row error', async () => {
    const pv = await unwrap(svc.planImport.preview(ctx, csv(row('2026-09-08', 1, 'Rebuild', 'Easy', 'abc'))));
    expect(pv.valid).toBe(false);
    expect(pv.errors.some((e) => e.field === 'planned_distance_km')).toBe(true);
  });

  it('invalid plan field (week_number out of range) -> row error', async () => {
    const pv = await unwrap(svc.planImport.preview(ctx, csv(row('2026-09-08', 21, 'Rebuild', 'Easy', 7))));
    expect(pv.valid).toBe(false);
    expect(pv.errors.some((e) => e.field === 'week_number')).toBe(true);
  });

  it('duplicate date in file -> error', async () => {
    const pv = await unwrap(svc.planImport.preview(ctx, csv(
      row('2026-09-08', 1, 'Rebuild', 'Easy', 7),
      row('2026-09-08', 1, 'Rebuild', 'Long', 12),
    )));
    expect(pv.valid).toBe(false);
    expect(pv.errors.some((e) => e.message.includes('duplicate'))).toBe(true);
  });

  it('past-date rejection (future-only)', async () => {
    const pv = await unwrap(svc.planImport.preview(ctx, csv(row('2020-01-01', 1, 'Rebuild', 'Easy', 7))));
    expect(pv.valid).toBe(false);
    expect(pv.errors.some((e) => e.message.includes('past'))).toBe(true);
  });

  it('validation failure => commit writes NOTHING', async () => {
    const bad = csv(row('2020-01-01', 1, 'Rebuild', 'Easy', 7)); // past date
    const r = await svc.planImport.commit(ctx, bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('IMPORT_INVALID');
    expect(deps.plans.records.length).toBe(0);
  });

  it('existing plan version + existing Daily actual are untouched by import', async () => {
    // A pre-existing plan on an unrelated future date + a logged actual.
    const existing = await unwrap(svc.plans.createVersion(ctx, { planDate: '2026-12-25', fields: { runPlan: 'HOLIDAY 5K', weekNumber: 16 } }));
    await unwrap(svc.daily.save(ctx, { date: '2026-08-31', fields: { runActualKm: 9, weight: 76 } }));
    const beforeCount = deps.plans.records.length;

    await unwrap(svc.planImport.commit(ctx, good));

    const stillThere = await deps.plans.getById(ctx.userId, existing.id);
    expect(stillThere).not.toBeNull();
    expect(stillThere!.runPlan).toBe('HOLIDAY 5K');
    expect(stillThere!.isActive).toBe(true); // unrelated date, not closed
    expect(deps.plans.records.length).toBe(beforeCount + 4);
    // Daily actual unchanged.
    const day = await deps.daily.getActiveByDate(ctx.userId, '2026-08-31');
    expect(day!.runActualKm).toBe(9);
    expect(day!.weight).toBe(76);
  });

  it('user isolation: import for u1 is invisible to u2', async () => {
    await unwrap(svc.planImport.commit(ctx, good));
    const r = await svc.plans.getForDate(other, '2026-09-08');
    expect(r.ok).toBe(false);
    const ov = await unwrap(svc.planOverview.getOverview(other, '2026-09-08'));
    expect(ov.hasPlan).toBe(false);
  });

  it('duplicate import: create-mode is refused (no silent duplication)', async () => {
    await unwrap(svc.planImport.commit(ctx, good));
    const count = deps.plans.records.length;
    const pv = await unwrap(svc.planImport.preview(ctx, good)); // same file again
    expect(pv.valid).toBe(true); // data is valid; conflict is non-blocking
    expect(pv.conflicts.length).toBe(4);
    expect(pv.warnings.some((w) => w.includes('REPLACE'))).toBe(true);
    const r = await svc.planImport.commit(ctx, good); // default create mode
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('IMPORT_CONFLICT');
    expect(deps.plans.records.length).toBe(count); // nothing added
  });

  it('REPLACE mode overwrites existing dates without duplicating', async () => {
    await unwrap(svc.planImport.commit(ctx, good));
    expect(deps.plans.records.length).toBe(4);
    const res = await unwrap(svc.planImport.commit(ctx, good, 'replace'));
    expect(res.versionsCreated).toBe(4);
    expect(deps.plans.records.length).toBe(4); // replaced, not doubled
    // Every imported date still resolves to exactly one active version.
    const versions = await deps.plans.listByPlanDate(ctx.userId, '2026-09-08');
    expect(versions.filter((v) => v.isActive).length).toBe(1);
    expect(resolvePlanForDate(versions, '2026-09-08').status).toBe('FOUND');
  });

  it('REPLACE recovers from a PARTIAL import (interrupted commit leftovers)', async () => {
    // Simulate a partial import: only the first two dates got written.
    await unwrap(svc.plans.createVersion(ctx, { planDate: '2026-09-07', fields: { recoveryPlan: 'Rest', weekNumber: 1 } }));
    await unwrap(svc.plans.createVersion(ctx, { planDate: '2026-09-08', fields: { runPlan: 'Easy', weekNumber: 1 } }));
    expect(deps.plans.records.length).toBe(2);
    // create-mode is blocked by the leftovers...
    const blocked = await svc.planImport.commit(ctx, good);
    expect(blocked.ok).toBe(false);
    // ...replace-mode cleans up and installs the full plan.
    const res = await unwrap(svc.planImport.commit(ctx, good, 'replace'));
    expect(res.versionsCreated).toBe(4);
    expect(deps.plans.records.length).toBe(4);
  });

  it('plan overview after import reports week/phase/progress', async () => {
    await unwrap(svc.planImport.commit(ctx, good));
    // "today" = 2026-09-10 -> inside week 1 span (no prescribed row that day -> prior day attribution)
    const ov = await unwrap(svc.planOverview.getOverview(ctx, '2026-09-10'));
    expect(ov.hasPlan).toBe(true);
    expect(ov.totalWeeks).toBe(1);
    expect(ov.currentWeek).toBe(1);
    expect(ov.currentPhase).toBe('Rebuild');
    expect(ov.currentWeekPlannedKm).toBe(19);
  });

  it('accepts the real 20-week TMM 3:30 constructed CSV (contract check)', async () => {
    const path = fileURLToPath(new URL('../../../docs/TMM_3_30_20_Week_Daily_Prescription_Adriano_Constructed.csv', import.meta.url));
    const text = readFileSync(path, 'utf8');
    const pv = await unwrap(svc.planImport.preview(ctx, text));
    expect(pv.valid).toBe(true);
    expect(pv.rowCount).toBe(140);
    expect(pv.weekCount).toBe(20);
    expect(pv.dateRange).toEqual({ start: '2026-09-07', end: '2027-01-24' });
    const res = await unwrap(svc.planImport.commit(ctx, text));
    expect(res.versionsCreated).toBe(140);
    expect(res.weekCount).toBe(20);
    // Race day milestone captured.
    const race = await unwrap(svc.plans.getForDate(ctx, '2027-01-18'));
    expect(race.milestone).toMatch(/Mumbai Marathon/);
    expect(race.mileageTarget).toBe(42.2);
  });
});

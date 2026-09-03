import { describe, it, expect } from 'vitest';
import {
  getWeekBounds, getMonthBounds, addDays, compareDate, isValidLocalDate,
  localDateInTimezone, dateLabel, weekKey, monthKey,
  validateDailyFields, resolvePlanForDate, computeCoreMetrics, computeCompletion,
  type PlanVersion, type DailyRecord,
} from '../src/index.js';

const nowIso = '2026-08-31T06:00:00.000Z';

function daily(partial: Partial<DailyRecord> & { date: string }): DailyRecord {
  return {
    id: 'd', userId: 'u', weight: null, sleepHours: null,
    sleepQuality: null, readiness: null, stress: null, motivation: null,
    painScore: null, painLocation: null, painTiming: null,
    runType: null, runActualKm: null, runRpe: null, runNote: null,
    gymDone: null, gymType: null, gymDurationMin: null, gymRpe: null, gymNote: null,
    nutritionAdherence: null, noteText: null,
    planIdSnapshot: null, planVersionSnapshot: null, createdAt: nowIso, updatedAt: nowIso, deletedAt: null,
    ...partial,
  };
}
function plan(partial: Partial<PlanVersion> & { planDate: string }): PlanVersion {
  return {
    id: 'p', userId: 'u', version: 1, phase: null, runPlan: null, longRunPlan: null, qualityPlan: null,
    gymPlan: null, recoveryPlan: null, mileageTarget: null, bodyCompositionTarget: null, milestone: null,
    weekNumber: null, effectiveFrom: partial.planDate, effectiveTo: null, isActive: true,
    createdAt: nowIso, updatedAt: nowIso, ...partial,
  };
}

describe('time policy', () => {
  it('ISO week bounds Mon..Sun', () => {
    expect(getWeekBounds('2026-09-02')).toEqual({ weekStart: '2026-08-31', weekEnd: '2026-09-06' });
    expect(getWeekBounds('2026-08-31').weekStart).toBe('2026-08-31');
    expect(getWeekBounds('2026-09-06').weekStart).toBe('2026-08-31');
  });
  it('month bounds', () => {
    expect(getMonthBounds('2026-09-15')).toEqual({ monthStart: '2026-09-01', monthEnd: '2026-09-30' });
  });
  it('addDays / compareDate / validity', () => {
    expect(addDays('2026-08-31', -1)).toBe('2026-08-30');
    expect(compareDate('2026-01-01', '2026-01-02')).toBe(-1);
    expect(isValidLocalDate('2026-02-30')).toBe(false);
    expect(isValidLocalDate('2026-08-31')).toBe(true);
  });
  it('today resolves in Asia/Kolkata (no UTC-midnight rollover)', () => {
    // 2026-08-31T20:00Z = 2026-09-01 01:30 IST → next calendar day in Kolkata.
    expect(localDateInTimezone(new Date('2026-08-31T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-09-01');
    expect(localDateInTimezone(new Date(nowIso), 'Asia/Kolkata')).toBe('2026-08-31');
  });
  it('labels + keys', () => {
    expect(dateLabel('2026-08-31')).toBe('MON 31 AUG');
    expect(weekKey('2026-08-31')).toBe('WEEK_2026-08-31');
    expect(monthKey(2026, 9)).toBe('MONTH_2026-09');
  });
});

describe('daily field validation (ratified scales)', () => {
  it('accepts valid, normalizes numbers', () => {
    const v = validateDailyFields({ weight: '75.5', painScore: 2, runRpe: 6, nutritionAdherence: 'on' });
    expect(v.ok).toBe(true);
    expect(v.normalized.weight).toBe(75.5);
    expect(v.normalized.nutritionAdherence).toBe('ON');
  });
  it('rejects bad types and out-of-range', () => {
    expect(validateDailyFields({ weight: 'abc' }).ok).toBe(false);
    expect(validateDailyFields({ painScore: 2.5 }).ok).toBe(false);
    expect(validateDailyFields({ painScore: 4 }).ok).toBe(false);
    expect(validateDailyFields({ runRpe: 11 }).ok).toBe(false);
    expect(validateDailyFields({ nutritionAdherence: 'MEH' }).ok).toBe(false);
    expect(validateDailyFields({ weight: -1 }).ok).toBe(false);
  });
  it('rejects system and unknown fields', () => {
    expect(validateDailyFields({ id: 'x' }).ok).toBe(false);
    expect(validateDailyFields({ date: '2026-01-01' }).ok).toBe(false);
    expect(validateDailyFields({ bogus: 1 }).ok).toBe(false);
  });
  it('clearing semantics: null/empty -> null', () => {
    const v = validateDailyFields({ noteText: '', weight: null });
    expect(v.ok).toBe(true);
    expect(v.normalized.noteText).toBeNull();
    expect(v.normalized.weight).toBeNull();
  });
});

describe('plan resolution (deterministic, never guesses)', () => {
  it('FOUND / NOT_FOUND / AMBIGUOUS', () => {
    const v1 = plan({ id: 'a', planDate: '2026-09-15', version: 1, effectiveFrom: '2026-09-01', effectiveTo: '2026-09-14', isActive: false });
    const v2 = plan({ id: 'b', planDate: '2026-09-15', version: 2, effectiveFrom: '2026-09-15', effectiveTo: null, isActive: true });
    expect(resolvePlanForDate([v1, v2], '2026-09-15')).toEqual({ status: 'FOUND', record: v2 });
    expect(resolvePlanForDate([], '2026-09-15').status).toBe('NOT_FOUND');
    const dupA = plan({ id: 'x', planDate: '2026-09-15', effectiveFrom: '2026-09-01', isActive: true });
    const dupB = plan({ id: 'y', planDate: '2026-09-15', version: 2, effectiveFrom: '2026-09-01', isActive: true });
    const r = resolvePlanForDate([dupA, dupB], '2026-09-15');
    expect(r.status).toBe('AMBIGUOUS');
  });
});

describe('metric + completion definitions', () => {
  it('core metrics (longest only from km>0)', () => {
    const recs = [
      daily({ date: '2026-08-31', weight: 76, sleepHours: 7, runActualKm: 8, runRpe: 6, gymDone: true, painScore: 0, nutritionAdherence: 'ON' }),
      daily({ date: '2026-09-02', weight: 75.5, sleepHours: 6, runActualKm: 0, runRpe: 5, gymDone: false, painScore: 1, nutritionAdherence: 'MOST' }),
      daily({ date: '2026-09-05', weight: 75, sleepHours: 8, runActualKm: 12, runRpe: 7, gymDone: true, painScore: 2, nutritionAdherence: 'OFF' }),
    ];
    const m = computeCoreMetrics(recs);
    expect(m.averageWeight).toBe(75.5);
    expect(m.weightTrend).toBe(-1);
    expect(m.totalRunningKm).toBe(20);
    expect(m.longestRun).toBe(12);
    expect(m.numberOfRuns).toBe(2); // km>0 only
    expect(m.numberOfGymSessions).toBe(2);
    expect(m.painFlagCount).toBe(2);
    expect(m.nutritionAdherence).toBe(0.5);
    expect(m.painTrend).toBe('2 flags; first 0 last 2');
  });
  it('longest run is null when only zero-km entries', () => {
    const m = computeCoreMetrics([daily({ date: '2026-08-31', runActualKm: 0 })]);
    expect(m.longestRun).toBeNull();
    expect(m.numberOfRuns).toBe(0);
    expect(m.totalRunningKm).toBe(0);
  });
  it('completion model + ambiguous integrity', () => {
    const planByDate = new Map<string, PlanVersion[]>([
      ['2026-09-14', [plan({ id: 'p1', planDate: '2026-09-14', runPlan: '8km', gymPlan: 'push' })]],
      ['2026-09-16', [plan({ id: 'p2', planDate: '2026-09-16', runPlan: '5km', gymPlan: 'pull' })]],
    ]);
    const dailyByDate = new Map<string, DailyRecord>([
      ['2026-09-14', daily({ date: '2026-09-14', runActualKm: 8, gymDone: true })],
      ['2026-09-16', daily({ date: '2026-09-16', runActualKm: 5, gymDone: false })],
    ]);
    const c = computeCompletion(planByDate, dailyByDate, '2026-09-14', '2026-09-20');
    expect(c).toEqual({ ok: true, completionPercentage: 75, missedSessions: 1 });

    const ambiguous = new Map<string, PlanVersion[]>([
      ['2026-09-14', [plan({ id: 'a', planDate: '2026-09-14', runPlan: 'x', effectiveFrom: '2026-09-01' }), plan({ id: 'b', planDate: '2026-09-14', version: 2, runPlan: 'y', effectiveFrom: '2026-09-01' })]],
    ]);
    const bad = computeCompletion(ambiguous, new Map(), '2026-09-14', '2026-09-14');
    expect(bad.ok).toBe(false);
  });
});

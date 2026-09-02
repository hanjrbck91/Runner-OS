/**
 * Coach report (MC-024, Phase 5) — DETERMINISTIC, no AI. Combines, for a week:
 *   A. PLAN (resolved planned session/gym, week, phase, plan version)
 *   B. ACTUAL (Daily: km, rpe, pain, gym, weight, sleep, nutrition, note)
 *   C. DERIVED METRICS (reuses the same aggregation as Weekly)
 *   D. HUMAN CONTEXT (period reflection)
 *   E. PLAN CHANGES (versions present for the week's dates)
 *
 * Built only from authoritative stored data. PLAN and ACTUAL are kept strictly
 * separate — planned values are never copied into actual fields, and a per-day
 * row records exactly what was planned (resolved) vs what was logged.
 * Reasoning/planning happens OUTSIDE Runner OS (Coach ChatGPT consumes the CSV).
 */
import { ok, fail, type Result } from '../result.js';
import type { CoreDependencies, UserContext } from '../ports/index.js';
import type { DailyRecord, PlanVersion } from '../domain/types.js';
import { computeCoreMetrics, computeCompletion } from '../domain/metrics.js';
import { resolvePlanForDate } from '../domain/plan-resolution.js';
import { getWeekBounds, weekKey, addDays, compareDate, isValidLocalDate, type LocalDate } from '../domain/time.js';

export interface CoachDayRow {
  readonly date: LocalDate;
  readonly weekNumber: number | null;
  readonly phase: string | null;
  readonly planVersion: number | null;
  readonly planStatus: 'FOUND' | 'NONE' | 'AMBIGUOUS';
  readonly plannedSession: string | null; // runPlan | longRunPlan | qualityPlan
  readonly plannedGym: string | null;
  readonly actualKm: number | null;        // null = no run logged (distinct from 0)
  readonly rpe: number | null;
  readonly pain: number | null;
  readonly gymCompleted: boolean | null;   // null = no gym entry (distinct from false)
  readonly weightKg: number | null;
  readonly sleepHours: number | null;
  readonly nutrition: string | null;
  readonly note: string | null;
  readonly expectedSessions: number;
  readonly completedSessions: number;
}

export interface CoachReport {
  readonly weekId: string;
  readonly weekStart: LocalDate;
  readonly weekEnd: LocalDate;
  readonly weekNumber: number | null;
  readonly phase: string | null;
  readonly days: CoachDayRow[];
  readonly derived: {
    readonly totalPlannedKm: number | null; // null: plan stores descriptive sessions, not per-day km
    readonly totalActualKm: number;
    readonly completionPercentage: number | null;
    readonly missedSessions: number;
    readonly averageWeight: number | null;
    readonly weightTrend: number | null;
    readonly averageSleep: number | null;
    readonly averageRpe: number | null;
    readonly painFlagCount: number;
    readonly numberOfRuns: number;
    readonly numberOfGymSessions: number;
    readonly nutritionAdherence: number | null;
  };
  readonly reflectionText: string | null;
  readonly planVersionsInWeek: number; // E: distinct plan versions across the week's dates
}

function indexDailyByDate(records: readonly DailyRecord[]): { byDate: Map<LocalDate, DailyRecord>; duplicates: LocalDate[] } {
  const byDate = new Map<LocalDate, DailyRecord>();
  const dup = new Set<LocalDate>();
  for (const r of records) {
    if (byDate.has(r.date)) dup.add(r.date);
    else byDate.set(r.date, r);
  }
  return { byDate, duplicates: [...dup] };
}
function indexPlansByDate(versions: readonly PlanVersion[]): Map<LocalDate, PlanVersion[]> {
  const m = new Map<LocalDate, PlanVersion[]>();
  for (const v of versions) {
    const arr = m.get(v.planDate);
    if (arr) arr.push(v); else m.set(v.planDate, [v]);
  }
  return m;
}

export async function buildWeeklyReport(
  deps: CoreDependencies,
  ctx: UserContext,
  anyDate: LocalDate,
): Promise<Result<CoachReport>> {
  if (!isValidLocalDate(anyDate)) return fail('BAD_DATE', 'date must be YYYY-MM-DD', { date: anyDate });
  const { weekStart, weekEnd } = getWeekBounds(anyDate);

  const daily = await deps.daily.listActiveInRange(ctx.userId, weekStart, weekEnd);
  const { byDate, duplicates } = indexDailyByDate(daily);
  if (duplicates.length) return fail('INTEGRITY_DUPLICATE', 'multiple active Daily records for date(s)', { dates: duplicates });

  const planVersions = await deps.plans.listByPlanDateRange(ctx.userId, weekStart, weekEnd);
  const planByDate = indexPlansByDate(planVersions);

  const days: CoachDayRow[] = [];
  let weekNumber: number | null = null;
  let phase: string | null = null;
  let day = weekStart;
  while (compareDate(day, weekEnd) <= 0) {
    const res = resolvePlanForDate(planByDate.get(day) ?? [], day);
    const d = byDate.get(day) ?? null;
    let plannedSession: string | null = null;
    let plannedGym: string | null = null;
    let planVersion: number | null = null;
    let planStatus: 'FOUND' | 'NONE' | 'AMBIGUOUS' = 'NONE';
    let expected = 0, completed = 0;

    if (res.status === 'FOUND') {
      const p = res.record;
      planStatus = 'FOUND';
      plannedSession = p.runPlan ?? p.longRunPlan ?? p.qualityPlan ?? null;
      plannedGym = p.gymPlan ?? null;
      planVersion = p.version;
      if (weekNumber === null && p.weekNumber !== null) weekNumber = p.weekNumber;
      if (phase === null && p.phase !== null) phase = p.phase;
      const expectRun = !!(p.runPlan || p.longRunPlan || p.qualityPlan);
      const expectGym = !!p.gymPlan;
      if (expectRun) { expected++; if (d && d.runActualKm !== null && d.runActualKm > 0) completed++; }
      if (expectGym) { expected++; if (d && d.gymDone === true) completed++; }
    } else if (res.status === 'AMBIGUOUS') {
      planStatus = 'AMBIGUOUS';
    }

    days.push({
      date: day, weekNumber, phase, planVersion, planStatus,
      plannedSession, plannedGym,
      actualKm: d?.runActualKm ?? null,
      rpe: d?.runRpe ?? null,
      pain: d?.painScore ?? null,
      gymCompleted: d?.gymDone ?? null,
      weightKg: d?.weight ?? null,
      sleepHours: d?.sleepHours ?? null,
      nutrition: d?.nutritionAdherence ?? null,
      note: d?.noteText ?? null,
      expectedSessions: expected,
      completedSessions: completed,
    });
    day = addDays(day, 1);
  }

  const m = computeCoreMetrics(daily);
  const comp = computeCompletion(planByDate, byDate, weekStart, weekEnd);
  const reflection = await deps.reflections.get(ctx.userId, 'WEEK', weekKey(weekStart));
  const distinctVersions = new Set(planVersions.map((v) => `${v.planDate}#${v.version}`)).size;

  return ok({
    weekId: weekKey(weekStart),
    weekStart, weekEnd, weekNumber, phase,
    days,
    derived: {
      totalPlannedKm: null, // plan stores descriptive sessions, not per-day km — never fabricated
      totalActualKm: m.totalRunningKm,
      completionPercentage: comp.ok ? comp.completionPercentage : null,
      missedSessions: comp.ok ? comp.missedSessions : 0,
      averageWeight: m.averageWeight,
      weightTrend: m.weightTrend,
      averageSleep: m.averageSleep,
      averageRpe: m.averageRpe,
      painFlagCount: m.painFlagCount,
      numberOfRuns: m.numberOfRuns,
      numberOfGymSessions: m.numberOfGymSessions,
      nutritionAdherence: m.nutritionAdherence,
    },
    reflectionText: reflection?.reflectionText ?? null,
    planVersionsInWeek: distinctVersions,
  });
}

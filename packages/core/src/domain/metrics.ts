/**
 * Pure derived-metric calculations (ported from M04-H1 AggregationService).
 * Deterministic, row-order independent, no I/O. Behavioral reference:
 * legacy-appsscript computeCoreMetrics_ / computeCompletion_.
 */
import type { DailyRecord, PlanVersion } from './types.js';
import { NUTRITION_SCORE } from './rules.js';
import { resolvePlanForDate } from './plan-resolution.js';
import { addDays, compareDate, type LocalDate } from './time.js';

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return round2(values.reduce((a, b) => a + b, 0) / values.length);
}

export interface CoreMetrics {
  readonly averageWeight: number | null;
  readonly weightTrend: number | null; // last - first valid weight (>=2), + = gain
  readonly totalRunningKm: number;
  readonly longestRun: number | null;  // only runs with km > 0
  readonly numberOfRuns: number;        // km > 0
  readonly numberOfGymSessions: number; // gymDone === true
  readonly averageSleep: number | null;
  readonly averageRpe: number | null;
  readonly painFlagCount: number;       // painScore > 0
  readonly nutritionAdherence: number | null; // mean of ON=1/MOST=.5/OFF=0
  readonly painTrend: string | null;    // '<flags> flags; first <a> last <b>'
}

/** Compute core metrics from a set of ACTIVE (non-deleted) Daily records. */
export function computeCoreMetrics(dailies: readonly DailyRecord[]): CoreMetrics {
  const sorted = [...dailies].sort((a, b) => compareDate(a.date, b.date));

  const weights: number[] = [];
  const sleeps: number[] = [];
  const rpes: number[] = [];
  const nutris: number[] = [];
  const pains: number[] = [];
  let totalKm = 0;
  let longest: number | null = null;
  let numRuns = 0;
  let numGym = 0;
  let painFlags = 0;

  for (const r of sorted) {
    if (r.weight !== null) weights.push(r.weight);
    if (r.sleepHours !== null) sleeps.push(r.sleepHours);
    if (r.runRpe !== null) rpes.push(r.runRpe);
    if (r.runActualKm !== null) {
      totalKm += r.runActualKm;
      if (r.runActualKm > 0) {
        numRuns++;
        if (longest === null || r.runActualKm > longest) longest = r.runActualKm;
      }
    }
    if (r.gymDone === true) numGym++;
    if (r.painScore !== null) {
      pains.push(r.painScore);
      if (r.painScore > 0) painFlags++;
    }
    if (r.nutritionAdherence !== null) nutris.push(NUTRITION_SCORE[r.nutritionAdherence]);
  }

  return {
    averageWeight: mean(weights),
    weightTrend: weights.length >= 2 ? round2(weights[weights.length - 1]! - weights[0]!) : null,
    totalRunningKm: round2(totalKm),
    longestRun: longest === null ? null : round2(longest),
    numberOfRuns: numRuns,
    numberOfGymSessions: numGym,
    averageSleep: mean(sleeps),
    averageRpe: mean(rpes),
    painFlagCount: painFlags,
    nutritionAdherence: mean(nutris),
    painTrend: pains.length === 0 ? null : `${painFlags} flags; first ${pains[0]} last ${pains[pains.length - 1]}`,
  };
}

export type CompletionResult =
  | { readonly ok: true; readonly completionPercentage: number | null; readonly missedSessions: number }
  | { readonly ok: false; readonly code: 'PLAN_AMBIGUOUS'; readonly date: LocalDate; readonly planIds: string[] };

/**
 * Ratified completion model over [start, end].
 *   expected RUN = plan has runPlan|longRunPlan|qualityPlan (collectively ONE)
 *   expected GYM = plan has gymPlan (ONE)
 *   recoveryPlan is not tracked; no plan => 0 expected; ambiguous => integrity error.
 * @param planByDate versions grouped by planDate
 * @param dailyByDate active daily record per date
 */
export function computeCompletion(
  planByDate: ReadonlyMap<LocalDate, readonly PlanVersion[]>,
  dailyByDate: ReadonlyMap<LocalDate, DailyRecord>,
  start: LocalDate,
  end: LocalDate,
): CompletionResult {
  let expected = 0;
  let completed = 0;
  let day = start;
  while (compareDate(day, end) <= 0) {
    const res = resolvePlanForDate(planByDate.get(day) ?? [], day);
    if (res.status === 'AMBIGUOUS') return { ok: false, code: 'PLAN_AMBIGUOUS', date: day, planIds: res.planIds };
    if (res.status === 'FOUND') {
      const p = res.record;
      const expectRun = !!(p.runPlan || p.longRunPlan || p.qualityPlan);
      const expectGym = !!p.gymPlan;
      if (expectRun || expectGym) {
        const daily = dailyByDate.get(day) ?? null;
        if (expectRun) {
          expected++;
          if (daily && daily.runActualKm !== null && daily.runActualKm > 0) completed++;
        }
        if (expectGym) {
          expected++;
          if (daily && daily.gymDone === true) completed++;
        }
      }
    }
    day = addDays(day, 1);
  }
  return {
    ok: true,
    completionPercentage: expected > 0 ? round2((completed / expected) * 100) : null,
    missedSessions: expected > 0 ? expected - completed : 0,
  };
}

/** Distinct authoritative-plan milestones across [start, end]. */
export function computeMilestones(
  planByDate: ReadonlyMap<LocalDate, readonly PlanVersion[]>,
  start: LocalDate,
  end: LocalDate,
): string | null {
  const seen = new Set<string>();
  let day = start;
  while (compareDate(day, end) <= 0) {
    const res = resolvePlanForDate(planByDate.get(day) ?? [], day);
    if (res.status === 'FOUND' && res.record.milestone) seen.add(res.record.milestone);
    day = addDays(day, 1);
  }
  return seen.size === 0 ? null : [...seen].join('; ');
}

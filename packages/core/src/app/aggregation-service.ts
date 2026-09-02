/**
 * Derived Weekly/Monthly aggregation — COMPUTED ON READ (no stored derived
 * rows). Canonical source = Daily + Plan; human context = PeriodReflection.
 * Regenerable, deleted-excluded (repo returns active only), integrity-safe
 * (ambiguous plan / duplicate active date -> error, never fabricated metrics).
 */
import { ok, fail, type Result } from '../result.js';
import type { CoreDependencies, UserContext } from '../ports/index.js';
import type { DailyRecord, PlanVersion, WeeklyView, MonthlyView } from '../domain/types.js';
import { computeCoreMetrics, computeCompletion, computeMilestones } from '../domain/metrics.js';
import {
  getWeekBounds, getMonthBounds, weekKey, monthKey, compareDate,
  isValidLocalDate, type LocalDate,
} from '../domain/time.js';

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
    if (arr) arr.push(v);
    else m.set(v.planDate, [v]);
  }
  return m;
}

export class AggregationService {
  constructor(private readonly deps: CoreDependencies) {}

  async getWeekly(ctx: UserContext, anyDate: LocalDate): Promise<Result<WeeklyView>> {
    if (!isValidLocalDate(anyDate)) return fail('BAD_DATE', 'date must be YYYY-MM-DD', { date: anyDate });
    const { weekStart, weekEnd } = getWeekBounds(anyDate);

    // Independent reads run in parallel (first-load latency).
    const [daily, planList, reflection] = await Promise.all([
      this.deps.daily.listActiveInRange(ctx.userId, weekStart, weekEnd),
      this.deps.plans.listByPlanDateRange(ctx.userId, weekStart, weekEnd),
      this.deps.reflections.get(ctx.userId, 'WEEK', weekKey(weekStart)),
    ]);
    const { byDate, duplicates } = indexDailyByDate(daily);
    if (duplicates.length) return fail('INTEGRITY_DUPLICATE', 'multiple active Daily records for date(s)', { dates: duplicates });

    const planByDate = indexPlansByDate(planList);
    const comp = computeCompletion(planByDate, byDate, weekStart, weekEnd);
    if (!comp.ok) return fail('PLAN_AMBIGUOUS', `ambiguous authoritative plan for ${comp.date}`, { date: comp.date, planIds: comp.planIds });

    const m = computeCoreMetrics(daily);

    return ok({
      weekId: weekKey(weekStart),
      weekStart, weekEnd,
      averageWeight: m.averageWeight,
      weightTrend: m.weightTrend,
      totalRunningKm: m.totalRunningKm,
      longestRun: m.longestRun,
      numberOfRuns: m.numberOfRuns,
      numberOfGymSessions: m.numberOfGymSessions,
      averageSleep: m.averageSleep,
      averageRpe: m.averageRpe,
      painFlagCount: m.painFlagCount,
      nutritionAdherence: m.nutritionAdherence,
      completionPercentage: comp.completionPercentage,
      missedSessions: comp.missedSessions,
      waist: reflection?.waist ?? null,
      reflectionText: reflection?.reflectionText ?? null,
    });
  }

  async getMonthly(ctx: UserContext, year: number, month: number): Promise<Result<MonthlyView>> {
    if (!(year >= 1970 && month >= 1 && month <= 12)) return fail('BAD_MONTH', 'year/month invalid', { year, month });
    const mm = (month < 10 ? '0' : '') + month;
    const { monthStart, monthEnd } = getMonthBounds(`${year}-${mm}-01`);

    const daily = await this.deps.daily.listActiveInRange(ctx.userId, monthStart, monthEnd);
    const { byDate, duplicates } = indexDailyByDate(daily);
    if (duplicates.length) return fail('INTEGRITY_DUPLICATE', 'multiple active Daily records for date(s)', { dates: duplicates });

    const planByDate = indexPlansByDate(await this.deps.plans.listByPlanDateRange(ctx.userId, monthStart, monthEnd));
    const comp = computeCompletion(planByDate, byDate, monthStart, monthEnd);
    if (!comp.ok) return fail('PLAN_AMBIGUOUS', `ambiguous authoritative plan for ${comp.date}`, { date: comp.date, planIds: comp.planIds });

    const m = computeCoreMetrics(daily);
    const reflection = await this.deps.reflections.get(ctx.userId, 'MONTH', monthKey(year, month));
    const waistChange = await this.computeWaistChange(ctx, monthStart, monthEnd);

    return ok({
      monthId: monthKey(year, month),
      monthStart, monthEnd,
      weightChange: m.weightTrend,
      totalRunningKm: m.totalRunningKm,
      longestRun: m.longestRun,
      averageSleep: m.averageSleep,
      averageRpe: m.averageRpe,
      painTrend: m.painTrend,
      nutritionAdherence: m.nutritionAdherence,
      trainingConsistency: comp.completionPercentage,
      milestones: computeMilestones(planByDate, monthStart, monthEnd),
      waistChange,
      reflectionText: reflection?.reflectionText ?? null,
      raceResults: null,
    });
  }

  /**
   * WAIST_CHANGE: last-first non-null weekly WAIST for weeks whose weekStart is
   * in [start, end]. Boundary rule: a week is attributed to the month of its
   * weekStart (e.g. week beginning 2026-08-31 belongs to August).
   */
  private async computeWaistChange(ctx: UserContext, start: LocalDate, end: LocalDate): Promise<number | null> {
    const weekly = await this.deps.reflections.listWeeklyInRange(ctx.userId, start, end);
    const measured = weekly
      .filter((r) => r.waist !== null)
      .map((r) => ({ weekStart: r.periodKey.replace('WEEK_', ''), waist: r.waist as number }))
      .sort((a, b) => compareDate(a.weekStart, b.weekStart));
    if (measured.length < 2) return null;
    return Math.round((measured[measured.length - 1]!.waist - measured[0]!.waist) * 100) / 100;
  }
}

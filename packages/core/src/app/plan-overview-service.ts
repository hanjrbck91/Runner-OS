/**
 * Plan overview (MC-025, extended MC-028) — a compact, read-only projection of
 * the WHOLE active plan for the Plan page: current week / total, phase, planned
 * vs completed KM, completion %, completed / remaining weeks, upcoming sessions,
 * and a per-week breakdown (with each week's sessions) so the UI can render a
 * compact, expandable 20-week view without dumping 140 rows at once.
 * Deterministic, computed on read; never fabricates.
 */
import { ok, type Result } from '../result.js';
import type { CoreDependencies, UserContext } from '../ports/index.js';
import type { PlanVersion, DailyRecord } from '../domain/types.js';
import { resolvePlanForDate } from '../domain/plan-resolution.js';
import { computeCompletion } from '../domain/metrics.js';
import { localDateInTimezone, compareDate, addDays, type LocalDate } from '../domain/time.js';

export interface UpcomingSession {
  readonly date: LocalDate;
  readonly weekNumber: number | null;
  readonly phase: string | null;
  readonly session: string;
  readonly plannedKm: number | null;
}

export interface PlanDay {
  readonly date: LocalDate;
  readonly slot: string;              // run | long | quality | gym | recovery
  readonly session: string;
  readonly plannedKm: number | null;
}

export interface PlanWeek {
  readonly weekNumber: number;
  readonly phase: string | null;
  readonly start: LocalDate;
  readonly end: LocalDate;
  readonly plannedKm: number;
  readonly sessions: number;          // tracked run/gym days (not rest)
  readonly status: 'DONE' | 'CURRENT' | 'UPCOMING';
  readonly days: readonly PlanDay[];
}

export interface PlanOverview {
  readonly hasPlan: boolean;
  readonly today: LocalDate;
  readonly totalWeeks: number;
  readonly currentWeek: number | null;   // null when today is before the plan starts
  readonly currentPhase: string | null;
  readonly currentWeekPlannedKm: number | null;
  readonly plannedTotalKm: number;
  readonly completedKm: number;
  readonly completionPercentage: number | null; // null until the plan has started
  readonly completedWeeks: number;
  readonly remainingWeeks: number;
  readonly startsInDays: number | null;   // >0 when the plan hasn't started yet
  readonly dateRange: { readonly start: LocalDate; readonly end: LocalDate } | null;
  readonly upcoming: readonly UpcomingSession[];
  readonly weeks: readonly PlanWeek[];
}

const WIDE_START = '2000-01-01';
const WIDE_END = '2100-01-01';

function slotOf(p: PlanVersion): string {
  if (p.runPlan) return 'run';
  if (p.longRunPlan) return 'long';
  if (p.qualityPlan) return 'quality';
  if (p.gymPlan) return 'gym';
  if (p.recoveryPlan) return 'recovery';
  return '—';
}
function sessionText(p: PlanVersion): string {
  return p.runPlan ?? p.longRunPlan ?? p.qualityPlan ?? p.gymPlan ?? p.recoveryPlan ?? '—';
}
function isTracked(p: PlanVersion): boolean {
  return !!(p.runPlan ?? p.longRunPlan ?? p.qualityPlan ?? p.gymPlan);
}
function round2(x: number): number { return Math.round(x * 100) / 100; }
function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400000);
}

export class PlanOverviewService {
  constructor(private readonly deps: CoreDependencies) {}

  async getOverview(ctx: UserContext, date?: LocalDate): Promise<Result<PlanOverview>> {
    const today = date ?? localDateInTimezone(this.deps.clock.now(), this.deps.clock.timezone());
    const all = await this.deps.plans.listByPlanDateRange(ctx.userId, WIDE_START, WIDE_END);
    const active = all.filter((v) => v.isActive);

    if (active.length === 0) {
      return ok(this.empty(today));
    }

    // Resolve one authoritative version per day.
    const byDate = new Map<LocalDate, PlanVersion[]>();
    for (const v of all) {
      const arr = byDate.get(v.planDate);
      if (arr) arr.push(v); else byDate.set(v.planDate, [v]);
    }
    const resolved: PlanVersion[] = [];
    for (const [d, versions] of byDate) {
      const r = resolvePlanForDate(versions, d);
      if (r.status === 'FOUND') resolved.push(r.record);
    }
    resolved.sort((a, b) => compareDate(a.planDate, b.planDate));

    const start = resolved[0]!.planDate;
    const end = resolved[resolved.length - 1]!.planDate;

    // Group into weeks by weekNumber (each week's day span + sessions).
    const weekMap = new Map<number, { phase: string | null; days: PlanDay[]; kms: number; tracked: number; dates: LocalDate[] }>();
    for (const p of resolved) {
      if (p.weekNumber === null) continue;
      const w = weekMap.get(p.weekNumber) ?? { phase: p.phase, days: [], kms: 0, tracked: 0, dates: [] };
      w.days.push({ date: p.planDate, slot: slotOf(p), session: sessionText(p), plannedKm: p.mileageTarget });
      w.kms += p.mileageTarget ?? 0;
      if (isTracked(p)) w.tracked += 1;
      w.dates.push(p.planDate);
      if (!w.phase) w.phase = p.phase;
      weekMap.set(p.weekNumber, w);
    }
    const totalWeeks = weekMap.size;

    // Locate "today" within the plan.
    const todaysPlan = resolved.find((p) => p.planDate === today) ?? null;
    let currentWeek: number | null = null;
    let currentPhase: string | null = null;
    let startsInDays: number | null = null;

    if (todaysPlan) {
      currentWeek = todaysPlan.weekNumber;
      currentPhase = todaysPlan.phase;
    } else if (compareDate(today, start) < 0) {
      startsInDays = daysBetween(today, start);
      currentPhase = resolved[0]!.phase;
    } else {
      const prior = [...resolved].reverse().find((p) => compareDate(p.planDate, today) <= 0) ?? null;
      currentWeek = prior?.weekNumber ?? null;
      currentPhase = prior?.phase ?? null;
    }

    const currentWeekPlannedKm = currentWeek !== null
      ? round2(weekMap.get(currentWeek)?.kms ?? 0)
      : (startsInDays !== null ? round2(weekMap.get(1)?.kms ?? 0) : null);

    const completedWeeks = currentWeek !== null ? Math.max(0, currentWeek - 1) : 0;
    const remainingWeeks = currentWeek !== null ? Math.max(0, totalWeeks - currentWeek) : totalWeeks;
    const plannedTotalKm = round2([...weekMap.values()].reduce((a, w) => a + w.kms, 0));

    // Actuals in the elapsed portion of the plan -> completed KM + completion %.
    const started = compareDate(today, start) >= 0;
    let completedKm = 0;
    let completionPercentage: number | null = null;
    if (started) {
      const cappedEnd = compareDate(today, end) < 0 ? today : end;
      const dailies = await this.deps.daily.listActiveInRange(ctx.userId, start, cappedEnd);
      completedKm = round2(dailies.reduce((a, d) => a + (d.runActualKm ?? 0), 0));
      const dailyByDate = new Map<LocalDate, DailyRecord>();
      for (const d of dailies) dailyByDate.set(d.date, d);
      const planByDate = new Map<LocalDate, PlanVersion[]>();
      for (const [d, vs] of byDate) planByDate.set(d, vs);
      const comp = computeCompletion(planByDate, dailyByDate, start, cappedEnd);
      if (comp.ok) completionPercentage = comp.completionPercentage;
    }

    // Upcoming tracked sessions from today forward (up to 6).
    const upcoming: UpcomingSession[] = [];
    let cursor = today;
    let scanned = 0;
    while (compareDate(cursor, end) <= 0 && upcoming.length < 6 && scanned < 30) {
      const p = resolved.find((r) => r.planDate === cursor);
      if (p && isTracked(p)) {
        upcoming.push({ date: p.planDate, weekNumber: p.weekNumber, phase: p.phase, session: sessionText(p), plannedKm: p.mileageTarget });
      }
      cursor = addDays(cursor, 1);
      scanned += 1;
    }

    const weeks: PlanWeek[] = [...weekMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([weekNumber, w]) => {
        const ws = w.dates.slice().sort(compareDate);
        const status: PlanWeek['status'] = currentWeek === null
          ? (startsInDays !== null ? 'UPCOMING' : 'UPCOMING')
          : weekNumber < currentWeek ? 'DONE' : weekNumber === currentWeek ? 'CURRENT' : 'UPCOMING';
        return {
          weekNumber, phase: w.phase, start: ws[0]!, end: ws[ws.length - 1]!,
          plannedKm: round2(w.kms), sessions: w.tracked, status,
          days: w.days.slice().sort((a, b) => compareDate(a.date, b.date)),
        };
      });

    return ok({
      hasPlan: true, today, totalWeeks, currentWeek, currentPhase, currentWeekPlannedKm,
      plannedTotalKm, completedKm, completionPercentage,
      completedWeeks, remainingWeeks, startsInDays,
      dateRange: { start, end }, upcoming, weeks,
    });
  }

  private empty(today: LocalDate): PlanOverview {
    return {
      hasPlan: false, today, totalWeeks: 0, currentWeek: null, currentPhase: null,
      currentWeekPlannedKm: null, plannedTotalKm: 0, completedKm: 0, completionPercentage: null,
      completedWeeks: 0, remainingWeeks: 0, startsInDays: null, dateRange: null, upcoming: [], weeks: [],
    };
  }
}

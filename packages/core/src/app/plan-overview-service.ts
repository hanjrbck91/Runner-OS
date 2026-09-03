/**
 * Plan overview (MC-025) — a compact, read-only projection of the WHOLE active
 * plan for the Plan page: current week / total, phase, current-week planned KM,
 * completed / remaining weeks, and upcoming sessions. Deterministic, computed on
 * read from the existing plan_versions via resolvePlanForDate. Never fabricates.
 */
import { ok, type Result } from '../result.js';
import type { CoreDependencies, UserContext } from '../ports/index.js';
import type { PlanVersion } from '../domain/types.js';
import { resolvePlanForDate } from '../domain/plan-resolution.js';
import { localDateInTimezone, compareDate, addDays, type LocalDate } from '../domain/time.js';

export interface UpcomingSession {
  readonly date: LocalDate;
  readonly weekNumber: number | null;
  readonly phase: string | null;
  readonly session: string;
  readonly plannedKm: number | null;
}

export interface PlanOverview {
  readonly hasPlan: boolean;
  readonly today: LocalDate;
  readonly totalWeeks: number;
  readonly currentWeek: number | null;   // null when today is before the plan starts
  readonly currentPhase: string | null;
  readonly currentWeekPlannedKm: number | null;
  readonly completedWeeks: number;
  readonly remainingWeeks: number;
  readonly startsInDays: number | null;   // >0 when the plan hasn't started yet
  readonly dateRange: { readonly start: LocalDate; readonly end: LocalDate } | null;
  readonly upcoming: readonly UpcomingSession[];
}

const WIDE_START = '2000-01-01';
const WIDE_END = '2100-01-01';

/** The authoritative session string on a resolved plan (single slot per day). */
function sessionText(p: PlanVersion): string {
  return p.runPlan ?? p.longRunPlan ?? p.qualityPlan ?? p.gymPlan ?? p.recoveryPlan ?? '—';
}
function isTrackedSession(p: PlanVersion): boolean {
  return !!(p.runPlan ?? p.longRunPlan ?? p.qualityPlan ?? p.gymPlan);
}

export class PlanOverviewService {
  constructor(private readonly deps: CoreDependencies) {}

  async getOverview(ctx: UserContext, date?: LocalDate): Promise<Result<PlanOverview>> {
    const today = date ?? localDateInTimezone(this.deps.clock.now(), this.deps.clock.timezone());
    const all = await this.deps.plans.listByPlanDateRange(ctx.userId, WIDE_START, WIDE_END);
    const active = all.filter((v) => v.isActive);

    if (active.length === 0) {
      return ok({
        hasPlan: false, today, totalWeeks: 0, currentWeek: null, currentPhase: null,
        currentWeekPlannedKm: null, completedWeeks: 0, remainingWeeks: 0, startsInDays: null,
        dateRange: null, upcoming: [],
      });
    }

    const byDate = new Map<LocalDate, PlanVersion[]>();
    for (const v of all) {
      const arr = byDate.get(v.planDate);
      if (arr) arr.push(v); else byDate.set(v.planDate, [v]);
    }
    // Resolve one authoritative version per day (deterministic; ambiguity ignored here).
    const resolved: PlanVersion[] = [];
    for (const [d, versions] of byDate) {
      const r = resolvePlanForDate(versions, d);
      if (r.status === 'FOUND') resolved.push(r.record);
    }
    resolved.sort((a, b) => compareDate(a.planDate, b.planDate));

    const start = resolved[0]!.planDate;
    const end = resolved[resolved.length - 1]!.planDate;
    const weeks = new Set<number>();
    const kmByWeek = new Map<number, number>();
    const phaseByWeek = new Map<number, string | null>();
    for (const p of resolved) {
      if (p.weekNumber !== null) {
        weeks.add(p.weekNumber);
        kmByWeek.set(p.weekNumber, (kmByWeek.get(p.weekNumber) ?? 0) + (p.mileageTarget ?? 0));
        if (!phaseByWeek.has(p.weekNumber)) phaseByWeek.set(p.weekNumber, p.phase);
      }
    }
    const totalWeeks = weeks.size;

    // Where is "today" relative to the plan?
    const todaysPlan = resolved.find((p) => p.planDate === today) ?? null;
    let currentWeek: number | null = null;
    let currentPhase: string | null = null;
    let startsInDays: number | null = null;

    if (todaysPlan) {
      currentWeek = todaysPlan.weekNumber;
      currentPhase = todaysPlan.phase;
    } else if (compareDate(today, start) < 0) {
      startsInDays = daysBetween(today, start);
      const first = resolved[0]!;
      currentWeek = null;
      currentPhase = first.phase;
    } else {
      // today is inside the plan span on a non-prescribed day (or past end):
      // attribute to the most recent prescribed day <= today.
      const prior = [...resolved].reverse().find((p) => compareDate(p.planDate, today) <= 0) ?? null;
      currentWeek = prior?.weekNumber ?? null;
      currentPhase = prior?.phase ?? null;
    }

    const currentWeekPlannedKm = currentWeek !== null
      ? round2(kmByWeek.get(currentWeek) ?? 0)
      : (startsInDays !== null ? round2(kmByWeek.get(1) ?? 0) : null);

    const completedWeeks = currentWeek !== null ? Math.max(0, currentWeek - 1) : 0;
    const remainingWeeks = currentWeek !== null ? Math.max(0, totalWeeks - currentWeek) : totalWeeks;

    // Upcoming: next tracked sessions from today forward (up to 6, ~2 weeks).
    const upcoming: UpcomingSession[] = [];
    let cursor = today;
    let scanned = 0;
    while (compareDate(cursor, end) <= 0 && upcoming.length < 6 && scanned < 30) {
      const p = resolved.find((r) => r.planDate === cursor);
      if (p && isTrackedSession(p)) {
        upcoming.push({ date: p.planDate, weekNumber: p.weekNumber, phase: p.phase, session: sessionText(p), plannedKm: p.mileageTarget });
      }
      cursor = addDays(cursor, 1);
      scanned += 1;
    }

    return ok({
      hasPlan: true, today, totalWeeks, currentWeek, currentPhase, currentWeekPlannedKm,
      completedWeeks, remainingWeeks, startsInDays,
      dateRange: { start, end }, upcoming,
    });
  }
}

function round2(x: number): number { return Math.round(x * 100) / 100; }
function daysBetween(a: LocalDate, b: LocalDate): number {
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((db - da) / 86400000);
}

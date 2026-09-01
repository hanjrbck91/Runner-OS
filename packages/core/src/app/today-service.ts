/**
 * Today view assembler (ported from WebApp.gs getToday). Server-derived date,
 * authoritative plan resolution, existing Daily. planStatus surfaces NONE and
 * AMBIGUOUS explicitly — never a guessed plan.
 */
import { ok, fail, type Result } from '../result.js';
import type { CoreDependencies, UserContext } from '../ports/index.js';
import type { TodayView, PlanStatus } from '../domain/types.js';
import { resolvePlanForDate } from '../domain/plan-resolution.js';
import { getWeekBounds, dateLabel, localDateInTimezone, isValidLocalDate, type LocalDate } from '../domain/time.js';

export class TodayService {
  constructor(private readonly deps: CoreDependencies) {}

  async getToday(ctx: UserContext, date?: LocalDate): Promise<Result<TodayView>> {
    const d = date ?? localDateInTimezone(this.deps.clock.now(), this.deps.clock.timezone());
    if (!isValidLocalDate(d)) return fail('BAD_DATE', 'date must be YYYY-MM-DD', { date });

    const versions = await this.deps.plans.listByPlanDate(ctx.userId, d);
    const res = resolvePlanForDate(versions, d);
    let planStatus: PlanStatus;
    let plan = null;
    if (res.status === 'FOUND') { planStatus = 'FOUND'; plan = res.record; }
    else if (res.status === 'AMBIGUOUS') planStatus = 'AMBIGUOUS';
    else planStatus = 'NONE';

    const daily = await this.deps.daily.getActiveByDate(ctx.userId, d);
    const { weekStart } = getWeekBounds(d);

    return ok({
      date: d,
      dateLabel: dateLabel(d),
      weekStartDate: weekStart,
      weekNumber: plan?.weekNumber ?? null,
      phase: plan?.phase ?? null,
      planStatus,
      plan,
      daily,
    });
  }
}

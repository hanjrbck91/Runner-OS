/**
 * Plan versioning + resolution service (ported from PlanService.gs).
 * Additive versions, effective dating, deterministic resolution, single active
 * version per plan_date, field-level audit. Never destroys history.
 */
import { ok, fail, type Result } from '../result.js';
import type { CoreDependencies, UserContext } from '../ports/index.js';
import type { PlanVersion } from '../domain/types.js';
import { validatePlanFields } from '../domain/rules.js';
import { resolvePlanForDate } from '../domain/plan-resolution.js';
import { addDays, compareDate, isValidLocalDate, type LocalDate } from '../domain/time.js';
import { AuditService, type FieldChange } from './audit-service.js';

export interface CreatePlanInput {
  readonly planDate: LocalDate;
  readonly effectiveFrom?: LocalDate;   // default = planDate
  readonly effectiveTo?: LocalDate | null;
  readonly fields?: Record<string, unknown>;
  readonly reason?: string;
}

export class PlanService {
  private readonly audit: AuditService;
  constructor(private readonly deps: CoreDependencies) {
    this.audit = new AuditService(deps.audit, deps.ids, deps.clock);
  }

  async createVersion(ctx: UserContext, input: CreatePlanInput): Promise<Result<PlanVersion>> {
    const planDate = input.planDate;
    if (!isValidLocalDate(planDate)) return fail('BAD_PLAN_DATE', 'planDate must be YYYY-MM-DD', { planDate });

    let effFrom = input.effectiveFrom;
    if (effFrom === undefined || effFrom === null || effFrom === '') effFrom = planDate;
    if (!isValidLocalDate(effFrom)) return fail('BAD_EFFECTIVE_FROM', 'effectiveFrom must be YYYY-MM-DD', { value: effFrom });

    const effTo = input.effectiveTo ?? null;
    if (effTo !== null && !isValidLocalDate(effTo)) return fail('BAD_EFFECTIVE_TO', 'effectiveTo must be YYYY-MM-DD or null', { value: effTo });
    if (effTo !== null && compareDate(effFrom, effTo) > 0) {
      return fail('INVALID_EFFECTIVE_PERIOD', 'effectiveFrom must not be after effectiveTo', { from: effFrom, to: effTo });
    }

    const v = validatePlanFields(input.fields ?? {});
    if (!v.ok) return fail('VALIDATION', 'plan payload validation failed', { errors: v.errors });

    const existing = await this.deps.plans.listByPlanDate(ctx.userId, planDate);
    let maxVersion = 0;
    let active: PlanVersion | null = null;
    for (const e of existing) {
      if (e.version > maxVersion) maxVersion = e.version;
      if (e.isActive) active = e;
    }
    const nowIso = this.deps.clock.now().toISOString();

    // Close the current active version; new period must start strictly after it.
    if (active) {
      if (compareDate(effFrom, active.effectiveFrom) <= 0) {
        return fail('PLAN_OVERLAP', 'effectiveFrom must be after the current active version', {
          currentActiveFrom: active.effectiveFrom, newFrom: effFrom,
        });
      }
      const closeTo = addDays(effFrom, -1);
      const closed: PlanVersion = { ...active, isActive: false, effectiveTo: closeTo, updatedAt: nowIso };
      await this.deps.plans.update(closed);
      await this.audit.record(ctx, 'Plan', active.id, 'CLOSE_PLAN_VERSION', [
        { field: 'effectiveTo', oldValue: active.effectiveTo, newValue: closeTo },
        { field: 'isActive', oldValue: active.isActive, newValue: false },
      ], input.reason ?? '');
    }

    const n = v.normalized;
    const record: PlanVersion = {
      id: this.deps.ids.newId(),
      userId: ctx.userId,
      planDate,
      version: maxVersion + 1,
      phase: (n.phase as string | null) ?? null,
      runPlan: (n.runPlan as string | null) ?? null,
      longRunPlan: (n.longRunPlan as string | null) ?? null,
      qualityPlan: (n.qualityPlan as string | null) ?? null,
      gymPlan: (n.gymPlan as string | null) ?? null,
      recoveryPlan: (n.recoveryPlan as string | null) ?? null,
      mileageTarget: (n.mileageTarget as number | null) ?? null,
      bodyCompositionTarget: (n.bodyCompositionTarget as string | null) ?? null,
      milestone: (n.milestone as string | null) ?? null,
      weekNumber: (n.weekNumber as number | null) ?? null,
      effectiveFrom: effFrom,
      effectiveTo: effTo,
      isActive: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await this.deps.plans.insert(record);

    const changes: FieldChange[] = [
      { field: 'planDate', oldValue: '', newValue: record.planDate },
      { field: 'version', oldValue: '', newValue: record.version },
      { field: 'effectiveFrom', oldValue: '', newValue: record.effectiveFrom },
      { field: 'effectiveTo', oldValue: '', newValue: record.effectiveTo },
      { field: 'isActive', oldValue: '', newValue: record.isActive },
    ];
    for (const key of Object.keys(n)) {
      if (n[key] !== null) changes.push({ field: key, oldValue: '', newValue: n[key] });
    }
    await this.audit.record(ctx, 'Plan', record.id, 'CREATE_PLAN_VERSION', changes, input.reason ?? '');

    return ok(record);
  }

  async getForDate(ctx: UserContext, date: LocalDate): Promise<Result<PlanVersion>> {
    if (!isValidLocalDate(date)) return fail('BAD_DATE', 'date must be YYYY-MM-DD', { date });
    const versions = await this.deps.plans.listByPlanDate(ctx.userId, date);
    const res = resolvePlanForDate(versions, date);
    if (res.status === 'NOT_FOUND') return fail('NOT_FOUND', `no authoritative plan for ${date}`, { date });
    if (res.status === 'AMBIGUOUS') return fail('PLAN_AMBIGUOUS', `multiple authoritative plans for ${date}`, { date, planIds: res.planIds });
    return ok(res.record);
  }

  async getVersionsForDate(ctx: UserContext, date: LocalDate): Promise<Result<PlanVersion[]>> {
    if (!isValidLocalDate(date)) return fail('BAD_DATE', 'date must be YYYY-MM-DD', { date });
    const versions = (await this.deps.plans.listByPlanDate(ctx.userId, date)).slice().sort((a, b) => a.version - b.version);
    return ok(versions);
  }
}

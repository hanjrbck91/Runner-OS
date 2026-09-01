/**
 * Daily write choke point (ported from DailyService.gs).
 * Server-authoritative date, stable id, immutable createdAt + plan snapshot,
 * field-aware updates, soft delete, field-level audit. Derived Weekly/Monthly
 * are computed ON READ (see AggregationService) — no write-time recalculation.
 */
import { ok, fail, type Result } from '../result.js';
import type { CoreDependencies, UserContext } from '../ports/index.js';
import type { DailyRecord, NutritionAdherence } from '../domain/types.js';
import { validateDailyFields, type FieldPatch } from '../domain/rules.js';
import { resolvePlanForDate } from '../domain/plan-resolution.js';
import { isValidLocalDate, localDateInTimezone, type LocalDate } from '../domain/time.js';
import { AuditService, type FieldChange } from './audit-service.js';

export interface SaveDailyInput {
  readonly date?: LocalDate;          // controlled/back-office; default = server today
  readonly fields: Record<string, unknown>;
  readonly reason?: string;
}

const SNAPSHOT_FIELDS = ['planIdSnapshot', 'planVersionSnapshot'] as const;

export class DailyService {
  private readonly audit: AuditService;
  constructor(private readonly deps: CoreDependencies) {
    this.audit = new AuditService(deps.audit, deps.ids, deps.clock);
  }

  private today(): LocalDate {
    return localDateInTimezone(this.deps.clock.now(), this.deps.clock.timezone());
  }

  async getForDate(ctx: UserContext, date?: LocalDate): Promise<Result<DailyRecord | null>> {
    const d = date ?? this.today();
    if (!isValidLocalDate(d)) return fail('BAD_DATE', 'date must be YYYY-MM-DD', { date });
    return ok(await this.deps.daily.getActiveByDate(ctx.userId, d));
  }

  /** Create or update the Daily record for a date (field-aware). */
  async save(ctx: UserContext, input: SaveDailyInput): Promise<Result<DailyRecord>> {
    const date = input.date ?? this.today();
    if (!isValidLocalDate(date)) return fail('BAD_DATE', 'date must be YYYY-MM-DD', { date: input.date });

    const v = validateDailyFields(input.fields ?? {});
    if (!v.ok) return fail('VALIDATION', 'payload validation failed', { errors: v.errors });

    const existing = await this.deps.daily.getActiveByDate(ctx.userId, date);
    if (existing) return this.applyUpdate(ctx, existing, v.normalized, input.reason ?? '');

    // Create path: reject a blank create. A payload with no fields — OR only
    // clear/null values — has nothing to store, so it must not create a blank
    // active Daily row (which would also occupy the one-active-per-date slot).
    const hasValue = Object.values(v.normalized).some((val) => val !== null);
    if (!hasValue) {
      return fail('NO_FIELDS', 'nothing to save: no Daily values supplied');
    }
    return this.applyCreate(ctx, date, v.normalized, input.reason ?? '');
  }

  async update(ctx: UserContext, id: string, fields: Record<string, unknown>, reason = ''): Promise<Result<DailyRecord>> {
    if (!id) return fail('BAD_ID', 'id required');
    const v = validateDailyFields(fields ?? {});
    if (!v.ok) return fail('VALIDATION', 'payload validation failed', { errors: v.errors });
    const existing = await this.deps.daily.getById(ctx.userId, id);
    if (!existing) return fail('NOT_FOUND', `no Daily record with id ${id}`);
    if (existing.deletedAt !== null) return fail('ALREADY_DELETED', 'record is soft-deleted');
    return this.applyUpdate(ctx, existing, v.normalized, reason);
  }

  async softDelete(ctx: UserContext, id: string, reason = ''): Promise<Result<DailyRecord>> {
    if (!id) return fail('BAD_ID', 'id required');
    const existing = await this.deps.daily.getById(ctx.userId, id);
    if (!existing) return fail('NOT_FOUND', `no Daily record with id ${id}`);
    if (existing.deletedAt !== null) return fail('ALREADY_DELETED', 'record already soft-deleted', { deletedAt: existing.deletedAt });
    const ts = this.deps.clock.now().toISOString();
    const updated: DailyRecord = { ...existing, deletedAt: ts, updatedAt: ts };
    await this.deps.daily.update(updated);
    await this.audit.record(ctx, 'Daily', updated.id, 'SOFT_DELETE', [{ field: 'deletedAt', oldValue: existing.deletedAt, newValue: ts }], reason);
    return ok(updated);
  }

  private async applyCreate(ctx: UserContext, date: LocalDate, patch: FieldPatch, reason: string): Promise<Result<DailyRecord>> {
    const ts = this.deps.clock.now().toISOString();
    let rec: DailyRecord = {
      id: this.deps.ids.newId(),
      userId: ctx.userId,
      date,
      weight: null, sleepHours: null, painScore: null, painLocation: null,
      runActualKm: null, runRpe: null, gymDone: null, nutritionAdherence: null, noteText: null,
      planIdSnapshot: null, planVersionSnapshot: null,
      createdAt: ts, updatedAt: ts, deletedAt: null,
    };
    rec = applyPatch(rec, patch);

    // Auto-snapshot the authoritative plan unless the caller supplied one.
    const callerSuppliedSnapshot = SNAPSHOT_FIELDS.some((f) => f in patch);
    if (!callerSuppliedSnapshot) {
      const versions = await this.deps.plans.listByPlanDate(ctx.userId, date);
      const res = resolvePlanForDate(versions, date);
      if (res.status === 'FOUND') {
        rec = { ...rec, planIdSnapshot: res.record.id, planVersionSnapshot: res.record.version };
      }
    }

    // DB-authoritative atomic create. On a concurrent race the winner already
    // created the active row; merge this request's fields as a field-aware
    // update so no data is lost and exactly one active row exists.
    const res = await this.deps.daily.createActive(rec);
    if (!res.created) {
      return this.applyUpdate(ctx, res.record, patch, reason);
    }

    const changes: FieldChange[] = [];
    for (const key of Object.keys(patch)) {
      const val = patch[key];
      if (val !== null) changes.push({ field: key, oldValue: '', newValue: val });
    }
    if (!callerSuppliedSnapshot && rec.planIdSnapshot !== null) {
      changes.push({ field: 'planIdSnapshot', oldValue: '', newValue: rec.planIdSnapshot });
      changes.push({ field: 'planVersionSnapshot', oldValue: '', newValue: rec.planVersionSnapshot });
    }
    await this.audit.record(ctx, 'Daily', rec.id, 'CREATE', changes, reason);
    return ok(rec);
  }

  private async applyUpdate(ctx: UserContext, existing: DailyRecord, patch: FieldPatch, reason: string): Promise<Result<DailyRecord>> {
    // Snapshot fields are immutable after creation.
    for (const f of SNAPSHOT_FIELDS) {
      if (f in patch) return fail('VALIDATION', `${f} is immutable after creation`, { field: f });
    }
    const changes: FieldChange[] = [];
    const before = existing as unknown as Record<string, unknown>;
    const next: Record<string, unknown> = { ...before };
    for (const key of Object.keys(patch)) {
      const newVal = patch[key];
      const oldVal = before[key] ?? null;
      if (oldVal !== newVal) {
        changes.push({ field: key, oldValue: oldVal, newValue: newVal });
        next[key] = newVal;
      }
    }
    if (changes.length === 0) return ok(existing); // no-op: no timestamp bump, no audit noise

    next.updatedAt = this.deps.clock.now().toISOString();
    const updated = next as unknown as DailyRecord;
    await this.deps.daily.update(updated);
    await this.audit.record(ctx, 'Daily', updated.id, 'UPDATE', changes, reason);
    return ok(updated);
  }
}

function applyPatch(rec: DailyRecord, patch: FieldPatch): DailyRecord {
  const obj = { ...(rec as unknown as Record<string, unknown>) };
  for (const key of Object.keys(patch)) obj[key] = patch[key];
  // nutritionAdherence is validated to the enum already
  return obj as unknown as DailyRecord & { nutritionAdherence: NutritionAdherence | null };
}

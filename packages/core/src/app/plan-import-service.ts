/**
 * Training-plan CSV IMPORT (MC-025).
 *
 *   UPLOAD → PARSE → VALIDATE → PREVIEW → CONFIRM → NEW PLAN VERSION → FUTURE ONLY
 *
 * Safety contract (non-negotiable):
 *  - CSV content is UNTRUSTED. Every row is validated before ANY write.
 *  - A failed validation performs ZERO database writes (validation is a pure,
 *    read-only pass; writes happen only in commit(), after re-validation).
 *  - FUTURE-ONLY: every plan_date must be >= today. Past dates are rejected, so
 *    the importer can never rewrite historical actuals or historical plan
 *    versions. Existing Daily records are never touched.
 *  - Imports reuse the EXISTING plan model via PlanService.createVersion — no
 *    second plan table, no schema change.
 *  - Idempotency: an import whose dates already have an active plan version is
 *    rejected with an explicit conflict list rather than silently duplicating.
 *  - user-scoped: userId comes from ctx (server-derived); never from the CSV.
 */
import { ok, fail, type Result } from '../result.js';
import type { CoreDependencies, UserContext } from '../ports/index.js';
import type { LocalDate } from '../domain/time.js';
import { localDateInTimezone, compareDate } from '../domain/time.js';
import {
  parsePlanCsv, mapPlanRow, PLAN_CSV_COLUMNS, PLAN_CSV_REQUIRED_COLUMNS,
  type MappedPlanRow, type RowError,
} from '../domain/plan-csv.js';
import { PlanService } from './plan-service.js';

export interface WeekSummary {
  readonly weekNumber: number;
  readonly phase: string;
  readonly plannedKm: number;
  readonly sessions: number; // rows that map to a tracked run OR gym (not rest)
}

export interface ImportPreview {
  readonly valid: boolean;
  readonly rowCount: number;
  readonly dateRange: { readonly start: LocalDate; readonly end: LocalDate } | null;
  readonly weekCount: number;
  readonly totalPlannedKm: number;
  readonly plannedKmByWeek: readonly WeekSummary[];
  readonly phaseDistribution: ReadonlyArray<{ readonly phase: string; readonly count: number }>;
  readonly sessionDistribution: ReadonlyArray<{ readonly type: string; readonly count: number }>;
  readonly planLabel: string | null;
  readonly errors: readonly RowError[];   // blocking
  readonly warnings: readonly string[];   // non-blocking notes
  readonly rows: ReadonlyArray<PreviewRow>;
}

export interface PreviewRow {
  readonly date: LocalDate;
  readonly weekNumber: number;
  readonly phase: string;
  readonly sessionType: string;
  readonly slot: string;
  readonly plannedKm: number | null;
  readonly summary: string;
}

export interface ImportResult {
  readonly planLabel: string | null;
  readonly versionsCreated: number;
  readonly dateRange: { readonly start: LocalDate; readonly end: LocalDate };
  readonly weekCount: number;
  readonly sessionCount: number;
  readonly totalPlannedKm: number;
  readonly effectiveFrom: LocalDate;
}

const MAX_ROWS = 400; // a 20-week daily plan is ~140 rows; guard against abuse.

function previewRow(m: MappedPlanRow): PreviewRow {
  return {
    date: m.planDate, weekNumber: m.weekNumber, phase: m.phase, sessionType: m.sessionType,
    slot: m.slot, plannedKm: m.plannedKm, summary: m.summary,
  };
}

export class PlanImportService {
  private readonly plans: PlanService;
  constructor(private readonly deps: CoreDependencies) {
    this.plans = new PlanService(deps);
  }

  private today(): LocalDate {
    return localDateInTimezone(this.deps.clock.now(), this.deps.clock.timezone());
  }

  /**
   * Pure, READ-ONLY validation + preview. Performs NO writes. Structural/parse
   * failures return a fail Result; row-level problems come back inside a preview
   * with `valid:false` so the UI can render every error at once.
   */
  async preview(ctx: UserContext, csvText: string): Promise<Result<ImportPreview>> {
    if (typeof csvText !== 'string' || csvText.trim() === '') {
      return fail('IMPORT_INVALID', 'CSV file is empty');
    }

    const parsed = parsePlanCsv(csvText);
    if (parsed.header.length === 0) return fail('IMPORT_INVALID', 'CSV has no header row');

    // Header contract: no unexpected/system columns; required columns present.
    const known = new Set<string>(PLAN_CSV_COLUMNS as readonly string[]);
    const unexpected = parsed.header.filter((h) => !known.has(h));
    if (unexpected.length > 0) {
      return fail('IMPORT_INVALID', `unexpected column(s): ${unexpected.join(', ')}`, { unexpected });
    }
    const missingCols = PLAN_CSV_REQUIRED_COLUMNS.filter((c) => !parsed.header.includes(c));
    if (missingCols.length > 0) {
      return fail('IMPORT_INVALID', `missing required column(s): ${missingCols.join(', ')}`, { missing: missingCols });
    }
    if (parsed.rows.length === 0) return fail('IMPORT_INVALID', 'CSV has a header but no data rows');
    if (parsed.rows.length > MAX_ROWS) return fail('IMPORT_INVALID', `too many rows (${parsed.rows.length} > ${MAX_ROWS})`);

    const errors: RowError[] = [];
    const warnings: string[] = [];
    const mapped: MappedPlanRow[] = [];
    for (const raw of parsed.rows) {
      const r = mapPlanRow(raw);
      if (r.ok) mapped.push(r.row);
      else errors.push(...r.errors);
    }

    // Cross-row: duplicate dates within the file.
    const seen = new Map<LocalDate, number>();
    for (const m of mapped) {
      const prev = seen.get(m.planDate);
      if (prev !== undefined) errors.push({ line: 0, field: 'date', message: `duplicate date ${m.planDate} in file` });
      else seen.set(m.planDate, 1);
    }

    // Future-only: reject any past date. Historical training is never modified.
    const today = this.today();
    for (const m of mapped) {
      if (compareDate(m.planDate, today) < 0) {
        errors.push({ line: 0, field: 'date', message: `date ${m.planDate} is in the past (today ${today}); imports are future-only` });
      }
    }

    // Idempotency / duplicate protection: reject dates that already have an
    // active plan version (a fresh re-import of the same CSV lands here).
    if (mapped.length > 0 && errors.length === 0) {
      const start = mapped.reduce((a, m) => (compareDate(m.planDate, a) < 0 ? m.planDate : a), mapped[0]!.planDate);
      const end = mapped.reduce((a, m) => (compareDate(m.planDate, a) > 0 ? m.planDate : a), mapped[0]!.planDate);
      const existing = await this.deps.plans.listByPlanDateRange(ctx.userId, start, end);
      const activeDates = new Set(existing.filter((e) => e.isActive).map((e) => e.planDate));
      const conflicts = mapped.filter((m) => activeDates.has(m.planDate)).map((m) => m.planDate);
      if (conflicts.length > 0) {
        errors.push({ line: 0, field: 'date', message: `${conflicts.length} date(s) already have an active plan version — import rejected to avoid duplicates (e.g. ${conflicts.slice(0, 3).join(', ')})` });
      }
    }

    const preview = this.buildPreview(mapped, errors, warnings);
    return ok(preview);
  }

  private buildPreview(mapped: MappedPlanRow[], errors: RowError[], warnings: string[]): ImportPreview {
    const sorted = [...mapped].sort((a, b) => compareDate(a.planDate, b.planDate));
    const byWeek = new Map<number, WeekSummary>();
    const phaseCount = new Map<string, number>();
    const sessionCount = new Map<string, number>();
    let totalKm = 0;
    const labels = new Set<string>();

    for (const m of sorted) {
      totalKm += m.plannedKm ?? 0;
      phaseCount.set(m.phase, (phaseCount.get(m.phase) ?? 0) + 1);
      sessionCount.set(m.sessionType, (sessionCount.get(m.sessionType) ?? 0) + 1);
      if (m.planLabel) labels.add(m.planLabel);
      const isTracked = m.slot === 'runPlan' || m.slot === 'longRunPlan' || m.slot === 'qualityPlan' || m.slot === 'gymPlan';
      const w = byWeek.get(m.weekNumber) ?? { weekNumber: m.weekNumber, phase: m.phase, plannedKm: 0, sessions: 0 };
      byWeek.set(m.weekNumber, {
        weekNumber: m.weekNumber,
        phase: w.phase,
        plannedKm: Math.round((w.plannedKm + (m.plannedKm ?? 0)) * 100) / 100,
        sessions: w.sessions + (isTracked ? 1 : 0),
      });
    }

    return {
      valid: errors.length === 0 && sorted.length > 0,
      rowCount: sorted.length,
      dateRange: sorted.length ? { start: sorted[0]!.planDate, end: sorted[sorted.length - 1]!.planDate } : null,
      weekCount: byWeek.size,
      totalPlannedKm: Math.round(totalKm * 100) / 100,
      plannedKmByWeek: [...byWeek.values()].sort((a, b) => a.weekNumber - b.weekNumber),
      phaseDistribution: [...phaseCount.entries()].map(([phase, count]) => ({ phase, count })),
      sessionDistribution: [...sessionCount.entries()].map(([type, count]) => ({ type, count })),
      planLabel: labels.size === 1 ? [...labels][0]! : (labels.size > 1 ? [...labels].join(', ') : null),
      errors,
      warnings,
      rows: sorted.map(previewRow),
    };
  }

  /**
   * Commit the import. Re-runs the full validation first; if anything is
   * invalid it returns a fail Result and writes NOTHING. On success it creates
   * one new plan version per day via PlanService.createVersion (additive,
   * effective-dated, audited) — preserving all previous versions and every
   * Daily actual.
   */
  async commit(ctx: UserContext, csvText: string): Promise<Result<ImportResult>> {
    const pv = await this.preview(ctx, csvText);
    if (!pv.ok) return pv;
    const preview = pv.data;
    if (!preview.valid) {
      return fail('IMPORT_INVALID', 'import has validation errors; nothing was written', { errors: preview.errors });
    }

    // Re-derive the mapped rows deterministically (preview proved them valid).
    const parsed = parsePlanCsv(csvText);
    const mapped: MappedPlanRow[] = [];
    for (const raw of parsed.rows) {
      const r = mapPlanRow(raw);
      if (r.ok) mapped.push(r.row);
    }
    const sorted = [...mapped].sort((a, b) => compareDate(a.planDate, b.planDate));

    const label = preview.planLabel ?? 'imported plan';
    let created = 0;
    let sessionCount = 0;
    for (const m of sorted) {
      const res = await this.plans.createVersion(ctx, {
        planDate: m.planDate,
        // effectiveFrom defaults to planDate; each daily version resolves only
        // for its own date. FUTURE-only is already guaranteed by validation.
        fields: m.fields,
        reason: `plan import (${label})`,
      });
      if (!res.ok) {
        // Should be unreachable after validation; surface honestly, don't guess.
        return fail('IMPORT_INVALID', `write failed for ${m.planDate} after validation`, { date: m.planDate, cause: res.error });
      }
      created += 1;
      if (m.slot === 'runPlan' || m.slot === 'longRunPlan' || m.slot === 'qualityPlan' || m.slot === 'gymPlan') sessionCount += 1;
    }

    const start = sorted[0]!.planDate;
    const end = sorted[sorted.length - 1]!.planDate;
    return ok({
      planLabel: preview.planLabel,
      versionsCreated: created,
      dateRange: { start, end },
      weekCount: preview.weekCount,
      sessionCount,
      totalPlannedKm: preview.totalPlannedKm,
      effectiveFrom: start,
    });
  }
}

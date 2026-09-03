/**
 * Coach → Runner OS training-plan CSV contract + parsing + row→plan mapping.
 *
 * PURE and framework-free: no I/O, no DB, no clock. The importer service
 * (app/plan-import-service.ts) layers stateful validation (past dates, existing
 * active plans) and writes on top of these deterministic building blocks.
 *
 * One CSV row = one calendar day = one plan_date. Each row maps onto the
 * EXISTING plan model (plan_versions) — no new plan fields are invented. The
 * coach's descriptive session is placed into exactly ONE plan slot so the
 * ratified completion model (runPlan|longRunPlan|qualityPlan collectively = one
 * expected run; gymPlan = one expected gym; recovery not tracked) stays intact.
 */
import type { LocalDate } from './time.js';
import { isValidLocalDate } from './time.js';

/** The exact input contract (header order is stable; extra columns rejected). */
export const PLAN_CSV_COLUMNS = [
  'date', 'week_number', 'phase', 'day', 'session_type', 'planned_distance_km',
  'target_pace', 'target_effort', 'planned_duration', 'workout_description',
  'planned_status', 'plan_version', 'coach_notes',
] as const;
export type PlanCsvColumn = (typeof PLAN_CSV_COLUMNS)[number];

/** Columns a row MUST carry a usable value in. */
export const PLAN_CSV_REQUIRED_COLUMNS: readonly PlanCsvColumn[] = ['date', 'week_number', 'phase', 'session_type'];

/** planned_status values the coach may use (informational; drives nothing structural). */
export const PLAN_STATUS_VALUES = ['planned', 'rest', 'strength', 'race'] as const;

export interface RawPlanRow {
  readonly line: number; // 1-based source line (header = 1)
  readonly cells: Record<string, string>;
}

export interface PlanCsvParse {
  readonly header: string[];
  readonly rows: RawPlanRow[];
}

/** Which plan slot a coach session_type maps onto. */
export type PlanSlot = 'longRunPlan' | 'gymPlan' | 'recoveryPlan' | 'qualityPlan' | 'runPlan';

const QUALITY_KEYWORDS = ['tempo', 'threshold', 'progression', 'marathon', 'pace', 'interval', 'fartlek', 'race', 'effort'];

/**
 * Deterministic session_type -> plan slot classification. Order matters:
 *   long  -> longRunPlan   (the week's long run)
 *   strength/gym -> gymPlan
 *   rest/off -> recoveryPlan (NOT a tracked expected session)
 *   quality keyword -> qualityPlan
 *   anything else (Easy, Easy + Strides, …) -> runPlan
 */
export function classifySession(sessionType: string): PlanSlot {
  const s = sessionType.trim().toLowerCase();
  if (/\blong\b/.test(s)) return 'longRunPlan';
  if (s.includes('strength') || s.includes('gym')) return 'gymPlan';
  if (s.includes('rest') || s === 'off' || s.includes('recovery')) return 'recoveryPlan';
  if (QUALITY_KEYWORDS.some((k) => s.includes(k))) return 'qualityPlan';
  return 'runPlan';
}

/**
 * RFC-4180 CSV parser (handles quoted fields, embedded commas/newlines, ""
 * escapes, CRLF or LF). Rejects nothing structurally here — validation is the
 * importer's job — but a header is required.
 */
export function parsePlanCsv(text: string): PlanCsvParse {
  const src = text.replace(/^﻿/, ''); // strip BOM
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  const pushField = (): void => { record.push(field); field = ''; };
  const pushRecord = (): void => { pushField(); records.push(record); record = []; };
  while (i < src.length) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === ',') { pushField(); i += 1; continue; }
    if (c === '\r') { if (src[i + 1] === '\n') i += 1; pushRecord(); i += 1; continue; }
    if (c === '\n') { pushRecord(); i += 1; continue; }
    field += c; i += 1;
  }
  // flush trailing field/record unless the file ended exactly on a newline
  if (field !== '' || record.length > 0) pushRecord();

  // Drop fully-empty trailing records (blank lines).
  const nonEmpty = records.filter((r) => !(r.length === 1 && r[0]!.trim() === ''));
  if (nonEmpty.length === 0) return { header: [], rows: [] };

  const header = nonEmpty[0]!.map((h) => h.trim());
  const rows: RawPlanRow[] = [];
  for (let r = 1; r < nonEmpty.length; r += 1) {
    const cols = nonEmpty[r]!;
    const cells: Record<string, string> = {};
    for (let c = 0; c < header.length; c += 1) cells[header[c]!] = (cols[c] ?? '').trim();
    rows.push({ line: r + 1, cells });
  }
  return { header, rows };
}

export interface MappedPlanRow {
  readonly planDate: LocalDate;
  readonly weekNumber: number;
  readonly phase: string;
  readonly sessionType: string;
  readonly slot: PlanSlot;
  readonly plannedKm: number | null;
  readonly plannedStatus: string;
  readonly planLabel: string;
  /** Plan fields ready for PlanService.createVersion. */
  readonly fields: Record<string, unknown>;
  /** Human-readable session summary (for preview + slot text). */
  readonly summary: string;
}

export interface RowError {
  readonly line: number;
  readonly field: string;
  readonly message: string;
}

/** Parse a numeric cell strictly; '' => null; bad => undefined (caller reports). */
function num(raw: string): number | null | undefined {
  if (raw === '') return null;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Compose a readable one-line session summary from the coach fields. */
function composeSummary(cells: Record<string, string>): string {
  const parts: string[] = [];
  const st = cells['session_type'] ?? '';
  if (st) parts.push(st);
  const km = cells['planned_distance_km'] ?? '';
  if (km) parts.push(`${km} km`);
  const effort = cells['target_effort'] ?? '';
  if (effort) parts.push(effort);
  const pace = cells['target_pace'] ?? '';
  if (pace) parts.push(`@ ${pace}`);
  const desc = (cells['workout_description'] ?? '').trim();
  if (desc && desc.toLowerCase() !== st.toLowerCase()) parts.push(`— ${desc}`);
  return parts.join(' ').trim();
}

/**
 * Validate + map ONE raw row onto the plan model. Returns either the mapped row
 * or a list of field errors (never throws for data problems).
 */
export function mapPlanRow(raw: RawPlanRow): { ok: true; row: MappedPlanRow } | { ok: false; errors: RowError[] } {
  const errors: RowError[] = [];
  const c = raw.cells;
  const err = (field: string, message: string): void => { errors.push({ line: raw.line, field, message }); };

  const date = c['date'] ?? '';
  if (!isValidLocalDate(date)) err('date', `invalid date "${date}" (expected YYYY-MM-DD)`);

  const wkRaw = c['week_number'] ?? '';
  const wk = num(wkRaw);
  if (wk === undefined || wk === null || !Number.isInteger(wk) || wk < 1 || wk > 20) {
    err('week_number', `week_number must be an integer 1..20 (got "${wkRaw}")`);
  }

  const phase = (c['phase'] ?? '').trim();
  if (phase === '') err('phase', 'phase is required');

  const sessionType = (c['session_type'] ?? '').trim();
  if (sessionType === '') err('session_type', 'session_type is required');

  const km = num(c['planned_distance_km'] ?? '');
  if (km === undefined) err('planned_distance_km', `planned_distance_km must be a number (got "${c['planned_distance_km']}")`);
  else if (km !== null && km < 0) err('planned_distance_km', 'planned_distance_km must be >= 0');

  const status = (c['planned_status'] ?? '').trim().toLowerCase();
  if (status !== '' && !(PLAN_STATUS_VALUES as readonly string[]).includes(status)) {
    err('planned_status', `planned_status must be one of ${PLAN_STATUS_VALUES.join('/')} (got "${status}")`);
  }

  if (errors.length > 0) return { ok: false, errors };

  const slot = classifySession(sessionType);
  const summary = composeSummary(c) || sessionType;
  const fields: Record<string, unknown> = {
    weekNumber: wk as number,
    phase,
  };
  fields[slot] = summary;
  if (km !== null && km !== undefined) fields['mileageTarget'] = km;
  // A race day carries the event as a milestone (single, deterministic).
  if (slot === 'qualityPlan' && /\brace\b/i.test(sessionType)) {
    fields['milestone'] = (c['workout_description'] ?? '').trim() || sessionType;
  }

  return {
    ok: true,
    row: {
      planDate: date,
      weekNumber: wk as number,
      phase,
      sessionType,
      slot,
      plannedKm: km ?? null,
      plannedStatus: status,
      planLabel: (c['plan_version'] ?? '').trim(),
      fields,
      summary,
    },
  };
}

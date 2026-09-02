/**
 * Deterministic Coach CSV (MC-024, Phase 6). Stable column contract; NOT a DB
 * dump. Critically distinguishes MISSING vs ZERO vs FALSE:
 *   - missing value        -> "" (empty cell)
 *   - a real number incl 0 -> the number (so 0 km logged != no run)
 *   - gym_completed        -> "true" / "false" / "" (false != no gym entry)
 * RFC-4180 quoting. No secrets/internal ids in the output.
 */
import type { CoachReport, CoachDayRow } from '../app/report-service.js';

export const COACH_CSV_COLUMNS = [
  'date',
  'week_number',
  'phase',
  'plan_version',
  'plan_status',
  'planned_session',
  'planned_gym',
  'actual_km',
  'rpe',
  'pain',
  'gym_completed',
  'weight_kg',
  'sleep_hours',
  'nutrition',
  'note',
  'expected_sessions',
  'completed_sessions',
] as const;

function esc(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
function num(v: number | null): string { return v === null || v === undefined ? '' : String(v); }
function str(v: string | null): string { return v === null || v === undefined ? '' : v; }
function bool(v: boolean | null): string { return v === null || v === undefined ? '' : v ? 'true' : 'false'; }

function row(d: CoachDayRow): string[] {
  return [
    d.date,
    num(d.weekNumber),
    str(d.phase),
    num(d.planVersion),
    d.planStatus,
    str(d.plannedSession),
    str(d.plannedGym),
    num(d.actualKm),
    num(d.rpe),
    num(d.pain),
    bool(d.gymCompleted),
    num(d.weightKg),
    num(d.sleepHours),
    str(d.nutrition),
    str(d.note),
    String(d.expectedSessions),
    String(d.completedSessions),
  ];
}

/** Serialize one weekly report to CSV (header + one row per day). Deterministic. */
export function reportToCsv(report: CoachReport): string {
  const lines: string[] = [];
  lines.push(COACH_CSV_COLUMNS.join(','));
  for (const d of report.days) lines.push(row(d).map(esc).join(','));
  return lines.join('\r\n') + '\r\n';
}

/** Suggested filename for a weekly export (no secrets/ids). */
export function weeklyCsvFilename(report: CoachReport): string {
  return `runner-os_week_${report.weekStart}.csv`;
}

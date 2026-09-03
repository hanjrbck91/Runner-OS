/** Display formatting only — no calculations. The API is authoritative. */
export const dash = '—';

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

/** '2026-09-08' -> 'TUE 08 SEP' (athlete-facing). Invalid input passes through. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso ?? dash;
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  return `${DOW[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, '0')} ${MON[d.getUTCMonth()]}`;
}

/** '2026-09-08' -> '08 SEP' (no weekday; for compact ranges). */
export function fmtShort(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso ?? dash;
  const d = new Date(iso + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MON[d.getUTCMonth()]}`;
}

/** '2026-09-07'..'2026-09-13' -> '07 SEP → 13 SEP'. */
export function fmtRange(start: string | null | undefined, end: string | null | undefined): string {
  return `${fmtShort(start)} → ${fmtShort(end)}`;
}

export function show(v: number | string | null | undefined, unit = ''): string {
  if (v === null || v === undefined || v === '') return dash;
  return unit ? `${v} ${unit}` : String(v);
}

/** Nutrition 0..1 score -> label. Presentation only. */
export function nutritionLabel(score: number | null): string {
  if (score === null) return dash;
  if (score >= 0.75) return `ON (${score})`;
  if (score >= 0.25) return `MOST (${score})`;
  return `OFF (${score})`;
}

export function humanError(error: { code: string; message: string } | null): string {
  if (!error) return 'Something went wrong.';
  switch (error.code) {
    case 'UNAUTHENTICATED': return 'Please sign in.';
    case 'FORBIDDEN': return 'Not authorized.';
    case 'VALIDATION': return 'Check your input.';
    case 'NO_FIELDS': return 'Nothing to save.';
    case 'NETWORK': return 'Network error — try again.';
    case 'INTEGRITY_DUPLICATE': return 'Data conflict for today.';
    case 'PLAN_AMBIGUOUS': return 'Plan conflict — fix plan versions.';
    default: return error.message || 'Error.';
  }
}

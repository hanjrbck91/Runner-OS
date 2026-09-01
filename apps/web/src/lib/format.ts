/** Display formatting only — no calculations. The API is authoritative. */
export const dash = '—';

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

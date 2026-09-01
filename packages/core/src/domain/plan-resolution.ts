/**
 * Deterministic plan resolution (ported from resolvePlanForDate_).
 * Pure function shared by the plan service AND aggregation completion — one
 * source of resolution truth, no divergence. Never guesses: >1 authoritative
 * version is AMBIGUOUS (an integrity failure), not a silent pick.
 */
import type { PlanVersion } from './types.js';
import { compareDate, type LocalDate } from './time.js';

export type PlanResolution =
  | { readonly status: 'FOUND'; readonly record: PlanVersion }
  | { readonly status: 'NOT_FOUND' }
  | { readonly status: 'AMBIGUOUS'; readonly planIds: string[] };

/**
 * Resolve the authoritative plan version for `date` among the versions for a
 * single planDate. A version is authoritative when:
 *   isActive AND effectiveFrom <= date AND (effectiveTo is null OR date <= effectiveTo)
 */
export function resolvePlanForDate(versions: readonly PlanVersion[], date: LocalDate): PlanResolution {
  const matches = versions.filter((v) => {
    if (!v.isActive) return false;
    if (compareDate(v.effectiveFrom, date) > 0) return false;
    if (v.effectiveTo !== null && compareDate(date, v.effectiveTo) > 0) return false;
    return true;
  });
  if (matches.length === 0) return { status: 'NOT_FOUND' };
  if (matches.length > 1) return { status: 'AMBIGUOUS', planIds: matches.map((m) => m.id) };
  return { status: 'FOUND', record: matches[0]! };
}

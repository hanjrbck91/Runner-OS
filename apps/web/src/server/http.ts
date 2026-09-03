/**
 * Result -> HTTP mapping. Framework-free (no Next types) so it is unit-testable
 * and reusable by any transport. Never leaks stack traces or DB internals.
 */
import type { Result, ErrorCode } from '@runner-os/core';

export interface ApiResult {
  readonly status: number;
  readonly body: unknown; // always the normalized { ok, data, error } envelope
}

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION: 400,
  BAD_DATE: 400,
  BAD_ID: 400,
  BAD_PLAN_DATE: 400,
  BAD_EFFECTIVE_FROM: 400,
  BAD_EFFECTIVE_TO: 400,
  INVALID_EFFECTIVE_PERIOD: 400,
  NO_FIELDS: 400,
  BAD_MONTH: 400,
  NOT_FOUND: 404,
  PLAN_AMBIGUOUS: 409,
  INTEGRITY_DUPLICATE: 409,
  PLAN_OVERLAP: 409,
  ALREADY_DELETED: 409,
  IMPORT_INVALID: 400,
  IMPORT_CONFLICT: 409,
};

export function fromResult<T>(r: Result<T>): ApiResult {
  if (r.ok) return { status: 200, body: r };
  return { status: STATUS_BY_CODE[r.error.code] ?? 400, body: r };
}

function errBody(code: string, message: string): unknown {
  return { ok: false, data: null, error: { code, message } };
}

export const unauthenticated = (): ApiResult => ({ status: 401, body: errBody('UNAUTHENTICATED', 'authentication required') });
export const forbidden = (): ApiResult => ({ status: 403, body: errBody('FORBIDDEN', 'not authorized') });
export const badRequest = (code: string, message: string, details?: unknown): ApiResult => ({
  status: 400,
  body: { ok: false, data: null, error: details === undefined ? { code, message } : { code, message, details } },
});
export const internal = (): ApiResult => ({ status: 500, body: errBody('INTERNAL', 'internal server error') });

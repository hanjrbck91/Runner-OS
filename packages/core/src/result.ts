/**
 * Normalized application result contract (ported from the Apps Script
 * svcOk_/svcFail_ convention). Expected domain/application failures are
 * RETURNED as `Result`, never thrown. Programming/infrastructure faults may
 * still throw (see docs/DECISIONS in the M07-B report).
 */

export type ErrorCode =
  | 'VALIDATION'
  | 'BAD_DATE'
  | 'BAD_ID'
  | 'BAD_PLAN_DATE'
  | 'BAD_EFFECTIVE_FROM'
  | 'BAD_EFFECTIVE_TO'
  | 'INVALID_EFFECTIVE_PERIOD'
  | 'PLAN_OVERLAP'
  | 'PLAN_AMBIGUOUS'
  | 'NOT_FOUND'
  | 'ALREADY_DELETED'
  | 'INTEGRITY_DUPLICATE'
  | 'NO_FIELDS'
  | 'BAD_MONTH';

export interface AppError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: unknown;
}

export interface Ok<T> {
  readonly ok: true;
  readonly data: T;
  readonly error: null;
}

export interface Err {
  readonly ok: false;
  readonly data: null;
  readonly error: AppError;
}

export type Result<T> = Ok<T> | Err;

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data, error: null };
}

export function fail(code: ErrorCode, message: string, details?: unknown): Err {
  return { ok: false, data: null, error: details === undefined ? { code, message } : { code, message, details } };
}

export function isOk<T>(r: Result<T>): r is Ok<T> {
  return r.ok;
}

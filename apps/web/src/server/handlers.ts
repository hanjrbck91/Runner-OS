/**
 * Framework-free API handlers. Each handler:
 *   authenticate -> Zod transport validation -> field-aware mapping ->
 *   core application service (domain validation is authoritative there) ->
 *   Result -> HTTP.
 * No Next.js types here; route.ts files are thin adapters that call these.
 * Business logic never lives in route files.
 */
import {
  createServices, localDateInTimezone, isValidLocalDate,
  type CoreDependencies, type Result,
} from '@runner-os/core';
import {
  WeightLogSchema, RunLogSchema, GymLogSchema, NoteLogSchema, LocalDateSchema,
} from '@runner-os/shared';
import { authenticate, type AuthEnv, type SessionInfo } from './session.js';
import { fromResult, badRequest, internal, type ApiResult } from './http.js';
import { mapPresentFields } from './fields.js';

export interface Env extends AuthEnv {
  readonly deps: CoreDependencies;
}

interface Req {
  readonly session: SessionInfo | null;
  readonly body?: unknown;
  readonly query?: Record<string, string | undefined>;
}

function serverToday(env: Env): string {
  return localDateInTimezone(env.deps.clock.now(), env.deps.clock.timezone());
}

/** Wrap a handler body: resolve auth, run, and never leak thrown internals. */
async function guard(env: Env, session: SessionInfo | null, run: (ctx: import('@runner-os/core').UserContext) => Promise<ApiResult>): Promise<ApiResult> {
  try {
    const auth = await authenticate(env, session);
    if (!auth.ok) return auth.response;
    return await run(auth.ctx);
  } catch {
    return internal();
  }
}

function asObject(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

// ---- GET /api/today ----
export function today(env: Env, req: Req): Promise<ApiResult> {
  return guard(env, req.session, async (ctx) => {
    const svc = createServices(env.deps);
    return fromResult(await svc.today.getToday(ctx));
  });
}

// ---- GET /api/weekly ----
export function weekly(env: Env, req: Req): Promise<ApiResult> {
  return guard(env, req.session, async (ctx) => {
    const svc = createServices(env.deps);
    return fromResult(await svc.aggregation.getWeekly(ctx, serverToday(env)));
  });
}

// ---- GET /api/plan?date=YYYY-MM-DD (read-only resolution) ----
export function plan(env: Env, req: Req): Promise<ApiResult> {
  return guard(env, req.session, async (ctx) => {
    const raw = req.query?.date ?? serverToday(env);
    const shape = LocalDateSchema.safeParse(raw);
    if (!shape.success) return badRequest('BAD_DATE', 'date must be YYYY-MM-DD');
    if (!isValidLocalDate(raw)) return badRequest('BAD_DATE', 'not a valid calendar date', { date: raw });
    const svc = createServices(env.deps);
    return fromResult(await svc.plans.getForDate(ctx, raw));
  });
}

// ---- Shared log-save flow ----
function saveWithFields(env: Env, req: Req, parse: (b: Record<string, unknown>) => { ok: true; fields: Record<string, unknown> } | { ok: false; res: ApiResult }): Promise<ApiResult> {
  return guard(env, req.session, async (ctx) => {
    const parsed = parse(asObject(req.body));
    if (!parsed.ok) return parsed.res;
    const svc = createServices(env.deps);
    // Date is ALWAYS server-derived for daily logs; client cannot supply it.
    return fromResult((await svc.daily.save(ctx, { fields: parsed.fields, reason: 'api' })) as Result<unknown>);
  });
}

// ---- POST /api/log/weight ----
export function saveWeight(env: Env, req: Req): Promise<ApiResult> {
  return saveWithFields(env, req, (body) => {
    const p = WeightLogSchema.safeParse(body);
    if (!p.success) return { ok: false, res: badRequest('VALIDATION', 'invalid payload', { errors: p.error.issues }) };
    return { ok: true, fields: mapPresentFields(body, { weight: 'weight', sleep: 'sleepHours' }) };
  });
}

// ---- POST /api/log/run ----
export function saveRun(env: Env, req: Req): Promise<ApiResult> {
  return saveWithFields(env, req, (body) => {
    const p = RunLogSchema.safeParse(body);
    if (!p.success) return { ok: false, res: badRequest('VALIDATION', 'invalid payload', { errors: p.error.issues }) };
    return { ok: true, fields: mapPresentFields(body, { km: 'runActualKm', rpe: 'runRpe', pain: 'painScore', note: 'noteText' }) };
  });
}

// ---- POST /api/log/gym ----
export function saveGym(env: Env, req: Req): Promise<ApiResult> {
  return saveWithFields(env, req, (body) => {
    const p = GymLogSchema.safeParse(body);
    if (!p.success) return { ok: false, res: badRequest('VALIDATION', 'invalid payload', { errors: p.error.issues }) };
    return { ok: true, fields: mapPresentFields(body, { completed: 'gymDone' }) };
  });
}

// ---- POST /api/log/note ----
export function saveNote(env: Env, req: Req): Promise<ApiResult> {
  return saveWithFields(env, req, (body) => {
    const p = NoteLogSchema.safeParse(body);
    if (!p.success) return { ok: false, res: badRequest('VALIDATION', 'invalid payload', { errors: p.error.issues }) };
    return { ok: true, fields: mapPresentFields(body, { note: 'noteText' }) };
  });
}

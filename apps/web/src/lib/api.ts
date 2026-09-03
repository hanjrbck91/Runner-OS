/**
 * Runner OS API client. The ONLY way the UI talks to the server. No business
 * logic, no DB, no auth authority here — just typed fetch wrappers over the
 * M07-D JSON API. Future native clients can reuse the same contract.
 */

export interface AppError {
  code: string;
  message: string;
  details?: unknown;
}
export type ApiEnvelope<T> =
  | { ok: true; data: T; error: null }
  | { ok: false; data: null; error: AppError };

export interface PlanView {
  id: string;
  phase: string | null;
  runPlan: string | null;
  longRunPlan: string | null;
  qualityPlan: string | null;
  gymPlan: string | null;
  recoveryPlan: string | null;
  milestone: string | null;
  weekNumber: number | null;
  version: number;
}
export interface DailyView {
  id: string;
  weight: number | null;
  sleepHours: number | null;
  sleepQuality: number | null;
  readiness: number | null;
  stress: number | null;
  motivation: number | null;
  painScore: number | null;
  painLocation: string | null;
  painTiming: string | null;
  runType: string | null;
  runActualKm: number | null;
  runRpe: number | null;
  runNote: string | null;
  gymDone: boolean | null;
  gymType: string | null;
  gymDurationMin: number | null;
  gymRpe: number | null;
  gymNote: string | null;
  nutritionAdherence: string | null;
  noteText: string | null;
}
export interface TodayView {
  date: string;
  dateLabel: string;
  weekStartDate: string;
  weekNumber: number | null;
  phase: string | null;
  planStatus: 'FOUND' | 'NONE' | 'AMBIGUOUS';
  plan: PlanView | null;
  daily: DailyView | null;
}
export interface WeeklyView {
  weekId: string;
  weekStart: string;
  weekEnd: string;
  averageWeight: number | null;
  weightTrend: number | null;
  totalRunningKm: number;
  longestRun: number | null;
  numberOfRuns: number;
  numberOfGymSessions: number;
  averageSleep: number | null;
  averageRpe: number | null;
  painFlagCount: number;
  nutritionAdherence: number | null;
  completionPercentage: number | null;
  missedSessions: number;
  waist: number | null;
  reflectionText: string | null;
  totalPlannedKm: number | null;
}

export interface UpcomingSession {
  date: string;
  weekNumber: number | null;
  phase: string | null;
  session: string;
  plannedKm: number | null;
}
export interface PlanDay { date: string; slot: string; session: string; plannedKm: number | null; }
export interface PlanWeek {
  weekNumber: number;
  phase: string | null;
  start: string;
  end: string;
  plannedKm: number;
  actualKm: number;
  sessions: number;
  completedSessions: number;
  status: 'DONE' | 'CURRENT' | 'UPCOMING';
  days: PlanDay[];
}
export interface PlanOverview {
  hasPlan: boolean;
  today: string;
  totalWeeks: number;
  currentWeek: number | null;
  currentPhase: string | null;
  currentWeekPlannedKm: number | null;
  plannedTotalKm: number;
  completedKm: number;
  completionPercentage: number | null;
  completedWeeks: number;
  remainingWeeks: number;
  startsInDays: number | null;
  daysToRace: number | null;
  dateRange: { start: string; end: string } | null;
  upcoming: UpcomingSession[];
  weeks: PlanWeek[];
}
export interface ImportPreviewRow {
  date: string; weekNumber: number; phase: string; sessionType: string;
  slot: string; plannedKm: number | null; summary: string;
}
export interface ImportPreview {
  valid: boolean;
  rowCount: number;
  dateRange: { start: string; end: string } | null;
  weekCount: number;
  totalPlannedKm: number;
  plannedKmByWeek: { weekNumber: number; phase: string; plannedKm: number; sessions: number }[];
  phaseDistribution: { phase: string; count: number }[];
  sessionDistribution: { type: string; count: number }[];
  planLabel: string | null;
  errors: { line: number; field: string; message: string }[];
  warnings: string[];
  conflicts: string[];
  rows: ImportPreviewRow[];
}
export interface ImportResult {
  planLabel: string | null;
  versionsCreated: number;
  dateRange: { start: string; end: string };
  weekCount: number;
  sessionCount: number;
  totalPlannedKm: number;
  effectiveFrom: string;
}

async function req<T>(input: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  try {
    const res = await fetch(input, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (json && typeof json === 'object' && 'ok' in json) return json;
    return { ok: false, data: null, error: { code: 'BAD_RESPONSE', message: `HTTP ${res.status}` } };
  } catch {
    return { ok: false, data: null, error: { code: 'NETWORK', message: 'network error' } };
  }
}

const post = (url: string, body: unknown) => req(url, { method: 'POST', body: JSON.stringify(body) });

/**
 * Tiny in-memory resource cache (per browser session). Enables
 * stale-while-revalidate: a page renders cached data instantly on navigation
 * and refreshes it in the background — no SYNCING flash on repeat visits. The
 * server stays authoritative (every mount still revalidates); a save
 * invalidates the affected keys so nothing goes stale.
 */
const cache = new Map<string, unknown>();
export const resourceCache = {
  get: <T>(k: string): T | undefined => cache.get(k) as T | undefined,
  set: (k: string, v: unknown): void => { cache.set(k, v); },
  invalidate: (...keys: string[]): void => { for (const k of keys) cache.delete(k); },
};

async function cached<T>(key: string, p: Promise<ApiEnvelope<T>>): Promise<ApiEnvelope<T>> {
  const r = await p;
  if (r.ok) resourceCache.set(key, r.data);
  return r;
}
// A mutation invalidates derived/authoritative reads so the next fetch is fresh.
async function afterSave(p: Promise<ApiEnvelope<DailyView>>): Promise<ApiEnvelope<DailyView>> {
  const r = await p;
  if (r.ok) resourceCache.invalidate('today', 'weekly');
  return r;
}

export const api = {
  today: () => cached<TodayView>('today', req<TodayView>('/api/today')),
  weekly: () => cached<WeeklyView>('weekly', req<WeeklyView>('/api/weekly')),
  plan: (date?: string) => cached<PlanView>('plan', req<PlanView>(`/api/plan${date ? `?date=${encodeURIComponent(date)}` : ''}`)),
  planOverview: () => cached<PlanOverview>('planOverview', req<PlanOverview>('/api/plan/overview')),
  importPreview: (csv: string) => post('/api/plan/import/preview', { csv }) as Promise<ApiEnvelope<ImportPreview>>,
  importCommit: async (csv: string, mode: 'create' | 'replace' = 'create') => {
    const r = (await post('/api/plan/import/commit', { csv, mode })) as ApiEnvelope<ImportResult>;
    if (r.ok) resourceCache.invalidate('plan', 'planOverview', 'today', 'weekly');
    return r;
  },
  saveWeight: (body: { weight?: number | null; sleep?: number | null; nutrition?: 'ON' | 'MOST' | 'OFF' | null; sleepQuality?: number | null; readiness?: number | null; stress?: number | null; motivation?: number | null }) => afterSave(post('/api/log/weight', body) as Promise<ApiEnvelope<DailyView>>),
  saveRun: (body: { runType?: string | null; km?: number | null; rpe?: number | null; pain?: number | null; painLocation?: string | null; painTiming?: string | null; note?: string | null }) => afterSave(post('/api/log/run', body) as Promise<ApiEnvelope<DailyView>>),
  saveGym: (body: { completed?: boolean | null; gymType?: string | null; duration?: number | null; rpe?: number | null; note?: string | null }) => afterSave(post('/api/log/gym', body) as Promise<ApiEnvelope<DailyView>>),
  saveNote: (body: { note?: string | null }) => afterSave(post('/api/log/note', body) as Promise<ApiEnvelope<DailyView>>),
};

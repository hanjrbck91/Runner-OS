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
  painScore: number | null;
  runActualKm: number | null;
  runRpe: number | null;
  gymDone: boolean | null;
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

export const api = {
  today: () => req<TodayView>('/api/today'),
  weekly: () => req<WeeklyView>('/api/weekly'),
  plan: (date?: string) => req<PlanView>(`/api/plan${date ? `?date=${encodeURIComponent(date)}` : ''}`),
  saveWeight: (body: { weight?: number | null; sleep?: number | null }) => post('/api/log/weight', body) as Promise<ApiEnvelope<DailyView>>,
  saveRun: (body: { km?: number | null; rpe?: number | null; pain?: number | null; note?: string | null }) => post('/api/log/run', body) as Promise<ApiEnvelope<DailyView>>,
  saveGym: (body: { completed?: boolean | null }) => post('/api/log/gym', body) as Promise<ApiEnvelope<DailyView>>,
  saveNote: (body: { note?: string | null }) => post('/api/log/note', body) as Promise<ApiEnvelope<DailyView>>,
};

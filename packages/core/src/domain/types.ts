/**
 * Runner OS domain types. Descriptive field names (AI-export friendly).
 * Nullability: `null` means "no value / cleared"; distinct from a field being
 * omitted in a field-aware update (see application layer).
 */
import type { Instant, LocalDate } from './time.js';

export type NutritionAdherence = 'ON' | 'MOST' | 'OFF';

export interface DailyRecord {
  readonly id: string;
  readonly userId: string;
  readonly date: LocalDate;               // server-authoritative
  readonly weight: number | null;
  readonly sleepHours: number | null;
  readonly sleepQuality: number | null;    // 1..5 (MCV-027)
  readonly readiness: number | null;       // 1..10
  readonly stress: number | null;          // 1..10
  readonly motivation: number | null;      // 1..10
  readonly painScore: number | null;      // 0..3
  readonly painLocation: string | null;
  readonly painTiming: string | null;      // before/during/after/next-morning (pain > 0 only)
  readonly runType: string | null;
  readonly runActualKm: number | null;
  readonly runRpe: number | null;         // 1..10
  readonly runNote: string | null;
  readonly gymDone: boolean | null;
  readonly gymType: string | null;
  readonly gymDurationMin: number | null;  // >= 0
  readonly gymRpe: number | null;          // 1..10
  readonly gymNote: string | null;
  readonly nutritionAdherence: NutritionAdherence | null;
  readonly noteText: string | null;
  readonly planIdSnapshot: string | null;      // immutable after create
  readonly planVersionSnapshot: number | null; // immutable after create
  readonly createdAt: Instant;                 // immutable
  readonly updatedAt: Instant;
  readonly deletedAt: Instant | null;          // soft delete
}

export interface PlanVersion {
  readonly id: string;
  readonly userId: string;
  readonly planDate: LocalDate;
  readonly version: number;               // service-controlled, 1-based per planDate
  readonly phase: string | null;
  readonly runPlan: string | null;
  readonly longRunPlan: string | null;
  readonly qualityPlan: string | null;
  readonly gymPlan: string | null;
  readonly recoveryPlan: string | null;
  readonly mileageTarget: number | null;
  readonly bodyCompositionTarget: string | null;
  readonly milestone: string | null;
  readonly weekNumber: number | null;     // 1..20
  readonly effectiveFrom: LocalDate;
  readonly effectiveTo: LocalDate | null; // null = open-ended
  readonly isActive: boolean;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export type PlanStatus = 'FOUND' | 'NONE' | 'AMBIGUOUS';

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'SOFT_DELETE'
  | 'CREATE_PLAN_VERSION'
  | 'CLOSE_PLAN_VERSION';

export interface AuditEntry {
  readonly id: string;
  readonly userId: string;
  readonly timestamp: Instant;
  readonly entityType: 'Daily' | 'Plan';
  readonly entityId: string;
  readonly action: AuditAction;
  readonly fieldChanged: string;
  readonly oldValue: string;
  readonly newValue: string;
  readonly actor: string;
  readonly reason: string;
}

/** Human-authored, per-period context. NEVER derived; survives recomputation. */
export interface PeriodReflection {
  readonly userId: string;
  readonly periodType: 'WEEK' | 'MONTH';
  readonly periodKey: string;             // 'WEEK_2026-08-31' | 'MONTH_2026-09'
  readonly reflectionText: string | null;
  readonly audioObjectKey: string | null; // future R2 key
  readonly waist: number | null;          // WEEK only
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

/** Derived weekly metrics (computed on read; regenerable; never canonical). */
export interface WeeklyMetrics {
  readonly weekId: string;
  readonly weekStart: LocalDate;
  readonly weekEnd: LocalDate;
  readonly averageWeight: number | null;
  readonly weightTrend: number | null;
  readonly totalRunningKm: number;
  readonly longestRun: number | null;
  readonly numberOfRuns: number;
  readonly numberOfGymSessions: number;
  readonly averageSleep: number | null;
  readonly averageRpe: number | null;
  readonly painFlagCount: number;
  readonly nutritionAdherence: number | null; // 0..1 score
  readonly completionPercentage: number | null;
  readonly missedSessions: number;
}

export interface MonthlyMetrics {
  readonly monthId: string;
  readonly monthStart: LocalDate;
  readonly monthEnd: LocalDate;
  readonly weightChange: number | null;
  readonly totalRunningKm: number;
  readonly longestRun: number | null;
  readonly averageSleep: number | null;
  readonly averageRpe: number | null;
  readonly painTrend: string | null;
  readonly nutritionAdherence: number | null;
  readonly trainingConsistency: number | null;
  readonly milestones: string | null;
}

/** View objects returned to callers: derived metrics + human context merged. */
export interface WeeklyView extends WeeklyMetrics {
  readonly waist: number | null;
  readonly reflectionText: string | null;
}
export interface MonthlyView extends MonthlyMetrics {
  readonly waistChange: number | null;
  readonly reflectionText: string | null;
  readonly raceResults: string | null;
}

export interface TodayView {
  readonly date: LocalDate;
  readonly dateLabel: string;
  readonly weekStartDate: LocalDate;
  readonly weekNumber: number | null;
  readonly phase: string | null;
  readonly planStatus: PlanStatus;
  readonly plan: PlanVersion | null;
  readonly daily: DailyRecord | null;
}

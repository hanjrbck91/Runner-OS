/**
 * Framework-independent PORTS. Application services depend ONLY on these
 * interfaces. Infrastructure (Postgres/Drizzle in M07-C, in-memory adapters in
 * packages/core/src/adapters/memory for tests + local dev) implements them.
 *
 * Dependency direction: services -> ports <- infrastructure. Never the reverse.
 */
import type { LocalDate, Instant } from '../domain/time.js';
import type { DailyRecord, PlanVersion, AuditEntry, PeriodReflection } from '../domain/types.js';

/** Injected time source so "now"/"today" are testable and never scattered. */
export interface Clock {
  now(): Date;
  timezone(): string;
}

/** Injected identity source (UUID). Keeps ID strategy swappable & testable. */
export interface IdGenerator {
  newId(): string;
}

/** Identity of the acting user (single-user V1; multi-user ready). */
export interface UserContext {
  readonly userId: string;
  readonly actor: string; // email / label recorded in audit
}

export interface DailyRepository {
  getById(userId: string, id: string): Promise<DailyRecord | null>;
  /** Active (non-deleted) record for a date, or null. Implementations must
   *  guarantee at most one (DB partial-unique in M07-C). */
  getActiveByDate(userId: string, date: LocalDate): Promise<DailyRecord | null>;
  /** All active records with date in [start, end] (inclusive). */
  listActiveInRange(userId: string, start: LocalDate, end: LocalDate): Promise<DailyRecord[]>;
  /**
   * Atomically create ONE active record for (userId, date). The DATABASE is
   * authoritative for the "one active Daily per user/date" invariant (partial
   * unique index). Under a concurrent race the loser gets `created: false` and
   * the winning existing active row — never two active rows. The application
   * must NOT rely on read-then-insert alone.
   */
  createActive(record: DailyRecord): Promise<{ created: boolean; record: DailyRecord }>;
  update(record: DailyRecord): Promise<DailyRecord>;
}

export interface PlanRepository {
  getById(userId: string, id: string): Promise<PlanVersion | null>;
  listByPlanDate(userId: string, planDate: LocalDate): Promise<PlanVersion[]>;
  listByPlanDateRange(userId: string, start: LocalDate, end: LocalDate): Promise<PlanVersion[]>;
  insert(version: PlanVersion): Promise<PlanVersion>;
  update(version: PlanVersion): Promise<PlanVersion>;
}

export interface AuditRepository {
  append(entries: readonly AuditEntry[]): Promise<void>;
  /** Read access is for admin/tests; normal app flow only appends. */
  listByEntity(userId: string, entityType: string, entityId: string): Promise<AuditEntry[]>;
}

export interface PeriodReflectionRepository {
  get(userId: string, periodType: 'WEEK' | 'MONTH', periodKey: string): Promise<PeriodReflection | null>;
  /** Weekly reflections whose weekStart (encoded in key) falls in [start, end]. */
  listWeeklyInRange(userId: string, start: LocalDate, end: LocalDate): Promise<PeriodReflection[]>;
  upsert(reflection: PeriodReflection): Promise<PeriodReflection>;
}

/** Everything the application services need, injected once. */
export interface CoreDependencies {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly daily: DailyRepository;
  readonly plans: PlanRepository;
  readonly audit: AuditRepository;
  readonly reflections: PeriodReflectionRepository;
}

export type { LocalDate, Instant };

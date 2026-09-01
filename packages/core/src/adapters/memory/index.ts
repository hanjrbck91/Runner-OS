/**
 * In-memory adapters — framework-free, no database. Used by core/application
 * unit tests and for local development. Real PostgreSQL/Drizzle adapters that
 * implement the same ports arrive in M07-C.
 *
 * These stores are deliberately "dumb": integrity (single active Daily per
 * date, single active plan version) is enforced by the SERVICES, mirroring the
 * production design where the database enforces it via constraints. Tests that
 * need to simulate corruption push records directly onto `.records`.
 */
import type {
  Clock, IdGenerator, DailyRepository, PlanRepository, AuditRepository,
  PeriodReflectionRepository, CoreDependencies,
} from '../../ports/index.js';
import type { DailyRecord, PlanVersion, AuditEntry, PeriodReflection } from '../../domain/types.js';
import { compareDate, DEFAULT_TIMEZONE, type LocalDate } from '../../domain/time.js';

export class FixedClock implements Clock {
  private current: Date;
  constructor(iso = '2026-08-31T06:00:00.000Z', private readonly tz: string = DEFAULT_TIMEZONE) {
    this.current = new Date(iso);
  }
  now(): Date { return new Date(this.current.getTime()); }
  timezone(): string { return this.tz; }
  set(iso: string): void { this.current = new Date(iso); }
  advance(ms: number): void { this.current = new Date(this.current.getTime() + ms); }
}

/** Deterministic monotonic ids for tests (unique, not row-based). */
export class CountingIdGenerator implements IdGenerator {
  private n = 0;
  constructor(private readonly prefix = 'id') {}
  newId(): string { this.n += 1; return `${this.prefix}_${this.n.toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
}

export class InMemoryDailyRepository implements DailyRepository {
  readonly records: DailyRecord[] = [];
  async getById(userId: string, id: string): Promise<DailyRecord | null> {
    return this.records.find((r) => r.userId === userId && r.id === id) ?? null;
  }
  async getActiveByDate(userId: string, date: LocalDate): Promise<DailyRecord | null> {
    return this.records.find((r) => r.userId === userId && r.date === date && r.deletedAt === null) ?? null;
  }
  async listActiveInRange(userId: string, start: LocalDate, end: LocalDate): Promise<DailyRecord[]> {
    return this.records.filter(
      (r) => r.userId === userId && r.deletedAt === null && compareDate(r.date, start) >= 0 && compareDate(r.date, end) <= 0,
    );
  }
  async insert(record: DailyRecord): Promise<DailyRecord> { this.records.push(record); return record; }
  async createActive(record: DailyRecord): Promise<{ created: boolean; record: DailyRecord }> {
    const existing = this.records.find((r) => r.userId === record.userId && r.date === record.date && r.deletedAt === null);
    if (existing) return { created: false, record: existing };
    this.records.push(record);
    return { created: true, record };
  }
  async update(record: DailyRecord): Promise<DailyRecord> {
    const i = this.records.findIndex((r) => r.id === record.id);
    if (i === -1) throw new Error(`daily update: id not found ${record.id}`);
    this.records[i] = record;
    return record;
  }
}

export class InMemoryPlanRepository implements PlanRepository {
  readonly records: PlanVersion[] = [];
  async getById(userId: string, id: string): Promise<PlanVersion | null> {
    return this.records.find((r) => r.userId === userId && r.id === id) ?? null;
  }
  async listByPlanDate(userId: string, planDate: LocalDate): Promise<PlanVersion[]> {
    return this.records.filter((r) => r.userId === userId && r.planDate === planDate);
  }
  async listByPlanDateRange(userId: string, start: LocalDate, end: LocalDate): Promise<PlanVersion[]> {
    return this.records.filter(
      (r) => r.userId === userId && compareDate(r.planDate, start) >= 0 && compareDate(r.planDate, end) <= 0,
    );
  }
  async insert(version: PlanVersion): Promise<PlanVersion> { this.records.push(version); return version; }
  async update(version: PlanVersion): Promise<PlanVersion> {
    const i = this.records.findIndex((r) => r.id === version.id);
    if (i === -1) throw new Error(`plan update: id not found ${version.id}`);
    this.records[i] = version;
    return version;
  }
}

export class InMemoryAuditRepository implements AuditRepository {
  readonly records: AuditEntry[] = [];
  async append(entries: readonly AuditEntry[]): Promise<void> { this.records.push(...entries); }
  async listByEntity(userId: string, entityType: string, entityId: string): Promise<AuditEntry[]> {
    return this.records.filter((e) => e.userId === userId && e.entityType === entityType && e.entityId === entityId);
  }
}

export class InMemoryPeriodReflectionRepository implements PeriodReflectionRepository {
  readonly records: PeriodReflection[] = [];
  private key(userId: string, t: string, k: string): string { return `${userId}|${t}|${k}`; }
  async get(userId: string, periodType: 'WEEK' | 'MONTH', periodKey: string): Promise<PeriodReflection | null> {
    return this.records.find((r) => r.userId === userId && r.periodType === periodType && r.periodKey === periodKey) ?? null;
  }
  async listWeeklyInRange(userId: string, start: LocalDate, end: LocalDate): Promise<PeriodReflection[]> {
    return this.records.filter((r) => {
      if (r.userId !== userId || r.periodType !== 'WEEK') return false;
      const weekStart = r.periodKey.replace('WEEK_', '');
      return compareDate(weekStart, start) >= 0 && compareDate(weekStart, end) <= 0;
    });
  }
  async upsert(reflection: PeriodReflection): Promise<PeriodReflection> {
    const i = this.records.findIndex(
      (r) => r.userId === reflection.userId && r.periodType === reflection.periodType && r.periodKey === reflection.periodKey,
    );
    if (i === -1) this.records.push(reflection); else this.records[i] = reflection;
    return reflection;
  }
}

export interface InMemoryHarness extends CoreDependencies {
  readonly clock: FixedClock;
  readonly daily: InMemoryDailyRepository;
  readonly plans: InMemoryPlanRepository;
  readonly audit: InMemoryAuditRepository;
  readonly reflections: InMemoryPeriodReflectionRepository;
}

/** Build a complete in-memory dependency set for tests/local dev. */
export function createInMemoryDependencies(opts?: { clockIso?: string; timezone?: string }): InMemoryHarness {
  return {
    clock: new FixedClock(opts?.clockIso, opts?.timezone),
    ids: new CountingIdGenerator(),
    daily: new InMemoryDailyRepository(),
    plans: new InMemoryPlanRepository(),
    audit: new InMemoryAuditRepository(),
    reflections: new InMemoryPeriodReflectionRepository(),
  };
}

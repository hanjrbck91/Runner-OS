/**
 * PostgreSQL implementations of the @runner-os/core repository ports (Drizzle).
 * Row<->domain mapping lives here; the rest of the system never sees SQL rows.
 */
import { sql } from 'drizzle-orm';
import type {
  DailyRepository, PlanRepository, AuditRepository, PeriodReflectionRepository,
  CoreDependencies, LocalDate,
} from '@runner-os/core';
import type { DailyRecord, PlanVersion, AuditEntry, PeriodReflection } from '@runner-os/core';
import { SystemClock, UuidIdGenerator } from '@runner-os/core';
import type { Db } from './client.js';

type Row = Record<string, unknown>;
async function rows(db: Db, query: ReturnType<typeof sql>): Promise<Row[]> {
  const res = (await db.execute(query)) as unknown as { rows: Row[] };
  return res.rows;
}

function toInstant(v: unknown): string {
  return new Date(String(v)).toISOString();
}
function toInstantOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : toInstant(v);
}
function n(v: unknown): number | null { return v === null || v === undefined ? null : Number(v); }
function s(v: unknown): string | null { return v === null || v === undefined ? null : String(v); }
function b(v: unknown): boolean | null { return v === null || v === undefined ? null : Boolean(v); }

function mapDaily(r: Row): DailyRecord {
  return {
    id: String(r.id), userId: String(r.user_id), date: String(r.log_date),
    weight: n(r.weight), sleepHours: n(r.sleep_hours), painScore: n(r.pain_score),
    painLocation: s(r.pain_location), runActualKm: n(r.run_actual_km), runRpe: n(r.run_rpe),
    gymDone: b(r.gym_done), nutritionAdherence: s(r.nutrition_adherence) as DailyRecord['nutritionAdherence'],
    noteText: s(r.note_text), planIdSnapshot: s(r.plan_id_snapshot), planVersionSnapshot: n(r.plan_version_snapshot),
    createdAt: toInstant(r.created_at), updatedAt: toInstant(r.updated_at), deletedAt: toInstantOrNull(r.deleted_at),
  };
}
function mapPlan(r: Row): PlanVersion {
  return {
    id: String(r.id), userId: String(r.user_id), planDate: String(r.plan_date), version: Number(r.version),
    phase: s(r.phase), runPlan: s(r.run_plan), longRunPlan: s(r.long_run_plan), qualityPlan: s(r.quality_plan),
    gymPlan: s(r.gym_plan), recoveryPlan: s(r.recovery_plan), mileageTarget: n(r.mileage_target),
    bodyCompositionTarget: s(r.body_composition_target), milestone: s(r.milestone), weekNumber: n(r.week_number),
    effectiveFrom: String(r.effective_from), effectiveTo: s(r.effective_to), isActive: Boolean(r.is_active),
    createdAt: toInstant(r.created_at), updatedAt: toInstant(r.updated_at),
  };
}

export class DailyRepositoryPg implements DailyRepository {
  constructor(private readonly db: Db) {}

  async getById(userId: string, id: string): Promise<DailyRecord | null> {
    const r = await rows(this.db, sql`select * from daily_logs where user_id=${userId} and id=${id}`);
    return r[0] ? mapDaily(r[0]) : null;
  }
  async getActiveByDate(userId: string, date: LocalDate): Promise<DailyRecord | null> {
    const r = await rows(this.db, sql`select * from daily_logs where user_id=${userId} and log_date=${date} and deleted_at is null`);
    return r[0] ? mapDaily(r[0]) : null;
  }
  async listActiveInRange(userId: string, start: LocalDate, end: LocalDate): Promise<DailyRecord[]> {
    const r = await rows(this.db, sql`select * from daily_logs where user_id=${userId} and deleted_at is null and log_date between ${start} and ${end}`);
    return r.map(mapDaily);
  }
  async createActive(rec: DailyRecord): Promise<{ created: boolean; record: DailyRecord }> {
    const r = await rows(this.db, sql`
      insert into daily_logs (id,user_id,log_date,weight,sleep_hours,pain_score,pain_location,run_actual_km,run_rpe,gym_done,nutrition_adherence,note_text,plan_id_snapshot,plan_version_snapshot,created_at,updated_at,deleted_at)
      values (${rec.id},${rec.userId},${rec.date},${rec.weight},${rec.sleepHours},${rec.painScore},${rec.painLocation},${rec.runActualKm},${rec.runRpe},${rec.gymDone},${rec.nutritionAdherence},${rec.noteText},${rec.planIdSnapshot},${rec.planVersionSnapshot},${rec.createdAt},${rec.updatedAt},${rec.deletedAt})
      on conflict (user_id, log_date) where (deleted_at is null) do nothing
      returning *`);
    if (r[0]) return { created: true, record: mapDaily(r[0]) };
    const existing = await this.getActiveByDate(rec.userId, rec.date);
    if (!existing) throw new Error('createActive: conflict but no active row found');
    return { created: false, record: existing };
  }
  async insert(rec: DailyRecord): Promise<DailyRecord> {
    const res = await this.createActive(rec);
    return res.record;
  }
  async update(rec: DailyRecord): Promise<DailyRecord> {
    // Excludes id, user_id, log_date, created_at, plan snapshots — immutable.
    const r = await rows(this.db, sql`
      update daily_logs set
        weight=${rec.weight}, sleep_hours=${rec.sleepHours}, pain_score=${rec.painScore}, pain_location=${rec.painLocation},
        run_actual_km=${rec.runActualKm}, run_rpe=${rec.runRpe}, gym_done=${rec.gymDone},
        nutrition_adherence=${rec.nutritionAdherence}, note_text=${rec.noteText},
        updated_at=${rec.updatedAt}, deleted_at=${rec.deletedAt}
      where id=${rec.id} and user_id=${rec.userId}
      returning *`);
    if (!r[0]) throw new Error(`daily update: id not found ${rec.id}`);
    return mapDaily(r[0]);
  }
}

export class PlanRepositoryPg implements PlanRepository {
  constructor(private readonly db: Db) {}
  async getById(userId: string, id: string): Promise<PlanVersion | null> {
    const r = await rows(this.db, sql`select * from plan_versions where user_id=${userId} and id=${id}`);
    return r[0] ? mapPlan(r[0]) : null;
  }
  async listByPlanDate(userId: string, planDate: LocalDate): Promise<PlanVersion[]> {
    const r = await rows(this.db, sql`select * from plan_versions where user_id=${userId} and plan_date=${planDate}`);
    return r.map(mapPlan);
  }
  async listByPlanDateRange(userId: string, start: LocalDate, end: LocalDate): Promise<PlanVersion[]> {
    const r = await rows(this.db, sql`select * from plan_versions where user_id=${userId} and plan_date between ${start} and ${end}`);
    return r.map(mapPlan);
  }
  async insert(v: PlanVersion): Promise<PlanVersion> {
    const r = await rows(this.db, sql`
      insert into plan_versions (id,user_id,plan_date,version,phase,run_plan,long_run_plan,quality_plan,gym_plan,recovery_plan,mileage_target,body_composition_target,milestone,week_number,effective_from,effective_to,is_active,created_at,updated_at)
      values (${v.id},${v.userId},${v.planDate},${v.version},${v.phase},${v.runPlan},${v.longRunPlan},${v.qualityPlan},${v.gymPlan},${v.recoveryPlan},${v.mileageTarget},${v.bodyCompositionTarget},${v.milestone},${v.weekNumber},${v.effectiveFrom},${v.effectiveTo},${v.isActive},${v.createdAt},${v.updatedAt})
      returning *`);
    return mapPlan(r[0]!);
  }
  async update(v: PlanVersion): Promise<PlanVersion> {
    const r = await rows(this.db, sql`
      update plan_versions set
        phase=${v.phase}, run_plan=${v.runPlan}, long_run_plan=${v.longRunPlan}, quality_plan=${v.qualityPlan},
        gym_plan=${v.gymPlan}, recovery_plan=${v.recoveryPlan}, mileage_target=${v.mileageTarget},
        body_composition_target=${v.bodyCompositionTarget}, milestone=${v.milestone}, week_number=${v.weekNumber},
        effective_from=${v.effectiveFrom}, effective_to=${v.effectiveTo}, is_active=${v.isActive}, updated_at=${v.updatedAt}
      where id=${v.id} and user_id=${v.userId}
      returning *`);
    if (!r[0]) throw new Error(`plan update: id not found ${v.id}`);
    return mapPlan(r[0]);
  }
  async deleteByPlanDates(userId: string, dates: readonly LocalDate[]): Promise<number> {
    if (dates.length === 0) return 0;
    const list = sql.join(dates.map((d) => sql`${d}`), sql`, `);
    const r = await rows(this.db, sql`
      delete from plan_versions
      where user_id=${userId} and plan_date in (${list})
      returning id`);
    return r.length;
  }
}

export class AuditRepositoryPg implements AuditRepository {
  constructor(private readonly db: Db) {}
  async append(entries: readonly AuditEntry[]): Promise<void> {
    for (const e of entries) {
      await this.db.execute(sql`
        insert into audit_log (id,user_id,ts,entity_type,entity_id,action,field_changed,old_value,new_value,actor,reason)
        values (${e.id},${e.userId},${e.timestamp},${e.entityType},${e.entityId},${e.action},${e.fieldChanged},${e.oldValue},${e.newValue},${e.actor},${e.reason})`);
    }
  }
  async listByEntity(userId: string, entityType: string, entityId: string): Promise<AuditEntry[]> {
    const r = await rows(this.db, sql`select * from audit_log where user_id=${userId} and entity_type=${entityType} and entity_id=${entityId} order by ts`);
    return r.map((x) => ({
      id: String(x.id), userId: String(x.user_id), timestamp: toInstant(x.ts),
      entityType: String(x.entity_type) as AuditEntry['entityType'], entityId: String(x.entity_id),
      action: String(x.action) as AuditEntry['action'], fieldChanged: String(x.field_changed),
      oldValue: String(x.old_value ?? ''), newValue: String(x.new_value ?? ''),
      actor: String(x.actor ?? ''), reason: String(x.reason ?? ''),
    }));
  }
}

export class PeriodReflectionRepositoryPg implements PeriodReflectionRepository {
  constructor(private readonly db: Db) {}
  private map(r: Row): PeriodReflection {
    return {
      userId: String(r.user_id), periodType: String(r.period_type) as 'WEEK' | 'MONTH', periodKey: String(r.period_key),
      reflectionText: s(r.reflection_text), audioObjectKey: s(r.audio_object_key), waist: n(r.waist),
      createdAt: toInstant(r.created_at), updatedAt: toInstant(r.updated_at),
    };
  }
  async get(userId: string, periodType: 'WEEK' | 'MONTH', periodKey: string): Promise<PeriodReflection | null> {
    const r = await rows(this.db, sql`select * from period_reflections where user_id=${userId} and period_type=${periodType} and period_key=${periodKey}`);
    return r[0] ? this.map(r[0]) : null;
  }
  async listWeeklyInRange(userId: string, start: LocalDate, end: LocalDate): Promise<PeriodReflection[]> {
    const r = await rows(this.db, sql`
      select * from period_reflections
      where user_id=${userId} and period_type='WEEK'
        and replace(period_key,'WEEK_','') between ${start} and ${end}`);
    return r.map((x) => this.map(x));
  }
  async upsert(ref: PeriodReflection): Promise<PeriodReflection> {
    const r = await rows(this.db, sql`
      insert into period_reflections (user_id,period_type,period_key,reflection_text,audio_object_key,waist,created_at,updated_at)
      values (${ref.userId},${ref.periodType},${ref.periodKey},${ref.reflectionText},${ref.audioObjectKey},${ref.waist},${ref.createdAt},${ref.updatedAt})
      on conflict (user_id,period_type,period_key) do update set
        reflection_text=excluded.reflection_text, audio_object_key=excluded.audio_object_key,
        waist=excluded.waist, updated_at=excluded.updated_at
      returning *`);
    return this.map(r[0]!);
  }
}

/** Seed a user row with a known id (FK target, tests/bootstrap). */
export async function ensureUser(db: Db, userId: string, email: string): Promise<string> {
  await db.execute(sql`insert into users (id,email) values (${userId},${email}) on conflict (id) do nothing`);
  return userId;
}

/**
 * Resolve an authenticated email to its stable user id, creating the user on
 * first sign-in. The API layer uses this to map an Auth.js session to the
 * authoritative userId — the client never supplies a userId.
 */
export async function getOrCreateUserByEmail(db: Db, email: string): Promise<string> {
  await db.execute(sql`insert into users (email) values (${email}) on conflict (email) do nothing`);
  const r = await rows(db, sql`select id from users where email=${email}`);
  return String(r[0]!.id);
}

/** Build CoreDependencies backed by PostgreSQL repositories. */
export function createPgDependencies(db: Db, opts?: { timezone?: string }): CoreDependencies {
  return {
    clock: new SystemClock(opts?.timezone),
    ids: new UuidIdGenerator(),
    daily: new DailyRepositoryPg(db),
    plans: new PlanRepositoryPg(db),
    audit: new AuditRepositoryPg(db),
    reflections: new PeriodReflectionRepositoryPg(db),
  };
}

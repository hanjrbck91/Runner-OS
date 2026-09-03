/**
 * Runner OS BUSINESS invariants (domain-level, transport-agnostic).
 * This is the authoritative representation of the ratified V1 rules — NOT Zod.
 * Zod (packages/shared) validates transport/input shape; these validate meaning.
 *
 * Ratified frozen scales:
 *   PAIN_SCORE  integer 0..3
 *   RUN_RPE     number 1..10
 *   NUTRITION   'ON' | 'MOST' | 'OFF'
 *   WEEK_NUMBER integer 1..20
 *   WEIGHT / SLEEP_HOURS / RUN_ACTUAL_KM / MILEAGE_TARGET  >= 0
 */
import type { NutritionAdherence } from './types.js';

export const NUTRITION_VALUES: readonly NutritionAdherence[] = ['ON', 'MOST', 'OFF'];
export const NUTRITION_SCORE: Readonly<Record<NutritionAdherence, number>> = { ON: 1, MOST: 0.5, OFF: 0 };

/** Fields a client may write on a Daily record. System fields are excluded. */
export const DAILY_WRITABLE_FIELDS = [
  'weight', 'sleepHours', 'sleepQuality', 'readiness', 'stress', 'motivation',
  'painScore', 'painLocation', 'painTiming',
  'runType', 'runActualKm', 'runRpe', 'runNote',
  'gymDone', 'gymType', 'gymDurationMin', 'gymRpe', 'gymNote',
  'nutritionAdherence', 'noteText', 'planIdSnapshot', 'planVersionSnapshot',
] as const;
export type DailyWritableField = (typeof DAILY_WRITABLE_FIELDS)[number];

export const DAILY_SYSTEM_FIELDS = ['id', 'userId', 'date', 'createdAt', 'updatedAt', 'deletedAt'] as const;

type FieldType = 'string' | 'integer' | 'number' | 'boolean' | 'nutrition';
interface FieldRule {
  readonly type: FieldType;
  readonly min?: number;
  readonly max?: number;
}

const DAILY_FIELD_RULES: Record<DailyWritableField, FieldRule> = {
  weight: { type: 'number', min: 0 },
  sleepHours: { type: 'number', min: 0 },
  sleepQuality: { type: 'integer', min: 1, max: 5 },
  readiness: { type: 'integer', min: 1, max: 10 },
  stress: { type: 'integer', min: 1, max: 10 },
  motivation: { type: 'integer', min: 1, max: 10 },
  painScore: { type: 'integer', min: 0, max: 3 },
  painLocation: { type: 'string' },
  painTiming: { type: 'string' },
  runType: { type: 'string' },
  runActualKm: { type: 'number', min: 0 },
  runRpe: { type: 'number', min: 1, max: 10 },
  runNote: { type: 'string' },
  gymDone: { type: 'boolean' },
  gymType: { type: 'string' },
  gymDurationMin: { type: 'number', min: 0 },
  gymRpe: { type: 'number', min: 1, max: 10 },
  gymNote: { type: 'string' },
  nutritionAdherence: { type: 'nutrition' },
  noteText: { type: 'string' },
  planIdSnapshot: { type: 'string' },
  planVersionSnapshot: { type: 'integer', min: 1 },
};

export const PLAN_WRITABLE_FIELDS = [
  'phase', 'runPlan', 'longRunPlan', 'qualityPlan', 'gymPlan', 'recoveryPlan',
  'mileageTarget', 'bodyCompositionTarget', 'milestone', 'weekNumber',
] as const;
export type PlanWritableField = (typeof PLAN_WRITABLE_FIELDS)[number];

const PLAN_FIELD_RULES: Record<PlanWritableField, FieldRule> = {
  phase: { type: 'string' },
  runPlan: { type: 'string' },
  longRunPlan: { type: 'string' },
  qualityPlan: { type: 'string' },
  gymPlan: { type: 'string' },
  recoveryPlan: { type: 'string' },
  mileageTarget: { type: 'number', min: 0 },
  bodyCompositionTarget: { type: 'string' },
  milestone: { type: 'string' },
  weekNumber: { type: 'integer', min: 1, max: 20 },
};

export interface FieldError {
  readonly field: string;
  readonly message: string;
}

/** A validated patch: key present => set to value; value `null` => clear. */
export type FieldPatch = Record<string, unknown | null>;

export interface FieldValidation {
  readonly ok: boolean;
  readonly normalized: FieldPatch;
  readonly errors: FieldError[];
}

function strictNumber(raw: unknown): number | null {
  if (typeof raw === 'boolean') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (t === '' || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function validateField(field: string, rule: FieldRule, raw: unknown, errors: FieldError[]): { cleared: boolean; value: unknown } | null {
  // Clearing semantics: null / '' => clear.
  if (raw === null || raw === undefined || raw === '') return { cleared: true, value: null };

  switch (rule.type) {
    case 'string':
      if (typeof raw === 'object') { errors.push({ field, message: `${field}: expected string` }); return null; }
      return { cleared: false, value: String(raw) };
    case 'boolean':
      if (typeof raw === 'boolean') return { cleared: false, value: raw };
      if (raw === 'true' || raw === 'TRUE' || raw === 'True') return { cleared: false, value: true };
      if (raw === 'false' || raw === 'FALSE' || raw === 'False') return { cleared: false, value: false };
      errors.push({ field, message: `${field}: expected boolean` });
      return null;
    case 'nutrition': {
      const v = String(raw).toUpperCase();
      if ((NUTRITION_VALUES as readonly string[]).includes(v)) return { cleared: false, value: v };
      errors.push({ field, message: `${field}: must be one of ${NUTRITION_VALUES.join('/')}` });
      return null;
    }
    case 'integer':
    case 'number': {
      const n = strictNumber(raw);
      if (n === null) { errors.push({ field, message: `${field}: expected ${rule.type}` }); return null; }
      if (rule.type === 'integer' && !Number.isInteger(n)) { errors.push({ field, message: `${field}: expected integer` }); return null; }
      if (rule.min !== undefined && n < rule.min) { errors.push({ field, message: `${field}: must be >= ${rule.min}` }); return null; }
      if (rule.max !== undefined && n > rule.max) { errors.push({ field, message: `${field}: must be <= ${rule.max}` }); return null; }
      return { cleared: false, value: n };
    }
  }
}

function validateFields<T extends string>(
  input: Record<string, unknown>,
  rules: Record<T, FieldRule>,
  systemFields: readonly string[],
): FieldValidation {
  const out: FieldValidation = { ok: true, normalized: {}, errors: [] };
  const mutable = out as { ok: boolean; normalized: FieldPatch; errors: FieldError[] };

  for (const key of Object.keys(input)) {
    if (systemFields.includes(key)) {
      mutable.ok = false;
      mutable.errors.push({ field: key, message: `${key} is system-managed and cannot be set` });
      continue;
    }
    if (!(key in rules)) {
      mutable.ok = false;
      mutable.errors.push({ field: key, message: `${key} is not a writable field` });
      continue;
    }
    const res = validateField(key, rules[key as T], input[key], mutable.errors);
    if (res === null) { mutable.ok = false; continue; }
    mutable.normalized[key] = res.cleared ? null : res.value;
  }
  return out;
}

export function validateDailyFields(input: Record<string, unknown>): FieldValidation {
  return validateFields(input, DAILY_FIELD_RULES, ['date', ...DAILY_SYSTEM_FIELDS]);
}

export function validatePlanFields(input: Record<string, unknown>): FieldValidation {
  return validateFields(input, PLAN_FIELD_RULES, ['id', 'userId', 'planDate', 'version', 'isActive', 'effectiveFrom', 'effectiveTo', 'createdAt', 'updatedAt']);
}

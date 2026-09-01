import { describe, it, expect } from 'vitest';
import { WeightLogSchema, RunLogSchema, NutritionSchema, CreatePlanSchema, LocalDateSchema } from '../src/index.js';

describe('transport (Zod) boundary', () => {
  it('accepts partial payloads (omission preserved)', () => {
    expect(WeightLogSchema.safeParse({ weight: 76 }).success).toBe(true);
    expect(WeightLogSchema.safeParse({}).success).toBe(true);         // omit all
    expect(RunLogSchema.safeParse({ km: '8.2', rpe: 6, pain: 1 }).success).toBe(true);
  });
  it('rejects unknown keys (strict) and wrong shapes', () => {
    expect(WeightLogSchema.safeParse({ weight: 76, bogus: 1 }).success).toBe(false);
    expect(RunLogSchema.safeParse({ km: {} }).success).toBe(false);
    expect(NutritionSchema.safeParse('MEH').success).toBe(false);
    expect(LocalDateSchema.safeParse('2026-13-40').success).toBe(true); // shape only; calendar validity is domain
    expect(LocalDateSchema.safeParse('nope').success).toBe(false);
  });
  it('null allowed for clearing', () => {
    expect(WeightLogSchema.safeParse({ weight: null }).success).toBe(true);
  });
  it('plan payload shape', () => {
    expect(CreatePlanSchema.safeParse({ planDate: '2026-09-15', fields: { runPlan: 'X' } }).success).toBe(true);
    expect(CreatePlanSchema.safeParse({ fields: {} }).success).toBe(false); // planDate required
  });
});

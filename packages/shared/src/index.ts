/**
 * @runner-os/shared — TRANSPORT/input validation with Zod, for the HTTP API
 * boundary and clients. This layer checks the SHAPE of incoming JSON (types,
 * presence, enum membership). It intentionally does NOT re-encode business
 * ranges (pain 0..3, rpe 1..10, weight >= 0, etc.) — those are domain
 * invariants owned by @runner-os/core and enforced there, so the domain stays
 * usable without HTTP. Keep the two layers separate on purpose.
 *
 * Field-aware semantics over JSON: a client OMITS keys it does not intend to
 * change; a present key with `null`/'' clears the field. These schemas use
 * `.partial()`/optional so omission is preserved (never coerced to a value).
 */
import { z } from 'zod';

export const LocalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const NutritionSchema = z.enum(['ON', 'MOST', 'OFF']);

/** A number, or a numeric string, or null (clear). Transport-level only. */
const NumberLike = z.union([z.number(), z.string(), z.null()]);

export const WeightLogSchema = z
  .object({
    weight: NumberLike.optional(),
    sleep: NumberLike.optional(),
    nutrition: z.union([NutritionSchema, z.null()]).optional(),
  })
  .strict();

export const RunLogSchema = z
  .object({
    km: NumberLike.optional(),
    rpe: NumberLike.optional(),
    pain: NumberLike.optional(),
    painLocation: z.union([z.string(), z.null()]).optional(),
    note: z.union([z.string(), z.null()]).optional(),
  })
  .strict();

export const GymLogSchema = z
  .object({ completed: z.union([z.boolean(), z.null()]).optional() })
  .strict();

export const NoteLogSchema = z
  .object({ note: z.union([z.string(), z.null()]).optional() })
  .strict();

export const CreatePlanSchema = z
  .object({
    planDate: LocalDateSchema,
    effectiveFrom: LocalDateSchema.optional(),
    effectiveTo: z.union([LocalDateSchema, z.null()]).optional(),
    fields: z.record(z.unknown()).optional(),
    reason: z.string().optional(),
  })
  .strict();

export type WeightLog = z.infer<typeof WeightLogSchema>;
export type RunLog = z.infer<typeof RunLogSchema>;
export type GymLog = z.infer<typeof GymLogSchema>;
export type NoteLog = z.infer<typeof NoteLogSchema>;
export type CreatePlan = z.infer<typeof CreatePlanSchema>;

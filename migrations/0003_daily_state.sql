-- Runner OS — MCV-027: additive daily-state / run / gym columns on daily_logs.
-- ADDITIVE ONLY. No table rename, no data rewrite, no plan/import change. Reuses
-- the existing Daily entity, repositories, field-aware update path, and triggers.
-- All columns are nullable; existing rows are unaffected.

ALTER TABLE daily_logs
  ADD COLUMN IF NOT EXISTS sleep_quality    integer,
  ADD COLUMN IF NOT EXISTS readiness        integer,
  ADD COLUMN IF NOT EXISTS stress           integer,
  ADD COLUMN IF NOT EXISTS motivation       integer,
  ADD COLUMN IF NOT EXISTS pain_timing      text,
  ADD COLUMN IF NOT EXISTS run_type         text,
  ADD COLUMN IF NOT EXISTS run_note         text,
  ADD COLUMN IF NOT EXISTS gym_type         text,
  ADD COLUMN IF NOT EXISTS gym_duration_min double precision,
  ADD COLUMN IF NOT EXISTS gym_rpe          double precision,
  ADD COLUMN IF NOT EXISTS gym_note         text;

ALTER TABLE daily_logs
  ADD CONSTRAINT ck_daily_sleep_quality CHECK (sleep_quality IS NULL OR (sleep_quality BETWEEN 1 AND 5)),
  ADD CONSTRAINT ck_daily_readiness     CHECK (readiness  IS NULL OR (readiness  BETWEEN 1 AND 10)),
  ADD CONSTRAINT ck_daily_stress        CHECK (stress     IS NULL OR (stress     BETWEEN 1 AND 10)),
  ADD CONSTRAINT ck_daily_motivation    CHECK (motivation IS NULL OR (motivation BETWEEN 1 AND 10)),
  ADD CONSTRAINT ck_daily_gym_duration  CHECK (gym_duration_min IS NULL OR gym_duration_min >= 0),
  ADD CONSTRAINT ck_daily_gym_rpe       CHECK (gym_rpe IS NULL OR (gym_rpe BETWEEN 1 AND 10));

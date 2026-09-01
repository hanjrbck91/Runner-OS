-- Runner OS — initial schema (M07-C). Authoritative DDL.
-- The DATABASE enforces the core invariants: one active Daily per user/date
-- (partial unique), ratified scale ranges (CHECKs), created_at + plan-snapshot
-- immutability (trigger), and append-only AuditLog (trigger).

CREATE TABLE users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL UNIQUE,
  timezone   text NOT NULL DEFAULT 'Asia/Kolkata',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plan_versions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES users(id),
  plan_date               date NOT NULL,
  version                 integer NOT NULL,
  phase                   text,
  run_plan                text,
  long_run_plan           text,
  quality_plan            text,
  gym_plan                text,
  recovery_plan           text,
  mileage_target          double precision,
  body_composition_target text,
  milestone               text,
  week_number             integer,
  effective_from          date NOT NULL,
  effective_to            date,
  is_active               boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_plan_version UNIQUE (user_id, plan_date, version),
  CONSTRAINT ck_plan_week   CHECK (week_number IS NULL OR (week_number BETWEEN 1 AND 20)),
  CONSTRAINT ck_plan_mileage CHECK (mileage_target IS NULL OR mileage_target >= 0),
  CONSTRAINT ck_plan_period CHECK (effective_to IS NULL OR effective_from <= effective_to)
);
CREATE INDEX ix_plan_active ON plan_versions (user_id, plan_date) WHERE is_active;

CREATE TABLE daily_logs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id),
  log_date              date NOT NULL,
  weight                double precision,
  sleep_hours           double precision,
  pain_score            integer,
  pain_location         text,
  run_actual_km         double precision,
  run_rpe               double precision,
  gym_done              boolean,
  nutrition_adherence   text,
  note_text             text,
  plan_id_snapshot      uuid REFERENCES plan_versions(id),
  plan_version_snapshot integer,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  CONSTRAINT ck_daily_weight    CHECK (weight IS NULL OR weight >= 0),
  CONSTRAINT ck_daily_sleep     CHECK (sleep_hours IS NULL OR sleep_hours >= 0),
  CONSTRAINT ck_daily_km        CHECK (run_actual_km IS NULL OR run_actual_km >= 0),
  CONSTRAINT ck_daily_pain      CHECK (pain_score IS NULL OR (pain_score BETWEEN 0 AND 3)),
  CONSTRAINT ck_daily_rpe       CHECK (run_rpe IS NULL OR (run_rpe BETWEEN 1 AND 10)),
  CONSTRAINT ck_daily_nutrition CHECK (nutrition_adherence IS NULL OR nutrition_adherence IN ('ON','MOST','OFF'))
);
-- One ACTIVE Daily per (user, date). DB is authoritative under concurrency.
CREATE UNIQUE INDEX uq_daily_active ON daily_logs (user_id, log_date) WHERE deleted_at IS NULL;
CREATE INDEX ix_daily_user_date ON daily_logs (user_id, log_date);

-- created_at, plan_id_snapshot, plan_version_snapshot are immutable after create.
CREATE FUNCTION daily_logs_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'daily_logs.created_at is immutable';
  END IF;
  IF NEW.plan_id_snapshot IS DISTINCT FROM OLD.plan_id_snapshot THEN
    RAISE EXCEPTION 'daily_logs.plan_id_snapshot is immutable';
  END IF;
  IF NEW.plan_version_snapshot IS DISTINCT FROM OLD.plan_version_snapshot THEN
    RAISE EXCEPTION 'daily_logs.plan_version_snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_daily_guard BEFORE UPDATE ON daily_logs
  FOR EACH ROW EXECUTE FUNCTION daily_logs_guard();

CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  ts            timestamptz NOT NULL DEFAULT now(),
  entity_type   text,
  entity_id     text,
  action        text,
  field_changed text,
  old_value     text,
  new_value     text,
  actor         text,
  reason        text
);
CREATE INDEX ix_audit_entity ON audit_log (entity_type, entity_id);

-- Append-only: block UPDATE and DELETE on audit_log.
CREATE FUNCTION audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_append_only();
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_append_only();

CREATE TABLE period_reflections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id),
  period_type      text NOT NULL CHECK (period_type IN ('WEEK','MONTH')),
  period_key       text NOT NULL,
  reflection_text  text,
  audio_object_key text,
  waist            double precision,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_period UNIQUE (user_id, period_type, period_key)
);

CREATE TABLE user_config (
  user_id     uuid NOT NULL REFERENCES users(id),
  key         text NOT NULL,
  value       text,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

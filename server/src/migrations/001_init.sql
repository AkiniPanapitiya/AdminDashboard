-- Initial schema: owner accounts, sessions, staff, piece rates, production, payroll adjustments, audit log.
-- Money is always stored as integer cents (LKR cents) to avoid floating point errors.

CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text        NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  password_hash         text        NOT NULL,
  role                  text        NOT NULL DEFAULT 'owner' CHECK (role IN ('owner')),
  failed_login_attempts integer     NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  text        NOT NULL UNIQUE,
  ip          text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE staff (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   text        NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 120),
  phone       text        CHECK (phone IS NULL OR length(phone) <= 30),
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- A "job type" is something staff are paid per piece for (e.g. "DTF print A4").
CREATE TABLE job_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  rate_cents  bigint      NOT NULL CHECK (rate_cents >= 0 AND rate_cents <= 100000000),
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX job_types_name_lower_key ON job_types (lower(btrim(name)));

-- Each entry snapshots the job name and rate at the time of work, so changing a rate
-- later never rewrites history or past salaries.
CREATE TABLE production_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id       uuid        NOT NULL REFERENCES staff (id) ON DELETE RESTRICT,
  job_type_id    uuid        REFERENCES job_types (id) ON DELETE SET NULL,
  job_type_name  text        NOT NULL,
  quantity       integer     NOT NULL CHECK (quantity > 0 AND quantity <= 100000),
  rate_cents     bigint      NOT NULL CHECK (rate_cents >= 0),
  work_date      date        NOT NULL,
  note           text        CHECK (note IS NULL OR length(note) <= 500),
  created_by     uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX production_entries_staff_date_idx ON production_entries (staff_id, work_date);
CREATE INDEX production_entries_date_idx ON production_entries (work_date);

CREATE TABLE payroll_adjustments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id      uuid        NOT NULL REFERENCES staff (id) ON DELETE RESTRICT,
  period        date        NOT NULL CHECK (extract(day FROM period) = 1),
  kind          text        NOT NULL CHECK (kind IN ('bonus', 'advance', 'deduction')),
  amount_cents  bigint      NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 1000000000),
  note          text        CHECK (note IS NULL OR length(note) <= 500),
  created_by    uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payroll_adjustments_period_idx ON payroll_adjustments (period, staff_id);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid,
  action      text        NOT NULL,
  entity      text,
  entity_id   text,
  meta        jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_at_idx ON audit_log (created_at DESC);

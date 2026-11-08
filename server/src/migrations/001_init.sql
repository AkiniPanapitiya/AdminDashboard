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

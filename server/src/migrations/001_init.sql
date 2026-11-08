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

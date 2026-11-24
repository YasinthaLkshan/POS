-- Authentication now belongs to the trusted API and PostgreSQL.
-- Keep historical Firebase columns and image rows so upgrades never discard data.
ALTER TABLE staff ADD COLUMN username text;
ALTER TABLE staff ADD COLUMN password_hash text;
ALTER TABLE staff ADD COLUMN login_failures integer NOT NULL DEFAULT 0;
ALTER TABLE staff ADD COLUMN locked_until timestamptz;
ALTER TABLE staff ADD CONSTRAINT staff_username_format CHECK (username IS NULL OR username ~ '^[a-z][a-z0-9._-]{2,39}$');
CREATE UNIQUE INDEX staff_username_unique ON staff(lower(username)) WHERE username IS NOT NULL;
CREATE TABLE auth_sessions (
  token_hash text PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_staff_idx ON auth_sessions(staff_id);
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON auth_sessions FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON auth_sessions FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON auth_sessions FROM authenticated; END IF;
END $$;

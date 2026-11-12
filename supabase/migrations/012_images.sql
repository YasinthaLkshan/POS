-- Store small private PNG assets in PostgreSQL so no paid image bucket is required.
CREATE TABLE image_objects (
  path text PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES shops(id),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 33 AND 131072),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (path LIKE shop_id::text || '/%')
);
CREATE INDEX image_objects_shop_idx ON image_objects(shop_id);
ALTER TABLE image_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON image_objects FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON image_objects FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON image_objects FROM authenticated;
  END IF;
END $$;

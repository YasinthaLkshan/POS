CREATE TABLE terminals(id uuid PRIMARY KEY,shop_id uuid NOT NULL REFERENCES shops(id),name text NOT NULL,offline_enabled boolean NOT NULL DEFAULT false,authorized_by uuid NOT NULL REFERENCES staff(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(shop_id,id));
CREATE TABLE offline_grants(id uuid PRIMARY KEY,shop_id uuid NOT NULL REFERENCES shops(id),staff_id uuid NOT NULL REFERENCES staff(id),terminal_id uuid NOT NULL,token_hash text NOT NULL,snapshot jsonb NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(shop_id,terminal_id) REFERENCES terminals(shop_id,id));
CREATE TABLE sync_operations(id uuid PRIMARY KEY,shop_id uuid NOT NULL REFERENCES shops(id),staff_id uuid NOT NULL REFERENCES staff(id),grant_id uuid NOT NULL REFERENCES offline_grants(id),payload jsonb NOT NULL,payload_hash text NOT NULL,state text NOT NULL CHECK(state IN ('pending','synced','conflict')),message text NOT NULL DEFAULT '',receipt jsonb,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX sync_shop_state ON sync_operations(shop_id,state);
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['terminals','offline_grants','sync_operations'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',t);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM anon, authenticated',t);END IF;
END LOOP;END $$;

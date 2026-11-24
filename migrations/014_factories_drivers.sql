-- Factories group lorry drivers. Drivers and quick normal-credit customers are customer rows with a kind.
CREATE TABLE factories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES shops(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200), address text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '',
 notes text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(shop_id,id)
);
CREATE UNIQUE INDEX factories_name ON factories(shop_id, lower(trim(name)));
ALTER TABLE customers ADD COLUMN kind text NOT NULL DEFAULT 'registered' CHECK(kind IN ('registered','driver','walk_in'));
ALTER TABLE customers ADD COLUMN factory_id uuid;
ALTER TABLE customers ADD CONSTRAINT customers_factory_fk FOREIGN KEY(shop_id,factory_id) REFERENCES factories(shop_id,id);
ALTER TABLE customers ADD COLUMN driver_code text;
ALTER TABLE customers ADD COLUMN lorry_number text NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN notes text NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN registered_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE customers ADD CONSTRAINT customers_driver_fields CHECK(kind<>'driver' OR (factory_id IS NOT NULL AND driver_code IS NOT NULL));
-- A null credit limit means no limit (drivers and quick credit customers).
ALTER TABLE customers ALTER COLUMN credit_limit DROP NOT NULL;
CREATE UNIQUE INDEX customers_driver_code ON customers(shop_id, driver_code) WHERE driver_code IS NOT NULL;
CREATE INDEX customers_kind_name ON customers(shop_id, kind, name);
CREATE INDEX customers_factory ON customers(shop_id, factory_id) WHERE factory_id IS NOT NULL;
ALTER TABLE factories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE factories FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON factories FROM anon, authenticated; END IF; END $$;

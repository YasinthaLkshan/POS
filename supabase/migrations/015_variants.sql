-- Each variant (loose kg, 25 kg bag, 50 kg bag) is its own sellable product with separate stock batches.
CREATE TABLE product_families (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES shops(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200), category_id uuid NOT NULL,
 brand text NOT NULL DEFAULT '', description text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(shop_id,id), FOREIGN KEY(shop_id,category_id) REFERENCES categories(shop_id,id)
);
CREATE UNIQUE INDEX product_families_name ON product_families(shop_id, lower(trim(name)));
ALTER TABLE products ADD COLUMN family_id uuid;
ALTER TABLE products ADD CONSTRAINT products_family_fk FOREIGN KEY(shop_id,family_id) REFERENCES product_families(shop_id,id);
ALTER TABLE products ADD COLUMN variant_label text NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN whole_units boolean NOT NULL DEFAULT false;
UPDATE products SET whole_units = unit IN ('piece','packet','bag','tray','pot');
CREATE UNIQUE INDEX products_family_variant ON products(family_id, lower(variant_label)) WHERE family_id IS NOT NULL;
-- Discount per base unit of a variant, applied automatically only to lorry driver sales.
CREATE TABLE driver_discounts (
 shop_id uuid NOT NULL REFERENCES shops(id), product_id uuid NOT NULL, amount bigint NOT NULL CHECK(amount>=0),
 updated_by uuid NOT NULL REFERENCES staff(id), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(shop_id,product_id), FOREIGN KEY(shop_id,product_id) REFERENCES products(shop_id,id)
);
ALTER TABLE inventory_movements DROP CONSTRAINT inventory_movements_type_check;
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_type_check CHECK(type IN ('purchase_receipt','sale','sale_return','supplier_return','adjustment','damage','write_off','stock_receipt','conversion_in','conversion_out'));
CREATE TABLE stock_conversions (
 id uuid PRIMARY KEY, shop_id uuid NOT NULL REFERENCES shops(id), from_product_id uuid NOT NULL, to_product_id uuid NOT NULL,
 quantity bigint NOT NULL CHECK(quantity>0), resulting_quantity bigint NOT NULL CHECK(resulting_quantity>0), cost bigint NOT NULL CHECK(cost>=0),
 reason text NOT NULL, actor_id uuid NOT NULL REFERENCES staff(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(shop_id,from_product_id) REFERENCES products(shop_id,id), FOREIGN KEY(shop_id,to_product_id) REFERENCES products(shop_id,id),
 CHECK(from_product_id<>to_product_id)
);
CREATE TRIGGER immutable_stock_conversions BEFORE UPDATE OR DELETE ON stock_conversions FOR EACH ROW EXECUTE FUNCTION deny_mutation();
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['product_families','driver_discounts','stock_conversions'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',t);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM anon, authenticated',t); END IF;
END LOOP; END $$;

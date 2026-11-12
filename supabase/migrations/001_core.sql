-- Trusted API owns writes. Direct Supabase Data API access is denied by RLS.
CREATE TABLE shops (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
 address text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '',
 receipt_footer text NOT NULL DEFAULT 'Thank you for growing with us.', expiry_alert_days integer NOT NULL DEFAULT 30 CHECK(expiry_alert_days BETWEEN 1 AND 365)
);
CREATE TABLE staff (
 id uuid PRIMARY KEY, shop_id uuid NOT NULL REFERENCES shops(id), name text NOT NULL,
 role text NOT NULL CHECK(role IN ('administrator','manager','cashier','inventory')), active boolean NOT NULL DEFAULT true
);
CREATE TABLE categories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES shops(id), name text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('fertilizer','seed','plant','equipment','other')), UNIQUE(shop_id,name), UNIQUE(shop_id,id)
);
CREATE TABLE suppliers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES shops(id), name text NOT NULL,
 phone text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '', address text NOT NULL DEFAULT '', UNIQUE(shop_id,id)
);
CREATE TABLE customers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES shops(id), name text NOT NULL,
 phone text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '', address text NOT NULL DEFAULT '',
 credit_limit bigint NOT NULL DEFAULT 0 CHECK(credit_limit >= 0), UNIQUE(shop_id,id)
);
CREATE TABLE products (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES shops(id), name text NOT NULL, sku text NOT NULL,
 barcode text, category_id uuid NOT NULL, supplier_id uuid, brand text NOT NULL DEFAULT '', description text NOT NULL DEFAULT '', unit text NOT NULL,
 selling_price bigint NOT NULL CHECK(selling_price >= 0), purchase_price bigint NOT NULL CHECK(purchase_price >= 0),
 tax_bps integer NOT NULL DEFAULT 0 CHECK(tax_bps BETWEEN 0 AND 10000), minimum_stock bigint NOT NULL DEFAULT 0 CHECK(minimum_stock >= 0),
 active boolean NOT NULL DEFAULT true, attributes jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(shop_id,sku), UNIQUE(shop_id,barcode), UNIQUE(shop_id,id),
 FOREIGN KEY(shop_id,category_id) REFERENCES categories(shop_id,id), FOREIGN KEY(shop_id,supplier_id) REFERENCES suppliers(shop_id,id)
);
CREATE TABLE purchases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES shops(id), supplier_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'ordered' CHECK(status IN ('ordered','partial','received')), created_by uuid NOT NULL REFERENCES staff(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(shop_id,id), FOREIGN KEY(shop_id,supplier_id) REFERENCES suppliers(shop_id,id)
);
CREATE TABLE purchase_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL, purchase_id uuid NOT NULL, product_id uuid NOT NULL,
 quantity bigint NOT NULL CHECK(quantity > 0), received bigint NOT NULL DEFAULT 0 CHECK(received >= 0 AND received <= quantity), unit_cost bigint NOT NULL CHECK(unit_cost >= 0),
 FOREIGN KEY(shop_id,purchase_id) REFERENCES purchases(shop_id,id), FOREIGN KEY(shop_id,product_id) REFERENCES products(shop_id,id), UNIQUE(purchase_id,product_id)
);
CREATE TABLE batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL, product_id uuid NOT NULL, batch_number text NOT NULL,
 expiry_date date, quantity bigint NOT NULL CHECK(quantity >= 0), unit_cost bigint NOT NULL CHECK(unit_cost >= 0), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(shop_id,id), FOREIGN KEY(shop_id,product_id) REFERENCES products(shop_id,id)
);
CREATE INDEX batches_fefo ON batches(shop_id,product_id,expiry_date,created_at);
CREATE TABLE sales (
 id uuid PRIMARY KEY, shop_id uuid NOT NULL REFERENCES shops(id), terminal_id uuid NOT NULL, customer_id uuid, cashier_id uuid NOT NULL REFERENCES staff(id),
 subtotal bigint NOT NULL CHECK(subtotal >= 0), discount bigint NOT NULL CHECK(discount >= 0 AND discount <= subtotal), tax bigint NOT NULL CHECK(tax >= 0),
 total bigint NOT NULL CHECK(total = subtotal-discount+tax), cost bigint NOT NULL CHECK(cost >= 0), credit bigint NOT NULL CHECK(credit >= 0 AND credit <= total),
 cash_tendered bigint NOT NULL DEFAULT 0 CHECK(cash_tendered >= 0), change bigint NOT NULL DEFAULT 0 CHECK(change >= 0),
 due_date date, status text NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','returned')), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(shop_id,id), FOREIGN KEY(shop_id,customer_id) REFERENCES customers(shop_id,id), CHECK(credit=0 OR (customer_id IS NOT NULL AND due_date IS NOT NULL))
);
CREATE TABLE sale_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL, sale_id uuid NOT NULL, product_id uuid NOT NULL,
 name text NOT NULL, quantity bigint NOT NULL CHECK(quantity>0), unit_price bigint NOT NULL CHECK(unit_price>=0), discount bigint NOT NULL CHECK(discount>=0), tax bigint NOT NULL CHECK(tax>=0), total bigint NOT NULL CHECK(total>=0), cost bigint NOT NULL CHECK(cost>=0),
 FOREIGN KEY(shop_id,sale_id) REFERENCES sales(shop_id,id), FOREIGN KEY(shop_id,product_id) REFERENCES products(shop_id,id)
);
CREATE TABLE sale_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL, sale_id uuid NOT NULL, batch_id uuid NOT NULL, quantity bigint NOT NULL CHECK(quantity>0),
 FOREIGN KEY(shop_id,sale_id) REFERENCES sales(shop_id,id), FOREIGN KEY(shop_id,batch_id) REFERENCES batches(shop_id,id)
);
CREATE TABLE payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL, sale_id uuid NOT NULL, method text NOT NULL CHECK(method IN ('cash','card','transfer')),
 amount bigint NOT NULL CHECK(amount>0), reference text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(shop_id,sale_id) REFERENCES sales(shop_id,id), CHECK(method='cash' OR length(trim(reference))>0)
);
CREATE TABLE inventory_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL, batch_id uuid NOT NULL, delta bigint NOT NULL CHECK(delta<>0),
 type text NOT NULL CHECK(type IN ('purchase_receipt','sale','sale_return','adjustment','damage','write_off')),
 reason text NOT NULL, reference_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES staff(id), created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(shop_id,batch_id) REFERENCES batches(shop_id,id)
);
CREATE TABLE customer_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL, customer_id uuid NOT NULL, sale_id uuid,
 amount bigint NOT NULL CHECK(amount<>0), type text NOT NULL CHECK(type IN ('credit_sale','repayment','return')), reference text NOT NULL DEFAULT '', actor_id uuid NOT NULL REFERENCES staff(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(shop_id,customer_id) REFERENCES customers(shop_id,id), FOREIGN KEY(shop_id,sale_id) REFERENCES sales(shop_id,id)
);
CREATE TABLE expenses (
 id uuid PRIMARY KEY, shop_id uuid NOT NULL REFERENCES shops(id), category text NOT NULL, description text NOT NULL,
 amount bigint NOT NULL CHECK(amount>0), date date NOT NULL, actor_id uuid NOT NULL REFERENCES staff(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE returns (
 id uuid PRIMARY KEY, shop_id uuid NOT NULL, sale_id uuid NOT NULL UNIQUE, reason text NOT NULL, restock boolean NOT NULL,
 refund_amount bigint NOT NULL CHECK(refund_amount>=0), actor_id uuid NOT NULL REFERENCES staff(id), created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(shop_id,sale_id) REFERENCES sales(shop_id,id)
);
CREATE TABLE audit_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES shops(id), actor_id uuid NOT NULL REFERENCES staff(id), action text NOT NULL,
 entity_id uuid NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE operations (
 shop_id uuid NOT NULL REFERENCES shops(id), id uuid NOT NULL, kind text NOT NULL, payload_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(shop_id,id)
);
CREATE INDEX sales_shop_date ON sales(shop_id,created_at);
CREATE INDEX movements_shop_date ON inventory_movements(shop_id,created_at);
CREATE INDEX ledger_customer ON customer_ledger(shop_id,customer_id);
-- Immutable accounting history. Corrections must be compensating entries.
CREATE FUNCTION deny_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Accounting history is immutable'; END $$;
CREATE TRIGGER immutable_movements BEFORE UPDATE OR DELETE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER immutable_ledger BEFORE UPDATE OR DELETE ON customer_ledger FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION deny_mutation();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['shops','staff','categories','suppliers','customers','products','purchases','purchase_lines','batches','sales','sale_lines','sale_allocations','payments','inventory_movements','customer_ledger','expenses','returns','audit_logs','operations'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM anon, authenticated', t); END IF;
 END LOOP;
END $$;

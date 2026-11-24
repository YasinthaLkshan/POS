ALTER TABLE shops ADD COLUMN require_cash_session boolean NOT NULL DEFAULT false;
CREATE TABLE cash_sessions (
 id uuid PRIMARY KEY, shop_id uuid NOT NULL REFERENCES shops(id), terminal_id uuid NOT NULL, opened_by uuid NOT NULL REFERENCES staff(id),
 opening_float bigint NOT NULL CHECK(opening_float>=0), opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
 closed_by uuid REFERENCES staff(id), expected_close bigint, actual_close bigint CHECK(actual_close>=0), difference bigint,
 UNIQUE(shop_id,id), CHECK((closed_at IS NULL AND actual_close IS NULL) OR (closed_at IS NOT NULL AND actual_close IS NOT NULL AND difference=actual_close-expected_close))
);
CREATE UNIQUE INDEX one_open_register ON cash_sessions(shop_id,terminal_id) WHERE closed_at IS NULL;
CREATE TABLE cash_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shop_id uuid NOT NULL,session_id uuid NOT NULL,amount bigint NOT NULL CHECK(amount<>0),
 type text NOT NULL CHECK(type IN ('sale','refund','repayment','expense','supplier_payment','cash_in','cash_out')),reference_id uuid NOT NULL,
 reason text NOT NULL,actor_id uuid NOT NULL REFERENCES staff(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(shop_id,session_id) REFERENCES cash_sessions(shop_id,id),UNIQUE(session_id,reference_id,type)
);
CREATE TABLE supplier_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shop_id uuid NOT NULL,supplier_id uuid NOT NULL,purchase_id uuid,
 amount bigint NOT NULL CHECK(amount<>0),type text NOT NULL CHECK(type IN ('receipt','payment','return')),reference_id uuid NOT NULL,
 method text,reference text NOT NULL DEFAULT '',actor_id uuid NOT NULL REFERENCES staff(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(shop_id,supplier_id) REFERENCES suppliers(shop_id,id),FOREIGN KEY(shop_id,purchase_id) REFERENCES purchases(shop_id,id)
);
CREATE TABLE stocktakes (
 id uuid PRIMARY KEY,shop_id uuid NOT NULL REFERENCES shops(id),reason text NOT NULL,actor_id uuid NOT NULL REFERENCES staff(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE parked_sales (
 id uuid PRIMARY KEY,shop_id uuid NOT NULL REFERENCES shops(id),label text NOT NULL,cart jsonb NOT NULL,created_by uuid NOT NULL REFERENCES staff(id),
 claimed_by uuid REFERENCES staff(id),status text NOT NULL CHECK(status IN ('parked','resumed','completed','cancelled')) DEFAULT 'parked',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shop_id uuid NOT NULL REFERENCES shops(id),staff_id uuid NOT NULL REFERENCES staff(id),title text NOT NULL,body text NOT NULL,
 severity text NOT NULL CHECK(severity IN ('info','warning','danger','success')),read_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_cash BEFORE UPDATE OR DELETE ON cash_movements FOR EACH ROW EXECUTE FUNCTION deny_mutation();
CREATE TRIGGER immutable_supplier_ledger BEFORE UPDATE OR DELETE ON supplier_ledger FOR EACH ROW EXECUTE FUNCTION deny_mutation();
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['cash_sessions','cash_movements','supplier_ledger','stocktakes','parked_sales','notifications'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',t);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM anon, authenticated',t);END IF;
END LOOP;END $$;
CREATE INDEX supplier_ledger_balance ON supplier_ledger(shop_id,supplier_id);

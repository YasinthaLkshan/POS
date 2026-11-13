-- Every credit invoice has its own repayment schedule. Balances are always derived from allocations.
CREATE TABLE credit_installments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL, sale_id uuid NOT NULL, seq integer NOT NULL CHECK(seq BETWEEN 1 AND 24),
 due_date date NOT NULL, amount bigint NOT NULL CHECK(amount>0), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(shop_id,id), UNIQUE(sale_id,seq), FOREIGN KEY(shop_id,sale_id) REFERENCES sales(shop_id,id)
);
CREATE TABLE installment_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL, ledger_id uuid NOT NULL REFERENCES customer_ledger(id),
 installment_id uuid NOT NULL, amount bigint NOT NULL CHECK(amount>0),
 FOREIGN KEY(shop_id,installment_id) REFERENCES credit_installments(shop_id,id), UNIQUE(ledger_id,installment_id)
);
CREATE TABLE installment_reductions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL, return_id uuid NOT NULL,
 installment_id uuid NOT NULL, amount bigint NOT NULL CHECK(amount>0),
 FOREIGN KEY(shop_id,return_id) REFERENCES returns(shop_id,id),
 FOREIGN KEY(shop_id,installment_id) REFERENCES credit_installments(shop_id,id), UNIQUE(return_id,installment_id)
);
CREATE INDEX installments_due ON credit_installments(shop_id,due_date);
CREATE INDEX installment_allocations_installment ON installment_allocations(installment_id);
CREATE INDEX installment_reductions_installment ON installment_reductions(installment_id);
-- Existing credit invoices keep a single installment on their original due date, with their
-- historical repayments and returned credit attached. No existing row is modified.
INSERT INTO credit_installments(shop_id,sale_id,seq,due_date,amount)
 SELECT shop_id,id,1,due_date,credit FROM sales WHERE credit>0;
INSERT INTO installment_allocations(shop_id,ledger_id,installment_id,amount)
 SELECT a.shop_id,a.ledger_id,i.id,a.amount FROM repayment_allocations a JOIN credit_installments i ON i.sale_id=a.sale_id AND i.seq=1;
INSERT INTO installment_reductions(shop_id,return_id,installment_id,amount)
 SELECT r.shop_id,r.id,i.id,r.credit_amount FROM returns r JOIN credit_installments i ON i.sale_id=r.sale_id AND i.seq=1 WHERE r.credit_amount>0;
CREATE VIEW installment_balances AS
 SELECT i.id,i.shop_id,i.sale_id,i.seq,i.due_date,i.amount,i.created_at,
  COALESCE(p.paid,0)::bigint paid, COALESCE(r.reduced,0)::bigint reduced,
  (i.amount-COALESCE(p.paid,0)-COALESCE(r.reduced,0))::bigint remaining
 FROM credit_installments i
 LEFT JOIN (SELECT installment_id,SUM(amount) paid FROM installment_allocations GROUP BY installment_id) p ON p.installment_id=i.id
 LEFT JOIN (SELECT installment_id,SUM(amount) reduced FROM installment_reductions GROUP BY installment_id) r ON r.installment_id=i.id;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['credit_installments','installment_allocations','installment_reductions'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',t);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM anon, authenticated',t); END IF;
 EXECUTE format('CREATE TRIGGER immutable_%I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION deny_mutation()',t,t);
END LOOP; END $$;
REVOKE ALL ON installment_balances FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON installment_balances FROM anon, authenticated; END IF; END $$;

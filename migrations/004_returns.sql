ALTER TABLE returns DROP CONSTRAINT returns_sale_id_key;
ALTER TABLE sale_allocations ADD COLUMN cost bigint NOT NULL DEFAULT 0 CHECK(cost>=0);
UPDATE sale_allocations a SET cost=round(b.unit_cost::numeric*a.quantity/1000)::bigint FROM batches b WHERE b.id=a.batch_id;
ALTER TABLE returns ADD COLUMN credit_amount bigint NOT NULL DEFAULT 0 CHECK(credit_amount>=0);
ALTER TABLE returns ADD COLUMN total_amount bigint NOT NULL DEFAULT 0 CHECK(total_amount>=0);
ALTER TABLE returns ADD COLUMN tax bigint NOT NULL DEFAULT 0 CHECK(tax>=0);
ALTER TABLE returns ADD COLUMN cost bigint NOT NULL DEFAULT 0 CHECK(cost>=0);
ALTER TABLE returns ADD COLUMN refund_method text NOT NULL DEFAULT 'cash' CHECK(refund_method IN ('cash','card','transfer'));
ALTER TABLE returns ADD COLUMN reference text NOT NULL DEFAULT '';
ALTER TABLE returns ADD UNIQUE(shop_id,id);
UPDATE returns r SET total_amount=s.total,tax=s.tax,cost=CASE WHEN r.restock THEN s.cost ELSE 0 END FROM sales s WHERE s.id=r.sale_id;
ALTER TABLE returns ADD CHECK(total_amount=refund_amount+credit_amount);
CREATE TABLE repayment_allocations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES shops(id), ledger_id uuid NOT NULL REFERENCES customer_ledger(id), sale_id uuid NOT NULL,
 amount bigint NOT NULL CHECK(amount>0), FOREIGN KEY(shop_id,sale_id) REFERENCES sales(shop_id,id), UNIQUE(ledger_id,sale_id)
);
-- Allocate historical repayments oldest-invoice first. Historical credit returns were prohibited.
DO $$ DECLARE payment record; invoice record; remaining bigint; take bigint; BEGIN
 FOR payment IN SELECT * FROM customer_ledger WHERE type='repayment' ORDER BY created_at,id LOOP
  remaining := -payment.amount;
  FOR invoice IN SELECT s.id,s.credit-COALESCE((SELECT SUM(a.amount) FROM repayment_allocations a WHERE a.sale_id=s.id),0) due FROM sales s WHERE s.customer_id=payment.customer_id AND s.shop_id=payment.shop_id AND s.credit>0 ORDER BY s.due_date,s.created_at,s.id LOOP
   take := LEAST(remaining,invoice.due); IF take>0 THEN INSERT INTO repayment_allocations(shop_id,ledger_id,sale_id,amount) VALUES(payment.shop_id,payment.id,invoice.id,take); remaining:=remaining-take; END IF;
   EXIT WHEN remaining=0;
  END LOOP;
  IF remaining<>0 THEN RAISE EXCEPTION 'Historical repayment cannot be allocated'; END IF;
 END LOOP;
END $$;
ALTER TABLE sale_lines ADD UNIQUE(shop_id,id);
CREATE TABLE return_lines(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shop_id uuid NOT NULL,return_id uuid NOT NULL,sale_line_id uuid NOT NULL,
 quantity bigint NOT NULL CHECK(quantity>0),total bigint NOT NULL CHECK(total>=0),tax bigint NOT NULL CHECK(tax>=0),cost bigint NOT NULL CHECK(cost>=0),
 FOREIGN KEY(shop_id,return_id) REFERENCES returns(shop_id,id),FOREIGN KEY(shop_id,sale_line_id) REFERENCES sale_lines(shop_id,id),UNIQUE(return_id,sale_line_id)
);
INSERT INTO return_lines(shop_id,return_id,sale_line_id,quantity,total,tax,cost) SELECT r.shop_id,r.id,l.id,l.quantity,l.total,l.tax,CASE WHEN r.restock THEN l.cost ELSE 0 END FROM returns r JOIN sale_lines l ON l.sale_id=r.sale_id;
CREATE TABLE return_allocations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),shop_id uuid NOT NULL,return_id uuid NOT NULL,batch_id uuid NOT NULL,
 quantity bigint NOT NULL CHECK(quantity>0),FOREIGN KEY(shop_id,return_id) REFERENCES returns(shop_id,id),FOREIGN KEY(shop_id,batch_id) REFERENCES batches(shop_id,id)
);
INSERT INTO return_allocations(shop_id,return_id,batch_id,quantity) SELECT r.shop_id,r.id,a.batch_id,a.quantity FROM returns r JOIN sale_allocations a ON a.sale_id=r.sale_id;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['repayment_allocations','return_lines','return_allocations'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE %I FROM anon, authenticated',t); END IF;
  EXECUTE format('CREATE TRIGGER immutable_%I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION deny_mutation()',t,t);
 END LOOP;
END $$;
CREATE TRIGGER immutable_returns BEFORE UPDATE OR DELETE ON returns FOR EACH ROW EXECUTE FUNCTION deny_mutation();

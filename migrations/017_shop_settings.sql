ALTER TABLE shops ADD COLUMN driver_installments integer NOT NULL DEFAULT 2 CHECK(driver_installments BETWEEN 1 AND 12);
ALTER TABLE shops ADD COLUMN driver_credit_months integer NOT NULL DEFAULT 2 CHECK(driver_credit_months BETWEEN 1 AND 24);
ALTER TABLE shops ADD COLUMN normal_credit_months integer NOT NULL DEFAULT 1 CHECK(normal_credit_months BETWEEN 1 AND 12);
ALTER TABLE shops ADD COLUMN due_soon_days integer NOT NULL DEFAULT 7 CHECK(due_soon_days BETWEEN 0 AND 60);
ALTER TABLE shops ADD COLUMN next_invoice_number bigint NOT NULL DEFAULT 1 CHECK(next_invoice_number>0);
ALTER TABLE shops ADD CONSTRAINT shops_driver_period CHECK(driver_credit_months>=driver_installments);
ALTER TABLE sales ADD COLUMN bill_discount bigint NOT NULL DEFAULT 0 CHECK(bill_discount>=0);
ALTER TABLE sales ADD COLUMN customer_name text NOT NULL DEFAULT '';
ALTER TABLE sales ADD COLUMN notes text NOT NULL DEFAULT '';
ALTER TABLE sales ADD CONSTRAINT sales_bill_discount CHECK(bill_discount<=discount);
ALTER TABLE sale_lines ADD COLUMN auto_discount bigint NOT NULL DEFAULT 0 CHECK(auto_discount>=0);
ALTER TABLE sale_lines ADD COLUMN unit text NOT NULL DEFAULT '';
ALTER TABLE sale_lines ADD CONSTRAINT sale_lines_auto_discount CHECK(auto_discount<=discount);
-- Older repayments keep their method only in the reference text ("cash: ...").
ALTER TABLE customer_ledger ADD COLUMN method text CHECK(method IN ('cash','card','transfer'));
ALTER TABLE customer_ledger ADD COLUMN notes text NOT NULL DEFAULT '';
UPDATE sales s SET customer_name=c.name FROM customers c WHERE c.id=s.customer_id;
CREATE INDEX sales_customer ON sales(shop_id,customer_id,created_at) WHERE customer_id IS NOT NULL;
CREATE INDEX ledger_shop_type_date ON customer_ledger(shop_id,type,created_at);

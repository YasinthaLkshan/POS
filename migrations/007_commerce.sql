ALTER TABLE products ADD COLUMN purchase_unit text NOT NULL DEFAULT 'piece';
ALTER TABLE products ADD COLUMN purchase_factor bigint NOT NULL DEFAULT 1000 CHECK(purchase_factor>0);
ALTER TABLE products ADD COLUMN reorder_quantity bigint NOT NULL DEFAULT 0 CHECK(reorder_quantity>=0);
ALTER TABLE products ADD COLUMN subcategory text NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN image_path text;
UPDATE products SET purchase_unit=unit;
ALTER TABLE batches ADD COLUMN purchase_id uuid;
ALTER TABLE batches ADD COLUMN supplier_id uuid;
ALTER TABLE batches ADD COLUMN received_quantity bigint CHECK(received_quantity>0);
ALTER TABLE batches ADD COLUMN manufacture_date date;
ALTER TABLE batches ADD COLUMN supplier_lot text NOT NULL DEFAULT '';
ALTER TABLE batches ADD FOREIGN KEY(shop_id,purchase_id) REFERENCES purchases(shop_id,id);
ALTER TABLE batches ADD FOREIGN KEY(shop_id,supplier_id) REFERENCES suppliers(shop_id,id);
UPDATE batches b SET purchase_id=p.id,supplier_id=p.supplier_id,received_quantity=m.delta FROM inventory_movements m JOIN purchases p ON p.id=m.reference_id WHERE m.batch_id=b.id AND m.type='purchase_receipt';
ALTER TABLE inventory_movements DROP CONSTRAINT inventory_movements_type_check;
ALTER TABLE inventory_movements ADD CHECK(type IN ('purchase_receipt','sale','sale_return','supplier_return','adjustment','damage','write_off'));
CREATE TABLE supplier_returns(
 id uuid PRIMARY KEY,shop_id uuid NOT NULL,batch_id uuid NOT NULL,supplier_id uuid NOT NULL,quantity bigint NOT NULL CHECK(quantity>0),credit_amount bigint NOT NULL CHECK(credit_amount>=0),
 reason text NOT NULL,actor_id uuid NOT NULL REFERENCES staff(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(shop_id,batch_id) REFERENCES batches(shop_id,id),FOREIGN KEY(shop_id,supplier_id) REFERENCES suppliers(shop_id,id)
);
ALTER TABLE supplier_returns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON supplier_returns FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON supplier_returns FROM anon,authenticated; END IF; END $$;
CREATE TRIGGER immutable_supplier_returns BEFORE UPDATE OR DELETE ON supplier_returns FOR EACH ROW EXECUTE FUNCTION deny_mutation();

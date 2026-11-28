ALTER TABLE batches ADD COLUMN branch text NOT NULL DEFAULT 'Kuruwita' CHECK (branch IN ('Kuruwita','Parakaduwa'));
ALTER TABLE sales ADD COLUMN branch text NOT NULL DEFAULT 'Kuruwita' CHECK (branch IN ('Kuruwita','Parakaduwa'));
CREATE INDEX batches_branch_stock ON batches(shop_id,branch,product_id);

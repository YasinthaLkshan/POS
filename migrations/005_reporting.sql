CREATE VIEW financial_events AS
 SELECT shop_id,id,created_at,total,tax,cost,1::integer transactions,'sale'::text type FROM sales
 UNION ALL SELECT shop_id,id,created_at,-total_amount,-tax,-cost,0::integer transactions,'return'::text type FROM returns;
REVOKE ALL ON financial_events FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON financial_events FROM anon,authenticated; END IF; END $$;

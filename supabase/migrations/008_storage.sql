-- Supabase-managed Storage tables are absent in local PostgreSQL test environments.
DO $$ BEGIN
 IF to_regclass('storage.buckets') IS NOT NULL THEN
  INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('product-images','product-images',false,131072,ARRAY['image/png'])
   ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=131072,allowed_mime_types=ARRAY['image/png'];
 END IF;
END $$;
-- No browser/anon Storage policies are granted. Trusted API service key accesses this private bucket.

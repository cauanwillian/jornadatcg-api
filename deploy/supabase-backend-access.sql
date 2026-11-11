-- Apply only to the reviewed Supabase database for this backend.
-- Access goes through NestJS with its private database role, never the Data API.
-- RLS does not restrict the owning backend role; no anonymous policies are added.
BEGIN;

DO $$
DECLARE
  backend_table record;
BEGIN
  FOR backend_table IN
    SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      backend_table.schemaname, backend_table.tablename);
  END LOOP;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

COMMIT;

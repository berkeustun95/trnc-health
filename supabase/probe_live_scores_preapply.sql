-- Pre-apply facts for 20261070_live_scores.sql that the PGlite harness cannot model.
-- Read-only. Run: gh workflow run supabase-readonly -f file=supabase/probe_live_scores_preapply.sql --ref feat/live-scores
--   puballtables must be false (the migration asserts exactly 3 of its tables are published);
--   owner must be a role the applying postgres session can ALTER as;
--   postgres must be a member of service_role (the probe does SET LOCAL ROLE service_role);
--   none of the eleven table names may already exist.
SELECT
  (SELECT puballtables FROM pg_publication WHERE pubname = 'supabase_realtime')                  AS realtime_all_tables,
  (SELECT pg_get_userbyid(pubowner) FROM pg_publication WHERE pubname = 'supabase_realtime')     AS realtime_owner,
  pg_has_role('postgres', 'service_role', 'member')                                              AS postgres_in_service_role,
  pg_has_role('postgres', (SELECT pubowner FROM pg_publication WHERE pubname = 'supabase_realtime'), 'member') AS postgres_can_alter_pub,
  (SELECT string_agg(relname, ',') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND relname IN ('leagues','teams','matches','match_events','f1_races','f1_results',
      'f1_standings','api_quota_log','api_request_log','live_sync_state','live_score_editors'))     AS name_collisions,
  (SELECT count(*) FROM public.profiles p WHERE p.role IS DISTINCT FROM 'admin')                  AS non_admin_profiles,
  version()                                                                                       AS pg_version;

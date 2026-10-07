-- Read-only. Check-ins launch readiness (feat/checkins-ready, 20261092):
--   1. every trigger on public.profiles + its function's live source (to reproduce them in the harness)
--   2. the Buradayım waitlist: total, notified, stamps (expect n total, 0 notified before the blast)
--   3. which of 20261092/20261093's objects exist; ledger rows under any of their past numbers;
--      the 1093 preconditions (cron, Vault key by name, auth.users.is_anonymous)
--   4. profiles permissive SELECT/ALL policy count (20261092 asserts it does not change)
SELECT 'trigger' AS what, t.tgname || ' :: ' || pg_get_triggerdef(t.oid) AS detail
  FROM pg_trigger t WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal
UNION ALL
SELECT 'trigger fn ' || p.proname, pg_get_functiondef(p.oid)
  FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
 WHERE t.tgrelid = 'public.profiles'::regclass AND NOT t.tgisinternal
UNION ALL
SELECT 'waitlist checkins', format('total %s · notified %s · first %s · last %s',
         count(*), count(*) FILTER (WHERE notified_at IS NOT NULL), min(notified_at), max(notified_at))
  FROM module_waitlist WHERE module = 'checkins'
UNION ALL
SELECT 'objects present', format('checkins table %s · check_in fn %s · profiles.checkins_public %s',
         to_regclass('public.checkins') IS NOT NULL,
         to_regprocedure('public.check_in(uuid,double precision,double precision,double precision)') IS NOT NULL,
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='checkins_public'))
UNION ALL
SELECT 'objects present (1093)', format('google_place_pins %s · check_in_google %s · checkins.google_place_id %s',
         to_regclass('public.google_place_pins') IS NOT NULL,
         to_regprocedure('public.check_in_google(uuid,text,double precision,double precision,double precision,double precision,double precision,boolean)') IS NOT NULL,
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='checkins' AND column_name='google_place_id'))
UNION ALL
SELECT 'ledger check-ins rows', coalesce(string_agg(filename || ' @ ' || applied_at::text, ', '), '(none)')
  FROM schema_migrations_applied WHERE filename IN ('20261092_checkins.sql','20261093_checkins_google_places.sql',
                                                    '20261078_checkins.sql','20261091_checkins_google_places.sql','20261069_checkins.sql')
UNION ALL
SELECT 'cron google-places jobs', coalesce(string_agg(jobname || ' active=' || active::text, ', '), '(none)')
  FROM cron.job WHERE jobname IN ('purge-google-places-cache','google-places-refresh')
UNION ALL
SELECT 'vault novest_sync_key present', (SELECT count(*)::text FROM vault.secrets WHERE name = 'novest_sync_key')
UNION ALL
SELECT 'auth.users.is_anonymous column', EXISTS (SELECT 1 FROM information_schema.columns
         WHERE table_schema='auth' AND table_name='users' AND column_name='is_anonymous')::text
UNION ALL
SELECT 'profiles policies', format('all %s · permissive SELECT/ALL %s',
         count(*), count(*) FILTER (WHERE permissive = 'PERMISSIVE' AND cmd IN ('SELECT','ALL')))
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles';

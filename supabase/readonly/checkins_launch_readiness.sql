-- Read-only. Check-ins launch readiness (feat/checkins-ready, 20261078):
--   1. every trigger on public.profiles + its function's live source (to reproduce them in the harness)
--   2. the Buradayım waitlist: total, notified, stamps (expect n total, 0 notified before the blast)
--   3. none of 20261078's objects exist yet; ledger has no row for it
--   4. profiles permissive SELECT/ALL policy count (20261078 asserts it does not change)
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
SELECT 'ledger 20261078/20261069', coalesce(string_agg(filename, ', '), '(none)')
  FROM schema_migrations_applied WHERE filename IN ('20261078_checkins.sql','20261069_checkins.sql')
UNION ALL
SELECT 'profiles policies', format('all %s · permissive SELECT/ALL %s',
         count(*), count(*) FILTER (WHERE permissive = 'PERMISSIVE' AND cmd IN ('SELECT','ALL')))
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles';

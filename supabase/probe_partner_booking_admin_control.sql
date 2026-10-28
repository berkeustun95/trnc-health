-- 20261143 apply: was the admin SELECT positive control run or SKIPPED?
-- The Management API drops RAISE NOTICE, so the apply log cannot show it. The DO block SKIPS only
-- when no profiles row has role = 'admin'; otherwise a wrong count raises and the apply rolls back.
-- Counts only, no ids.
SELECT
  (SELECT count(*) FROM public.profiles WHERE role = 'admin')                         AS admin_profiles,
  (SELECT count(*) FROM public.partner_booking_requests)                               AS booking_rows,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.partner_booking_requests'::regclass) AS rls_on,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'partner_booking_requests') AS policies,
  (SELECT count(*) FROM public.schema_migrations_applied WHERE filename = '20261143_partner_booking_requests.sql') AS ledger_rows;

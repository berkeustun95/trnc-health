-- Read-only probe (Döveç enquiry limits, 20261240): is the limit trigger function what the migration says, and can its owner read dovec_leads?
-- Reads ONLY catalogs: pg_proc / pg_roles / pg_class / pg_policies / pg_trigger, reached through to_regprocedure / to_regclass so a missing
-- object prints NULL instead of an error. No user rows are read and no count of user rows is taken (the one count is of catalog policy rows).
-- Prints NO user data and no identifiers: booleans, role names, and the trigger definition text.
-- Run alone in the SQL editor / supabase-readonly. Healthy after 20261240: prosecdef true, proconfig search_path="", owner_bypassrls or
-- owner = table owner with force_rls false, policies_on_table 0.
SELECT p.prosecdef                               AS fn_prosecdef,
       p.proconfig                               AS fn_proconfig,
       pg_get_userbyid(p.proowner)               AS fn_owner,
       fo.rolbypassrls                           AS fn_owner_bypassrls,
       fo.rolsuper                               AS fn_owner_superuser,
       c.relrowsecurity                          AS tbl_rls,
       c.relforcerowsecurity                     AS tbl_force_rls,
       pg_get_userbyid(c.relowner)               AS tbl_owner,
       co.rolbypassrls                           AS tbl_owner_bypassrls,
       (SELECT count(*) FROM pg_policies pp WHERE pp.schemaname = 'public' AND pp.tablename = 'dovec_leads') AS policies_on_table,
       (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname = 'dovec_leads_rate_limit' AND NOT t.tgisinternal) AS trigger_def,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_role_can_execute,
       EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS public_can_execute,
       strpos(pg_get_functiondef(p.oid), 'client_request_id = NEW.client_request_id') > 0 AS fn_skips_repeat_request
  FROM (SELECT 1) one
  LEFT JOIN pg_proc p   ON p.oid = to_regprocedure('public.dovec_leads_enforce_limits()')
  LEFT JOIN pg_class c  ON c.oid = to_regclass('public.dovec_leads')
  LEFT JOIN pg_roles fo ON fo.oid = p.proowner
  LEFT JOIN pg_roles co ON co.oid = c.relowner;

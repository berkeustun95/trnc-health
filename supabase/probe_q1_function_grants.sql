-- READ ONLY. The functions verify_schema QUERY 1 executes, plus every public/auth function their
-- bodies call (transitively), with security mode, volatility, ACL and body: the input to the
-- read-only-role grant decision. Run: gh workflow run supabase-readonly -f file=supabase/probe_q1_function_grants.sql --ref probe/q1-function-grants
WITH RECURSIVE fns AS (
  SELECT p.oid, 0 AS depth, p.proname::text AS via
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('search_fold','contains_blocked_term','may_initiate_by_age','is_listed_student','is_anonymous_session')
  UNION
  SELECT p2.oid, f.depth + 1, f.via
    FROM fns f JOIN pg_proc p1 ON p1.oid = f.oid
    JOIN pg_proc p2 ON p1.prosrc ~ ('\m' || p2.proname || '\s*\(')
    JOIN pg_namespace n2 ON n2.oid = p2.pronamespace
   WHERE n2.nspname IN ('public','auth') AND f.depth < 4 AND p2.oid <> p1.oid
)
SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS fn,
       min(f.depth) AS depth, string_agg(DISTINCT f.via, ',') AS reached_from,
       pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer,
       CASE p.provolatile WHEN 'i' THEN 'IMMUTABLE' WHEN 's' THEN 'STABLE' ELSE 'VOLATILE' END AS volatility,
       p.prolang::reglanguage::text AS lang, p.proconfig::text AS config, p.proacl::text AS acl,
       has_function_privilege('supabase_read_only_user', p.oid, 'EXECUTE') AS ro_can_execute,
       p.prosrc AS body
  FROM fns f JOIN pg_proc p ON p.oid = f.oid JOIN pg_namespace n ON n.oid = p.pronamespace
 GROUP BY p.oid, n.nspname, p.proname, p.proowner, p.prosecdef, p.provolatile, p.prolang, p.proconfig, p.proacl, p.prosrc
 ORDER BY min(f.depth), 1;

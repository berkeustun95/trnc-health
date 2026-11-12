-- QA test accounts' auth events (read-only), to find why their app sessions ended on 2026-11-11/12.
-- The two accounts are matched by md5 of the login email, so no address or id is in this public file.
-- Results are sealed (scripts/readonly-results.mjs). SELECTs only. Prints: time (UTC), which QA account (1/2),
-- the audit action and log type, and the user agent family of the request — no ids, tokens or IPs.
SELECT to_char(e.created_at AT TIME ZONE 'utc', 'MM-DD HH24:MI:SS') AS utc,
       CASE md5(lower(e.payload->>'actor_username')) WHEN '6951564d4895e3150aa8d0f3edc076a6' THEN 'QA1' WHEN 'e27b68947c6e31c9dfd9a7def3e40cde' THEN 'QA2' END AS who,
       e.payload->>'action' AS action,
       e.payload->>'log_type' AS log_type,
       coalesce(e.payload->'traits'->>'provider', '') AS provider
  FROM auth.audit_log_entries e
 WHERE e.created_at > now() - interval '3 days'
   AND md5(lower(e.payload->>'actor_username')) IN ('6951564d4895e3150aa8d0f3edc076a6', 'e27b68947c6e31c9dfd9a7def3e40cde')
 ORDER BY e.created_at
 LIMIT 2000;

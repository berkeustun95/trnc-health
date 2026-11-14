-- Audit-run guest, 2026-11-14. READ-ONLY, one SELECT, sealed. Prints NO ids, NO hashes and NO numbers: only yes/no
-- answers and a three-way label ('none' / 'exactly one' / 'more than one').
-- Question: is there exactly one guest matching the account the UX audit created on the test phone (ADA Preview,
-- Android, "Misafir olarak devam et" at about 14:46 UTC on 2026-11-14), so a later migration can delete it by this
-- signature and refuse unless exactly one row matches? Same window and predicate as that migration.
-- Controls: auth.users and auth.sessions are visible to this role (without them every answer would read "none").
WITH c AS (
  SELECT u.id, u.email, p.role, p.push_token,
         EXISTS (SELECT 1 FROM auth.sessions s WHERE s.user_id = u.id AND s.user_agent ILIKE 'okhttp%') AS android_session,
         EXISTS (SELECT 1 FROM auth.sessions s WHERE s.user_id = u.id
                  AND (s.user_agent IS NULL OR s.user_agent NOT ILIKE 'okhttp%'))                       AS other_session
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
   WHERE u.is_anonymous AND u.deleted_at IS NULL
     AND u.created_at >= '2026-11-14 14:45:30+00' AND u.created_at < '2026-11-14 14:48:30+00')
SELECT json_build_object(
  'candidates',            CASE (SELECT count(*) FROM c) WHEN 0 THEN 'none' WHEN 1 THEN 'exactly one' ELSE 'more than one' END,
  'all_android_only',      (SELECT bool_and(android_session AND NOT other_session) FROM c),
  'all_no_email',          (SELECT bool_and(email IS NULL) FROM c),
  'all_customer_profile',  (SELECT bool_and(role = 'customer') FROM c),
  'any_push_token',        (SELECT bool_or(push_token IS NOT NULL) FROM c),
  'control_users_visible', EXISTS (SELECT 1 FROM auth.users),
  'control_sessions_visible', EXISTS (SELECT 1 FROM auth.sessions)
) AS result;

-- Read-only probe (2026-10-20, failed device check): is the previewer account (412cad91…) signed in anywhere recently?
-- Prints only timestamps and the client type of ITS OWN sessions; no other user's data.
SELECT left(s.id::text, 6) AS session_prefix,
       s.created_at, s.updated_at, s.refreshed_at, s.not_after,
       CASE WHEN s.user_agent ILIKE '%okhttp%' THEN 'android app'
            WHEN s.user_agent ILIKE '%CFNetwork%' OR s.user_agent ILIKE '%Darwin%' THEN 'ios app'
            WHEN s.user_agent IS NULL THEN 'unknown' ELSE 'other' END AS client
FROM auth.sessions s
WHERE s.user_id = '412cad91-2e3b-41b9-8186-175dfb8afa35'
ORDER BY coalesce(s.refreshed_at, s.updated_at) DESC NULLS LAST
LIMIT 10;

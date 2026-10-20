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

-- Positive control (counts only): the read-only user can see auth.sessions at all, and how many exist.
SELECT count(*) AS all_sessions,
       count(*) FILTER (WHERE coalesce(refreshed_at, updated_at) > now() - interval '24 hours') AS active_24h,
       count(*) FILTER (WHERE user_id = '412cad91-2e3b-41b9-8186-175dfb8afa35') AS previewer_sessions,
       (SELECT count(*) FROM auth.users WHERE id = '412cad91-2e3b-41b9-8186-175dfb8afa35') AS previewer_user_exists,
       (SELECT max(last_sign_in_at)::date FROM auth.users WHERE id = '412cad91-2e3b-41b9-8186-175dfb8afa35') AS previewer_last_sign_in
FROM auth.sessions;

-- How the previewer account signs in (provider names only, no email), so Berke picks the right login.
SELECT u.raw_app_meta_data->>'provider' AS first_provider,
       (SELECT string_agg(DISTINCT i.provider, ', ') FROM auth.identities i WHERE i.user_id = u.id) AS providers,
       u.email IS NOT NULL AS has_email, u.email_confirmed_at IS NOT NULL AS email_confirmed
FROM auth.users u WHERE u.id = '412cad91-2e3b-41b9-8186-175dfb8afa35';

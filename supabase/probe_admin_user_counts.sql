-- Read-only probe (2026-11-05, admin user-counts screen): totals behind the planned admin_user_counts()
-- and how many users auth.sessions.user_agent can place on a platform. Aggregates only: no ids, emails or
-- user agents leave this query. Client classes are the same ones as probe_previewer_sessions.sql.
WITH live AS (
  SELECT s.user_id,
         CASE WHEN s.user_agent ILIKE '%okhttp%' THEN 'android'
              WHEN s.user_agent ILIKE '%CFNetwork%' OR s.user_agent ILIKE '%Darwin%' THEN 'ios'
              WHEN s.user_agent IS NULL THEN 'unknown' ELSE 'other' END AS client
  FROM auth.sessions s
  WHERE s.not_after IS NULL OR s.not_after > now()
), per_user AS (
  SELECT u.id, u.is_anonymous,
         bool_or(l.client = 'ios') IS TRUE AS on_ios,
         bool_or(l.client = 'android') IS TRUE AS on_android,
         count(l.user_id) > 0 AS has_session
  FROM auth.users u LEFT JOIN live l ON l.user_id = u.id
  GROUP BY u.id, u.is_anonymous
)
SELECT
  (SELECT count(*) FROM auth.users) AS users_total,
  (SELECT count(*) FROM auth.users WHERE is_anonymous) AS guests,
  (SELECT count(*) FROM auth.users WHERE NOT is_anonymous) AS signed_up,
  (SELECT count(*) FROM auth.users WHERE NOT is_anonymous AND email_confirmed_at IS NULL) AS signed_up_unconfirmed,
  (SELECT count(*) FROM auth.users WHERE deleted_at IS NOT NULL) AS soft_deleted,
  (SELECT count(*) FROM auth.users WHERE created_at > now() - interval '30 days') AS created_30d,
  (SELECT count(*) FROM public.profiles) AS profiles_total,
  (SELECT count(*) FROM live) AS live_sessions,
  (SELECT count(*) FROM live WHERE client = 'other') AS sessions_other,
  (SELECT count(*) FROM live WHERE client = 'unknown') AS sessions_unknown,
  (SELECT count(*) FROM per_user WHERE has_session) AS users_with_session,
  (SELECT count(*) FROM per_user WHERE on_ios AND NOT on_android) AS ios_only,
  (SELECT count(*) FROM per_user WHERE on_android AND NOT on_ios) AS android_only,
  (SELECT count(*) FROM per_user WHERE on_ios AND on_android) AS both_platforms,
  (SELECT count(*) FROM per_user WHERE NOT is_anonymous AND (on_ios OR on_android)) AS signed_up_placed,
  (SELECT count(*) FROM per_user WHERE is_anonymous AND (on_ios OR on_android)) AS guests_placed;

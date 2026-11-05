-- Read-only probe (2026-11-05, admin user-counts screen): what the live sessions that match neither iOS nor
-- Android are, so the platform split does not misfile a real app client as Unknown. Aggregates only: the first
-- product token of the user agent and a count, with tokens held by fewer than 3 sessions folded together.
WITH other AS (
  SELECT s.user_id, u.is_anonymous, left(split_part(s.user_agent, '/', 1), 24) AS client
  FROM auth.sessions s JOIN auth.users u ON u.id = s.user_id
  WHERE (s.not_after IS NULL OR s.not_after > now())
    AND s.user_agent IS NOT NULL
    AND s.user_agent NOT ILIKE '%okhttp%' AND s.user_agent NOT ILIKE '%CFNetwork%' AND s.user_agent NOT ILIKE '%Darwin%'
), folded AS (
  SELECT CASE WHEN count(*) OVER (PARTITION BY client) < 3 THEN '(rare)' ELSE client END AS client, user_id, is_anonymous
  FROM other
)
SELECT client, count(*) AS sessions, count(DISTINCT user_id) AS users,
       count(DISTINCT user_id) FILTER (WHERE NOT is_anonymous) AS signed_up_users
FROM folded GROUP BY client ORDER BY sessions DESC;

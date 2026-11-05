-- Read-only probe (2026-11-05): the script-made guests by id, for the delete dry run, and the borderline guests by count.
-- Prints ids of the script-made guests ONLY (no person behind them, no data on them). Real guests appear as counts, never ids.
-- Script-made = guest, a node/curl session, no other client, never refreshed, never used after creation, no push token.
WITH windows(a, b) AS (VALUES
  ('2026-09-24 21:55:57+00'::timestamptz,'2026-09-24 21:56:03+00'::timestamptz),
  ('2026-09-25 09:37:29+00'::timestamptz,'2026-09-25 09:37:35+00'::timestamptz),
  ('2026-09-26 09:21:58+00'::timestamptz,'2026-09-26 09:22:03+00'::timestamptz),
  ('2026-09-27 10:01:06+00'::timestamptz,'2026-09-27 10:01:12+00'::timestamptz),
  ('2026-09-28 10:55:18+00'::timestamptz,'2026-09-28 10:55:25+00'::timestamptz),
  ('2026-09-28 10:55:24+00'::timestamptz,'2026-09-28 10:55:29+00'::timestamptz),
  ('2026-09-28 12:04:28+00'::timestamptz,'2026-09-28 12:04:35+00'::timestamptz),
  ('2026-09-29 10:41:58+00'::timestamptz,'2026-09-29 10:42:04+00'::timestamptz),
  ('2026-10-01 11:04:10+00'::timestamptz,'2026-10-01 11:04:16+00'::timestamptz),
  ('2026-10-01 11:20:21+00'::timestamptz,'2026-10-01 11:20:28+00'::timestamptz),
  ('2026-10-01 11:21:14+00'::timestamptz,'2026-10-01 11:21:20+00'::timestamptz),
  ('2026-10-01 11:22:53+00'::timestamptz,'2026-10-01 11:23:00+00'::timestamptz),
  ('2026-10-01 11:48:47+00'::timestamptz,'2026-10-01 11:48:54+00'::timestamptz),
  ('2026-10-01 12:14:32+00'::timestamptz,'2026-10-01 12:14:38+00'::timestamptz),
  ('2026-10-01 13:15:34+00'::timestamptz,'2026-10-01 13:15:40+00'::timestamptz),
  ('2026-10-02 10:31:07+00'::timestamptz,'2026-10-02 10:31:15+00'::timestamptz),
  ('2026-10-03 09:53:06+00'::timestamptz,'2026-10-03 09:53:12+00'::timestamptz),
  ('2026-10-05 11:30:03+00'::timestamptz,'2026-10-05 11:30:11+00'::timestamptz),
  ('2026-10-05 11:30:16+00'::timestamptz,'2026-10-05 11:30:22+00'::timestamptz),
  ('2026-10-06 11:17:17+00'::timestamptz,'2026-10-06 11:17:24+00'::timestamptz),
  ('2026-10-07 11:05:32+00'::timestamptz,'2026-10-07 11:05:38+00'::timestamptz),
  ('2026-10-08 11:23:14+00'::timestamptz,'2026-10-08 11:23:22+00'::timestamptz),
  ('2026-10-09 11:20:22+00'::timestamptz,'2026-10-09 11:20:29+00'::timestamptz),
  ('2026-10-10 10:37:27+00'::timestamptz,'2026-10-10 10:37:34+00'::timestamptz),
  ('2026-10-11 10:50:14+00'::timestamptz,'2026-10-11 10:50:21+00'::timestamptz),
  ('2026-10-12 11:59:49+00'::timestamptz,'2026-10-12 11:59:56+00'::timestamptz),
  ('2026-10-12 11:59:59+00'::timestamptz,'2026-10-12 12:00:05+00'::timestamptz),
  ('2026-10-13 11:49:27+00'::timestamptz,'2026-10-13 11:49:34+00'::timestamptz),
  ('2026-10-14 09:31:45+00'::timestamptz,'2026-10-14 09:31:52+00'::timestamptz),
  ('2026-10-15 09:09:51+00'::timestamptz,'2026-10-15 09:09:58+00'::timestamptz),
  ('2026-10-16 09:01:59+00'::timestamptz,'2026-10-16 09:02:06+00'::timestamptz),
  ('2026-10-17 08:34:07+00'::timestamptz,'2026-10-17 08:34:13+00'::timestamptz),
  ('2026-10-18 08:51:43+00'::timestamptz,'2026-10-18 08:51:50+00'::timestamptz),
  ('2026-10-19 09:55:00+00'::timestamptz,'2026-10-19 09:55:07+00'::timestamptz),
  ('2026-10-19 09:55:12+00'::timestamptz,'2026-10-19 09:55:18+00'::timestamptz),
  ('2026-10-20 09:26:27+00'::timestamptz,'2026-10-20 09:26:34+00'::timestamptz),
  ('2026-10-21 09:22:49+00'::timestamptz,'2026-10-21 09:22:56+00'::timestamptz),
  ('2026-10-22 09:25:29+00'::timestamptz,'2026-10-22 09:25:36+00'::timestamptz),
  ('2026-10-24 08:53:25+00'::timestamptz,'2026-10-24 08:53:31+00'::timestamptz),
  ('2026-10-25 09:09:54+00'::timestamptz,'2026-10-25 09:10:00+00'::timestamptz),
  ('2026-10-26 07:19:42+00'::timestamptz,'2026-10-26 07:19:49+00'::timestamptz),
  ('2026-10-26 10:08:20+00'::timestamptz,'2026-10-26 10:08:30+00'::timestamptz),
  ('2026-10-26 10:08:29+00'::timestamptz,'2026-10-26 10:08:35+00'::timestamptz),
  ('2026-10-27 09:49:32+00'::timestamptz,'2026-10-27 09:49:38+00'::timestamptz),
  ('2026-10-28 10:35:35+00'::timestamptz,'2026-10-28 10:35:43+00'::timestamptz),
  ('2026-10-30 10:52:41+00'::timestamptz,'2026-10-30 10:52:48+00'::timestamptz),
  ('2026-10-31 10:24:16+00'::timestamptz,'2026-10-31 10:24:23+00'::timestamptz),
  ('2026-11-01 11:17:12+00'::timestamptz,'2026-11-01 11:17:18+00'::timestamptz),
  ('2026-11-02 12:25:11+00'::timestamptz,'2026-11-02 12:25:19+00'::timestamptz),
  ('2026-11-02 12:25:25+00'::timestamptz,'2026-11-02 12:25:31+00'::timestamptz),
  ('2026-11-03 11:56:37+00'::timestamptz,'2026-11-03 11:56:43+00'::timestamptz),
  ('2026-11-05 12:21:58+00'::timestamptz,'2026-11-05 12:22:04+00'::timestamptz)
), sess AS (
  SELECT user_id,
         bool_or(user_agent ILIKE 'node%' OR user_agent ILIKE 'curl%') AS script_session,
         bool_or(user_agent IS NULL OR (user_agent NOT ILIKE 'node%' AND user_agent NOT ILIKE 'curl%')) AS other_session,
         bool_or(refreshed_at IS NOT NULL) AS refreshed,
         min(CASE WHEN user_agent ILIKE 'curl%' THEN 'curl' ELSE 'node' END) AS client
    FROM auth.sessions GROUP BY user_id
), g AS (
  SELECT u.id, u.created_at, p.role, p.push_token, s.user_id IS NOT NULL AS has_session, s.client,
         COALESCE(s.script_session, false) AS script_session, COALESCE(s.other_session, false) AS other_session,
         COALESCE(s.refreshed, false) AS refreshed,
         COALESCE(GREATEST(u.updated_at, u.last_sign_in_at) > u.created_at + interval '1 minute', false) AS used_later,
         EXISTS (SELECT 1 FROM windows w WHERE u.created_at BETWEEN w.a AND w.b) AS in_window
    FROM auth.users u LEFT JOIN sess s ON s.user_id = u.id LEFT JOIN public.profiles p ON p.id = u.id
   WHERE u.is_anonymous AND u.deleted_at IS NULL AND u.email IS NULL
), fake AS (
  SELECT * FROM g WHERE script_session AND NOT other_session AND NOT refreshed AND NOT used_later AND push_token IS NULL AND role = 'customer'
)
SELECT jsonb_build_object(
  'guests', (SELECT count(*) FROM g),
  'fake', (SELECT count(*) FROM fake),
  'fake_in_window', (SELECT count(*) FROM fake WHERE in_window),
  'fake_by_client', (SELECT jsonb_object_agg(client, n) FROM (SELECT client, count(*) n FROM fake GROUP BY client) q),
  'notifications_on_fake', (SELECT count(*) FROM public.notifications n WHERE n.user_id IN (SELECT id FROM fake)),
  'notification_titles_on_fake', (SELECT count(DISTINCT n.title) FROM public.notifications n WHERE n.user_id IN (SELECT id FROM fake)),
  'borderline_script_but_disqualified', (SELECT count(*) FROM g WHERE script_session AND id NOT IN (SELECT id FROM fake)),
  'borderline_no_session_never_used', (SELECT count(*) FROM g WHERE NOT has_session AND NOT used_later),
  'borderline_no_session_never_used_in_window', (SELECT count(*) FROM g WHERE NOT has_session AND NOT used_later AND in_window),
  'kept_no_session_used', (SELECT count(*) FROM g WHERE NOT has_session AND used_later),
  'kept_app_session', (SELECT count(*) FROM g WHERE has_session AND NOT script_session),
  'notifications_fk_rule', (SELECT confdeltype::text FROM pg_constraint WHERE conrelid = 'public.notifications'::regclass AND contype = 'f' AND confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass) LIMIT 1),
  'ids', (SELECT jsonb_agg(jsonb_build_object('id', id, 'created', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'), 'client', client, 'in_window', in_window) ORDER BY created_at) FROM fake)
) AS report;

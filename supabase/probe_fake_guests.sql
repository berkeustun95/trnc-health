-- Read-only probe (2026-11-05): which guests did scripts make? Prints counts, field names and date ranges only, because
-- Actions logs on this public repo are public: no ids, emails, IPs, values or user agents.
-- Windows: every run of a step that executes check-gisekibris-staleness.mjs (52 runs, GitHub Actions step times +/- 2s).
-- Evidence per guest: session client, creation inside a window, use after creation, rows in any public table, profile shape.
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
), uid_cols AS (
  SELECT n.nspname, c.relname, a.attname
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
   WHERE k.contype = 'f' AND k.confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass)
     AND array_length(k.conkey, 1) = 1 AND n.nspname = 'public' AND k.conrelid <> 'public.profiles'::regclass
  UNION
  SELECT table_schema, table_name, column_name FROM information_schema.columns c
   WHERE table_schema = 'public' AND udt_name = 'uuid' AND table_name <> 'profiles'
     AND column_name IN ('user_id','customer_id','owner_id','submitted_by','created_by','requester_id','sender_id','reporter_id','provider_id')
     AND EXISTS (SELECT 1 FROM information_schema.tables t WHERE t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE')
), rows_by_user AS (
  SELECT DISTINCT u.relname, (x::text)::uuid AS user_id
    FROM uid_cols u
   CROSS JOIN LATERAL unnest(xpath('//u/text()', query_to_xml(
     format('select distinct %I as u from %I.%I where %I is not null', u.attname, u.nspname, u.relname, u.attname), false, false, ''))) x
), sess AS (
  SELECT user_id,
         bool_or(user_agent ILIKE 'node%' OR user_agent ILIKE 'curl%') AS script_session,
         bool_or(user_agent IS NOT NULL AND user_agent NOT ILIKE 'node%' AND user_agent NOT ILIKE 'curl%') AS app_session,
         bool_or(refreshed_at IS NOT NULL) AS refreshed
    FROM auth.sessions GROUP BY user_id
), g AS (
  SELECT u.id, u.created_at,
         COALESCE(s.script_session, false) AS script_session,
         COALESCE(s.app_session, false) AS app_session,
         s.user_id IS NOT NULL AS has_session,
         COALESCE(s.refreshed, false) AS refreshed,
         GREATEST(u.updated_at, u.last_sign_in_at) > u.created_at + interval '1 minute' AS used_later,
         EXISTS (SELECT 1 FROM windows w WHERE u.created_at BETWEEN w.a AND w.b) AS in_window,
         EXISTS (SELECT 1 FROM rows_by_user r WHERE r.user_id = u.id) AS has_rows,
         (to_jsonb(p) - 'id' - 'created_at' - 'updated_at') AS prof
    FROM auth.users u LEFT JOIN sess s ON s.user_id = u.id LEFT JOIN public.profiles p ON p.id = u.id
   WHERE u.is_anonymous AND u.deleted_at IS NULL AND u.email IS NULL
), tiered AS (
  SELECT *, CASE
      WHEN script_session AND in_window THEN '1 script session + in window'
      WHEN script_session THEN '2 script session, outside windows'
      WHEN app_session AND in_window THEN '4 app session, in window'
      WHEN in_window THEN '3 no session + in window'
      WHEN NOT has_session AND NOT COALESCE(used_later, true) AND NOT has_rows THEN '5 no session, never used, outside windows'
      ELSE '6 everything else (real guests)' END AS tier,
    jsonb_strip_nulls(prof) AS shape
  FROM g
)
SELECT jsonb_build_object(
  'windows', (SELECT count(*) FROM windows),
  'windows_with_guest', (SELECT count(*) FROM windows w WHERE EXISTS (SELECT 1 FROM g WHERE g.created_at BETWEEN w.a AND w.b)),
  'windows_with_2plus', (SELECT count(*) FROM windows w WHERE (SELECT count(*) FROM g WHERE g.created_at BETWEEN w.a AND w.b) > 1),
  'guests', (SELECT count(*) FROM g),
  'tiers', (SELECT jsonb_agg(t ORDER BY t->>'tier') FROM (
     SELECT jsonb_build_object('tier', tier, 'n', count(*),
       'used_later', count(*) FILTER (WHERE used_later), 'refreshed', count(*) FILTER (WHERE refreshed),
       'has_rows', count(*) FILTER (WHERE has_rows), 'push_token', count(*) FILTER (WHERE prof->>'push_token' IS NOT NULL),
       'first', min(created_at)::date, 'last', max(created_at)::date) AS t
     FROM tiered GROUP BY tier) q),
  'profile_shapes', (SELECT jsonb_agg(t) FROM (
     SELECT jsonb_build_object('tier', tier, 'shape', left(md5(shape::text), 6), 'n', count(*),
       'fields', (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(shape) k)) AS t
     FROM tiered WHERE tier NOT LIKE '6%' GROUP BY tier, shape ORDER BY tier, count(*) DESC) q),
  'rows_tables_tiers_1_to_5', (SELECT jsonb_agg(DISTINCT r.relname) FROM rows_by_user r JOIN tiered t ON t.id = r.user_id WHERE t.tier NOT LIKE '6%'),
  'blocking_fks', (SELECT jsonb_agg(k.conrelid::regclass::text || ':' || k.confdeltype::text) FROM pg_constraint k
      WHERE k.contype = 'f' AND k.confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass) AND k.confdeltype IN ('a','r'))
) AS report;

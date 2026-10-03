-- Live Scores round 2: the owner's account(s) for the editor grant, and the sync's logged logo failures.
-- gh workflow run supabase-readonly -f file=supabase/probe_live_scores_round2.sql --ref feat/live-scores
SELECT
  (SELECT json_agg(json_build_object('id', u.id, 'email', u.email, 'anon', u.is_anonymous,
          'role', p.role, 'display_name', p.display_name, 'created', u.created_at) ORDER BY u.created_at)
     FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
    WHERE lower(u.email) LIKE 'berke%' OR lower(u.email) LIKE '%ustun%')                       AS owner_accounts,
  (SELECT json_agg(x) FROM (
     SELECT r.created, r.status_code, substring(r.content from 1 for 1500) AS body
       FROM net._http_response r
      WHERE r.content LIKE '%logo%'
      ORDER BY r.created DESC LIMIT 3) x)                                                       AS logo_logs,
  (SELECT json_agg(json_build_object('ext', external_id, 'name', name, 'src', source_logo_url))
     FROM public.teams WHERE logo_url IS NULL AND source_logo_url IS NOT NULL)                AS logo_pending,
  (SELECT count(*) FROM public.live_score_editors)                                             AS editors,
  now()                                                                                        AS read_at;

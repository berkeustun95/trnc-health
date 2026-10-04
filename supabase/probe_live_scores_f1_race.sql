-- F1 race check: sessions, the race's stored results, F1 requests and the logged poll responses.
-- gh workflow run supabase-readonly -f file=supabase/probe_live_scores_f1_race.sql --ref feat/live-scores
SELECT
  (SELECT json_agg(json_build_object('id', id, 'api', api_race_id, 'type', session_type, 'at', race_at,
          'status', status, 'final', results_final, 'synced', last_synced_at) ORDER BY race_at)
     FROM public.f1_races WHERE race_at > now() - interval '3 days')                          AS sessions,
  (SELECT json_agg(json_build_object('pos', r.position, 'driver', r.driver_name, 'code', r.driver_code,
          'team', r.team, 'time', r.time_text, 'laps', r.laps, 'grid', r.grid, 'points', r.points,
          'status', r.status_text, 'final', r.is_final, 'updated', r.updated_at) ORDER BY r.position NULLS LAST)
     FROM public.f1_results r JOIN public.f1_races f ON f.id = r.race_id
    WHERE f.session_type = 'race' AND f.race_at > now() - interval '3 days')                  AS results,
  (SELECT json_agg(x ORDER BY x.at) FROM (SELECT at, endpoint, http_status, results, error
     FROM public.api_request_log WHERE sport = 'f1' AND at > now() - interval '30 hours') x)  AS f1_requests,
  (SELECT json_agg(x) FROM (SELECT r.created, r.status_code, substring(r.content from 1 for 2500) AS body
     FROM net._http_response r WHERE r.content LIKE '%"f1%' OR r.content LIKE '%f1:%'
     ORDER BY r.created DESC LIMIT 4) x)                                                       AS f1_logs,
  (SELECT json_agg(json_build_object('day', day, 'sport', sport, 'used', requests_used) ORDER BY day, sport)
     FROM public.api_quota_log WHERE day >= current_date - 1)                                   AS quota,
  now()                                                                                        AS read_at;

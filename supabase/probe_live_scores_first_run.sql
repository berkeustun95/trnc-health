-- What the first Live Scores daily run landed. Read-only.
-- gh workflow run supabase-readonly -f file=supabase/probe_live_scores_first_run.sql --ref feat/live-scores
SELECT
  (SELECT json_agg(x ORDER BY x.sport, x.sort_order) FROM (
     SELECT l.sport, l.sort_order, l.name, count(m.id) AS matches,
            count(m.id) FILTER (WHERE m.status IN ('live','ht')) AS live,
            min(m.kickoff_at) AS first_kickoff, max(m.last_synced_at) AS last_synced
       FROM leagues l LEFT JOIN matches m ON m.league_id = l.id
      GROUP BY l.id) x)                                                                    AS leagues,
  (SELECT json_build_object('teams', count(*), 'logo_copied', count(logo_url),
          'logo_pending', count(*) FILTER (WHERE logo_url IS NULL AND source_logo_url IS NOT NULL),
          'logo_not_ours', count(*) FILTER (WHERE logo_url IS NOT NULL AND logo_url NOT LIKE '%/storage/v1/object/public/team-logos/%'))
     FROM teams)                                                                           AS teams,
  (SELECT json_agg(json_build_object('id', api_race_id, 'name', name, 'type', session_type, 'at', race_at,
          'status', status, 'final', results_final) ORDER BY race_at) FROM f1_races)        AS f1_sessions,
  (SELECT count(*) FROM f1_results)                                                        AS f1_result_rows,
  (SELECT json_agg(json_build_object('sport', sport, 'used', requests_used)) FROM api_quota_log
    WHERE day = (now() AT TIME ZONE 'utc')::date)                                          AS quota_today,
  (SELECT json_agg(json_build_object('sport', sport, 'next', next_poll_at, 'last_run', last_run_at,
          'daily', last_daily_on, 'error', last_error)) FROM live_sync_state)               AS sync_state,
  (SELECT json_agg(r ORDER BY r.at) FROM (SELECT at, sport, endpoint, http_status, results, error
     FROM api_request_log ORDER BY at DESC LIMIT 15) r)                                     AS requests,
  (SELECT count(*) FROM storage.objects WHERE bucket_id = 'team-logos')                    AS bucket_objects,
  now()                                                                                    AS read_at;

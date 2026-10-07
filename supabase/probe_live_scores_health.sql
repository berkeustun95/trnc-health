-- Live Scores health since go-live (2026-10-04). Read-only.
SELECT
  -- 1. Cron: per job, runs since Oct 4, failures, last run.
  (SELECT json_agg(x ORDER BY x.jobname) FROM (
     SELECT j.jobname, j.schedule, j.active,
            count(d.runid) AS runs, count(d.runid) FILTER (WHERE d.status <> 'succeeded') AS failed,
            max(d.start_time) AS last_run,
            (array_agg(d.return_message ORDER BY d.start_time DESC) FILTER (WHERE d.status <> 'succeeded'))[1] AS last_failure
       FROM cron.job j LEFT JOIN cron.job_run_details d ON d.jobid = j.jobid AND d.start_time >= '2026-10-04'
      WHERE j.jobname LIKE 'live-scores-%' GROUP BY j.jobid) x)                                          AS cron,
  -- 2. Quota per sport per day.
  (SELECT json_agg(json_build_object('day', day, 'sport', sport, 'used', requests_used) ORDER BY day, sport)
     FROM api_quota_log WHERE day >= '2026-10-04')                                                         AS quota,
  -- 3. Italy – Türkiye, and international games past kickoff + 3h by status.
  (SELECT json_agg(json_build_object('h', h.name, 'a', a.name, 'score', m.home_score || '-' || m.away_score,
          'status', m.status, 'at', m.kickoff_at, 'synced', m.last_synced_at))
     FROM matches m JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
    WHERE (h.name = 'Türkiye' OR a.name = 'Türkiye') AND m.kickoff_at >= '2026-10-04')                    AS turkey,
  (SELECT json_object_agg(status, n) FROM (SELECT m.status, count(*) n FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.country = 'World' AND m.kickoff_at >= '2026-10-04' AND m.kickoff_at < now() - interval '3 hours'
     GROUP BY m.status) x)                                                                                 AS intl_past_by_status,
  (SELECT json_agg(json_build_object('h', h.name, 'a', a.name, 'status', m.status, 'at', m.kickoff_at, 'lg', l.name, 'synced', m.last_synced_at))
     FROM matches m JOIN leagues l ON l.id = m.league_id JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
    WHERE m.source = 'api' AND m.status IN ('scheduled','live','ht') AND m.kickoff_at < now() - interval '3 hours'
      AND m.kickoff_at >= '2026-10-04')                                                                    AS stuck_any_sport,
  -- 4. Youth / women still stored.
  (SELECT count(*) FROM matches m JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
    WHERE m.sport = 'football' AND (h.name ~* '(^|[^a-z0-9])(u-?[0-9]{2}|under[- ]?[0-9]{2})($|[^0-9])|women| w$'
                                 OR a.name ~* '(^|[^a-z0-9])(u-?[0-9]{2}|under[- ]?[0-9]{2})($|[^0-9])|women| w$')) AS youth_women,
  -- 5. Logos not copied.
  (SELECT json_agg(json_build_object('sport', sport, 'ext', external_id, 'name', name, 'src', source_logo_url))
     FROM teams WHERE source = 'api' AND logo_url IS NULL)                                                 AS logos_missing,
  -- 6. Basketball by league since Oct 4, last sync; F1 pending.
  (SELECT json_agg(x) FROM (SELECT l.name, count(m.id) n, count(m.id) FILTER (WHERE m.status = 'ft') ft,
          max(m.last_synced_at) last_synced FROM leagues l LEFT JOIN matches m ON m.league_id = l.id AND m.kickoff_at >= '2026-10-04'
     WHERE l.sport = 'basketball' GROUP BY l.id) x)                                                        AS basketball,
  (SELECT json_agg(json_build_object('api', api_race_id, 'type', session_type, 'at', race_at, 'status', status, 'final', results_final))
     FROM f1_races WHERE race_at >= now() - interval '2 days' OR (status IN ('scheduled','live') AND race_at < now()))  AS f1_recent,
  (SELECT count(*) FROM f1_results r JOIN f1_races f ON f.id = r.race_id WHERE f.session_type = 'race' AND r.time_text IS NULL) AS f1_rows_missing_time,
  -- 7. Errors.
  (SELECT json_agg(json_build_object('sport', sport, 'next', next_poll_at, 'last', last_run_at, 'daily', last_daily_on, 'err', last_error)) FROM live_sync_state) AS sync_state,
  (SELECT json_agg(x ORDER BY x.at) FROM (SELECT at, sport, endpoint, http_status, error FROM api_request_log
     WHERE at >= '2026-10-04' AND (error IS NOT NULL OR http_status IS DISTINCT FROM 200)) x)             AS request_errors,
  (SELECT json_agg(x) FROM (SELECT r.created, r.status_code, substring(r.content from 1 for 300) body FROM net._http_response r
     WHERE r.content LIKE '%"ok":false%' OR r.status_code >= 400 OR r.error_msg IS NOT NULL ORDER BY r.created DESC LIMIT 10) x) AS function_failures_recent,
  (SELECT min(created) FROM net._http_response)                                                            AS http_log_since,
  now() AS read_at;

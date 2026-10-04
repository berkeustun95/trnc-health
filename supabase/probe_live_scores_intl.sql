-- Live Scores: what the international backfill landed. Read-only.
SELECT
  (SELECT json_agg(x ORDER BY x.sort_order) FROM (
     SELECT l.sort_order, l.external_id, l.name, l.country,
            count(m.id) FILTER (WHERE m.kickoff_at::date = (now() AT TIME ZONE 'utc')::date)     AS today,
            count(m.id) FILTER (WHERE m.kickoff_at::date = (now() AT TIME ZONE 'utc')::date + 1) AS tomorrow,
            count(m.id) FILTER (WHERE m.status IN ('live','ht'))                                  AS live_now
       FROM leagues l LEFT JOIN matches m ON m.league_id = l.id
      WHERE l.sport = 'football' GROUP BY l.id HAVING count(m.id) > 0) x)                      AS by_league,
  (SELECT json_agg(DISTINCT t.name) FROM teams t WHERE t.sport = 'football' AND t.name ILIKE 't%rk%')  AS turkey_names,
  (SELECT json_agg(json_build_object('h', h.name, 'a', a.name, 'at', m.kickoff_at, 'lg', l.name))
     FROM matches m JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
     JOIN leagues l ON l.id = m.league_id
    WHERE l.country = 'World' AND (h.name ILIKE 't%rk%' OR a.name ILIKE 't%rk%'))                 AS turkey_games,
  (SELECT json_agg(json_build_object('sport', sport, 'used', requests_used)) FROM api_quota_log
    WHERE day = (now() AT TIME ZONE 'utc')::date)                                                  AS quota_today,
  (SELECT json_agg(json_build_object('next', next_poll_at, 'err', last_error)) FROM live_sync_state WHERE sport = 'football') AS fb_state,
  now() AS read_at;

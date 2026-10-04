-- Football sync state + its last two logged responses. Read-only.
SELECT (SELECT json_agg(json_build_object('next', next_poll_at, 'last', last_run_at, 'err', last_error)) FROM live_sync_state WHERE sport = 'football') AS state,
       (SELECT json_agg(x) FROM (SELECT r.created, r.status_code, substring(r.content from 1 for 1500) body FROM net._http_response r
          WHERE r.content LIKE '%football%' ORDER BY r.created DESC LIMIT 2) x) AS logs, now() AS read_at;

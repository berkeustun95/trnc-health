-- Push tokens in saved pg_net responses (read-only). send-duty-notification returned Expo's per-message error text
-- in its HTTP body, and for DeviceNotRegistered that text embeds the push token; since 20261139 (60 s timeout) those
-- bodies are kept in net._http_response (~6 h, pg_net TTL). This counts rows that contain a token so a purge can be sized.
--
-- READ-ONLY: one SELECT. THE RUN LOG IS PUBLIC: `content` is never selected, only tested with LIKE; no token,
-- no substring of it, no row id is printed. Counts and timestamps only.
select json_build_object(
  'now_utc', to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  'responses_total', (select count(*) from net._http_response),
  'oldest_utc', (select to_char(min(created) at time zone 'utc', 'YYYY-MM-DD HH24:MI') from net._http_response),
  'newest_utc', (select to_char(max(created) at time zone 'utc', 'YYYY-MM-DD HH24:MI') from net._http_response),
  'with_push_token', (select count(*) from net._http_response
                       where content like '%ExponentPushToken[%' or content like '%ExpoPushToken[%'),
  'with_push_token_by_hour', (select coalesce(json_agg(json_build_object('hour_utc', h, 'n', n) order by h), '[]'::json)
                               from (select to_char(date_trunc('hour', created at time zone 'utc'), 'MM-DD HH24:00') h, count(*) n
                                       from net._http_response
                                      where content like '%ExponentPushToken[%' or content like '%ExpoPushToken[%'
                                      group by 1) t),
  'with_pushErrors_key', (select count(*) from net._http_response where content like '%"pushErrors"%')
) as push_token_responses;

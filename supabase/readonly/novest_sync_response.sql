-- sync-novest HTTP responses since the prune (read-only). SEPARATE from novest_prune_check.sql on purpose:
-- net._http_response has never been read by supabase_read_only_user, so a permission error here (42501)
-- must not take the prune readback down with it.
--
-- READ-ONLY: one SELECT. THE RUN LOG IS PUBLIC: the response `content` is never selected, only tested with LIKE.
-- net._http_response has NO job column, so a row cannot be attributed to a job: these are ALL pg_net responses
-- created after the cutoff (other cron jobs that call pg_net appear too). Rows are pruned by pg_net after ~6 h.
select json_build_object(
  'since_utc', '2026-10-26 11:10',
  'responses', (select count(*) from net._http_response where created > timestamptz '2026-10-26 11:10+00'),
  'rows', (select coalesce(json_agg(json_build_object(
              'created_utc', to_char(r.created at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
              'status_code', r.status_code,
              'timed_out', r.timed_out,
              'has_error_msg', r.error_msg is not null,
              'content_flagged', r.content like '%"flagged":%',
              'content_skipped', r.content like '%"skipped":%') order by r.created), '[]'::json)
             from (select * from net._http_response where created > timestamptz '2026-10-26 11:10+00'
                    order by created limit 100) r)
) as novest_sync_response;

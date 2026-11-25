-- #601 after the null_dead_links run 45636832358 (read-only, ONE SELECT). Event rows are public partner
-- data; no user columns (no paused_by / created_by), no counts.
select json_build_object(
  'now_utc', to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI'),
  'the_two_rows', (select coalesce(json_agg(x order by x.external_id), '[]'::json) from (
      select external_id, title, status, ticket_url, start_date, end_date, updated_at
      from public.events where source = 'gisekibris'
        and external_id in ('gk-pDmi0DU8DCtnE52Miav1', 'gk-Xz2PcM8zcsO4M9GmZFCb')) x),
  'gk_rows_touched_today', (select coalesce(json_agg(x order by x.updated_at), '[]'::json) from (
      select external_id, status, ticket_url is null as no_link, updated_at
      from public.events where source = 'gisekibris'
        and updated_at >= timestamptz '2026-11-25 00:00+00') x),
  'gk_upcoming_approved_without_link', (select coalesce(json_agg(x order by x.start_date), '[]'::json) from (
      select external_id, title, start_date, updated_at
      from public.events where source = 'gisekibris' and status = 'approved'
        and start_date >= now() and ticket_url is null) x),
  'gisekibris_feed_switch', (select json_agg(json_build_object('key', key, 'paused', paused, 'paused_at', paused_at))
      from public.data_jobs where key = 'gisekibris-feed')
) as gk601_dead_links;

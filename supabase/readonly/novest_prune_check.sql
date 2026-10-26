-- Novest image prune readback (read-only): row totals, per-listing photo counts, the novest-22047 case,
-- storage objects under its prefix, and the sync-novest cron runs since the prune. Runs via
-- scripts/supabase-readonly.mjs as supabase_read_only_user.
--
-- READ-ONLY: one SELECT. THE RUN LOG IS PUBLIC: only ids, counts, booleans and storage paths are printed
-- (paths are partner/novest/<external_id>/<media id>.<ext>; no description, title, url host or contact data).
-- Expect after the prune: image_rows_total 991 (995 before), novest-22047 photo count 14, no removed object left.
-- storage.objects is read with this role; if it is not granted the whole statement fails with 42501 and
-- the property_images part can be read from novest_state.sql (photos block) instead.
-- The net._http_response part is in novest_sync_response.sql so a permission error there cannot kill this.
with
nov as (select p.id, p.external_id, p.status from public.properties p where p.source = 'novest'),
img as (
  select i.id, i.property_id, n.external_id, i.url, i.sort_order, i.is_primary
    from public.property_images i join nov n on n.id = i.property_id
),
act_counts as (
  select n.external_id, count(i.id) as c
    from nov n left join img i on i.property_id = n.id
   where n.status = 'active' and n.external_id is not null
   group by n.id, n.external_id
),
t as (select id from nov where external_id = 'novest-22047'),
t_img as (select * from img where external_id = 'novest-22047'),
objs as (
  select o.name from storage.objects o
   where o.bucket_id = 'property-images' and o.name like 'partner/novest/novest-22047/%'
),
removed(media_id) as (values ('22050'), ('22134'), ('22051'), ('22052')),
jobs as (
  select j.jobid, j.jobname from cron.job j
   where j.jobname like 'sync-novest%' or j.command ilike '%functions/v1/sync-novest%'
),
runs as (
  select j.jobname, d.status, d.start_time
    from cron.job_run_details d join jobs j on j.jobid = d.jobid
   where d.start_time > timestamptz '2026-10-26 11:10+00'
)
select json_build_object(
  'image_rows_total', (select count(*) from img),
  'active_listings', (select count(*) from act_counts),
  'photos_per_active_listing', (select coalesce(json_object_agg(external_id, c order by external_id), '{}'::json) from act_counts),
  'novest_22047', json_build_object(
    'listing_found', exists (select 1 from t),
    'photo_count', (select count(*) from t_img),
    'primary_rows', (select count(*) from t_img where is_primary),
    'primary_media_id', (select substring(url from '/(\d{4,})\.[A-Za-z0-9]+$') from t_img where is_primary limit 1),
    'sort_orders', (select coalesce(json_agg(sort_order order by sort_order, id), '[]'::json) from t_img),
    'media_ids', (select coalesce(json_agg(substring(url from '/(\d{4,})\.[A-Za-z0-9]+$') order by sort_order, id), '[]'::json) from t_img)),
  'storage_22047', json_build_object(
    'object_count', (select count(*) from objs),
    'removed_still_in_prefix', (select coalesce(json_agg(o.name order by o.name), '[]'::json)
                                  from objs o join removed r on o.name ~ ('/' || r.media_id || '\.[A-Za-z0-9]+$')),
    'any_removed_still_exists', exists (select 1 from objs o join removed r on o.name ~ ('/' || r.media_id || '\.[A-Za-z0-9]+$')),
    'removed_media_ids_anywhere_under_partner_novest',
        (select count(*) from storage.objects o join removed r on o.name ~ ('^partner/novest/.*/' || r.media_id || '\.[A-Za-z0-9]+$')
          where o.bucket_id = 'property-images'),
    'orphans_in_prefix', (select count(*) from objs o
                           where not exists (select 1 from t_img i where right(i.url, length(o.name)) = o.name)),
    'rows_without_object', (select count(*) from t_img i
                             where not exists (select 1 from objs o where right(i.url, length(o.name)) = o.name))),
  'orphans_all_novest_objects', (select count(*) from storage.objects o
                                  where o.bucket_id = 'property-images' and o.name like 'partner/novest/novest-%/%'
                                    and not exists (select 1 from img i where right(i.url, length(o.name)) = o.name)),
  'sync_novest_cron_since_1110_utc', (select coalesce(json_agg(json_build_object('job', jobname, 'status', status,
        'start_utc', to_char(start_time at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')) order by start_time), '[]'::json) from runs)
) as novest_prune_check;

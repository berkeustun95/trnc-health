-- House banner counters (20261227): today's ad_house_daily rows (Asia/Famagusta day), for the device check.
-- Prints only slot, day and the anonymous view/tap counters (no user column exists), plus two positive controls.
--   table_visible true    = this role can see rows of the table at all; an empty list then means no count yet.
--   role_bypasses_rls true = the role is not subject to RLS (so table_visible false would mean an empty table).
--   gh workflow run supabase-readonly -f file=supabase/probe_ad_house_daily.sql
select json_build_object(
  'famagusta_today', (now() at time zone 'Asia/Famagusta')::date,
  'table_visible', exists(select 1 from public.ad_house_daily),
  'role_bypasses_rls', (select rolbypassrls from pg_roles where rolname = current_user),
  'today', (select coalesce(json_agg(row_to_json(r) order by r.position, r.module), '[]'::json) from (
      select day, position, module, view_count, tap_count
        from public.ad_house_daily
       where day = (now() at time zone 'Asia/Famagusta')::date) r)
) as ad_house_daily_today;

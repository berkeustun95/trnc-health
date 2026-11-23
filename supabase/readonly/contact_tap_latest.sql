-- Newest tap per device-check module (Veles 'news' + Hotels 'maps'): did each counter work end to end?
-- Prints module, action, lang, region and created_at of the single newest row per pair, plus two positive controls.
-- No id, no entity_id, no count.
--   table_visible true  = this role can see rows of the table at all; a null row then means no tap yet.
--   role_bypasses_rls true = the role is not subject to RLS (so table_visible false would mean an empty table).
--   gh workflow run supabase-readonly -f file=supabase/readonly/contact_tap_latest.sql
select json_build_object(
  'table_visible', exists(select 1 from public.contact_events),
  'role_bypasses_rls', (select rolbypassrls from pg_roles where rolname = current_user),
  'latest_news_tap', (select row_to_json(r) from (
      select module, action, lang, region, created_at
        from public.contact_events
       where module = 'news'
       order by created_at desc
       limit 1) r),
  'latest_hotels_maps_tap', (select row_to_json(r) from (
      select module, action, lang, region, created_at
        from public.contact_events
       where module = 'hotels' and action = 'maps'
       order by created_at desc
       limit 1) r)
) as contact_tap_latest;

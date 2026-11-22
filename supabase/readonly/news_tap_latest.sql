-- Newest Veles Bit Postası banner tap (contact_events module 'news'): did the counter work end to end?
-- Prints module, action, lang and created_at of the single newest 'news' row, plus two positive controls.
-- No id, no entity_id, no count.
-- contact_events SELECT is admin-only for CLIENT roles (ce_select_admin); this probe's role may or may not be
-- subject to that RLS, so read the controls first:
--   table_visible true  = this role can see rows of the table at all; a null latest_news_tap then means no tap yet.
--   table_visible false = the table is empty OR this role is blocked by RLS; a null latest_news_tap proves nothing.
--   role_bypasses_rls true = the role is not subject to RLS (so table_visible false would mean an empty table).
--   gh workflow run supabase-readonly -f file=supabase/readonly/news_tap_latest.sql
select json_build_object(
  'table_visible', exists(select 1 from public.contact_events),
  'role_bypasses_rls', (select rolbypassrls from pg_roles where rolname = current_user),
  'latest_news_tap', (select row_to_json(r) from (
      select module, action, lang, created_at
        from public.contact_events
       where module = 'news'
       order by created_at desc
       limit 1) r)
) as news_tap_latest;

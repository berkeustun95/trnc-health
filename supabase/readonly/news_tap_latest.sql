-- Newest Veles Bit Postası banner tap (contact_events module 'news'): did the counter work end to end?
-- Prints ONLY module, action, lang and created_at of the single newest row. No id, no entity_id, no count.
-- An empty result means no news tap has landed yet (null, not a failure of the read).
--   gh workflow run supabase-readonly -f file=supabase/readonly/news_tap_latest.sql
select json_build_object(
  'latest_news_tap', (select row_to_json(r) from (
      select module, action, lang, created_at
        from public.contact_events
       where module = 'news'
       order by created_at desc
       limit 1) r)
) as news_tap_latest;

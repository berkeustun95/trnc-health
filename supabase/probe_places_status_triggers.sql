-- Beaches go-live pre-flight (read-only, catalogs + public place content only; no user rows, no user totals).
-- What runs when places.status goes 'staged' -> 'active': every trigger on public.places with its function body,
-- rules, publications, event triggers, and the public functions whose body reads places.status.
-- Plus the state the two go-live migrations compare against: beach rows per status, staged non-beach rows,
-- and the 4 live beaches' current name_i18n / description_i18n.
select json_build_object(
  'triggers', (select json_agg(json_build_object('name', t.tgname, 'enabled', t.tgenabled::text, 'def', pg_get_triggerdef(t.oid)) order by t.tgname)
                 from pg_trigger t where t.tgrelid = 'public.places'::regclass and not t.tgisinternal),
  'trigger_functions', (select json_object_agg(x.fn, x.def) from (
                 select distinct p.oid::regprocedure::text as fn, pg_get_functiondef(p.oid) as def
                   from pg_trigger t join pg_proc p on p.oid = t.tgfoid
                  where t.tgrelid = 'public.places'::regclass and not t.tgisinternal) x),
  'rules', (select json_agg(rulename) from pg_rules where schemaname = 'public' and tablename = 'places'),
  'publications', (select json_agg(pubname) from pg_publication_tables where schemaname = 'public' and tablename = 'places'),
  'event_triggers', (select json_agg(evtname || ' ' || evtevent || ' ' || evtenabled::text) from pg_event_trigger),
  'functions_reading_places_status', (select json_agg(n.nspname || '.' || p.proname || ' definer=' || p.prosecdef order by p.proname)
                 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.prosrc ~* '\mplaces\M' and p.prosrc ~* '\mstatus\M'),
  'beach_by_status', (select json_object_agg(coalesce(status, '(null)'), n) from (
                 select status, count(*) n from public.places where category = 'beach' group by status) s),
  'beach_by_source_status', (select json_object_agg(k, n) from (
                 select coalesce(source, '(null)') || '/' || coalesce(status, '(null)') k, count(*) n
                   from public.places where category = 'beach' group by 1) s),
  'staged_non_beach', (select count(*) from public.places where status = 'staged' and category is distinct from 'beach'),
  'beach_with_official_visit', (select count(*) from public.places where category = 'beach' and official_visit is not null),
  'live4', (select json_agg(json_build_object('id', id, 'status', status, 'category', category, 'source', source,
                 'source_id', source_id, 'name', name, 'name_i18n', name_i18n, 'description_i18n', description_i18n) order by id)
              from public.places where id in ('fa39492b-57e6-4ebd-b22c-89a9cf20ffe2', '4a29cce8-8c3a-4541-8a07-fc7ceda6a4ff',
                                              'b52cdf3a-ce3f-4e6f-88b8-57afb95f2e67', '95b6d924-e3c0-40e4-a2bd-b55ca1a105ef'))
) as places_status_preflight;

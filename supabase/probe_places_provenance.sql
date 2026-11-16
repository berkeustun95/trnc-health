-- Places provenance columns: catalog + content-shape read, ahead of a guard migration.
-- READ-ONLY: one SELECT (with CTEs). Results are sealed. Reads the catalogs (function definitions, triggers,
-- constraints, columns, privileges, RLS policies) for public.places and the helper functions it uses, plus
-- COUNTS over public.places content rows for source, source_id, photo_attribution, photo_credits and photos.
-- Deliberately prints NO ids, NO names, NO submitted_by / provider_id values, NO e-mails, NO URLs, NO credit
-- strings and NO user totals. Where a value is grouped it is printed only if it matches a short fixed pattern
-- (inner key names, source, license); anything else is bucketed as '(other)'. Counts are of content rows, not users.
-- Every jsonb_each is fed through a jsonb_typeof guard, so a scalar, array or null cannot raise.
with b as (
  select row_number() over () as rn, p.status, p.source, p.submitted_by, p.provider_id,
         p.photo_attribution, p.photo_credits, p.photos
    from public.places p
), ent as (
  select b.rn, e.key as ekey, e.value as evalue, b.photos
    from b
    cross join lateral jsonb_each(case when jsonb_typeof(b.photo_attribution) = 'object'
                                       then b.photo_attribution else '{}'::jsonb end) e
), inn as (
  select ent.rn,
         case when i.key ~ '^[a-z_]{1,30}$' then i.key else '(other)' end as k,
         i.value as v
    from ent
    cross join lateral jsonb_each(case when jsonb_typeof(ent.evalue) = 'object'
                                       then ent.evalue else '{}'::jsonb end) i
), cred as (
  select b.rn, c.el
    from b
    cross join lateral unnest(coalesce(b.photo_credits, '{}'::text[])) as c(el)
)
select json_build_object(
  'functions', (select json_object_agg(n.name, coalesce((
        select json_agg(json_build_object('identity_args', pg_get_function_identity_arguments(f.oid),
               'def', pg_get_functiondef(f.oid), 'prosecdef', f.prosecdef, 'proconfig', f.proconfig)
               order by pg_get_function_identity_arguments(f.oid))
          from pg_proc f join pg_namespace ns on ns.oid = f.pronamespace
         where ns.nspname = 'public' and f.proname = n.name), '[]'::json) order by n.name)
      from (values ('places_guard_source'), ('places_guard_insert'), ('places_guard_update'),
                   ('places_guard_official_visit'), ('guard_moderation_columns'), ('check_place_content'),
                   ('resubmit_place'), ('is_admin'), ('is_anonymous_session')) n(name)),
  'triggers', (select coalesce(json_agg(json_build_object('tgname', t.tgname, 'def', pg_get_triggerdef(t.oid),
        'tgenabled', t.tgenabled,
        'timing', case when t.tgtype & 64 <> 0 then 'INSTEAD OF' when t.tgtype & 2 <> 0 then 'BEFORE' else 'AFTER' end,
        'level', case when t.tgtype & 1 <> 0 then 'ROW' else 'STATEMENT' end,
        'events', array_to_string(array_remove(array[
            case when t.tgtype & 4  <> 0 then 'INSERT' end, case when t.tgtype & 8  <> 0 then 'DELETE' end,
            case when t.tgtype & 16 <> 0 then 'UPDATE' end, case when t.tgtype & 32 <> 0 then 'TRUNCATE' end], null), ',')
        ) order by t.tgname), '[]'::json)
      from pg_trigger t where t.tgrelid = 'public.places'::regclass and not t.tgisinternal),
  'constraints', (select coalesce(json_agg(json_build_object('conname', k.conname, 'contype', k.contype,
        'def', pg_get_constraintdef(k.oid)) order by k.conname), '[]'::json)
      from pg_constraint k where k.conrelid = 'public.places'::regclass),
  'columns', (select coalesce(json_agg(json_build_object('column', c.column_name, 'data_type', c.data_type,
        'udt_name', c.udt_name, 'is_nullable', c.is_nullable, 'column_default', c.column_default,
        'anon_select', has_column_privilege('anon', 'public.places', c.column_name, 'SELECT'),
        'anon_insert', has_column_privilege('anon', 'public.places', c.column_name, 'INSERT'),
        'anon_update', has_column_privilege('anon', 'public.places', c.column_name, 'UPDATE'),
        'authenticated_select', has_column_privilege('authenticated', 'public.places', c.column_name, 'SELECT'),
        'authenticated_insert', has_column_privilege('authenticated', 'public.places', c.column_name, 'INSERT'),
        'authenticated_update', has_column_privilege('authenticated', 'public.places', c.column_name, 'UPDATE')
        ) order by c.column_name), '[]'::json)
      from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'places'
        and c.column_name in ('photo_attribution', 'photo_credits', 'photos', 'cover_image_url', 'source', 'source_id')),
  'column_privileges', (select coalesce(json_agg(x order by x.column_name, x.grantee, x.privilege_type), '[]'::json)
      from (select cp.column_name, cp.grantee, cp.privilege_type from information_schema.column_privileges cp
             where cp.table_schema = 'public' and cp.table_name = 'places'
               and cp.column_name in ('photo_attribution', 'photo_credits', 'photos', 'cover_image_url', 'source', 'source_id')) x),
  'table_privileges', (select json_object_agg(r.role, json_build_object(
        'select', has_table_privilege(r.role, 'public.places', 'SELECT'),
        'insert', has_table_privilege(r.role, 'public.places', 'INSERT'),
        'update', has_table_privilege(r.role, 'public.places', 'UPDATE'),
        'delete', has_table_privilege(r.role, 'public.places', 'DELETE')))
      from (values ('anon'), ('authenticated')) r(role)),
  'policies', (select coalesce(json_agg(json_build_object('policyname', pol.policyname, 'cmd', pol.cmd,
        'permissive', pol.permissive, 'roles', pol.roles::text, 'qual', pol.qual, 'with_check', pol.with_check)
        order by pol.policyname), '[]'::json)
      from pg_policies pol where pol.schemaname = 'public' and pol.tablename = 'places'),
  'attribution_shape', json_build_object(
    'by_group', (select coalesce(json_agg(x order by x.status, x.source, x.has_submitter, x.has_owner), '[]'::json) from (
        select b.status, coalesce(b.source, '(none)') as source,
               (b.submitted_by is not null) as has_submitter, (b.provider_id is not null) as has_owner,
               count(*) as n,
               count(*) filter (where b.photo_attribution is not null) as with_attribution,
               count(*) filter (where coalesce(array_length(b.photo_credits, 1), 0) > 0
                                  and exists (select 1 from unnest(b.photo_credits) u where coalesce(u, '') <> '')) as with_credits,
               count(*) filter (where coalesce(array_length(b.photos, 1), 0) > 0) as with_photos
          from b group by 1, 2, 3, 4) x),
    'attribution_top_type', (select coalesce(json_agg(x order by x.t), '[]'::json) from (
        select jsonb_typeof(b.photo_attribution) as t, count(*) as n from b
         where b.photo_attribution is not null group by 1) x),
    'entry_value_type', (select coalesce(json_agg(x order by x.t), '[]'::json) from (
        select jsonb_typeof(ent.evalue) as t, count(*) as n from ent group by 1) x),
    'inner_keys', (select coalesce(json_agg(x order by x.k), '[]'::json) from (
        select inn.k, count(*) as n from inn group by 1) x),
    'inner_key_value_type', (select coalesce(json_agg(x order by x.k, x.t), '[]'::json) from (
        select inn.k, jsonb_typeof(inn.v) as t, count(*) as n from inn group by 1, 2) x),
    'url_scheme_class', (select coalesce(json_agg(x order by x.k, x.scheme), '[]'::json) from (
        select inn.k,
               case when jsonb_typeof(inn.v) <> 'string' then '(non-string)'
                    when (inn.v #>> '{}') ~* '^https://' then 'https'
                    when (inn.v #>> '{}') ~* '^http://' then 'http'
                    else 'other' end as scheme,
               count(*) as n
          from inn where inn.k in ('license_url', 'source_url') group by 1, 2) x),
    'source_values', (select coalesce(json_agg(x order by x.v), '[]'::json) from (
        select case when jsonb_typeof(inn.v) <> 'string' then '(non-string)'
                    when (inn.v #>> '{}') ~ '^[a-z_]{1,20}$' then inn.v #>> '{}'
                    else '(other)' end as v, count(*) as n
          from inn where inn.k = 'source' group by 1) x),
    'license_values', (select coalesce(json_agg(x order by x.v), '[]'::json) from (
        select case when jsonb_typeof(inn.v) <> 'string' then '(non-string)'
                    when (inn.v #>> '{}') ~ '^[A-Za-z0-9 .\-]{1,30}$' then inn.v #>> '{}'
                    else '(other)' end as v, count(*) as n
          from inn where inn.k = 'license' group by 1) x),
    'rows_keys_vs_photos', (select coalesce(json_agg(x order by x.result), '[]'::json) from (
        select y.result, count(*) as n from (
          select case when count(ent.ekey) = 0 then 'empty_object'
                      when bool_and(ent.ekey = any(coalesce(ent.photos, '{}'::text[]))) then 'all_keys_match_photos'
                      else 'some_key_not_in_photos' end as result
            from b left join ent on ent.rn = b.rn
           where jsonb_typeof(b.photo_attribution) = 'object' group by b.rn) y
         group by y.result) x),
    'entries_key_not_https', (select count(*) from ent where ent.ekey !~ '^https://'),
    'credits_length_vs_photos', (select coalesce(json_agg(x order by x.relation), '[]'::json) from (
        select case when coalesce(array_length(b.photo_credits, 1), 0) = coalesce(array_length(b.photos, 1), 0) then 'equal'
                    when coalesce(array_length(b.photo_credits, 1), 0) < coalesce(array_length(b.photos, 1), 0) then 'shorter'
                    else 'longer' end as relation, count(*) as n
          from b group by 1) x),
    'credit_elements_pattern', (select coalesce(json_agg(x order by x.shape), '[]'::json) from (
        select case when cred.el is null then 'null'
                    when cred.el ~ '^Photo: .* / .*' then 'matches' else 'does_not_match' end as shape, count(*) as n
          from cred group by 1) x),
    'content_rows_with_submitter_and_provenance', (select json_build_object(
        'total', count(*),
        'active', count(*) filter (where b.status = 'active'),
        'pending', count(*) filter (where b.status = 'pending'),
        'rejected', count(*) filter (where b.status = 'rejected'))
      from b where b.submitted_by is not null
               and (b.photo_attribution is not null or coalesce(array_length(b.photo_credits, 1), 0) > 0))
  )
) as places_provenance;

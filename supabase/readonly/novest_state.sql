-- Novest listing state (read-only): status / visibility / photos, a contact-leak scan across EVERY
-- text-like column of public.properties, description cut-offs, the sync-novest cron shape, and
-- migration 20261106. Runs via scripts/supabase-readonly.mjs as supabase_read_only_user (bypasses RLS).
--
-- READ-ONLY: one SELECT, no writes. THE RUN LOG IS PUBLIC: no full phone, e-mail, name, link or
-- cron `command` text is ever selected. Phone / e-mail / whatsapp / marker hits are masked as
-- left(hit,3) || '…' || length(hit); e-mail and agent-name hits print only '…' || length(hit) (no letters).
-- cron command is only tested with LIKE and never returned. net._http_response is NOT read (it has no
-- job column, so it could misattribute a response, and a permission error would abort the report).
--
-- Scan: every column of public.properties with data_type text / character varying / jsonb / ARRAY
-- (derived from information_schema, printed as scanned_columns), over ALL source='novest' rows
-- (any status: a stored leak is a leak whatever the status). jsonb / array values are scanned as
-- text. Columns NOT scanned are listed in scan_exclusions with a reason.
-- Regexes are Postgres AREs, equivalent character-for-character to supabase/functions/_shared/novest-feed.mjs
-- (PHONE_RE, CONTACT_MARKER). The Turkish İ is spelled out in the marker alternation; ~* is not used for it.
-- Unicode spaces (U+00A0, U+2000-U+200B, U+202F, U+205F, U+3000, U+FEFF) are normalised to ' ' before
-- matching: JS \s matches them, a Postgres ARE \s may not.
-- Positive control: one synthetic segment PER KIND goes through the SAME cells/kinds/hits path;
-- control_flagged says whether each kind is flagged by its OWN segment and must be all true, otherwise
-- THIS FILE is wrong (a clean hits_by_kind then means nothing).
--
-- visible_to_users: live policy props_hide_photoless_novest (20261068) is RESTRICTIVE SELECT with
--   USING (source IS DISTINCT FROM 'novest' OR public.is_admin() OR private.property_has_photo(id)).
-- For an app user (not admin) and a novest row that is "has a public.property_images row". The function is
-- NOT called here (supabase_read_only_user has no EXECUTE on it, 42501): its body is inlined as an EXISTS.
-- The live policy text is printed as policy_qual so the report quotes the catalog, not this comment.
with
cols as (
  select c.column_name::text as column_name
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'properties'
     and c.data_type in ('text', 'character varying', 'jsonb', 'ARRAY')
),
excl(column_name, reason) as (values
  ('external_id',  'row key, printed in every hit; not content'),
  ('source',       'constant partner tag (novest)'),
  ('status',       'enum-like status column'),
  ('content_hash', 'hex digest; digit runs would be false phone hits')
),
scanned as (select column_name from cols where column_name not in (select column_name from excl)),
nov as (
  select p.id, p.external_id, p.status, p.description, to_jsonb(p) as j
    from public.properties p where p.source = 'novest'
),
ctl(kind, txt) as (values
  ('phone',    E'Ara 0533\u00a0123\u00a045\u00a067'),
  ('email',    'x@example.com'),
  ('whatsapp', 'wa.me'),
  ('marker',   'İletişim'),
  ('agent_name', 'Ahmet Ulutekin'),
  ('agent_name_heuristic', 'Deneme Kişi : ')
),
rows_in as (
  select external_id, j, null::text as ctl from nov
  union all
  select 'CONTROL', jsonb_build_object('description', txt), kind from ctl
),
cells as (
  select r.external_id, r.ctl, e.key as col,
         regexp_replace(case when jsonb_typeof(e.value) = 'string' then e.value #>> '{}' else e.value::text end,
                        E'[\u00a0\u2000-\u200b\u202f\u205f\u3000\ufeff]', ' ', 'g') as val
    from rows_in r, lateral jsonb_each(r.j) e
   where e.key in (select column_name from scanned) and jsonb_typeof(e.value) <> 'null'
),
kinds(kind, re, flags) as (values
  ('phone',    '(?:\+?90[\s.\-]?)?\(?0?\s?(?:5\d{2}|392|533|542|548)\)?[\s.\-]?\d{3}[\s.\-]?\d{2}[\s.\-]?\d{2}', 'g'),
  ('email',    '[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}', 'g'),
  ('whatsapp', 'wa\.me|whatsapp|api\.whatsapp', 'gi'),
  ('marker',   'İletişim|iletişim|İLETİŞİM|Iletisim|Bilgi\s+için|Detaylı\s+bilgi', 'g'),
  ('agent_name', 'Ahmet\s+Ulutekin|[İI]smail\s+Pirgal[ıi]', 'g'),
  ('agent_name_heuristic', '[A-ZÇĞİÖŞÜ][a-zçğıöşü]+\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+\s*:', 'g')
),
hits as (
  select c.external_id, c.ctl, c.col, k.kind, m[1] as hit
    from cells c cross join kinds k
         cross join lateral regexp_matches(c.val, k.re, k.flags) m
),
real_hits as (select * from hits where ctl is null),
act as (select * from nov where status = 'active'),
vis as (select a.id, a.external_id from act a where exists (select 1 from public.property_images i where i.property_id = a.id)),
hid as (select a.external_id from act a where a.id not in (select id from vis)),
desc_act as (
  select external_id, rtrim(description, E' \n\t\r') as d from act where nullif(btrim(description), '') is not null
),
cut as (
  select external_id, d, length(d) as len, right(d, 2) as last2
    from desc_act
   where (regexp_replace(d, '^.*\n', '') !~ '[.!?)…]$' and regexp_replace(d, '^.*\n', '') !~ '^• ')
      or d ~ ':$'
      or d ~ '(?:İletişim|iletişim|İLETİŞİM|Iletisim|Bilgi\s+için|Detaylı\s+bilgi).{0,15}$'
),
photo_counts as (
  select a.external_id, count(i.property_id) as n
    from act a left join public.property_images i on i.property_id = a.id
   group by a.id, a.external_id
),
jobs as (
  select j.jobid, j.jobname, j.schedule, j.active,
         j.command like '%timeout_milliseconds := 60000%' as has_60s_timeout,
         j.command like '%vault.decrypted_secrets%'       as vault_keyed,
         j.command not like '%eyJ%'                       as no_inline_jwt
    from cron.job j
   where j.jobname like 'sync-novest%' or j.command ilike '%functions/v1/sync-novest%'
),
runs as (
  select d.jobid, d.status, d.start_time
    from cron.job_run_details d where d.jobid in (select jobid from jobs)
   order by d.start_time desc limit 6
)
select json_build_object(
  'scanned_columns', (select coalesce(json_agg(column_name order by column_name), '[]'::json) from scanned),
  'scan_exclusions', (select json_agg(json_build_object('column', e.column_name, 'reason', e.reason, 'exists_as_text_like', e.column_name in (select column_name from cols)) order by e.column_name) from excl e),
  'by_status', (select coalesce(json_object_agg(coalesce(status, '(null)'), n), '{}'::json) from (select status, count(*) n from nov group by status) s),
  'novest_total', (select count(*) from nov),
  'active', (select count(*) from act),
  'visible_to_users', (select count(*) from vis),
  'hidden_photoless', (select count(*) from hid),
  'hidden_photoless_external_ids', (select coalesce(json_agg(external_id order by external_id), '[]'::json) from hid),
  'policy_qual', (select coalesce(json_agg(json_build_object('policy', policyname, 'permissive', permissive, 'cmd', cmd, 'qual', qual)), '[]'::json)
                    from pg_policies where schemaname = 'public' and tablename = 'properties' and policyname = 'props_hide_photoless_novest'),
  'hits_by_kind', (select coalesce(json_object_agg(kind, n), '{}'::json) from (select kind, count(*) n from real_hits group by kind) s),
  'listings_with_hits', (select count(distinct external_id) from real_hits),
  'agent_name_heuristic_note', 'agent_name_heuristic = Capitalised Word + Capitalised Word + optional spaces + colon; a HEURISTIC, expect false positives; agent_name = baseline literal list',
  'hits_truncated', (select count(*) from real_hits) > 400,
  'hits', (select coalesce(json_agg(json_build_object('external_id', external_id, 'column', col, 'kind', kind,
              'masked', case when kind in ('agent_name', 'agent_name_heuristic', 'email') then '…' || length(hit)
                                  else left(hit, 3) || '…' || length(hit) end) order by external_id, col, kind), '[]'::json)
             from (select * from real_hits order by external_id, col, kind limit 400) h),
  'control_flagged', (select json_object_agg(k.kind, exists (select 1 from hits h where h.ctl = k.kind and h.kind = k.kind)) from kinds k),
  'cut_off', json_build_object(
    'count', (select count(*) from cut),
    'of_active_with_description', (select count(*) from desc_act),
    'active_null_or_empty_description', (select count(*) from act where nullif(btrim(description), '') is null),
    'listings', (select coalesce(json_agg(json_build_object('external_id', external_id, 'len', len, 'last2', last2) order by external_id), '[]'::json) from cut),
    'len_min', (select min(len) from (select length(d) len from desc_act) x),
    'len_max', (select max(len) from (select length(d) len from desc_act) x),
    'len_median', (select percentile_cont(0.5) within group (order by length(d)) from desc_act)),
  'photos', json_build_object(
    'listings', (select count(*) from photo_counts),
    'min', (select min(n) from photo_counts),
    'max', (select max(n) from photo_counts),
    'zero_photo', (select count(*) from photo_counts where n = 0),
    'zero_photo_external_ids', (select coalesce(json_agg(external_id order by external_id), '[]'::json) from photo_counts where n = 0)),
  'cron', json_build_object(
    'jobs', (select coalesce(json_agg(json_build_object('job', jobname, 'schedule', schedule, 'active', active,
               'has_60s_timeout', has_60s_timeout, 'vault_keyed', vault_keyed, 'no_inline_jwt', no_inline_jwt) order by jobname), '[]'::json) from jobs),
    'last_runs', (select coalesce(json_agg(json_build_object('job', j.jobname, 'status', r.status,
               'start_utc', to_char(r.start_time at time zone 'utc', 'Dy YYYY-MM-DD HH24:MI:SS')) order by r.start_time desc), '[]'::json)
               from runs r join jobs j on j.jobid = r.jobid)),
  'migration_20261106', (select coalesce(json_agg(json_build_object('filename', filename, 'applied_at', to_char(applied_at at time zone 'utc', 'YYYY-MM-DD HH24:MI'))), '[]'::json)
                           from public.schema_migrations_applied where filename like '20261106%')
) as novest_state;

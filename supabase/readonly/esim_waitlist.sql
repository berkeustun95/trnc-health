-- The old eSIM waitlist (esim_waitlist, 20260725), read on Bağlantı & eSIM go day. These people signed up
-- on EsimScreen while CONNECTIVITY_LIVE was false. The table is keyed by user_id, has no `module` column and
-- is unknown to notify_module_waitlist, so nothing notifies them automatically. Counts only: no emails, no ids.
-- The anon key reads 0 whether the table is empty or full (RLS), so this is the only honest count.
--   gh workflow run supabase-readonly -f file=supabase/readonly/esim_waitlist.sql
select json_build_object(
  'total',            (select count(*) from public.esim_waitlist),
  'with_email',       (select count(*) from public.esim_waitlist where email is not null and email <> ''),
  'by_audience',      (select coalesce(json_object_agg(coalesce(audience, '(none)'), n), '{}'::json)
                         from (select audience, count(*) n from public.esim_waitlist group by audience) a),
  'by_provider',      (select coalesce(json_object_agg(coalesce(preferred_provider, '(none)'), n), '{}'::json)
                         from (select preferred_provider, count(*) n from public.esim_waitlist group by preferred_provider) p),
  'first_signup',     (select to_char(min(created_at) at time zone 'Europe/Istanbul', 'YYYY-MM-DD') from public.esim_waitlist),
  'last_signup',      (select to_char(max(created_at) at time zone 'Europe/Istanbul', 'YYYY-MM-DD') from public.esim_waitlist)
) as esim_waitlist;

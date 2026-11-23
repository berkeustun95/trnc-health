-- Onboarding v2 guest gap, second look (read-only probe). Percentages only: no counts, ids or timestamps of individual
-- rows (the repo and its Actions logs are public).
-- Why: probe_onboarding_guest_gap.sql only matched an anonymous user created 0-30 s AFTER the start_choice_guest row.
-- The app sends that event and the sign-in as two separate requests at the same moment, and the edge logs show the
-- sign-in often reaching the server first, so a successful guest start can count as "no account". This probe widens
-- the window to 5 s before the tap and also measures repeat taps.
-- Window as probe_onboarding_guest_gap.sql: 2026-11-16 00:00 Asia/Famagusta up to the start of today.
--   anon_0_30s           taps with an anonymous user created 0-30 s after ÷ taps (the old definition, for comparison)
--   anon_m5_30s          taps with an anonymous user created 5 s before to 30 s after ÷ taps
--   anon_only_before     taps whose only match is in the 5 s before ÷ taps (the request race)
--   repeat_tap_10s       taps with another guest tap (same platform + runtime) in the 10 s before ÷ taps
--   offer_0_2m           taps with an offer_shown 0-2 min after ÷ taps
--   sample               'small (<20)' when the tap denominator is under 20, else 'ok': a flag, not a count
-- Caveat: matching is temporal (no identifier), so two people starting within seconds can match each other's rows.
with w as (
  select timestamptz '2026-11-16 00:00:00+02' as t0,
         (date_trunc('day', now() at time zone 'Asia/Famagusta')) at time zone 'Asia/Famagusta' as t1
), g as (
  select o.platform, o.runtime_version,
         exists (select 1 from auth.users u
                  where u.is_anonymous = true
                    and u.created_at >= o.created_at and u.created_at <= o.created_at + interval '30 seconds') as a_after,
         exists (select 1 from auth.users u
                  where u.is_anonymous = true
                    and u.created_at >= o.created_at - interval '5 seconds' and u.created_at < o.created_at) as a_before,
         exists (select 1 from public.onboarding_events p
                  where p.event = 'start_choice_guest' and p.id is distinct from o.id
                    and p.platform is not distinct from o.platform
                    and p.runtime_version is not distinct from o.runtime_version
                    and p.created_at >= o.created_at - interval '10 seconds' and p.created_at <= o.created_at) as repeat_tap,
         exists (select 1 from public.onboarding_events s
                  where s.event = 'offer_shown'
                    and s.platform is not distinct from o.platform
                    and s.runtime_version is not distinct from o.runtime_version
                    and s.created_at >= o.created_at and s.created_at <= o.created_at + interval '2 minutes') as offer
    from public.onboarding_events o, w
   where o.event = 'start_choice_guest' and o.created_at >= w.t0 and o.created_at < w.t1
)
select case when grouping(platform, runtime_version) = 3 then 'all' else coalesce(platform, 'n/a') end as platform,
       case when grouping(platform, runtime_version) = 3 then 'all' else coalesce(runtime_version, 'n/a') end as runtime_version,
       coalesce(round(100.0 * count(*) filter (where a_after) / nullif(count(*), 0))::int::text || '%', 'n/a') as anon_0_30s,
       coalesce(round(100.0 * count(*) filter (where a_after or a_before) / nullif(count(*), 0))::int::text || '%', 'n/a') as anon_m5_30s,
       coalesce(round(100.0 * count(*) filter (where a_before and not a_after) / nullif(count(*), 0))::int::text || '%', 'n/a') as anon_only_before,
       coalesce(round(100.0 * count(*) filter (where repeat_tap) / nullif(count(*), 0))::int::text || '%', 'n/a') as repeat_tap_10s,
       coalesce(round(100.0 * count(*) filter (where offer) / nullif(count(*), 0))::int::text || '%', 'n/a') as offer_0_2m,
       case when count(*) < 20 then 'small (<20)' else 'ok' end as sample
  from g
 group by grouping sets ((platform, runtime_version), ())
 order by grouping(platform, runtime_version), 1, 2;

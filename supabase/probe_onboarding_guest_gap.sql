-- Onboarding v2 guest gap (read-only probe). Percentages only: no counts, ids or timestamps of individual rows (the
-- repo and its Actions logs are public). Question: per Start guest tap (start_choice_guest), was an anonymous
-- auth.users row (is_anonymous = true) created within 30 s after it, and did offer_shown follow within 2 min (same
-- platform and runtime_version)? Window: 2026-11-16 00:00 Asia/Famagusta (first full day after the launch, as in
-- probe_onboarding_v2_week1.sql) up to the start of today. One row per (platform, runtime_version) plus 'all'.
--   anon_user_within_30s            taps with an anonymous user created 0-30 s after ÷ taps
--   offer_shown_within_2m           taps with an offer_shown 0-2 min after ÷ taps
--   offer_shown_within_2m_given_anon the same, among taps that had an anonymous user within 30 s
--   sample                          'small (<20)' when the tap denominator is under 20, else 'ok' — a flag, not a count
-- Caveats: matching is temporal (no identifier), so one account or offer can match two close taps. Returning phones
-- (already onboarded) never get Screen 2 by design, so offer_shown_within_2m is a LOWER BOUND on first-time reach.
-- auth.users is read directly, as probe_onboarding_v2_week1.sql does (the readonly workflow runs as postgres).
with w as (
  select timestamptz '2026-11-16 00:00:00+02' as t0,
         (date_trunc('day', now() at time zone 'Asia/Famagusta')) at time zone 'Asia/Famagusta' as t1
), g as (
  select o.platform, o.runtime_version, o.created_at,
         exists (select 1 from auth.users u
                  where u.is_anonymous = true
                    and u.created_at >= o.created_at and u.created_at <= o.created_at + interval '30 seconds') as anon,
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
       coalesce(round(100.0 * count(*) filter (where anon) / nullif(count(*), 0))::int::text || '%', 'n/a') as anon_user_within_30s,
       coalesce(round(100.0 * count(*) filter (where offer) / nullif(count(*), 0))::int::text || '%', 'n/a') as offer_shown_within_2m,
       coalesce(round(100.0 * count(*) filter (where offer and anon) / nullif(count(*) filter (where anon), 0))::int::text || '%', 'n/a') as offer_shown_within_2m_given_anon,
       case when count(*) < 20 then 'small (<20)' else 'ok' end as sample
  from g
 group by grouping sets ((platform, runtime_version), ())
 order by grouping(platform, runtime_version), 1, 2;

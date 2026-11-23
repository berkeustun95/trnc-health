-- Onboarding v2 rolling weekly report (read-only). Percentages only: no counts, ids or e-mails (the repo and its
-- Actions logs are public). One row per metric: (metric, value, sample).
-- Window: the 7 complete Asia/Famagusta days before today (today excluded).
--   value   an integer-rounded percentage, or 'n/a' when its denominator is empty
--   sample  'small (<20)' when the denominator is under 20, else 'ok' — a flag, not a count
-- Rows 1-9 are the same definitions as probe_onboarding_v2_week1.sql, over the rolling window:
--   choice_*                     share of the three Start choices (start_choice_signup / _signin / _guest)
--   screen2_tapped_enable        (offer_granted + offer_denied) ÷ resolved
--   screen2_os_allowed           offer_granted ÷ resolved
--   screen2_not_now              offer_later ÷ resolved; resolved = offer_granted + offer_denied + offer_later
--   screen2_left_without_choice  (offer_shown − resolved) ÷ offer_shown
--   reoffer_later_allowed        reoffer_granted ÷ reoffer_shown
--   reoffer_existing_allowed     reoffer_existing_granted ÷ reoffer_existing_shown
-- Row 10, screen2_reach_first_time_guest = offer_shown ÷ start_choice_guest, counted only from first_time_from.
--   The app change that logs start_choice_* on first-time phones only is not yet live; before it, returning phones'
--   guest taps are in the denominator and never reach Screen 2. Rows before first_time_from are excluded from both
--   numerator and denominator. Caveats: offer_shown also counts Screen 2 views reached via sign-up and Giriş yap,
--   so the ratio can exceed 100%; and old app bundles still log returning-phone taps until they update.
--   'not live' while first_time_from is not before today; 'n/a' when the guest-tap denominator is empty.
-- Row 11, first_time_window: 'full' (window starts on/after first_time_from), 'partial' (first_time_from falls inside
--   the window, so row 10 covers only its later days), 'not live' (first_time_from is today or later).
with w as (
  select (date_trunc('day', now() at time zone 'Asia/Famagusta') - interval '7 days') at time zone 'Asia/Famagusta' as t0,
         (date_trunc('day', now() at time zone 'Asia/Famagusta')) at time zone 'Asia/Famagusta'                     as t1,
         -- Set to the first full Famagusta day after the production OTA carrying the first-time-only start_choice logging.
         (date '2099-01-01')::timestamp at time zone 'Asia/Famagusta'                                              as ftf
), e as (
  select o.event, count(*) as n,
         count(*) filter (where o.created_at >= w.ftf) as n_ft
    from public.onboarding_events o, w
   where o.created_at >= w.t0 and o.created_at < w.t1
   group by o.event
), c as (
  select coalesce(sum(n) filter (where event = 'start_choice_signup'), 0)       as ch_signup,
         coalesce(sum(n) filter (where event = 'start_choice_signin'), 0)       as ch_signin,
         coalesce(sum(n) filter (where event = 'start_choice_guest'), 0)        as ch_guest,
         coalesce(sum(n) filter (where event = 'offer_shown'), 0)               as o_shown,
         coalesce(sum(n) filter (where event = 'offer_granted'), 0)             as o_granted,
         coalesce(sum(n) filter (where event = 'offer_denied'), 0)              as o_denied,
         coalesce(sum(n) filter (where event = 'offer_later'), 0)               as o_later,
         coalesce(sum(n) filter (where event = 'reoffer_shown'), 0)             as r_shown,
         coalesce(sum(n) filter (where event = 'reoffer_granted'), 0)           as r_granted,
         coalesce(sum(n) filter (where event = 'reoffer_existing_shown'), 0)    as rx_shown,
         coalesce(sum(n) filter (where event = 'reoffer_existing_granted'), 0)  as rx_granted,
         coalesce(sum(n_ft) filter (where event = 'start_choice_guest'), 0)     as ft_guest,
         coalesce(sum(n_ft) filter (where event = 'offer_shown'), 0)            as ft_shown
    from e
), r(ord, metric, num, den, state) as (
  select 1,  'choice_signup',               ch_signup,                       ch_signup + ch_signin + ch_guest, null from c union all
  select 2,  'choice_signin',               ch_signin,                       ch_signup + ch_signin + ch_guest, null from c union all
  select 3,  'choice_guest',                ch_guest,                        ch_signup + ch_signin + ch_guest, null from c union all
  select 4,  'screen2_tapped_enable',       o_granted + o_denied,            o_granted + o_denied + o_later, null from c union all
  select 5,  'screen2_os_allowed',          o_granted,                       o_granted + o_denied + o_later, null from c union all
  select 6,  'screen2_not_now',             o_later,                         o_granted + o_denied + o_later, null from c union all
  select 7,  'screen2_left_without_choice', o_shown - o_granted - o_denied - o_later, o_shown,                 null from c union all
  select 8,  'reoffer_later_allowed',       r_granted,                       r_shown,                          null from c union all
  select 9,  'reoffer_existing_allowed',    rx_granted,                      rx_shown,                         null from c union all
  select 10, 'screen2_reach_first_time_guest', ft_shown,                     ft_guest,
         case when w.ftf >= w.t1 then 'not live' end from c, w union all
  select 11, 'first_time_window',           null,                            null,
         case when w.ftf >= w.t1 then 'not live' when w.ftf <= w.t0 then 'full' else 'partial' end from w
)
select metric,
       case when state is not null then state
            else coalesce(round(100.0 * num / nullif(den, 0))::int::text || '%', 'n/a') end as value,
       case when state is not null or den is null then 'n/a'
            when den < 20 then 'small (<20)' else 'ok' end                                  as sample
  from r
 order by ord;

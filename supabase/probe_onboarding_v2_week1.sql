-- Onboarding v2 one-week report (read-only; Berke 2026-11-23). Percentages only: no counts, ids or e-mails
-- (the repo and its Actions logs are public). One row per metric: (metric, value, sample).
-- Window: the complete Asia/Famagusta days from 2026-11-16 (first full day after the production launch, OTA
-- 01a1e0c0 at 21:50 on the 15th) up to the start of today. Same days as onboarding_events_weekly.sql run on
-- 2026-11-23, so choice_* must equal its choice_share_7d.
--   value   an integer-rounded percentage, or 'n/a' when its denominator is empty
--   sample  'small (<20)' when the denominator is under 20, else 'ok' — a flag, not a count
-- Rates:
--   choice_*                     share of the three Start choices (start_choice_signup / _signin / _guest)
--   screen2_tapped_enable        "Bildirimleri aç" tapped: (offer_granted + offer_denied) ÷ resolved
--   screen2_os_allowed           offer_granted ÷ resolved (the OS prompt was also allowed)
--   screen2_not_now              offer_later ÷ resolved
--                                resolved = offer_granted + offer_denied + offer_later (one per finished Screen 2)
--   screen2_left_without_choice  (offer_shown − resolved) ÷ offer_shown; offer_shown logs on mount, so remounts
--                                and app kills land here, not in the rates above
--   reoffer_later_allowed        reoffer_granted ÷ reoffer_shown (second offer after "Şimdi değil")
--   reoffer_existing_allowed     reoffer_existing_granted ÷ reoffer_existing_shown (existing users, notifications off)
--   push_token_signed_up         signed-up accounts (auth.users.is_anonymous = false) created in the window whose
--                                profiles row holds a push token — onboarding_push_baseline.sql's definition
--   push_token_signed_up_control the same share for signed-up accounts created in the 30 days before launch
--                                (2026-10-16 to 2026-11-15 Famagusta), read now: the 72% baseline re-read today, so
--                                tokens cleared since 2026-11-14 do not pass for an onboarding effect
--   push_token_guests_lower_bound the same share for guest accounts created in the window; a lower bound (a guest's
--                                token is cleared when its session ends)
with w as (
  select timestamptz '2026-11-16 00:00:00+02' as t0,
         (date_trunc('day', now() at time zone 'Asia/Famagusta')) at time zone 'Asia/Famagusta' as t1,
         timestamptz '2026-10-16 00:00:00+03' as b0
), e as (
  select o.event, count(*) as n
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
         coalesce(sum(n) filter (where event = 'reoffer_existing_granted'), 0)  as rx_granted
    from e
), p as (
  select count(*) filter (where u.created_at >= w.t0 and not u.is_anonymous)                                as su,
         count(*) filter (where u.created_at >= w.t0 and not u.is_anonymous and pr.push_token is not null)  as su_tok,
         count(*) filter (where u.created_at <  w.t0 and not u.is_anonymous)                                as bu,
         count(*) filter (where u.created_at <  w.t0 and not u.is_anonymous and pr.push_token is not null)  as bu_tok,
         count(*) filter (where u.created_at >= w.t0 and u.is_anonymous)                                    as gu,
         count(*) filter (where u.created_at >= w.t0 and u.is_anonymous and pr.push_token is not null)      as gu_tok
    from public.profiles pr
    join auth.users u on u.id = pr.id, w
   where u.created_at >= w.b0 and u.created_at < w.t1
), r(ord, metric, num, den) as (
  select 1,  'choice_signup',                 ch_signup,                       ch_signup + ch_signin + ch_guest from c union all
  select 2,  'choice_signin',                 ch_signin,                       ch_signup + ch_signin + ch_guest from c union all
  select 3,  'choice_guest',                  ch_guest,                        ch_signup + ch_signin + ch_guest from c union all
  select 4,  'screen2_tapped_enable',         o_granted + o_denied,            o_granted + o_denied + o_later   from c union all
  select 5,  'screen2_os_allowed',            o_granted,                       o_granted + o_denied + o_later   from c union all
  select 6,  'screen2_not_now',               o_later,                         o_granted + o_denied + o_later   from c union all
  select 7,  'screen2_left_without_choice',   o_shown - o_granted - o_denied - o_later, o_shown                 from c union all
  select 8,  'reoffer_later_allowed',         r_granted,                       r_shown                          from c union all
  select 9,  'reoffer_existing_allowed',      rx_granted,                      rx_shown                         from c union all
  select 10, 'push_token_signed_up',          su_tok,                          su                               from p union all
  select 11, 'push_token_signed_up_control',  bu_tok,                          bu                               from p union all
  select 12, 'push_token_guests_lower_bound', gu_tok,                          gu                               from p
)
select metric,
       coalesce(round(100.0 * num / nullif(den, 0))::int::text || '%', 'n/a') as value,
       case when den < 20 then 'small (<20)' else 'ok' end                     as sample
  from r
 order by ord;

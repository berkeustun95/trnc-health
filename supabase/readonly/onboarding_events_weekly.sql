-- Onboarding v2 weekly spike check (read-only; Berke 2026-11-15, live-ops checklist item 16).
-- Run weekly:  gh workflow run supabase-readonly -f file=supabase/readonly/onboarding_events_weekly.sql
-- Results are sealed; open with `node scripts/readonly-results.mjs <run-id>` and copy them to the vault only.
-- No counts, ids or e-mails: ratios, a share and a flag only (the repo and its Actions logs are public).
-- Days are TRNC calendar days (Asia/Famagusta). "Last 7" = the 7 complete days before today; "prior" = the 28 complete
-- days before those (the 90-day purge of 20261203 keeps them). One row per event seen in the last 35 days:
--   last7_vs_prior_weeks  last 7 days ÷ the prior 4 weeks' weekly average ('new' when the prior weeks had none)
--   peak_day_vs_week_avg  the busiest of the last 7 days ÷ that week's daily average (7.0x = everything on one day)
--   choice_share_7d       start_choice_* rows only: this choice's share of the three Start choices in the last 7 days
--   flag                  'SPIKE' when either ratio is 3x / 4x or more AND the week has at least 20 rows (below that,
--                         one person tapping twice would trip it); otherwise 'ok'
with today as (
  select (now() at time zone 'Asia/Famagusta')::date as t
), d as (
  select e.event, (e.created_at at time zone 'Asia/Famagusta')::date as day
    from public.onboarding_events e, today
   where (e.created_at at time zone 'Asia/Famagusta')::date between today.t - 35 and today.t - 1
), daily as (
  select event, day, count(*) as n from d group by event, day
), agg as (
  select daily.event,
         coalesce(sum(n) filter (where daily.day >= today.t - 7), 0) as w,
         coalesce(sum(n) filter (where daily.day <  today.t - 7), 0) as p28,
         coalesce(max(n) filter (where daily.day >= today.t - 7), 0) as peak
    from daily, today
   group by daily.event
)
select event,
       case when p28 = 0 then case when w = 0 then '-' else 'new' end
            else to_char(round(w / (p28 / 4.0), 1), 'FM9990.0') || 'x' end                     as last7_vs_prior_weeks,
       case when w = 0 then '-' else to_char(round(peak / (w / 7.0), 1), 'FM9990.0') || 'x' end  as peak_day_vs_week_avg,
       case when event like 'start_choice\_%'
            then coalesce(round(100.0 * w / nullif(sum(w) filter (where event like 'start_choice\_%') over (), 0))::int::text || '%', '-')
       end                                                                                       as choice_share_7d,
       case when w >= 20 and ((p28 > 0 and w / (p28 / 4.0) >= 3) or peak / (w / 7.0) >= 4) then 'SPIKE' else 'ok' end as flag
  from agg
 order by event;

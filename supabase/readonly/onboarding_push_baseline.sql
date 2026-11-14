-- Onboarding v2 baseline (read-only): of the SIGNED-UP accounts (auth.users.is_anonymous = false) created in
-- the 30 days before today (UTC), the share whose profiles row holds a push token. One row, one column:
-- an integer-rounded percentage, or 'n/a' when there were no such accounts. No counts, ids or e-mails.
-- The date is auth.users.created_at: public.profiles has no created_at column (repo files).
select coalesce(
  (select round(100.0 * count(*) filter (where p.push_token is not null) / nullif(count(*), 0))::int::text || '%'
     from public.profiles p
     join auth.users u on u.id = p.id
    where u.is_anonymous = false
      and u.created_at >= current_date - 30
      and u.created_at < current_date),
  'n/a') as push_token_share_signed_up_30d;

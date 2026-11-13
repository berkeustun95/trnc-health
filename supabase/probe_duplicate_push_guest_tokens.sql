-- Duplicate push report 3, 2026-11-13: guests and shared tokens. READ-ONLY, one SELECT, counts only, sealed.
-- Separate file because it reads auth.users: if supabase_read_only_user cannot, only this file fails.
-- Guests "cannot hold a token" (App.js effect returns for guests; RLS). Is that true live, and does a shared token pair
-- a guest row with a signed-in row (guest → sign-in on one phone)?
select json_build_object(
  'tokens_on_guest_rows', (select count(*) from public.profiles p join auth.users u on u.id = p.id
                            where p.push_token is not null and u.is_anonymous),
  'tokens_on_rows_without_auth_user', (select count(*) from public.profiles p
                            where p.push_token is not null and not exists (select 1 from auth.users u where u.id = p.id)),
  'shared_pairs_with_a_guest', (select count(*) from (
      select p.push_token from public.profiles p join auth.users u on u.id = p.id
       where p.push_token is not null group by p.push_token
      having count(*) > 1 and bool_or(u.is_anonymous)) s),
  'shared_pairs_last_sign_in_gap_days', (select coalesce(json_agg(g order by g), '[]'::json) from (
      select (extract(epoch from max(u.last_sign_in_at) - min(u.last_sign_in_at)) / 86400)::int g
        from public.profiles p join auth.users u on u.id = p.id
       where p.push_token is not null group by p.push_token having count(*) > 1) s)
) as duplicate_push_guests;

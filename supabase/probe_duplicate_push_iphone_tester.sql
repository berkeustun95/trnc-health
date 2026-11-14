-- Duplicate push report 4, 2026-11-14: one iPhone (a former tester) showed the identical ENGLISH digest + duty twice.
-- READ-ONLY, one statement. The result is SEALED and lists account e-mails and names for Berke's vault only.
-- Nothing personal is in this file: the account is found by sha256(lower(email)), and the look-alike search terms are
-- derived at run time from that account's own row. Tokens are never printed, only left(md5(token), 8).
with me as (
  select u.id, u.email from auth.users u
   where encode(sha256(convert_to(lower(u.email), 'UTF8')), 'hex') = 'fa4f90e6ed2b03b5b1f06aee2d8e573cf8a1c3f940846bcfb1810bdbdc1049bb'),
acct as (
  select u.id, u.email, u.created_at, u.last_sign_in_at, u.is_anonymous,
         p.role, p.full_name, p.display_name, p.preferred_language, p.weekend_digest, p.push_token
    from auth.users u join public.profiles p on p.id = u.id),
terms as (  -- the last 5 letters of the e-mail local part, plus every 3+ letter word of the account's names
  select distinct t from (
    select right(split_part(lower(m.email), '@', 1), 5) t from me m
    union all
    select lower(w) from acct a join me m on m.id = a.id,
           regexp_split_to_table(coalesce(a.full_name, '') || ' ' || coalesce(a.display_name, ''), '\s+') w
     where length(w) >= 3) x where length(t) >= 3),
shown as (
  select a.*, json_build_object(
      'email', a.email, 'full_name', a.full_name, 'display_name', a.display_name, 'role', a.role,
      'lang_raw', coalesce(quote_literal(a.preferred_language), 'NULL'),
      'lang_sent', case when a.preferred_language in ('English','Turkish','Arabic','Russian','Greek','French','Spanish','German','Persian')
                        then a.preferred_language else 'English (fallback)' end,
      'weekend_digest', a.weekend_digest, 'guest', a.is_anonymous,
      'token_fp', left(md5(a.push_token), 8),
      'created', to_char(a.created_at at time zone 'utc', 'YYYY-MM-DD HH24:MI'),
      'last_sign_in', to_char(a.last_sign_in_at at time zone 'utc', 'YYYY-MM-DD HH24:MI')) j
    from acct a)
select json_build_object(
  'found_by_hash', (select count(*) from me),
  'the_account', (select json_agg(s.j) from shown s join me m on m.id = s.id),
  'search_terms', (select json_agg(t) from terms),
  'same_token_accounts', (select coalesce(json_agg(s.j order by s.created_at), '[]'::json) from shown s
      where s.push_token is not null and s.push_token in (select a.push_token from acct a join me m on m.id = a.id)),
  'lookalike_accounts', (select coalesce(json_agg(s.j order by s.created_at), '[]'::json) from shown s
      where s.id not in (select id from me)
        and exists (select 1 from terms t where lower(coalesce(s.email, '')) like '%' || t || '%'
                                            or lower(coalesce(s.full_name, '')) like '%' || t || '%'
                                            or lower(coalesce(s.display_name, '')) like '%' || t || '%')),
  'all_shared_token_groups', (select coalesce(json_agg(g order by g->>'token_fp'), '[]'::json) from (
      select json_build_object('token_fp', left(md5(s.push_token), 8),
                               'accounts', json_agg(s.j order by s.created_at)) g
        from shown s where s.push_token in (select push_token from acct where push_token is not null
                                             group by push_token having count(*) > 1)
       group by s.push_token) z),
  'lang_raw_values_with_token', (select json_object_agg(l, n) from (
      select coalesce(quote_literal(preferred_language), 'NULL') l, count(*) n from acct where push_token is not null group by 1) y)
) as iphone_tester;

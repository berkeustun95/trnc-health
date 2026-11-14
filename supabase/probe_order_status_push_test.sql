-- Order-status push diagnosis (read-only), Berke's TEST order on ADA Preview, 2026-11-14.
-- READ-ONLY: one SELECT. No user id, no order code, no full push token is printed (token: kind + last 4 chars only).
-- Results are sealed by supabase-readonly; they go to the vault only.
select json_build_object(
  'now_utc', to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS'),
  'http_response_window', (select json_build_object('oldest_utc', to_char(min(created) at time zone 'utc','MM-DD HH24:MI'),
                                                    'newest_utc', to_char(max(created) at time zone 'utc','MM-DD HH24:MI'))
                             from net._http_response),
  'test_orders_last_6h', (select coalesce(json_agg(o order by o.created_utc desc), '[]'::json) from (
      select to_char(eo.created_at at time zone 'utc','MM-DD HH24:MI:SS') as created_utc,
             eo.status, to_char(eo.status_at at time zone 'utc','MM-DD HH24:MI:SS') as status_at_utc,
             eo.created_as_guest, eo.created_by is not null as has_creator, eo.fulfilment,
             eo.notify_token is not null as order_token_set,
             p.push_token is not null and btrim(p.push_token) <> '' as profile_token_set,
             case when p.push_token like 'ExponentPushToken[%' then 'ExponentPushToken'
                  when p.push_token like 'ExpoPushToken[%' then 'ExpoPushToken'
                  when p.push_token is null then null else 'other' end as profile_token_kind,
             right(rtrim(p.push_token, ']'), 4) as profile_token_tail4,
             (select count(*) from public.profiles p2 where p2.push_token = p.push_token and p.push_token is not null) as profiles_sharing_token,
             p.preferred_language,
             (select coalesce(json_agg(json_build_object('status', ev.status,
                        'at_utc', to_char(ev.created_at at time zone 'utc','MM-DD HH24:MI:SS'),
                        'by_device', ev.device_id is not null) order by ev.created_at), '[]'::json)
                from public.eatery_order_events ev where ev.order_id = eo.id) as events,
             (select coalesce(json_agg(json_build_object(
                        'sent_utc', to_char(pl.sent_at at time zone 'utc','MM-DD HH24:MI:SS'),
                        'request_id_set', pl.request_id is not null,
                        'http_status', r.status_code, 'timed_out', r.timed_out, 'error_msg', r.error_msg,
                        'response_found', r.id is not null,
                        'ticket_status', (r.content::jsonb -> 'data' ->> 'status'),
                        'ticket_id', (r.content::jsonb -> 'data' ->> 'id'),
                        'ticket_error', (r.content::jsonb -> 'data' -> 'details' ->> 'error'),
                        'ticket_message', regexp_replace(coalesce(r.content::jsonb -> 'data' ->> 'message', r.content::jsonb -> 'errors' -> 0 ->> 'message', ''),
                                                         'Expo(nent)?PushToken\[[^\]]*\]', '<token>', 'g'))
                        order by pl.sent_at), '[]'::json)
                from public.push_log pl left join net._http_response r on r.id = pl.request_id
               where pl.user_id = eo.created_by and pl.kind = 'order_status' and pl.sent_at >= eo.created_at) as pushes
        from public.eatery_orders eo left join public.profiles p on p.id = eo.created_by
       where eo.is_test and eo.created_at > now() - interval '6 hours'
       order by eo.created_at desc limit 5) o)
) as order_status_push_test;

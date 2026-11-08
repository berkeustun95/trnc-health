-- Oli bug 1 (2026-11-08): the order and shape of chat threads that asked about "oturum izni" since the chat went
-- live. Read-only. No user ids and no message text: thread number, time (UTC), role, answer kind/intent, length.
with threads as (
  select user_id, dense_rank() over (order by min(created_at)) as thread
  from oli_messages
  where created_at >= '2026-11-07' and role = 'user' and body ilike '%oturum%'
  group by user_id
)
select t.thread,
       to_char(m.created_at at time zone 'UTC', 'MM-DD HH24:MI:SS.MS') as at_utc,
       m.role,
       m.payload->>'kind'   as kind,
       m.payload->>'intent' as intent,
       length(m.body)       as body_len,
       (m.body ilike '%oturum%') as asks_oturum
from oli_messages m
join threads t using (user_id)
where m.created_at >= '2026-11-07'
order by t.thread, m.created_at, m.id;

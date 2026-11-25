-- Read-only probe (2026-11-25): would 20261237's precondition pass right now? One boolean, no counts, no ids.
-- true = every dovec_leads row is an unsent admin mock (or an unsent, ownerless mock test row), or the table is empty.
SELECT NOT EXISTS (
  SELECT 1 FROM public.dovec_leads l
   WHERE NOT (
         (l.sent_at IS NULL AND l.attempts = 0 AND l.last_http_status IS NULL AND l.next_attempt_at IS NULL)
     AND l.status = 'mock'
     AND ((l.is_test AND l.user_id IS NULL)
          OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = l.user_id AND p.role = 'admin'))
   )
) AS cleanup_guard_passes;

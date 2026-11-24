-- Read-only probe (2026-11-24): one listed Döveç project id (partner feed data, no user data),
-- used to prove on production that dovec-lead refuses a signed-in customer while unpublished.
SELECT id FROM public.dovec_projects WHERE listed ORDER BY name LIMIT 1;

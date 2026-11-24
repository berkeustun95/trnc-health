-- Read-only probe (2026-11-24): how many Döveç lead rows a mock/test cleanup would remove, and that
-- nothing else exists. Counts approved by Berke for this one probe; the result is sealed (vault only).
SELECT count(*) FILTER (WHERE status = 'mock' OR is_test) AS mock_or_test_rows,
       count(*) FILTER (WHERE NOT (status = 'mock' OR is_test)) AS other_rows,
       EXISTS (SELECT 1 FROM public.dovec_leads WHERE sent_at IS NOT NULL) AS any_sent
FROM public.dovec_leads;

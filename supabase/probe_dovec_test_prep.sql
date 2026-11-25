-- Read-only probe (2026-11-25): state before the one Döveç test enquiry. Booleans only, no counts, no ids.
SELECT (SELECT published FROM public.dovec_settings WHERE id = 1) AS published,
       EXISTS (SELECT 1 FROM public.dovec_leads) AS any_lead_rows,
       EXISTS (SELECT 1 FROM public.dovec_leads WHERE is_test) AS any_test_row,
       EXISTS (SELECT 1 FROM public.dovec_leads WHERE sent_at IS NOT NULL) AS any_sent;

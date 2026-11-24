-- Read-only probe (2026-11-24): were any Döveç lead rows stored while dovec-lead accepted
-- enquiries before publish? Yes/no flags only: no rows, no counts, no user data.
SELECT EXISTS (SELECT 1 FROM public.dovec_leads) AS any_lead_rows,
       EXISTS (SELECT 1 FROM public.dovec_leads WHERE is_test) AS any_test_row,
       EXISTS (SELECT 1 FROM public.dovec_leads l
               WHERE NOT l.is_test
                 AND NOT EXISTS (SELECT 1 FROM public.profiles p
                                 WHERE p.id = l.user_id AND p.role = 'admin')) AS any_non_admin_rows,
       EXISTS (SELECT 1 FROM public.dovec_leads WHERE status IS DISTINCT FROM 'mock' AND NOT is_test) AS any_non_mock_status,
       EXISTS (SELECT 1 FROM public.dovec_leads WHERE sent_at IS NOT NULL) AS any_sent;

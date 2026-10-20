-- Read-only probe (2026-10-20): what does each identity get from the eatery tables in production?
-- Impersonates roles inside ONE rolled-back transaction; prints counts only (no personal data).
BEGIN READ ONLY;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"412cad91-2e3b-41b9-8186-175dfb8afa35","role":"authenticated"}', true) AS claims_set;
SELECT 'previewer' AS who, public.is_previewer() AS is_previewer, auth.uid()::text AS uid,
       (SELECT count(*) FROM public.eatery_partners WHERE slug = 'crunchy-express') AS crunchy_rows,
       (SELECT count(*) FROM public.eatery_menu_items i JOIN public.eatery_partners p ON p.id = i.partner_id WHERE p.slug = 'crunchy-express') AS crunchy_items;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true) AS claims_set;
SELECT 'normal user' AS who, public.is_previewer() AS is_previewer,
       (SELECT count(*) FROM public.eatery_partners WHERE slug = 'crunchy-express') AS crunchy_rows;
ROLLBACK;

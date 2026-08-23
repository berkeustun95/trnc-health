-- ─── Go-live step: remove the seed placeholder ───────────────────────────────
-- Run in the SQL editor, Role = postgres. Run BEFORE the flag flip.
--
-- 'ornek-cekici-test' is the inactive dummy row from the Slice 1 seed template. It has
-- a deliberately undialable number, so it must not survive launch. It is inactive, so
-- it is not currently visible or searchable — this is tidiness, not an incident.

BEGIN;

-- 1. Confirm you are deleting exactly one row, and that it is the placeholder.
SELECT slug, name, is_active FROM public.towing_companies WHERE slug = 'ornek-cekici-test';

-- 2. Delete.
DELETE FROM public.towing_companies WHERE slug = 'ornek-cekici-test';

COMMIT;

-- 3. Final pre-flight — expect exactly 4 rows, all is_active = true, no placeholder.
SELECT count(*) FILTER (WHERE is_active)                          AS live_firms,      -- 4
       count(*) FILTER (WHERE NOT is_active)                      AS inactive_rows,   -- 0
       count(*) FILTER (WHERE slug = 'ornek-cekici-test')         AS placeholder,     -- 0
       count(*) FILTER (WHERE is_24_7 = false
                          OR is_featured = true
                          OR opening_hours IS NOT NULL)           AS fixtures_left    -- 0
FROM public.towing_companies;

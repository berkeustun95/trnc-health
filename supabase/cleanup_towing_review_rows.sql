-- ─── Remove the Slice 2 review fixtures from towing_companies ────────────────
--
-- ▶ RUN THIS SOON. These rows are is_active = true, and 20260906 added the
--   towing_companies arm to search_content, so they are ALREADY REACHABLE BY THE
--   PUBLIC. Verified against production on 2026-08-23 with the anon key, signed out:
--
--     POST /rest/v1/rpc/search_content  {"query":"Kurtarma"}
--     → [{"title":"Ada Kurtarma Ağır Vasıta","module":"towing", ...}]
--
--   MODULE_FLAGS.towing = false only gates the SCREEN — a tap lands on Coming Soon.
--   It does NOT gate the search index. So a real user searching today can see a
--   fabricated firm name. That is the whole reason to delete these now rather than
--   at the start of Slice 3.
--
-- SQL editor, Role = postgres (or any admin JWT — towing_delete_admin covers it).

BEGIN;

-- ── 1. Preview. Confirm this lists ONLY fixtures before running the DELETE. ──
SELECT slug, name, is_active, created_at
FROM public.towing_companies
WHERE slug LIKE 'zz-review-%'
ORDER BY slug;
--   Expect exactly: zz-review-a  Ada Kurtarma Ağır Vasıta
--                   zz-review-b  Güzelyurt Yol Yardım
--                   zz-review-c  İskele Çekici

-- ── 2. Delete. ──
-- The 'zz-review-' prefix is the whole safety mechanism here: no real firm slug can
-- begin with it (real slugs are the firm's own name), and the seed template's
-- placeholder is 'ornek-cekici-test', which this pattern deliberately does NOT match.
DELETE FROM public.towing_companies
WHERE slug LIKE 'zz-review-%';

-- ── 3. Verify — expect 0. ──
SELECT count(*) AS remaining_review_rows
FROM public.towing_companies
WHERE slug LIKE 'zz-review-%';

COMMIT;

-- ── 4. Confirm the public leak is closed (run signed out, or from the app) ───
--   SELECT * FROM search_content('Kurtarma');   -- expect no module='towing' rows
--   SELECT * FROM search_content('Çekici');     -- expect no module='towing' rows

-- ─── NOTE FOR SLICE 3 — the same mechanism, with REAL firms ──────────────────
--
-- search_content indexes any towing_companies row with is_active = true, INDEPENDENTLY
-- of MODULE_FLAGS.towing. So seeding the four real firms as active while the flag is
-- still false makes them publicly searchable before the module launches — a tap would
-- drop the user on Coming Soon instead of the firm.
--
-- Two clean ways to avoid that, Berke's call:
--   (a) seed with is_active = false, then flip is_active and the flag together; or
--   (b) accept it — the names are real and a Coming Soon landing is harmless.
-- (a) is the safer default for an emergency module: a firm that appears in search but
-- cannot be called from the app is worse than one that is not there yet.

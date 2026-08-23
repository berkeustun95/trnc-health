-- ─── Çekici & Yol Yardım — seed template (Slice 1) ───────────────────────────
--
-- This file is the SHAPE, not the data. Real firms land in Slice 3, once logos and
-- confirmed details exist. Run in the SQL editor with Role = postgres (service_role
-- and postgres bypass RLS; an admin JWT also works via towing_insert_admin).
--
-- THE ONE ROW BELOW IS INACTIVE ON PURPOSE — is_active = false. A dummy row with
-- is_active = true would be a real, callable listing the moment MODULE_FLAGS.towing
-- flips, with a fake phone number, on an emergency screen. Never seed a placeholder
-- as active. It exists so the constraint matrix, the RLS read path and the client
-- render can all be exercised against a real row before real firms exist.
--
-- Re-runnable: ON CONFLICT (slug) DO UPDATE.

BEGIN;

INSERT INTO public.towing_companies (
  name, slug, logo_url, phone, whatsapp,
  base_region, coverage_regions, vehicle_classes, services,
  is_24_7, opening_hours, starting_price,
  is_featured, is_active, sort_order
) VALUES (
  'ÖRNEK Çekici (test kaydı — yayında değil)',
  'ornek-cekici-test',
  NULL,                                   -- filled by the Slice 3 logo mirror pass
  '+90 000 000 0000',                     -- deliberately not dialable
  NULL,                                   -- NULL => the card hides the WhatsApp button
  'nicosia',
  ARRAY['nicosia','kyrenia'],             -- MUST contain base_region (towing_base_in_coverage_check)
  ARRAY['car'],                           -- 'car' and/or 'heavy' — nothing else exists
  ARRAY['towing','tyre','battery'],
  false,                                  -- is_24_7
  -- Deliberately includes an OVERNIGHT shift (sat 20:00 -> 04:00) and a CLOSED day
  -- (sun), so the client open-now util is exercised against both on the only row
  -- that exists. Absent key == closed, same as an explicit null.
  '{"mon":{"open":"08:00","close":"18:00"},
    "tue":{"open":"08:00","close":"18:00"},
    "wed":{"open":"08:00","close":"18:00"},
    "thu":{"open":"08:00","close":"18:00"},
    "fri":{"open":"08:00","close":"18:00"},
    "sat":{"open":"20:00","close":"04:00"},
    "sun":null}'::jsonb,
  NULL,                                   -- NULL => card shows "Fiyat için arayın"
  false,                                  -- is_featured: nobody is featured in v1
  false,                                  -- is_active: INACTIVE. See the header.
  0
)
ON CONFLICT (slug) DO UPDATE SET
  name             = excluded.name,
  phone            = excluded.phone,
  whatsapp         = excluded.whatsapp,
  base_region      = excluded.base_region,
  coverage_regions = excluded.coverage_regions,
  vehicle_classes  = excluded.vehicle_classes,
  services         = excluded.services,
  is_24_7          = excluded.is_24_7,
  opening_hours    = excluded.opening_hours,
  starting_price   = excluded.starting_price,
  is_active        = excluded.is_active,
  sort_order       = excluded.sort_order;
-- logo_url is NOT in the DO UPDATE list, deliberately: the Slice 3 mirror pass owns
-- that column, and including it here would wipe a mirrored logo on every re-run.
-- Same rule as the Gişe Kıbrıs importer's `images` column.

COMMIT;

-- ─── Template for a REAL firm (Slice 3) ──────────────────────────────────────
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  SEED INACTIVE. ALWAYS. is_active = false ON EVERY INSERT.                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- WHY — this is not tidiness, it is a real hole:
--
--   search_content indexes any towing_companies row with is_active = true, and it does
--   NOT know about MODULE_FLAGS.towing. The flag gates the SCREEN only. So an active row
--   seeded before launch is publicly searchable while the module is still dark: a user
--   searches "çekici", finds a REAL firm, taps it, and lands on Coming Soon.
--
--   That is worse than not finding them at all. It teaches the user that ADA cannot help
--   with towing — and that is the lesson they will still be carrying on the day they
--   actually break down. (Observed live on 2026-08-23 with three review fixtures: they
--   were returned to a signed-out anon caller by search_content while the flag was off.)
--
-- THE COLUMN DEFAULT IS ON YOUR SIDE (since 20260907). `is_active` DEFAULTs to FALSE —
--   a deliberate inversion — so an INSERT that omits the column lands INVISIBLE rather
--   than publishing itself. Every INSERT below still names it explicitly anyway: the
--   default is the backstop, not the instruction, and a reader should not have to know
--   the default to know what the row will do.
--
-- GO-LIVE IS ONE ATOMIC STEP, TWO FILES — see the GO LIVE block at the bottom. Flip
-- is_active and MODULE_FLAGS.towing together. Neither one alone is a launch:
--   • rows active, flag false  → searchable but unreachable  (the hole above)
--   • rows inactive, flag true → a live, empty emergency screen
--
--   INSERT INTO public.towing_companies (
--     name, slug, phone, whatsapp,
--     base_region, coverage_regions, vehicle_classes, services,
--     is_24_7, opening_hours, starting_price, is_active, sort_order
--   ) VALUES (
--     'Firma Adı',
--     'firma-adi',                        -- lowercase, digits, single hyphens only
--     '+90 533 000 0000',
--     '+90 533 000 0000',                 -- or NULL
--     'kyrenia',
--     ARRAY['kyrenia','nicosia'],
--     ARRAY['car','heavy'],
--     ARRAY['towing','recovery','vehicle_transport'],
--     true,                               -- is_24_7: ONLY if genuinely 24/7
--     NULL,                               -- ignored entirely when is_24_7 = true
--     1500,                               -- or NULL for "Fiyat için arayın"
--     false,                              -- is_active: ALWAYS false at seed time. See the
--                                         --   banner above. Flipped only at go-live.
--     10
--   );
--
-- FIELD RULES
--   slug              ^[a-z0-9]+(-[a-z0-9]+)*$, unique
--   base_region       one of: nicosia kyrenia famagusta morphou iskele lefke karpaz
--   coverage_regions  subset of the same seven, non-empty, MUST include base_region
--   vehicle_classes   subset of {car, heavy}, non-empty.
--                     car   = otomobil + hafif ticari + motosiklet
--                     heavy = kamyon / otobüs
--                     'İş makinesi' is NOT a class — it is services='machinery_transport'
--   services          subset of {towing, tyre, battery, fuel, recovery,
--                                vehicle_transport, machinery_transport}
--   opening_hours     {"mon":{"open":"HH:MM","close":"HH:MM"}, ..., "sun":null}
--                     close <= open means the shift crosses midnight — allowed, and
--                     normal for this trade. Absent key == closed.
--   is_24_7           a BADGE, not a filter. Every firm paints 7/24 on its truck;
--                     record the real hours and let the card compute "şu an açık".
--   starting_price    numeric, >= 0, or NULL. NEVER hardcode a price in JS.
--                     price_updated_at is set by trigger — do not write it by hand.
--   is_active         ALWAYS false when seeding. Read the banner above before changing
--                     this. DEFAULTs to false (20260907), so omitting it is safe — but
--                     write it anyway, so the row's fate is visible in the row itself.

-- ─── VERIFY BEFORE YOU WALK AWAY (run after any seed) ───────────────────────
-- Expect 0 rows. Anything listed is publicly searchable RIGHT NOW despite the module
-- being dark — that is the hole this file exists to prevent.
--
--   SELECT slug, name, is_active
--   FROM public.towing_companies
--   WHERE is_active = true
--     AND slug <> 'ornek-cekici-test'
--   ORDER BY slug;
--
-- Independent confirmation, as a signed-out guest (nothing with module='towing'):
--   SELECT * FROM search_content('çekici');
--   SELECT * FROM search_content('kurtarma');

-- ─── GO LIVE — both halves, or neither ──────────────────────────────────────
--
-- 1. Confirm the data is right while it is still invisible:
--      SELECT slug, name, base_region, coverage_regions, vehicle_classes,
--             is_24_7, opening_hours, phone
--      FROM public.towing_companies WHERE slug <> 'ornek-cekici-test' ORDER BY sort_order;
--    Check every phone number by DIALLING IT. An emergency directory whose numbers are
--    wrong is worse than no directory.
--
-- 2. Remove the placeholder:
--      DELETE FROM public.towing_companies WHERE slug = 'ornek-cekici-test';
--
-- 3. Publish the firms:
--      UPDATE public.towing_companies SET is_active = true
--      WHERE slug <> 'ornek-cekici-test';
--
-- 4. In the SAME commit, in the repo:
--      constants/flags.js            MODULE_FLAGS.towing        false -> true
--      scripts/check-module-flags.mjs EXPECTED_MODULES.towing   false -> true
--    Both files, one commit — the guard fails the push otherwise, by design.
--
-- 5. npm run ota   (never `eas update` directly — the guard is the only thing standing
--    between an uncommitted local flag flip and every user's phone).

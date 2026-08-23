-- ═══════════════════════════════════════════════════════════════════════════
-- Çekici & Yol Yardım — Slice 3 seed: the four launch firms
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PREREQUISITES, in order:
--   1. 20260907_towing_is_active_default_false.sql   applied
--   2. 20260908_towing_phone_secondary.sql           applied  ← this file needs the column
--   3. The four logos uploaded to the `towing-logos` bucket from
--      ~/Downloads/towing-logos-256/ (256px, 56 KB total). Filenames == slug.
--
-- RUN ORDER FOR THE WHOLE GO-LIVE SITTING — each block is labelled below:
--   BLOCK A   seed the four firms, INACTIVE                    (this block)
--   BLOCK B   activate them  → the search-exposure window OPENS
--   BLOCK C   apply spot-check fixtures (optional but recommended)
--   BLOCK D   revert spot-check fixtures                        ← NEVER SKIP
--   BLOCK E   deactivate  → window CLOSES, if go-live is blocked
--   BLOCK F   the go/no-go guard. Run before flipping the flag.
--
-- WHY THE WINDOW MATTERS: between B and either D+flag-flip or E, these rows are
-- is_active = true while MODULE_FLAGS.towing may still be false. search_content indexes
-- active rows and does NOT respect the flag, so during that window a real user can find
-- a real firm and land on Coming Soon. Keep the window short and never end a session
-- inside it — that is what BLOCK E is for.
--
-- SQL editor, Role = postgres.


-- ═══ BLOCK A — SEED THE FOUR FIRMS (inactive) ══════════════════════════════
-- Re-runnable: ON CONFLICT (slug) DO UPDATE. is_active is NOT in the update list, so
-- re-running this after go-live will NOT un-publish live firms.
BEGIN;

INSERT INTO public.towing_companies (
  name, slug, logo_url, phone, phone_secondary, whatsapp,
  base_region, coverage_regions, vehicle_classes, services,
  is_24_7, opening_hours, starting_price, is_featured, is_active, sort_order
) VALUES

-- ── Çekirge Road Assistance ──────────────────────────────────────────────────
-- Coverage of Girne alone is the softest field in this set (Berke, 2026-08-23).
-- Widening it later is a one-line UPDATE, not a migration.
( 'Çekirge Road Assistance', 'cekirge-road-assistance',
  'https://jeihxnwqytnxtytgkzgf.supabase.co/storage/v1/object/public/towing-logos/cekirge-road-assistance.png?v=1',
  '+90 533 832 24 67', NULL, '+90 542 888 24 67',          -- WhatsApp differs from the call line; verified
  'kyrenia', ARRAY['kyrenia'], ARRAY['car'],
  ARRAY['towing','battery','machinery_transport'],
  true, NULL, NULL, false, false, 0 ),

-- ── Parlan Recovery ──────────────────────────────────────────────────────────
-- phone matches the number printed on their own logo.
-- A second number, 0548 863 2525, exists but is UNVERIFIED — deliberately NOT seeded.
-- An unanswered number on an emergency screen is worse than one number that works.
-- Verify it and it becomes a one-line UPDATE of phone_secondary.
( 'Parlan Recovery', 'parlan-recovery',
  'https://jeihxnwqytnxtytgkzgf.supabase.co/storage/v1/object/public/towing-logos/parlan-recovery.png?v=1',
  '+90 548 836 89 74', NULL, NULL,
  'famagusta', ARRAY['famagusta','iskele','karpaz'], ARRAY['car'],
  ARRAY['towing','recovery'],
  true, NULL, NULL, false, false, 0 ),

-- ── Terra Cyprus Trading Limited ─────────────────────────────────────────────
-- The only firm covering heavy vehicles outside Lefkoşa.
( 'Terra Cyprus Trading Limited', 'terra-cyprus',
  'https://jeihxnwqytnxtytgkzgf.supabase.co/storage/v1/object/public/towing-logos/terra-cyprus.png?v=1',
  '+90 533 872 06 10', NULL, '+90 533 872 06 10',          -- same line on WhatsApp; verified
  'kyrenia', ARRAY['kyrenia','nicosia'], ARRAY['car','heavy'],
  ARRAY['towing','recovery','machinery_transport'],
  true, NULL, NULL, false, false, 0 ),

-- ── Müjde Recovery ───────────────────────────────────────────────────────────
-- Towing ONLY. Their pickup-parts business is deliberately out of scope: no service
-- tag for it, and no cross-listing into Garages.
-- Both numbers are on WhatsApp; the primary is used for the WhatsApp button.
( 'Müjde Recovery', 'mujde-recovery',
  'https://jeihxnwqytnxtytgkzgf.supabase.co/storage/v1/object/public/towing-logos/mujde-recovery.png?v=1',
  '+90 533 823 78 04', '+90 533 861 00 46', '+90 533 823 78 04',
  'nicosia', ARRAY['nicosia'], ARRAY['car','heavy'],
  ARRAY['towing','machinery_transport'],
  true, NULL, NULL, false, false, 0 )

ON CONFLICT (slug) DO UPDATE SET
  name             = excluded.name,
  logo_url         = excluded.logo_url,
  phone            = excluded.phone,
  phone_secondary  = excluded.phone_secondary,
  whatsapp         = excluded.whatsapp,
  base_region      = excluded.base_region,
  coverage_regions = excluded.coverage_regions,
  vehicle_classes  = excluded.vehicle_classes,
  services         = excluded.services,
  is_24_7          = excluded.is_24_7,
  opening_hours    = excluded.opening_hours,
  starting_price   = excluded.starting_price,
  sort_order       = excluded.sort_order;
-- is_active and is_featured are NOT updated on conflict, on purpose: a re-run must
-- never silently un-publish a live firm, nor undo a featured deal.

-- sort_order is 0 for all four, so ordering falls through to Turkish name collation:
-- Çekirge, Müjde, Parlan, Terra. No firm has been given an advantage.

COMMIT;

-- Verify BLOCK A — expect 4 rows, all is_active = false, all logo_url non-null.
SELECT slug, name, base_region, coverage_regions, vehicle_classes,
       is_24_7, is_featured, is_active, phone, phone_secondary,
       (logo_url IS NOT NULL) AS has_logo
FROM public.towing_companies
WHERE slug <> 'ornek-cekici-test'
ORDER BY sort_order, name;
-- NOT `name COLLATE "tr-TR"` — that collation does not exist on this Supabase instance
-- and throws 42704. It was never needed: Turkish ordering happens CLIENT-side in
-- utils/towingHours.js (`localeCompare(..., 'tr')`), which is the only place it can be
-- correct anyway, since the sort's primary key is open-now and Postgres cannot compute
-- that. This SELECT is a human eyeball check; plain `name` is fine for it.

-- ⚠ DIAL EVERY NUMBER before BLOCK B. An emergency directory whose numbers are wrong
--   is worse than no directory. Check logos actually load, too:
--     curl -sSI '<logo_url>' | head -1     -- expect HTTP/2 200


-- ═══ BLOCK B — ACTIVATE (opens the search-exposure window) ═════════════════
-- Run this immediately before the Turkish spot-check, not before.
BEGIN;
UPDATE public.towing_companies
   SET is_active = true
 WHERE slug <> 'ornek-cekici-test';
COMMIT;
-- Expect 4. From here the firms are publicly searchable even with the flag off.
SELECT count(*) AS now_active FROM public.towing_companies WHERE is_active;


-- ═══ BLOCK C — SPOT-CHECK FIXTURES ═════════════════════════════════════════
--
--   ╔════════════════════════════════════════════════════════════════════════╗
--   ║  TEMPORARY. FAKE DATA. BLOCK D REVERTS IT. DO NOT GO LIVE WITHOUT D.    ║
--   ╚════════════════════════════════════════════════════════════════════════╝
--
-- WHY THIS EXISTS: all four real firms are is_24_7 = true with no opening_hours, so
-- shipping them as-is leaves FOUR code paths never once observed with real data —
-- "Açılış {time}", "Bugün kapalı", "Saat bilgisi yok", and, most importantly, the
-- ENTIRE SORT. With every firm always-open and none featured, the corrected
-- open-now-beats-featured ordering cannot be seen at all; the list is just name order.
-- The first real test of that sort should not be a stranded driver's.
--
-- After running this, expect ON SCREEN:
--   Terra Cyprus    "Şu an açık" + "7/24"     (unchanged, the control)
--   Çekirge         "Açılış 03:00"            (open only 03:00–04:00, so closed now
--                                              unless you are checking at 3am)
--   Müjde           "Bugün kapalı"  + IS_FEATURED = true
--   Parlan          "Saat bilgisi yok"        (not 24/7, no hours recorded)
--
-- ▶ THE SORT TEST — select region Lefkoşa, class Otomobil (or Ağır vasıta):
--     Terra (open, NOT featured)  MUST appear ABOVE  Müjde (closed, FEATURED).
--   If Müjde is first, featured is outranking open-now and the sort is wrong.
--   Second check — region Girne, class Otomobil:
--     Terra (open) MUST appear ABOVE Çekirge (opens 03:00).
BEGIN;

UPDATE public.towing_companies SET
  is_24_7       = false,
  opening_hours = '{"mon":{"open":"03:00","close":"04:00"},
                    "tue":{"open":"03:00","close":"04:00"},
                    "wed":{"open":"03:00","close":"04:00"},
                    "thu":{"open":"03:00","close":"04:00"},
                    "fri":{"open":"03:00","close":"04:00"},
                    "sat":{"open":"03:00","close":"04:00"},
                    "sun":null}'::jsonb
WHERE slug = 'cekirge-road-assistance';

UPDATE public.towing_companies SET
  is_24_7       = false,
  is_featured   = true,          -- the firm that must NOT win the sort
  opening_hours = '{"mon":null,"tue":null,"wed":null,"thu":null,
                    "fri":null,"sat":null,"sun":null}'::jsonb
WHERE slug = 'mujde-recovery';

UPDATE public.towing_companies SET
  is_24_7       = false,
  opening_hours = NULL           -- neither 24/7 nor any hours => "Saat bilgisi yok"
WHERE slug = 'parlan-recovery';

COMMIT;

SELECT slug, is_24_7, is_featured, (opening_hours IS NULL) AS hours_null
FROM public.towing_companies WHERE slug <> 'ornek-cekici-test' ORDER BY slug;


-- ═══ BLOCK D — REVERT THE FIXTURES ═════════════════════════════════════════
--
--   ╔════════════════════════════════════════════════════════════════════════╗
--   ║  RUN THIS THE MOMENT THE SPOT-CHECK ENDS.                              ║
--   ║  Skipping it ships a real firm as permanently closed, and a paid-tier   ║
--   ║  flag set on a firm that never bought one.                             ║
--   ╚════════════════════════════════════════════════════════════════════════╝
BEGIN;
UPDATE public.towing_companies SET
  is_24_7       = true,
  opening_hours = NULL,
  is_featured   = false
WHERE slug <> 'ornek-cekici-test';
COMMIT;

-- Expect 4 rows, all: is_24_7 t, is_featured f, hours_null t
SELECT slug, is_24_7, is_featured, (opening_hours IS NULL) AS hours_null
FROM public.towing_companies WHERE slug <> 'ornek-cekici-test' ORDER BY slug;


-- ═══ BLOCK E — DEACTIVATE (closes the window; run if go-live is BLOCKED) ═══
-- If the spot-check finds anything wrong, run BLOCK D then this, before stopping.
-- Never end a session with the rows active and the flag still false.
BEGIN;
UPDATE public.towing_companies
   SET is_active = false
 WHERE slug <> 'ornek-cekici-test';
COMMIT;
SELECT count(*) AS still_active FROM public.towing_companies WHERE is_active;   -- expect 0


-- ═══ BLOCK F — GO / NO-GO GUARD. Run before flipping MODULE_FLAGS.towing ══
-- No marker column is needed: all four real firms ship is_24_7 = true,
-- is_featured = false, opening_hours = NULL. ANY deviation means BLOCK C is still
-- applied. Expect 'CLEAN'.
SELECT CASE
         WHEN count(*) = 0 THEN 'CLEAN — no fixtures applied, safe to flip the flag'
         ELSE 'STOP — ' || count(*) || ' SPOT-CHECK FIXTURE(S) STILL LIVE: '
              || string_agg(slug, ', ') || '  → run BLOCK D'
       END AS fixture_state
FROM public.towing_companies
WHERE slug <> 'ornek-cekici-test'
  AND (is_24_7 = false OR is_featured = true OR opening_hours IS NOT NULL);

-- Second gate — the placeholder must be gone before launch:
--   DELETE FROM public.towing_companies WHERE slug = 'ornek-cekici-test';

-- Then, and only then, in ONE commit:
--   constants/flags.js             MODULE_FLAGS.towing       false -> true
--   scripts/check-module-flags.mjs EXPECTED_MODULES.towing   false -> true
--   npm run ota      (never `eas update` directly)

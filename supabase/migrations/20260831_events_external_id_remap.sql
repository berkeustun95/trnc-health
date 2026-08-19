-- ─── Events — Gişe Kıbrıs external_id: synthetic → partner ID ────────────────
--
-- One-time remap of the 69 imported Gişe Kıbrıs rows from the synthetic key
--   gk- + sha1(title|start_date)[:12]
-- to the partner's real event ID
--   gk-{ID}          e.g. gk-uHqm0skWkAIxoFk91MpC
--
-- WHY: the synthetic key is a hash of mutable content. If Gişe Kıbrıs fix a typo
-- in a title or shift a start time by an hour, the hash changes, the upsert finds
-- no match, and a DUPLICATE row is inserted while the old one lingers. The partner's
-- ID is their primary key — stable across every edit they will ever make.
--
-- WHERE THE ID COMES FROM: two independent sources in their feed agree on all 72
-- records, verified byte-for-byte before this migration was written:
--   url   https://www.gisekibris.com/etkinlikler/merchandise-…-cage-club--uHqm0skWkAIxoFk91MpC
--   image …/o/events-v2%2FuHqm0skWkAIxoFk91MpC%2Fbanner.png
-- IDs are NOT a fixed width (71 × 20-char Firestore, 1 × 25-char cuid), so the
-- extractor splits on the LAST '--' and never assumes a length.
--
-- WHY A STATIC VALUES LIST: the old key is a sha1, and sha1 is not available in
-- plain Postgres without pgcrypto. The 69 pairs below were generated offline from
-- the feed; the generator reproduced all 69 committed external_ids exactly, which
-- is what proves the mapping is the right one.
--
-- NO PERMUTATION HAZARD: old ids are gk- + 12 lowercase hex, new ids are
-- gk- + 20 or 25 mixed-case alphanumerics. The two value sets are provably
-- disjoint (verified: zero overlap), so the non-deferrable UNIQUE constraint
-- events_external_id_unique cannot trip mid-statement.
--
-- updated_at is deliberately NOT bumped: the row's content is unchanged, only its
-- key. The import run that follows this migration bumps it minutes later anyway.
--
-- SCOPE: source='gisekibris' only. Legacy source='manual' seed rows and every
-- organizer-submitted row (external_id IS NULL) are untouched.
--
-- IDEMPOTENT: on a second run the UPDATE matches zero rows and both guards pass.
--
-- EXECUTION: SET ROLE postgres, SQL editor Role selector = postgres.
-- RUN THE PRE-FLIGHT PROBES FIRST — see the foot of this file.

SET ROLE postgres;
BEGIN;

-- 1. The remap. 69 pairs, old → new.
WITH m (old_id, new_id) AS (VALUES
  ('gk-0d57c44a36be', 'gk-lRpaw93hCWuXWcnyY5fB'),    -- ARKADYAN X PERA MACKENZIE
  ('gk-79dccda1e129', 'gk-t9TOxVshUKhIz6uh76fN'),    -- AŞKIN NUR YENGİ X CONCORDE ARIA
  ('gk-617bb3c7c18c', 'gk-aqGpi2oSTLKvRaqfjOBM'),    -- ATHENA & APHRODITE CORE SHOW X CAGE CLUB
  ('gk-d6818a1093db', 'gk-rqzp6WTwfayMY8rBmu69'),    -- AVATAR AV:SHOW X CAGE CLUB
  ('gk-979ed8c3fe1a', 'gk-xvZedSrwG0sMxIu2Bo7R'),    -- BABAYAGA & VENOM CORE SHOW X CAGE CLUB
  ('gk-2d81ef6bdcaa', 'gk-wu4QAtc7qeZPcjsN0o5g'),    -- BATUFLEX X ULFET BEACH
  ('gk-ff4d9e7525cc', 'gk-YZv8aY60OTAgRVLZyItl'),    -- BİRSEN TEZER X MISIRLIZADE AÇIK HAVA KONSERLERİ
  ('gk-46edab633333', 'gk-8wWvW6B6bMeg69iJh4NI'),    -- BURAY
  ('gk-d2ade4e1def4', 'gk-t5N6kb1TmlOF04c33Tfj'),    -- BÜLENT ORTAÇGİL X MISIRLIZADE AÇIK HAVA
  ('gk-e6468a0e6feb', 'gk-XmFwQzvxFdzTYH1pNG2h'),    -- CAGE CLUB HITS
  ('gk-0babe9eb500c', 'gk-uyMmaDfGwzpPaJUD0fdu'),    -- CAGE CLUB MOMENTUM X CAGE CLUB
  ('gk-ec4c71f8266c', 'gk-LyygHHIIqHA2PvWdBTxU'),    -- CUCINA SOCIAL CLUB I DOCK DRIFT SUNSET PARTY
  ('gk-58d6557b618c', 'gk-YNJC5gxGBxyEMVow3MfV'),    -- DAYLIGHT FESTIVAL : BEACH EDITION
  ('gk-72082c0512e9', 'gk-WZtLed4VRKp2R8g9Di7A'),    -- DEHA BİLİMLER X ELEXUS HOTEL
  ('gk-6ed014146f8a', 'gk-2rz5VlqgJ8KOD32rlR3P'),    -- DERYA BEDAVACI X CRATOS PREMIUM HOTEL
  ('gk-8399d9ae2c7f', 'gk-7TVUvUtWzGUNPoqZj5Uo'),    -- DUMAN X DEDUBLÜMAN
  ('gk-176641948362', 'gk-2cIRWHpSgTczzA36Zk94'),    -- EBRU GÜNDEŞ X CRATOS PREMIUM HOTEL
  ('gk-c8fea836e20e', 'gk-kjQyv753ZKrqHrlC9ywu'),    -- EUPOHORIA X CAGE CLUB
  ('gk-93daf64b8131', 'gk-QsdIW1ARqM1vAIFnsouT'),    -- EXCLUSIVE PARTY TRIP X CAGE CLUB
  ('gk-edcad8ca5d60', 'gk-yDuH8D7gQUa1rBKsVrHZ'),    -- FAIRY NERIDA AV:SHOW X CAGE CLUB
  ('gk-e5d97a0bca4e', 'gk-GRKXWKRBqyi8hLqnoFba'),    -- FATMA TURGUT
  ('gk-c5b7ead65d9b', 'gk-oLHWNHEvX2tNuSrrTfwY'),    -- FINAL BEACH PARTY | CAGE CLUB X COCO BONGO
  ('gk-c5159809802c', 'gk-ktljOSAUMa5muCRHnhyV'),    -- FLEX PRESENTS | SAM SHURE AT CHILL BEACH
  ('gk-2dbed579ed39', 'gk-ygAWMeh5qwPNeVGoYrcW'),    -- GECE YOLCULARI X MISIRLIZADE AÇIK HAVA
  ('gk-182666311a5a', 'gk-358CxCtD3Zf47xErEFSs'),    -- GLITTER BAR X CAGE CLUB
  ('gk-549fc6036433', 'gk-GD8B5J2sRVM7aghzEqF2'),    -- GUDURU PRESENTS: FISHEYE AT ZION
  ('gk-7f53ae6c1d33', 'gk-FRmluXNUrSPJAxI7QmTl'),    -- HARMONY OF LIFE X CAGE CLUB
  ('gk-dbe784a02a53', 'gk-0qr0Sq5ZLXNgIA6dyXd6'),    -- HAYKO CEPKİN & YAŞLI AMCA
  ('gk-f09632aaf06f', 'gk-h9PPc4Lcns4zmKDAQemy'),    -- IGNITION X CAGE CLUB
  ('gk-2a2ea8af93eb', 'gk-dmHfLaxbl3A8RUuTsHgG'),    -- JOEZI X PERA MACKENZIE
  ('gk-1c8daa1cefdc', 'gk-KLQJfj75I3RhkvmhhXR5'),    -- KEMAL DOĞULU X ULFET BEACH
  ('gk-5abb3ddcc789', 'gk-TtqLBhzTn55ULBbXA67R'),    -- KUŞLAR
  ('gk-4dc72368a4d0', 'gk-voU6D6shXEOvInJWuLeS'),    -- KYBBA X CAGE CLUB
  ('gk-9f7cafa45fc3', 'gk-kSfa66oLwS86AUQd3Y0v'),    -- LOTUS CATERING X CAGE CLUB
  ('gk-7861aeaa215a', 'gk-TOWvXxgg2iziKoPyleaB'),    -- LUMERA & ANGEL REBORN CORE SHOW X CAGE CLUB
  ('gk-873424e7d691', 'gk-vPS1v7WpgWvyHqtnJiHs'),    -- LYSISTRATA
  ('gk-d71bd89adf7e', 'gk-uXMVWINwEgFL5gmYGLLT'),    -- MAHSUN KIRMIZIGÜL X CRATOS PREMIUM HOTEL
  ('gk-21c89177919f', 'gk-JRpFoph9Hlix4cXnSsjh'),    -- MEDUSA & ABYSSAL CORE SHOW X CAGE CLUB
  ('gk-c45418b996f9', 'gk-uHqm0skWkAIxoFk91MpC'),    -- MERCHANDISE GIFT BOXES X CAGE CLUB
  ('gk-11f971a7132e', 'gk-sMdtj3ck2gfuGbv10fi8'),    -- MOTİVE X CHAMADA CLUB
  ('gk-4ac97ec8e74d', 'gk-svGX9YmfdMCtBMWpuFWU'),    -- MURDA X CHAMADA CLUB
  ('gk-8ad16f0dfc37', 'gk-zFtrILpiYHKAyfbpyGJa'),    -- ÖTEKİ ANKARA MÜZİKALİ
  ('gk-68d86d1392a7', 'gk-o2jVjs7tm8e8OjTEyXsi'),    -- PAU X ROCKS LYRA
  ('gk-3bc76879093f', 'gk-P8H8lQAsYneoJdbLJAq5'),    -- PIXELIS & ZEUS CORE SHOW X CAGE CLUB
  ('gk-77de78012fd1', 'gk-6xiJPgv33eHKuQQZ67vo'),    -- POSEIDON AV:SHOW X CAGE CLUB
  ('gk-dd55e1743f90', 'gk-tUNZdzkuLaUPwi6ThdOF'),    -- POSEIDON CORE SHOW X CAGE CLUB
  ('gk-be3d81811f32', 'gk-2X2rvyYiih6Xhvu2ScDe'),    -- RIVO X ODYSSEY
  ('gk-2547a18aa97f', 'gk-LQfWf1EqArdzZCCePoeL'),    -- RUSS MILLIONS X CHAMADA CLUB
  ('gk-d76bbbccb458', 'gk-SSTkQcwKgUljE1fFEQlQ'),    -- SAGOPA KAJMER X CHAMADA CLUB
  ('gk-09a7a2f57872', 'gk-eT1OGAVmLloHInXyVjy1'),    -- SAMMY PORTER - CAGE CLUB X COCO BONGO
  ('gk-af87432c1ae0', 'gk-POJ2ZcdQ2wSuQ1CqXuTw'),    -- SATURDAY NIGHT DANCE FM PARTY X CAGE CLUB
  ('gk-38705e750be9', 'gk-ueeVQcXoVdwCdT2RyVzR'),    -- SELÇUK BALCI X ARKIN COLONY HOTEL
  ('gk-3c1da2540bd7', 'gk-oZANpkgVgFVA2D31pcRm'),    -- SEMİCENK X CRATOS PREMİUM HOTEL
  ('gk-4371f24a05c2', 'gk-cyaTSMVRyxYv9UyT5d27'),    -- SILA
  ('gk-f71d090c29c2', 'gk-dxVOrNBQg4spOTo5Hlxx'),    -- SQUID GAME VISUAL SHOW X CAGE CLUB
  ('gk-cc45f7c508ab', 'gk-mU37Iu5EVUnGxhoXiNZZ'),    -- SUNDAY PERADISE X POOL PARTY PERA MACKENZIE
  ('gk-041e5e61919a', 'gk-e3VbWiHrvutD3OYNATEd'),    -- SUNDAY PERADISE X POOL PARTY PERA MACKENZIE
  ('gk-f3423dce1bbc', 'gk-cmrxgkhys00006dpe19d8kiuh'), -- ŞENER ŞEN - ZENGİN MUTFAĞI
  ('gk-83ab251b4c01', 'gk-90R9dSCLNldT9WnfDhHk'),    -- THALASSA & BEYON THE HORIZON CORE SHOW X CAGE CLUB
  ('gk-0f12ec28b7df', 'gk-OMzjeNch58vDhHCiCpcn'),    -- THE FINAL VISION X CAGE CLUB
  ('gk-f2bc07cfafb5', 'gk-iif365w6chiTzMymHVTG'),    -- THE LOYALTY EXPERIENCE X CAGE CLUB
  ('gk-cd3a823dd84f', 'gk-66F4nkF9m8PVArYTOceJ'),    -- THE SENTINEL & RISE OF PEARL CORE SHOW X CAGE CLUB
  ('gk-f7b15969935f', 'gk-rEVY01pSo3UYpgdj3K8I'),    -- THEMBA X PERA MACKENZIE
  ('gk-886e01a87027', 'gk-XEK8JQU9HVvh2Xl9Fduf'),    -- WEDNESDAY VISUAL SHOW X CAGE CLUB
  ('gk-ea041e936db2', 'gk-DxdJgTfCbbiWLP2qLTwd'),    -- YILDIZ TİLBE
  ('gk-c65c1f80f133', 'gk-enOuajxD7eZPD063MzQo'),    -- YILDIZ TİLBE X CRATOS PREMIUM HOTEL
  ('gk-8fe65e8dc153', 'gk-moIZ5kQ3OIsNozaTecXX'),    -- ZARA X ROCKS HOTEL
  ('gk-c571cbe56f0c', 'gk-GOUr6gQciS68PIMYrzWd'),    -- ZEUS AV:SHOW X CAGE CLUB
  ('gk-378ebc5d23ed', 'gk-3lQKmd2BygyCzVqLrL5Y')     -- ZEUS CORE SHOW X CAGE CLUB
)
UPDATE public.events e
   SET external_id = m.new_id
  FROM m
 WHERE e.source = 'gisekibris'
   AND e.external_id = m.old_id;

-- 2. Fail loudly: no synthetic key may survive.
--    A survivor means a row exists that this mapping does not cover — almost
--    certainly an event that has since vanished from the partner's feed. Aborting
--    is correct: a half-migrated table would make the next import insert a
--    duplicate for every unmapped row.
DO $$
DECLARE
  n int;
  ids text;
BEGIN
  SELECT count(*), string_agg(external_id, ', ' ORDER BY external_id)
    INTO n, ids
    FROM public.events
   WHERE source = 'gisekibris'
     AND external_id ~ '^gk-[0-9a-f]{12}$';
  IF n > 0 THEN
    RAISE EXCEPTION
      'external_id remap incomplete: % gisekibris row(s) still synthetic (%). '
      'These are not in the 69-pair mapping — most likely dropped from the feed. '
      'Identify them, decide keep-or-delete, then re-run.', n, ids;
  END IF;
END $$;

-- 3. Fail loudly: every remaining gisekibris key must have the partner shape.
--    Catches a truncated or mangled paste of the VALUES list above.
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
    FROM public.events
   WHERE source = 'gisekibris'
     AND external_id !~ '^gk-[A-Za-z0-9]{20,25}$';
  IF n > 0 THEN
    RAISE EXCEPTION
      'external_id remap produced % gisekibris row(s) of unexpected shape.', n;
  END IF;
END $$;

COMMIT;
RESET ROLE;

-- No ADD COLUMN in this migration, so no NOTIFY pgrst is required — the schema
-- is unchanged and PostgREST's cache holds column names, not row values.

-- ─── Who can do what after this migration ────────────────────────────────────
-- Unchanged. No policy is added or altered, no RLS is touched, and external_id is
-- not readable or writable by any customer-facing query. events keeps its existing
-- five policies and the ev_guard_write trigger.
--   • Customers still read only status='approved' rows.
--   • Organizers still write only their own rows and still cannot self-approve.
--   • The remap runs as postgres in the SQL editor, which bypasses RLS.

-- ─── Pre-flight probes (RUN BEFORE APPLYING) ─────────────────────────────────
--   -- P1. MUST be exactly 69, and all 69 synthetic-shaped. If the counts differ,
--   --     STOP — the mapping below does not describe this table.
--   SELECT count(*) AS total,
--          count(*) FILTER (WHERE external_id ~ '^gk-[0-9a-f]{12}$') AS synthetic,
--          count(*) FILTER (WHERE external_id ~ '^gk-[A-Za-z0-9]{20,25}$') AS already_real
--   FROM public.events WHERE source = 'gisekibris';
--
--   -- P2. Confirm the UNIQUE constraint from 20260830 is live (ON CONFLICT needs it,
--   --     and step 1 relies on it being non-partial).
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conrelid = 'public.events'::regclass AND contype = 'u';
--   -- expect events_external_id_unique  UNIQUE (external_id)
--
--   -- P3. ticket_url is still NULL everywhere on this source (the import fills it).
--   SELECT count(*) FILTER (WHERE ticket_url IS NULL) AS null_ticket, count(*) AS total
--   FROM public.events WHERE source = 'gisekibris';
--   -- expect 69 / 69
--
--   -- P4. Storage paths still key on the OLD id — this is expected and cosmetic.
--   --     Nothing derives a path at read time; images[0] is stored in full.
--   SELECT external_id, images[1] FROM public.events
--   WHERE source = 'gisekibris' ORDER BY external_id LIMIT 5;

-- ─── Verification (run after applying) ───────────────────────────────────────
--   -- 69 real ids, zero synthetic:
--   SELECT count(*) AS total,
--          count(*) FILTER (WHERE external_id ~ '^gk-[0-9a-f]{12}$')        AS synthetic,
--          count(*) FILTER (WHERE external_id ~ '^gk-[A-Za-z0-9]{20,25}$')  AS real_ids
--   FROM public.events WHERE source = 'gisekibris';
--   -- expect 69 / 0 / 69
--
--   -- Nothing else moved: row ids, created_at, images and status are preserved.
--   -- (Compare against the P4 output above — same images, new external_id.)
--   SELECT count(*) FILTER (WHERE images IS NOT NULL AND array_length(images,1) > 0) AS with_image,
--          count(*) FILTER (WHERE status = 'approved') AS approved,
--          min(created_at) AS oldest
--   FROM public.events WHERE source = 'gisekibris';
--   -- expect 69 with_image, 69 approved, created_at unchanged from before
--
--   -- The other sources were not touched:
--   SELECT source, count(*), count(external_id) AS with_external_id
--   FROM public.events GROUP BY 1 ORDER BY 1;

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   Reverse the VALUES list — swap the two columns in the UPDATE join:
--     WITH m (old_id, new_id) AS (VALUES … same 69 pairs … )
--     UPDATE public.events e SET external_id = m.old_id
--       FROM m WHERE e.source='gisekibris' AND e.external_id = m.new_id;
--   Safe for the 69 remapped rows. It does NOT remove the 3 rows the subsequent
--   import inserts — those have no synthetic key to return to; delete them by
--   external_id if you are rolling back past the import as well:
--     gk-pSosDfpYCJUW6gHg3a43  HARD SELECTİON TECHNO II
--     gk-PLPPPkG0oNIK1tUhBXsS  42. MISS KUZEY KIBRIS 2026 …
--     gk-BWvu9DjzqqvuK7x9Qdvx  PLAN B PRESENTS | SUNCORE FESTIVAL …

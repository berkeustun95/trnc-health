-- ═══════════════════════════════════════════════════════════════════════════
-- 20261155 — places.official_visit: EEMD museums & ancient sites in Explore
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The Eski Eserler ve Müzeler Dairesi (EEMD) lists 34 museums and sites. All of them were
-- ALREADY places (heritage rows from the 0822 backfill and the Visit NCY import), so this adds
-- no row: it adds one column and fills it on 33 of them. The 34th, the Bedesten medieval
-- gravestone museum, is skipped by decision (Berke, 2026-11-01): the Bedesten building is not
-- EEMD's and the museum inside it is closed; the Bedesten row (927c7f65) is left untouched.
-- Data read by Berke from eemd.gov.ct.tr (MÜZE-VE-ÖREN-YERLERİ + ZİYARET-SAATLERİ) in October
-- 2026; the site's robots.txt disallows bots, so nothing here was fetched by a script.
--
-- ─── THE COLUMN ─────────────────────────────────────────────────────────────
--   official_visit jsonb, NULL for every place EEMD does not run:
--     status      'open' | 'closed'   (closed = restoration or shut; the app shows a badge only)
--     fee         {full, student} in TL, 0/0 = free; NULL where EEMD lists none
--     hours       {from, to: 'MM-DD', open, close, last_entry: 'HH:MM', weekends: bool} | NULL
--                 The window RECURS every year: the app shows hours only while today's Cyprus
--                 date is inside it (utils/officialVisit.js), so the summer schedule comes back
--                 on 1 April with no data change. weekends = false ⇒ closed on weekends and
--                 public holidays; it also decides the "free on Sundays" note.
--     source_url  the place's official EEMD page, percent-encoded
--     updated     'YYYY-MM' the data was read; the app prints it beside the fee
--   One column, not four: nothing queries inside it, and the app reads it whole.
--   Not `source`: 59 heritage rows carry source='visitncy' (the walking-route importer's key,
--   locked by places_guard_source), and an EEMD row is often one of them.
--
-- ─── WHO CAN WRITE official_visit: ONLY service_role AND THE SQL EDITOR ─────
--   places_guard_official_visit mirrors places_guard_source (20261045) exactly: for any caller
--   with a session (customer, provider AND admin) an INSERT is born NULL and an UPDATE keeps
--   the old value; no session (this file, service_role) passes. Without it, the owner of a
--   claimed café could write official_visit on their own row and appear under "Müze & Ören
--   Yeri" with an official-page link. A separate trigger, not a clause in places_guard_update,
--   for the reason in 1045's header: that function returns early on its two GUC escapes.
--
-- ─── THE GÜZELYURT DUPLICATE ────────────────────────────────────────────────
--   EEMD's one entry (one ticket) "Güzelyurt Doğa ve Arkeoloji Müzesi – St. Mamas Kilisesi" had
--   two places: 613c310f "Güzelyurt Archaeology and Nature Museum" (Visit NCY, no photo) and
--   9f14da0c "St. Mamas Church & Güzelyurt Museum" (0822 backfill, CC BY-SA photo). Berke: keep
--   the one with the better pin + photos, move what hangs off the other, hide it, never delete.
--   KEPT 9f14da0c: it has the photo; the two pins are 53 m apart in the same complex.
--     • check-ins move to the kept row, except one on a day the same person already checked
--       in there (checkins_one_per_day); those stay on the hidden row and are counted below.
--     • walking_route_stops: NOT touched. The Güzelyurt walk lists both rows; ExploreMapScreen's
--       resolveRoutes skips a stop that is not visible and renumbers the rest, so the walk simply
--       starts at its second stop. Deleting the stop would be irreversible for no visible gain.
--     • favourites live on the device (AsyncStorage ada_fav_places); App.js remaps the id.
--     • reviews: places have none (reviews are facility-only).
--   Hidden with hidden_at/hidden_reason='duplicate', the same RESTRICTIVE policy auto-hide uses.
--   guard_place_moderation allows that write only to an admin JWT, so this file disables that
--   one trigger around the one UPDATE (both inside this transaction, under the places lock) and
--   asserts it is enabled again before COMMIT.
--
-- Locks: lock_timeout 5 s, ACCESS EXCLUSIVE on places taken FIRST (as 1045 after its deadlock).
-- Re-runnable: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, the data UPDATE is idempotent, the
-- merge moves nothing the second time. ADD COLUMN ⇒ NOTIFY pgrst after RESET ROLE.
-- ═══════════════════════════════════════════════════════════════════════════
SET ROLE postgres;
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.places IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.places ADD COLUMN IF NOT EXISTS official_visit jsonb;

COMMENT ON COLUMN public.places.official_visit IS
  'EEMD visiting info (status, fee, seasonal hours, source_url, updated), NULL for places EEMD '
  'does not run. Written only by service_role / SQL editor — places_guard_official_visit.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.places'::regclass AND conname = 'places_official_visit_shape') THEN
    ALTER TABLE public.places ADD CONSTRAINT places_official_visit_shape CHECK (
      official_visit IS NULL OR (
        jsonb_typeof(official_visit) = 'object'
        -- ?& first: ->> on a missing key is NULL, and a CHECK that evaluates to NULL passes.
        AND official_visit ?& ARRAY['status', 'source_url', 'updated']
        AND official_visit->>'status' IN ('open', 'closed')
        AND official_visit->>'source_url' LIKE 'https://eemd.gov.ct.tr/%'
        AND official_visit->>'updated' ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.places_guard_official_visit()
 RETURNS trigger LANGUAGE plpgsql AS $function$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.official_visit := null;
  else
    new.official_visit := old.official_visit;
  end if;
  return new;
end $function$;

CREATE OR REPLACE TRIGGER places_guard_official_visit
  BEFORE INSERT OR UPDATE ON public.places
  FOR EACH ROW EXECUTE FUNCTION public.places_guard_official_visit();

-- ─── The 33 EEMD places ─────────────────────────────────────────────────────
UPDATE public.places p
   SET official_visit = v.ov
  FROM (VALUES
  ('bba0d5cb-001a-405f-ab9d-9913d83e10a3'::uuid, '{"status": "open", "fee": {"full": 0, "student": 0}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "15:30", "last_entry": "14:30", "weekends": false}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Lefko%C5%9Fa-B%C3%B6lgesi/Barbarl%C4%B1k-M%C3%BCzesi", "updated": "2026-10"}'::jsonb),  -- Museum of Barbarism
  ('af3e1e9d-8563-4087-a00e-58a8905a631c'::uuid, '{"status": "open", "fee": {"full": 100, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "15:30", "last_entry": "15:00", "weekends": false}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Lefko%C5%9Fa-B%C3%B6lgesi/Dervi%C5%9F-Pa%C5%9Fa-Kona%C4%9F%C4%B1-Etno%C4%9Frafya-M%C3%BCzesi", "updated": "2026-10"}'::jsonb),  -- Dervish Pasha Mansion
  ('6bcd83da-4b7d-43f1-9629-98ebd2bc6bf2'::uuid, '{"status": "open", "fee": {"full": 100, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "15:30", "last_entry": "15:00", "weekends": false}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Lefko%C5%9Fa-B%C3%B6lgesi/L%C3%BCzinyan-Evi-M%C3%BCzesi", "updated": "2026-10"}'::jsonb),  -- Lusignan House
  ('e4b80e27-45fc-47e1-85d5-97da373cfd11'::uuid, '{"status": "open", "fee": {"full": 100, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "15:30", "last_entry": "15:00", "weekends": false}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Lefko%C5%9Fa-B%C3%B6lgesi/Mevlevi-M%C3%BCzesi", "updated": "2026-10"}'::jsonb),  -- Mevlevi Tekke Museum
  ('fe916273-78d3-4280-ae1d-8a72eb5cd09c'::uuid, '{"status": "open", "fee": {"full": 0, "student": 0}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "15:30", "last_entry": "14:30", "weekends": false}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Lefko%C5%9Fa-B%C3%B6lgesi/Milli-M%C3%BCcadele-M%C3%BCzesi", "updated": "2026-10"}'::jsonb),  -- National Struggle Museum
  ('5c0d21e5-2f1b-4ea9-8a3d-3c9f67dd7d57'::uuid, '{"status": "open", "fee": {"full": 100, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "15:30", "last_entry": "15:00", "weekends": false}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Lefko%C5%9Fa-B%C3%B6lgesi/Ta%C5%9F-Eserler-M%C3%BCzesi", "updated": "2026-10"}'::jsonb),  -- Lapidary Museum
  ('8a90025d-70ce-4cb4-baa8-31c40a131f44'::uuid, '{"status": "closed", "fee": null, "hours": null, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Lefko%C5%9Fa-B%C3%B6lgesi/Sa%C3%A7akl%C4%B1-Ev", "updated": "2026-10"}'::jsonb),  -- Saçaklı House
  ('1ed9139d-453c-4eba-948b-b8431487c9f0'::uuid, '{"status": "open", "fee": {"full": 150, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "18:00", "last_entry": "17:00", "weekends": true}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Gazima%C4%9Fusa-B%C3%B6lgesi/StBarnabas-Arkeoloji-ve-%C4%B0kon-M%C3%BCzesi", "updated": "2026-10"}'::jsonb),  -- St. Barnabas Monastery
  ('9abee5c9-0d44-4a34-abef-04e3260151d1'::uuid, '{"status": "closed", "fee": null, "hours": null, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Gazima%C4%9Fusa-B%C3%B6lgesi/Othello-Kalesi", "updated": "2026-10"}'::jsonb),  -- Othello Castle
  ('e78e6e44-c9d0-4090-ab15-02cb63b9d36c'::uuid, '{"status": "open", "fee": {"full": 100, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "15:30", "last_entry": "15:00", "weekends": false}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Gazima%C4%9Fusa-B%C3%B6lgesi/Nam%C4%B1k-Kemal-M%C3%BCzesi", "updated": "2026-10"}'::jsonb),  -- Namık Kemal Museum & Dungeon
  ('8283f858-f93f-4419-9f8d-a88fc99602cd'::uuid, '{"status": "closed", "fee": null, "hours": null, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Gazima%C4%9Fusa-B%C3%B6lgesi/Canbulat-M%C3%BCzesi", "updated": "2026-10"}'::jsonb),  -- Canbulat Museum
  ('28f69a7c-48f1-4a51-b84e-37beda5e29b8'::uuid, '{"status": "open", "fee": {"full": 150, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "19:00", "last_entry": "18:00", "weekends": true}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Gazima%C4%9Fusa-B%C3%B6lgesi/Salamis-%C3%96ren-Yeri", "updated": "2026-10"}'::jsonb),  -- Salamis Ancient City
  ('88def13a-3ee3-4c3b-bb7b-56bf15f27f33'::uuid, '{"status": "open", "fee": {"full": 100, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "10:00", "close": "15:30", "last_entry": "14:45", "weekends": false}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Gazima%C4%9Fusa-B%C3%B6lgesi/Kantara-Kalesi", "updated": "2026-10"}'::jsonb),  -- Kantara Castle
  ('204d484c-8297-46e3-8306-38bfe0beb3c2'::uuid, '{"status": "open", "fee": {"full": 100, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "15:30", "last_entry": "15:00", "weekends": false}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Gazima%C4%9Fusa-B%C3%B6lgesi/Enkomi", "updated": "2026-10"}'::jsonb),  -- Enkomi (Alasia)
  ('4c340455-f0af-4d1a-88c6-e6cfdc41c978'::uuid, '{"status": "closed", "fee": null, "hours": null, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Gazima%C4%9Fusa-B%C3%B6lgesi/Kral-Mezarlar%C4%B1", "updated": "2026-10"}'::jsonb),  -- Royal Tombs
  ('2c20f82e-1ee1-4c9b-9fdc-f59be72da470'::uuid, '{"status": "closed", "fee": null, "hours": null, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Gazima%C4%9Fusa-B%C3%B6lgesi/%C4%B0kon-M%C3%BCzesi-Yeni-%C4%B0skele", "updated": "2026-10"}'::jsonb),  -- İskele Icon Museum (Panagia Theotokos)
  ('2532c8db-14ec-4aa7-a949-abfa7c49e735'::uuid, '{"status": "open", "fee": {"full": 100, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "15:30", "last_entry": "15:00", "weekends": false}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Gazima%C4%9Fusa-B%C3%B6lgesi/Akkule-Tabyas%C4%B1", "updated": "2026-10"}'::jsonb),  -- Akkule (Ravelin Bastion)
  ('c83ed380-27a9-4c3d-abf0-859e09a0a5bf'::uuid, '{"status": "open", "fee": {"full": 100, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "15:30", "last_entry": "15:00", "weekends": false}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Gazima%C4%9Fusa-B%C3%B6lgesi/Ay-Trias-Bazilikas%C4%B1-Sipahi", "updated": "2026-10"}'::jsonb),  -- Ayios Trias Basilica
  ('d2403dda-2a30-4e96-bb3a-b1f90249284b'::uuid, '{"status": "open", "fee": {"full": 100, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "15:30", "last_entry": "15:00", "weekends": false}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Gazima%C4%9Fusa-B%C3%B6lgesi/%C4%B0skele-Arkeoloji-M%C3%BCzesi", "updated": "2026-10"}'::jsonb),  -- İskele Archaeological Museum
  ('7ecf2c84-2192-45c9-b075-a2ce115f842c'::uuid, '{"status": "open", "fee": {"full": 150, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "19:00", "last_entry": "18:00", "weekends": true}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Girne-B%C3%B6lgesi/Girne-Kalesi", "updated": "2026-10"}'::jsonb),  -- Kyrenia Castle
  ('d1d9761c-a9e8-4f62-8b3b-4c0b6b8fdf7c'::uuid, '{"status": "open", "fee": {"full": 150, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "19:00", "last_entry": "18:00", "weekends": true}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Girne-B%C3%B6lgesi/Bellapais-Manast%C4%B1r%C4%B1", "updated": "2026-10"}'::jsonb),  -- Bellapais Abbey
  ('d773e658-95ac-48ba-ae53-5936374a976f'::uuid, '{"status": "open", "fee": {"full": 150, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "09:00", "close": "18:30", "last_entry": "17:30", "weekends": true}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Girne-B%C3%B6lgesi/St-Hilarion-Kalesi", "updated": "2026-10"}'::jsonb),  -- St. Hilarion Castle
  ('39e93795-834b-4ced-bc6d-7890ad96a6a5'::uuid, '{"status": "open", "fee": null, "hours": null, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Girne-B%C3%B6lgesi/Bufavento-Kalesi", "updated": "2026-10"}'::jsonb),  -- Buffavento Castle
  ('8b00fc3e-bb46-4827-b52d-b1b85e692025'::uuid, '{"status": "open", "fee": {"full": 100, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "15:30", "last_entry": "15:00", "weekends": false}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Girne-B%C3%B6lgesi/K%C4%B1br%C4%B1s-Evi-Harup-Ambar%C4%B1", "updated": "2026-10"}'::jsonb),  -- Cyprus House & Carob Store Museum
  ('527a51da-a39e-49ff-a2d3-ac07ca3591ad'::uuid, '{"status": "closed", "fee": null, "hours": null, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Girne-B%C3%B6lgesi/Bar%C4%B1%C5%9F-ve-%C3%96zg%C3%BCrl%C3%BCk-M%C3%BCzesi", "updated": "2026-10"}'::jsonb),  -- Peace and Freedom Museum
  ('975f0204-4007-421a-9dce-d85d7ad9b5be'::uuid, '{"status": "open", "fee": {"full": 100, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "15:30", "last_entry": "15:00", "weekends": false}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Girne-B%C3%B6lgesi/Antifonitis-Manast%C4%B1r%C4%B1", "updated": "2026-10"}'::jsonb),  -- Antiphonitis Church
  ('a95ec495-c1a0-4732-b3dd-55dee1d73351'::uuid, '{"status": "closed", "fee": null, "hours": null, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Girne-B%C3%B6lgesi/Archangelos-Mihail-%C4%B0kon-M%C3%BCzesi", "updated": "2026-10"}'::jsonb),  -- Archangelos Michael Icon Museum
  ('8cd3a581-7980-4011-b55e-60ab7cf66daa'::uuid, '{"status": "open", "fee": null, "hours": null, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/Girne-B%C3%B6lgesi/Ta%C5%9Fkent-%C5%9Eehitli%C4%9Fi-ve-M%C3%BCzesi", "updated": "2026-10"}'::jsonb),  -- Taşkent Martyrs' Museum
  ('9f14da0c-e9a2-4489-81e2-20973b662942'::uuid, '{"status": "open", "fee": {"full": 150, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "18:00", "last_entry": "17:00", "weekends": true}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/G%C3%BCzelyurt-B%C3%B6lgesi/G%C3%BCzelyurt-Do%C4%9Fa-ve-Arkeoloji-M%C3%BCzesi-St-Mamas-Kilisesi", "updated": "2026-10"}'::jsonb),  -- St. Mamas Church & Güzelyurt Museum
  ('8934e983-8eb2-4aa8-9a63-cf0db461dfa6'::uuid, '{"status": "open", "fee": {"full": 100, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "18:00", "last_entry": "17:00", "weekends": true}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/G%C3%BCzelyurt-B%C3%B6lgesi/Vuni-Saray%C4%B1", "updated": "2026-10"}'::jsonb),  -- Vouni Palace
  ('328fad9c-9da7-4273-a638-1682de89da39'::uuid, '{"status": "open", "fee": {"full": 150, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "18:00", "last_entry": "17:00", "weekends": true}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/G%C3%BCzelyurt-B%C3%B6lgesi/Soli-Bazilikas%C4%B1", "updated": "2026-10"}'::jsonb),  -- Soli Ruins
  ('6169028b-2497-4d86-8ed1-7b4598af0122'::uuid, '{"status": "open", "fee": {"full": 100, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "15:30", "last_entry": "15:00", "weekends": false}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/G%C3%BCzelyurt-B%C3%B6lgesi/G%C3%BCzelyurt-Tren-%C4%B0stasyonu-M%C3%BCzesi", "updated": "2026-10"}'::jsonb),  -- Güzelyurt Railway Station Museum
  ('7edf6c7d-9bd2-4617-afdc-af1a3443d3e6'::uuid, '{"status": "open", "fee": {"full": 100, "student": 50}, "hours": {"from": "04-01", "to": "10-31", "open": "08:00", "close": "15:30", "last_entry": "15:00", "weekends": false}, "source_url": "https://eemd.gov.ct.tr/M%C3%9CZE-VE-%C3%96REN-YERLER%C4%B0/G%C3%BCzelyurt-B%C3%B6lgesi/Lefke-Maden-M%C3%BCzesi", "updated": "2026-10"}'::jsonb)  -- Lefke Mining Museum
  ) AS v(id, ov)
 WHERE p.id = v.id AND p.official_visit IS DISTINCT FROM v.ov;

-- ─── Güzelyurt: move check-ins, then hide the duplicate ─────────────────────
UPDATE public.checkins c
   SET place_id = '9f14da0c-e9a2-4489-81e2-20973b662942'
 WHERE c.place_id = '613c310f-c118-4668-9ea1-e5b4494164e9'
   AND NOT EXISTS (SELECT 1 FROM public.checkins k
                    WHERE k.place_id = '9f14da0c-e9a2-4489-81e2-20973b662942' AND k.user_id = c.user_id
                      AND k.checked_in_on = c.checked_in_on);

ALTER TABLE public.places DISABLE TRIGGER guard_place_moderation;
UPDATE public.places
   SET hidden_at = now(), hidden_reason = 'duplicate'
 WHERE id = '613c310f-c118-4668-9ea1-e5b4494164e9' AND hidden_at IS NULL;
ALTER TABLE public.places ENABLE TRIGGER guard_place_moderation;

-- ─── Assertions ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_n         int;
  v_bad       text;
  v_def       text;
  v_trg       text;
  v_left      int;
  v_uid       uuid := gen_random_uuid();   -- a session that is nobody
  v_id        uuid;
  v_ins       jsonb := '{}';
  v_upd       jsonb := '{}';
  v_upd_name  text;
  v_svc       jsonb;
  v_shape_ok  boolean := false;
  v_keys_ok   boolean := false;
  v_month_ok  boolean := false;
BEGIN
  -- Column + constraint + trigger, read from the catalogs.
  SELECT data_type INTO v_def FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'places' AND column_name = 'official_visit';
  IF v_def IS DISTINCT FROM 'jsonb' THEN
    RAISE EXCEPTION 'places.official_visit did not land as jsonb; found: %', coalesce(v_def, '(none)');
  END IF;
  SELECT pg_get_triggerdef(t.oid) INTO v_def FROM pg_trigger t
   WHERE t.tgrelid = 'public.places'::regclass AND t.tgname = 'places_guard_official_visit' AND NOT t.tgisinternal;
  IF v_def IS NULL OR v_def NOT LIKE '%BEFORE INSERT OR UPDATE ON %places FOR EACH ROW EXECUTE FUNCTION %places_guard_official_visit()%' THEN
    RAISE EXCEPTION 'places_guard_official_visit trigger missing or wrong shape; found: %', coalesce(v_def, '(missing)');
  END IF;

  -- The moderation guard is back on (the merge disabled it for one statement).
  SELECT tgenabled::text INTO v_trg FROM pg_trigger
   WHERE tgrelid = 'public.places'::regclass AND tgname = 'guard_place_moderation';
  IF v_trg IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'guard_place_moderation is not enabled after the merge (tgenabled=%)', coalesce(v_trg, '(missing)');
  END IF;

  -- Exactly the 33 rows carry EEMD data, all active and visible, and Bedesten is not one of them.
  SELECT count(*) INTO v_n FROM public.places
   WHERE official_visit IS NOT NULL AND status = 'active' AND hidden_at IS NULL;
  IF v_n IS DISTINCT FROM 33 OR (SELECT count(*) FROM public.places WHERE official_visit IS NOT NULL) IS DISTINCT FROM 33 THEN
    RAISE EXCEPTION 'expected 33 active, visible places with official_visit, got %: %', v_n,
      (SELECT json_agg(json_build_object('id', id, 'name', name, 'status', status, 'hidden_at', hidden_at))
         FROM public.places WHERE official_visit IS NOT NULL);
  END IF;
  SELECT string_agg(name, ', ') INTO v_bad FROM public.places
   WHERE official_visit IS NOT NULL AND (id::text LIKE '927c7f65%' OR id = '613c310f-c118-4668-9ea1-e5b4494164e9');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'official_visit landed on a row it must not: %', v_bad; END IF;
  SELECT count(*) INTO v_n FROM public.places
   WHERE official_visit->>'status' = 'closed' AND official_visit->'fee' = 'null' AND official_visit->'hours' = 'null';
  IF v_n IS DISTINCT FROM 7 THEN RAISE EXCEPTION 'expected 7 closed places with no fee/hours, got %', v_n; END IF;

  -- Güzelyurt: the duplicate is hidden, the kept row is visible, and what could move did.
  IF NOT EXISTS (SELECT 1 FROM public.places WHERE id = '613c310f-c118-4668-9ea1-e5b4494164e9' AND hidden_at IS NOT NULL AND hidden_reason = 'duplicate') THEN
    RAISE EXCEPTION 'Güzelyurt duplicate 613c310f is not hidden';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.places WHERE id = '9f14da0c-e9a2-4489-81e2-20973b662942' AND hidden_at IS NULL AND status = 'active') THEN
    RAISE EXCEPTION 'kept Güzelyurt row 9f14da0c is not active and visible';
  END IF;
  SELECT count(*) INTO v_left FROM public.checkins c WHERE c.place_id = '613c310f-c118-4668-9ea1-e5b4494164e9'
     AND NOT EXISTS (SELECT 1 FROM public.checkins k WHERE k.place_id = '9f14da0c-e9a2-4489-81e2-20973b662942'
                      AND k.user_id = c.user_id AND k.checked_in_on = c.checked_in_on);
  IF v_left IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'probe: % check-in(s) on 613c310f could have moved and did not', v_left;
  END IF;

  -- ── BEHAVIOUR of the lock: a probe ending in a sentinel, so its rows roll back.
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    INSERT INTO public.places (category, name, region, official_visit)
    VALUES ('cafe', 'zz official probe', 'kyrenia',
            '{"status":"open","source_url":"https://eemd.gov.ct.tr/x","updated":"2026-10"}')
    RETURNING id, official_visit INTO v_id, v_ins;
    UPDATE public.places
       SET official_visit = '{"status":"open","source_url":"https://eemd.gov.ct.tr/y","updated":"2026-10"}'
     WHERE id = v_id RETURNING official_visit INTO v_upd;
    UPDATE public.places SET name = 'zz official probe renamed' WHERE id = v_id RETURNING name INTO v_upd_name;

    PERFORM set_config('request.jwt.claims', '', true);
    UPDATE public.places
       SET official_visit = '{"status":"open","source_url":"https://eemd.gov.ct.tr/z","updated":"2026-10"}'
     WHERE id = v_id RETURNING official_visit INTO v_svc;
    BEGIN
      UPDATE public.places SET official_visit = '{"status":"maybe","source_url":"https://example.com","updated":"x"}' WHERE id = v_id;
    EXCEPTION WHEN check_violation THEN v_shape_ok := true;
    END;
    BEGIN
      UPDATE public.places SET official_visit = '{"status":"open"}' WHERE id = v_id;
    EXCEPTION WHEN check_violation THEN v_keys_ok := true;
    END;
    BEGIN
      UPDATE public.places SET official_visit = '{"status":"open","source_url":"https://eemd.gov.ct.tr/z","updated":"2026-13"}' WHERE id = v_id;
    EXCEPTION WHEN check_violation THEN v_month_ok := true;
    END;
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', '', true);

  IF v_id IS NULL THEN RAISE EXCEPTION 'probe: the client INSERT produced no row, so nothing was tested'; END IF;
  IF v_ins IS NOT NULL THEN RAISE EXCEPTION 'probe: a client INSERT kept official_visit (%) — the lock is open', v_ins; END IF;
  IF v_upd IS NOT NULL THEN RAISE EXCEPTION 'probe: a client UPDATE set official_visit (%) — the lock is open', v_upd; END IF;
  IF v_upd_name IS DISTINCT FROM 'zz official probe renamed' THEN
    RAISE EXCEPTION 'probe: an ordinary client edit was blocked or altered (name=%)', v_upd_name;
  END IF;
  IF v_svc->>'source_url' IS DISTINCT FROM 'https://eemd.gov.ct.tr/z' THEN
    RAISE EXCEPTION 'probe: the no-session path could not write official_visit (%)', v_svc;
  END IF;
  IF NOT v_shape_ok THEN RAISE EXCEPTION 'probe: a malformed official_visit was accepted'; END IF;
  IF NOT v_keys_ok  THEN RAISE EXCEPTION 'probe: an official_visit missing source_url/updated was accepted'; END IF;
  IF NOT v_month_ok THEN RAISE EXCEPTION 'probe: official_visit.updated month 13 was accepted'; END IF;
  IF EXISTS (SELECT 1 FROM public.places WHERE name LIKE 'zz official probe%') THEN
    RAISE EXCEPTION 'probe rows survived the rollback';
  END IF;
END $$;
-- ─── ledger:stamp:begin ──────────────────────────────────────────────
-- Machine-generated by scripts/migration-ledger.mjs --stamp. Do not hand-edit.
-- The checksum is of THIS FILE WITH THIS BLOCK STRIPPED, which is what lets the file
-- carry its own stamp. Everything between the markers is excluded from the checksum
-- but still runs — so it may contain NOTHING but this INSERT. See the note in the
-- generator: anything else here would execute on paste while leaving no trace in the
-- hash, and the ledger would be attesting a file it never actually verified.
--
-- This is also the LAST statement inside BEGIN/COMMIT: if a paste is truncated before
-- it, COMMIT is never reached and nothing applies.
INSERT INTO public.schema_migrations_applied (filename, checksum)
VALUES ('20261155_places_official_visit.sql', '2d2bddfac8e18a2185a342fd5954bcf2fcbcdcf71d17c9f4121abac320c9c8e3')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only) ────────────────────────────────
--   SELECT count(*) FILTER (WHERE official_visit IS NOT NULL) AS eemd,
--          count(*) FILTER (WHERE official_visit->>'status' = 'closed') AS closed
--     FROM public.places;                       -- expect 33, 7
--   SELECT id, hidden_reason FROM public.places WHERE id = '613c310f-c118-4668-9ea1-e5b4494164e9';   -- expect 'duplicate'
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   Un-hide — paste ALL of it as one script (SQL editor, role postgres). Without BEGIN/COMMIT a
--   failed UPDATE would leave the moderation guard disabled:
--     BEGIN;
--     SET LOCAL lock_timeout = '5s';
--     LOCK TABLE public.places IN ACCESS EXCLUSIVE MODE;
--     ALTER TABLE public.places DISABLE TRIGGER guard_place_moderation;
--     UPDATE public.places SET hidden_at = NULL, hidden_reason = NULL WHERE id = '613c310f-c118-4668-9ea1-e5b4494164e9';
--     ALTER TABLE public.places ENABLE TRIGGER guard_place_moderation;
--     DO $$ BEGIN
--       IF (SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'public.places'::regclass
--            AND tgname = 'guard_place_moderation') IS DISTINCT FROM 'O' THEN
--         RAISE EXCEPTION 'guard_place_moderation not re-enabled'; END IF; END $$;
--     COMMIT;
--   (Moved check-ins are not moved back: they were at the same museum.)
--   DROP TRIGGER IF EXISTS places_guard_official_visit ON public.places;
--   DROP FUNCTION IF EXISTS public.places_guard_official_visit();
--   ALTER TABLE public.places DROP CONSTRAINT IF EXISTS places_official_visit_shape,
--                             DROP COLUMN IF EXISTS official_visit;

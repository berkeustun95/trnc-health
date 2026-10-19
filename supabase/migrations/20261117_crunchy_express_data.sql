-- ═══════════════════════════════════════════════════════════════════════════
-- 20261117 — Crunchy Express data: partner details + the 41-item menu (still INACTIVE)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DATA ONLY, NO SCHEMA, NO POLICY, NO GRANT. Fills the bare 20261115 seed row
-- (id bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434, slug crunchy-express) and inserts its menu.
-- is_active stays false: every client role still sees NOTHING of this partner or its menu
-- (asserted below as anon and as authenticated, with postgres as the positive control).
--
-- SOURCE (Berke, 2026-10-19): the Yemeksepeti app, read-only on the test phone on 2026-10-19
-- (screens in ~/ADA-partner-files/crunchy-express/yemeksepeti-screens/). Berke confirmed the
-- Yemeksepeti prices as the menu prices, so menu_verified_on = 2026-10-19. Permission to publish
-- the menu and company info: Berke, 2026-10-19 (vault go-live checklist §8a).
-- Obvious typos are fixed (vault build log lists each one); everything else is as shown.
--
-- Partner columns set here: address, region, opening_hours, menu_verified_on.
-- Left NULL on purpose (not known, never guessed): phone, whatsapp, logo_path, website_url, menu_url, maps_url.
-- Pin 35.179003, 33.35745 (6 dp), geocode_source 'partner': confirmed by Berke for the owner, 2026-10-19;
-- inside OSM relation 2514541 (Northern Cyprus), Lefkoşa ilçesi, Köşklüçiftlik Mahallesi. Not Google: no
-- google-pins.csv row.
-- Opening hours are the hours Yemeksepeti shows (they may be delivery hours, not in-store).
--
-- Dishes sold out on Yemeksepeti on 2026-10-19 are NOT here; the pre-launch re-read adds them
-- in a later data migration (checklist §3 step 7).
--
-- ─── RE-RUNNABLE ────────────────────────────────────────────────────────────
-- Partner: each column must be NULL (seed) or already equal to its target; anything else raises.
-- Menu: the partner must have 0 items (insert) or EXACTLY these 41 (no-op); anything else raises
-- with the live count. It never deletes, so a re-run can never wipe a dish's photo_path.
--
-- Apply: gh workflow run supabase-migrate -f file=20261117_crunchy_express_data.sql (dry), then
-- -f apply=true (Berke approves production-db).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  c_id     constant uuid := 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434';
  v_menu   constant jsonb := $menu$
  [
  {
  "section": "Chicken Burgerler",
  "section_order": 1,
  "name": "Crunchy Burger",
  "description": "3-pieces chicken tenders, burger cheese, coslow, pickles, iceberg, crunchy signature sauce, and fries",
  "price": "620.00",
  "sort_order": 1
  },
  {
  "section": "Chicken Burgerler",
  "section_order": 1,
  "name": "Crunchy BBQ Chicken Burger",
  "description": "3 parça tavuk şerit, burger peyniri, çıtır soğan, çıtır füme, barbekü soslu turşu. Patates kızartması ile",
  "price": "650.00",
  "sort_order": 2
  },
  {
  "section": "Chicken Burgerler",
  "section_order": 1,
  "name": "Pineapple Chicken Burger",
  "description": "3 parça tavuk şerit, burger peyniri, çıtır ananaslı hardal sosu, turşu. Patates kızartması ile",
  "price": "650.00",
  "sort_order": 3
  },
  {
  "section": "Chicken Burgerler",
  "section_order": 1,
  "name": "Nashville Tavuk Burger",
  "description": "3 parça tavuk, Nashville sosu, çıtır özel sos, burger peyniri, turşu. Patates kızartması ile",
  "price": "650.00",
  "sort_order": 4
  },
  {
  "section": "Chicken Burgerler",
  "section_order": 1,
  "name": "Truffle Chicken Burger",
  "description": "3 parça tavuk şerit, çıtır trüf sosu, turşu, buzdağı marul, parmesan peyniri, taze frenk soğanı. Patates kızartması ile",
  "price": "680.00",
  "sort_order": 5
  },
  {
  "section": "Chicken Burgerler",
  "section_order": 1,
  "name": "Buffalo Chicken Burger",
  "description": "Üç parça tavuk bonfile, acı sos, burger peyniri, çıtır ranch sos, turşu, buzlu marul. Patates kızartması ile",
  "price": "680.00",
  "sort_order": 6
  },
  {
  "section": "Chicken Burgerler",
  "section_order": 1,
  "name": "Chipotle Chicken Burger",
  "description": "Chipotle sos, marul, turşu, burger peyniri. Patates kızartması ile",
  "price": "680.00",
  "sort_order": 7
  },
  {
  "section": "Chicken Burgerler",
  "section_order": 1,
  "name": "Hot Honey Glazed Chicken Burger",
  "description": "3 adet tavuk tenders, burger peyniri, turşu. Mayonez, crunchy acı bal sos ve patates kızartması ile birlikte",
  "price": "680.00",
  "sort_order": 8
  },
  {
  "section": "Chicken Burgerler",
  "section_order": 1,
  "name": "TNT Chicken Burger",
  "description": "3 adet acı sosa bulanmış tavuk tenders, iceberg, turşu, peynir, ranch sos ve patates kızartması ile birlikte",
  "price": "680.00",
  "sort_order": 9
  },
  {
  "section": "Beef Burgers",
  "section_order": 2,
  "name": "Express Smash Burger",
  "description": "Smash burger köftesi, soğan, turşu, ketçap, mayonez, cheddar peyniri. Patates kızartması, sos ile",
  "price": "820.00",
  "sort_order": 1
  },
  {
  "section": "Beef Burgers",
  "section_order": 2,
  "name": "BBQ Smash Burger",
  "description": "Smash burger köftesi, çıtır soğan, barbekü sos, mayonez, dana bacon, cheddar peyniri, salatalık turşusu. Patates kızartması ile",
  "price": "860.00",
  "sort_order": 2
  },
  {
  "section": "Beef Burgers",
  "section_order": 2,
  "name": "Trüf Smash Burger",
  "description": "Smash burger köftesi, dana bacon, trüf mayonez, salatalık turşusu, burger ekmeği. Patates kızartması, seçeceğiniz sos ile",
  "price": "890.00",
  "sort_order": 3
  },
  {
  "section": "Beef Burgers",
  "section_order": 2,
  "name": "Big Pork Smash Burger",
  "description": "Smash burger köftesi, domuz bacon, smoked mayo, turşu, burger peyniri, kırmızı soğan. Patates kızartması, 1 adet seçeceğiniz küçük sos ile (Domuz eti içerir.)",
  "price": "890.00",
  "sort_order": 4
  },
  {
  "section": "Beef Burgers",
  "section_order": 2,
  "name": "Jalapeño Drip Smash Burger",
  "description": "Smash burger köftesi, ızgara jalapeño, gouda, crunchy burger sos. Patates kızartması, seçeceğiniz 1 adet sos ile",
  "price": "860.00",
  "sort_order": 5
  },
  {
  "section": "Crunchy Box Menüleri",
  "section_order": 3,
  "name": "Crunchy Box",
  "description": "5 parça tavuk tenders, 1 porsiyon patates kızartması, ve tercih edilen iki adet crunchy küçük sos.",
  "price": "650.00",
  "sort_order": 1
  },
  {
  "section": "Crunchy Box Menüleri",
  "section_order": 3,
  "name": "Crunchy Box XL",
  "description": "7 parça tavuk tenders, 1 porsiyon patates kızartması, ve tercih edilen 2 adet crunchy büyük sos.",
  "price": "870.00",
  "sort_order": 2
  },
  {
  "section": "Crunchy Box Menüleri",
  "section_order": 3,
  "name": "Crunchy Box XXL",
  "description": "9 adet tavuk tenders, 2 porsiyon patates kızartması, seçeceğiniz 2 adet Crunchy büyük sos",
  "price": "1090.00",
  "sort_order": 3
  },
  {
  "section": "Crunchy Box Menüleri",
  "section_order": 3,
  "name": "Crunchy Kids Box",
  "description": "2 parça tavuk kanadı, 1 porsiyon patates kızartması, tercih edilen küçük çıtır sos.",
  "price": "450.00",
  "sort_order": 4
  },
  {
  "section": "Vejetaryen Burgerler",
  "section_order": 4,
  "name": "Veggy Smash Burger",
  "description": "Vejetaryen burger köftesi, burger peyniri, turşu, crunchy burger sos. Patates kızartması ile",
  "price": "700.00",
  "sort_order": 1
  },
  {
  "section": "Yan Ürünler",
  "section_order": 5,
  "name": "Mozzarella Sticks (6 Adet)",
  "description": "Seçeceğiniz küçük sos ile",
  "price": "300.00",
  "sort_order": 1
  },
  {
  "section": "Yan Ürünler",
  "section_order": 5,
  "name": "4'lü Mozzarella Sticks",
  "description": "Tercih edilen 1 adet küçük sos ile",
  "price": "220.00",
  "sort_order": 2
  },
  {
  "section": "Yan Ürünler",
  "section_order": 5,
  "name": "Acılı Soğan Halkası (8 Adet)",
  "description": "Seçeceğiniz küçük sos ile",
  "price": "150.00",
  "sort_order": 3
  },
  {
  "section": "Yan Ürünler",
  "section_order": 5,
  "name": "Acılı Soğan Halkası (12 Adet)",
  "description": "Seçeceğiniz sos ile",
  "price": "220.00",
  "sort_order": 4
  },
  {
  "section": "Yan Ürünler",
  "section_order": 5,
  "name": "Patates Kızartması",
  "description": "Parmak dilim",
  "price": "170.00",
  "sort_order": 5
  },
  {
  "section": "Yan Ürünler",
  "section_order": 5,
  "name": "Hot Honey Glazed Halloumi",
  "description": "Günlük hazırlanır.",
  "price": "300.00",
  "sort_order": 6
  },
  {
  "section": "Yan Ürünler",
  "section_order": 5,
  "name": "Nashville Sticks (6 Adet)",
  "description": "Seçeceğiniz sos ile",
  "price": "340.00",
  "sort_order": 7
  },
  {
  "section": "Soslar",
  "section_order": 6,
  "name": "Crunchy Özel Sos",
  "description": "Signature sauce",
  "price": "65.00",
  "sort_order": 1
  },
  {
  "section": "Soslar",
  "section_order": 6,
  "name": "Sweet Chili Sos",
  "description": "Adet olarak servis edilir.",
  "price": "65.00",
  "sort_order": 2
  },
  {
  "section": "Soslar",
  "section_order": 6,
  "name": "Crunchy BBQ Sos",
  "description": "Paketli ürün",
  "price": "65.00",
  "sort_order": 3
  },
  {
  "section": "Soslar",
  "section_order": 6,
  "name": "Crunchy Buffalo Sos",
  "description": "Paketli ürün",
  "price": "65.00",
  "sort_order": 4
  },
  {
  "section": "Soslar",
  "section_order": 6,
  "name": "Crunchy Trüf Sos",
  "description": "Paketli ürün",
  "price": "70.00",
  "sort_order": 5
  },
  {
  "section": "Soslar",
  "section_order": 6,
  "name": "Crunchy Ranch Sos",
  "description": "Paketli ürün",
  "price": "65.00",
  "sort_order": 6
  },
  {
  "section": "Soslar",
  "section_order": 6,
  "name": "Crunchy Pineapple Sos",
  "description": "Paketli ürün",
  "price": "65.00",
  "sort_order": 7
  },
  {
  "section": "Soslar",
  "section_order": 6,
  "name": "Crunchy Hot Mayo",
  "description": "Paketli ürün",
  "price": "65.00",
  "sort_order": 8
  },
  {
  "section": "Soslar",
  "section_order": 6,
  "name": "Crunchy Coslow",
  "description": "Paketli ürün",
  "price": "70.00",
  "sort_order": 9
  },
  {
  "section": "Tatlılar",
  "section_order": 7,
  "name": "Nutella Smash",
  "description": "Nutella çikolata",
  "price": "200.00",
  "sort_order": 1
  },
  {
  "section": "İçecekler",
  "section_order": 8,
  "name": "Coca-Cola Zero Sugar (33 cl.)",
  "description": "Kutu içecek",
  "price": "70.00",
  "sort_order": 1
  },
  {
  "section": "İçecekler",
  "section_order": 8,
  "name": "Coca-Cola (33 cl.)",
  "description": "Kutu içecek",
  "price": "70.00",
  "sort_order": 2
  },
  {
  "section": "İçecekler",
  "section_order": 8,
  "name": "Fanta (33 cl.)",
  "description": "Kutu içecek",
  "price": "70.00",
  "sort_order": 3
  },
  {
  "section": "İçecekler",
  "section_order": 8,
  "name": "Sprite (33 cl.)",
  "description": "Kutu içecek",
  "price": "70.00",
  "sort_order": 4
  },
  {
  "section": "İçecekler",
  "section_order": 8,
  "name": "Fuse Tea (33 cl.)",
  "description": "Kutu içecek",
  "price": "70.00",
  "sort_order": 5
  }
  ]
  $menu$::jsonb;
  v_p      public.eatery_partners%ROWTYPE;
  v_before int;
  v_same   int;
  v_after  int;
  v_secs   int;
  v_anon_p int; v_anon_i int; v_auth_p int; v_auth_i int;
BEGIN
  -- ── Pre-state: the seed row, inactive, and every target column NULL or already equal ──
  SELECT * INTO v_p FROM public.eatery_partners WHERE id = c_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'crunchy-express row % not found (20261115 not applied?). Nothing applied.', c_id;
  END IF;
  IF v_p.slug IS DISTINCT FROM 'crunchy-express' OR v_p.is_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Row % is slug=% is_active=% — expected crunchy-express, inactive. Nothing applied.', c_id, v_p.slug, v_p.is_active;
  END IF;
  IF (v_p.address IS NOT NULL AND v_p.address IS DISTINCT FROM 'Tanzimat Sokak, Mahmut Paşa, No: 144-150, Dış Kapı No: 5, Lefkoşa')
     OR (v_p.region IS NOT NULL AND v_p.region IS DISTINCT FROM 'nicosia')
     OR (v_p.phone IS NOT NULL AND v_p.phone IS DISTINCT FROM NULL)
     OR (v_p.whatsapp IS NOT NULL AND v_p.whatsapp IS DISTINCT FROM NULL)
     OR (v_p.opening_hours IS NOT NULL AND v_p.opening_hours IS DISTINCT FROM '{"mon": {"open": "11:30", "close": "23:59"}, "tue": {"open": "11:30", "close": "23:59"}, "wed": {"open": "11:30", "close": "23:59"}, "thu": {"open": "11:15", "close": "23:59"}, "fri": {"open": "11:30", "close": "23:59"}, "sat": {"open": "11:30", "close": "23:59"}, "sun": {"open": "15:30", "close": "23:59"}}'::jsonb)
     OR (v_p.menu_verified_on IS NOT NULL AND v_p.menu_verified_on IS DISTINCT FROM DATE '2026-10-19')
     OR (v_p.lat IS NOT NULL AND (v_p.lat, v_p.lng, v_p.geocode_source) IS DISTINCT FROM (35.179003::double precision, 33.35745::double precision, 'partner'::text)) THEN
    RAISE EXCEPTION 'crunchy-express already holds different details (address=%, region=%, phone=%, whatsapp=%, hours=%, menu_verified_on=%, pin=%,% %). Nothing applied.',
      v_p.address, v_p.region, v_p.phone, v_p.whatsapp, v_p.opening_hours, v_p.menu_verified_on, v_p.lat, v_p.lng, v_p.geocode_source;
  END IF;

  IF jsonb_array_length(v_menu) IS DISTINCT FROM 41 THEN
    RAISE EXCEPTION 'menu literal has % items, expected 41', jsonb_array_length(v_menu);
  END IF;

  -- ── Partner details ──
  UPDATE public.eatery_partners
     SET address = 'Tanzimat Sokak, Mahmut Paşa, No: 144-150, Dış Kapı No: 5, Lefkoşa', region = 'nicosia', phone = NULL, whatsapp = NULL,
         opening_hours = '{"mon": {"open": "11:30", "close": "23:59"}, "tue": {"open": "11:30", "close": "23:59"}, "wed": {"open": "11:30", "close": "23:59"}, "thu": {"open": "11:15", "close": "23:59"}, "fri": {"open": "11:30", "close": "23:59"}, "sat": {"open": "11:30", "close": "23:59"}, "sun": {"open": "15:30", "close": "23:59"}}'::jsonb, menu_verified_on = DATE '2026-10-19',
         lat = 35.179003, lng = 33.35745, geocode_source = 'partner', updated_at = now()
   WHERE id = c_id AND is_active = false;

  -- ── Menu: insert into an empty menu, or accept exactly this menu already present ──
  SELECT count(*) INTO v_before FROM public.eatery_menu_items WHERE partner_id = c_id;
  IF v_before = 0 THEN
    INSERT INTO public.eatery_menu_items (partner_id, section, section_order, name, description, price, currency, sort_order)
    SELECT c_id, m.section, m.section_order, m.name, m.description, m.price, 'TRY', m.sort_order
      FROM jsonb_to_recordset(v_menu) AS m(section text, section_order int, name text, description text, price numeric, sort_order int);
  ELSE
    SELECT count(DISTINCT i.id) INTO v_same
      FROM jsonb_to_recordset(v_menu) AS m(section text, section_order int, name text, description text, price numeric, sort_order int)
      JOIN public.eatery_menu_items i
        ON i.partner_id = c_id AND i.section = m.section AND i.section_order = m.section_order AND i.name = m.name
       AND i.description IS NOT DISTINCT FROM m.description AND i.price = m.price AND i.currency = 'TRY' AND i.sort_order = m.sort_order;
    IF v_before IS DISTINCT FROM 41 OR v_same IS DISTINCT FROM 41 THEN
      RAISE EXCEPTION 'crunchy-express already has % menu items (% match this file) — expected 0 or exactly these 41. Nothing applied.', v_before, v_same;
    END IF;
    RAISE NOTICE 'menu already present (% items, all match): no insert', v_before;
  END IF;

  -- ── Post-state ──
  SELECT count(*), count(DISTINCT section) INTO v_after, v_secs FROM public.eatery_menu_items WHERE partner_id = c_id;
  IF v_after IS DISTINCT FROM 41 OR v_secs IS DISTINCT FROM 8 THEN
    RAISE EXCEPTION 'after: % items in % sections, expected 41 in 8', v_after, v_secs;
  END IF;
  IF EXISTS (SELECT 1 FROM public.eatery_menu_items WHERE partner_id = c_id AND (price IS NULL OR is_available IS DISTINCT FROM true OR (photo_path IS NOT NULL AND v_before = 0))) THEN
    RAISE EXCEPTION 'after: an item has no price, is unavailable, or a fresh insert carries a photo';
  END IF;
  SELECT * INTO v_p FROM public.eatery_partners WHERE id = c_id;
  IF v_p.is_active IS DISTINCT FROM false OR v_p.menu_verified_on IS DISTINCT FROM DATE '2026-10-19'
     OR v_p.lat IS DISTINCT FROM 35.179003::double precision OR v_p.lng IS DISTINCT FROM 33.35745::double precision
     OR v_p.geocode_source IS DISTINCT FROM 'partner' OR v_p.logo_path IS NOT NULL THEN
    RAISE EXCEPTION 'after: is_active=% menu_verified_on=% pin=%,% (%) logo_path=% — expected false / %, the partner pin, no logo',
      v_p.is_active, v_p.menu_verified_on, v_p.lat, v_p.lng, v_p.geocode_source, v_p.logo_path, DATE '2026-10-19';
  END IF;

  -- ── Still invisible to every client role (postgres above is the positive control: 41 rows) ──
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_anon_p FROM public.eatery_partners WHERE id = c_id;
  SELECT count(*) INTO v_anon_i FROM public.eatery_menu_items WHERE partner_id = c_id;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_auth_p FROM public.eatery_partners WHERE id = c_id;
  SELECT count(*) INTO v_auth_i FROM public.eatery_menu_items WHERE partner_id = c_id;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF v_anon_p <> 0 OR v_anon_i <> 0 OR v_auth_p <> 0 OR v_auth_i <> 0 THEN
    RAISE EXCEPTION 'inactive partner is VISIBLE: anon %/% authenticated %/% (partner/items)', v_anon_p, v_anon_i, v_auth_p, v_auth_i;
  END IF;

  RAISE NOTICE 'crunchy-express: % items in % sections, menu_verified_on %, inactive; anon 0/0, authenticated 0/0',
    v_after, v_secs, v_p.menu_verified_on;
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
VALUES ('20261117_crunchy_express_data.sql', 'c083e0f66ff944eefb66d60ee03fab4cac7832d01649dd695782fc0afb1dbdbc')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: the 20261117_crunchy_express_data row must read OK.
--
-- ─── Rollback (only if this data is abandoned; the partner row stays) ──
--   ⚠ Deleting the items also drops any dish photo_path set by eatery-images after this file (objects stay in the bucket).
--   DELETE FROM public.eatery_menu_items WHERE partner_id = 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434';
--   UPDATE public.eatery_partners SET address = NULL, region = NULL, phone = NULL, whatsapp = NULL,
--     opening_hours = NULL, menu_verified_on = NULL, lat = NULL, lng = NULL, geocode_source = NULL WHERE id = 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434' AND is_active = false;

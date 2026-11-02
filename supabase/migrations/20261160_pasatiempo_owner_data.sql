-- ═══════════════════════════════════════════════════════════════════════════
-- 20261160 — Pasatiempo: street address + owner pin, and its own item ids (partner_item_id) for all 83 dishes
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DATA ONLY. Pasatiempo stays is_active = false (asserted); no other partner or item changes (asserted by md5).
--
-- SOURCE (Berke, 2026-11-02, the owner's answer to the address question):
--   address 'Asmaaltı Sk, Lefkoşa 99010'; pin 35.177221, 33.362076 (owner via Berke; geocode_source stays 'partner',
--   ~15 m from the site's own config/site.center that 20261158 stored). maps_url is rebuilt from the new pin.
--   partner_item_id: the ids of pasatiempocy.com's own menu database (Firestore collection items), read 2026-11-02 together
--   with the menu 20261158 seeded; matched to our rows by dish NAME (unique within the partner, asserted). They change if the
--   owner deletes and re-creates a dish on their site; the 30-day menu staleness alarm does not watch them.
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   UNCHANGED; no policy or grant is touched. The row stays invisible to production (is_active = false); the ADA Preview key
--   sees it. Writes service_role / postgres only. A restaurant's published details and dish ids; no personal data.
--
-- Apply AFTER 20261159 (same run). Data only: no NOTIFY pgrst.
-- Re-runnable: a second apply finds every value in place (asserted) and changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  c_slug  constant text := 'pasatiempo';
  c_addr  constant text := 'Asmaaltı Sk, Lefkoşa 99010';
  c_lat   constant double precision := 35.177221;
  c_lng   constant double precision := 33.362076;
  c_maps  constant text := 'https://www.google.com/maps?q=35.177221,33.362076';
  v_ids   constant jsonb := $ids$
  [
    {"name": "Aperol Spritz", "id": "imu48g8ab76ue3"},
    {"name": "Bacon Smash Burger", "id": "imu48g3m8n53wk"},
    {"name": "Becks", "id": "imu48g9h73k899"},
    {"name": "Beer Platter for 2 person", "id": "imued6avr69t04"},
    {"name": "Beer Platter for 3 person", "id": "imu8i8jqjl8h3x"},
    {"name": "Beer Platter for 4 person", "id": "imu48g6krxqdqa"},
    {"name": "Beer plater 2 person", "id": "imucxqtmdqmuht"},
    {"name": "Belfast", "id": "imu48g9knk7wh8"},
    {"name": "Beylerbeyi", "id": "imu48g99gqlh8h"},
    {"name": "Black Gold Porter", "id": "imu48gajw775tg"},
    {"name": "Bomonti", "id": "imu48g9sdkkmr0"},
    {"name": "Brandy Sour", "id": "imu48g7shsazs0"},
    {"name": "Caramelised Onion Smash Burger", "id": "imu48g3wojdhe0"},
    {"name": "Chicken Tenders", "id": "imu48g71cyqx9f"},
    {"name": "Coca Cola", "id": "imu6xr5v4id0ky"},
    {"name": "Coca Cola Zero", "id": "imu6xso8rcitau"},
    {"name": "Coincidence *", "id": "imu48g8ji3wmki"},
    {"name": "Corona", "id": "imu48ga0twpled"},
    {"name": "Crafters IPA", "id": "imu48ga44qwhle"},
    {"name": "Crispy Chicken Bowl", "id": "imu48g2rx919y0"},
    {"name": "Crispy Chicken Burger", "id": "imu48g487hp6yj"},
    {"name": "Crispy Chicken Garlic Burger", "id": "imu48g4dvljvjv"},
    {"name": "Crispy Chicken Wrap", "id": "imu48g4y38ne62"},
    {"name": "Cucumbeer *", "id": "imu48g8nuqnml2"},
    {"name": "Cucumber Goose", "id": "imu48gaoozsxwh"},
    {"name": "Double Dunkel", "id": "imu48ga7xczewc"},
    {"name": "Efe", "id": "imu48g9dh82jgz"},
    {"name": "Efes Malt", "id": "imu48g9opp24le"},
    {"name": "Efes Özel Seri", "id": "imu48g9w36xqxk"},
    {"name": "Espresso Martini", "id": "imu48g8f9acdf4"},
    {"name": "Fajita Wrap", "id": "imu48g52c7rsj4"},
    {"name": "Falafel Pita", "id": "imu48g5wxzku3v"},
    {"name": "Falafel Wrap", "id": "imu48g57sa5dpu"},
    {"name": "Fanta", "id": "imu6y5ms9cen40"},
    {"name": "Fries", "id": "imu48g6xqa19y1"},
    {"name": "Fues tea Seftali", "id": "imufrz3xhk0sp8"},
    {"name": "Fues tea limon", "id": "imufs1sqfavur2"},
    {"name": "Garlic Aioli Smash Burger", "id": "imu48g40xxvjky"},
    {"name": "Gin (Ne istersen)", "id": "imuioyzzwg1o95"},
    {"name": "Grilled Chicken Bowl", "id": "imu48g2htwr7ih"},
    {"name": "Grilled Chicken Burger", "id": "imu48g4id97vgh"},
    {"name": "Grilled Chicken Combo Bowl", "id": "imu48g2nutzjsk"},
    {"name": "Grilled Chicken Pita", "id": "imu48g5t103wf8"},
    {"name": "Grilled Chicken Wrap", "id": "imu48g4t9zmawn"},
    {"name": "Grilled Meatball Pita", "id": "imu48g5mgdkpqv"},
    {"name": "JIN Tonic", "id": "imu8j5ha0erb7a"},
    {"name": "Lemonade", "id": "imu6ybvy1u03am"},
    {"name": "Magrita", "id": "imuio1u49d2lsx"},
    {"name": "Martini", "id": "imuiqwmx3mbaps"},
    {"name": "Meatball Bowl", "id": "imu48g2wys1prr"},
    {"name": "Meatball Combo Bowl", "id": "imu48g30fuk51x"},
    {"name": "Mezze Platter", "id": "imu48g6fysc4c1"},
    {"name": "Miller", "id": "imu8ieypytub5b"},
    {"name": "Mojito", "id": "imu48g7mc79zok"},
    {"name": "Mozzarella Sticks", "id": "imu48g7gpspu3l"},
    {"name": "Munchie Fries", "id": "imu48g6srdp5fl"},
    {"name": "Mushroom Skewers", "id": "imu48g75r3j0az"},
    {"name": "Mushroom Skewers Pita", "id": "imu48g6297nrhx"},
    {"name": "Mushroom Smash Burger", "id": "imu48g3rh9d3vw"},
    {"name": "Mushrooms & Falafel Bowl", "id": "imu48g36aerzcq"},
    {"name": "Mushrooms Wrap", "id": "imu48g5b9353p4"},
    {"name": "Negroni", "id": "imu48g81wvu1xg"},
    {"name": "Nottingham Pale Ale", "id": "imu48gab4nllkj"},
    {"name": "Nova Lager", "id": "imu48gafep4h55"},
    {"name": "Old Fashioned", "id": "imu48g86e1biaw"},
    {"name": "Onion Rings", "id": "imu48g7bdawfjj"},
    {"name": "Red Wine", "id": "imu48g8s35zv4w"},
    {"name": "Rosé Wine", "id": "imu48g90q4112f"},
    {"name": "Smash Burger Wrap", "id": "imu48g4o3l5fw8"},
    {"name": "Smash Cheeseburger", "id": "imu48g3e10d4im"},
    {"name": "Smash Felafel& Mushroom Burger", "id": "imu48g44w0bf8b"},
    {"name": "Soda", "id": "imu6y7h2gtfmku"},
    {"name": "Sprite", "id": "imu6y3ae8rgp5r"},
    {"name": "Stella", "id": "imub07vjwusxyc"},
    {"name": "Tekirdağ", "id": "imu48g9506o4c8"},
    {"name": "Umami Pita", "id": "imu48g66qiy5f7"},
    {"name": "Umami Wrap", "id": "imu48g5hizwhkk"},
    {"name": "Water", "id": "imu6yeex3op4zh"},
    {"name": "Whiskey", "id": "imu48gaxxbwu4t"},
    {"name": "Whiskey Sour", "id": "imu48g7y78wk17"},
    {"name": "White Wine", "id": "imu48g8w0129wz"},
    {"name": "Zivania", "id": "imu48gatqn726l"},
    {"name": "pulled mushroom burger", "id": "imufor3tvuozkr"}
  ]
  $ids$;
  v_p public.eatery_partners%ROWTYPE;
  v_n int; v_before text; v_after text; v_ibefore text; v_iafter text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261159_eatery_menu_items_partner_item_id.sql') THEN
    RAISE EXCEPTION '20261159 is not in the ledger: apply it first. Nothing applied.';
  END IF;
  SELECT * INTO v_p FROM public.eatery_partners WHERE slug = c_slug;
  IF NOT FOUND OR v_p.is_active IS DISTINCT FROM false OR to_jsonb(v_p)->>'order_method' IS DISTINCT FROM 'website' THEN
    RAISE EXCEPTION 'pasatiempo missing, active or not a website partner: %. Nothing applied.', to_jsonb(v_p);
  END IF;
  IF jsonb_array_length(v_ids) IS DISTINCT FROM 83
     OR (SELECT count(DISTINCT e->>'name') FROM jsonb_array_elements(v_ids) e) IS DISTINCT FROM 83::bigint
     OR (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(v_ids) e) IS DISTINCT FROM 83::bigint THEN
    RAISE EXCEPTION 'the id list is not 83 distinct names -> 83 distinct ids. Nothing applied.';
  END IF;
  -- Every name matches exactly one Pasatiempo row, and Pasatiempo has no row outside the list.
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_ids) e
   WHERE (SELECT count(*) FROM public.eatery_menu_items i WHERE i.partner_id = v_p.id AND i.name = e->>'name') IS DISTINCT FROM 1::bigint;
  IF v_n <> 0 OR (SELECT count(*) FROM public.eatery_menu_items WHERE partner_id = v_p.id) IS DISTINCT FROM 83::bigint THEN
    RAISE EXCEPTION '% listed name(s) do not match exactly one pasatiempo item, or pasatiempo does not have 83 items. Nothing applied.', v_n;
  END IF;

  SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, ',' ORDER BY p.id), '')) INTO v_before FROM public.eatery_partners p WHERE p.id <> v_p.id;
  SELECT md5(COALESCE(string_agg(to_jsonb(i)::text, ',' ORDER BY i.id), '')) INTO v_ibefore FROM public.eatery_menu_items i WHERE i.partner_id <> v_p.id;

  UPDATE public.eatery_partners SET address = c_addr, lat = c_lat, lng = c_lng, geocode_source = 'partner', maps_url = c_maps, updated_at = now()
   WHERE id = v_p.id AND (address IS DISTINCT FROM c_addr OR lat IS DISTINCT FROM c_lat OR lng IS DISTINCT FROM c_lng OR maps_url IS DISTINCT FROM c_maps);
  UPDATE public.eatery_menu_items i SET partner_item_id = e->>'id'
    FROM jsonb_array_elements(v_ids) e
   WHERE i.partner_id = v_p.id AND i.name = e->>'name' AND i.partner_item_id IS DISTINCT FROM e->>'id';

  -- Post-state.
  SELECT * INTO v_p FROM public.eatery_partners WHERE slug = c_slug;
  IF v_p.address IS DISTINCT FROM c_addr OR v_p.lat IS DISTINCT FROM c_lat OR v_p.lng IS DISTINCT FROM c_lng
     OR v_p.geocode_source IS DISTINCT FROM 'partner' OR v_p.maps_url IS DISTINCT FROM c_maps OR v_p.is_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'after: pasatiempo row is %', to_jsonb(v_p);
  END IF;
  SELECT count(*) INTO v_n FROM public.eatery_menu_items i JOIN jsonb_array_elements(v_ids) e ON e->>'name' = i.name
   WHERE i.partner_id = v_p.id AND to_jsonb(i)->>'partner_item_id' = e->>'id';
  IF v_n IS DISTINCT FROM 83 THEN
    RAISE EXCEPTION 'after: % of 83 pasatiempo items carry their listed id', v_n;
  END IF;
  SELECT md5(COALESCE(string_agg(to_jsonb(p)::text, ',' ORDER BY p.id), '')) INTO v_after FROM public.eatery_partners p WHERE p.id <> v_p.id;
  SELECT md5(COALESCE(string_agg(to_jsonb(i)::text, ',' ORDER BY i.id), '')) INTO v_iafter FROM public.eatery_menu_items i WHERE i.partner_id <> v_p.id;
  IF v_after IS DISTINCT FROM v_before OR v_iafter IS DISTINCT FROM v_ibefore THEN
    RAISE EXCEPTION 'after: another partner or its menu changed. Nothing applied.';
  END IF;
  RAISE NOTICE 'pasatiempo: address + owner pin set, 83/83 partner_item_id, still inactive; other partners unchanged';
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
VALUES ('20261160_pasatiempo_owner_data.sql', '867f7a7ef5fc302ef7aea920a2f85afedf86e211daff77fd62a6f4187619cc1c')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

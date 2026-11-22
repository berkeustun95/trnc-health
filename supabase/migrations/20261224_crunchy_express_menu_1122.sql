-- ═══════════════════════════════════════════════════════════════════════════
-- 20261224 — Crunchy Express menu update: 3 prices, 5 new dishes, new "Hot Dogs" section, menu_verified_on 2026-11-22
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DATA ONLY: no schema, policy or grant change. Crunchy is LIVE (is_active = true since 20261127) and stays live.
-- SOURCE: Berke's phone screenshots of Crunchy's Yemeksepeti listing, 2026-11-22 20:40 (51 dishes, 10 sections).
-- Diff against the 46 live dishes (20261122 + 20261124): every other name and price matches; nothing removed.
--   Prices      Acılı Soğan Halkası (8 Adet) 150 → 200 · Acılı Soğan Halkası (12 Adet) 220 → 280 · Nutella Smash 200 → 250
--   New         Beef Burgers: Cypriot Smash Burger 850 (last) · Vejetaryen Burgerler: Vegan Semi Smash Burger 750 (after Veggy)
--               Hot Dogs (new section, between Nachos and Yan Ürünler): Hot Dog Bacon Wrapped 490, Trüf Mayonezli Hot Dog 490,
--               Barbekü Soslu Hot Dog 490
--   Kept        "Crunchy Pineapple Sos" (Yemeksepeti shows "Pinapple", their typo; Berke 2026-11-22). Drinks keep "(33 cl.)".
-- Descriptions as Yemeksepeti shows them. Two are cut off on screen; only the readable part is stored, cut at the last
-- complete ingredient, nothing invented: Cypriot ("…salatalık turşusu, crunchy bikla may…" → ends at "salatalık turşusu")
-- and Bacon Wrapped (the trailing "(Domuz e…" is dropped; the pork stays visible in its opening "Domuz bacona sarılmış
-- sosis"). Obvious typos fixed as before: "bacons" → "bacona", "kızarması" → "kızartması".
-- Dish-finder tags (20261123 columns; NULL = never suggested by the quiz): Cypriot main/beef/not spicy/meal; Vegan
-- main/veg/not spicy/meal; Bacon Wrapped main/pork/not spicy/meal (the quiz shows its pork badge). Trüf Mayonezli and
-- Barbekü Soslu hot dogs stay UNTAGGED: the screenshots do not say what the sausage is, so they are never suggested
-- (a guessed "beef" could put a pork sausage in front of someone who avoids pork) until the owner confirms.
-- No item options on the new dishes (none known), no photos (the menu shows dishes without a photo already).
--
-- menu_verified_on = 2026-11-22. WHAT IT RESTS ON: prices and the dish list compared against Yemeksepeti screenshots;
-- opening hours and the 19 paid extras confirmed by Berke's word, not compared; four screenshot gaps (chicken between Hot
-- Honey Glazed and Cheeseme, beef between BBQ Smash and Trüf Smash, hot dogs between Trüf Mayonezli and Barbekü Soslu,
-- desserts after Nutella Smash) not checked for further new dishes.
--
-- The full 51-row target is asserted: every existing row must match its name and section and either its old (pre-
-- 2026-11-22) or new price; anything else raises. New rows are inserted only if absent; section_order / sort_order follow
-- Yemeksepeti. Nothing is deleted, so photo_path and item options survive. RE-RUNNABLE: a second run changes nothing.
--
-- WHO CAN READ / WRITE: unchanged (20261115 + 20261119/1120 policies). Live ⇒ everyone (anon included) reads the menu,
-- asserted below (51 rows). Writes: service_role / migrations only.
--
-- Apply: gh workflow run supabase-migrate -f file=20261224_crunchy_express_menu_1122.sql (dry), then
-- -f apply=true (Berke approves production-db).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  c_id   constant uuid := 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434';
  -- [section, section_order, sort_order, name, price, old price accepted before this file (NULL = same / new row)]
  v_target constant jsonb := $t$[
    ["Chicken Burgerler",1,1,"Crunchy Burger",620,null],
    ["Chicken Burgerler",1,2,"Crunchy BBQ Chicken Burger",650,null],
    ["Chicken Burgerler",1,3,"Pineapple Chicken Burger",650,null],
    ["Chicken Burgerler",1,4,"Nashville Tavuk Burger",650,null],
    ["Chicken Burgerler",1,5,"Truffle Chicken Burger",680,null],
    ["Chicken Burgerler",1,6,"Buffalo Chicken Burger",680,null],
    ["Chicken Burgerler",1,7,"Chipotle Chicken Burger",680,null],
    ["Chicken Burgerler",1,8,"Hot Honey Glazed Chicken Burger",680,null],
    ["Chicken Burgerler",1,9,"Cheeseme Chicken Burger",680,null],
    ["Chicken Burgerler",1,10,"TNT Chicken Burger",680,null],
    ["Beef Burgers",2,1,"Express Smash Burger",820,null],
    ["Beef Burgers",2,2,"BBQ Smash Burger",860,null],
    ["Beef Burgers",2,3,"Trüf Smash Burger",890,null],
    ["Beef Burgers",2,4,"Big Pork Smash Burger",890,null],
    ["Beef Burgers",2,5,"Jalapeño Drip Smash Burger",860,null],
    ["Beef Burgers",2,6,"Cypriot Smash Burger",850,null],
    ["Crunchy Box Menüleri",3,1,"Crunchy Box",650,null],
    ["Crunchy Box Menüleri",3,2,"Crunchy Box XL",870,null],
    ["Crunchy Box Menüleri",3,3,"Crunchy Box XXL",1090,null],
    ["Crunchy Box Menüleri",3,4,"Crunchy Kids Box",450,null],
    ["Vejetaryen Burgerler",4,1,"Veggy Smash Burger",700,null],
    ["Vejetaryen Burgerler",4,2,"Vegan Semi Smash Burger",750,null],
    ["Nachos",5,1,"Crunchy Classic Nachos",490,null],
    ["Nachos",5,2,"Buffalo Nachos",490,null],
    ["Nachos",5,3,"Hot Honey Nachos",490,null],
    ["Hot Dogs",6,1,"Hot Dog Bacon Wrapped",490,null],
    ["Hot Dogs",6,2,"Trüf Mayonezli Hot Dog",490,null],
    ["Hot Dogs",6,3,"Barbekü Soslu Hot Dog",490,null],
    ["Yan Ürünler",7,1,"Mozzarella Sticks (6 Adet)",300,null],
    ["Yan Ürünler",7,2,"4'lü Mozzarella Sticks",220,null],
    ["Yan Ürünler",7,3,"Acılı Soğan Halkası (8 Adet)",200,150],
    ["Yan Ürünler",7,4,"Acılı Soğan Halkası (12 Adet)",280,220],
    ["Yan Ürünler",7,5,"Patates Kızartması",170,null],
    ["Yan Ürünler",7,6,"Hot Honey Glazed Halloumi",300,null],
    ["Yan Ürünler",7,7,"Nashville Sticks (6 Adet)",340,null],
    ["Soslar",8,1,"Crunchy Özel Sos",65,null],
    ["Soslar",8,2,"Eritilmiş Peynir Sos",110,null],
    ["Soslar",8,3,"Sweet Chili Sos",65,null],
    ["Soslar",8,4,"Crunchy BBQ Sos",65,null],
    ["Soslar",8,5,"Crunchy Buffalo Sos",65,null],
    ["Soslar",8,6,"Crunchy Trüf Sos",70,null],
    ["Soslar",8,7,"Crunchy Ranch Sos",65,null],
    ["Soslar",8,8,"Crunchy Pineapple Sos",65,null],
    ["Soslar",8,9,"Crunchy Hot Mayo",65,null],
    ["Soslar",8,10,"Crunchy Coslow",70,null],
    ["Tatlılar",9,1,"Nutella Smash",250,200],
    ["İçecekler",10,1,"Coca-Cola Zero Sugar (33 cl.)",70,null],
    ["İçecekler",10,2,"Coca-Cola (33 cl.)",70,null],
    ["İçecekler",10,3,"Fanta (33 cl.)",70,null],
    ["İçecekler",10,4,"Sprite (33 cl.)",70,null],
    ["İçecekler",10,5,"Fuse Tea (33 cl.)",70,null]
  ]$t$::jsonb;
  -- [name, description, role, protein, spicy, portion] — the 5 new rows; role NULL = untagged (never in the quiz)
  v_new_rows constant jsonb := $n$[
    ["Cypriot Smash Burger","Özel çörek ekmeği arasına; smash burger köftesi, hellim peyniri, soğan, salatalık turşusu","main","beef",false,"meal"],
    ["Vegan Semi Smash Burger","Vegan burger köftesi, vegan ekmek, turşu, hardal, ketçap","main","veg",false,"meal"],
    ["Hot Dog Bacon Wrapped","Domuz bacona sarılmış sosis, hardal sos, ketçap, turşu, çiğ soğan, kaşar peyniri, patates kızartması","main","pork",false,"meal"],
    ["Trüf Mayonezli Hot Dog","Eritilmiş peynir, trüf mayonez, parmesan peyniri, dana bacon, soğan. Patates kızartması ile",null,null,null,null],
    ["Barbekü Soslu Hot Dog","Çıtır soğan, turşu, eritilmiş peynir, barbekü sos. Patates kızartması ile",null,null,null,null]
  ]$n$::jsonb;
  v_p public.eatery_partners%ROWTYPE;
  v_n int; v_secs int; v_bad text; v_ins int := 0; r record; v_anon int; v_opts_before text; v_opts_after text;
BEGIN
  IF jsonb_array_length(v_target) IS DISTINCT FROM 51 THEN RAISE EXCEPTION 'target has % rows, expected 51', jsonb_array_length(v_target); END IF;
  IF jsonb_array_length(v_new_rows) IS DISTINCT FROM 5 THEN RAISE EXCEPTION 'new rows: %, expected 5', jsonb_array_length(v_new_rows); END IF;

  SELECT * INTO v_p FROM public.eatery_partners WHERE id = c_id;
  IF NOT FOUND OR v_p.slug IS DISTINCT FROM 'crunchy-express' OR v_p.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'crunchy-express missing or not live (slug %, is_active %). Nothing applied.', v_p.slug, v_p.is_active;
  END IF;

  -- Pre-state: every row is a target row (same section and name) at its new price or its listed old price.
  SELECT string_agg(format('%s › %s %s', i.section, i.name, i.price), '; ') INTO v_bad
    FROM public.eatery_menu_items i
    LEFT JOIN jsonb_array_elements(v_target) t
      ON i.section = t->>0 AND i.name = t->>3
     AND (i.price = (t->>4)::numeric OR i.price = (t->>5)::numeric)
   WHERE i.partner_id = c_id AND t IS NULL;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'items not in the 2026-11-22 menu (name/section/price drift): %. Nothing applied.', v_bad; END IF;
  SELECT string_agg(i.name, ', ') INTO v_bad FROM public.eatery_menu_items i WHERE i.partner_id = c_id AND i.is_available IS DISTINCT FROM true;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'items marked unavailable: %. Nothing applied.', v_bad; END IF;
  SELECT count(*) INTO v_n FROM public.eatery_menu_items WHERE partner_id = c_id;
  IF v_n NOT IN (46, 51) THEN RAISE EXCEPTION 'crunchy-express has % items, expected 46 (live) or 51 (re-run)', v_n; END IF;

  SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s', o.item_id, o.kind, o.label_i18n, o.price, o.sort_order, o.is_available), ';' ORDER BY o.id), ''))
    INTO v_opts_before
    FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;

  -- New rows (only if absent).
  FOR r IN SELECT t->>0 AS section, (t->>1)::int AS so, (t->>2)::int AS ord, t->>3 AS name, (t->>4)::numeric AS price,
                  n->>1 AS descr, n->>2 AS role, n->>3 AS protein, (n->>4)::boolean AS spicy, n->>5 AS portion
             FROM jsonb_array_elements(v_target) t JOIN jsonb_array_elements(v_new_rows) n ON n->>0 = t->>3 LOOP
    IF NOT EXISTS (SELECT 1 FROM public.eatery_menu_items WHERE partner_id = c_id AND name = r.name) THEN
      INSERT INTO public.eatery_menu_items (partner_id, section, section_order, name, description, price, currency, sort_order,
                                            role, protein, spicy, portion)
      VALUES (c_id, r.section, r.so, r.name, r.descr, r.price, 'TRY', r.ord, r.role, r.protein, r.spicy, r.portion);
      v_ins := v_ins + 1;
    END IF;
  END LOOP;
  IF v_ins NOT IN (0, 5) THEN RAISE EXCEPTION 'inserted % new rows, expected 5 (first run) or 0 (re-run)', v_ins; END IF;

  -- Prices and order exactly as Yemeksepeti on 2026-11-22.
  UPDATE public.eatery_menu_items i
     SET price = (t->>4)::numeric, section_order = (t->>1)::int, sort_order = (t->>2)::int
    FROM jsonb_array_elements(v_target) t
   WHERE i.partner_id = c_id AND i.section = t->>0 AND i.name = t->>3
     AND (i.price IS DISTINCT FROM (t->>4)::numeric OR i.section_order IS DISTINCT FROM (t->>1)::int OR i.sort_order IS DISTINCT FROM (t->>2)::int);

  UPDATE public.eatery_partners SET menu_verified_on = DATE '2026-11-22', updated_at = now()
   WHERE id = c_id AND menu_verified_on IS DISTINCT FROM DATE '2026-11-22';

  -- Post-state: exactly the 51 target rows, one each, in order, with their prices; 10 sections; the 5 new rows carry
  -- their description and tags; options and photos untouched; still live; anon reads all 51.
  SELECT count(*), count(DISTINCT section) INTO v_n, v_secs FROM public.eatery_menu_items WHERE partner_id = c_id;
  IF v_n IS DISTINCT FROM 51 OR v_secs IS DISTINCT FROM 10 THEN RAISE EXCEPTION 'after: % items in % sections, expected 51 in 10', v_n, v_secs; END IF;
  SELECT string_agg(t->>3, ', ') INTO v_bad
    FROM jsonb_array_elements(v_target) t
   WHERE (SELECT count(*) FROM public.eatery_menu_items i
           WHERE i.partner_id = c_id AND i.section = t->>0 AND i.name = t->>3 AND i.price = (t->>4)::numeric AND i.currency = 'TRY'
             AND i.section_order = (t->>1)::int AND i.sort_order = (t->>2)::int AND i.is_available) IS DISTINCT FROM 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'after: target rows not matched exactly once: %', v_bad; END IF;
  SELECT string_agg(n->>0, ', ') INTO v_bad
    FROM jsonb_array_elements(v_new_rows) n
   WHERE NOT EXISTS (SELECT 1 FROM public.eatery_menu_items i
                      WHERE i.partner_id = c_id AND i.name = n->>0 AND i.description IS NOT DISTINCT FROM n->>1
                        AND i.role IS NOT DISTINCT FROM n->>2 AND i.protein IS NOT DISTINCT FROM n->>3
                        AND i.spicy IS NOT DISTINCT FROM (n->>4)::boolean AND i.portion IS NOT DISTINCT FROM n->>5
                        AND i.photo_path IS NULL AND i.adult_only IS NOT DISTINCT FROM false);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'after: new rows differ from their description/tags: %', v_bad; END IF;
  SELECT count(*) FILTER (WHERE role IS NOT NULL), count(*) FILTER (WHERE role = 'main') INTO v_n, v_secs
    FROM public.eatery_menu_items WHERE partner_id = c_id;
  IF v_n IS DISTINCT FROM 49 OR v_secs IS DISTINCT FROM 29 THEN RAISE EXCEPTION 'after: % tagged / % mains, expected 49 / 29', v_n, v_secs; END IF;
  IF (SELECT count(*) FROM public.eatery_menu_items WHERE partner_id = c_id AND photo_path IS NOT NULL) < 30 THEN
    RAISE EXCEPTION 'after: fewer than the 30 existing dish photos remain';
  END IF;
  SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s|%s', o.item_id, o.kind, o.label_i18n, o.price, o.sort_order, o.is_available), ';' ORDER BY o.id), ''))
    INTO v_opts_after
    FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;
  IF v_opts_after IS DISTINCT FROM v_opts_before THEN RAISE EXCEPTION 'after: item options changed'; END IF;
  SELECT * INTO v_p FROM public.eatery_partners WHERE id = c_id;
  IF v_p.is_active IS DISTINCT FROM true OR v_p.menu_verified_on IS DISTINCT FROM DATE '2026-11-22' THEN
    RAISE EXCEPTION 'after: is_active=% menu_verified_on=%', v_p.is_active, v_p.menu_verified_on;
  END IF;

  -- Live: anon (no JWT, no request headers) reads the whole menu.
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.headers', '', true);
  SELECT count(*) INTO v_anon FROM public.eatery_menu_items WHERE partner_id = c_id;
  RESET ROLE;
  IF v_anon IS DISTINCT FROM 51 THEN RAISE EXCEPTION 'anon reads % menu rows, expected 51', v_anon; END IF;

  RAISE NOTICE 'crunchy-express menu: 51 items / 10 sections (% new), menu_verified_on 2026-11-22, live, anon 51', v_ins;
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
VALUES ('20261224_crunchy_express_menu_1122.sql', '52270dc2cf04fdbb6a36a59bf76628e23105df084d07229f8bac98efbda85314')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: the 20261224_crunchy_express_menu_1122 row must read OK.
--
-- ─── Rollback (removes the 5 new rows and restores the 3 old prices; order and date stay) ──
--   DELETE FROM public.eatery_menu_items WHERE partner_id = 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434'
--     AND name IN ('Cypriot Smash Burger','Vegan Semi Smash Burger','Hot Dog Bacon Wrapped','Trüf Mayonezli Hot Dog','Barbekü Soslu Hot Dog');
--   UPDATE public.eatery_menu_items SET price = CASE name WHEN 'Acılı Soğan Halkası (8 Adet)' THEN 150
--     WHEN 'Acılı Soğan Halkası (12 Adet)' THEN 220 WHEN 'Nutella Smash' THEN 200 END
--    WHERE partner_id = 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434'
--      AND name IN ('Acılı Soğan Halkası (8 Adet)','Acılı Soğan Halkası (12 Adet)','Nutella Smash');

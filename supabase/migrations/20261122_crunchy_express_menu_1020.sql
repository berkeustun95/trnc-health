-- ═══════════════════════════════════════════════════════════════════════════
-- 20261122 — Crunchy Express menu update: 5 new dishes, new "Nachos" section, menu_verified_on 2026-10-20
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DATA ONLY: no schema, policy or grant change. Partner stays is_active = false.
-- SOURCE: Berke transcribed the full menu from his own phone's Yemeksepeti on 2026-10-20 (all items active):
-- 46 dishes in 9 sections. Diff against the 41 loaded by 20261117: every existing name and PRICE matches;
-- nothing removed. New:
--   Chicken Burgerler   Cheeseme Chicken Burger 680 (between Hot Honey Glazed and TNT)
--   Nachos (new section, between Vejetaryen Burgerler and Yan Ürünler)
--                       Crunchy Classic Nachos 490, Buffalo Nachos 490, Hot Honey Nachos 490
--   Soslar              Eritilmiş Peynir Sos 110 (after Crunchy Özel Sos)
-- Obvious typos fixed as before: "jalapeno" → "jalapeño" (Classic Nachos), "cheddar peynir" → "cheddar peyniri"
-- (Buffalo Nachos). menu_verified_on = 2026-10-20 (Berke's transcription today).
--
-- The full 46-row target (section, order, name, price) is asserted: every existing item must match its name AND
-- price exactly (a price drift raises instead of being written silently), the 5 new rows are inserted only if
-- absent, then section_order / sort_order are set to Berke's order. Nothing is ever deleted, so dish photo_path
-- values survive. RE-RUNNABLE: a second run finds 46 matching rows and changes nothing.
--
-- WHO CAN READ / WRITE: unchanged (20261115 + 20261119/1120 policies). Inactive ⇒ only an is_previewer() request
-- (the ADA Preview app's key) can read it; anon / guests / users see nothing (asserted below). Writes: service_role.
--
-- Apply: gh workflow run supabase-migrate -f file=20261122_crunchy_express_menu_1020.sql (dry), then
-- -f apply=true (Berke approves production-db).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  c_id   constant uuid := 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434';
  -- [section, section_order, sort_order, name, price, description-if-new (NULL = existing row keeps its own)]
  v_target constant jsonb := $t$[
    ["Chicken Burgerler",1,1,"Crunchy Burger",620,null],
    ["Chicken Burgerler",1,2,"Crunchy BBQ Chicken Burger",650,null],
    ["Chicken Burgerler",1,3,"Pineapple Chicken Burger",650,null],
    ["Chicken Burgerler",1,4,"Nashville Tavuk Burger",650,null],
    ["Chicken Burgerler",1,5,"Truffle Chicken Burger",680,null],
    ["Chicken Burgerler",1,6,"Buffalo Chicken Burger",680,null],
    ["Chicken Burgerler",1,7,"Chipotle Chicken Burger",680,null],
    ["Chicken Burgerler",1,8,"Hot Honey Glazed Chicken Burger",680,null],
    ["Chicken Burgerler",1,9,"Cheeseme Chicken Burger",680,"3 adet tavuk tenders, eritilmiş kaşar peyniri sos, turşu, marul, ev yapımı mayonez. Patates kızartması ile"],
    ["Chicken Burgerler",1,10,"TNT Chicken Burger",680,null],
    ["Beef Burgers",2,1,"Express Smash Burger",820,null],
    ["Beef Burgers",2,2,"BBQ Smash Burger",860,null],
    ["Beef Burgers",2,3,"Trüf Smash Burger",890,null],
    ["Beef Burgers",2,4,"Big Pork Smash Burger",890,null],
    ["Beef Burgers",2,5,"Jalapeño Drip Smash Burger",860,null],
    ["Crunchy Box Menüleri",3,1,"Crunchy Box",650,null],
    ["Crunchy Box Menüleri",3,2,"Crunchy Box XL",870,null],
    ["Crunchy Box Menüleri",3,3,"Crunchy Box XXL",1090,null],
    ["Crunchy Box Menüleri",3,4,"Crunchy Kids Box",450,null],
    ["Vejetaryen Burgerler",4,1,"Veggy Smash Burger",700,null],
    ["Nachos",5,1,"Crunchy Classic Nachos",490,"Tavuk tenders, patates kızartması, eritilmiş cheddar peyniri, Crunchy özel sos, jalapeño biberi"],
    ["Nachos",5,2,"Buffalo Nachos",490,"Buffalo tavuk tenders, patates kızartması, eritilmiş cheddar peyniri, parmesan peyniri"],
    ["Nachos",5,3,"Hot Honey Nachos",490,"Tavuk tenders, patates kızartması, eritilmiş cheddar peyniri, Crunchy acı bal"],
    ["Yan Ürünler",6,1,"Mozzarella Sticks (6 Adet)",300,null],
    ["Yan Ürünler",6,2,"4'lü Mozzarella Sticks",220,null],
    ["Yan Ürünler",6,3,"Acılı Soğan Halkası (8 Adet)",150,null],
    ["Yan Ürünler",6,4,"Acılı Soğan Halkası (12 Adet)",220,null],
    ["Yan Ürünler",6,5,"Patates Kızartması",170,null],
    ["Yan Ürünler",6,6,"Hot Honey Glazed Halloumi",300,null],
    ["Yan Ürünler",6,7,"Nashville Sticks (6 Adet)",340,null],
    ["Soslar",7,1,"Crunchy Özel Sos",65,null],
    ["Soslar",7,2,"Eritilmiş Peynir Sos",110,"Tek kişilik"],
    ["Soslar",7,3,"Sweet Chili Sos",65,null],
    ["Soslar",7,4,"Crunchy BBQ Sos",65,null],
    ["Soslar",7,5,"Crunchy Buffalo Sos",65,null],
    ["Soslar",7,6,"Crunchy Trüf Sos",70,null],
    ["Soslar",7,7,"Crunchy Ranch Sos",65,null],
    ["Soslar",7,8,"Crunchy Pineapple Sos",65,null],
    ["Soslar",7,9,"Crunchy Hot Mayo",65,null],
    ["Soslar",7,10,"Crunchy Coslow",70,null],
    ["Tatlılar",8,1,"Nutella Smash",200,null],
    ["İçecekler",9,1,"Coca-Cola Zero Sugar (33 cl.)",70,null],
    ["İçecekler",9,2,"Coca-Cola (33 cl.)",70,null],
    ["İçecekler",9,3,"Fanta (33 cl.)",70,null],
    ["İçecekler",9,4,"Sprite (33 cl.)",70,null],
    ["İçecekler",9,5,"Fuse Tea (33 cl.)",70,null]
  ]$t$::jsonb;
  v_p public.eatery_partners%ROWTYPE;
  v_n int; v_secs int; v_bad text; v_new int := 0; r record; v_anon int;
BEGIN
  IF jsonb_array_length(v_target) IS DISTINCT FROM 46 THEN RAISE EXCEPTION 'target has % rows, expected 46', jsonb_array_length(v_target); END IF;

  SELECT * INTO v_p FROM public.eatery_partners WHERE id = c_id;
  IF NOT FOUND OR v_p.slug IS DISTINCT FROM 'crunchy-express' OR v_p.is_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'crunchy-express missing or not inactive (slug %, is_active %). Nothing applied.', v_p.slug, v_p.is_active;
  END IF;

  -- Pre-state: every row the partner has must be a target row with the same name in the same section and the same
  -- price (the 41 from 20261117, or all 46 on a re-run). Anything else = the menu changed under us → stop.
  SELECT string_agg(format('%s › %s %s', i.section, i.name, i.price), '; ') INTO v_bad
    FROM public.eatery_menu_items i
    LEFT JOIN jsonb_array_elements(v_target) t
      ON i.section = t->>0 AND i.name = t->>3 AND i.price = (t->>4)::numeric
   WHERE i.partner_id = c_id AND t IS NULL;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'items not in the 2026-10-20 menu (name/section/price drift): %. Nothing applied.', v_bad; END IF;
  SELECT count(*) INTO v_n FROM public.eatery_menu_items WHERE partner_id = c_id;
  IF v_n NOT IN (41, 46) THEN RAISE EXCEPTION 'crunchy-express has % items, expected 41 (20261117) or 46 (re-run)', v_n; END IF;

  -- New rows (only if absent).
  FOR r IN SELECT t->>0 AS section, (t->>1)::int AS so, (t->>2)::int AS ord, t->>3 AS name, (t->>4)::numeric AS price, t->>5 AS descr
             FROM jsonb_array_elements(v_target) t WHERE t->>5 IS NOT NULL LOOP
    IF NOT EXISTS (SELECT 1 FROM public.eatery_menu_items WHERE partner_id = c_id AND section = r.section AND name = r.name) THEN
      INSERT INTO public.eatery_menu_items (partner_id, section, section_order, name, description, price, currency, sort_order)
      VALUES (c_id, r.section, r.so, r.name, r.descr, r.price, 'TRY', r.ord);
      v_new := v_new + 1;
    END IF;
  END LOOP;

  -- Order exactly as Berke's list.
  UPDATE public.eatery_menu_items i
     SET section_order = (t->>1)::int, sort_order = (t->>2)::int
    FROM jsonb_array_elements(v_target) t
   WHERE i.partner_id = c_id AND i.section = t->>0 AND i.name = t->>3
     AND (i.section_order IS DISTINCT FROM (t->>1)::int OR i.sort_order IS DISTINCT FROM (t->>2)::int);

  UPDATE public.eatery_partners SET menu_verified_on = DATE '2026-10-20', updated_at = now()
   WHERE id = c_id AND is_active = false AND menu_verified_on IS DISTINCT FROM DATE '2026-10-20';

  -- Post-state: exactly the 46 target rows, one each, in order, with their prices; 9 sections; photos untouched.
  SELECT count(*), count(DISTINCT section) INTO v_n, v_secs FROM public.eatery_menu_items WHERE partner_id = c_id;
  IF v_n IS DISTINCT FROM 46 OR v_secs IS DISTINCT FROM 9 THEN RAISE EXCEPTION 'after: % items in % sections, expected 46 in 9', v_n, v_secs; END IF;
  SELECT string_agg(t->>3, ', ') INTO v_bad
    FROM jsonb_array_elements(v_target) t
   WHERE (SELECT count(*) FROM public.eatery_menu_items i
           WHERE i.partner_id = c_id AND i.section = t->>0 AND i.name = t->>3 AND i.price = (t->>4)::numeric AND i.currency = 'TRY'
             AND i.section_order = (t->>1)::int AND i.sort_order = (t->>2)::int AND i.is_available) IS DISTINCT FROM 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'after: target rows not matched exactly once: %', v_bad; END IF;
  IF (SELECT count(*) FROM public.eatery_menu_items WHERE partner_id = c_id AND photo_path IS NOT NULL) < 16 THEN
    RAISE EXCEPTION 'after: fewer than the 16 existing dish photos remain';
  END IF;
  SELECT * INTO v_p FROM public.eatery_partners WHERE id = c_id;
  IF v_p.is_active IS DISTINCT FROM false OR v_p.menu_verified_on IS DISTINCT FROM DATE '2026-10-20' THEN
    RAISE EXCEPTION 'after: is_active=% menu_verified_on=%', v_p.is_active, v_p.menu_verified_on;
  END IF;

  -- Still invisible without the Preview key (anon, no request headers).
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.headers', '', true);
  SELECT count(*) INTO v_anon FROM public.eatery_menu_items WHERE partner_id = c_id;
  RESET ROLE;
  IF v_anon <> 0 THEN RAISE EXCEPTION 'inactive menu is visible to anon (% rows)', v_anon; END IF;

  RAISE NOTICE 'crunchy-express menu: 46 items / 9 sections (% new), menu_verified_on 2026-10-20, inactive, anon 0', v_new;
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
VALUES ('20261122_crunchy_express_menu_1020.sql', 'a8873be3a91ff0e4e8042080fef1fb311967cf26e55db4c9d59be9a915c8a9e4')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: the 20261122_crunchy_express_menu_1020 row must read OK.
--
-- ─── Rollback (removes only the 5 new rows; order and date stay) ──
--   DELETE FROM public.eatery_menu_items WHERE partner_id = 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434'
--     AND name IN ('Cheeseme Chicken Burger','Crunchy Classic Nachos','Buffalo Nachos','Hot Honey Nachos','Eritilmiş Peynir Sos');

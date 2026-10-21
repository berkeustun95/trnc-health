-- ═══════════════════════════════════════════════════════════════════════════
-- 20261124 — Crunchy Express dish-finder tags: role / protein / spicy / portion on its 46 dishes
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DATA ONLY: no schema, policy or grant change. Fills the four columns 20261123 added. Partner stays is_active = false.
-- SOURCE: Berke approved the 46-row table on 2026-10-21 (name, role, protein, spicy, portion; portion NULL for every
-- non-main). Matched by (partner_id, name); nothing else on a dish is touched (price, order, photo_path, description).
-- The 20261123 CHECKs still apply: main ⇒ protein/spicy/portion set; side/sauce/drink/dessert ⇒ protein/spicy set, portion NULL.
--
-- Pre-state (abort otherwise): partner crunchy-express exists and is inactive; exactly 46 items; every target name
-- matches exactly one item; every item is untagged or already EXACTLY its target (any other tag value aborts).
-- RE-RUNNABLE: a second run finds 0 rows differing and writes nothing. A partial state (some but not all 46 differing)
-- aborts. Post-state: all 46 equal their target; role counts and main (protein, portion) counts derived from the
-- literal equal the table's; rows of other partners are byte-identical (md5 before/after); inactive; anon sees 0.
--
-- WHO CAN READ / WRITE: unchanged (20261115 + 20261119/1120 policies). Inactive ⇒ only an is_previewer() request can
-- read the menu; anon / guests / users see nothing (asserted below). Writes: service_role / this migration only.
--
-- Apply: gh workflow run supabase-migrate -f file=20261124_crunchy_express_dish_tags.sql (dry), then
-- -f apply=true (Berke approves production-db).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  c_id   constant uuid := 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434';
  -- [name, role, protein, spicy, portion (null for non-main)]
  v_target constant jsonb := $t$[
    ["Crunchy Burger","main","chicken",false,"meal"],
    ["Crunchy BBQ Chicken Burger","main","chicken",false,"meal"],
    ["Pineapple Chicken Burger","main","chicken",false,"meal"],
    ["Nashville Tavuk Burger","main","chicken",true,"meal"],
    ["Truffle Chicken Burger","main","chicken",false,"meal"],
    ["Buffalo Chicken Burger","main","chicken",true,"meal"],
    ["Chipotle Chicken Burger","main","chicken",true,"meal"],
    ["Hot Honey Glazed Chicken Burger","main","chicken",true,"meal"],
    ["Cheeseme Chicken Burger","main","chicken",false,"meal"],
    ["TNT Chicken Burger","main","chicken",true,"meal"],
    ["Express Smash Burger","main","beef",false,"meal"],
    ["BBQ Smash Burger","main","beef",false,"meal"],
    ["Trüf Smash Burger","main","beef",false,"meal"],
    ["Big Pork Smash Burger","main","pork",false,"meal"],
    ["Jalapeño Drip Smash Burger","main","beef",true,"meal"],
    ["Crunchy Box","main","chicken",false,"meal"],
    ["Crunchy Box XL","main","chicken",false,"meal"],
    ["Crunchy Box XXL","main","chicken",false,"share"],
    ["Crunchy Kids Box","main","chicken",false,"snack"],
    ["Veggy Smash Burger","main","veg",false,"meal"],
    ["Crunchy Classic Nachos","main","chicken",true,"share"],
    ["Buffalo Nachos","main","chicken",true,"share"],
    ["Hot Honey Nachos","main","chicken",true,"share"],
    ["Mozzarella Sticks (6 Adet)","main","veg",false,"snack"],
    ["4'lü Mozzarella Sticks","side","veg",false,null],
    ["Acılı Soğan Halkası (8 Adet)","side","veg",true,null],
    ["Acılı Soğan Halkası (12 Adet)","side","veg",true,null],
    ["Patates Kızartması","side","veg",false,null],
    ["Hot Honey Glazed Halloumi","main","veg",true,"snack"],
    ["Nashville Sticks (6 Adet)","main","chicken",true,"snack"],
    ["Crunchy Özel Sos","sauce","none",false,null],
    ["Eritilmiş Peynir Sos","sauce","none",false,null],
    ["Sweet Chili Sos","sauce","none",true,null],
    ["Crunchy BBQ Sos","sauce","none",false,null],
    ["Crunchy Buffalo Sos","sauce","none",true,null],
    ["Crunchy Trüf Sos","sauce","none",false,null],
    ["Crunchy Ranch Sos","sauce","none",false,null],
    ["Crunchy Pineapple Sos","sauce","none",false,null],
    ["Crunchy Hot Mayo","sauce","none",true,null],
    ["Crunchy Coslow","sauce","none",false,null],
    ["Nutella Smash","dessert","none",false,null],
    ["Coca-Cola Zero Sugar (33 cl.)","drink","none",false,null],
    ["Coca-Cola (33 cl.)","drink","none",false,null],
    ["Fanta (33 cl.)","drink","none",false,null],
    ["Sprite (33 cl.)","drink","none",false,null],
    ["Fuse Tea (33 cl.)","drink","none",false,null]
  ]$t$::jsonb;
  v_p public.eatery_partners%ROWTYPE;
  v_n int; v_bad text; v_changed int; v_upd int; v_anon int;
  v_other_before text; v_other_after text; v_exp text; v_got text;
BEGIN
  IF jsonb_array_length(v_target) IS DISTINCT FROM 46 THEN RAISE EXCEPTION 'target has % rows, expected 46', jsonb_array_length(v_target); END IF;

  SELECT * INTO v_p FROM public.eatery_partners WHERE id = c_id;
  IF NOT FOUND OR v_p.slug IS DISTINCT FROM 'crunchy-express' OR v_p.is_active IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'crunchy-express missing or not inactive (slug %, is_active %). Nothing applied.', v_p.slug, v_p.is_active;
  END IF;

  SELECT count(*) INTO v_n FROM public.eatery_menu_items WHERE partner_id = c_id;
  IF v_n IS DISTINCT FROM 46 THEN RAISE EXCEPTION 'crunchy-express has % items, expected 46. Nothing applied.', v_n; END IF;

  -- Every target name matches exactly one item.
  SELECT string_agg(format('%s (%s matches)', t->>0, (SELECT count(*) FROM public.eatery_menu_items i WHERE i.partner_id = c_id AND i.name = t->>0)), '; ')
    INTO v_bad
    FROM jsonb_array_elements(v_target) t
   WHERE (SELECT count(*) FROM public.eatery_menu_items i WHERE i.partner_id = c_id AND i.name = t->>0) IS DISTINCT FROM 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'target names not matching exactly one item: %. Nothing applied.', v_bad; END IF;
  SELECT count(DISTINCT t->>0) INTO v_n FROM jsonb_array_elements(v_target) t;
  IF v_n IS DISTINCT FROM 46 THEN RAISE EXCEPTION 'target has % distinct names, expected 46', v_n; END IF;

  -- Every item is untagged or already exactly its target.
  SELECT string_agg(format('%s [%s/%s/%s/%s]', i.name, i.role, i.protein, i.spicy, i.portion), '; ') INTO v_bad
    FROM public.eatery_menu_items i
    JOIN jsonb_array_elements(v_target) t ON t->>0 = i.name
   WHERE i.partner_id = c_id
     AND NOT (i.role IS NULL AND i.protein IS NULL AND i.spicy IS NULL AND i.portion IS NULL)
     AND (i.role IS DISTINCT FROM t->>1 OR i.protein IS DISTINCT FROM t->>2
          OR i.spicy IS DISTINCT FROM (t->>3)::boolean OR i.portion IS DISTINCT FROM t->>4);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'items already carry other tag values: %. Nothing applied.', v_bad; END IF;

  SELECT count(*) INTO v_changed
    FROM public.eatery_menu_items i JOIN jsonb_array_elements(v_target) t ON t->>0 = i.name
   WHERE i.partner_id = c_id
     AND (i.role IS DISTINCT FROM t->>1 OR i.protein IS DISTINCT FROM t->>2
          OR i.spicy IS DISTINCT FROM (t->>3)::boolean OR i.portion IS DISTINCT FROM t->>4);
  IF v_changed NOT IN (0, 46) THEN RAISE EXCEPTION 'partial state: % of 46 items differ from the target (expected 46 first run, 0 re-run)', v_changed; END IF;

  SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s', id, role, protein, spicy, portion), ',' ORDER BY id), ''))
    INTO v_other_before FROM public.eatery_menu_items WHERE partner_id IS DISTINCT FROM c_id;

  UPDATE public.eatery_menu_items i
     SET role = t->>1, protein = t->>2, spicy = (t->>3)::boolean, portion = t->>4
    FROM jsonb_array_elements(v_target) t
   WHERE i.partner_id = c_id AND i.name = t->>0
     AND (i.role IS DISTINCT FROM t->>1 OR i.protein IS DISTINCT FROM t->>2
          OR i.spicy IS DISTINCT FROM (t->>3)::boolean OR i.portion IS DISTINCT FROM t->>4);
  GET DIAGNOSTICS v_upd = ROW_COUNT;
  IF v_upd IS DISTINCT FROM v_changed THEN RAISE EXCEPTION 'updated % rows, expected %', v_upd, v_changed; END IF;

  -- Post-state: all 46 equal their target.
  SELECT string_agg(t->>0, ', ') INTO v_bad
    FROM jsonb_array_elements(v_target) t
   WHERE (SELECT count(*) FROM public.eatery_menu_items i
           WHERE i.partner_id = c_id AND i.name = t->>0 AND i.role IS NOT DISTINCT FROM t->>1 AND i.protein IS NOT DISTINCT FROM t->>2
             AND i.spicy IS NOT DISTINCT FROM (t->>3)::boolean AND i.portion IS NOT DISTINCT FROM t->>4) IS DISTINCT FROM 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'after: items not equal to their target: %', v_bad; END IF;
  SELECT count(*) INTO v_n FROM public.eatery_menu_items WHERE partner_id = c_id AND role IS NOT NULL AND protein IS NOT NULL AND spicy IS NOT NULL;
  IF v_n IS DISTINCT FROM 46 THEN RAISE EXCEPTION 'after: % tagged items, expected 46', v_n; END IF;

  -- Counts by role, derived from the literal vs the table.
  SELECT string_agg(r || '=' || n, ',' ORDER BY r) INTO v_exp
    FROM (SELECT t->>1 AS r, count(*) AS n FROM jsonb_array_elements(v_target) t GROUP BY 1) x;
  SELECT string_agg(r || '=' || n, ',' ORDER BY r) INTO v_got
    FROM (SELECT role AS r, count(*) AS n FROM public.eatery_menu_items WHERE partner_id = c_id GROUP BY 1) x;
  IF v_exp IS DISTINCT FROM v_got THEN RAISE EXCEPTION 'after: role counts % expected (from the literal) %', v_got, v_exp; END IF;

  -- Main counts by (protein, portion), derived from the literal vs the table.
  SELECT string_agg(p || '/' || q || '=' || n, ',' ORDER BY p, q) INTO v_exp
    FROM (SELECT t->>2 AS p, t->>4 AS q, count(*) AS n FROM jsonb_array_elements(v_target) t WHERE t->>1 = 'main' GROUP BY 1, 2) x;
  SELECT string_agg(p || '/' || q || '=' || n, ',' ORDER BY p, q) INTO v_got
    FROM (SELECT protein AS p, portion AS q, count(*) AS n FROM public.eatery_menu_items WHERE partner_id = c_id AND role = 'main' GROUP BY 1, 2) x;
  IF v_exp IS DISTINCT FROM v_got THEN RAISE EXCEPTION 'after: main (protein/portion) counts % expected (from the literal) %', v_got, v_exp; END IF;

  -- Other partners' rows untouched.
  SELECT md5(coalesce(string_agg(format('%s|%s|%s|%s|%s', id, role, protein, spicy, portion), ',' ORDER BY id), ''))
    INTO v_other_after FROM public.eatery_menu_items WHERE partner_id IS DISTINCT FROM c_id;
  IF v_other_after IS DISTINCT FROM v_other_before THEN RAISE EXCEPTION 'after: other partners'' rows changed (% -> %)', v_other_before, v_other_after; END IF;

  SELECT * INTO v_p FROM public.eatery_partners WHERE id = c_id;
  IF v_p.is_active IS DISTINCT FROM false THEN RAISE EXCEPTION 'after: crunchy-express is_active=%', v_p.is_active; END IF;

  -- Still invisible without the Preview key (anon, no request headers).
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.headers', '', true);
  SELECT count(*) INTO v_anon FROM public.eatery_menu_items WHERE partner_id = c_id;
  RESET ROLE;
  IF v_anon <> 0 THEN RAISE EXCEPTION 'inactive menu is visible to anon (% rows)', v_anon; END IF;

  RAISE NOTICE 'crunchy-express dish tags: % rows written, 46 tagged, main (protein/portion) %, other partners unchanged, inactive, anon 0', v_upd, v_got;
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
VALUES ('20261124_crunchy_express_dish_tags.sql', '67a7c302bde3785acdc644ce626f43bffcc28bb8bc4c6ca722e5aeda3c8472a2')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: the 20261124_crunchy_express_dish_tags row must read OK.
--
-- ─── Rollback (untags only Crunchy's dishes) ──
--   UPDATE public.eatery_menu_items SET role = NULL, protein = NULL, spicy = NULL, portion = NULL
--    WHERE partner_id = 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434';

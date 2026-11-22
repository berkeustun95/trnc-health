-- ═══════════════════════════════════════════════════════════════════════════
-- 20261226 — Crunchy Express: free sausage choice on the 3 hot dogs + 2 completed descriptions
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DATA ONLY: no schema, policy or grant change. Crunchy is LIVE and stays live; anon / guests / users read these rows the
-- moment this applies (asserted below).
--
-- SAUSAGE (Berke 2026-11-22, wording A). Yemeksepeti asks a required "Sosis Seçimi: Domuz / Normal" on the three hot dogs.
-- ADA has no required-choice option yet (queued as an eatery upgrade in the vault), so the data-only stand-in is two FREE
-- extras per hot dog (price 0 = free since 20261150, shown under "Malzeme ekle"):
--   app label   "Sosis: Domuz" / "Sosis: Normal" (nine languages below)
--   message_tr  "sosis tercihi: domuz" / "sosis tercihi: normal" → WhatsApp reads "+ekstra sosis tercihi: domuz"
--   (not "domuz sosis": "+ekstra domuz sosis" would read as a SECOND sausage). kind 'extra', price 0, max_qty 1,
--   sort_order 1 (Domuz) / 2 (Normal), available. Known limit, accepted: nothing forces a pick, and both can be ticked.
-- Hot Dog Bacon Wrapped, Trüf Mayonezli Hot Dog, Barbekü Soslu Hot Dog. No sauce option on the Cypriot (like the other
-- burgers, 20261136). Dish-finder tags unchanged: the two untagged hot dogs stay untagged (the sausage is the buyer's pick).
--
-- DESCRIPTIONS (Berke 2026-11-22, the full Yemeksepeti text; typos fixed as before: "bacona", "kızartması"):
--   Cypriot Smash Burger   "Özel çörek ekmeği arasına; smash burger köftesi, hellim peyniri, soğan, salatalık turşusu, crunchy
--                           bikla mayo sosu. Seçeceğiniz sos ile"
--   Hot Dog Bacon Wrapped  "… patates kızartması (Domuz eti içerir.)"
--
-- Pre-state (abort otherwise): 20261137, 20261150 and 20261224 in the ledger; crunchy-express present and live; each of the 5
-- dishes exactly once; each description is the 20261224 text or the new one; each hot dog has NO options or EXACTLY the two
-- target rows (anything else, e.g. a hand-made or priced sausage row, aborts); the partner's other options are 96 rows.
-- Post-state: 102 option rows (77 removals on 19 dishes, 19 priced extras on 9 dishes, 6 free extras on the 3 hot dogs);
-- every new label passes eatery_option_label_valid; the 96 other rows, the menu (but the 2 descriptions), photos and the
-- partner row are unchanged (md5); anon reads the 6 rows and the 2 descriptions. RE-RUNNABLE: a second run writes nothing.
--
-- WHO CAN READ / WRITE: unchanged (20261134 policies). Live partner ⇒ anon and authenticated read the options and the menu;
-- writes: service_role / migrations only.
--
-- Apply: gh workflow run supabase-migrate -f file=20261226_crunchy_express_hotdog_sausage_extras.sql (dry), then
-- -f apply=true (Berke approves production-db).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  c_id   constant uuid := 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434';
  c_dogs constant text[] := ARRAY['Hot Dog Bacon Wrapped', 'Trüf Mayonezli Hot Dog', 'Barbekü Soslu Hot Dog'];
  -- [message_tr, sort_order, label_i18n]
  v_opts constant jsonb := $t$[
    ["sosis tercihi: domuz", 1, {"English":"Sausage: Pork","Turkish":"Sosis: Domuz","Arabic":"النقانق: لحم خنزير","Russian":"Сосиска: свиная","Greek":"Λουκάνικο: χοιρινό","French":"Saucisse : porc","Spanish":"Salchicha: de cerdo","German":"Würstchen: Schwein","Persian":"سوسیس: گوشت خوک"}],
    ["sosis tercihi: normal", 2, {"English":"Sausage: Regular","Turkish":"Sosis: Normal","Arabic":"النقانق: عادية","Russian":"Сосиска: обычная","Greek":"Λουκάνικο: κανονικό","French":"Saucisse : normale","Spanish":"Salchicha: normal","German":"Würstchen: normal","Persian":"سوسیس: معمولی"}]
  ]$t$::jsonb;
  -- [name, description before (20261224), description after]
  v_desc constant jsonb := $d$[
    ["Cypriot Smash Burger",
     "Özel çörek ekmeği arasına; smash burger köftesi, hellim peyniri, soğan, salatalık turşusu",
     "Özel çörek ekmeği arasına; smash burger köftesi, hellim peyniri, soğan, salatalık turşusu, crunchy bikla mayo sosu. Seçeceğiniz sos ile"],
    ["Hot Dog Bacon Wrapped",
     "Domuz bacona sarılmış sosis, hardal sos, ketçap, turşu, çiğ soğan, kaşar peyniri, patates kızartması",
     "Domuz bacona sarılmış sosis, hardal sos, ketçap, turşu, çiğ soğan, kaşar peyniri, patates kızartması (Domuz eti içerir.)"]
  ]$d$::jsonb;
  v_p public.eatery_partners%ROWTYPE;
  v_dog text; v_item bigint; v_n int; v_have int; v_ins int := 0; v_bad text; v_anon int; v_anon_d int;
  v_other_before text; v_other_after text; v_menu_before text; v_menu_after text;
BEGIN
  SELECT count(*) INTO v_n FROM public.schema_migrations_applied
   WHERE filename IN ('20261137_crunchy_express_bigpork_pork_bacon.sql', '20261150_bidda_badadez_free_options.sql',
                      '20261224_crunchy_express_menu_1122.sql');
  IF v_n IS DISTINCT FROM 3 THEN RAISE EXCEPTION '20261137, 20261150 and 20261224 are not all in the ledger (% of 3). Nothing applied.', v_n; END IF;

  SELECT * INTO v_p FROM public.eatery_partners WHERE id = c_id;
  IF NOT FOUND OR v_p.slug IS DISTINCT FROM 'crunchy-express' OR v_p.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'crunchy-express missing or not live (slug %, is_active %). Nothing applied.', v_p.slug, v_p.is_active;
  END IF;

  SELECT string_agg(format('%s (%s)', x.name, (SELECT count(*) FROM public.eatery_menu_items i WHERE i.partner_id = c_id AND i.name = x.name)), ', ')
    INTO v_bad
    FROM unnest(c_dogs || ARRAY['Cypriot Smash Burger']) AS x(name)
   WHERE (SELECT count(*) FROM public.eatery_menu_items i WHERE i.partner_id = c_id AND i.name = x.name) IS DISTINCT FROM 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'dishes not matched exactly once: %. Nothing applied.', v_bad; END IF;

  SELECT string_agg(d->>0, ', ') INTO v_bad
    FROM jsonb_array_elements(v_desc) d
   WHERE NOT EXISTS (SELECT 1 FROM public.eatery_menu_items i WHERE i.partner_id = c_id AND i.name = d->>0
                       AND i.description IN (d->>1, d->>2));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'description is neither the 20261224 text nor the new one: %. Nothing applied.', v_bad; END IF;

  -- Each hot dog: no options, or exactly the two target rows.
  FOREACH v_dog IN ARRAY c_dogs LOOP
    SELECT id INTO v_item FROM public.eatery_menu_items WHERE partner_id = c_id AND name = v_dog;
    SELECT count(*) INTO v_have FROM public.eatery_item_options WHERE item_id = v_item;
    SELECT count(*) INTO v_n FROM public.eatery_item_options o JOIN jsonb_array_elements(v_opts) t
        ON o.message_tr = t->>0 AND o.sort_order = (t->>1)::int AND o.label_i18n = t->2
     WHERE o.item_id = v_item AND o.kind = 'extra' AND o.price = 0 AND o.max_qty = 1 AND o.is_available;
    IF NOT (v_have = 0 OR (v_have = 2 AND v_n = 2)) THEN
      RAISE EXCEPTION '% has % option rows (% match the target): neither none nor the 2 sausage rows. Nothing applied.', v_dog, v_have, v_n;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
   WHERE i.partner_id = c_id AND i.name <> ALL (c_dogs);
  IF v_n IS DISTINCT FROM 96 THEN RAISE EXCEPTION 'crunchy-express has % options outside the hot dogs, expected 96 (20261137). Nothing applied.', v_n; END IF;

  SELECT md5(coalesce(string_agg(to_jsonb(o)::text, ',' ORDER BY o.id), '')) INTO v_other_before
    FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
   WHERE NOT (i.partner_id = c_id AND i.name = ANY (c_dogs));
  SELECT md5(coalesce(string_agg((to_jsonb(i) - 'description')::text, ',' ORDER BY i.id), '')
             || coalesce(string_agg(i.description, ',' ORDER BY i.id) FILTER (WHERE NOT (i.partner_id = c_id AND i.name IN ('Cypriot Smash Burger', 'Hot Dog Bacon Wrapped'))), ''))
    INTO v_menu_before FROM public.eatery_menu_items i;

  UPDATE public.eatery_menu_items i SET description = d->>2
    FROM jsonb_array_elements(v_desc) d
   WHERE i.partner_id = c_id AND i.name = d->>0 AND i.description IS DISTINCT FROM d->>2;

  FOREACH v_dog IN ARRAY c_dogs LOOP
    SELECT id INTO v_item FROM public.eatery_menu_items WHERE partner_id = c_id AND name = v_dog;
    IF NOT EXISTS (SELECT 1 FROM public.eatery_item_options WHERE item_id = v_item) THEN
      INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, price, max_qty, sort_order, is_available)
      SELECT v_item, 'extra', t->2, t->>0, 0, 1, (t->>1)::int, true FROM jsonb_array_elements(v_opts) t;
      v_ins := v_ins + 2;
    END IF;
  END LOOP;
  IF v_ins NOT IN (0, 6) THEN RAISE EXCEPTION 'inserted % sausage rows, expected 6 (first run) or 0 (re-run)', v_ins; END IF;

  -- Post-state.
  SELECT string_agg(format('%s/%s', i.name, t->>0), ', ') INTO v_bad
    FROM public.eatery_menu_items i CROSS JOIN jsonb_array_elements(v_opts) t
   WHERE i.partner_id = c_id AND i.name = ANY (c_dogs)
     AND (SELECT count(*) FROM public.eatery_item_options o
           WHERE o.item_id = i.id AND o.kind = 'extra' AND o.message_tr = t->>0 AND o.label_i18n = t->2 AND o.price = 0
             AND o.max_qty = 1 AND o.sort_order = (t->>1)::int AND o.is_available
             AND public.eatery_option_label_valid(o.label_i18n)) IS DISTINCT FROM 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'after: sausage rows not matched exactly once: %', v_bad; END IF;
  SELECT count(*) INTO v_n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
   WHERE i.partner_id = c_id AND i.name = ANY (c_dogs);
  IF v_n IS DISTINCT FROM 6 THEN RAISE EXCEPTION 'after: % option rows on the hot dogs, expected 6', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
   WHERE i.partner_id = c_id;
  IF v_n IS DISTINCT FROM 102 THEN RAISE EXCEPTION 'after: crunchy-express has % option rows, expected 102', v_n; END IF;
  SELECT string_agg(d->>0, ', ') INTO v_bad FROM jsonb_array_elements(v_desc) d
   WHERE NOT EXISTS (SELECT 1 FROM public.eatery_menu_items i WHERE i.partner_id = c_id AND i.name = d->>0 AND i.description = d->>2);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'after: description not set: %', v_bad; END IF;

  SELECT md5(coalesce(string_agg(to_jsonb(o)::text, ',' ORDER BY o.id), '')) INTO v_other_after
    FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
   WHERE NOT (i.partner_id = c_id AND i.name = ANY (c_dogs));
  IF v_other_after IS DISTINCT FROM v_other_before THEN RAISE EXCEPTION 'after: options outside the 3 hot dogs changed'; END IF;
  SELECT md5(coalesce(string_agg((to_jsonb(i) - 'description')::text, ',' ORDER BY i.id), '')
             || coalesce(string_agg(i.description, ',' ORDER BY i.id) FILTER (WHERE NOT (i.partner_id = c_id AND i.name IN ('Cypriot Smash Burger', 'Hot Dog Bacon Wrapped'))), ''))
    INTO v_menu_after FROM public.eatery_menu_items i;
  IF v_menu_after IS DISTINCT FROM v_menu_before THEN RAISE EXCEPTION 'after: the menu changed beyond the 2 descriptions'; END IF;
  IF (SELECT is_active FROM public.eatery_partners WHERE id = c_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'after: crunchy-express not live'; END IF;

  -- Live: anon (no JWT, no request headers) reads the 6 rows and the 2 descriptions.
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.headers', '', true);
  SELECT count(*) INTO v_anon FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
   WHERE i.partner_id = c_id AND i.name = ANY (c_dogs) AND o.price = 0;
  SELECT count(*) INTO v_anon_d FROM public.eatery_menu_items i JOIN jsonb_array_elements(v_desc) d ON i.name = d->>0 AND i.description = d->>2
   WHERE i.partner_id = c_id;
  RESET ROLE;
  IF v_anon IS DISTINCT FROM 6 OR v_anon_d IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'anon reads % sausage rows / % descriptions, expected 6 / 2', v_anon, v_anon_d;
  END IF;

  RAISE NOTICE 'crunchy-express: % sausage rows inserted (6 on the 3 hot dogs), 102 options, 2 descriptions, live, anon 6 / 2', v_ins;
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
VALUES ('20261226_crunchy_express_hotdog_sausage_extras.sql', '483e3d342aa5dbf50b3d4a6cc471c9bb0bacb5c6079606fbe2e6ee7579e501a9')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: the 20261226_crunchy_express_hotdog_sausage_extras row must read OK.
--
-- ─── Rollback (removes the 6 sausage rows and restores the 20261224 descriptions) ──
--   DELETE FROM public.eatery_item_options WHERE message_tr IN ('sosis tercihi: domuz', 'sosis tercihi: normal')
--     AND item_id IN (SELECT id FROM public.eatery_menu_items WHERE partner_id = 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434'
--                      AND name IN ('Hot Dog Bacon Wrapped', 'Trüf Mayonezli Hot Dog', 'Barbekü Soslu Hot Dog'));
--   UPDATE public.eatery_menu_items SET description = CASE name
--       WHEN 'Cypriot Smash Burger' THEN 'Özel çörek ekmeği arasına; smash burger köftesi, hellim peyniri, soğan, salatalık turşusu'
--       WHEN 'Hot Dog Bacon Wrapped' THEN 'Domuz bacona sarılmış sosis, hardal sos, ketçap, turşu, çiğ soğan, kaşar peyniri, patates kızartması' END
--    WHERE partner_id = 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434' AND name IN ('Cypriot Smash Burger', 'Hot Dog Bacon Wrapped');

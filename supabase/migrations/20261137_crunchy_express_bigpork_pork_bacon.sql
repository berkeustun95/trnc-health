-- ═══════════════════════════════════════════════════════════════════════════
-- 20261137 — Crunchy Express: Big Pork Smash Burger's priced extra becomes PORK bacon
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DATA ONLY: no schema, policy or grant change. crunchy-express is LIVE: anon / guests / users read these rows the moment this
-- applies (asserted below). The owner answered: Big Pork's bacon is domuz (pork). 20261136 had given Big Pork the same
-- "ekstra dana bacon" (beef) as the other four smash burgers; this file replaces that ONE row with "ekstra domuz bacon".
-- Big Pork's removal "domuz baconsız" and its dish description already say pork: untouched. No menu change.
--
-- DELETE + INSERT, not an in-place UPDATE: beef -> pork is a change of MEANING, not a better name for the same thing. 20261136's
-- own rule (its header, "UPDATE vs DELETE + INSERT") is that a meaning change drops the old option id, so a basket held with
-- "Beef bacon" shows "Seçenekler değişti - yeniden seçin" and cannot be ordered until the customer re-chooses
-- (components/EateryOrder.js blocks it). An UPDATE would let that basket silently order pork. (20261136 made the same swap the
-- other way, pork -> beef, by DELETE + INSERT.) The new row gets a new id; orders keep a snapshot, never a foreign key to the id.
--
-- Price 90 and max_qty 1 are CARRIED OVER from the dana bacon row they replace. They are NOT owner-priced: the owner has not
-- named a price for pork bacon. Ask him; if it differs, that is a one-row follow-up UPDATE (same meaning, so in place).
--
-- Pre-state (abort otherwise): 20261134, 20261135 and 20261136 in the ledger; table present; crunchy-express present and ACTIVE;
-- "Big Pork Smash Burger" matches exactly one menu item; the partner has 96 option rows (77 removals + 19 extras); Big Pork's
-- extras are EXACTLY the 20261136 state (köfte 250 x2 order 1, dana bacon 90 x1 order 2 with the dana_bacon label, hellim 85 x1
-- order 3, all available) -> mode apply; or EXACTLY the 20261137 state (the same with domuz bacon and the domuz_bacon label in
-- place of dana bacon) -> mode noop and nothing is written. Anything else (a hand-edited price, a disabled row, a foreign row)
-- aborts. Every label passes eatery_option_label_valid (nine full-English-name languages, <= 60 chars); the label texts are
-- copied byte for byte from 20261136's dictionary.
-- Post-state: 96 rows (77 removals on 19 dishes, 19 extras on 9 dishes); Big Pork's extras are köfte 250 x2 / domuz bacon 90 x1 /
-- hellim 85 x1 in that order; no dana bacon extra on Big Pork, dana bacon 90 on exactly the other four dishes; every extra one of
-- the five (message, price, max_qty) triples, available, priced; no refused extra; exactly one option id replaced (95 of 96 ids
-- kept, the deleted one gone, the new one fresh); everything else in the partner's options, the menu, the partner rows and other
-- partners' options unchanged (md5); anon reads Big Pork's three extras including domuz bacon.
--
-- WHO CAN READ / WRITE: unchanged (20261134 policies). Live partner => anon and authenticated read the options; writes:
-- service_role / this migration only.
--
-- Apply: gh workflow run supabase-migrate -f file=20261137_crunchy_express_bigpork_pork_bacon.sql (dry), then
-- -f apply=true (Berke approves production-db).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  c_id   constant uuid := 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434';
  c_dish constant text := 'Big Pork Smash Burger';
  -- key -> {ex: the extra's message (Turkish), l: label_i18n (nine languages)}; copied from 20261136
  v_lab constant jsonb := $t${
    "kofte": {"ex":"köfte","l":{"English":"Smash patty","Turkish":"Smash köfte","Arabic":"قرص لحم سماش","Russian":"Смэш-котлета","Greek":"Smash μπιφτέκι","French":"Steak smash","Spanish":"Carne smash","German":"Smash-Patty","Persian":"پتی اسمش"}},
    "dana_bacon": {"rm":"dana baconsız","ex":"dana bacon","l":{"English":"Beef bacon","Turkish":"Dana bacon","Arabic":"بيكون لحم البقر","Russian":"Говяжий бекон","Greek":"Μοσχαρίσιο μπέικον","French":"Bacon de bœuf","Spanish":"Bacon de ternera","German":"Rinderbacon","Persian":"بیکن گوشت گاو"}},
    "domuz_bacon": {"rm":"domuz baconsız","ex":"domuz bacon","l":{"English":"Pork bacon","Turkish":"Domuz bacon","Arabic":"بيكون لحم الخنزير","Russian":"Свиной бекон","Greek":"Χοιρινό μπέικον","French":"Bacon de porc","Spanish":"Bacon de cerdo","German":"Schweinebacon","Persian":"بیکن گوشت خوک"}},
    "hellim": {"ex":"hellim","l":{"English":"Halloumi","Turkish":"Hellim","Arabic":"حلوم","Russian":"Халуми","Greek":"Χαλλούμι","French":"Halloumi","Spanish":"Halloumi","German":"Halloumi","Persian":"هالومی"}}
  }$t$::jsonb;
  -- Big Pork's extras in order: [dictionary key, TL price, max_qty]; sort_order = position
  v_st_old constant jsonb := $t$[["kofte", 250, 2], ["dana_bacon", 90, 1], ["hellim", 85, 1]]$t$::jsonb;
  v_st_new constant jsonb := $t$[["kofte", 250, 2], ["domuz_bacon", 90, 1], ["hellim", 85, 1]]$t$::jsonb;
  v_bp bigint;
  v_mode text; v_have int; v_n int; v_k text; v_bad text; v_old jsonb; v_new jsonb; v_e_old jsonb; v_e_new jsonb;
  v_b_rm int; v_b_ex int; v_rm int; v_ex int; v_dish_rm int; v_dish_ex int;
  v_ids_before bigint[]; v_ids_after bigint[]; v_del_id bigint; v_new_id bigint; v_del int; v_ins int; v_kept int;
  v_bp_before text; v_bp_after text; v_got text;
  v_menu_before text; v_menu_after text; v_part_before text; v_part_after text; v_oth_before text; v_oth_after text;
  v_rest_before text; v_rest_after text; v_pg int; v_anon int; v_anon_dom int;
BEGIN
  -- ─── The literal: every label valid, rows well formed ────────────────────
  FOR v_k IN SELECT jsonb_object_keys(v_lab) LOOP
    IF NOT public.eatery_option_label_valid(v_lab -> v_k -> 'l') OR (v_lab -> v_k -> 'l') ? 'tr' OR (v_lab -> v_k -> 'l') ? 'en'
       OR coalesce(v_lab -> v_k ->> 'ex', '') = '' THEN
      RAISE EXCEPTION 'literal: label of key % is not nine full-English-name languages of 1..60 chars, or has no message. Nothing applied.', v_k;
    END IF;
  END LOOP;
  IF jsonb_array_length(v_st_old) IS DISTINCT FROM 3 OR jsonb_array_length(v_st_new) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'literal: a Big Pork state is not three extras. Nothing applied.';
  END IF;
  SELECT string_agg(e.v::text, '; ') INTO v_bad
    FROM (SELECT v FROM jsonb_array_elements(v_st_old) v UNION ALL SELECT v FROM jsonb_array_elements(v_st_new) v) e
   WHERE v_lab -> (e.v ->> 0) IS NULL OR (e.v ->> 1)::numeric <= 0 OR (e.v ->> 1)::numeric >= 1000000 OR (e.v ->> 2)::int NOT BETWEEN 1 AND 10;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'literal: an extra without a dictionary entry, a positive price or a qty of 1..10: %. Nothing applied.', v_bad; END IF;
  v_e_old := v_st_old -> 1;
  v_e_new := v_st_new -> 1;
  IF (v_e_old ->> 0) IS NOT DISTINCT FROM (v_e_new ->> 0) THEN
    RAISE EXCEPTION 'literal: the replaced extra and its successor are the same key (%). Nothing applied.', v_e_old ->> 0;
  END IF;

  -- ─── Pre-state ───────────────────────────────────────────────────────────
  IF (SELECT count(*) FROM public.schema_migrations_applied
       WHERE filename IN ('20261134_eatery_item_options.sql', '20261135_crunchy_express_item_options.sql',
                          '20261136_crunchy_express_options_owner_answers.sql')) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION '20261134 / 20261135 / 20261136 are not all in the ledger. Nothing applied.';
  END IF;
  IF to_regclass('public.eatery_item_options') IS NULL THEN RAISE EXCEPTION 'public.eatery_item_options is missing. Nothing applied.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.eatery_partners WHERE id = c_id AND slug = 'crunchy-express' AND is_active IS NOT DISTINCT FROM true) THEN
    RAISE EXCEPTION 'crunchy-express missing or not active. Nothing applied.';
  END IF;
  SELECT count(*) INTO v_n FROM public.eatery_menu_items WHERE partner_id = c_id AND name = c_dish;
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION '% matches % menu items, expected exactly one. Nothing applied.', c_dish, v_n; END IF;
  SELECT id INTO v_bp FROM public.eatery_menu_items WHERE partner_id = c_id AND name = c_dish;

  SELECT count(*), count(*) FILTER (WHERE o.kind = 'remove'), count(*) FILTER (WHERE o.kind = 'extra')
    INTO v_have, v_b_rm, v_b_ex
    FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;
  IF v_have IS DISTINCT FROM 96 OR v_b_rm IS DISTINCT FROM 77 OR v_b_ex IS DISTINCT FROM 19 THEN
    RAISE EXCEPTION 'crunchy-express has % option rows (% removals + % extras), expected 96 (77 + 19). Nothing applied.', v_have, v_b_rm, v_b_ex;
  END IF;

  v_mode := NULL;
  FOR v_k, v_new IN VALUES ('apply', v_st_old), ('noop', v_st_new) LOOP
    IF v_mode IS NULL
       AND (SELECT count(*) FROM public.eatery_item_options o WHERE o.item_id = v_bp AND o.kind = 'extra') = 3
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(v_new) WITH ORDINALITY e(v, ord)
          WHERE NOT EXISTS (SELECT 1 FROM public.eatery_item_options o
                             WHERE o.item_id = v_bp AND o.kind = 'extra'
                               AND o.message_tr = v_lab -> (e.v ->> 0) ->> 'ex'
                               AND o.label_i18n IS NOT DISTINCT FROM v_lab -> (e.v ->> 0) -> 'l'
                               AND o.price IS NOT DISTINCT FROM (e.v ->> 1)::numeric
                               AND o.max_qty = (e.v ->> 2)::int
                               AND o.sort_order = e.ord AND o.is_available)) THEN
      v_mode := v_k;
    END IF;
  END LOOP;
  SELECT string_agg(o.message_tr || ' ' || coalesce(o.price::text, 'NULL') || ' x' || o.max_qty || ' ord' || o.sort_order
                    || CASE WHEN o.is_available THEN '' ELSE ' DISABLED' END, ', ' ORDER BY o.sort_order, o.id)
    INTO v_bp_before FROM public.eatery_item_options o WHERE o.item_id = v_bp AND o.kind = 'extra';
  IF v_mode IS NULL THEN
    RAISE EXCEPTION '% extras are neither the 20261136 state nor the 20261137 state (found: %). Nothing applied.', c_dish, coalesce(v_bp_before, 'none');
  END IF;

  SELECT coalesce(array_agg(o.id ORDER BY o.id), ARRAY[]::bigint[]) INTO v_ids_before
    FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;
  SELECT md5(coalesce(string_agg(to_jsonb(i)::text, ',' ORDER BY i.id), '')) INTO v_menu_before FROM public.eatery_menu_items i;
  SELECT md5(coalesce(string_agg(to_jsonb(p)::text, ',' ORDER BY p.id), '')) INTO v_part_before FROM public.eatery_partners p;
  SELECT md5(coalesce(string_agg(to_jsonb(o)::text, ',' ORDER BY o.id), '')) INTO v_oth_before
    FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id IS DISTINCT FROM c_id;
  SELECT md5(coalesce(string_agg(to_jsonb(o)::text, ',' ORDER BY o.id), '')) INTO v_rest_before
    FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
   WHERE i.partner_id = c_id AND NOT (o.item_id = v_bp AND o.kind = 'extra');

  -- ─── Write (first run only): DELETE the dana bacon extra, INSERT the domuz bacon extra ───
  v_del := 0; v_ins := 0;
  IF v_mode = 'apply' THEN
    DELETE FROM public.eatery_item_options o
     WHERE o.item_id = v_bp AND o.kind = 'extra' AND o.message_tr = v_lab -> (v_e_old ->> 0) ->> 'ex'
    RETURNING o.id INTO v_del_id;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    IF v_del IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'deleted % rows, expected 1', v_del; END IF;

    INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, price, max_qty, sort_order)
    VALUES (v_bp, 'extra', v_lab -> (v_e_new ->> 0) -> 'l', v_lab -> (v_e_new ->> 0) ->> 'ex',
            (v_e_new ->> 1)::numeric, (v_e_new ->> 2)::int, 2)
    RETURNING id INTO v_new_id;
    GET DIAGNOSTICS v_ins = ROW_COUNT;
    IF v_ins IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'inserted % rows, expected 1', v_ins; END IF;
  END IF;

  -- ─── Post-state ──────────────────────────────────────────────────────────
  SELECT count(*), count(*) FILTER (WHERE o.kind = 'remove'), count(*) FILTER (WHERE o.kind = 'extra'),
         count(DISTINCT o.item_id) FILTER (WHERE o.kind = 'remove'), count(DISTINCT o.item_id) FILTER (WHERE o.kind = 'extra')
    INTO v_n, v_rm, v_ex, v_dish_rm, v_dish_ex
    FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;
  IF v_n IS DISTINCT FROM v_have THEN RAISE EXCEPTION 'after: % option rows, were %', v_n, v_have; END IF;
  IF v_rm IS DISTINCT FROM 77 OR v_dish_rm IS DISTINCT FROM 19 OR v_ex IS DISTINCT FROM 19 OR v_dish_ex IS DISTINCT FROM 9 THEN
    RAISE EXCEPTION 'after: % removals on % dishes, % extras on % dishes; expected 77 on 19, 19 on 9', v_rm, v_dish_rm, v_ex, v_dish_ex;
  END IF;

  SELECT string_agg(o.message_tr || ':' || o.price || 'x' || o.max_qty, ',' ORDER BY o.sort_order) INTO v_bp_after
    FROM public.eatery_item_options o WHERE o.item_id = v_bp AND o.kind = 'extra' AND o.is_available;
  IF v_bp_after IS DISTINCT FROM 'köfte:250.00x2,domuz bacon:90.00x1,hellim:85.00x1' THEN
    RAISE EXCEPTION 'after: % extras are % (expected köfte 250 x2, domuz bacon 90 x1, hellim 85 x1 in that order)', c_dish, v_bp_after;
  END IF;
  SELECT count(*) INTO v_n FROM public.eatery_item_options o WHERE o.item_id = v_bp AND o.kind = 'extra' AND o.message_tr = 'dana bacon';
  IF v_n <> 0 THEN RAISE EXCEPTION 'after: % still has a dana bacon extra', c_dish; END IF;
  SELECT count(*) INTO v_n FROM public.eatery_item_options o WHERE o.item_id = v_bp AND o.kind = 'extra' AND o.message_tr = 'domuz bacon'
     AND o.label_i18n IS NOT DISTINCT FROM v_lab -> 'domuz_bacon' -> 'l';
  IF v_n <> 1 THEN RAISE EXCEPTION 'after: % has % domuz bacon extras with the domuz_bacon label, expected 1', c_dish, v_n; END IF;

  SELECT string_agg(i.name, ', ' ORDER BY i.name COLLATE "C") INTO v_got
    FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
   WHERE i.partner_id = c_id AND o.kind = 'extra' AND o.message_tr = 'dana bacon' AND o.price = 90 AND o.max_qty = 1 AND o.is_available;
  IF v_got IS DISTINCT FROM 'BBQ Smash Burger, Express Smash Burger, Jalapeño Drip Smash Burger, Trüf Smash Burger' THEN
    RAISE EXCEPTION 'after: dana bacon 90 x1 is on (%), expected exactly the other four smash burgers', v_got;
  END IF;

  SELECT count(*) INTO v_n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
   WHERE i.partner_id = c_id AND o.kind = 'extra' AND o.is_available AND o.price > 0
     AND (o.message_tr, o.price, o.max_qty) IN (('köfte', 250, 2), ('dana bacon', 90, 1), ('domuz bacon', 90, 1), ('hellim', 85, 1), ('eritilmiş peynir sos', 110, 1));
  IF v_n IS DISTINCT FROM 19 THEN RAISE EXCEPTION 'after: % of 19 extras are available, priced and one of the five known (message, price, max_qty) triples', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
   WHERE i.partner_id = c_id AND o.kind = 'extra'
     AND (o.price IS NULL OR o.message_tr IN ('tavuk tenders', 'burger peyniri', 'cheddar', 'jalapeño'));
  IF v_n <> 0 THEN RAISE EXCEPTION 'after: % hidden or refused extras', v_n; END IF;

  -- Ids: exactly one replaced (apply) or none (noop).
  SELECT coalesce(array_agg(o.id ORDER BY o.id), ARRAY[]::bigint[]) INTO v_ids_after
    FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;
  SELECT count(*) INTO v_kept FROM unnest(v_ids_before) u WHERE u = ANY (v_ids_after);
  IF v_mode = 'apply' THEN
    IF v_kept IS DISTINCT FROM 95 OR v_del_id = ANY (v_ids_after) OR NOT (v_del_id = ANY (v_ids_before))
       OR v_new_id = ANY (v_ids_before) OR NOT (v_new_id = ANY (v_ids_after)) THEN
      RAISE EXCEPTION 'after: % of % ids kept; deleted id % / new id % are not exactly one gone, one fresh', v_kept, v_have, v_del_id, v_new_id;
    END IF;
  ELSIF v_ids_after IS DISTINCT FROM v_ids_before THEN
    RAISE EXCEPTION 'after: noop but the option ids moved';
  END IF;

  -- Nothing else moved.
  SELECT md5(coalesce(string_agg(to_jsonb(o)::text, ',' ORDER BY o.id), '')) INTO v_rest_after
    FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
   WHERE i.partner_id = c_id AND NOT (o.item_id = v_bp AND o.kind = 'extra');
  IF v_rest_after IS DISTINCT FROM v_rest_before THEN RAISE EXCEPTION 'after: a Crunchy option row other than Big Pork''s extras changed'; END IF;
  SELECT md5(coalesce(string_agg(to_jsonb(i)::text, ',' ORDER BY i.id), '')) INTO v_menu_after FROM public.eatery_menu_items i;
  IF v_menu_after IS DISTINCT FROM v_menu_before THEN RAISE EXCEPTION 'after: a menu row changed (% -> %)', v_menu_before, v_menu_after; END IF;
  SELECT md5(coalesce(string_agg(to_jsonb(p)::text, ',' ORDER BY p.id), '')) INTO v_part_after FROM public.eatery_partners p;
  IF v_part_after IS DISTINCT FROM v_part_before THEN RAISE EXCEPTION 'after: a partner row changed (% -> %)', v_part_before, v_part_after; END IF;
  SELECT md5(coalesce(string_agg(to_jsonb(o)::text, ',' ORDER BY o.id), '')) INTO v_oth_after
    FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id IS DISTINCT FROM c_id;
  IF v_oth_after IS DISTINCT FROM v_oth_before THEN RAISE EXCEPTION 'after: another partner''s option rows changed'; END IF;

  -- Anon reads Big Pork's three extras now (the partner is live). Positive control: postgres sees the same three.
  SELECT count(*) INTO v_pg FROM public.eatery_item_options o WHERE o.item_id = v_bp AND o.kind = 'extra';
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.headers', '', true);
  SELECT count(*), count(*) FILTER (WHERE o.message_tr = 'domuz bacon' AND o.price = 90)
    INTO v_anon, v_anon_dom
    FROM public.eatery_item_options o WHERE o.item_id = v_bp AND o.kind = 'extra';
  RESET ROLE;
  IF v_anon IS DISTINCT FROM 3 OR v_pg IS DISTINCT FROM 3 OR v_anon_dom IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'anon reads % of Big Pork''s extras (% domuz bacon at 90), postgres reads %; expected 3 / 1 / 3', v_anon, v_anon_dom, v_pg;
  END IF;

  RAISE NOTICE 'crunchy-express Big Pork extras (%): before [%]; after [%]; % deleted (id %), % inserted (id %); % of % ids kept; % option rows (% removals / % extras)',
    v_mode, v_bp_before, v_bp_after, v_del, v_del_id, v_ins, v_new_id, v_kept, v_have, cardinality(v_ids_after), v_rm, v_ex;
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
VALUES ('20261137_crunchy_express_bigpork_pork_bacon.sql', '8eda1e29e28d35190d89093036d086357cd77bbb48354d1ac0e181496e735495')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: the 20261137_crunchy_express_bigpork_pork_bacon row must read OK.
--
-- ─── Rollback (restores the 20261136 row; its id changes) ──
--   DELETE FROM public.eatery_item_options WHERE kind = 'extra' AND message_tr = 'domuz bacon'
--     AND item_id = (SELECT id FROM public.eatery_menu_items WHERE name = 'Big Pork Smash Burger'
--                     AND partner_id = 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434');
--   then INSERT the dana bacon row (label and message of 20261136's dana_bacon entry, price 90, max_qty 1, sort_order 2).

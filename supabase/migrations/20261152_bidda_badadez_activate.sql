-- ═══════════════════════════════════════════════════════════════════════════
-- 20261152 — Bidda Badadez: ACTIVATE (go-live SOP step 3)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DATA ONLY: eatery_partners.is_active false -> true on ONE row (b86bdaa2-…, slug bidda-badadez).
-- No schema, policy or grant change. Bidda has no app flag (EATERY_GATES gates crunchy-express only), so this row
-- is the switch: list, Explore pin, Home slide and both quizzes follow it on the next read.
--
-- SOURCE: Berke, 2026-10-31: "Bidda owner approved — take Bidda live in production." Ships AFTER the production OTA
-- that carries the phone-order code (group 3237c214, main 5681ec3, runtime 1.4.2; Preview 67a31411 device-checked by
-- Berke). 1.4.0 / 1.4.1 installs get no OTA from main: their bundles show Bidda call-only (no basket: whatsapp is
-- NULL), accepted by Berke 2026-10-31. create_eatery_order refuses a phone partner either way (20261144).
--
-- WHO CAN READ / WRITE AFTER THIS: the existing policies (eatery_partners_select_active, and the menu-item / photo /
-- item-option ones that follow the partner) let anon, guests and signed-in users READ the partner row, its menu items,
-- photos and options while is_active. Nobody gains write access; writes stay service_role / postgres only. A
-- business's own published details; no personal data.
--
-- PRE-STATE (any failure raises, nothing applied; a re-run on an already-active row skips the UPDATE and re-checks
-- the post-state): row exists with slug bidda-badadez; order_method = 'phone'; phone = '+90 392 228 89 28' (the
-- owner's number) and whatsapp IS NULL; adult_only = false, order_requires_account = false; logo_path set; every image
-- path the row, its menu items and photos name exists in storage.objects (bucket eatery-images); pin set;
-- menu_verified_on set and <= 30 days old (the launch_complete CHECK covers presence, not age); >= 1 menu item and
-- every available item priced (a dish without a price would show without one). Counts are printed, never a name list.
-- POST-STATE: anon and a non-anonymous authenticated session each see exactly that 1 partner row and every menu item,
-- photo and option row postgres counts; other partners' is_active unchanged (md5); active partners = before + 1.
--
-- ROLLBACK (manual, a NEW migration): UPDATE public.eatery_partners SET is_active = false
--   WHERE id = 'b86bdaa2-1af7-45ac-9d5f-efb9abf5413f';
--
-- Apply: gh workflow run supabase-migrate -f file=20261152_bidda_badadez_activate.sql (dry), then
-- -f apply=true (Berke approves production-db).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  c_id    constant uuid := 'b86bdaa2-1af7-45ac-9d5f-efb9abf5413f';
  c_phone constant text := '+90 392 228 89 28';
  v_p      public.eatery_partners%ROWTYPE;
  v_n      int;
  v_paths  int; v_missing int; v_missing_list text;
  v_items  int; v_unpriced int;
  v_pos_i  int; v_pos_ph int; v_pos_o int;
  v_anon_p int; v_anon_i int; v_anon_ph int; v_anon_o int;
  v_auth_p int; v_auth_i int; v_auth_ph int; v_auth_o int;
  v_active_before int; v_active int; v_active_want int;
  v_before text; v_after text; v_others int;
  v_was_active boolean;
BEGIN
  SELECT * INTO v_p FROM public.eatery_partners WHERE id = c_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bidda-badadez row % not found. Nothing applied.', c_id;
  END IF;
  IF v_p.slug IS DISTINCT FROM 'bidda-badadez' THEN
    RAISE EXCEPTION 'Row % has slug % — expected bidda-badadez. Nothing applied.', c_id, v_p.slug;
  END IF;
  v_was_active := v_p.is_active;
  IF v_p.order_method IS DISTINCT FROM 'phone' THEN
    RAISE EXCEPTION 'order_method = % — expected phone. Nothing applied.', v_p.order_method;
  END IF;
  IF v_p.phone IS DISTINCT FROM c_phone OR v_p.whatsapp IS NOT NULL THEN
    RAISE EXCEPTION 'phone/whatsapp wrong (phone %, whatsapp %): expected phone % and no whatsapp. Nothing applied.', v_p.phone, v_p.whatsapp, c_phone;
  END IF;
  IF v_p.adult_only IS DISTINCT FROM false OR v_p.order_requires_account IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'adult_only = %, order_requires_account = % — expected both false. Nothing applied.', v_p.adult_only, v_p.order_requires_account;
  END IF;
  IF v_p.logo_path IS NULL THEN
    RAISE EXCEPTION 'logo_path is NULL. Nothing applied.';
  END IF;
  IF v_p.lat IS NULL OR v_p.lng IS NULL THEN
    RAISE EXCEPTION 'pin missing (lat %, lng %). Nothing applied.', v_p.lat, v_p.lng;
  END IF;
  IF v_p.menu_verified_on IS NULL OR current_date - v_p.menu_verified_on > 30 OR current_date - v_p.menu_verified_on < 0 THEN
    RAISE EXCEPTION 'menu_verified_on = % (today %): must be set and within the last 30 days. Nothing applied.', v_p.menu_verified_on, current_date;
  END IF;

  WITH paths(path) AS (
    SELECT v_p.logo_path
    UNION ALL SELECT v_p.banner_path WHERE v_p.banner_path IS NOT NULL
    UNION ALL SELECT i.photo_path FROM public.eatery_menu_items i WHERE i.partner_id = c_id AND i.photo_path IS NOT NULL
    UNION ALL SELECT ph.storage_path FROM public.eatery_photos ph WHERE ph.partner_id = c_id
  )
  SELECT count(*),
         count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'eatery-images' AND o.name = paths.path)),
         string_agg(path, ', ') FILTER (WHERE NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'eatery-images' AND o.name = paths.path))
    INTO v_paths, v_missing, v_missing_list FROM paths;
  IF v_missing IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '% of % image path(s) have no object in eatery-images: %. Nothing applied.', v_missing, v_paths, v_missing_list;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE is_available AND price IS NULL)
    INTO v_items, v_unpriced FROM public.eatery_menu_items WHERE partner_id = c_id;
  IF v_items < 1 OR v_unpriced IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'menu: % item(s), % available without a price — expected >= 1 and 0. Nothing applied.', v_items, v_unpriced;
  END IF;

  SELECT count(*), md5(COALESCE(string_agg(id::text || '|' || is_active::text, ',' ORDER BY id), ''))
    INTO v_others, v_before FROM public.eatery_partners WHERE id <> c_id;
  SELECT count(*) INTO v_active_before FROM public.eatery_partners WHERE is_active;

  IF NOT v_was_active THEN
    UPDATE public.eatery_partners SET is_active = true, updated_at = now() WHERE id = c_id AND is_active = false;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'updated % rows, expected 1', v_n;
    END IF;
  END IF;

  SELECT * INTO v_p FROM public.eatery_partners WHERE id = c_id;
  IF v_p.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'after: is_active = %', v_p.is_active;
  END IF;

  SELECT md5(COALESCE(string_agg(id::text || '|' || is_active::text, ',' ORDER BY id), ''))
    INTO v_after FROM public.eatery_partners WHERE id <> c_id;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'another partner row changed (md5 of % others: % -> %)', v_others, v_before, v_after;
  END IF;
  SELECT count(*) INTO v_active FROM public.eatery_partners WHERE is_active;
  v_active_want := v_active_before + CASE WHEN v_was_active THEN 0 ELSE 1 END;
  IF v_active IS DISTINCT FROM v_active_want THEN
    RAISE EXCEPTION '% active eatery partners after, % before (was active: %)', v_active, v_active_before, v_was_active;
  END IF;

  SELECT count(*) INTO v_pos_i FROM public.eatery_menu_items WHERE partner_id = c_id;
  SELECT count(*) INTO v_pos_ph FROM public.eatery_photos WHERE partner_id = c_id;
  SELECT count(*) INTO v_pos_o FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.headers', '', true);
  SELECT count(*) INTO v_anon_p FROM public.eatery_partners WHERE id = c_id;
  SELECT count(*) INTO v_anon_i FROM public.eatery_menu_items WHERE partner_id = c_id;
  SELECT count(*) INTO v_anon_ph FROM public.eatery_photos WHERE partner_id = c_id;
  SELECT count(*) INTO v_anon_o FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'is_anonymous', false)::text, true);
  SELECT count(*) INTO v_auth_p FROM public.eatery_partners WHERE id = c_id;
  SELECT count(*) INTO v_auth_i FROM public.eatery_menu_items WHERE partner_id = c_id;
  SELECT count(*) INTO v_auth_ph FROM public.eatery_photos WHERE partner_id = c_id;
  SELECT count(*) INTO v_auth_o FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id = c_id;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  IF v_pos_i < 1 THEN
    RAISE EXCEPTION 'positive control failed: postgres sees % menu items', v_pos_i;
  END IF;
  IF v_anon_p IS DISTINCT FROM 1 OR v_auth_p IS DISTINCT FROM 1
     OR v_anon_i IS DISTINCT FROM v_pos_i OR v_auth_i IS DISTINCT FROM v_pos_i THEN
    RAISE EXCEPTION 'visibility wrong: anon partner % items %, authenticated partner % items % (postgres items %)',
      v_anon_p, v_anon_i, v_auth_p, v_auth_i, v_pos_i;
  END IF;
  IF v_anon_ph IS DISTINCT FROM v_pos_ph OR v_auth_ph IS DISTINCT FROM v_pos_ph THEN
    RAISE EXCEPTION 'photo visibility wrong: anon % authenticated % (postgres %)', v_anon_ph, v_auth_ph, v_pos_ph;
  END IF;
  IF v_anon_o IS DISTINCT FROM v_pos_o OR v_auth_o IS DISTINCT FROM v_pos_o THEN
    RAISE EXCEPTION 'option visibility wrong: anon % authenticated % (postgres %)', v_anon_o, v_auth_o, v_pos_o;
  END IF;

  RAISE NOTICE 'bidda-badadez ACTIVE (was active: %); phone %, order_method %, menu_verified_on % (staleness at 30 days: %); % image paths all present; anon sees % partner / % items / % photos / % options, authenticated % / % / % / % (postgres items %, photos %, options %); % other partners unchanged (md5 %); active eatery partners % -> %',
    v_was_active, v_p.phone, v_p.order_method, v_p.menu_verified_on, v_p.menu_verified_on + 30, v_paths,
    v_anon_p, v_anon_i, v_anon_ph, v_anon_o, v_auth_p, v_auth_i, v_auth_ph, v_auth_o, v_pos_i, v_pos_ph, v_pos_o,
    v_others, v_after, v_active_before, v_active;
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
VALUES ('20261152_bidda_badadez_activate.sql', '1fd494a57352c3c671a963ad231c498f7c7e4a6e21ff3930abd46292c8405d96')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: the 20261152_bidda_badadez_activate row must read OK.
--
-- ─── Rollback ──
--   New migration: UPDATE public.eatery_partners SET is_active = false WHERE id = 'b86bdaa2-1af7-45ac-9d5f-efb9abf5413f';

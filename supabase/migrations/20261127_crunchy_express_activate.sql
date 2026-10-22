-- ═══════════════════════════════════════════════════════════════════════════
-- 20261127 — Crunchy Express: ACTIVATE (go-live SOP step 3)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DATA ONLY: eatery_partners.is_active false -> true on ONE row (bb9dad05-…, slug crunchy-express).
-- No schema, policy or grant change.
--
-- WHO CAN READ / WRITE AFTER THIS: the existing policies (eatery_partners_select_active, and the menu-item /
-- photo ones that follow the partner) let anon, guests and signed-in users READ the partner row, its menu
-- items and photos while is_active. Nobody gains write access; writes stay service_role / postgres only.
-- eatery_orders is untouched (RLS on, no policy: only the DEFINER RPCs reach it).
--
-- ⚠ ORDER OF THE LAUNCH: apply this FIRST (the window opens: row searchable, screen still gated by the
-- flags), then 20261128_eatery_orders_test_cleanup.sql, then the production OTA that flips the flags.
-- Keep the window short; never end a session inside it.
--
-- PRE-STATE (any failure raises, nothing applied; a re-run on an already-active row skips the UPDATE and
-- re-checks the post-state): row exists with slug crunchy-express; logo_path set AND the object exists in
-- storage.objects (bucket eatery-images, name = logo_path); pin set; menu_verified_on set and <= 30 days
-- old (the launch_complete CHECK covers presence, not age); >= 1 available priced menu item; phone = whatsapp
-- = +905391161059; adult_only = false (if true the birth-date lock is not done: abort).
-- POST-STATE: anon and a non-anonymous authenticated session each see exactly that 1 partner row and every
-- menu item (and photo row) postgres counts; other partners' is_active unchanged (md5); exactly 1 active eatery partner.
--
-- ROLLBACK (manual, a NEW migration): UPDATE public.eatery_partners SET is_active = false
--   WHERE id = 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434';
--
-- Apply: gh workflow run supabase-migrate -f file=20261127_crunchy_express_activate.sql (dry), then
-- -f apply=true (Berke approves production-db).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  c_id    constant uuid := 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434';
  c_phone constant text := '+905391161059';
  v_p      public.eatery_partners%ROWTYPE;
  v_n      int;
  v_obj    int;
  v_items  int;
  v_pos_i  int; v_pos_ph int; v_anon_ph int; v_auth_ph int;
  v_anon_p int; v_anon_i int; v_auth_p int; v_auth_i int;
  v_active int;
  v_before text; v_after text; v_others int;
  v_was_active boolean;
BEGIN
  SELECT * INTO v_p FROM public.eatery_partners WHERE id = c_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'crunchy-express row % not found. Nothing applied.', c_id;
  END IF;
  IF v_p.slug IS DISTINCT FROM 'crunchy-express' THEN
    RAISE EXCEPTION 'Row % has slug % — expected crunchy-express. Nothing applied.', c_id, v_p.slug;
  END IF;
  v_was_active := v_p.is_active;
  IF v_p.adult_only IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'adult_only = % — the birth-date lock is not done. Nothing applied.', v_p.adult_only;
  END IF;
  IF v_p.logo_path IS NULL THEN
    RAISE EXCEPTION 'logo_path is NULL. Nothing applied.';
  END IF;
  SELECT count(*) INTO v_obj FROM storage.objects WHERE bucket_id = 'eatery-images' AND name = v_p.logo_path;
  IF v_obj IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'logo object not found in storage.objects (bucket eatery-images, name %): % rows. Nothing applied.', v_p.logo_path, v_obj;
  END IF;
  IF v_p.lat IS NULL OR v_p.lng IS NULL THEN
    RAISE EXCEPTION 'pin missing (lat %, lng %). Nothing applied.', v_p.lat, v_p.lng;
  END IF;
  IF v_p.menu_verified_on IS NULL OR current_date - v_p.menu_verified_on > 30 OR current_date - v_p.menu_verified_on < 0 THEN
    RAISE EXCEPTION 'menu_verified_on = % (today %): must be set and within the last 30 days. Nothing applied.', v_p.menu_verified_on, current_date;
  END IF;
  IF v_p.phone IS DISTINCT FROM c_phone OR v_p.whatsapp IS DISTINCT FROM c_phone THEN
    RAISE EXCEPTION 'phone/whatsapp are not exactly the confirmed number (phone %, whatsapp %). Nothing applied.', v_p.phone, v_p.whatsapp;
  END IF;
  SELECT count(*) INTO v_items FROM public.eatery_menu_items WHERE partner_id = c_id AND is_available AND price IS NOT NULL;
  IF v_items < 1 THEN
    RAISE EXCEPTION 'no available priced menu item. Nothing applied.';
  END IF;

  SELECT count(*), md5(COALESCE(string_agg(id::text || '|' || is_active::text, ',' ORDER BY id), ''))
    INTO v_others, v_before FROM public.eatery_partners WHERE id <> c_id;

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
  IF v_active IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION '% active eatery partners, expected exactly 1', v_active;
  END IF;

  SELECT count(*) INTO v_pos_i FROM public.eatery_menu_items WHERE partner_id = c_id;
  SELECT count(*) INTO v_pos_ph FROM public.eatery_photos WHERE partner_id = c_id;
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.headers', '', true);
  SELECT count(*) INTO v_anon_p FROM public.eatery_partners WHERE id = c_id;
  SELECT count(*) INTO v_anon_i FROM public.eatery_menu_items WHERE partner_id = c_id;
  SELECT count(*) INTO v_anon_ph FROM public.eatery_photos WHERE partner_id = c_id;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated', 'is_anonymous', false)::text, true);
  SELECT count(*) INTO v_auth_p FROM public.eatery_partners WHERE id = c_id;
  SELECT count(*) INTO v_auth_i FROM public.eatery_menu_items WHERE partner_id = c_id;
  SELECT count(*) INTO v_auth_ph FROM public.eatery_photos WHERE partner_id = c_id;
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

  RAISE NOTICE 'crunchy-express ACTIVE (was active: %); anon sees % partner / % items, authenticated % / %; % other partners unchanged (md5 %); % available priced items; active eatery partners %; photo rows visible: anon %, authenticated % (postgres %)',
    v_was_active, v_anon_p, v_anon_i, v_auth_p, v_auth_i, v_others, v_after, v_items, v_active, v_anon_ph, v_auth_ph, v_pos_ph;
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
VALUES ('20261127_crunchy_express_activate.sql', 'e0fcf9b3a823c0a9db3fe75f9cf418d171a9de040aaf4c6f882b337ad3ad3270')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: the 20261127_crunchy_express_activate row must read OK.
--
-- ─── Rollback ──
--   New migration: UPDATE public.eatery_partners SET is_active = false WHERE id = 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434';

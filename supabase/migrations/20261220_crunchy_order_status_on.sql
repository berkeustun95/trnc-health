-- ═══════════════════════════════════════════════════════════════════════════
-- 20261220 — Crunchy Express: order status ON (order-status go-live step 5)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- DATA ONLY: eatery_partners.order_status_enabled false -> true on ONE row (bb9dad05-…, slug crunchy-express).
-- No schema, policy or grant change. This column is the switch for real (non-test) orders of this partner: the
-- customer's Siparişin card and the getadaapp.com/o/<code> page show status steps, the restaurant's PIN enrolment
-- is offered on a real order (Worker `pinable`), and verify returns `next` for an enrolled Crunchy phone.
-- Test orders were never gated by it (is_test OR status_enabled).
--
-- SOURCE: Berke, 2026-11-19: "is order_status_enabled still off for Crunchy Express? If yes, turn it on now for
-- Crunchy only." Ships after the production OTA that carries order status + privacy F1–F6 (group a9d2ae36,
-- main 161fcaab, 2026-11-19); web and docs privacy live 2026-11-18 (legal:live PASS).
--
-- WHO CAN READ / WRITE AFTER THIS: unchanged. anon and authenticated keep the existing SELECT on this column
-- (20261193); writes stay service_role / postgres only. A business setting, no personal data.
--
-- PRE-STATE (any failure raises, nothing applied; a re-run on an already-on row skips the UPDATE and re-checks the
-- post-state): the row exists with slug crunchy-express, is_active, order_method 'whatsapp'; a partner-scope PIN is
-- set for it (private.eatery_partner_pins) — without one the restaurant could never enrol. The pre value was read live
-- with the anon key before this file was written (false, 2026-11-19); the NOTICEs below are not relied on (the apply goes
-- through the Management API and may not show them) — the anon read after the apply is the proof.
-- POST-STATE: the row reads true; every OTHER partner's order_status_enabled is unchanged (md5 over id:value);
-- enabled partners = before + 1 (or + 0 on a re-run). Counts and booleans only.
--
-- ROLLBACK (manual, a NEW migration): UPDATE public.eatery_partners SET order_status_enabled = false
--   WHERE id = 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434';
--
-- Apply: gh workflow run supabase-migrate -f file=20261220_crunchy_order_status_on.sql (dry), then
-- -f apply=true (Berke approves production-db).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  c_id constant uuid := 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434';
  v_p          public.eatery_partners%ROWTYPE;
  v_pin        int;
  v_was        boolean;
  v_on_before  int;
  v_on_after   int;
  v_delta      int;
  v_others_b   text;
  v_others_a   text;
BEGIN
  SELECT * INTO v_p FROM public.eatery_partners WHERE id = c_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'crunchy-express row % not found. Nothing applied.', c_id;
  END IF;
  IF v_p.slug IS DISTINCT FROM 'crunchy-express' THEN
    RAISE EXCEPTION 'row % has slug [%], not crunchy-express. Nothing applied.', c_id, v_p.slug;
  END IF;
  IF v_p.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'crunchy-express is_active is [%], want true. Nothing applied.', v_p.is_active;
  END IF;
  IF v_p.order_method IS DISTINCT FROM 'whatsapp' THEN
    RAISE EXCEPTION 'crunchy-express order_method is [%], want whatsapp. Nothing applied.', v_p.order_method;
  END IF;
  SELECT count(*) INTO v_pin FROM private.eatery_partner_pins WHERE scope = 'partner' AND partner_id = c_id;
  IF v_pin IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'crunchy-express partner PIN rows: %, want 1. Issue the PIN first (Admin → Restaurant PINs). Nothing applied.', v_pin;
  END IF;

  v_was := v_p.order_status_enabled;
  v_delta := CASE WHEN v_was THEN 0 ELSE 1 END;
  SELECT count(*) FILTER (WHERE order_status_enabled) INTO v_on_before FROM public.eatery_partners;
  SELECT md5(COALESCE(string_agg(id::text || ':' || order_status_enabled::text, ',' ORDER BY id), ''))
    INTO v_others_b FROM public.eatery_partners WHERE id <> c_id;
  RAISE NOTICE 'pre: crunchy-express order_status_enabled = %, partner PIN set, enabled partners = %', v_was, v_on_before;

  IF v_was IS NOT TRUE THEN
    UPDATE public.eatery_partners SET order_status_enabled = true WHERE id = c_id;
  ELSE
    RAISE NOTICE 're-run: already on, UPDATE skipped';
  END IF;

  IF (SELECT order_status_enabled FROM public.eatery_partners WHERE id = c_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'post: crunchy-express order_status_enabled is not true';
  END IF;
  SELECT md5(COALESCE(string_agg(id::text || ':' || order_status_enabled::text, ',' ORDER BY id), ''))
    INTO v_others_a FROM public.eatery_partners WHERE id <> c_id;
  IF v_others_a IS DISTINCT FROM v_others_b THEN
    RAISE EXCEPTION 'post: another partner''s order_status_enabled changed';
  END IF;
  SELECT count(*) FILTER (WHERE order_status_enabled) INTO v_on_after FROM public.eatery_partners;
  IF v_on_after IS DISTINCT FROM v_on_before + v_delta THEN
    RAISE EXCEPTION 'post: enabled partners % (before %), want before + %', v_on_after, v_on_before, v_delta;
  END IF;
  RAISE NOTICE 'post: crunchy-express order_status_enabled = true, other partners unchanged, enabled partners = %', v_on_after;
END
$$;

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
VALUES ('20261220_crunchy_order_status_on.sql', 'ed126db7b84de72a7471c2792703f7eef03e0a047df2731afe8643e73ef91f91')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: the 20261220_crunchy_order_status_on row must read OK.

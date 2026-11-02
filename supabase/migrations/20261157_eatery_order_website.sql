-- ═══════════════════════════════════════════════════════════════════════════
-- 20261157 — Yeme-İçme: order_method 'website' + eatery_partners.brand_color + contact_events.item_id / 'order_website'
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SCHEMA ONLY. No partner row is created here (20261158 seeds Pasatiempo, the first website partner).
--
-- (1) eatery_partners_order_method_check widens from ('whatsapp','phone') to ('whatsapp','phone','website').
--       website  the partner takes orders on its own site: no basket in the app; the partner page and each dish card
--                open website_url in the in-app browser. create_eatery_order is NOT touched: it already refuses every
--                method but 'whatsapp' (order_not_supported, 20261144), so a website partner can never gain an order row.
--                Proof: its pg_get_functiondef md5 is captured before and compared after.
-- (2) eatery_partners.brand_color text NULL, CHECK '^#[0-9a-f]{6}$' (lower-case hex). The partner's own colour, used
--     for the in-app browser toolbar and the "order on the site" button. NULL = ADA's theme (Crunchy, Bidda).
-- (3) contact_events.item_id bigint NULL: the dish a handoff tap came from. CHECK: NULL, or module = 'eatery' and > 0.
--     No foreign key (same as entity_id: a counter must never block or cascade on a menu change).
--     contact_events_action_check gains 'order_website' (the "Sitede sipariş ver" tap).
--
-- ANONYMITY (20260910's contract, utils/logContactEvent.js RULE TWO): the risk is a RECURRING KEY tied to a person.
-- item_id names a restaurant's dish, the same for everyone who taps it: same class as entity_id (the partner) and
-- region. It cannot link two rows to one origin. Asked for by Berke (2026-11-02: "log each tap (partner, dish)").
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   • eatery_partners: NO policy or grant change. brand_color rides under the table-level SELECT grant (anon +
--     authenticated, guests included) and the existing RLS (active rows for everyone; inactive ones only with the ADA
--     Preview key). Writes stay service_role only: asserted that anon / authenticated cannot write the column.
--   • contact_events: anon and authenticated may now also INSERT item_id (column grant), exactly like lang (20261112).
--     Nobody but admin reads (ce_select_admin, unchanged); nobody updates or deletes; created_at stays unwritable.
--     The policy set (4) is asserted unchanged.
--
-- ⚠ ORDERING: apply BEFORE any OTA whose code selects brand_color (a select naming a missing column returns 42703 and
--   EMPTIES the eatery list) or sends item_id (the insert is refused and the tap dropped). The app sends item_id only
--   when it has one, so every other module's taps are unaffected either way.
--
-- Static on purpose: scripts/audit-schema-drift.mjs reads CHECK literals from this file.
--
-- Undo:
--   REVOKE INSERT (item_id) ON public.contact_events FROM anon, authenticated;
--   ALTER TABLE public.contact_events DROP COLUMN item_id;   -- also drops contact_events_item_id_check
--   (action CHECK and order_method CHECK: re-add the 20261123 / 20261144 sets, after removing any rows using the new values)
--   ALTER TABLE public.eatery_partners DROP COLUMN brand_color;
--
-- Apply: gh workflow run supabase-migrate -f file=20261157_eatery_order_website.sql (dry), then -f apply=true
-- (Berke approves production-db). ADDs columns ⇒ ends with NOTIFY pgrst (after COMMIT and RESET ROLE).
-- Re-runnable: a second apply finds every change in place, asserts it and changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── Pre-state (abort before changing anything) ─────────────────────────────
DO $$
DECLARE
  v_def text; v_set text[]; v_names text[]; v_t record;
  v_om_old  constant text[] := ARRAY['phone','whatsapp'];
  v_om_new  constant text[] := ARRAY['phone','website','whatsapp'];
  v_act_old constant text[] := ARRAY['book','call','call_secondary','email','facebook','instagram','maps','menu',
                                     'order_whatsapp','route_complete','website','whatsapp'];
  v_act_new constant text[] := ARRAY['book','call','call_secondary','email','facebook','instagram','maps','menu',
                                     'order_website','order_whatsapp','route_complete','website','whatsapp'];
BEGIN
  IF to_regclass('public.schema_migrations_applied') IS NULL
     OR (SELECT count(*) FROM public.schema_migrations_applied
          WHERE filename IN ('20261144_eatery_order_method.sql','20261123_eatery_dish_tags_order_whatsapp.sql')) IS DISTINCT FROM 2::bigint THEN
    RAISE EXCEPTION 'pre-state: 20261123 and 20261144 must both be in the ledger. Nothing applied.';
  END IF;
  IF to_regprocedure('public.create_eatery_order(uuid,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'pre-state: create_eatery_order(uuid,jsonb,text) is missing. Nothing applied.';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.eatery_partners'::regclass AND conname = 'eatery_partners_order_method_check';
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_set
    FROM regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''::text', 'g') AS m;
  IF v_set IS DISTINCT FROM v_om_old AND v_set IS DISTINCT FROM v_om_new THEN
    RAISE EXCEPTION 'pre-state: eatery_partners_order_method_check is neither {phone,whatsapp} (20261144) nor + website (re-apply). live set=% def=%', v_set, coalesce(v_def, '<missing>');
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_action_check';
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_set
    FROM regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''::text', 'g') AS m;
  IF v_set IS DISTINCT FROM v_act_old AND v_set IS DISTINCT FROM v_act_new THEN
    RAISE EXCEPTION 'pre-state: contact_events_action_check is neither the 12-action set (20261123) nor + order_website (re-apply). live set=% def=%', v_set, coalesce(v_def, '<missing>');
  END IF;

  -- New columns: absent, or exactly what this file makes (a re-apply).
  SELECT data_type, is_nullable, column_default INTO v_t FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'eatery_partners' AND column_name = 'brand_color';
  IF FOUND AND (v_t.data_type IS DISTINCT FROM 'text' OR v_t.is_nullable IS DISTINCT FROM 'YES' OR v_t.column_default IS NOT NULL) THEN
    RAISE EXCEPTION 'pre-state: eatery_partners.brand_color exists as % nullable=% default=% (want text NULL, no default). Nothing applied.', v_t.data_type, v_t.is_nullable, v_t.column_default;
  END IF;
  SELECT data_type, is_nullable, column_default INTO v_t FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'contact_events' AND column_name = 'item_id';
  IF FOUND AND (v_t.data_type IS DISTINCT FROM 'bigint' OR v_t.is_nullable IS DISTINCT FROM 'YES' OR v_t.column_default IS NOT NULL) THEN
    RAISE EXCEPTION 'pre-state: contact_events.item_id exists as % nullable=% default=% (want bigint NULL, no default). Nothing applied.', v_t.data_type, v_t.is_nullable, v_t.column_default;
  END IF;

  -- Policy sets this file must leave untouched (derived from the 1119 / 0910 files; printed on drift).
  SELECT array_agg(policyname::text ORDER BY policyname) INTO v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eatery_partners';
  IF v_names IS DISTINCT FROM ARRAY['eatery_partners_select_active','eatery_partners_select_preview'] THEN
    RAISE EXCEPTION 'pre-state: eatery_partners policies are % (want the 1119 pair). Nothing applied.', v_names;
  END IF;
  SELECT array_agg(policyname::text ORDER BY policyname) INTO v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = 'contact_events';
  PERFORM set_config('ada.m1157_ce_policies', coalesce(array_to_string(v_names, ','), ''), true);

  PERFORM set_config('ada.m1157_create_md5', md5(pg_get_functiondef('public.create_eatery_order(uuid,jsonb,text)'::regprocedure)), true);
  PERFORM set_config('ada.m1157_partners',
    (SELECT md5(COALESCE(string_agg((to_jsonb(p) - 'brand_color')::text, ',' ORDER BY p.id), '')) FROM public.eatery_partners p), true);
END $$;

-- ─── (1) order_method gains 'website' ───────────────────────────────────────
ALTER TABLE public.eatery_partners DROP CONSTRAINT IF EXISTS eatery_partners_order_method_check;
ALTER TABLE public.eatery_partners ADD  CONSTRAINT eatery_partners_order_method_check
  CHECK (order_method IN ('whatsapp','phone','website'));

COMMENT ON COLUMN public.eatery_partners.order_method IS
  'How a customer orders from this restaurant. whatsapp = the in-app basket that sends a WhatsApp order (the server records it via create_eatery_order). phone = call to order: no basket in the app. website = order on the partner''s own site (website_url, opened in the in-app browser): no basket in the app. create_eatery_order refuses phone and website (order_not_supported). NOT NULL, no DEFAULT: every partner seed must state its method. Writes: service_role only. 20261144, website 20261157.';

-- ─── (2) brand_color ────────────────────────────────────────────────────────
ALTER TABLE public.eatery_partners ADD COLUMN IF NOT EXISTS brand_color text NULL;
ALTER TABLE public.eatery_partners DROP CONSTRAINT IF EXISTS eatery_partners_brand_color_check;
ALTER TABLE public.eatery_partners ADD  CONSTRAINT eatery_partners_brand_color_check
  CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9a-f]{6}$');

COMMENT ON COLUMN public.eatery_partners.brand_color IS
  'The partner''s own colour as lower-case #rrggbb: in-app browser toolbar and the order-on-site button. NULL = ADA theme. 20261157.';

-- ─── (3) contact_events: 'order_website' + item_id ──────────────────────────
ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_action_check;
ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_action_check
  CHECK (action IN ('call','whatsapp','call_secondary','website','maps','route_complete','book',
                    'instagram','facebook','email','menu','order_whatsapp','order_website'));

ALTER TABLE public.contact_events ADD COLUMN IF NOT EXISTS item_id bigint NULL;
ALTER TABLE public.contact_events DROP CONSTRAINT IF EXISTS contact_events_item_id_check;
ALTER TABLE public.contact_events ADD  CONSTRAINT contact_events_item_id_check
  CHECK (item_id IS NULL OR (module = 'eatery' AND item_id > 0));
GRANT INSERT (item_id) ON public.contact_events TO anon, authenticated;

COMMENT ON COLUMN public.contact_events.item_id IS
  'eatery_menu_items.id of the dish a handoff tap came from (module eatery only). A dish, the same for everyone: never a key to a person. No FK. NULL = not a dish tap. 20261157.';

-- ─── Post-state + rolled-back probes ────────────────────────────────────────
DO $$
DECLARE
  v_def text; v_set text[]; v_names text[]; v_n int;
  v_probe uuid := gen_random_uuid();
  v_partner uuid := gen_random_uuid();
  v_anon_tap   text := 'not run';
  v_auth_tap   text := 'not run';
  v_old_tap    text := 'not run';
  v_item_other text := 'not run';
  v_item_zero  text := 'not run';
  v_bad_act    text := 'not run';
  v_web        text := 'not run';
  v_bad_om     text := 'not run';
  v_color_ok   text := 'not run';
  v_color_up   text := 'not run';
  v_color_name text := 'not run';
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.eatery_partners'::regclass AND conname = 'eatery_partners_order_method_check' AND convalidated;
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_set FROM regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''::text', 'g') AS m;
  IF v_set IS DISTINCT FROM ARRAY['phone','website','whatsapp'] THEN
    RAISE EXCEPTION 'after: order_method CHECK allows % (def: %)', v_set, coalesce(v_def, '<missing or not validated>');
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint c
   WHERE c.conrelid = 'public.eatery_partners'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%order_method%';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'after: % CHECKs mention order_method (want 1)', v_n; END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_action_check' AND convalidated;
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_set FROM regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''::text', 'g') AS m;
  IF v_set IS DISTINCT FROM ARRAY['book','call','call_secondary','email','facebook','instagram','maps','menu',
                                  'order_website','order_whatsapp','route_complete','website','whatsapp'] THEN
    RAISE EXCEPTION 'after: contact_events action CHECK allows % (def: %)', v_set, coalesce(v_def, '<missing or not validated>');
  END IF;

  -- Untouched: create_eatery_order, every existing partner row (bar the new column), both policy sets.
  IF md5(pg_get_functiondef('public.create_eatery_order(uuid,jsonb,text)'::regprocedure)) IS DISTINCT FROM current_setting('ada.m1157_create_md5', true) THEN
    RAISE EXCEPTION 'after: create_eatery_order changed';
  END IF;
  IF (SELECT md5(COALESCE(string_agg((to_jsonb(p) - 'brand_color')::text, ',' ORDER BY p.id), '')) FROM public.eatery_partners p)
     IS DISTINCT FROM current_setting('ada.m1157_partners', true) THEN
    RAISE EXCEPTION 'after: an existing eatery_partners row changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.eatery_partners WHERE brand_color IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM public.eatery_partners WHERE slug = 'pasatiempo') THEN
    RAISE EXCEPTION 'after: a partner has a brand_color before any seed sets one';
  END IF;
  SELECT array_agg(policyname::text ORDER BY policyname) INTO v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eatery_partners';
  IF v_names IS DISTINCT FROM ARRAY['eatery_partners_select_active','eatery_partners_select_preview'] THEN
    RAISE EXCEPTION 'after: eatery_partners policies are %', v_names;
  END IF;
  SELECT array_agg(policyname::text ORDER BY policyname) INTO v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = 'contact_events';
  IF coalesce(array_to_string(v_names, ','), '') IS DISTINCT FROM current_setting('ada.m1157_ce_policies', true) THEN
    RAISE EXCEPTION 'after: contact_events policies changed: % (before %)', v_names, current_setting('ada.m1157_ce_policies', true);
  END IF;

  -- Grants from the catalog, with positive controls beside each denial.
  IF NOT (has_column_privilege('anon', 'public.contact_events', 'item_id', 'INSERT')
      AND has_column_privilege('authenticated', 'public.contact_events', 'item_id', 'INSERT')) THEN
    RAISE EXCEPTION 'after: item_id is not insertable by anon and authenticated';
  END IF;
  IF has_column_privilege('anon', 'public.contact_events', 'created_at', 'INSERT')
     OR has_column_privilege('authenticated', 'public.contact_events', 'created_at', 'INSERT')
     OR has_table_privilege('anon', 'public.contact_events', 'SELECT') THEN
    RAISE EXCEPTION 'after: contact_events grants widened: created_at insertable or anon can read';
  END IF;
  IF NOT (has_column_privilege('anon', 'public.eatery_partners', 'brand_color', 'SELECT')
      AND has_column_privilege('authenticated', 'public.eatery_partners', 'brand_color', 'SELECT'))
     OR has_column_privilege('anon', 'public.eatery_partners', 'brand_color', 'INSERT,UPDATE,REFERENCES')
     OR has_column_privilege('authenticated', 'public.eatery_partners', 'brand_color', 'INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'after: client privileges on brand_color are not SELECT-only';
  END IF;

  -- Behaviour probes in a sub-block that always rolls back. Taps run AS the client roles, with exactly the
  -- columns the app sends.
  BEGIN
    BEGIN
      SET LOCAL ROLE anon;
      INSERT INTO public.contact_events (id, module, entity_id, action, region, item_id)
      VALUES (gen_random_uuid(), 'eatery', v_probe, 'order_website', NULL, 42);
      SET LOCAL ROLE postgres; v_anon_tap := 'accepted';
    EXCEPTION WHEN OTHERS THEN SET LOCAL ROLE postgres; v_anon_tap := 'REFUSED: ' || SQLERRM;
    END;
    BEGIN
      SET LOCAL ROLE authenticated;
      INSERT INTO public.contact_events (id, module, entity_id, action, region, item_id)
      VALUES (gen_random_uuid(), 'eatery', v_probe, 'order_website', NULL, 7);
      SET LOCAL ROLE postgres; v_auth_tap := 'accepted';
    EXCEPTION WHEN OTHERS THEN SET LOCAL ROLE postgres; v_auth_tap := 'REFUSED: ' || SQLERRM;
    END;
    -- Positive control: the shape every existing caller sends (no item_id) still lands.
    BEGIN
      SET LOCAL ROLE anon;
      INSERT INTO public.contact_events (id, module, entity_id, action, region)
      VALUES (gen_random_uuid(), 'towing', v_probe, 'call', 'nicosia');
      SET LOCAL ROLE postgres; v_old_tap := 'accepted';
    EXCEPTION WHEN OTHERS THEN SET LOCAL ROLE postgres; v_old_tap := 'REFUSED: ' || SQLERRM;
    END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action, item_id) VALUES ('towing', v_probe, 'call', 5);
      v_item_other := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_item_other := 'refused';
    END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action, item_id) VALUES ('eatery', v_probe, 'order_website', 0);
      v_item_zero := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_item_zero := 'refused';
    END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action) VALUES ('eatery', v_probe, 'order_zz');
      v_bad_act := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_act := 'refused';
    END;
    BEGIN
      INSERT INTO public.eatery_partners (id, slug, name, category, order_method, brand_color)
      VALUES (v_partner, 'zz-probe-1157', 'ZZ probe 1157', 'restaurant', 'website', '#994b17');
      v_web := 'accepted'; v_color_ok := 'accepted';
    EXCEPTION WHEN check_violation THEN v_web := 'REFUSED: ' || SQLERRM;
    END;
    BEGIN
      UPDATE public.eatery_partners SET order_method = 'email' WHERE id = v_partner;
      v_bad_om := CASE WHEN FOUND THEN 'ACCEPTED' ELSE 'no row' END;
    EXCEPTION WHEN check_violation THEN v_bad_om := 'refused';
    END;
    BEGIN
      UPDATE public.eatery_partners SET brand_color = '#994B17' WHERE id = v_partner;
      v_color_up := CASE WHEN FOUND THEN 'ACCEPTED' ELSE 'no row' END;
    EXCEPTION WHEN check_violation THEN v_color_up := 'refused';
    END;
    BEGIN
      UPDATE public.eatery_partners SET brand_color = 'brown' WHERE id = v_partner;
      v_color_name := CASE WHEN FOUND THEN 'ACCEPTED' ELSE 'no row' END;
    EXCEPTION WHEN check_violation THEN v_color_name := 'refused';
    END;
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;
  IF v_anon_tap   IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'anon order_website tap with item_id was %', v_anon_tap; END IF;
  IF v_auth_tap   IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'authenticated order_website tap with item_id was %', v_auth_tap; END IF;
  IF v_old_tap    IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'POSITIVE CONTROL: an existing-shape towing tap was %', v_old_tap; END IF;
  IF v_item_other IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'item_id on a non-eatery tap was %', v_item_other; END IF;
  IF v_item_zero  IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'item_id 0 was %', v_item_zero; END IF;
  IF v_bad_act    IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'CONTROL FAILED: unknown action was %', v_bad_act; END IF;
  IF v_web        IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'a website partner was %', v_web; END IF;
  IF v_color_ok   IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'brand_color #994b17 was %', v_color_ok; END IF;
  IF v_bad_om     IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'CONTROL FAILED: order_method email was %', v_bad_om; END IF;
  IF v_color_up   IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'upper-case brand_color was %', v_color_up; END IF;
  IF v_color_name IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'brand_color "brown" was %', v_color_name; END IF;
  IF EXISTS (SELECT 1 FROM public.contact_events WHERE entity_id = v_probe)
     OR EXISTS (SELECT 1 FROM public.eatery_partners WHERE id = v_partner) THEN
    RAISE EXCEPTION 'probe rows survived';
  END IF;
  RAISE NOTICE '20261157: order_method {phone,website,whatsapp}; brand_color + item_id added; create_eatery_order, partner rows and policies unchanged';
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
VALUES ('20261157_eatery_order_website.sql', 'f76da3162f38ccaa51e8d81e6614833382c7e78a3b8614a44e02c67b1126f71c')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';

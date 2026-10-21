-- ═══════════════════════════════════════════════════════════════════════════
-- 20261123 — Yeme-İçme: dish-finder tags on eatery_menu_items + contact_events action 'order_whatsapp'
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SCHEMA ONLY, no data. Crunchy Express's rows are not touched (they stay untagged).
--
-- (1) eatery_menu_items gains four nullable tag columns that feed the dish-finder quiz:
--       role     text    main | side | sauce | drink | dessert
--       protein  text    chicken | beef | pork | veg | none
--       spicy    boolean
--       portion  text    snack | meal | share
--     NULL = untagged = never suggested by the quiz. eatery_menu_items_tags_check: role NULL => protein, spicy and
--     portion all NULL; role = 'main' => protein, spicy and portion all set; role side/sauce/drink/dessert =>
--     protein and spicy set, portion NULL (portion only makes sense for a main). A half-tagged dish is refused.
--     A price band is deliberately NOT stored: the client computes it from price.
--
-- (2) contact_events_action_check gains 'order_whatsapp' (the "order on WhatsApp" tap). The module CHECK is
--     not touched (it already contains 'eatery'; asserted).
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   UNCHANGED by this file; no policy, no grant is created or altered.
--   • READ the new columns: the existing eatery_menu_items SELECT grant is TABLE-level
--     (GRANT SELECT ON TABLE ... TO anon, authenticated, 20261115), so it covers the new columns with no
--     change. Rows are visible exactly as before: anyone sees an item while its partner is active
--     (eatery_menu_items_select_active); the ADA Preview app's key also sees items of an inactive partner
--     (eatery_menu_items_select_preview, 20261119/1120). Asserted below: still exactly those 2 policies.
--   • WRITE the tags: service_role only (migrations / admin SQL / Edge Functions). anon and authenticated
--     (guests included) have no INSERT/UPDATE privilege on the table or on the new columns (asserted).
--   • Tags describe a dish, never a person. contact_events: anyone using the app may still INSERT a tap row
--     (unchanged); the new value only widens the allowed action vocabulary.
--
-- Apply: gh workflow run supabase-migrate -f file=20261123_eatery_dish_tags_order_whatsapp.sql (dry), then
-- -f apply=true (Berke approves production-db). ADDs columns ⇒ ends with NOTIFY pgrst (after COMMIT and RESET ROLE).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── Pre-state (abort before changing anything) ─────────────────────────────
-- contact_events action CHECK is EXACTLY the 11 actions 20261115 left (or that + order_whatsapp: a re-apply);
-- module CHECK still contains 'eatery'; the four tag columns are all absent or all present (a re-apply);
-- eatery_menu_items has exactly its 2 policies.
DO $$
DECLARE
  v_def  text;
  v_set  text[];
  v_want_act constant text[] := ARRAY['book','call','call_secondary','email','facebook','instagram','maps','menu',
                                      'route_complete','website','whatsapp'];
  v_new_act  constant text[] := v_want_act || ARRAY['order_whatsapp'];
  v_cols int;
  v_names text[];
BEGIN
  IF to_regclass('public.eatery_menu_items') IS NULL THEN
    RAISE EXCEPTION 'public.eatery_menu_items is missing (20261115 not applied)';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_action_check';
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_set
    FROM regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''::text', 'g') AS m;
  IF v_set IS NULL OR NOT ((v_set @> v_want_act AND v_set <@ v_want_act) OR (v_set @> v_new_act AND v_set <@ v_new_act)) THEN
    RAISE EXCEPTION 'contact_events_action_check is neither the 11-action set (20261115) nor that + order_whatsapp (this file, re-applied). live set=% def=%', v_set, coalesce(v_def, '<missing>');
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_module_check';
  IF v_def IS NULL OR v_def NOT LIKE '%''eatery''::text%' THEN
    RAISE EXCEPTION 'contact_events_module_check is missing or lacks eatery. def=%', coalesce(v_def, '<missing>');
  END IF;

  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'eatery_menu_items' AND column_name IN ('role','protein','spicy','portion');
  IF v_cols NOT IN (0, 4) THEN
    RAISE EXCEPTION 'eatery_menu_items has % of the 4 tag columns (want 0, or 4 on a re-apply)', v_cols;
  END IF;

  SELECT array_agg(policyname::text ORDER BY policyname) INTO v_names
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eatery_menu_items';
  IF v_names IS DISTINCT FROM ARRAY['eatery_menu_items_select_active','eatery_menu_items_select_preview'] THEN
    RAISE EXCEPTION 'pre-state: eatery_menu_items policies are % (want select_active + select_preview)', v_names;
  END IF;
  RAISE NOTICE 'pre-state ok: action set %, tag columns present: %, policies: %', v_set, v_cols, v_names;
END $$;

-- ─── (1) Tag columns ────────────────────────────────────────────────────────
-- Static literals on purpose: scripts/audit-schema-drift.mjs reads CHECK literals from this file.
ALTER TABLE public.eatery_menu_items ADD COLUMN IF NOT EXISTS role    text;
ALTER TABLE public.eatery_menu_items ADD COLUMN IF NOT EXISTS protein text;
ALTER TABLE public.eatery_menu_items ADD COLUMN IF NOT EXISTS spicy   boolean;
ALTER TABLE public.eatery_menu_items ADD COLUMN IF NOT EXISTS portion text;

ALTER TABLE public.eatery_menu_items DROP CONSTRAINT IF EXISTS eatery_menu_items_role_check;
ALTER TABLE public.eatery_menu_items ADD  CONSTRAINT eatery_menu_items_role_check
  CHECK (role IS NULL OR role IN ('main','side','sauce','drink','dessert'));
ALTER TABLE public.eatery_menu_items DROP CONSTRAINT IF EXISTS eatery_menu_items_protein_check;
ALTER TABLE public.eatery_menu_items ADD  CONSTRAINT eatery_menu_items_protein_check
  CHECK (protein IS NULL OR protein IN ('chicken','beef','pork','veg','none'));
ALTER TABLE public.eatery_menu_items DROP CONSTRAINT IF EXISTS eatery_menu_items_portion_check;
ALTER TABLE public.eatery_menu_items ADD  CONSTRAINT eatery_menu_items_portion_check
  CHECK (portion IS NULL OR portion IN ('snack','meal','share'));
ALTER TABLE public.eatery_menu_items DROP CONSTRAINT IF EXISTS eatery_menu_items_tags_check;
ALTER TABLE public.eatery_menu_items ADD  CONSTRAINT eatery_menu_items_tags_check
  CHECK ((role IS NULL AND protein IS NULL AND spicy IS NULL AND portion IS NULL)
      OR (role = 'main' AND protein IS NOT NULL AND spicy IS NOT NULL AND portion IS NOT NULL)
      OR (role IN ('side','sauce','drink','dessert') AND protein IS NOT NULL AND spicy IS NOT NULL AND portion IS NULL));

COMMENT ON COLUMN public.eatery_menu_items.role IS
  'Dish-finder tag: what the item is (main, side, sauce, drink, dessert). NULL = untagged = never suggested by the quiz. Untagged (all NULL), or tagged with protein and spicy; portion is set for a main and NULL for every other role (eatery_menu_items_tags_check). 20261123.';
COMMENT ON COLUMN public.eatery_menu_items.protein IS
  'Dish-finder tag: main protein (chicken, beef, pork, veg, none). NULL only while untagged. 20261123.';
COMMENT ON COLUMN public.eatery_menu_items.spicy IS
  'Dish-finder tag: true when the dish is spicy. NULL only while untagged (false is a real answer). 20261123.';
COMMENT ON COLUMN public.eatery_menu_items.portion IS
  'Dish-finder tag: portion size (snack, meal, share). Set for a main, NULL for every other role and while untagged. A price band is deliberately not stored; the client computes it from price. 20261123.';

-- ─── (2) contact_events: action 'order_whatsapp' ────────────────────────────
ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_action_check;
ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_action_check
  CHECK (action IN ('call','whatsapp','call_secondary','website','maps','route_complete','book',
                    'instagram','facebook','email','menu','order_whatsapp'));

-- ─── Assertions + probes (inside the transaction; a failure rolls the file back) ─
DO $$
DECLARE
  v_def   text;
  v_set   text[];
  v_names text[];
  v_cols  int;
  v_colinfo text;
  v_acl   int;
  v_priv  text;
  v_probe uuid;
  v_before_n int; v_before_tagged int; v_after_n int; v_after_tagged int;
  v_full text; v_side_np text; v_sauce_p text; v_main_np text; v_role_only text; v_bad_role text; v_bad_protein text; v_bad_portion text; v_untagged text; v_spicy_only text;
  v_ce_new text; v_ce_old text; v_ce_bad text;
  v_leftover int;
BEGIN
  -- Columns: exact types, nullable, no default.
  SELECT count(*), string_agg(column_name || ':' || data_type, ', ' ORDER BY column_name) INTO v_cols, v_colinfo
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'eatery_menu_items' AND is_nullable = 'YES' AND column_default IS NULL
     AND ((column_name IN ('role','protein','portion') AND data_type = 'text') OR (column_name = 'spicy' AND data_type = 'boolean'));
  IF v_cols IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'tag columns: % of 4 are nullable/no-default with the right type: %', v_cols, v_colinfo;
  END IF;

  -- The four constraints exist (count them, print them).
  SELECT array_agg(conname::text ORDER BY conname) INTO v_names FROM pg_constraint
   WHERE conrelid = 'public.eatery_menu_items'::regclass
     AND conname IN ('eatery_menu_items_role_check','eatery_menu_items_protein_check','eatery_menu_items_portion_check','eatery_menu_items_tags_check');
  IF coalesce(array_length(v_names, 1), 0) IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'tag constraints present: % (want 4)', v_names;
  END IF;

  -- Policies and grants UNCHANGED: exactly the 2 policies, no column-limited ACL on the new columns,
  -- clients can read them and cannot write them (positive control: service_role can write them).
  SELECT array_agg(policyname::text ORDER BY policyname) INTO v_names
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eatery_menu_items';
  IF v_names IS DISTINCT FROM ARRAY['eatery_menu_items_select_active','eatery_menu_items_select_preview'] THEN
    RAISE EXCEPTION 'eatery_menu_items policies changed: %', v_names;
  END IF;
  SELECT count(*) INTO v_acl FROM pg_attribute
   WHERE attrelid = 'public.eatery_menu_items'::regclass AND attname IN ('role','protein','spicy','portion') AND attacl IS NOT NULL;
  IF v_acl IS DISTINCT FROM 0 THEN RAISE EXCEPTION '% tag columns carry a column-level ACL (want 0: the table-level grant covers them)', v_acl; END IF;
  SELECT string_agg(r || ':' || CASE WHEN has_column_privilege(r, 'public.eatery_menu_items', c, 'SELECT') THEN 'S' ELSE '-' END
                      || CASE WHEN has_column_privilege(r, 'public.eatery_menu_items', c, 'INSERT') THEN 'I' ELSE '-' END
                      || CASE WHEN has_column_privilege(r, 'public.eatery_menu_items', c, 'UPDATE') THEN 'U' ELSE '-' END
                      || '(' || c || ')', ' ' ORDER BY r, c) INTO v_priv
    FROM unnest(ARRAY['anon','authenticated','service_role']) r, unnest(ARRAY['role','protein','spicy','portion']) c;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated']) r, unnest(ARRAY['role','protein','spicy','portion']) c
              WHERE NOT has_column_privilege(r, 'public.eatery_menu_items', c, 'SELECT')
                 OR has_column_privilege(r, 'public.eatery_menu_items', c, 'INSERT,UPDATE,REFERENCES'))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['role','protein','spicy','portion']) c
                 WHERE NOT has_column_privilege('service_role', 'public.eatery_menu_items', c, 'SELECT,INSERT,UPDATE')) THEN
    RAISE EXCEPTION 'tag column privileges wrong: %', v_priv;
  END IF;

  -- contact_events: action set is exactly the 12; module still has eatery.
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_action_check';
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_set FROM regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''::text', 'g') AS m;
  IF v_set IS DISTINCT FROM ARRAY['book','call','call_secondary','email','facebook','instagram','maps','menu',
                                  'order_whatsapp','route_complete','website','whatsapp'] THEN
    RAISE EXCEPTION 'contact_events_action_check post-state is not the 12-action set. live=% def=%', v_set, coalesce(v_def, '<missing>');
  END IF;
  RAISE NOTICE 'contact_events_action_check now: %', v_def;
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_module_check';
  IF v_def IS NULL OR v_def NOT LIKE '%''eatery''::text%' THEN
    RAISE EXCEPTION 'contact_events_module_check lost eatery: %', coalesce(v_def, '<missing>');
  END IF;

  -- Existing rows (Crunchy) stay untagged and are not touched by the probes.
  SELECT count(*), count(*) FILTER (WHERE role IS NOT NULL OR protein IS NOT NULL OR spicy IS NOT NULL OR portion IS NOT NULL)
    INTO v_before_n, v_before_tagged FROM public.eatery_menu_items;

  -- BEHAVIOUR on a throwaway INACTIVE probe partner, rolled back by a sentinel (variables survive, rows do not).
  BEGIN
    INSERT INTO public.eatery_partners (slug, name, category) VALUES ('zz-tags-probe', 'zz tags probe', 'cafe') RETURNING id INTO v_probe;

    BEGIN
      INSERT INTO public.eatery_menu_items (partner_id, section, name, role, protein, spicy, portion)
        VALUES (v_probe, 'zz', 'zz full', 'main', 'chicken', false, 'meal');
      v_full := 'accepted';
    EXCEPTION WHEN check_violation THEN v_full := 'REFUSED'; END;
    BEGIN
      INSERT INTO public.eatery_menu_items (partner_id, section, name) VALUES (v_probe, 'zz', 'zz untagged');
      v_untagged := 'accepted';
    EXCEPTION WHEN check_violation THEN v_untagged := 'REFUSED'; END;
    BEGIN
      INSERT INTO public.eatery_menu_items (partner_id, section, name, role, protein, spicy, portion)
        VALUES (v_probe, 'zz', 'zz side no portion', 'side', 'veg', false, NULL);
      v_side_np := 'accepted';
    EXCEPTION WHEN check_violation THEN v_side_np := 'REFUSED'; END;
    BEGIN
      INSERT INTO public.eatery_menu_items (partner_id, section, name, role, protein, spicy, portion)
        VALUES (v_probe, 'zz', 'zz sauce with portion', 'sauce', 'none', false, 'snack');
      v_sauce_p := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_sauce_p := 'refused'; END;
    BEGIN
      INSERT INTO public.eatery_menu_items (partner_id, section, name, role, protein, spicy, portion)
        VALUES (v_probe, 'zz', 'zz main no portion', 'main', 'beef', true, NULL);
      v_main_np := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_main_np := 'refused'; END;
    BEGIN
      INSERT INTO public.eatery_menu_items (partner_id, section, name, role, protein, spicy, portion)
        VALUES (v_probe, 'zz', 'zz role only', 'side', NULL, NULL, NULL);
      v_role_only := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_role_only := 'refused'; END;
    BEGIN
      INSERT INTO public.eatery_menu_items (partner_id, section, name, role, protein, spicy, portion)
        VALUES (v_probe, 'zz', 'zz spicy only', NULL, NULL, true, NULL);
      v_spicy_only := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_spicy_only := 'refused'; END;
    BEGIN
      INSERT INTO public.eatery_menu_items (partner_id, section, name, role, protein, spicy, portion)
        VALUES (v_probe, 'zz', 'zz bad protein', 'main', 'fish', false, 'meal');
      v_bad_protein := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_protein := 'refused'; END;
    BEGIN
      INSERT INTO public.eatery_menu_items (partner_id, section, name, role, protein, spicy, portion)
        VALUES (v_probe, 'zz', 'zz bad role', 'starter', 'veg', false, 'meal');
      v_bad_role := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_role := 'refused'; END;
    BEGIN
      INSERT INTO public.eatery_menu_items (partner_id, section, name, role, protein, spicy, portion)
        VALUES (v_probe, 'zz', 'zz bad portion', 'main', 'veg', false, 'huge');
      v_bad_portion := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_portion := 'refused'; END;

    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action) VALUES ('eatery', v_probe, 'order_whatsapp');
      v_ce_new := 'accepted';
    EXCEPTION WHEN check_violation THEN v_ce_new := 'REFUSED'; END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action) VALUES ('eatery', v_probe, 'menu');
      v_ce_old := 'accepted';
    EXCEPTION WHEN check_violation THEN v_ce_old := 'REFUSED'; END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action) VALUES ('eatery', v_probe, 'zzaction');
      v_ce_bad := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_ce_bad := 'refused'; END;

    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_full IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'CONTROL FAILED: fully tagged row was %', v_full; END IF;
  IF v_untagged IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'CONTROL FAILED: untagged row was %', v_untagged; END IF;
  IF v_side_np IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'CONTROL FAILED: side with portion NULL was %', v_side_np; END IF;
  IF v_sauce_p IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'sauce with portion set was %', v_sauce_p; END IF;
  IF v_main_np IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'main with portion NULL was %', v_main_np; END IF;
  IF v_role_only IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'role set but protein/spicy NULL was %', v_role_only; END IF;
  IF v_spicy_only IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'spicy set with role/protein/portion NULL was %', v_spicy_only; END IF;
  IF v_bad_protein IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'bad protein was %', v_bad_protein; END IF;
  IF v_bad_role IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'bad role was %', v_bad_role; END IF;
  IF v_bad_portion IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'bad portion was %', v_bad_portion; END IF;
  IF v_ce_new IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'contact_events eatery/order_whatsapp was %', v_ce_new; END IF;
  IF v_ce_old IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'CONTROL FAILED: contact_events eatery/menu was %', v_ce_old; END IF;
  IF v_ce_bad IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'contact_events bogus action was %', v_ce_bad; END IF;

  -- The sentinel rolled everything back: no probe partner, item or tap row survives; existing rows untouched.
  SELECT count(*) INTO v_leftover FROM public.eatery_partners WHERE slug = 'zz-tags-probe';
  IF v_leftover IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'probe partner survived the rollback'; END IF;
  SELECT count(*) INTO v_leftover FROM public.contact_events WHERE module = 'eatery' AND entity_id = v_probe;
  IF v_leftover IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'probe contact_events rows survived the rollback'; END IF;
  SELECT count(*), count(*) FILTER (WHERE role IS NOT NULL OR protein IS NOT NULL OR spicy IS NOT NULL OR portion IS NOT NULL)
    INTO v_after_n, v_after_tagged FROM public.eatery_menu_items;
  IF v_after_n IS DISTINCT FROM v_before_n OR v_after_tagged IS DISTINCT FROM v_before_tagged THEN
    RAISE EXCEPTION 'eatery_menu_items rows changed: % rows / % tagged before, % / % after', v_before_n, v_before_tagged, v_after_n, v_after_tagged;
  END IF;

  RAISE NOTICE 'tag columns: %', v_colinfo;
  RAISE NOTICE 'tag constraints: %', v_names;
  RAISE NOTICE 'column privileges: %', v_priv;
  RAISE NOTICE 'probes: full=% untagged=% side-no-portion=% sauce-with-portion=% main-no-portion=% role-only=% spicy-only=% bad-protein=% bad-role=% bad-portion=% | order_whatsapp=% menu=% bogus=%',
    v_full, v_untagged, v_side_np, v_sauce_p, v_main_np, v_role_only, v_spicy_only, v_bad_protein, v_bad_role, v_bad_portion, v_ce_new, v_ce_old, v_ce_bad;
  RAISE NOTICE 'eatery_menu_items rows: % (tagged % ), unchanged', v_after_n, v_after_tagged;
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
VALUES ('20261123_eatery_dish_tags_order_whatsapp.sql', 'cf1e77956ace1f3bbe8375eb7b7708c5cb0ca4afc410c2b42f53d7e0f7a830a1')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: every 20261123_eatery_dish_tags_order_whatsapp row must read OK, and the
--   1115 action token stands down (superseded) once the ledger records this file.
--
-- ─── Rollback (only if abandoned; refuses if any dish is tagged, so drop tags first) ──
--   ALTER TABLE public.eatery_menu_items DROP CONSTRAINT IF EXISTS eatery_menu_items_tags_check;
--   ALTER TABLE public.eatery_menu_items DROP CONSTRAINT IF EXISTS eatery_menu_items_role_check;
--   ALTER TABLE public.eatery_menu_items DROP CONSTRAINT IF EXISTS eatery_menu_items_protein_check;
--   ALTER TABLE public.eatery_menu_items DROP CONSTRAINT IF EXISTS eatery_menu_items_portion_check;
--   ALTER TABLE public.eatery_menu_items DROP COLUMN IF EXISTS role, DROP COLUMN IF EXISTS protein,
--     DROP COLUMN IF EXISTS spicy, DROP COLUMN IF EXISTS portion;
--   DELETE FROM public.contact_events WHERE action = 'order_whatsapp';
--   ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_action_check;
--   ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_action_check
--     CHECK (action IN ('call','whatsapp','call_secondary','website','maps','route_complete','book',
--                       'instagram','facebook','email','menu'));

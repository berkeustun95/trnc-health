-- ═══════════════════════════════════════════════════════════════════════════
-- 20261159 — Yeme-İçme: eatery_menu_items.partner_item_id (the partner's own id for a dish)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SCHEMA ONLY. A website partner's basket hands off to the partner's own site as ?cart=ID:QTY,... (Berke, 2026-11-02);
-- the ids are THE PARTNER'S, not ours. One nullable text column, NULL = unknown / not a website partner (every existing
-- row). CHECK: 1-64 chars of [A-Za-z0-9_-] (it goes into a URL unescaped). Partial UNIQUE index on (partner_id,
-- partner_item_id) WHERE NOT NULL: one partner never maps two dishes to one id. 20261160 fills Pasatiempo's 83.
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   UNCHANGED; no policy or grant is created or altered. READ: the table-level SELECT grant (20261115) covers the column;
--   RLS still decides the rows (an inactive partner's items only with the ADA Preview key). WRITE: service_role only
--   (asserted: anon / authenticated cannot INSERT or UPDATE it). A restaurant's dish id, never a person.
--
-- ⚠ ORDERING: apply BEFORE any OTA whose EateryScreen COLS selects partner_item_id (a missing column is 42703 and empties
--   Yeme-İçme). check-required-columns gates it.
--
-- Apply: with 20261160 in one run: gh workflow run supabase-migrate -f files="20261159_eatery_menu_items_partner_item_id.sql
-- 20261160_pasatiempo_owner_data.sql" (dry), then -f apply=true (Berke approves production-db). ADDs a column ⇒ NOTIFY pgrst.
-- Re-runnable: a second apply finds column, CHECK and index in place (asserted) and changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE v_t record; v_names text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261158_pasatiempo_data.sql') THEN
    RAISE EXCEPTION 'pre-state: 20261158_pasatiempo_data.sql is not in the ledger. Nothing applied.';
  END IF;
  SELECT data_type, is_nullable, column_default INTO v_t FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'eatery_menu_items' AND column_name = 'partner_item_id';
  IF FOUND AND (v_t.data_type IS DISTINCT FROM 'text' OR v_t.is_nullable IS DISTINCT FROM 'YES' OR v_t.column_default IS NOT NULL) THEN
    RAISE EXCEPTION 'pre-state: partner_item_id exists as % nullable=% default=% (want text NULL, no default). Nothing applied.', v_t.data_type, v_t.is_nullable, v_t.column_default;
  END IF;
  SELECT array_agg(policyname::text ORDER BY policyname) INTO v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eatery_menu_items';
  IF v_names IS DISTINCT FROM ARRAY['eatery_menu_items_select_active','eatery_menu_items_select_preview'] THEN
    RAISE EXCEPTION 'pre-state: eatery_menu_items policies are % (want the 1119 pair). Nothing applied.', v_names;
  END IF;
  PERFORM set_config('ada.m1159_items',
    (SELECT md5(COALESCE(string_agg((to_jsonb(i) - 'partner_item_id')::text, ',' ORDER BY i.id), '')) FROM public.eatery_menu_items i), true);
END $$;

ALTER TABLE public.eatery_menu_items ADD COLUMN IF NOT EXISTS partner_item_id text NULL;
ALTER TABLE public.eatery_menu_items DROP CONSTRAINT IF EXISTS eatery_menu_items_partner_item_id_check;
ALTER TABLE public.eatery_menu_items ADD  CONSTRAINT eatery_menu_items_partner_item_id_check
  CHECK (partner_item_id IS NULL OR partner_item_id ~ '^[A-Za-z0-9_-]{1,64}$');
CREATE UNIQUE INDEX IF NOT EXISTS eatery_menu_items_partner_item_id_uniq
  ON public.eatery_menu_items (partner_id, partner_item_id) WHERE partner_item_id IS NOT NULL;

COMMENT ON COLUMN public.eatery_menu_items.partner_item_id IS
  'The partner''s own id for this dish (its site''s menu database): a website partner''s basket hands off as ?cart=ID:QTY. NULL = unknown. 1-64 [A-Za-z0-9_-], unique per partner. 20261159.';

DO $$
DECLARE v_names text[]; v_ok text := 'not run'; v_bad text := 'not run'; v_dup text := 'not run'; v_p uuid := gen_random_uuid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'eatery_menu_items'
                  AND column_name = 'partner_item_id' AND data_type = 'text' AND is_nullable = 'YES' AND column_default IS NULL) THEN
    RAISE EXCEPTION 'after: partner_item_id is not text NULL without default';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index x JOIN pg_class c ON c.oid = x.indexrelid
                  WHERE c.relname = 'eatery_menu_items_partner_item_id_uniq' AND x.indisunique AND x.indpred IS NOT NULL
                    AND x.indrelid = 'public.eatery_menu_items'::regclass) THEN
    RAISE EXCEPTION 'after: eatery_menu_items_partner_item_id_uniq is not a partial UNIQUE index on eatery_menu_items';
  END IF;
  IF (SELECT md5(COALESCE(string_agg((to_jsonb(i) - 'partner_item_id')::text, ',' ORDER BY i.id), '')) FROM public.eatery_menu_items i)
     IS DISTINCT FROM current_setting('ada.m1159_items', true) THEN
    RAISE EXCEPTION 'after: an existing eatery_menu_items row changed';
  END IF;
  IF NOT (has_column_privilege('anon', 'public.eatery_menu_items', 'partner_item_id', 'SELECT')
      AND has_column_privilege('authenticated', 'public.eatery_menu_items', 'partner_item_id', 'SELECT'))
     OR has_column_privilege('anon', 'public.eatery_menu_items', 'partner_item_id', 'INSERT,UPDATE,REFERENCES')
     OR has_column_privilege('authenticated', 'public.eatery_menu_items', 'partner_item_id', 'INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'after: client privileges on partner_item_id are not SELECT-only';
  END IF;
  SELECT array_agg(policyname::text ORDER BY policyname) INTO v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = 'eatery_menu_items';
  IF v_names IS DISTINCT FROM ARRAY['eatery_menu_items_select_active','eatery_menu_items_select_preview'] THEN
    RAISE EXCEPTION 'after: eatery_menu_items policies are %', v_names;
  END IF;
  -- Probes, rolled back: a valid id lands, a URL-unsafe one and a per-partner duplicate are refused.
  BEGIN
    INSERT INTO public.eatery_partners (id, slug, name, category, order_method) VALUES (v_p, 'zz-probe-1159', 'ZZ probe 1159', 'restaurant', 'website');
    BEGIN
      INSERT INTO public.eatery_menu_items (partner_id, section, name, partner_item_id) VALUES (v_p, 'S', 'A', 'imu48g2htwr7ih');
      v_ok := 'accepted';
    EXCEPTION WHEN check_violation THEN v_ok := 'REFUSED';
    END;
    BEGIN
      INSERT INTO public.eatery_menu_items (partner_id, section, name, partner_item_id) VALUES (v_p, 'S', 'B', 'a,b:2');
      v_bad := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad := 'refused';
    END;
    BEGIN
      INSERT INTO public.eatery_menu_items (partner_id, section, name, partner_item_id) VALUES (v_p, 'S', 'C', 'imu48g2htwr7ih');
      v_dup := 'ACCEPTED';
    EXCEPTION WHEN unique_violation THEN v_dup := 'refused';
    END;
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;
  IF v_ok  IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'a valid partner_item_id was %', v_ok; END IF;
  IF v_bad IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a URL-unsafe partner_item_id was %', v_bad; END IF;
  IF v_dup IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a duplicate partner_item_id within one partner was %', v_dup; END IF;
  IF EXISTS (SELECT 1 FROM public.eatery_partners WHERE id = v_p) THEN RAISE EXCEPTION 'probe rows survived'; END IF;
  RAISE NOTICE '20261159: eatery_menu_items.partner_item_id text NULL, CHECK + partial UNIQUE; existing rows unchanged';
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
VALUES ('20261159_eatery_menu_items_partner_item_id.sql', '7ba41ec8e5793fa7d64560dd0020d78ca6c6a2cab5030477d2e5c6e63fa71087')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- 20261113 — Bağlantı & eSIM: the new landing's link targets live in the DB (Berke 2026-10-15)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The new landing has three tiles (tasi / turist / yenihat) and one support bar (support), each
-- opening a KKTCELL page in the in-app browser. The URLs are data, not code: one row per target in
-- connectivity_links, so a changed URL is an UPDATE and no OTA. A tap is logged as contact_events
-- (module 'connectivity', action 'website', entity_id = the LINK's id), so the per-target label is
-- the row's slug by join, and contact_events needs no change.
--
-- WHO CAN DO WHAT (RLS):
--   anon + authenticated (guests included): SELECT active rows only (is_active). Nothing else.
--   No client role can INSERT, UPDATE or DELETE. service_role and migrations write.
--
-- is_active DEFAULT false (pre-launch tables default to unpublished). The four rows below are
-- seeded ACTIVE on purpose: the table is not in search_content, and the only screen that reads it
-- is gated by CONNECTIVITY_LIVE (false), so "active" exposes nothing a user can reach.
--
-- slug is a static set: a new target needs code anyway (tile image + i18n), and the CHECK catches
-- a typo that would otherwise leave a tile with no row. Static on purpose: scripts/audit-schema-drift.mjs
-- reads CHECK literals from this file.
--
-- Also: the operator's brand colours, which the module reads off the row (never hardcoded):
--   brand_primary   '#FFC72C' (accent: pill, chat icon), brand_secondary '#2D55A3' (blue card + bar).
--   brand_confirmed is NOT touched.
--
-- Undo:
--   DROP TABLE public.connectivity_links;
--   UPDATE public.connectivity_operators SET brand_primary = '#FFC900', brand_secondary = '#00263E' WHERE slug = 'kktcell';
--
-- Apply: gh workflow run supabase-migrate -f file=20261113_connectivity_links.sql (dry), then -f apply=true.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('public.connectivity_links') IS NOT NULL THEN
    RAISE EXCEPTION 'connectivity_links already exists';
  END IF;
  IF (SELECT count(*) FROM public.connectivity_operators WHERE slug = 'kktcell') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'expected exactly one kktcell operator row';
  END IF;
END $$;

CREATE TABLE public.connectivity_links (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  operator_id uuid        NOT NULL,
  slug        text        NOT NULL,
  url         text        NOT NULL,
  sort_order  integer     NOT NULL DEFAULT 0,
  is_active   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connectivity_links_pkey PRIMARY KEY (id),
  CONSTRAINT connectivity_links_operator_id_fkey FOREIGN KEY (operator_id)
    REFERENCES public.connectivity_operators (id) ON DELETE CASCADE,
  CONSTRAINT connectivity_links_operator_slug_key UNIQUE (operator_id, slug),
  CONSTRAINT connectivity_links_slug_check CHECK (slug IN ('tasi','turist','yenihat','support')),
  CONSTRAINT connectivity_links_url_check  CHECK (url ~ '^https://')
);

ALTER TABLE public.connectivity_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.connectivity_links FROM anon, authenticated;
GRANT SELECT ON TABLE public.connectivity_links TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.connectivity_links TO service_role;

CREATE POLICY connectivity_links_select_active ON public.connectivity_links
  FOR SELECT TO anon, authenticated
  USING (is_active);

INSERT INTO public.connectivity_links (operator_id, slug, url, sort_order, is_active)
SELECT o.id, v.slug, v.url, v.sort_order, true
  FROM public.connectivity_operators o
 CROSS JOIN (VALUES
   ('tasi',    'https://www.kktcell.com/numaranizi-turkcelle-tasiyin?=adaapp', 1),
   ('turist',  'https://www.kktcell.com/yeni-faturasiz-hat-al?=adaapp',        2),
   ('yenihat', 'https://www.kktcell.com/ada-app',                              3),
   ('support', 'https://www.kktcell.com/ada-app',                              4)
 ) AS v(slug, url, sort_order)
 WHERE o.slug = 'kktcell';

UPDATE public.connectivity_operators
   SET brand_primary = '#FFC72C', brand_secondary = '#2D55A3', updated_at = now()
 WHERE slug = 'kktcell';

DO $$
DECLARE
  v_policies text;
  v_npol     int;
  v_rows     int;
  v_anon     int;
  v_off      text := 'not run';
  v_ins      text := 'not run';
  v_brand    text;
BEGIN
  -- Every policy reaching the table, not just ours (RLS is permissive-OR).
  SELECT count(*), string_agg(policyname || '(' || cmd || ')', ', ' ORDER BY policyname)
    INTO v_npol, v_policies FROM pg_policies WHERE schemaname = 'public' AND tablename = 'connectivity_links';
  IF v_npol IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'connectivity_links policies: % (want exactly 1): %', v_npol, v_policies;
  END IF;

  IF NOT (has_table_privilege('anon', 'public.connectivity_links', 'SELECT')
      AND has_table_privilege('authenticated', 'public.connectivity_links', 'SELECT')
      AND has_table_privilege('service_role', 'public.connectivity_links', 'SELECT,INSERT,UPDATE,DELETE'))
     OR has_table_privilege('anon', 'public.connectivity_links', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR has_table_privilege('authenticated', 'public.connectivity_links', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'connectivity_links grants are not SELECT-only for clients / full for service_role';
  END IF;

  SELECT count(*) INTO v_rows FROM public.connectivity_links WHERE is_active;
  IF v_rows IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'active links: % (want 4)', v_rows;
  END IF;

  SELECT brand_primary || '/' || brand_secondary INTO v_brand FROM public.connectivity_operators WHERE slug = 'kktcell';
  IF v_brand IS DISTINCT FROM '#FFC72C/#2D55A3' THEN
    RAISE EXCEPTION 'brand colours are %', v_brand;
  END IF;

  -- Probes in a sub-block that always rolls back. As anon: sees exactly the 4 active rows and not an
  -- inactive one (positive + negative), and cannot insert.
  BEGIN
    UPDATE public.connectivity_links SET is_active = false WHERE slug = 'support';
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_anon FROM public.connectivity_links;
    v_off := CASE WHEN EXISTS (SELECT 1 FROM public.connectivity_links WHERE slug = 'support') THEN 'VISIBLE' ELSE 'hidden' END;
    BEGIN
      INSERT INTO public.connectivity_links (operator_id, slug, url)
      SELECT operator_id, 'tasi', 'https://example.com' FROM public.connectivity_links LIMIT 1;
      v_ins := 'ACCEPTED';
    EXCEPTION WHEN insufficient_privilege THEN v_ins := 'refused';
    END;
    SET LOCAL ROLE postgres;
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_anon IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'anon saw % rows with support inactive (want 3)', v_anon; END IF;
  IF v_off  IS DISTINCT FROM 'hidden'  THEN RAISE EXCEPTION 'anon could see an inactive link'; END IF;
  IF v_ins  IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'anon insert was %', v_ins; END IF;
  IF (SELECT count(*) FROM public.connectivity_links WHERE is_active) IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'probe did not roll back';
  END IF;

  RAISE NOTICE 'connectivity_links: 4 active, policies: %, brand %', v_policies, v_brand;
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
VALUES ('20261113_connectivity_links.sql', 'de37381f915f517e2289ec3fea9559e5ef48c8a172711cbef6bf4b584d15c199')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;
NOTIFY pgrst, 'reload schema';

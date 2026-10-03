-- ─── 20261068 — a live Novest listing with no photo is hidden, automatically ──
--
-- RULE: a Novest listing (source = 'novest') with zero rows in property_images is not
-- readable by app users. It is not deleted, delisted or flagged — the row is untouched —
-- and it reappears on the very next query once a photo row exists, because the rule is
-- evaluated per query: there is no flag to maintain and no job to re-sync. No OTA.
--
-- MECHANISM: one RESTRICTIVE SELECT policy on public.properties. Restrictive policies are
-- ANDed with the permissive ones, so props_select_public is untouched and still decides
-- everything else (status, partner branch, agents, admins).
--
-- WHY A SECURITY DEFINER HELPER, NOT AN EXISTS ON property_images: images_select_public
-- reads properties. A properties policy that read property_images under the caller's RLS
-- would form a cycle (42P17 infinite recursion). private.property_has_photo() runs as its
-- owner, so property_images' policy is never entered.
--
-- WHY A `private` SCHEMA (the first non-public schema in this repo): PostgREST exposes
-- only `public`, so the helper is not an RPC anyone can call over REST. It still needs
-- USAGE + EXECUTE for anon/authenticated, because a policy expression is evaluated with
-- the CALLER's privileges — without the grant every guest read of properties would error.
--
-- WHO CAN READ WHAT (plain English):
--   • guests, customers, agents: a Novest listing only if it has at least one photo; every
--     other listing exactly as before.
--   • admins: everything, as before (is_admin() arm) — AdminScreen counts are unchanged.
--   • service_role (the import / image jobs): bypasses RLS, sees every row as before.
-- No write is affected: the policy is FOR SELECT only.

SET ROLE postgres;

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO anon, authenticated;

CREATE OR REPLACE FUNCTION private.property_has_photo(p uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.property_images i WHERE i.property_id = p)
$$;
REVOKE ALL ON FUNCTION private.property_has_photo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.property_has_photo(uuid) TO anon, authenticated;

DROP POLICY IF EXISTS props_hide_photoless_novest ON public.properties;
CREATE POLICY props_hide_photoless_novest ON public.properties
  AS RESTRICTIVE
  FOR SELECT TO public
  USING (source IS DISTINCT FROM 'novest' OR public.is_admin() OR private.property_has_photo(id));

-- ─── Assertions — any failure rolls back the whole file ──────────────────────
-- (1) The FULL policy set on properties, derived and printed: 7 before + this one.
DO $$
DECLARE n int; names text; r record;
BEGIN
  SELECT count(*), string_agg(policyname || ':' || permissive || ':' || cmd, ', ' ORDER BY policyname)
    INTO n, names FROM pg_policies WHERE schemaname = 'public' AND tablename = 'properties';
  IF n <> 8 THEN RAISE EXCEPTION '20261068: properties has % policies, expected 8: %', n, names; END IF;
  SELECT * INTO r FROM pg_policies WHERE schemaname = 'public' AND tablename = 'properties'
    AND policyname = 'props_hide_photoless_novest';
  IF r.permissive <> 'RESTRICTIVE' OR r.cmd <> 'SELECT' THEN
    RAISE EXCEPTION '20261068: new policy is % % — must be RESTRICTIVE SELECT', r.permissive, r.cmd;
  END IF;
END $$;

-- (2) Expected visibility, computed as postgres (bypasses RLS). Carried to the role
-- checks in transaction-local settings, NOT a temp table: supabase/CLAUDE.md records 42P01
-- on objects created earlier in a script sent this way, and a setting creates nothing.
DO $$
DECLARE v int; l int; c text; a uuid;
BEGIN
  SELECT count(*) INTO l FROM public.properties p WHERE p.source = 'novest' AND p.status = 'active';
  SELECT count(*) INTO v FROM public.properties p WHERE p.source = 'novest' AND p.status = 'active'
    AND EXISTS (SELECT 1 FROM public.property_images i WHERE i.property_id = p.id);
  SELECT p.external_id INTO c FROM public.properties p WHERE p.source = 'novest' AND p.status = 'active'
    AND EXISTS (SELECT 1 FROM public.property_images i WHERE i.property_id = p.id) ORDER BY p.external_id LIMIT 1;
  SELECT id INTO a FROM public.profiles WHERE role = 'admin' ORDER BY id LIMIT 1;
  IF v >= l THEN RAISE EXCEPTION '20261068: nothing to hide (visible % of live %) — the test proves nothing', v, l; END IF;
  IF c IS NULL THEN RAISE EXCEPTION '20261068: no photo''d Novest listing for the positive control'; END IF;
  IF a IS NULL THEN RAISE EXCEPTION '20261068: no admin profile to test the bypass with'; END IF;
  PERFORM set_config('mig1068.visible', v::text, true), set_config('mig1068.live', l::text, true),
          set_config('mig1068.control', c, true), set_config('mig1068.admin', a::text, true);
END $$;

-- (3) As anon, then (4) as a GUEST — the role the app actually uses (signInAnonymously →
-- authenticated, is_anonymous). The same three assertions for each.
SET LOCAL ROLE anon;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.properties WHERE source = 'novest' AND status = 'active';
  IF n <> current_setting('mig1068.visible')::int THEN RAISE EXCEPTION '20261068 anon: sees % live Novest listings, expected %', n, current_setting('mig1068.visible'); END IF;
  IF EXISTS (SELECT 1 FROM public.properties WHERE external_id = 'novest-20111') THEN RAISE EXCEPTION '20261068 anon: novest-20111 (no photo) is visible'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.properties WHERE external_id = current_setting('mig1068.control')) THEN RAISE EXCEPTION '20261068 anon: control % (has photos) is hidden', current_setting('mig1068.control'); END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000010a8","role":"authenticated","is_anonymous":true}', true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.properties WHERE source = 'novest' AND status = 'active';
  IF n <> current_setting('mig1068.visible')::int THEN RAISE EXCEPTION '20261068 guest: sees % live Novest listings, expected %', n, current_setting('mig1068.visible'); END IF;
  IF EXISTS (SELECT 1 FROM public.properties WHERE external_id = 'novest-20111') THEN RAISE EXCEPTION '20261068 guest: novest-20111 (no photo) is visible'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.properties WHERE external_id = current_setting('mig1068.control')) THEN RAISE EXCEPTION '20261068 guest: control % (has photos) is hidden', current_setting('mig1068.control'); END IF;
END $$;

-- (5) As an ADMIN — the bypass arm, proven rather than assumed.
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('mig1068.admin'), 'role', 'authenticated')::text, true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.properties WHERE source = 'novest' AND status = 'active';
  IF n <> current_setting('mig1068.live')::int THEN RAISE EXCEPTION '20261068 admin: sees % live Novest listings, expected all %', n, current_setting('mig1068.live'); END IF;
END $$;

-- Back to postgres BEFORE the stamp: the ledger INSERT runs as the current role.
SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE postgres;

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
VALUES ('20261068_novest_hide_photoless.sql', '2ae664b9a5ab8a2ce7bd5e980f83e7758c230edc4a6cb266f9c18ec4cafeddd7')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

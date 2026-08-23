-- ─── Çekici & Yol Yardım — towing / roadside-assistance directory (Slice 1) ──
--
-- An ADMIN-SEEDED directory. Unlike insurance_companies / home_services, there is
-- NO self-serve path: firms do not register themselves, there is no owner_id, no
-- status/moderation column, and no in-app CRUD. Rows arrive by SQL only. That makes
-- the RLS surface much smaller than the tables it otherwise resembles — public read
-- of active rows, admin-only write, anon blocked. No guard trigger is needed because
-- there is no non-admin writer to guard against.
--
-- ADA IS A DIRECTORY, NOT A DISPATCHER. Nothing here books, dispatches or brokers.
-- The user calls the firm; the service relationship is theirs. No ratings, no UGC.
--
-- THIS IS AN EMERGENCY SCREEN. Two consequences are encoded as constraints rather
-- than left to the seeding process:
--   • base_region must be inside coverage_regions (see towing_base_in_coverage_check).
--     A firm based in Girne that does not list Girne as covered is invisible in its
--     own region — silent, and exactly the kind of typo a hand-written seed produces.
--   • coverage_regions and vehicle_classes must be NON-EMPTY. An empty array matches
--     no filter, so the row would exist and never render.
--
-- VEHICLE CLASSES ARE EXACTLY TWO, and this is a product decision, not an omission:
--   'car'   — otomobil, hafif ticari AND motosiklet
--   'heavy' — kamyon / otobüs
-- A firm may hold both. `İş makinesi` (machinery) is a SERVICE TAG
-- (services = 'machinery_transport'), NOT a third vehicle class. Do not add one.
--
-- Ships DARK: MODULE_FLAGS.towing stays false until Slice 3 seeds real firms.
-- Applying this migration early is safe — it creates an empty table nothing reads yet.
--
-- Safe to re-run: IF NOT EXISTS / CREATE OR REPLACE / drop-then-create throughout.
--
-- SET ROLE postgres is REQUIRED — creating storage.objects policies and inserting a
-- bucket need more than the SQL editor's default `authenticated` role.
--
-- IF THE STORAGE SECTION ERRORS WITH `must be owner of table objects`: postgres does not
-- own storage.objects on every project. The whole file is ONE transaction, so that error
-- rolls EVERYTHING back cleanly — no half-applied table, no ledger row. Recovery is to
-- split the file: run everything up to the storage section as postgres, then run the
-- storage section alone under `SET ROLE supabase_storage_admin;` (that role owns
-- storage.objects but CANNOT create the public table, which is why it can't wrap the
-- whole file). Same fallback 20260816_provider_storage_policies.sql documents.

SET ROLE postgres;
BEGIN;

-- ─── Opening-hours shape validator ───────────────────────────────────────────
-- A CHECK constraint cannot contain a subquery, and validating a jsonb object needs
-- one (jsonb_each), so the rule lives in an IMMUTABLE function the CHECK calls.
--
-- SHAPE (pinned here; the seed template, the open-now client util and this function
-- must agree):
--   {"mon":{"open":"08:00","close":"18:00"}, ..., "sun":null}
--   • key      — the three-letter lowercase day, mon..sun. Absent key == closed.
--   • null     — closed all day.
--   • object   — {open, close} as "HH:MM", 24h, zero-padded.
--
-- CLOSE MAY BE <= OPEN, DELIBERATELY. "20:00"–"04:00" means the shift crosses
-- midnight, which for a towing firm is the normal case, not an edge case. The client
-- open-now util resolves the wrap; validating it away here would make the common
-- overnight shift unrepresentable.
--
-- IGNORED ENTIRELY when is_24_7 = true.
CREATE OR REPLACE FUNCTION public.towing_hours_valid(hours jsonb)
  RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT hours IS NULL OR (
    jsonb_typeof(hours) = 'object'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(hours) e
      WHERE e.key NOT IN ('mon','tue','wed','thu','fri','sat','sun')
         OR NOT (
              jsonb_typeof(e.value) = 'null'
              OR (
                jsonb_typeof(e.value) = 'object'
                AND e.value ? 'open' AND e.value ? 'close'
                AND e.value->>'open'  ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
                AND e.value->>'close' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
              )
            )
    )
  )
$$;

-- ─── Table ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.towing_companies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  slug              text NOT NULL UNIQUE,
  logo_url          text,                                   -- mirrored into the towing-logos bucket (Slice 3)
  phone             text NOT NULL,                          -- drives the tel: action — the primary action of this module
  whatsapp          text,                                   -- NULLABLE: the card hides the WhatsApp button when null
  base_region       text NOT NULL,                          -- canonical City Welcome region key
  coverage_regions  text[] NOT NULL,                        -- canonical region keys; feeds <CoverageMap>
  vehicle_classes   text[] NOT NULL,                        -- 'car' and/or 'heavy' — exactly these two
  services          text[] NOT NULL DEFAULT '{}',
  is_24_7           boolean NOT NULL DEFAULT false,
  opening_hours     jsonb,                                  -- ignored when is_24_7; see towing_hours_valid
  starting_price    numeric,                                -- NULL => the card shows "Fiyat için arayın"
  price_updated_at  timestamptz,                            -- set by trigger; never hand-written, never hardcoded in JS
  is_featured       boolean NOT NULL DEFAULT false,         -- infrastructure only — nobody is featured in v1
  is_active         boolean NOT NULL DEFAULT true,
  sort_order        integer NOT NULL DEFAULT 0,             -- NOT NULL: a NULL here would sort unpredictably against 0
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ─── Constraints ─────────────────────────────────────────────────────────────
-- Drop-then-add per constraint so the whole file stays re-runnable (house convention).

ALTER TABLE public.towing_companies DROP CONSTRAINT IF EXISTS towing_slug_check;
ALTER TABLE public.towing_companies ADD CONSTRAINT towing_slug_check
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- The seven canonical region keys. MUST stay identical to REGIONS in
-- constants/regions.js and to the polygon keys in the coverage map — a mismatch makes
-- the auto-detected region silently match nothing. Same list as the district CHECK on
-- job_postings / beaches / landmarks / insurance_companies.
ALTER TABLE public.towing_companies DROP CONSTRAINT IF EXISTS towing_base_region_check;
ALTER TABLE public.towing_companies ADD CONSTRAINT towing_base_region_check
  CHECK (base_region = ANY (ARRAY['nicosia'::text,'kyrenia'::text,'famagusta'::text,'morphou'::text,'iskele'::text,'lefke'::text,'karpaz'::text]));

ALTER TABLE public.towing_companies DROP CONSTRAINT IF EXISTS towing_coverage_regions_check;
ALTER TABLE public.towing_companies ADD CONSTRAINT towing_coverage_regions_check
  CHECK (
    coverage_regions <@ ARRAY['nicosia'::text,'kyrenia'::text,'famagusta'::text,'morphou'::text,'iskele'::text,'lefke'::text,'karpaz'::text]
    -- cardinality(), NOT array_length(). array_length(ARRAY[]::text[], 1) returns NULL,
    -- and a CHECK constraint ACCEPTS a NULL result — so the array_length form is a
    -- silent no-op that lets empty arrays straight through. cardinality() returns 0.
    AND cardinality(coverage_regions) >= 1
  );

-- A firm must serve the region it is based in — see the header. Cheap constraint,
-- catches a seed typo that would otherwise be invisible until someone in that region
-- got an empty list during a breakdown.
ALTER TABLE public.towing_companies DROP CONSTRAINT IF EXISTS towing_base_in_coverage_check;
ALTER TABLE public.towing_companies ADD CONSTRAINT towing_base_in_coverage_check
  CHECK (base_region = ANY (coverage_regions));

ALTER TABLE public.towing_companies DROP CONSTRAINT IF EXISTS towing_vehicle_classes_check;
ALTER TABLE public.towing_companies ADD CONSTRAINT towing_vehicle_classes_check
  CHECK (
    vehicle_classes <@ ARRAY['car'::text,'heavy'::text]
    AND cardinality(vehicle_classes) >= 1   -- see the note on coverage_regions above
  );

ALTER TABLE public.towing_companies DROP CONSTRAINT IF EXISTS towing_services_check;
ALTER TABLE public.towing_companies ADD CONSTRAINT towing_services_check
  CHECK (services <@ ARRAY['towing'::text,'tyre'::text,'battery'::text,'fuel'::text,'recovery'::text,'vehicle_transport'::text,'machinery_transport'::text]);

ALTER TABLE public.towing_companies DROP CONSTRAINT IF EXISTS towing_starting_price_check;
ALTER TABLE public.towing_companies ADD CONSTRAINT towing_starting_price_check
  CHECK (starting_price IS NULL OR starting_price >= 0);

ALTER TABLE public.towing_companies DROP CONSTRAINT IF EXISTS towing_opening_hours_check;
ALTER TABLE public.towing_companies ADD CONSTRAINT towing_opening_hours_check
  CHECK (public.towing_hours_valid(opening_hours));

-- ─── Index ───────────────────────────────────────────────────────────────────
-- The list query is
--   .eq('is_active', true).contains('coverage_regions', [region]).contains('vehicle_classes', [class])
-- GIN on coverage_regions serves the selective half. vehicle_classes deliberately gets
-- NO index: it is a two-value domain, so it can never be selective, and this table is
-- tens of rows — a second GIN would be cost with no benefit.
CREATE INDEX IF NOT EXISTS idx_towing_companies_coverage
  ON public.towing_companies USING GIN (coverage_regions);

-- ─── updated_at / price_updated_at touch ─────────────────────────────────────
-- price_updated_at is maintained HERE rather than by the writer, so the freshness
-- stamp cannot drift from the value it describes. It moves only when starting_price
-- actually changes — re-running a seed that sets the same price leaves the stamp
-- alone, which is the point: it answers "how old is this price", not "when was this
-- row last touched". That second question is updated_at's job.
CREATE OR REPLACE FUNCTION public.towing_touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN
    IF NEW.starting_price IS NOT NULL THEN
      NEW.price_updated_at := COALESCE(NEW.price_updated_at, now());
    END IF;
  ELSIF NEW.starting_price IS DISTINCT FROM OLD.starting_price THEN
    NEW.price_updated_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS towing_touch_updated_at ON public.towing_companies;
CREATE TRIGGER towing_touch_updated_at
  BEFORE INSERT OR UPDATE ON public.towing_companies
  FOR EACH ROW EXECUTE FUNCTION public.towing_touch_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
--
-- IN PLAIN ENGLISH — who can do what:
--
--   READ   Everyone, including a signed-out guest, can read any row where
--          is_active = true (towing_select_public). Admins additionally see inactive
--          rows (towing_select_admin_all). Nobody else sees an inactive row. There is
--          no personal data on this table at all — these are business listings — so
--          public read is the whole point, and hiding inactive rows is an editorial
--          control, not a privacy one.
--
--   WRITE  Admins only (profiles.role = 'admin'), for INSERT, UPDATE and DELETE.
--          A normal signed-in customer cannot create, edit or delete a firm.
--          A provider cannot either — this table has no owner concept.
--          An ANONYMOUS (guest) session is additionally blocked by three RESTRICTIVE
--          policies, so even if a guest were somehow made admin the write still fails.
--          RESTRICTIVE means AND-ed with everything else: it can only subtract.
--
--   SEEDING The SQL editor as `postgres`, and the service_role key used by the Slice 3
--          importer, BYPASS RLS entirely. That is how firms actually get added.
--
-- Postgres has no CREATE POLICY IF NOT EXISTS — drop-then-create keeps this re-runnable.

ALTER TABLE public.towing_companies ENABLE ROW LEVEL SECURITY;

-- TWO permissive SELECT policies, not one with an OR. Permissive policies OR together,
-- so the effect is identical — but this way a signed-out `anon` session NEVER evaluates
-- public.is_admin(). That matters: is_admin() is SECURITY DEFINER, and if EXECUTE is not
-- granted to anon then a single combined `USING (is_active OR is_admin())` policy would
-- raise a permission error for guests instead of returning the directory. A guest on the
-- roadside getting an error instead of a phone number is the worst failure this module
-- has. Splitting removes the dependency entirely rather than betting on a grant.
DROP POLICY IF EXISTS "towing_select_public" ON public.towing_companies;
CREATE POLICY "towing_select_public" ON public.towing_companies
  FOR SELECT TO public
  USING (is_active = true);

-- The admin arm: authenticated only, so anon is never in scope for this one.
DROP POLICY IF EXISTS "towing_select_admin_all" ON public.towing_companies;
CREATE POLICY "towing_select_admin_all" ON public.towing_companies
  FOR SELECT TO authenticated
  USING ((select public.is_admin()));

DROP POLICY IF EXISTS "towing_insert_admin" ON public.towing_companies;
CREATE POLICY "towing_insert_admin" ON public.towing_companies
  FOR INSERT TO authenticated
  WITH CHECK ((select public.is_admin()));

DROP POLICY IF EXISTS "towing_update_admin" ON public.towing_companies;
CREATE POLICY "towing_update_admin" ON public.towing_companies
  FOR UPDATE TO authenticated
  USING ((select public.is_admin())) WITH CHECK ((select public.is_admin()));

DROP POLICY IF EXISTS "towing_delete_admin" ON public.towing_companies;
CREATE POLICY "towing_delete_admin" ON public.towing_companies
  FOR DELETE TO authenticated
  USING ((select public.is_admin()));

-- Anonymous (guest) sessions sit in the `authenticated` role with a real auth.uid(),
-- so the admin policies above are not by themselves an anon guard. Same canonical
-- helper every other no_anon_* policy uses (20260714_block_anonymous_writes.sql).
DROP POLICY IF EXISTS "no_anon_insert_towing_companies" ON public.towing_companies;
CREATE POLICY "no_anon_insert_towing_companies" ON public.towing_companies
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (select public.is_anonymous_session()));
DROP POLICY IF EXISTS "no_anon_update_towing_companies" ON public.towing_companies;
CREATE POLICY "no_anon_update_towing_companies" ON public.towing_companies
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (select public.is_anonymous_session())) WITH CHECK (NOT (select public.is_anonymous_session()));
DROP POLICY IF EXISTS "no_anon_delete_towing_companies" ON public.towing_companies;
CREATE POLICY "no_anon_delete_towing_companies" ON public.towing_companies
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (select public.is_anonymous_session()));

-- ─── Storage: towing-logos bucket ────────────────────────────────────────────
--
-- Created HERE IN SQL, not in the dashboard, on purpose. 20260621_provider_verification
-- shipped its bucket policies as commented-out "run manually in dashboard" SQL; the
-- policy half was never applied, and provider document upload was broken from launch
-- until 20260816 found it. A bucket whose creation and ACL live in a migration is
-- covered by the ledger and by verify_schema QUERY 4. Do not create this one by hand.
--
-- PUBLIC bucket: logos are public brand marks shown on the card, and a public URL is
-- what logo_url stores. Same posture as event-images / facility-images.
--
-- WRITE is admin-only + anon-guarded. The Slice 3 mirror pass runs on service_role,
-- which bypasses RLS, so it needs no policy of its own.

-- SET ROLE supabase_storage_admin;   -- ← see the header: only if "must be owner of
--                                    --   table objects", and only with this section
--                                    --   split out into its own run.

INSERT INTO storage.buckets (id, name, public)
VALUES ('towing-logos', 'towing-logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "towing_logos_public_read" ON storage.objects;
CREATE POLICY "towing_logos_public_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'towing-logos');

DROP POLICY IF EXISTS "towing_logos_admin_insert" ON storage.objects;
CREATE POLICY "towing_logos_admin_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'towing-logos'
    AND (select public.is_admin())
    AND NOT (select public.is_anonymous_session())
  );

DROP POLICY IF EXISTS "towing_logos_admin_update" ON storage.objects;
CREATE POLICY "towing_logos_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'towing-logos'
    AND (select public.is_admin())
    AND NOT (select public.is_anonymous_session())
  )
  WITH CHECK (
    bucket_id = 'towing-logos'
    AND (select public.is_admin())
    AND NOT (select public.is_anonymous_session())
  );

DROP POLICY IF EXISTS "towing_logos_admin_delete" ON storage.objects;
CREATE POLICY "towing_logos_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'towing-logos'
    AND (select public.is_admin())
    AND NOT (select public.is_anonymous_session())
  );

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
VALUES ('20260905_towing_companies.sql', 'e35c96f6c0c2e8abb29ce79f613d533a356e41de6523b3c18bffc9225d1c31a4')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- PostgREST schema-cache refresh. MANDATORY: without it the REST API reports 42703
-- "column does not exist" (or 404s the table) against a table that demonstrably
-- exists in Postgres, because PostgREST is still serving its cached schema.
NOTIFY pgrst, 'reload schema';

-- ─── Verification ────────────────────────────────────────────────────────────
-- Run supabase/verify_towing_slice1.sql after applying. It covers the constraint
-- matrix, the RLS matrix and the trigger. The BUCKET still needs the end-to-end
-- upload + public-fetch proof described in that file's BLOCK V7 — creating a bucket
-- is not evidence that writing to it works.

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   SET ROLE postgres;
--   BEGIN;
--   DROP TABLE IF EXISTS public.towing_companies;
--   DROP FUNCTION IF EXISTS public.towing_touch_updated_at();
--   DROP FUNCTION IF EXISTS public.towing_hours_valid(jsonb);
--   DROP POLICY IF EXISTS "towing_logos_public_read"   ON storage.objects;
--   DROP POLICY IF EXISTS "towing_logos_admin_insert"  ON storage.objects;
--   DROP POLICY IF EXISTS "towing_logos_admin_update"  ON storage.objects;
--   DROP POLICY IF EXISTS "towing_logos_admin_delete"  ON storage.objects;
--   DELETE FROM storage.buckets WHERE id = 'towing-logos';   -- only if empty
--   DELETE FROM public.schema_migrations_applied WHERE filename = '20260905_towing_companies.sql';
--   COMMIT;
--   RESET ROLE;

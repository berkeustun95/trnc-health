-- ─── Insurance company directory (Phase 1: browse + contact) ────────────────
--
-- Clones the home_services pattern: self-serve signup → status 'pending' →
-- admin activates. owner_id is NULLABLE so admin can also seed companies via
-- SQL directly; self-serve inserts still force owner_id = auth.uid() via RLS.
-- The guard uses transport's single combined function pattern (INSERT OR UPDATE).
--
-- Phase 2 (quote requests / selling) will be a separate additive migration that
-- adds a quote_requests table referencing (company_id, insurance_type). Nothing
-- here blocks it.
--
-- APPLY THIS IN SUPABASE BEFORE publishing the OTA that ships the insurance
-- screens — the browse query hits insurance_companies on load.
--
-- Safe to re-run: every object is created with IF NOT EXISTS / CREATE OR REPLACE,
-- or dropped-then-created (constraints, trigger, policies). A partially-applied
-- earlier run is reconciled by running the whole file again.

BEGIN;

-- ─── Table ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.insurance_companies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,   -- NULLABLE: admin-seeded rows have no owner
  name             text NOT NULL,
  phone            text NOT NULL,
  whatsapp         text,
  email            text,                                                -- optional; drives the mailto button when set
  contact_pref     text NOT NULL DEFAULT 'whatsapp',
  district         text NOT NULL,
  insurance_types  text[] NOT NULL DEFAULT '{}',
  description      text,
  status           text NOT NULL DEFAULT 'pending',
  verified         boolean NOT NULL DEFAULT false,
  rejection_reason text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ─── Constraints ─────────────────────────────────────────────────────────────

-- Drop-then-add so the whole migration is safe to re-run (matches the repo's
-- capture_2 convention). Splitting into separate statements also makes the
-- DROP ... IF EXISTS idempotent per constraint.
ALTER TABLE public.insurance_companies DROP CONSTRAINT IF EXISTS insurance_companies_contact_pref_check;
ALTER TABLE public.insurance_companies ADD CONSTRAINT insurance_companies_contact_pref_check
  CHECK (contact_pref = ANY (ARRAY['call'::text, 'whatsapp'::text, 'both'::text]));
ALTER TABLE public.insurance_companies DROP CONSTRAINT IF EXISTS insurance_companies_district_check;
ALTER TABLE public.insurance_companies ADD CONSTRAINT insurance_companies_district_check
  CHECK (district = ANY (ARRAY['nicosia'::text, 'kyrenia'::text, 'famagusta'::text, 'morphou'::text, 'iskele'::text, 'lefke'::text, 'karpaz'::text]));
ALTER TABLE public.insurance_companies DROP CONSTRAINT IF EXISTS insurance_companies_status_check;
ALTER TABLE public.insurance_companies ADD CONSTRAINT insurance_companies_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'rejected'::text]));
ALTER TABLE public.insurance_companies DROP CONSTRAINT IF EXISTS insurance_companies_types_check;
ALTER TABLE public.insurance_companies ADD CONSTRAINT insurance_companies_types_check
  CHECK (insurance_types <@ ARRAY['health'::text, 'car'::text, 'home'::text, 'travel'::text]);

-- ─── Index ───────────────────────────────────────────────────────────────────
-- RLS ins_select_public / ins_update_self (owner_id = auth.uid()), owner dashboard.
CREATE INDEX IF NOT EXISTS idx_insurance_companies_owner_id
  ON public.insurance_companies (owner_id);

-- ─── Guard (single combined fn, transport pattern) ───────────────────────────
-- Admin and service-role/SQL-editor (auth.uid() IS NULL) bypass all checks, so
-- you can seed companies directly with any status/owner_id. Owners are locked
-- out of the moderation columns.

CREATE OR REPLACE FUNCTION public.ins_guard_write() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE is_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;  -- service role / SQL editor: admin seeding
  END IF;

  SELECT EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    INTO is_admin;
  IF is_admin THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'insurance_companies: new rows must be pending';
    END IF;
    IF NEW.verified IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'insurance_companies: verified is admin-only';
    END IF;
    IF NEW.rejection_reason IS NOT NULL THEN
      RAISE EXCEPTION 'insurance_companies: rejection_reason is admin-only';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE (owner path)
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'insurance_companies: owner_id is immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'insurance_companies: status is admin-only';
  END IF;
  IF NEW.verified IS DISTINCT FROM OLD.verified THEN
    RAISE EXCEPTION 'insurance_companies: verified is admin-only';
  END IF;
  IF NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN
    RAISE EXCEPTION 'insurance_companies: rejection_reason is admin-only';
  END IF;

  NEW.updated_at := now();   -- keep updated_at honest without a second trigger
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ins_guard_write ON public.insurance_companies;
CREATE TRIGGER ins_guard_write
  BEFORE INSERT OR UPDATE ON public.insurance_companies
  FOR EACH ROW EXECUTE FUNCTION public.ins_guard_write();

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.insurance_companies ENABLE ROW LEVEL SECURITY;

-- Public read: only active rows are visible to everyone; owners see their own
-- row in any status; admins see all.
-- Postgres has no CREATE POLICY IF NOT EXISTS, so drop-then-create each so the
-- migration stays re-runnable.
DROP POLICY IF EXISTS "ins_select_public" ON public.insurance_companies;
CREATE POLICY "ins_select_public" ON public.insurance_companies
  FOR SELECT TO public
  USING (
    status = 'active'
    OR owner_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Self-serve insert: a user may only create a row owned by themselves. The guard
-- forces status='pending' and verified=false.
DROP POLICY IF EXISTS "ins_insert_self" ON public.insurance_companies;
CREATE POLICY "ins_insert_self" ON public.insurance_companies
  FOR INSERT TO public
  WITH CHECK (owner_id = auth.uid());

-- Update: owner may edit their own row (guard locks moderation columns); admin
-- may edit anything.
DROP POLICY IF EXISTS "ins_update_self" ON public.insurance_companies;
CREATE POLICY "ins_update_self" ON public.insurance_companies
  FOR UPDATE TO public
  USING (
    owner_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Delete: admin only.
DROP POLICY IF EXISTS "ins_delete_admin" ON public.insurance_companies;
CREATE POLICY "ins_delete_admin" ON public.insurance_companies
  FOR DELETE TO public
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Block anonymous sessions from all writes.
DROP POLICY IF EXISTS "no_anon_insert_insurance_companies" ON public.insurance_companies;
CREATE POLICY "no_anon_insert_insurance_companies" ON public.insurance_companies
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT is_anonymous_session());
DROP POLICY IF EXISTS "no_anon_update_insurance_companies" ON public.insurance_companies;
CREATE POLICY "no_anon_update_insurance_companies" ON public.insurance_companies
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT is_anonymous_session()) WITH CHECK (NOT is_anonymous_session());
DROP POLICY IF EXISTS "no_anon_delete_insurance_companies" ON public.insurance_companies;
CREATE POLICY "no_anon_delete_insurance_companies" ON public.insurance_companies
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT is_anonymous_session());

COMMIT;

-- ─── Verification (run after applying) ───────────────────────────────────────
--   -- As a non-admin owner, each of these must FAIL:
--   UPDATE insurance_companies SET status   = 'active' WHERE owner_id = auth.uid();
--   UPDATE insurance_companies SET verified = true      WHERE owner_id = auth.uid();
--   -- A self-serve insert must land as pending / unverified regardless of input:
--   INSERT INTO insurance_companies (owner_id, name, phone, district, insurance_types, status, verified)
--   VALUES (auth.uid(), 'x', '000', 'nicosia', ARRAY['health'], 'active', true);
--   -- → row should read status='pending', verified=false.

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   BEGIN;
--   DROP TABLE IF EXISTS public.insurance_companies;
--   DROP FUNCTION IF EXISTS public.ins_guard_write();
--   COMMIT;

-- ─── Job Postings — RLS lockdown (Slice 1) ──────────────────────────────────
-- FIXES a moderation-bypass hole: the original jp_update_self policy allowed a
-- listing OWNER to UPDATE any column, including status/expires_at. An owner
-- could self-approve (status='active') and set their own expires_at via a direct
-- Supabase API call, bypassing admin moderation entirely.
--
-- RLS policies cannot compare OLD vs NEW columns, so column immutability is
-- enforced with a BEFORE UPDATE trigger. Admin and owner are both the
-- `authenticated` Postgres role, so column GRANTs can't distinguish them — a
-- trigger is the only clean way.
--
-- After this migration:
--   • Owner may edit their own listing's CONTENT fields (job_title, salary, …).
--   • Owner may ONLY change status active→filled (the "Mark Filled" flow).
--   • Owner may NEVER change status otherwise, expires_at, rejection_reason,
--     or owner_id. Approval/rejection/expiry are admin-only.
--   • Admin retains full update rights.
--   • The active→expired transition is allowed in system context so the
--     auto-expire cron (Slice 2) is not blocked.

-- ─── Row-level policy: add WITH CHECK as defense-in-depth ────────────────────
DROP POLICY "jp_update_self" ON job_postings;
CREATE POLICY "jp_update_self" ON job_postings FOR UPDATE
  USING (
    owner_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ─── Column-level enforcement: owners cannot touch moderation columns ────────
CREATE OR REPLACE FUNCTION jp_guard_owner_update() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE is_admin boolean;
BEGIN
  -- System context (no JWT, e.g. the auto-expire cron running SECURITY DEFINER):
  -- allow only the active→expired flip, nothing else.
  IF auth.uid() IS NULL THEN
    IF OLD.status = 'active' AND NEW.status = 'expired' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'job_postings: only active->expired allowed in system context';
  END IF;

  SELECT EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    INTO is_admin;
  IF is_admin THEN
    RETURN NEW;                                        -- admin may change anything
  END IF;

  -- Owner path: lock the moderation columns.
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'job_postings: owner_id is immutable';
  END IF;
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'job_postings: expires_at is admin-only';
  END IF;
  IF NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN
    RAISE EXCEPTION 'job_postings: rejection_reason is admin-only';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'active' AND NEW.status = 'filled') THEN
    RAISE EXCEPTION 'job_postings: owner may only set status active->filled';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS jp_guard_owner_update ON job_postings;
CREATE TRIGGER jp_guard_owner_update
  BEFORE UPDATE ON job_postings
  FOR EACH ROW EXECUTE FUNCTION jp_guard_owner_update();

-- ─── Events — allow organizer to submit their own event for review ──────────
-- The ev_guard_write trigger locks the `status` column so an organizer can never
-- self-approve. But it blocked EVERY owner status change, so the "Submit event"
-- flow (draft → pending) failed with "events: status is admin-only".
--
-- This adds the one owner-initiated transition the submit flow needs, mirroring
-- job_postings' owner-only active→filled. Everything else is unchanged.
--
-- After this migration, for a NON-admin organizer on their own event:
--   • INSERT — still must be `draft`; rejection_reason still must be null.
--   • UPDATE — may now flip status draft → pending (submit for review) ONLY.
--     Any other status change (→approved, →rejected, pending→draft,
--     rejected→anything) still raises "events: status is admin-only".
--   • organizer_id and rejection_reason remain immutable to owners.
-- Admins and service-role (auth.uid() IS NULL) keep full write rights.

CREATE OR REPLACE FUNCTION public.ev_guard_write()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE is_admin boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    INTO is_admin;
  IF is_admin THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'events: new rows must be draft';
    END IF;
    IF NEW.rejection_reason IS NOT NULL THEN
      RAISE EXCEPTION 'events: rejection_reason is admin-only';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.organizer_id IS DISTINCT FROM OLD.organizer_id THEN
    RAISE EXCEPTION 'events: organizer_id is immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'draft' AND NEW.status = 'pending') THEN
    RAISE EXCEPTION 'events: status is admin-only';
  END IF;
  IF NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN
    RAISE EXCEPTION 'events: rejection_reason is admin-only';
  END IF;

  RETURN NEW;
END
$function$;

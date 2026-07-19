-- ─── FIX D1 — appointment completion blocked by future-time CHECK ───────────
--
-- BUG: appointments carries `CHECK (requested_time > now())` (constraint
-- appointments_requested_time_future, added NOT VALID in 20260701_security_fixes).
-- Postgres re-evaluates CHECK constraints on EVERY update, not just insert. So
-- once an appointment's requested_time is in the past, ANY update to that row —
-- status → 'completed' / 'no_show' / 'cancelled' — re-checks `requested_time >
-- now()`, which is now false, and the update is REJECTED.
--
-- Impact: the sole rows a provider is allowed to complete are past ones (RLS
-- "providers can complete appointments" requires requested_time < now()), i.e.
-- exactly the rows this CHECK blocks. Completion / no-show / late-cancel are all
-- impossible. Evidence: live appointments have `confirmed` / `cancelled` but zero
-- `completed` / `no_show`.
--
-- INTENDED RULE:
--   • Block booking an appointment in the PAST — but only AT CREATION.
--   • After creation, status changes (completed / no_show / cancelled) must NOT
--     be blocked by the time rule.
--   • Rescheduling is allowed only to a FUTURE time; you may not move an
--     appointment INTO the past.
--
-- FIX (Option B): drop the CHECK (it is the thing firing on updates) and replace
-- it with a BEFORE INSERT OR UPDATE trigger that:
--   • on INSERT — rejects requested_time <= now();
--   • on UPDATE — enforces the future rule ONLY when requested_time is actually
--     being CHANGED. A status-only update leaves requested_time = OLD, so it
--     passes untouched — this is precisely the completion/no_show/cancel path the
--     bug was blocking.
--
-- Style: matches the table's existing data-validity trigger
-- (check_pending_appointment_limit — plain plpgsql, no SECURITY DEFINER) and the
-- BEFORE INSERT OR UPDATE / TG_OP-branch shape of ev_guard_write & tp_guard_write.
-- The function touches no tables (only NEW/OLD.requested_time and now()), so no
-- search_path pinning is needed. The rule is a universal data-validity invariant
-- and applies to everyone (no admin/service escape), matching the sibling INSERT
-- guard; add an admin override later if data-correction ever needs one.
--
-- Does NOT touch enforce_pending_appointment_limit, any policy, or any other table.

BEGIN;

-- (1) Drop the CHECK that mis-fires on updates to past rows.
ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_requested_time_future;

-- (2) Insert-time (and reschedule-only) future-time validation.
CREATE OR REPLACE FUNCTION public.appointments_guard_requested_time()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.requested_time <= now() THEN
      RAISE EXCEPTION 'appointments: requested_time must be in the future';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: guard only when the time is actually being changed. A status-only
  -- update on a past appointment (complete / no_show / cancel) leaves
  -- requested_time = OLD and passes straight through.
  IF NEW.requested_time IS DISTINCT FROM OLD.requested_time
     AND NEW.requested_time <= now() THEN
    RAISE EXCEPTION 'appointments: cannot reschedule to a past time';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS appointments_guard_requested_time ON public.appointments;
CREATE TRIGGER appointments_guard_requested_time
  BEFORE INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_guard_requested_time();

COMMIT;

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- ⚠️ This RE-BREAKS appointment completion / no-show / late-cancel (D1). Roll
-- back only if you fully intend to restore the buggy behaviour.
--
--   BEGIN;
--   DROP TRIGGER IF EXISTS appointments_guard_requested_time ON public.appointments;
--   DROP FUNCTION IF EXISTS public.appointments_guard_requested_time();
--   ALTER TABLE public.appointments
--     ADD CONSTRAINT appointments_requested_time_future
--     CHECK (requested_time > now()) NOT VALID;
--   COMMIT;

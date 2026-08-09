-- ─── Migration 1a — record_no_show(): require the appointment to have elapsed ──
--
-- Low-severity audit finding: a provider could strike/block a customer on a
-- CONFIRMED appointment BEFORE it happened. The provider-completion RLS policy
-- ("providers can complete appointments") already requires `requested_time < now()`;
-- record_no_show is SECURITY DEFINER so it bypasses that policy and had no such
-- guard. This adds the same time check to the authorization SELECT: a no-show can
-- only be recorded once the slot has actually passed.
--
-- Minimal fold-in (Berke's call): a future appointment now fails the same SELECT and
-- returns the EXISTING 'Not authorized or appointment not found'. That's a
-- server-side backstop — the no-show button is only offered on elapsed appointments,
-- so this path shouldn't be reachable from the UI — hence no new user-facing string
-- (which would need translating across 9 locales for a path users don't hit).
--
-- CREATE OR REPLACE — idempotent. Signature / return / SECURITY DEFINER / pinned
-- search_path are all unchanged, so the three RPC call sites (ProviderScreen:290,
-- GroomingBookingsScreen:112, GarageBookingsScreen:138) and grants are untouched.
-- Behavior change is registered via H-token (0819_record_no_show_time_guard).
-- Apply in the SQL editor, Role = postgres.

CREATE OR REPLACE FUNCTION public.record_no_show(p_appointment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_customer_id uuid;
BEGIN
  SELECT a.customer_id INTO v_customer_id
  FROM appointments a
  JOIN facilities f ON f.id = a.facility_id
  WHERE a.id = p_appointment_id
    AND f.provider_id = auth.uid()
    AND a.status = 'confirmed'
    AND a.requested_time < now();          -- NEW: only after the slot has elapsed

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized or appointment not found';
  END IF;

  UPDATE appointments SET status = 'no_show' WHERE id = p_appointment_id;

  UPDATE profiles
  SET
    strikes = strikes + 1,
    blocked_until = CASE
      WHEN strikes + 1 >= 3 THEN now() + interval '7 days'
      ELSE blocked_until
    END
  WHERE id = v_customer_id;
END;
$function$;

-- ── Verification (Role = postgres) ───────────────────────────────────────────
--   SELECT pg_get_functiondef('public.record_no_show(uuid)'::regprocedure)
--            ILIKE '%requested_time < now()%';   -- expect: t
--
-- ── Rollback (re-allows striking a future appointment — do not, unless reverting) ─
--   Re-create the function WITHOUT the `AND a.requested_time < now()` line; body
--   otherwise identical, keep SECURITY DEFINER + SET search_path TO 'public'.

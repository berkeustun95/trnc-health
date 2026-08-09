-- ─── Migration 1b — get_customer_contacts(): column-limited provider→customer read ─
--
-- Audit finding: the "providers read customer push token" RLS policy on profiles is
-- row-level, so despite its name it exposes a customer's ENTIRE profile row to any
-- provider they've booked with — including phone, nationality, strikes, blocked_until,
-- ugc_banned_until — none of which any provider screen reads. Postgres RLS can't limit
-- columns, and column GRANTs can't either (providers and customers share the
-- `authenticated` role, separated only by RLS predicates). The clean fix is a
-- SECURITY DEFINER function that returns ONLY the columns providers actually use.
--
-- This migration is ADDITIVE and safe to apply anytime: it creates the function and
-- coexists with the existing broad policy. The app is repointed to it in the Slice
-- OTA, and only AFTER that adoption does Migration 2 (20260820) DROP the broad policy.
--
-- SAFE COLUMN SET (verified against every provider read — ProviderScreen:148/167/185/
-- 253, Grooming/GarageBookingsScreen): id, full_name, push_token, preferred_language.
-- Providers never read phone / nationality / avatar_url / the moderation columns.
--
-- AUTHORIZATION — mirrors the existing policy predicate EXACTLY (neither wider nor
-- narrower):  get_my_role() = 'provider'  AND  EXISTS(appointments a JOIN facilities f
-- ON a.facility_id = f.id WHERE a.customer_id = <row> AND f.provider_id = auth.uid()).
-- Plus the anonymous-session guard we apply to writes elsewhere (NOT
-- is_anonymous_session()) — a guest is a customer, never a provider, so there is no
-- legitimate guest caller; a guest simply gets zero rows (silent, like the storage
-- policies). auth.uid() / auth.jwt() resolve to the ORIGINAL caller inside a SECURITY
-- DEFINER function, so both checks bind to the real caller, not the definer.
--
-- Idempotent (CREATE OR REPLACE). Registered in verify_schema (C-function + G-grant).
-- Apply in the SQL editor, Role = postgres.

CREATE OR REPLACE FUNCTION public.get_customer_contacts(p_ids uuid[])
 RETURNS TABLE(id uuid, full_name text, push_token text, preferred_language text)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.full_name, p.push_token, p.preferred_language
  FROM profiles p
  WHERE p.id = ANY(p_ids)
    AND NOT public.is_anonymous_session()
    AND get_my_role() = 'provider'
    AND EXISTS (
      SELECT 1
      FROM appointments a
      JOIN facilities f ON f.id = a.facility_id
      WHERE a.customer_id = p.id
        AND f.provider_id = auth.uid()
    );
$function$;

GRANT EXECUTE ON FUNCTION public.get_customer_contacts(uuid[]) TO authenticated;

-- ── Who can call / see what ──────────────────────────────────────────────────
--   • A provider (non-anon) gets {id, full_name, push_token, preferred_language} for
--     ONLY those p_ids that are their own customers (an appointment at their
--     facility). No other columns are reachable, and not for anyone else's customers.
--   • A customer, an anonymous guest, or a provider passing a stranger's id → 0 rows.
--   • This does NOT yet remove the broad policy — that's Migration 2, after the OTA.
--
-- ── Verification (Role = postgres) ───────────────────────────────────────────
--   -- exists + granted + returns exactly the 4 safe columns:
--   SELECT proname, prosecdef,
--          pg_get_function_result(oid) AS returns,
--          has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_can_exec
--     FROM pg_proc
--    WHERE proname = 'get_customer_contacts';
--   -- expect: prosecdef = t, returns lists id/full_name/push_token/preferred_language,
--   --         auth_can_exec = t
--
-- ── Rollback ─────────────────────────────────────────────────────────────────
--   DROP FUNCTION IF EXISTS public.get_customer_contacts(uuid[]);

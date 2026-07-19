-- ─── FIX S1 (signup admin-takeover) + D2 (illegal home_service_provider role) ──
--
-- S1 — CRITICAL, remotely exploitable privilege escalation (fix first).
--   handle_new_user() copied raw_user_meta_data->>'role' straight into
--   profiles.role, and profiles_role_check accepts 'admin'. The anon key ships
--   in the app bundle, so ANYONE could call
--       supabase.auth.signUp({ ..., options: { data: { role: 'admin' } } })
--   and land a production admin profile. handle_new_user is SECURITY DEFINER and
--   fires on the auth.users INSERT (before email confirmation), so the admin row
--   exists immediately; the attacker confirms their own email and logs in as
--   admin. The existing "owner update" guard (role = get_my_role()) only blocks
--   escalation on UPDATE of an existing profile — it never covered this INSERT
--   path.
--
--   FIX: sanitize the role inside handle_new_user against a signup allow-list.
--   Only customer / provider / organizer may be self-selected (this mirrors the
--   AuthScreen role picker at AuthScreen.js:247). Any other value — including
--   'admin', and the admin-granted roles 'estate_agent' / 'home_service_provider'
--   — is forced to 'customer'. Privileged roles are assigned later by an admin
--   (AdminScreen), never at signup.
--
--   Behaviour preserved: the function still only inserts (id, role); it stays
--   SECURITY DEFINER with SET search_path = public. Nothing else changes.
--
-- D2 — profiles_role_check is missing 'home_service_provider'.
--   Admin home-service approval sets role='home_service_provider'
--   (AdminScreen.js:2477); the app routes that role to HomeServiceDashboardScreen
--   (App.js:912-913) and excludes it from the customer hub (App.js:761). The role
--   is genuinely needed (routing is purely by role — 'provider' would misroute to
--   the medical ProviderScreen), but the CHECK rejects it, so the approval UPDATE
--   fails (or the constraint was silently patched live = drift). This adds the
--   role to the constraint. It is deliberately NOT added to the signup allow-list
--   above — like estate_agent, it is admin-granted only.
--
--   This is the ONLY change D2 needs — no app-side change is required.
--
-- Does NOT touch any policy, trigger wiring, or other function.

BEGIN;

-- ─── S1: sanitized role assignment at signup ────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text := coalesce(new.raw_user_meta_data->>'role', 'customer');
BEGIN
  -- Signup allow-list. Anything outside it (incl. 'admin', 'estate_agent',
  -- 'home_service_provider') is forced to 'customer'; privileged roles are
  -- granted later by an admin, never trusted from client-supplied signup metadata.
  IF v_role NOT IN ('customer', 'provider', 'organizer') THEN
    v_role := 'customer';
  END IF;

  INSERT INTO public.profiles (id, role)
  VALUES (new.id, v_role);

  RETURN new;
END;
$function$;

-- ─── D2: allow the admin-granted home_service_provider role ─────────────────
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY[
    'customer'::text,
    'provider'::text,
    'admin'::text,
    'organizer'::text,
    'estate_agent'::text,
    'home_service_provider'::text
  ]));

COMMIT;

-- ─── Rollback ────────────────────────────────────────────────────────────────
-- ⚠️ The handle_new_user rollback RE-OPENS the S1 admin-takeover hole, and the
-- constraint rollback RE-BREAKS home-service approval. Roll back only if you
-- fully intend both.
--
--   BEGIN;
--   CREATE OR REPLACE FUNCTION public.handle_new_user()
--    RETURNS trigger
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO 'public'
--   AS $function$
--   begin
--     insert into public.profiles (id, role)
--     values (
--       new.id,
--       coalesce(new.raw_user_meta_data->>'role', 'customer')
--     );
--     return new;
--   end;
--   $function$;
--
--   ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
--   ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
--     CHECK (role = ANY (ARRAY[
--       'customer'::text, 'provider'::text, 'admin'::text,
--       'organizer'::text, 'estate_agent'::text
--     ]));
--   COMMIT;

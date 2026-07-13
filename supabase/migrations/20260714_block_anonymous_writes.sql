-- Block writes by anonymous (guest) sessions.
--
-- WHY: enabling the Anonymous auth provider means a guest is a real `authenticated`
-- user with a real auth.uid(). Every existing write policy keys off `auth.uid()` or
-- `TO authenticated`, so a guest would satisfy them and could insert job postings,
-- reviews, questions, appointments and reports straight through the public API with
-- the anon key. The in-app gate is UI only; this file is the actual boundary.
--
-- RUN THIS BEFORE ENABLING THE ANONYMOUS PROVIDER so there is no exposure window.
--
-- HOW: these are RESTRICTIVE policies. Postgres ANDs them with the existing
-- permissive policies instead of ORing, so we add a veto on top of the current rules
-- without reading, editing or dropping any of them. Only INSERT/UPDATE/DELETE are
-- restricted — there is deliberately no restrictive SELECT policy, so guests keep
-- full read access to everything, which is the whole point of guest mode.
--
-- PLAIN ENGLISH:
--   - Guest (anonymous) session: can READ every table exactly as before. Cannot
--     INSERT, UPDATE or DELETE anything, anywhere in this list.
--   - Signed-up user / provider / admin: completely unaffected. Their JWT has
--     is_anonymous = false, so the veto never fires and their existing policies
--     decide access exactly as they do today.
--   - Unauthenticated (no session at all): unchanged — existing policies already
--     block them.

BEGIN;

-- true only for a Supabase anonymous session. Absent claim (real user) -> false.
CREATE OR REPLACE FUNCTION public.is_anonymous_session()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
$$;

GRANT EXECUTE ON FUNCTION public.is_anonymous_session() TO authenticated;

DO $$
DECLARE
  tbl text;
  -- Every table the app writes to on behalf of a user.
  -- Reference/read-only tables (avatars, blocked_terms, bus_routes, duty_list,
  -- duty_schedule, estate_agencies) are intentionally omitted: no user writes them,
  -- and guests must keep reading them.
  tables text[] := ARRAY[
    'answers', 'appointments', 'beaches', 'blocks', 'claim_requests',
    'content_reports', 'estate_agents', 'events', 'facilities',
    'facility_change_requests', 'home_services', 'job_postings', 'landmarks',
    'notifications', 'profiles', 'properties', 'property_images',
    'provider_credentials', 'provider_documents', 'questions', 'reviews',
    'transport_providers'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN
      RAISE EXCEPTION 'table public.% does not exist — fix the list before running', tbl;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'no_anon_insert_' || tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'no_anon_update_' || tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'no_anon_delete_' || tbl, tbl);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated
         WITH CHECK (NOT public.is_anonymous_session())',
      'no_anon_insert_' || tbl, tbl);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated
         USING (NOT public.is_anonymous_session())
         WITH CHECK (NOT public.is_anonymous_session())',
      'no_anon_update_' || tbl, tbl);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated
         USING (NOT public.is_anonymous_session())',
      'no_anon_delete_' || tbl, tbl);
  END LOOP;
END $$;

COMMIT;

-- Rollback:
--   DO $$ DECLARE tbl text; BEGIN
--     FOREACH tbl IN ARRAY ARRAY['answers','appointments','beaches','blocks','claim_requests',
--       'content_reports','estate_agents','events','facilities','facility_change_requests',
--       'home_services','job_postings','landmarks','notifications','profiles','properties',
--       'property_images','provider_credentials','provider_documents','questions','reviews',
--       'transport_providers'] LOOP
--       EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'no_anon_insert_' || tbl, tbl);
--       EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'no_anon_update_' || tbl, tbl);
--       EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'no_anon_delete_' || tbl, tbl);
--     END LOOP; END $$;

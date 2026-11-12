-- Test fixture (NOT production): brings a test database's public.profiles up to what 20261191 stands on, for suites whose own
-- profiles table is a stub (messaging-live.sql): the columns the live name trigger reads and writes, the three helpers it calls
-- (stubs, created only when absent so a suite's own contains_blocked_term stays), then the REAL production triggers
-- (profiles-triggers-live-2026-10-07.sql: check_profile_name_content, whose branch (g) stamps terms_accepted_at, and
-- guard_profile_ban). Needs get_my_role() and an existing profiles(id, role, display_name, date_of_birth) table.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name text, ADD COLUMN IF NOT EXISTS last_name text, ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS display_name_normalized text, ADD COLUMN IF NOT EXISTS resident_status text,
  ADD COLUMN IF NOT EXISTS resident_status_updated_at timestamptz, ADD COLUMN IF NOT EXISTS age_ineligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS terms_version text, ADD COLUMN IF NOT EXISTS terms_locale text, ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_opt_in_at timestamptz, ADD COLUMN IF NOT EXISTS ugc_banned_until timestamptz;
DO $stubs$
BEGIN
  IF to_regprocedure('public.contains_blocked_term(text)') IS NULL THEN
    CREATE FUNCTION public.contains_blocked_term(t text) RETURNS boolean LANGUAGE sql AS 'SELECT t ILIKE ''%badword%''';
  END IF;
  IF to_regprocedure('public.normalize_display_name(text)') IS NULL THEN
    CREATE FUNCTION public.normalize_display_name(t text) RETURNS text LANGUAGE sql AS 'SELECT nullif(lower(btrim(t)), '''')';
  END IF;
  IF to_regprocedure('public.is_reserved_display_name(text)') IS NULL THEN
    CREATE FUNCTION public.is_reserved_display_name(t text) RETURNS boolean LANGUAGE sql AS 'SELECT false';
  END IF;
END $stubs$;

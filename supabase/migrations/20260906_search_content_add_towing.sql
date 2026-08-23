-- ─── search_content — add the towing_companies arm (Çekici Slice 2) ─────────
--
-- Extends the global search RPC to cover towing firms, matching how job_postings and
-- transport_providers were added. SECURITY INVOKER is preserved, so per-table RLS stays
-- in force and this cannot widen what any caller can see.
--
-- Fields for result rendering: title = firm name, subtitle = base region, module =
-- 'towing' (matches the app's module-handler key in App.js oliNavigate + HomeScreen
-- RESULT_META), id for nav.
--
-- WHY THIS SHIPS WHILE THE MODULE IS DARK: towing_companies has ZERO active rows until
-- Slice 3, so this arm returns nothing and leaks nothing today. Once firms are seeded,
-- a search hit routes through the same App.js gate as every other module and lands on
-- Coming Soon while MODULE_FLAGS.towing is false — the established job_postings
-- behaviour (that module is dark too and has been searchable since 20260705). Following
-- the precedent rather than special-casing keeps one rule for all modules.
--
-- BEHAVIOUR-ONLY CHANGE: this is a CREATE OR REPLACE that adds no new named object, so
-- existence checks cannot tell the new body from the old. It is registered in
-- verify_schema.sql section H as the token '0906_search_content_add_towing'.
--
-- Base: the body from 20260820_search_content_gate_facilities.sql, unchanged except for
-- the appended arm. Apply with Role = postgres. Idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION public.search_content(query text, user_lat double precision DEFAULT NULL::double precision, user_lon double precision DEFAULT NULL::double precision)
 RETURNS TABLE(id text, title text, subtitle text, module text, lat double precision, lon double precision)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT *
  FROM (

    -- Medical facilities — moderation-gated (hide suspended / pending / hidden)
    SELECT
      f.id::text,
      f.name                                        AS title,
      COALESCE(f.address, f.type::text, '')         AS subtitle,
      'medical'                                     AS module,
      f.latitude                                    AS lat,
      f.longitude                                   AS lon
    FROM facilities f
    WHERE f.hidden_at IS NULL
      AND f.status IN ('active','trial')
      AND (f.name    ILIKE '%' || query || '%'
        OR f.address ILIKE '%' || query || '%')

    UNION ALL

    -- Upcoming approved events
    SELECT
      e.id::text,
      e.title,
      COALESCE(e.location, '')                      AS subtitle,
      'events'                                      AS module,
      NULL::float8                                  AS lat,
      NULL::float8                                  AS lon
    FROM events e
    WHERE e.status     = 'approved'
      AND e.start_date >= now() - interval '1 day'
      AND (e.title    ILIKE '%' || query || '%'
        OR e.location ILIKE '%' || query || '%')

    UNION ALL

    -- Beaches (name is JSONB keyed by lang code)
    SELECT
      b.id::text,
      COALESCE(b.name->>'en', '')                   AS title,
      COALESCE(b.district, '')                      AS subtitle,
      'beach'                                       AS module,
      b.latitude                                    AS lat,
      b.longitude                                   AS lon
    FROM beaches b
    WHERE b.status = 'active'
      AND (b.name->>'en' ILIKE '%' || query || '%'
        OR b.name->>'tr' ILIKE '%' || query || '%')

    UNION ALL

    -- Landmarks (name is JSONB keyed by lang code)
    SELECT
      l.id::text,
      COALESCE(l.name->>'en', '')                   AS title,
      COALESCE(l.district, '')                      AS subtitle,
      'landmark'                                    AS module,
      l.latitude                                    AS lat,
      l.longitude                                   AS lon
    FROM landmarks l
    WHERE l.status = 'active'
      AND (l.name->>'en' ILIKE '%' || query || '%'
        OR l.name->>'tr' ILIKE '%' || query || '%')

    UNION ALL

    -- Home service providers
    SELECT
      hs.id::text,
      hs.name,
      COALESCE(hs.district, '')                     AS subtitle,
      'homeServices'                                AS module,
      NULL::float8                                  AS lat,
      NULL::float8                                  AS lon
    FROM home_services hs
    WHERE hs.status = 'active'
      AND hs.name ILIKE '%' || query || '%'

    UNION ALL

    -- Transport providers
    SELECT
      tp.id::text,
      tp.name,
      COALESCE(tp.type, '')                         AS subtitle,
      'transport'                                   AS module,
      NULL::float8                                  AS lat,
      NULL::float8                                  AS lon
    FROM transport_providers tp
    WHERE tp.status = 'active'
      AND tp.name ILIKE '%' || query || '%'

    UNION ALL

    -- Job postings (only publicly visible: active + not expired)
    SELECT
      jp.id::text,
      jp.job_title                                  AS title,
      jp.employer_name || ' · ' || initcap(jp.district) AS subtitle,
      'jobPostings'                                 AS module,
      NULL::float8                                  AS lat,
      NULL::float8                                  AS lon
    FROM job_postings jp
    WHERE jp.status = 'active'
      AND jp.expires_at IS NOT NULL
      AND jp.expires_at > now()
      AND (jp.job_title     ILIKE '%' || query || '%'
        OR jp.employer_name ILIKE '%' || query || '%')

    UNION ALL

    -- Towing / roadside-assistance firms (Çekici & Yol Yardım).
    -- SECURITY INVOKER means towing_select_public already hides inactive rows from a
    -- normal caller; the explicit is_active filter is belt-and-braces so an ADMIN
    -- searching does not get inactive firms mixed into their results (their RLS would
    -- otherwise let those through via towing_select_admin_all).
    SELECT
      tc.id::text,
      tc.name                                       AS title,
      initcap(tc.base_region)                       AS subtitle,
      'towing'                                      AS module,
      NULL::float8                                  AS lat,
      NULL::float8                                  AS lon
    FROM towing_companies tc
    WHERE tc.is_active
      AND tc.name ILIKE '%' || query || '%'

  ) combined
  ORDER BY
    -- Distance first when location is available
    CASE
      WHEN lat IS NOT NULL AND user_lat IS NOT NULL THEN
        6371 * acos(LEAST(1.0,
          cos(radians(user_lat)) * cos(radians(lat))
            * cos(radians(lon) - radians(user_lon))
          + sin(radians(user_lat)) * sin(radians(lat))
        ))
    END ASC NULLS LAST,
    -- Then alphabetical
    title ASC
  LIMIT 40
$function$;

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
VALUES ('20260906_search_content_add_towing.sql', '12857e3f341d06e753bf310af9269883c0f1f06db65751825b07f2b15073bf0e')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

-- No NOTIFY pgrst needed: no table or column shape changed, and PostgREST resolves RPCs
-- by name at call time. (Kept explicit so the omission reads as deliberate.)

-- ─── Verification (Role = postgres) ──────────────────────────────────────────
--   -- the arm is present in the live body:
--   SELECT pg_get_functiondef('public.search_content(text,double precision,double precision)'::regprocedure)
--          ILIKE '%towing_companies%' AS has_towing_arm;   -- expect true
--   -- and returns nothing while no firm is active:
--   SELECT * FROM search_content('kurtarma');              -- expect 0 towing rows in Slice 2

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   Re-apply supabase/migrations/20260820_search_content_gate_facilities.sql, then
--   DELETE FROM public.schema_migrations_applied WHERE filename = '20260906_search_content_add_towing.sql';

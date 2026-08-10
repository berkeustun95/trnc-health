-- ─── Moderation slice, Step 1b — search_content: gate the facilities arm ───────
--
-- search_content is SECURITY INVOKER, so Step 1a's RLS already stops suspended /
-- hidden facilities from surfacing in search for the public. This adds the SAME
-- gate explicitly in the facilities arm as defense-in-depth: it holds even if the
-- function is ever made SECURITY DEFINER, and it also hides a provider's OWN
-- suspended listing from public search (the owner RLS arm would otherwise let them
-- find it there). ONLY the facilities arm changes — every other arm (events,
-- beaches, landmarks, home_services, transport, job_postings), the signature, the
-- ORDER BY and LIMIT are byte-identical to the live definition (capture_3).
--
-- Idempotent (CREATE OR REPLACE). Registered in verify_schema
-- (H-token 0820_search_content_gate_facilities). Apply Role = postgres.

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

-- ── Verification (Role = postgres) ───────────────────────────────────────────
--   SELECT pg_get_functiondef('public.search_content(text,double precision,double precision)'::regprocedure)
--            ILIKE '%f.hidden_at IS NULL%';   -- expect: t
--   -- functional: a suspended/hidden facility must NOT appear in results:
--   -- SELECT * FROM search_content('<suspended facility name>');   -- expect 0 medical rows
--
-- ── Rollback (restores the unfiltered facilities arm) ────────────────────────
--   Re-create with the facilities WHERE as just:
--     WHERE f.name ILIKE '%'||query||'%' OR f.address ILIKE '%'||query||'%'
--   (all other arms identical).

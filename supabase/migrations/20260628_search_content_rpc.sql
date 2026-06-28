-- search_content: global search RPC
-- SECURITY INVOKER means RLS on each table applies automatically.
-- Run in Supabase SQL editor.

CREATE OR REPLACE FUNCTION search_content(
  query    text,
  user_lat float8 DEFAULT NULL,
  user_lon float8 DEFAULT NULL
)
RETURNS TABLE(
  id       text,
  title    text,
  subtitle text,
  module   text,
  lat      float8,
  lon      float8
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT *
  FROM (

    -- Medical facilities (all public — no status filter)
    SELECT
      f.id::text,
      f.name                                        AS title,
      COALESCE(f.address, f.type::text, '')         AS subtitle,
      'medical'                                     AS module,
      f.latitude                                    AS lat,
      f.longitude                                   AS lon
    FROM facilities f
    WHERE f.name    ILIKE '%' || query || '%'
       OR f.address ILIKE '%' || query || '%'

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
$$;

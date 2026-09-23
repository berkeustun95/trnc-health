-- ═══════════════════════════════════════════════════════════════════════════
-- 20261047 — search_content reads `places`, not the legacy beaches / landmarks tables
-- ═══════════════════════════════════════════════════════════════════════════
--
-- MUST LAND BEFORE the 59 Visit NCY stops (20261045 + the importer) are activated.
--
-- ─── WHY ────────────────────────────────────────────────────────────────────
-- Explore has read `places` since the 0822 consolidation, but global search never moved:
-- search_content still has one arm on `beaches` and one on `landmarks`. Measured LIVE as
-- anon, 2026-09-23: search_content('selimiye') returns ONE row, module 'landmark' — the
-- legacy arm — and a broad query shows only medical / landmark / beach / towing /
-- homeServices. Every active place today has an identical twin in the legacy tables (42
-- of 42), which is the only reason nobody noticed. A place added after 0822 has no twin,
-- so the 59 stops would activate onto the Explore map and stay unfindable from search.
--
-- ─── WHAT CHANGES ───────────────────────────────────────────────────────────
-- The two legacy arms become ONE arm on places (status active, hidden_at null — the
-- facilities arm's gate). module stays 'beach' for category beach and 'landmark' for
-- everything else: those are the two labels the SHIPPED app routes (HomeScreen, both via
-- openPlaceById on the preserved UUID), so this needs no OTA. Every other arm, the
-- relevance-over-distance ORDER BY and LIMIT 40 are copied byte-for-byte from 20260924
-- (generated, and asserted identical outside the swapped span).
-- Nothing is lost: all 38 active landmarks and 4 active beaches have an active places
-- twin. The legacy TABLES are untouched — this only stops reading them.
--
-- Signature and RETURNS are unchanged, so PostgREST's cache is unaffected: no NOTIFY.
-- CREATE OR REPLACE keeps the grants and SECURITY INVOKER.
--
-- Apply: SQL Editor, Role = postgres, whole file ONCE, copied from disk. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.search_content(query text, user_lat double precision DEFAULT NULL::double precision, user_lon double precision DEFAULT NULL::double precision)
 RETURNS TABLE(id text, title text, subtitle text, module text, lat double precision, lon double precision)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT *
  FROM (

    -- Medical facilities — moderation-gated (hide suspended / pending / draft / hidden)
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
      -- ── UNCLAIMED PHARMACIES ARE NOT DIRECTORY CONTENT (2026-08-28) ─────────
      -- 387 of the 394 customer-visible facilities are pharmacies with no provider_id:
      -- the whole KTEB list, none of which has any relationship with ADA. The client
      -- stopped listing them in the same slice, and this arm is why that is not enough
      -- on its own — search_content reads the tables directly, so without this predicate
      -- every one of the 387 stays findable by name from the global search bar while
      -- being absent from the list. That asymmetry is the thing being removed.
      -- A pharmacy WITH a provider_id is a subscriber and stays searchable; a state
      -- facility (sector='public') has no provider_id and is untouched by this.
      -- duty_list is a different table with no join to facilities — the duty roster is
      -- unaffected, and remains the one place ADA serves pharmacies.
      AND NOT (f.type = 'pharmacy' AND f.provider_id IS NULL)
      AND public.search_all_tokens(
            coalesce(f.name,'') || ' ' || coalesce(f.name_official,'') || ' ' || coalesce(f.address,''),
            query)

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
      AND public.search_all_tokens(
            coalesce(e.title,'') || ' ' || coalesce(e.location,''), query)

    UNION ALL

    -- Explore places — ONE arm since the 0822 consolidation. module stays 'beach' /
    -- 'landmark' because those are the two labels the shipped app routes, both through
    -- openPlaceById(); a new label would reach a build that ignores it. Gated like the
    -- Explore list (status active) plus hidden_at, as the facilities arm is.
    SELECT
      p.id::text,
      p.name                                        AS title,
      p.region                                      AS subtitle,
      CASE WHEN p.category = 'beach' THEN 'beach' ELSE 'landmark' END AS module,
      p.latitude                                    AS lat,
      p.longitude                                   AS lon
    FROM places p
    WHERE p.status = 'active'
      AND p.hidden_at IS NULL
      AND public.search_all_tokens(
            coalesce(p.name,'') || ' ' || coalesce(p.name_i18n->>'en','') || ' '
              || coalesce(p.name_i18n->>'tr',''), query)

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
      AND public.search_all_tokens(coalesce(hs.name,''), query)

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
      AND public.search_all_tokens(coalesce(tp.name,''), query)

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
      AND public.search_all_tokens(
            coalesce(jp.job_title,'') || ' ' || coalesce(jp.employer_name,''), query)

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
      AND public.search_all_tokens(coalesce(tc.name,''), query)

  ) combined
  ORDER BY
    -- TITLE RELEVANCE OUTRANKS DISTANCE. A GENERAL RULE, NOT A HEALTH PATCH.
    --
    -- Measured before this change, user in central Lefkoşa, query "Hastanesi": a pharmacy
    -- 49 KM AWAY outranked every hospital in the country — because pharmacies have
    -- coordinates and the hospitals do not, and `distance ASC NULLS LAST` sorts every
    -- unplaced row last, forever. Slices 3 and 4 add ~27 more unplaced rows.
    --
    -- Deliberately written so it is STILL CORRECT on the day every coordinate is filled:
    -- it never says "prefer rows without coordinates", it says "a row whose NAME matches
    -- more of what you typed beats a row that merely happens to be nearer". Verified not
    -- to disturb the common case — for "eczane" every pharmacy scores 1, so distance
    -- still decides the order exactly as it does today.
    public.search_token_hits(title, query) DESC,
    -- Distance next, when location is available
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

-- ─── Assertions: shape from pg_get_functiondef, behaviour as anon ────────────
DO $$
DECLARE
  v_def   text := pg_get_functiondef('public.search_content(text,double precision,double precision)'::regprocedure);
  v_act   uuid; v_beach uuid; v_pend uuid; v_hid uuid;
  n_act   int := -1; m_act text; n_beach int := -1; m_beach text; n_pend int := -1; n_hid int := -1;
  v_ctl_id uuid; v_ctl_name text; n_ctl int := -1; m_ctl text;
  v_vn_id  uuid; v_vn_name  text; n_vn  int := -1;
BEGIN
  -- Shape. Anchored to code (FROM <table> <alias>) — the arm's own comment names no table.
  IF v_def NOT ILIKE '%FROM places p%' OR v_def ILIKE '%FROM landmarks l%' OR v_def ILIKE '%FROM beaches b%' THEN
    RAISE EXCEPTION 'search_content is not reading places (or still reads a legacy table). def=%', left(v_def, 600);
  END IF;
  IF v_def NOT ILIKE '%FROM facilities f%' OR v_def NOT ILIKE '%FROM events e%'
     OR v_def NOT ILIKE '%FROM home_services hs%' OR v_def NOT ILIKE '%FROM transport_providers tp%'
     OR v_def NOT ILIKE '%FROM job_postings jp%' OR v_def NOT ILIKE '%FROM towing_companies tc%' THEN
    RAISE EXCEPTION 'search_content lost one of its other six arms';
  END IF;

  -- Behaviour, discriminating: rows that exist ONLY in places (no legacy twin), searched as
  -- anon. Written inside a sub-block that ends in a sentinel, so every probe row rolls back.
  BEGIN
    INSERT INTO public.places (category, name, region, status)
      VALUES ('museum', 'Zzqprobeactive', 'nicosia', 'active')  RETURNING id INTO v_act;
    INSERT INTO public.places (category, name, region, status)
      VALUES ('beach',  'Zzqprobebeach',  'kyrenia', 'active')  RETURNING id INTO v_beach;
    INSERT INTO public.places (category, name, region, status)
      VALUES ('museum', 'Zzqprobepending','nicosia', 'pending') RETURNING id INTO v_pend;
    INSERT INTO public.places (category, name, region, status, hidden_at)
      VALUES ('museum', 'Zzqprobehidden', 'nicosia', 'active', now()) RETURNING id INTO v_hid;

    SET LOCAL ROLE anon;
    SELECT count(*), max(module) INTO n_act,   m_act   FROM public.search_content('zzqprobeactive')  WHERE id = v_act::text;
    SELECT count(*), max(module) INTO n_beach, m_beach FROM public.search_content('zzqprobebeach')   WHERE id = v_beach::text;
    SELECT count(*)              INTO n_pend           FROM public.search_content('zzqprobepending') WHERE id = v_pend::text;
    SELECT count(*)              INTO n_hid            FROM public.search_content('zzqprobehidden')  WHERE id = v_hid::text;
    RESET ROLE;
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF n_act   IS DISTINCT FROM 1 OR m_act   IS DISTINCT FROM 'landmark' THEN
    RAISE EXCEPTION 'an active place with no legacy twin: % row(s), module % (expected 1, landmark)', n_act, m_act;
  END IF;
  IF n_beach IS DISTINCT FROM 1 OR m_beach IS DISTINCT FROM 'beach' THEN
    RAISE EXCEPTION 'an active beach place: % row(s), module % (expected 1, beach)', n_beach, m_beach;
  END IF;
  IF n_pend  IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'a PENDING place is searchable (% row)', n_pend; END IF;
  IF n_hid   IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'a HIDDEN place is searchable (% row)', n_hid;   END IF;
  IF EXISTS (SELECT 1 FROM public.places WHERE name LIKE 'Zzqprobe%') THEN
    RAISE EXCEPTION 'probe rows survived the rollback';
  END IF;

  -- Real data, as anon. Control: an existing active place is found exactly once — once,
  -- not twice, because its legacy twin is no longer a second arm. And a pending Visit NCY
  -- stop is not found (skipped only if none is pending, i.e. after activation).
  SELECT id, name INTO v_ctl_id, v_ctl_name FROM public.places
   WHERE status = 'active' AND hidden_at IS NULL AND category <> 'beach' ORDER BY name LIMIT 1;
  SELECT id, name INTO v_vn_id, v_vn_name FROM public.places
   WHERE source = 'visitncy' AND status = 'pending' ORDER BY name LIMIT 1;
  SET LOCAL ROLE anon;
  SELECT count(*), max(module) INTO n_ctl, m_ctl FROM public.search_content(v_ctl_name) WHERE id = v_ctl_id::text;
  IF v_vn_id IS NOT NULL THEN
    SELECT count(*) INTO n_vn FROM public.search_content(v_vn_name) WHERE id = v_vn_id::text;
  END IF;
  RESET ROLE;
  IF n_ctl IS DISTINCT FROM 1 OR m_ctl IS DISTINCT FROM 'landmark' THEN
    RAISE EXCEPTION 'control: "%" found % time(s) as %, expected once as landmark', v_ctl_name, n_ctl, m_ctl;
  END IF;
  IF v_vn_id IS NOT NULL AND n_vn IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'pending Visit NCY stop "%" is searchable (% row)', v_vn_name, n_vn;
  END IF;
END $$;

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
VALUES ('20261047_search_content_places_arm.sql', '626e14e8b3d58bb2ff8ad0a20b00078ce1186134fae4c39a1a18b4f5b1cb56a6')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

-- ─── Verification after applying (read-only; run as anon via the REST API or Role = anon) ─
--   SELECT id, module FROM public.search_content('selimiye');   -- expect ONE row, module landmark
--
-- ─── Rollback: re-run supabase/migrations/20260924_search_content_hide_unclaimed_pharmacies.sql
--   (its CREATE OR REPLACE only — not its ledger INSERT).

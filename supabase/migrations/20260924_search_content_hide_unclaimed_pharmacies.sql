-- ═══ search_content — unclaimed pharmacies leave the search index ══════════
--
-- Product decision 2026-08-28: an unclaimed pharmacy is not directory content. A
-- pharmacy WITH a provider_id (a subscriber) keeps full visibility everywhere; a state
-- facility (sector='public') keeps it too. Only `type='pharmacy' AND provider_id IS NULL`
-- goes — 387 of the 394 customer-visible rows.
--
-- ─── WHY THIS FILE EXISTS AT ALL ────────────────────────────────────────────
--
-- The client-side half of this slice hides those rows from the browse list, the map pins
-- and the favourites tab. That is not sufficient on its own, and CLAUDE.md already says
-- why in a different context:
--
--   "MODULE_FLAGS does not gate search. search_content returns rows straight from the
--    tables, so a module flag only hides the SCREEN."
--
-- The same is true here. Ship only the client and all 387 stay findable by name from the
-- global search bar while being absent from every list — a user who searches "eczane",
-- taps a result and lands on a facility ADA does not carry learns something worse than
-- nothing. The two halves are one change.
--
-- ─── WHAT WAS REJECTED: DOING THIS IN RLS ───────────────────────────────────
--
-- The obvious "do it once, at the boundary" move is to narrow `public read live
-- facilities`. It was considered and REJECTED, and NOT because RLS is hard to roll back.
--
-- ProviderOnboardingScreen.js:67 builds the claim picker with
--     supabase.from('facilities').select('id, name, type, address').is('provider_id', null)
-- and that query IS the 387 rows. Narrow the read policy and the picker returns empty:
-- no pharmacy could ever be claimed again. The rule exists to make claiming attractive,
-- so an implementation that makes claiming impossible defeats it outright.
--
-- Consequence, stated plainly so nobody mistakes it later: THE ROWS REMAIN FETCHABLE.
-- App.js:781 still selects all 394 and anyone reading the app's traffic sees them. That
-- is acceptable — this is a PRODUCT decision about what ADA promotes, not a
-- confidentiality boundary, and the data is a public directory with no user content.
-- Do not cite this migration as a security control.
--
-- ─── WHAT IS NOT TOUCHED ────────────────────────────────────────────────────
--
-- duty_list, and therefore DutyListScreen. It is a separate table with no facility_id
-- and no join to facilities, so the duty roster is unaffected — which matters, because
-- the roster is now the ONLY surface where ADA serves pharmacies, and the pharmacy chip
-- on Home routes there.
--
-- Everything else in this function is byte-identical to 20260912. The ONLY change is the
-- single AND NOT (...) predicate in the facilities arm, plus its comment.
--
-- Apply by hand: SQL editor, Role = postgres. Then `node scripts/migration-ledger.mjs`
-- and re-run supabase/verify_schema.sql (Query 1) — the 0924 token must read OK before
-- the client OTA ships, or the app hides pharmacies while search still returns them.

SET ROLE postgres;
BEGIN;

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
      AND public.search_all_tokens(
            coalesce(b.name->>'en','') || ' ' || coalesce(b.name->>'tr',''), query)

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
      AND public.search_all_tokens(
            coalesce(l.name->>'en','') || ' ' || coalesce(l.name->>'tr',''), query)

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
VALUES ('20260924_search_content_hide_unclaimed_pharmacies.sql', 'd81636e62f8583ca061bfd0b81774792260ea19cf2bb736243750c08fc126a14')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- No ADD COLUMN, so no PostgREST schema-cache reload is required: the cache holds
-- table/column shape, and a CREATE OR REPLACE of a function body changes neither.

-- ─── Verification (Role = postgres) ─────────────────────────────────────────
--   -- 1. the predicate is in the deployed body (this is the drift token's clause too):
--   SELECT pg_get_functiondef('public.search_content(text,double precision,double precision)'::regprocedure)
--          ILIKE '%provider_id%' AS hides_unclaimed_pharmacies;   -- expect true
--
--   -- 2. WATCH IT DROP THEM. Before this migration the first count is ~387; after, 0.
--   --    The second must be UNCHANGED — subscribers and state facilities keep searching.
--   SELECT count(*) AS unclaimed_pharmacies_returned
--     FROM public.search_content('eczane', NULL, NULL) WHERE module = 'medical';
--   -- expect 0
--   SELECT count(*) AS state_hospitals_still_found
--     FROM public.search_content('hastane', NULL, NULL) WHERE module = 'medical';
--   -- expect > 0  (the 6 public hospitals are sector='public', provider_id IS NULL,
--   --              and are NOT pharmacies — the predicate must not touch them)
--
--   -- 3. the other arms are untouched — this migration changed one line:
--   SELECT module, count(*) FROM public.search_content('a', NULL, NULL) GROUP BY 1 ORDER BY 1;
--
--   -- 4. the duty roster is a different table and is unaffected:
--   SELECT count(*) FROM public.duty_list WHERE duty_date = current_date;

-- ─── Rollback ───────────────────────────────────────────────────────────────
-- Re-apply the search_content definition from
-- supabase/migrations/20260912_search_tokenised_and_public_health_slice2.sql verbatim;
-- it is the previous body and differs only by the predicate added here.
-- ⚠ Roll the CLIENT back in the same change. Search returning pharmacies while the list
--   hides them is the asymmetry this slice removes; restoring one half re-creates it.
--   DELETE FROM public.schema_migrations_applied
--    WHERE filename = '20260924_search_content_hide_unclaimed_pharmacies.sql';

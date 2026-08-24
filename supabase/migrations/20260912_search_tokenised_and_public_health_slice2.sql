-- ─── Slice 2 — public-health reconciliation + tokenised, Turkish-folded search ─
--
-- TWO THINGS IN ONE MIGRATION, because they are entangled: filling `address` on the
-- hospitals (data) is what makes the search ranking bug acute (behaviour), and shipping
-- either half alone leaves a worse state than shipping neither. Evidence for every claim
-- below is in ~/ObsidianVault/10-ada/public-health-facilities.md §16, measured against the
-- real 387-row pharmacy corpus rather than a synthetic list.
--
--   1. tier gains 'not_applicable'          (§1)
--   2. reconcile the seven live state hospitals — city + Acil Durum's address   (§2)
--   3. three inserts: Thalassaemia, Radyasyon Onkoloji, Kronik Hastalıklar      (§3)
--   4. search_fold / search_all_tokens / search_token_hits + EXECUTE grants     (§4)
--   5. search_content: tokenised matching in ALL EIGHT arms + title-first order (§5)
--
-- ─── WHY 'not_applicable' AND NOT 'unknown' ─────────────────────────────────
-- They are not the same fact and must not share a value:
--   'unknown'        — Acil Durum. Nobody knows what tier it is. A RESEARCH TO-DO.
--                      count(*) WHERE tier='unknown' is a to-do counter that must
--                      trend to ZERO across Slices 3 and 4. Widening it destroys it.
--   'not_applicable' — Kronik Hastalıklar. The ministry says exactly what it does:
--                      "yaşlı, bakıma muhtaç ve kimsesiz kişilerin bakım ve
--                      tedavilerinin yapıldığı". A residential care institution is not
--                      on the acute-escalation ladder. Its tier is not unknown — it
--                      DOES NOT HAVE ONE. Nothing to find out.
-- Both are capped at exactly one row each, by name, in the DO blocks below. Two closed
-- lists, not thresholds: a third of EITHER fails loudly.
--
-- REJECTED en route, recorded so nobody re-derives it: an "Özel Dal Hastahaneleri →
-- secondary" rule. Post-hoc rationalisation — that same ministry grouping contains
-- Thalassaemia and Radyasyon Onkoloji, which are tertiary, so the grouping demonstrably
-- does not determine tier. Citing it only where it agreed is the reasoning this project
-- has a convention against.
--
-- ─── WHY SEARCH CHANGES AT ALL ──────────────────────────────────────────────
-- Hiding the Girne duplicate (0911 §6b) regressed the most likely query for that
-- hospital. search_content matched by SUBSTRING, so "Girne Devlet Hastanesi" no longer
-- matched anything: the eponym sits BETWEEN the words the user types —
-- "Girne Dr. Akçiçek Devlet Hastanesi" does not contain "Girne Devlet Hastanesi".
-- Measured: 0 results, was 1.
--
-- The same bug already cost us the biggest hospital in the country. "Lefkoşa Devlet
-- Hastanesi" — what people actually call BNDH — has ALWAYS returned zero, because
-- "Lefkoşa" appears nowhere in "Dr. Burhan Nalbantoğlu Devlet Hastanesi".
--
-- ─── THREE MEASURED FINDINGS THAT SHAPED THIS FILE ──────────────────────────
--
-- (1) TOKENISING ALONE PRODUCED A FALSE POSITIVE. "Lefkoşa Devlet Hastanesi" started
--     returning one row — YAZMAN ECZANESİ, a pharmacy whose address is "Devlet Hastanesi
--     Karşısı, Ortaköy, Lefkoşa". All three tokens, wrong building. Counted as "+1" it
--     is indistinguishable from the fix working. THIS IS WHY EVERY SEARCH ASSERTION IN
--     THE VERIFICATION FILE CHECKS *WHICH* ROW CAME BACK, BY ID. A count is not a result.
--
-- (2) HOSPITALS SORTED BELOW PHARMACIES, AND WOULD HAVE FOR WEEKS. ORDER BY was
--     distance-first NULLS LAST, and every public-health row has NULL coordinates until
--     the coordinate pass finishes. Measured, user in central Lefkoşa, query "Hastanesi":
--     a pharmacy 49 KM AWAY outranked every hospital in TRNC. Hence §5's title-first
--     ordering — written as a GENERAL rule (title relevance outranks distance), not a
--     health patch, so it stays correct on the day every coordinate is finally filled.
--
-- (3) TOKENISING WIDENS THE CLIENT/SERVER FOLD GAP — it does not leave it alone. The
--     client folds Turkish characters, the server did not. That gap was HIDDEN, because
--     multi-token queries failed on both sides. Tokenising makes the client good at them
--     while the server stays blocked by the first accented token: "magusa eczanesi" went
--     from 0/0 to 83 results in one box and 0 in the other. Same words, same app.
--     Hence §4's fold, in this same migration.
--
-- ─── WHY THE FOLD IS HERE AND NOT IN THE DEFERRED unaccent WORK ─────────────
-- That work was scoped as `unaccent` + a functional index — FOR PERFORMANCE. Correctness
-- needs neither: a plain translate() does it in one line, and the scan is unindexable
-- either way (leading wildcard), so nothing is lost by not having the index yet.
-- Verified against the client's normalize(): 0 disagreements on hand-picked queries,
-- 0 mismatches on a 400-word sweep of the real corpus.
--
-- RESIDUAL GAP, NAMED RATHER THAN DISCOVERED LATER: Postgres cannot NFD-strip
-- non-Turkish accents (é, á, ï, Greek) without `unaccent`; the client can. The fold list
-- covers the full Turkish set INCLUDING the circumflex letters Â Î Û (kâğıt, âlem) — that
-- addition came out of exactly this check and costs nothing. The live corpus today
-- contains ZERO non-Turkish non-ASCII characters, so the residual is currently
-- theoretical; it is not zero, and it errs toward the server MISSING a row rather than
-- returning a wrong one. `unaccent` + index stays queued for when PERFORMANCE is the reason.
--
-- Also unchanged and worth writing down: a query containing % or _ behaves oddly inside
-- LIKE. That is identical exposure to today's ILIKE '%'||query||'%' — same class, not
-- introduced here. Do not blame the tokeniser when somebody finds it.
--
-- EXECUTION: Role = postgres. Additive except §2 (writes seven live rows) and §3.

SET ROLE postgres;

BEGIN;

-- ─── 1. tier: add 'not_applicable' ──────────────────────────────────────────
-- Same-name DROP/ADD, so an existence check by name cannot tell the 4-value constraint
-- from the 5-value one. H-token in verify_schema, same as 'unknown' got.
ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_tier_check;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_tier_check
  CHECK (
    tier IS NULL
    OR tier = ANY (ARRAY['primary'::text, 'secondary'::text, 'tertiary'::text,
                         'unknown'::text, 'not_applicable'::text])
  );

-- ─── 2. Reconcile the seven live state hospitals ────────────────────────────
--
-- ⚠ WRITES LIVE ROWS. Keyed on id, as 0911 §6b was, for the same reason: name matching
-- is fragile against a trailing space or ı/i, and a silent zero-row UPDATE here would
-- report success while changing nothing.
--
-- `city` sources, one per row — every value below is a CITATION, and every one of them
-- will be independently re-tested by the coordinate pass (resolveRegion on the placed
-- pin, compared against this column). That is the agreed audit and it is why guessing
-- here would be worse than useless:
--   BNDH        ministry: Lefkoşa. Corroborated by OUR OWN pharmacy seed — YAZMAN
--               ECZANESİ's address is "Devlet Hastanesi Karşısı, Ortaköy, Lefkoşa".
--   Acil Durum  own site: "Barış Cd 8, 99010 Lefkoşa/KKTC".
--   Gazimağusa  ministry: "Gazimağusa bölgesinde bulunan".
--   Akçiçek     ministry: "Girne bölgesinde bulunan".
--   Girne dup   same hospital as Akçiçek.
--   Cengiz Topel ministry NAMES it "LEFKE Cengiz Topel Hastanesi"; its "Güzelyurt
--               bölgesinde" line is the CATCHMENT, not the location (module note §2a).
--   Barış       ministry page: in Ortaköy, "yanında" BNDH.
--
-- ⚠⚠ NO PHONE NUMBER IS WRITTEN BY THIS MIGRATION — NOT EVEN ACİL DURUM'S.
-- Every hospital phone is still pending the call-list (module note §14.2). Acil Durum's
-- (0392) 612 0500 comes from its own working site and looks solid, but SOP step 2 says
-- DIAL BEFORE ACTIVATION and that row is LIVE TO USERS TODAY — a wrong number on a live
-- hospital listing is worse than no number, because a user dials it in an emergency
-- instead of looking further. Barış's only known number, 228 5441, is the number a web
-- search attributes to BNDH: the ministry says Barış sits "yanında" BNDH, so it is almost
-- certainly a shared switchboard. Phones land in a follow-up once dialled.
--
-- `area` is NOT written either: only BNDH and Barış have a defensible one (ortakoy) and
-- the coordinate pass owns area resolution. "Barış Cd" is a street, not an area.
DO $$
DECLARE r record; n int;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('56614fa9-d7ba-4528-9fe4-f372e9f9286a'::uuid, 'Acil Durum Hastanesi',        'nicosia',   'Barış Cd 8, 99010 Lefkoşa'),
      ('3d108354-79cd-4a11-8173-e7c996d4bcd0'::uuid, 'Barış Ruh ve Sinir',          'nicosia',   NULL),
      ('e83f3d1d-c0c0-4e68-993c-03a8164286c1'::uuid, 'Dr. Burhan Nalbantoğlu',      'nicosia',   'Ortaköy, Lefkoşa'),
      ('ed83578f-1866-4e54-9253-705feb093c22'::uuid, 'Gazimağusa Devlet',           'famagusta', NULL),
      ('91338177-85d8-4f38-8b0f-2c395638d2d4'::uuid, 'Girne Devlet (DUPLICATE)',    'kyrenia',   NULL),
      ('7a1c598d-bc43-4b50-9f42-f94adffffe5d'::uuid, 'Girne Dr. Akçiçek',           'kyrenia',   NULL),
      ('32dafd70-73fb-4aec-afb2-6c940d07e9b9'::uuid, 'Lefke Cengiz Topel',          'lefke',     NULL)
    ) AS t(fid, label, city_slug, addr)
  LOOP
    SELECT count(*) INTO n FROM public.facilities WHERE id = r.fid;
    IF n <> 1 THEN
      RAISE EXCEPTION 'slice2 reconcile: expected exactly 1 facility with id % (%), found %', r.fid, r.label, n;
    END IF;
    -- COALESCE on address: never blank an address somebody has since filled by hand.
    -- The BNDH one is what makes "Lefkoşa Devlet Hastanesi" findable at all (§5).
    UPDATE public.facilities
       SET city    = r.city_slug,
           address = COALESCE(address, r.addr)
     WHERE id = r.fid;
  END LOOP;
  RAISE NOTICE 'slice2: 7 state hospitals reconciled (city + 2 addresses). NO phones written — call-list pending.';
END $$;

-- ─── 3. The three inserts ───────────────────────────────────────────────────
--
-- Fixed ids so re-running is a no-op AND so the verification file can assert by id
-- rather than by count — the discipline finding (1) forced.
--
-- TWO INDEPENDENT LOCKS on every new row: status='draft' AND hidden_at set.
-- `hidden_at IS NULL` is the FIRST term of the live public read policy, so this does not
-- need new schema — it reuses machinery that is already load-bearing. Draft invisibility
-- resting on `status` alone is a single point of failure across a coordinate pass that
-- runs for weeks. Un-hiding at go-live is then a deliberate TWO-step (clear hidden_at,
-- then flip status), which is the right shape: a single-column flip is how a
-- half-verified row goes live by accident.
--
-- hidden_reason is 'seed:pre-publication' and NOT left NULL on purpose: hidden_at on a
-- REPORTED listing means moderated. Here it means not-yet-published. Without this string
-- somebody reading the table in a year concludes the state hospitals were reported for abuse.
--
-- TIER RULE FOR THE TWO ATTACHED UNITS, stated so it does not read as a contradiction:
-- they are tertiary BECAUSE THEY ARE UNITS OF BNDH and are the services that MAKE BNDH
-- tertiary — not because they are sole providers. Barış is also "tek hastahane" and is
-- secondary; there is no inconsistency, because Barış is STANDALONE and the agreed rule
-- applies to it (sole-provider is a SPECIALTY fact, not a severity tier), while these two
-- are children of a tertiary parent and inherit from it. One rule for standalones, one
-- for attached units.
INSERT INTO public.facilities
  (id, name, type, sector, public_facility_type, tier, parent_facility_id,
   status, is_public, verified, hidden_at, hidden_reason, city)
VALUES
  -- "Thalassaemia Merkezi, Dr. Burhan Nalbantoğlu Devlet Hastahanesi'ne bağlı,
  --  12 yatak kapasiteli bir birimdir."
  ('a1b2c3d4-0001-4000-8000-000000000001', 'Thalassaemia Merkezi', 'hospital',
   'public', 'hospital', 'tertiary', 'e83f3d1d-c0c0-4e68-993c-03a8164286c1',
   'draft', false, false, now(), 'seed:pre-publication', 'nicosia'),
  -- "Radyasyon Onkoloji Merkezi, … BNDH'ne bağlı olarak çalışan, KKTC'nin TEK kanser
  --  tanı ve tedavi merkezi olup, 12 yatak kapasitelidir."  ← also the evidence that
  --  makes BNDH itself tertiary, despite the ministry's own "II. Basamak" wording.
  ('a1b2c3d4-0001-4000-8000-000000000002', 'Radyasyon Onkoloji Merkezi', 'hospital',
   'public', 'hospital', 'tertiary', 'e83f3d1d-c0c0-4e68-993c-03a8164286c1',
   'draft', false, false, now(), 'seed:pre-publication', 'nicosia'),
  -- "Kronik Hastalıklar Hastahanesi (Yaşlı Bakım Evi), yaşlı, bakıma muhtaç ve kimsesiz
  --  kişilerin bakım ve tedavilerinin yapıldığı, 32 yatak kapasiteli bir hastahanedir."
  -- NOT acute care. tier='not_applicable', and Slice 5's routing MUST exclude it: sending
  -- someone who is ill to a residential care home is the worst output this module could
  -- produce. It is listed because people genuinely search for it.
  ('a1b2c3d4-0001-4000-8000-000000000003', 'Kronik Hastalıklar Hastanesi', 'hospital',
   'public', 'hospital', 'not_applicable', NULL,
   'draft', false, false, now(), 'seed:pre-publication', 'nicosia')
ON CONFLICT (id) DO NOTHING;

-- ─── 3b. Both placeholder tiers stay one-offs ───────────────────────────────
-- No CHECK can express "at most one row", so this is the only thing that will notice.
-- Slices 3 and 4 reconcile ~27 more rows and both values are the easiest thing to type
-- for every one whose source is thin. If either RAISES, do not widen it — go and classify
-- whatever was added.
DO $$
DECLARE n int; bad text;
BEGIN
  SELECT count(*) INTO n FROM public.facilities WHERE tier = 'unknown';
  IF n <> 1 THEN
    RAISE EXCEPTION 'tier=''unknown'' must be EXACTLY 1 row (Acil Durum), found % — it is a research to-do counter, not a default', n;
  END IF;
  SELECT count(*) INTO n FROM public.facilities WHERE tier = 'not_applicable';
  IF n <> 1 THEN
    RAISE EXCEPTION 'tier=''not_applicable'' must be EXACTLY 1 row (Kronik Hastalıklar), found %', n;
  END IF;
  SELECT string_agg(id::text, ', ') INTO bad FROM public.facilities
   WHERE (tier = 'unknown'        AND id <> '56614fa9-d7ba-4528-9fe4-f372e9f9286a')
      OR (tier = 'not_applicable' AND id <> 'a1b2c3d4-0001-4000-8000-000000000003');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'placeholder tier is on the WRONG row(s): %', bad;
  END IF;
END $$;

-- ─── 4. Search helpers ──────────────────────────────────────────────────────
--
-- WHY NAMED FUNCTIONS AND NOT INLINE SQL REPEATED EIGHT TIMES. The inline form
--   NOT EXISTS (SELECT 1 FROM unnest(…) tok WHERE blob NOT ILIKE '%'||tok||'%')
-- works and creates no new object — WHICH IS EXACTLY THE PROBLEM. A predicate repeated
-- in eight arms is invisible to verify_schema.sql, so seven arms could be correct and one
-- silently reverted to substring matching with nothing to detect it. This project has
-- already been bitten twice by objects that exist live with no CREATE in the repo. A
-- named function is registerable in section C. One definition, one place to be right.
--
-- CREATION ORDER IS LOad-BEARING: LANGUAGE sql bodies are validated at CREATE time
-- (check_function_bodies), so search_fold must exist before the two that call it.

-- IMMUTABLE is honest here: pure translate() + lower(), no collation dependence, no
-- catalogue lookups. That matters — if the unaccent+index work ever lands, this is the
-- function that would go in the functional index, and it must be genuinely immutable.
--
-- The list is the full Turkish set INCLUDING Â Î Û. Those three came out of the
-- mixed-accent check and cost nothing: "kâğıt" and "âlem" are ordinary Turkish
-- orthography, the client's normalize() already strips them via NFD, and without them the
-- two sides disagree on real words.
CREATE OR REPLACE FUNCTION public.search_fold(t text) RETURNS text
  LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $function$
  SELECT lower(translate(coalesce(t, ''),
                         'İIıŞşĞğÇçÖöÜüÂâÎîÛû',
                         'IIiSsGgCcOoUuAaIiUu'))
$function$;

-- STABLE, not IMMUTABLE: pattern matching depends on collation. search_content is already
-- STABLE so nothing is lost, and claiming IMMUTABLE would be a false promise the moment
-- somebody tried to index on it.
--
-- coalesce(bool_and(...), true): an empty or whitespace-only query yields ZERO tokens,
-- bool_and over zero rows is NULL, and the coalesce turns that into true — reproducing
-- today's ILIKE '%%' = match-everything exactly. Behaviour preserved at the edge rather
-- than accidentally changed.
--
-- LIKE, not ILIKE: both sides are already lowered by search_fold, so ILIKE would do the
-- case work twice. The haystack is folded ONCE in the FROM, not once per token.
CREATE OR REPLACE FUNCTION public.search_all_tokens(haystack text, query text) RETURNS boolean
  LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT coalesce(bool_and(h.folded LIKE '%' || tok || '%'), true)
  FROM (SELECT public.search_fold(haystack) AS folded) h,
       unnest(regexp_split_to_array(btrim(public.search_fold(query)), '\s+')) AS tok
  WHERE tok <> ''
$function$;

-- Ranking input for §5: how many of the query's tokens appear in the TITLE alone.
-- This is what separates "Dr. Burhan Nalbantoğlu Devlet Hastanesi" (2 of 3 tokens in the
-- title) from "YAZMAN ECZANESİ" (0 of 3, all three in its address) on the query
-- "Lefkoşa Devlet Hastanesi".
CREATE OR REPLACE FUNCTION public.search_token_hits(haystack text, query text) RETURNS int
  LANGUAGE sql STABLE SET search_path TO 'public' AS $function$
  SELECT count(*)::int
  FROM (SELECT public.search_fold(haystack) AS folded) h,
       unnest(regexp_split_to_array(btrim(public.search_fold(query)), '\s+')) AS tok
  WHERE tok <> '' AND h.folded LIKE '%' || tok || '%'
$function$;

-- EXECUTE GRANTS ARE NOT OPTIONAL. search_content is SECURITY INVOKER, so when a
-- signed-out visitor calls it through PostgREST these inner calls are permission-checked
-- against `anon` as well. Without these grants the functions exist, the RPC exists, and
-- global search returns a permission error for every user — with nothing in the app to
-- say why. Registered in verify_schema section G, which exists because this has happened
-- before. anon AND authenticated: a tap can land before signInAnonymously resolves.
GRANT EXECUTE ON FUNCTION public.search_fold(text)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_all_tokens(text, text)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_token_hits(text, text)  TO anon, authenticated;

-- ─── 5. search_content — tokenised, folded, title-ranked ────────────────────
--
-- Base body taken VERBATIM from 20260911, which took it verbatim from 20260906. This is
-- the THIRD rewrite of this function; each time, the risk is silently dropping an arm
-- somebody else added. The H-tokens asserting the towing arm and name_official survive
-- are the alarms for exactly that, and a third now asserts search_all_tokens is present.
--
-- SAME COLUMNS, DIFFERENT MATCHER. Every arm searches exactly the columns it searched
-- before — this changes HOW matching works, never WHAT is searched. Otherwise recall
-- shifts for two unrelated reasons at once and neither can be audited afterwards.
--
-- THE ORDER BY IS AN EXPRESSION OVER AN OUTPUT COLUMN, AND THAT IS ONLY LEGAL BECAUSE
-- THE UNION IS WRAPPED in `SELECT * FROM ( … ) combined`. Across a BARE union, ORDER BY
-- accepts only an output column name or position, never an expression. The existing
-- CASE WHEN lat IS NOT NULL … term already relies on this. Do not "simplify" the wrapper.
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
VALUES ('20260912_search_tokenised_and_public_health_slice2.sql', 'a6b35cfa9a7197be00f386a6a80cdc95aed1e66567d9a92db33900c71e88fdf0')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

-- No ADD COLUMN in this migration, so no schema-cache reload is strictly required —
-- but three new functions and a replaced RPC are, and PostgREST resolves RPCs by name at
-- call time. Kept explicit so the omission reads as deliberate rather than forgotten.
NOTIFY pgrst, 'reload schema';

-- ─── Verification ───────────────────────────────────────────────────────────
-- supabase/verify_search_tokenised.sql. EVERY search assertion there is keyed on the ID
-- of the row that must come back, never on a count — because a count is what made the
-- Lefkoşa false positive look like a pass.

-- ─── Rollback ───────────────────────────────────────────────────────────────
--   SET ROLE postgres; BEGIN;
--   -- 1. restore the previous search_content by re-applying 20260911 section 9.
--   -- 2. DROP FUNCTION IF EXISTS public.search_token_hits(text,text);
--   --    DROP FUNCTION IF EXISTS public.search_all_tokens(text,text);
--   --    DROP FUNCTION IF EXISTS public.search_fold(text);
--   -- 3. DELETE FROM public.facilities WHERE id IN
--   --      ('a1b2c3d4-0001-4000-8000-000000000001','a1b2c3d4-0001-4000-8000-000000000002',
--   --       'a1b2c3d4-0001-4000-8000-000000000003');
--   -- 4. narrow facilities_tier_check back to 4 values (FAILS while the Kronik row
--   --    exists — run step 3 first; that ordering is the point).
--   -- NB: §2's city/address writes are NOT undone. They are correct data; reverting the
--   --     search change is no reason to un-know where the hospitals are.
--   COMMIT; RESET ROLE;

-- ═══ Grandfathered names — re-scan every display_name against the CURRENT filter ═══
--
--   SQL editor, Role = postgres, the whole file. READ-ONLY: no INSERT, UPDATE, DELETE
--   or DDL anywhere in it. Safe to run on production at any time.
--
-- ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
--
-- check_profile_name_content() (20261001) runs contains_blocked_term() ONLY when the name
-- CHANGES. A name written before a term entered blocked_terms is grandfathered and stays,
-- and nothing in the app or in any other check ever looks at it again.
--
-- That cost nothing while no surface showed one user's name to another. Slice 4's student
-- list is that surface: from go-live, a grandfathered name renders to every opted-in
-- student at the same university. The curated 9-language import takes blocked_terms from
-- 54 rows to roughly 510 — five hundred new terms landing on a population of names that
-- nobody will re-check unless something like this is run.
--
-- ─── WHEN TO RUN IT ─────────────────────────────────────────────────────────
--
--   • BEFORE the Student Hub goes live (module go-live SOP step 2, while the data is
--     still invisible — the last moment a problem is free).
--   • AFTER EVERY blocked_terms import or edit. A new term is retroactive for new
--     writes only; this is the only thing that applies it to what is already stored.
--
-- Not in pre-push and not on a cron. It answers a CONTENT question, like
-- check-duty-staleness.mjs and check-institution-links.mjs, and a push must never be
-- blocked because somebody added a word to a table.
--
-- ─── WHY THIS IS SQL AND NOT A NODE SCRIPT LIKE THE OTHER CONTENT CHECKS ────
--
-- Because no client can see the names. profiles returns exactly ONE row to a signed-in
-- customer — their own — which is the entire premise of slice 4's design, measured again
-- on 2026-09-16 (1 row, against a positive control of 394 facilities through the same
-- path). A Node version would therefore report "0 names to check" on a database full of
-- them: a probe pinned to one answer whether or not the thing under test is healthy.
--
-- The two ways to give a client that view are both worse than this file:
--   • the service_role key in the repo — forbidden outright, and for a good reason;
--   • a SECURITY DEFINER function that dumps display names — a NEW dumpable list of every
--     name in the app, built to protect against names. That is the trade the wrong way
--     round, and 20261002 already refused the same bargain for availability checks.
--
-- ─── READ THE CONTROLS BEFORE YOU READ THE RESULT ───────────────────────────
--
-- QUERY 1 exists because a matcher that returns false for everything and a database with
-- no bad names print exactly the same thing: nothing. Both controls must say PASS before
-- an empty QUERY 2 means anything at all.

-- ─── QUERY 1. Is the instrument alive? ──────────────────────────────────────
-- The positive control is DERIVED from blocked_terms rather than typed here: no slur
-- belongs in this repo, and a hardcoded probe term would also stop being a control the
-- day someone removes that term from the table.
WITH sample AS (
  SELECT term FROM public.blocked_terms ORDER BY term LIMIT 1
)
SELECT
  (SELECT count(*) FROM public.blocked_terms)                          AS terms_loaded,
  (SELECT count(*) FROM public.profiles WHERE display_name IS NOT NULL) AS names_to_scan,
  (SELECT term FROM sample)                                            AS control_term,
  CASE
    WHEN (SELECT count(*) FROM public.blocked_terms) = 0
      THEN 'FAIL — blocked_terms is EMPTY. Every scan below would print nothing. Stop here.'
    WHEN (SELECT count(*) FROM public.profiles WHERE display_name IS NOT NULL) = 0
      THEN 'FAIL — no display names in the database at all. Nothing was scanned.'
    WHEN NOT public.contains_blocked_term((SELECT term FROM sample))
      THEN 'FAIL — a term taken FROM blocked_terms does not match itself. The matcher is broken; an empty result below means nothing.'
    WHEN public.contains_blocked_term('zzbenignprobename')
      THEN 'FAIL — a benign string MATCHES. The matcher is returning true for everything.'
    ELSE 'PASS — matcher answers both ways; the scan below is meaningful.'
  END AS instrument;

-- ─── QUERY 2. The names that would be grandfathered through ─────────────────
-- display_name FIRST, because it is the one that renders to other users (slice 4's
-- get_student_list returns it; nothing returns full_name).
--
-- The user id is printed, never emailed or joined to anything else: acting on a hit means
-- opening that profile in the admin screen, and the two remedies are
--   (a) clear display_name — the wizard's resume logic treats a NULL display_name as
--       "step 1 not done", so the user is asked for a new one, and get_student_list
--       filters display_name IS NOT NULL, so they leave every list until they pick one;
--   (b) set ugc_banned_until — which delists them AND removes their access to lists,
--       and unlike clearing the opt-in it is not something they can switch back on.
SELECT
  'display_name' AS field,
  p.id           AS user_id,
  p.display_name AS value,
  p.student_listing_opt_in AS currently_listed
FROM public.profiles p
WHERE p.display_name IS NOT NULL
  AND public.contains_blocked_term(p.display_name)
UNION ALL
-- full_name is checked by the same trigger and grandfathered the same way. It reaches NO
-- other user today — not through get_student_list, not through any screen — so a hit here
-- is lower priority than one above, and it is listed so the distinction is visible rather
-- than assumed.
SELECT
  'full_name',
  p.id,
  p.full_name,
  p.student_listing_opt_in
FROM public.profiles p
WHERE p.full_name IS NOT NULL
  AND public.contains_blocked_term(p.full_name)
ORDER BY 1, 3;

-- ─── QUERY 3. Reserved names, the same question for the other list ──────────
-- is_reserved_display_name() is enforced at write time too, and reserved_names grows by
-- hand exactly like blocked_terms. A name reserved after someone took it keeps it.
SELECT
  p.id                     AS user_id,
  p.display_name           AS value,
  p.student_listing_opt_in AS currently_listed
FROM public.profiles p
WHERE p.display_name IS NOT NULL
  AND public.is_reserved_display_name(public.normalize_display_name(p.display_name))
ORDER BY p.display_name;

-- ─── Expected output ────────────────────────────────────────────────────────
--   QUERY 1  one row, instrument = 'PASS — …', names_to_scan > 0.
--   QUERY 2  ZERO rows on a healthy database. Any row is a name to act on.
--   QUERY 3  ZERO rows. A row here is a reserved name somebody is still holding.
--
-- An empty QUERY 2 with QUERY 1 reading FAIL is not a clean result — it is no result.

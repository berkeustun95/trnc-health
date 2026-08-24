-- ─── Verification — 20260912_search_tokenised_and_public_health_slice2.sql ────
--
-- Run AFTER applying the migration. SQL editor, Role selector = postgres.
--
-- ▶ HOW TO RUN: the SQL editor shows only the LAST result set, so run the blocks
--   ONE AT A TIME — from a `═══ BLOCK Wn ═══` banner down to the next banner.
--
-- NOTHING IS PERSISTED. Every block is BEGIN … ROLLBACK, fixtures included.
--
-- ─── ⚠ THE RULE THIS FILE IS BUILT ON: A COUNT IS NOT A RESULT ──────────────
--
-- EVERY SEARCH ASSERTION BELOW CHECKS **WHICH ROW** CAME BACK, BY ID. None checks how
-- many. That is not fastidiousness — it is a direct consequence of a near-miss during
-- the design of this migration:
--
--   "Lefkoşa Devlet Hastanesi" was proposed as the success test for tokenised search.
--   With tokenising on, it returned 1 row and the check would have passed. The row was
--   YAZMAN ECZANESİ — a PHARMACY, across the road from the hospital, whose address is
--   "Devlet Hastanesi Karşısı, Ortaköy, Lefkoşa" and therefore carries all three tokens.
--   Counted, that reads +1 and looks exactly like the fix working. It was the wrong row.
--
-- `>= 1` is the shape of a check that passes for the wrong reason. Do not reintroduce it
-- here, and be suspicious of it anywhere else in this repo.
--
-- ⚠ NO BLOCK IN THIS FILE IS EXPECTED TO ERROR. Every block expects 'OK' rows.
-- That is worth stating because you will very likely run this in the same sitting as
-- verify_facilities_public_health.sql, where SIX blocks are expected to error and the
-- error IS the pass. Different file, opposite contract. Here, an error is an error.
--
-- (An earlier draft of this header claimed two blocks were expected to error. Neither
-- was. That is the same mislabel this project already wrote a paragraph about in the
-- other file — it survives being written about, which is why the rule is: check the
-- header against the block headers every time either is edited.)
--
-- BLOCK W8 CANNOT BE DONE IN SQL. Everything above proves the database is right; none of
-- it proves the two search boxes now agree on screen. Do W8.


-- ═══ BLOCK W1 / 8 — OBJECTS, GRANTS, CONSTRAINT — run alone ════════════════
-- Expect: EVERY row 'OK'. Anything else floats to the top.
BEGIN;
WITH report AS (
SELECT 'function' AS kind, e.o AS object,
       CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname=e.o) THEN 'OK' ELSE 'MISSING' END AS status
FROM (VALUES ('search_fold'),('search_all_tokens'),('search_token_hits')) e(o)
UNION ALL
-- THE GRANTS ARE NOT A FORMALITY. search_content is SECURITY INVOKER, so a signed-out
-- visitor's call is permission-checked against these three as well. Miss one and global
-- search raises a permission error for EVERY user, with nothing in the app to say why.
SELECT 'grant-anon', e.o,
       CASE WHEN has_function_privilege('anon', e.o, 'EXECUTE') THEN 'OK'
            ELSE 'FAIL ← signed-out search is broken app-wide' END
FROM (VALUES ('public.search_fold(text)'),('public.search_all_tokens(text,text)'),
             ('public.search_token_hits(text,text)')) e(o)
UNION ALL
SELECT 'grant-authenticated', e.o,
       CASE WHEN has_function_privilege('authenticated', e.o, 'EXECUTE') THEN 'OK'
            ELSE 'FAIL ← signed-in search is broken app-wide' END
FROM (VALUES ('public.search_fold(text)'),('public.search_all_tokens(text,text)'),
             ('public.search_token_hits(text,text)')) e(o)
UNION ALL
SELECT 'behaviour', 'tier CHECK allows not_applicable',
       CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname='facilities_tier_check'
              AND pg_get_constraintdef(oid) ILIKE '%not_applicable%')
            THEN 'OK' ELSE 'FAIL ← the Kronik insert cannot have run' END
UNION ALL
SELECT 'behaviour', 'search_content tokenises (not substring)',
       CASE WHEN (SELECT pg_get_functiondef('public.search_content(text,double precision,double precision)'::regprocedure)
                    ILIKE '%search_all_tokens%')
            THEN 'OK' ELSE 'FAIL ← reverted to substring; the Girne/Lefkoşa queries are dead again' END
UNION ALL
SELECT 'behaviour', 'search_content ranks title above distance',
       CASE WHEN (SELECT pg_get_functiondef('public.search_content(text,double precision,double precision)'::regprocedure)
                    ILIKE '%search_token_hits(title, query) DESC%')
            THEN 'OK' ELSE 'FAIL ← a pharmacy 49 km away outranks every hospital again' END
UNION ALL
-- This is the THIRD rewrite of search_content. Each time, the risk is silently dropping
-- an arm someone else added. These two are the alarms.
SELECT 'survived-rewrite', 'towing arm',
       CASE WHEN (SELECT pg_get_functiondef('public.search_content(text,double precision,double precision)'::regprocedure)
                    ILIKE '%towing_companies%') THEN 'OK' ELSE 'FAIL ← towing arm clobbered' END
UNION ALL
SELECT 'survived-rewrite', 'name_official in the facilities arm',
       CASE WHEN (SELECT pg_get_functiondef('public.search_content(text,double precision,double precision)'::regprocedure)
                    ILIKE '%name_official%') THEN 'OK' ELSE 'FAIL ← eponym search clobbered' END
UNION ALL
SELECT 'arm-count', 'all 8 arms still tokenised',
       CASE WHEN (SELECT (length(pg_get_functiondef('public.search_content(text,double precision,double precision)'::regprocedure))
                          - length(replace(pg_get_functiondef('public.search_content(text,double precision,double precision)'::regprocedure),
                                           'search_all_tokens(', ''))) / length('search_all_tokens(')) = 8
            THEN 'OK' ELSE 'FAIL ← an arm was left on substring matching' END
)
SELECT * FROM report ORDER BY (status = 'OK'), kind, object;
ROLLBACK;


-- ═══ BLOCK W2 / 8 — THE FOLD IS EXACT — run alone ══════════════════════════
-- Expect: every row 'OK'.
--
-- Asserted on VALUES, not on a description of the behaviour. The client's normalize()
-- was run over 400 real corpus words and agreed with this function on every one; these
-- rows are the cases that would break first if the character list is ever edited.
--
-- Â Î Û ARE IN THE LIST DELIBERATELY. "kâğıt" and "âlem" are ordinary Turkish spelling,
-- the client strips them via NFD, and without them the two sides disagree on real words.
-- They were added only because the mixed-accent check was actually run.
BEGIN;
SELECT e.label,
       CASE WHEN public.search_fold(e.input) = e.expected THEN 'OK'
            ELSE 'FAIL ← got "'||public.search_fold(e.input)||'", expected "'||e.expected||'"' END AS status
FROM (VALUES
  ('dotted/dotless I',   'İzmir ILGIN ılık',  'izmir ilgin ilik'),
  ('ş ğ ç ö ü',          'Şeker Ğ Çay Öz Ün', 'seker g cay oz un'),
  ('circumflex (Â Î Û)', 'Kâğıt Îhsan Ûlker', 'kagit ihsan ulker'),
  ('already ASCII',      'Devlet Hastanesi',  'devlet hastanesi'),
  ('empty string',       '',                  ''),
  -- German ü/ö fold too — they are in the Turkish set, so "Müller" works by luck, and
  -- that luck is worth knowing about rather than relying on.
  ('German umlaut',      'Müller Schön',      'muller schon'),
  -- EVERY MAPPED CHARACTER, IN ORDER. translate() takes a FROM string and a TO string and
  -- pairs them positionally — if the two are ever edited to different lengths, it does not
  -- error, it SILENTLY DELETES the unpaired characters. This row is the only thing that
  -- would notice: it fails loudly the moment the two lists fall out of step.
  ('full mapped alphabet', 'İIıŞşĞğÇçÖöÜüÂâÎîÛû', 'iiissggccoouuaaiiuu')
) e(label, input, expected)
ORDER BY (public.search_fold(e.input) = e.expected), e.label;
-- NULL in, empty out — search_all_tokens concatenates coalesced columns, but a caller
-- passing NULL directly must not blow up the whole search.
SELECT CASE WHEN public.search_fold(NULL) = '' THEN 'OK' ELSE 'FAIL ← NULL is not handled' END AS null_safe;
ROLLBACK;


-- ═══ BLOCK W3 / 8 — THE TOKENISER'S EDGES — run alone ══════════════════════
-- Expect: every row 'OK'.
--
-- The empty-query row is the important one. Today's behaviour was ILIKE '%%', which
-- matches everything; bool_and over ZERO tokens is NULL, and the coalesce turns that back
-- into true. If somebody "simplifies" the coalesce away, an empty query silently returns
-- NOTHING and the global search box looks broken the moment it is focused.
BEGIN;
SELECT e.label,
       CASE WHEN public.search_all_tokens(e.hay, e.q) = e.expected THEN 'OK'
            ELSE 'FAIL ← got '||public.search_all_tokens(e.hay, e.q)::text END AS status
FROM (VALUES
  ('all tokens present, out of order', 'Girne Dr. Akçiçek Devlet Hastanesi', 'hastanesi girne', true),
  ('eponym between the words',         'Girne Dr. Akçiçek Devlet Hastanesi', 'Girne Devlet Hastanesi', true),
  ('one token missing',                'Girne Dr. Akçiçek Devlet Hastanesi', 'Girne Eczanesi', false),
  ('single token, unchanged behaviour','Girne Dr. Akçiçek Devlet Hastanesi', 'devlet', true),
  ('folded query vs unfolded haystack','Gazimağusa Devlet Hastanesi',        'magusa devlet', true),
  ('EMPTY query matches everything',   'anything at all',                     '', true),
  ('whitespace-only matches everything','anything at all',                    '   ', true),
  ('extra internal whitespace',        'Girne Dr. Akçiçek Devlet Hastanesi', 'girne    devlet', true),
  ('NULL haystack, real query',        NULL,                                  'girne', false)
) e(label, hay, q, expected)
ORDER BY (public.search_all_tokens(e.hay, e.q) = e.expected), e.label;
ROLLBACK;


-- ═══ BLOCK W4 / 8 — THE REGRESSION IS FIXED, AND BY THE RIGHT ROW ══════════
-- Expect: all four columns 'OK'.
--
-- THIS IS THE BLOCK THE "COUNT IS NOT A RESULT" RULE EXISTS FOR. Each assertion names
-- the id that must come back. `girne_finds_akcicek` was returning ZERO rows before this
-- migration — that was the regression introduced by hiding the duplicate.
--
-- ⚠ HEADER CORRECTED AFTER THE FIRST RUN. It previously claimed `lefkosa_ranks_bndh_first`
-- passes because §2 of this migration wrote BNDH's address. IT DOES NOT. BNDH already had
-- `address='Lefkoşa'`, hand-entered, and §2's `COALESCE(address, …)` therefore left it
-- alone — correctly, but meaning the three-way interaction this header described never
-- happened. What the check actually proves is tokeniser + ranking over a PRE-EXISTING
-- address value. That is still worth proving; it is simply not what was written down.
-- Recorded rather than quietly edited, because a passing test whose stated reason is
-- wrong is the same failure class as a count that passes for the wrong row.
BEGIN;
SELECT
  CASE WHEN EXISTS (SELECT 1 FROM public.search_content('Girne Devlet Hastanesi')
                    WHERE id = '7a1c598d-bc43-4b50-9f42-f94adffffe5d')
       THEN 'OK' ELSE 'FAIL ← the query people actually type still misses Dr. Akçiçek' END AS girne_finds_akcicek,
  -- The hidden duplicate must NOT come back. It is draft; if it appears, the status gate
  -- broke and two Girne hospitals render again.
  CASE WHEN NOT EXISTS (SELECT 1 FROM public.search_content('Girne Devlet Hastanesi')
                        WHERE id = '91338177-85d8-4f38-8b0f-2c395638d2d4')
       THEN 'OK' ELSE 'FAIL ← the draft duplicate is searchable' END AS duplicate_still_hidden,
  -- FIRST, not merely present. YAZMAN ECZANESİ also matches all three tokens (its address
  -- is "Devlet Hastanesi Karşısı, Ortaköy, Lefkoşa"); the whole point of title-ranking is
  -- that the hospital beats it.
  CASE WHEN (SELECT id FROM public.search_content('Lefkoşa Devlet Hastanesi') LIMIT 1)
            = 'e83f3d1d-c0c0-4e68-993c-03a8164286c1'
       THEN 'OK' ELSE 'FAIL ← first hit is '
            ||coalesce((SELECT title FROM public.search_content('Lefkoşa Devlet Hastanesi') LIMIT 1),'(nothing)')
            ||' — a pharmacy is outranking the hospital' END AS lefkosa_ranks_bndh_first,
  -- Word order must not matter.
  CASE WHEN (SELECT id FROM public.search_content('Devlet Hastanesi Lefkoşa') LIMIT 1)
            = 'e83f3d1d-c0c0-4e68-993c-03a8164286c1'
       THEN 'OK' ELSE 'FAIL ← word order still changes the answer' END AS word_order_irrelevant;
ROLLBACK;


-- ═══ BLOCK W4b — THE FOLD REACHES THE SERVER — run alone ═══════════════════
-- Expect: both 'OK'.
--
-- Before this migration the client folded Turkish characters and the server did not, so
-- the same words gave different answers in the two search boxes. Tokenising WIDENED that
-- gap rather than leaving it alone — "magusa eczanesi" went from 0 results in both to 83
-- in one box and 0 in the other. This asserts the server side now folds, using a fixture
-- whose name only matches once folded.
BEGIN;
INSERT INTO public.facilities (id, name, type, sector, status, is_public)
VALUES ('ffffffff-0000-0000-0000-000000000001','Ozanköy Şifa Eczanesi','pharmacy','private','active',true);
SELECT
  CASE WHEN EXISTS (SELECT 1 FROM public.search_content('ozankoy')
                    WHERE id = 'ffffffff-0000-0000-0000-000000000001')
       THEN 'OK' ELSE 'FAIL ← server does not fold; two search boxes disagree' END AS fold_single_token,
  CASE WHEN EXISTS (SELECT 1 FROM public.search_content('ozankoy sifa')
                    WHERE id = 'ffffffff-0000-0000-0000-000000000001')
       THEN 'OK' ELSE 'FAIL ← fold + tokenise do not compose' END AS fold_multi_token;
ROLLBACK;


-- ═══ BLOCK W5 / 8 — RECALL DID NOT BLOW UP — run alone ═════════════════════
-- Expect: all four 'OK'.
--
-- The concern with tokenising is that a common word starts returning half the directory.
-- It cannot: A SINGLE-TOKEN QUERY IS ONE PATTERN TEST, exactly as before.
--
-- ASSERTED ON FIXTURES, NOT ON LIVE COUNTS — deliberately. An earlier draft compared
-- `count(*) WHERE module='medical'` against a substring scan of the same columns. That
-- looks rigorous and is flaky: search_content LIMITs to 40 ACROSS ALL MODULES, so a
-- single unrelated row (an event whose title happens to contain the word) can displace a
-- medical row out of the 40 and break the check for reasons that have nothing to do with
-- tokenising. A check that cries wolf on unrelated data changes teaches you to ignore it.
BEGIN;
INSERT INTO public.facilities (id, name, type, sector, status, is_public) VALUES
  ('ffffffff-0000-0000-0000-00000000000a','Zzyzx Kavşak Eczanesi','pharmacy','private','active',true),
  ('ffffffff-0000-0000-0000-00000000000b','Zzyzx Liman Eczanesi', 'pharmacy','private','active',true);
SELECT
  -- Single token → both fixtures. Unchanged from substring behaviour by construction.
  CASE WHEN (SELECT count(*) FROM public.search_content('Zzyzx')
              WHERE id IN ('ffffffff-0000-0000-0000-00000000000a','ffffffff-0000-0000-0000-00000000000b')) = 2
       THEN 'OK' ELSE 'FAIL ← single-token recall changed' END AS single_token_unchanged,
  -- Two tokens → narrows to exactly one, BY ID. This is the discriminating case: it is
  -- what tells "the tokeniser ANDs" apart from "the tokeniser ORs", which a count of
  -- matches on a broad query cannot.
  CASE WHEN (SELECT count(*) FROM public.search_content('Zzyzx Liman')) = 1
        AND EXISTS (SELECT 1 FROM public.search_content('Zzyzx Liman')
                    WHERE id = 'ffffffff-0000-0000-0000-00000000000b')
       THEN 'OK' ELSE 'FAIL ← tokens are being OR''d, not AND''d — recall would explode' END AS tokens_are_anded,
  -- A token that appears nowhere must veto the whole match, even though the other token
  -- matches both rows.
  CASE WHEN NOT EXISTS (SELECT 1 FROM public.search_content('Zzyzx Bakkal'))
       THEN 'OK' ELSE 'FAIL ← an absent token does not veto' END AS absent_token_vetoes,
  -- And search returns something at all. A missing EXECUTE grant or a broken fold shows
  -- up here as a flat zero rather than as a subtle difference.
  CASE WHEN (SELECT count(*) FROM public.search_content('Eczanesi')) > 0
       THEN 'OK' ELSE 'FAIL ← search returns nothing; check the EXECUTE grants (W1)' END AS search_alive;
ROLLBACK;


-- ═══ BLOCK W6 / 8 — SLICE 2 DATA, BY ID — run alone ════════════════════════
-- Expect: every row 'OK' on city; the phone/address columns are REPORTED, not asserted.
--
-- ⚠ THIS BLOCK WAS REWRITTEN AFTER IT FAILED, AND THE FAILURE WAS THE POINT.
-- It asserted `phone IS NULL` on all seven, on the belief that no hospital had a phone.
-- ALL SEVEN ALREADY HAD phone AND address — hand-entered through AdminScreen, same
-- origin as the rows themselves. The assertion did not anticipate data it had not written.
--
-- ROOT CAUSE, WORTH MORE THAN THE FIX: BLOCK V0 — the live pre-flight whose entire job is
-- "tell me what is actually there" — selected `id, name, type, city, provider_id`. It did
-- not select phone or address. THE COLUMNS ASSUMED EMPTY WERE THE COLUMNS NOT LOOKED AT.
-- A pre-flight that only asks about the columns you already have questions about is a
-- pre-flight that confirms your assumptions. Select * next time, or name every column the
-- migration touches.
--
-- The two placeholder tiers and the parenting are still ASSERTED — those this migration
-- did write.
BEGIN;
-- REPORT (not assert): read the seven and look at them. Phone verification is a telephone
-- job, not a SQL one — see the call-list in module note §14.2, which is now a
-- VERIFY-WHAT-IS-PUBLISHED list, not a fill-the-blanks list.
SELECT f.id, f.name, f.city, f.address, f.phone,
       CASE WHEN f.city IS NOT DISTINCT FROM e.city THEN 'city OK'
            ELSE 'city FAIL ← got '||coalesce(f.city,'∅')||', expected '||e.city END AS city_check
FROM (VALUES
  ('56614fa9-d7ba-4528-9fe4-f372e9f9286a'::uuid, 'nicosia'),
  ('3d108354-79cd-4a11-8173-e7c996d4bcd0'::uuid, 'nicosia'),
  ('e83f3d1d-c0c0-4e68-993c-03a8164286c1'::uuid, 'nicosia'),
  ('ed83578f-1866-4e54-9253-705feb093c22'::uuid, 'famagusta'),
  ('91338177-85d8-4f38-8b0f-2c395638d2d4'::uuid, 'kyrenia'),
  ('7a1c598d-bc43-4b50-9f42-f94adffffe5d'::uuid, 'kyrenia'),
  ('32dafd70-73fb-4aec-afb2-6c940d07e9b9'::uuid, 'lefke')
) e(fid, city)
JOIN public.facilities f ON f.id = e.fid
ORDER BY (f.city IS NOT DISTINCT FROM e.city), f.name;

-- ⚠ THE LIVE DEFECT THIS SLICE UNCOVERED. Two DIFFERENT hospitals published the SAME
-- phone number to users. One of them was wrong and nothing in the data said which.
-- 20260913 removed Acil Durum's (its own first-party site contradicted the stored value).
--
-- ⚠⚠ THIS CHECK NOW COMPARES NUMBERS, NOT STRINGS. The first version compared `phone`
-- text directly and read OK on this pair:
--       Girne Akçiçek     (0392) 815 22 66
--       Girne DUPLICATE   +90 392 815 2266
-- Same number, two formats, check green. Harmless there — one hospital in two rows — but
-- the check did not do what its name said, and SLICE 3 SEEDS 21 MORE ROWS hand-entered at
-- different times. Two genuinely different facilities formatted differently would have
-- sailed through.
--
-- Normalisation: strip everything but digits, then take the LAST TEN. That collapses
-- `+90 392 …`, `0392 …` and a bare `392 …` onto one value without needing to know which
-- prefix form was used, and it leaves anything shorter than ten digits (an internal
-- extension like 1101) untouched rather than mangling it.
--
-- ⚠ SCOPED TO ROWS A USER CAN ACTUALLY REACH — `status <> 'draft' AND hidden_at IS NULL`.
-- Not a carve-out to make it green: the defect is "two things a user can call show the
-- same number", and a hidden row is not one of them. Without this scope the check goes RED
-- on the Girne pair, which is a DELIBERATE state — one hospital, two rows, the duplicate
-- hidden pending its merge slice. A check that fires on a known, intended condition is a
-- check that gets ignored.
--
-- ⚠ AND THIS IS DELIBERATELY NOT A DATABASE CONSTRAINT. Two facilities sharing a
-- switchboard is legitimate — hospitals in one complex genuinely do (that is exactly why
-- the Barış/BNDH shared-line theory was plausible, even though it turned out wrong). A
-- UNIQUE index would forbid a real-world arrangement. This flags for a human to look;
-- it does not forbid.
SELECT
  CASE WHEN (SELECT count(DISTINCT CASE WHEN length(regexp_replace(phone,'\D','','g')) >= 10
                                        THEN right(regexp_replace(phone,'\D','','g'), 10)
                                        ELSE regexp_replace(phone,'\D','','g') END)
               FROM public.facilities
              WHERE sector='public' AND phone IS NOT NULL
                AND status <> 'draft' AND hidden_at IS NULL)
            = (SELECT count(*) FROM public.facilities
                WHERE sector='public' AND phone IS NOT NULL
                  AND status <> 'draft' AND hidden_at IS NULL)
       THEN 'OK'
       ELSE 'FAIL ← two user-visible state facilities share a phone NUMBER (ignoring format): '
            ||(SELECT string_agg(DISTINCT f2.name, ' / ') FROM public.facilities f2
                WHERE f2.sector='public' AND f2.phone IS NOT NULL
                  AND f2.status <> 'draft' AND f2.hidden_at IS NULL
                  AND (SELECT count(*) FROM public.facilities f3
                        WHERE f3.sector='public' AND f3.phone IS NOT NULL
                          AND f3.status <> 'draft' AND f3.hidden_at IS NULL
                          AND right(regexp_replace(f3.phone,'\D','','g'),10)
                              = right(regexp_replace(f2.phone,'\D','','g'),10)) > 1) END
       AS no_duplicate_phones,
  -- ⚠ READ THIS BEFORE TRUSTING THE COLUMN ABOVE. After 20260913 removed Acil Durum's
  -- number, the collision is gone and `no_duplicate_phones` goes GREEN — which OVERSTATES
  -- what happened. RESOLVING A COLLISION IS NOT VERIFYING A NUMBER. Every remaining
  -- hospital phone is still UNVERIFIED; they are merely no longer provably colliding.
  -- This second column is the honest one: it stays OK only while the hold is in place,
  -- and must be updated deliberately when the dial confirms a number.
  CASE WHEN (SELECT phone FROM public.facilities
              WHERE id = '56614fa9-d7ba-4528-9fe4-f372e9f9286a') IS NULL
       THEN 'OK — held pending dial (own site says (0392) 612 0500)'
       ELSE 'REVIEW ← Acil Durum has a phone again. Correct ONLY if it was dialled: '
            ||(SELECT phone FROM public.facilities WHERE id='56614fa9-d7ba-4528-9fe4-f372e9f9286a') END
       AS acil_durum_phone_held,
  -- No public row may carry a bare city name as its address (20260913 §1).
  CASE WHEN (SELECT count(*) FROM public.facilities
              WHERE sector='public'
                AND address IN ('Lefkoşa','Gazimağusa','Girne','Lefke','Güzelyurt','İskele')) = 0
       THEN 'OK' ELSE 'FAIL ← a bare city name is back in an address column' END AS no_bare_city_addresses,
  -- The harvested street address must be on the CANONICAL row, not only on the duplicate
  -- that is scheduled for retirement.
  CASE WHEN (SELECT address FROM public.facilities
              WHERE id='7a1c598d-bc43-4b50-9f42-f94adffffe5d') = 'Dr. Fazıl Küçük Blv., Girne'
       THEN 'OK' ELSE 'FAIL ← the only real street address is still only on the retiring row' END AS street_address_harvested;

-- Asserted — this migration DID write these.
SELECT
  CASE WHEN (SELECT count(*) FROM public.facilities
              WHERE parent_facility_id = 'e83f3d1d-c0c0-4e68-993c-03a8164286c1') = 2
       THEN 'OK' ELSE 'FAIL ← the two BNDH units are not parented' END AS units_parented,
  CASE WHEN (SELECT count(*) FROM public.facilities
              WHERE id IN ('a1b2c3d4-0001-4000-8000-000000000001',
                           'a1b2c3d4-0001-4000-8000-000000000002',
                           'a1b2c3d4-0001-4000-8000-000000000003')
                AND status = 'draft' AND hidden_at IS NOT NULL
                AND hidden_reason = 'seed:pre-publication') = 3
       THEN 'OK' ELSE 'FAIL ← a new row is missing one of its TWO locks' END AS both_locks_on_all_three,
  CASE WHEN (SELECT tier FROM public.facilities WHERE id='a1b2c3d4-0001-4000-8000-000000000003')
            = 'not_applicable'
       THEN 'OK' ELSE 'FAIL ← Kronik Hastalıklar is not not_applicable' END AS kronik_tier,
  CASE WHEN (SELECT count(*) FROM public.facilities WHERE tier='unknown') = 1
        AND (SELECT count(*) FROM public.facilities WHERE tier='not_applicable') = 1
       THEN 'OK' ELSE 'FAIL ← a placeholder tier has spread' END AS placeholders_still_one_off;
ROLLBACK;


-- ═══ BLOCK W7 / 8 — THE NEW ROWS ARE INVISIBLE — run alone ═════════════════
-- Expect: both 'OK'.
--
-- Two independent locks (status='draft' AND hidden_at) checked BEHAVIOURALLY as two
-- separate facts. Clearing either one alone must still leave the row hidden — that is the
-- entire reason for having two, across a coordinate pass that runs for weeks.
BEGIN;
SET LOCAL ROLE anon;
SELECT CASE WHEN (SELECT count(*) FROM public.facilities
                  WHERE id IN ('a1b2c3d4-0001-4000-8000-000000000001',
                               'a1b2c3d4-0001-4000-8000-000000000002',
                               'a1b2c3d4-0001-4000-8000-000000000003')) = 0
            THEN 'OK' ELSE 'FAIL ← unpublished seed data is publicly readable' END AS anon_blind;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM public.search_content('Radyasyon Onkoloji')
                             WHERE id = 'a1b2c3d4-0001-4000-8000-000000000002')
            THEN 'OK' ELSE 'FAIL ← draft row is globally searchable' END AS search_blind;
RESET ROLE;
ROLLBACK;

-- ═══ BLOCK W7b — EACH LOCK HOLDS ALONE — run alone ═════════════════════════
-- Expect: both 'OK'.
--
-- ⚠ REWRITTEN. The first version of this block was UNRUNNABLE and shipped that way.
-- It cleared one lock at a time with UPDATE, and every run died on:
--     ERROR: P0001: hidden_at / hidden_reason are admin-only
--     CONTEXT: guard_moderation_columns() line 28
-- That guard (20260712 §6, bound to facilities by 20260803) refuses hidden_at writes
-- unless get_my_role() = 'admin' — and under `SET ROLE postgres` in the SQL editor there
-- is no JWT, so auth.uid() is NULL, the role is not 'admin', and it raises. THE GUARD IS
-- CORRECT AND DOING ITS JOB; the test was written without accounting for it. An
-- unrunnable block in a file whose contract is "nothing here errors" is worse than no
-- block, because it trains the operator to treat an error as noise.
--
-- THE FIX IS TO STOP UPDATING. `guard_facility_moderation` is BEFORE **UPDATE** only —
-- INSERT is unguarded, which is why §3 of the migration can set hidden_at at all. So
-- this block builds two fresh fixtures that each carry EXACTLY ONE lock and reads them
-- as anon. Same property proven, no moderation column ever mutated, no admin
-- impersonation needed.
--
-- WHAT THIS PROVES, PRECISELY. Three permissive SELECT policies are live and OR together
-- (BLOCK V0 of the other verify file):
--     public read live facilities   hidden_at IS NULL AND status IN ('active','trial')
--     facilities_select_public      status IN ('active','trial') AND is_public = true
--     owner reads own facility      provider_id = auth.uid()
--   status_lock_holds  — hidden_at NULL, status 'draft'. BOTH public policies fail on
--                        status. Unambiguous.
--   hidden_lock_holds  — status 'active', hidden_at set, is_public TRUE. is_public is
--                        deliberately true here so the 0718-shape policy CANNOT be what
--                        blocks it — the only thing left standing between this row and
--                        anon is hidden_at. That is what makes this half mean something,
--                        and it is the half the previous draft could not run at all.
BEGIN;
INSERT INTO public.facilities (id, name, type, sector, status, is_public, hidden_at, hidden_reason) VALUES
  -- lock A only: draft, not hidden
  ('ffffffff-0000-0000-0000-0000000000a1','W7b Status Lock Only','clinic','private','draft', true,  NULL,  NULL),
  -- lock B only: active AND is_public, but hidden
  ('ffffffff-0000-0000-0000-0000000000a2','W7b Hidden Lock Only','clinic','private','active',true,  now(), 'seed:pre-publication');
SET LOCAL ROLE anon;
SELECT
  CASE WHEN (SELECT count(*) FROM public.facilities WHERE id='ffffffff-0000-0000-0000-0000000000a1') = 0
       THEN 'OK' ELSE 'FAIL ← status=draft alone does not hide a row' END AS status_lock_holds,
  CASE WHEN (SELECT count(*) FROM public.facilities WHERE id='ffffffff-0000-0000-0000-0000000000a2') = 0
       THEN 'OK' ELSE 'FAIL ← hidden_at alone does not hide a row' END AS hidden_lock_holds;
RESET ROLE;
-- Fixtures really inserted — otherwise both checks above are vacuously 0.
SELECT CASE WHEN (SELECT count(*) FROM public.facilities
                  WHERE id IN ('ffffffff-0000-0000-0000-0000000000a1','ffffffff-0000-0000-0000-0000000000a2')) = 2
            THEN 'OK' ELSE 'FAIL ← fixtures never inserted; both checks above proved nothing' END AS fixtures_real;
ROLLBACK;


-- ═══ BLOCK W8 / 8 — THE DEVICE PASS — CANNOT BE DONE IN SQL ════════════════
--
-- Everything above proves the DATABASE is right. None of it proves THE TWO SEARCH BOXES
-- NOW AGREE, and that is the whole point of shipping the fold with the tokeniser.
--
-- No OTA required — run the dev client (`npx expo start -c`). NOTHING HERE SHIPS.
--
--   1. THE SAME WORDS IN BOTH BOXES. Type `magusa eczanesi` into the HUB search (top of
--      Home, hits search_content) and into the HEALTH DIRECTORY search (the list's own
--      box, client-side). Before this migration that query returned 83 in one and 0 in
--      the other. THEY MUST NOW AGREE. This is the single check worth doing.
--
--   2. `Girne Devlet Hastanesi` in the hub search → Dr. Akçiçek, and only one Girne
--      hospital. Two would mean the draft duplicate resurfaced.
--
--   3. `Lefkoşa Devlet Hastanesi` → Dr. Burhan Nalbantoğlu AT THE TOP. If YAZMAN
--      ECZANESİ is above it, title-ranking did not take effect.
--
--   4. TYPE ONE COMMON WORD — `eczane`. The result list must look like it always did,
--      nearest-first. Single-token queries are unchanged by design; if this looks
--      reordered or much longer, something in the ranking is wrong.
--
--   5. CLEAR THE BOX. An empty query must show the normal unfiltered list, not an empty
--      one — the coalesce in search_all_tokens is what preserves that.
--
--   6. SPOT-CHECK IN TURKISH. Switch to Türkçe and repeat 1 and 3. Standing rule.
--
-- ─── AND ADD TO THE COORDINATE CHECKLIST ────────────────────────────────────
-- When a hospital finally gets its pin, RE-RUN QUERY 3 ABOVE. It must still return the
-- hospital first — now ranked by BOTH signals rather than by title alone. Title-first
-- ordering was written as a general rule so it stays correct once coordinates exist;
-- this is the check that confirms it did not just paper over the NULL-coordinate window.

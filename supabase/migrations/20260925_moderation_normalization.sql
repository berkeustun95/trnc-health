-- ═══ moderation matcher — normalize away three free evasions ════════════════
--
-- The word filter is defeated by the shift key. Measured against production on
-- 2026-08-29 through /rpc/contains_blocked_term with the anon key — observed, not
-- inferred from a migration file:
--
--     contains_blocked_term('SİKİK')        → false
--     contains_blocked_term('PİÇ')          → false
--     contains_blocked_term('f<ZWNJ>uck')   → false
--     contains_blocked_term('s<TATWEEL>ik') → false
--     contains_blocked_term('the<ZWNJ>rapist') → TRUE   ← a false positive, live
--
-- Three separate causes, one fix:
--
--   1. TURKISH CAPITAL İ (U+0130). lower('İ') is 'i' + U+0307 COMBINING DOT ABOVE.
--      U+0307 is not a word character, so `\msikik\M` no longer has a word to bind to
--      and nothing matches. Every Turkish term in the table is bypassed by typing in
--      capitals — which is exactly how an angry reviewer types. This is the worst of
--      the three: it needs no trick, no invisible character, and no intent.
--
--   2. ZERO-WIDTH AND FORMAT CHARACTERS (Cf) — ZWNJ, ZWJ, ZWSP, soft hyphen, bidi
--      marks, BOM. None is a word character, so one pasted into the middle of a word
--      splits it into two tokens the terms cannot match. It cuts both ways, and the
--      second direction is the one that hurts real users:
--        • evasion — f<ZWNJ>uck is not caught.
--        • FALSE POSITIVE — the<ZWNJ>rapist tokenises as "the" + "rapist" and matches
--          the term `rapist`. Persian is worse, because ZWNJ there is ordinary
--          orthography, not a trick: هیچ‌کس ("nobody") is spelled with one, and once
--          Persian terms land it would match the fragment کس on a completely
--          innocuous word. Arabic tashkeel (Mn) does the same — ADA's own snakebite
--          first-aid string carries a shadda inside تمصّه (constants/i18n.js:3269).
--
--   3. ARABIC TATWEEL (U+0640). Category Lm, so unlike the above it IS a word
--      character — it does not split the token, it just makes the string literally
--      different from the term. كـس never matches كس. Visible, on every Arabic
--      keyboard, and typed for decoration by people with no intent to evade anything.
--
-- ─── WHY THIS GOES FIRST, BEFORE THE 7-LANGUAGE EXPANSION ───────────────────
--
-- The original task was to widen blocked_terms from 2 languages to 9. It was re-scoped
-- after this measurement: a filter that 9 languages can walk around is not improved by
-- adding languages to it, and causes 2 and 3 would arrive as FALSE POSITIVES the moment
-- Persian and Arabic terms are imported. Fix the matcher, then the observability, then
-- the words.
--
-- ─── WHAT THIS DELIBERATELY DOES NOT DO ─────────────────────────────────────
--
-- • NO accent folding. NFC, never NFD/NFKD. Folding ö→o makes the Turkish term `göt`
--   match the English word "got"; folding ç→c makes `piç` match nothing new, since the
--   seed already carries both spellings as separate rows (piç/pic, amına/amina,
--   şerefsiz/serefsiz). Variants stay rows; that precedent is right and is kept.
-- • NO ı→i folding. Turkish ı and i are different letters, not a case pair. Folding
--   them makes the everyday word `sık` ("tight"; `sık sık` = "often") match `sik`.
-- • NO change to word-boundary matching. It was already word-boundary — verified live,
--   Scunthorpe and assessment do not match — and it should stay that way.
-- • NO new RPC. normalize_for_moderation() is REVOKEd from anon and authenticated
--   below, so it never reaches the PostgREST surface. contains_blocked_term() is
--   SECURITY DEFINER and calls it as the owner.
--
-- ─── SURFACES THIS REACHES ──────────────────────────────────────────────────
--
-- All six content-filter triggers funnel into contains_blocked_term(), so one fix
-- lands on all six:
--     check_review_content / check_question_content / check_answer_content
--                                        → check_ugc_on_insert()   20260712:342,346,350
--     check_facility_content                                        20260807:92
--     check_change_request_content                                  20260810:49
--     check_place_content                                           20260824:125
-- (Trigger→function wiring read from the repo files; only the anon key is available
-- here, so pg_trigger was not consulted. The matcher BEHAVIOUR above is live-measured.)
--
-- The client mirror is utils/moderationNormalize.js, imported by utils/profanity.js.
-- It must stay character-for-character equivalent to normalize_for_moderation(): if the
-- two drift, the inline preview says "looks fine" and the insert is then rejected, and
-- the rejection looks arbitrary because nothing tells the user which word was wrong
-- (Phase B fixes that half). scripts/check-moderation-normalization.mjs runs every case
-- through BOTH and fails on any disagreement.

SET ROLE postgres;
BEGIN;

-- ─── 1. The normalization ────────────────────────────────────────────────────
-- IMMUTABLE so the planner folds the p_text call once per statement rather than once
-- per blocked_terms row. STRICT: NULL in, NULL out — contains_blocked_term() then
-- yields false for a NULL column, which is what it did before this change.

CREATE OR REPLACE FUNCTION public.normalize_for_moderation(p_text text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  SELECT lower(
    regexp_replace(
      -- İ → i BEFORE lower(), which would otherwise emit 'i' + U+0307 and break the
      -- word boundary. normalize(…, NFC) first so a decomposed I + U+0307 composes to
      -- U+0130 and is caught by the same replace.
      replace(normalize(p_text, NFC), U&'\0130', 'i'),
      -- Cf format characters, Mn combining marks that survive NFC, and Lm tatweel.
      -- Same order as NON_SEMANTIC in utils/moderationNormalize.js so the two can be
      -- diffed by eye.
      --
      -- Built from U&'' literals, NOT from the characters themselves. Every character
      -- in this class is invisible or a combining mark: written literally they would be
      -- unreviewable in a diff, and this file is APPLIED BY PASTING IT INTO THE SUPABASE
      -- SQL EDITOR, where a soft hyphen or a ZWNJ can be silently dropped or mangled in
      -- transit. Escapes survive the clipboard; the characters might not.
      '[' ||
      U&'\00AD'        ||   -- SOFT HYPHEN
      U&'\0300-\036F'  ||   -- combining diacritical marks
      U&'\0483-\0489'  ||   -- Cyrillic combining
      U&'\0591-\05C7'  ||   -- Hebrew points
      U&'\0610-\061A'  ||   -- Arabic honorifics
      U&'\061C'        ||   -- ARABIC LETTER MARK
      U&'\0640'        ||   -- ARABIC TATWEEL
      U&'\064B-\065F'  ||   -- Arabic tashkeel
      U&'\0670'        ||   -- ARABIC SUPERSCRIPT ALEF
      U&'\06D6-\06ED'  ||   -- Quranic annotation
      U&'\200B-\200F'  ||   -- ZWSP ZWNJ ZWJ LRM RLM
      U&'\202A-\202E'  ||   -- bidi embedding / override
      U&'\2060-\2064'  ||   -- word joiner, invisible operators
      U&'\206A-\206F'  ||   -- deprecated format characters
      U&'\FE00-\FE0F'  ||   -- variation selectors
      U&'\FEFF'        ||   -- ZWNBSP / BOM
      ']',
      '', 'g')
  );
$function$;

-- Keep it off the API surface. The constraint on this work is "no new RPCs", and every
-- public function is an RPC in PostgREST unless EXECUTE is revoked.
REVOKE ALL ON FUNCTION public.normalize_for_moderation(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_for_moderation(text) FROM anon;
REVOKE ALL ON FUNCTION public.normalize_for_moderation(text) FROM authenticated;

-- ─── 2. The matcher, now normalizing BOTH sides ──────────────────────────────
-- Both sides matters. Normalizing only the text would leave a term that itself carries
-- a tatweel or a ZWNJ permanently unmatchable — and Phase C imports Arabic and Persian
-- lists from a source that may well contain them.
--
-- Otherwise unchanged from 20260718_capture_3_functions.sql:171: same word-boundary
-- \m…\M, same metacharacter escaping, same STABLE SECURITY DEFINER. lower() moves
-- inside normalize_for_moderation().

CREATE OR REPLACE FUNCTION public.contains_blocked_term(p_text text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM blocked_terms bt
    WHERE normalize_for_moderation(p_text) ~ (
      '\m' || regexp_replace(normalize_for_moderation(bt.term),
                             '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M'
    )
  );
$function$;

-- ─── 3. Assertions — this migration proves itself or rolls back ──────────────
--
-- The U&'' escapes are the one thing here that could not be tested before applying: the
-- anon key reaches RPCs, not arbitrary SQL. So the first assertion is the control that
-- answers "what does a BROKEN instrument print?" — if U&'' were not being interpreted
-- (standard_conforming_strings off, an editor rewriting the literals), the class would
-- contain the characters U,&,\,0,A,D,-,3,6,F… and would strip digits and letters out of
-- ordinary text. 'Merhaba 123' would not survive it, and the migration stops here
-- instead of silently installing a mangler that quietly eats every user's numbers.
--
-- The regression assertion is DERIVED, not a remembered list: it counts the rows that
-- stopped matching themselves, so it cannot go green by forgetting one.

DO $$
DECLARE
  v_fail text := '';
  v_broken int;
  v_terms int;
  a text;
BEGIN
  a := normalize_for_moderation('Merhaba 123');
  IF a <> 'merhaba 123' THEN
    RAISE EXCEPTION 'normalization mangles ordinary text (got %) — the U&'''' escapes in the character class are not being interpreted; check standard_conforming_strings and that the literals survived the paste', a;
  END IF;

  IF normalize_for_moderation('SİKİK')        <> 'sikik' THEN v_fail := v_fail || ' capital-İ'; END IF;
  IF normalize_for_moderation(U&'f\200Cuck')  <> 'fuck'  THEN v_fail := v_fail || ' ZWNJ';      END IF;
  IF normalize_for_moderation(U&'f\200Duck')  <> 'fuck'  THEN v_fail := v_fail || ' ZWJ';       END IF;
  IF normalize_for_moderation(U&'s\00ADik')   <> 'sik'   THEN v_fail := v_fail || ' soft-hyphen'; END IF;
  IF normalize_for_moderation(U&'s\0640ik')   <> 'sik'   THEN v_fail := v_fail || ' tatweel';   END IF;
  IF normalize_for_moderation(U&'pi\0651ç')   <> 'piç'   THEN v_fail := v_fail || ' shadda';    END IF;
  -- The two must-NOT-fold cases. If either fires, real words are about to be blocked.
  IF normalize_for_moderation('sık')          <> 'sık'   THEN v_fail := v_fail || ' dotless-ı-was-folded'; END IF;
  IF normalize_for_moderation('göt')          <> 'göt'   THEN v_fail := v_fail || ' accent-was-folded';    END IF;
  IF v_fail <> '' THEN
    RAISE EXCEPTION 'normalize_for_moderation is wrong:%', v_fail;
  END IF;

  -- End to end, through the matcher the triggers actually call.
  IF NOT contains_blocked_term('SİKİK')                 THEN v_fail := v_fail || ' capital-İ'; END IF;
  IF NOT contains_blocked_term(U&'f\200Cuck')           THEN v_fail := v_fail || ' ZWNJ';      END IF;
  IF NOT contains_blocked_term(U&'s\0640ik')            THEN v_fail := v_fail || ' tatweel';   END IF;
  IF NOT contains_blocked_term('fuck')                  THEN v_fail := v_fail || ' CONTROL-plain-term-stopped-matching'; END IF;
  IF v_fail <> '' THEN
    RAISE EXCEPTION 'evasion still gets through:%', v_fail;
  END IF;

  IF contains_blocked_term(U&'the\200Crapist')          THEN v_fail := v_fail || ' therapist'; END IF;
  IF contains_blocked_term('sık sık geliyorum')         THEN v_fail := v_fail || ' Turkish-sık'; END IF;
  IF contains_blocked_term('Bitte wählen Sie eine andere Zeit.') THEN v_fail := v_fail || ' German-bitte'; END IF;
  IF contains_blocked_term('لا تشقّ الجرح ولا تمصّه')     THEN v_fail := v_fail || ' Arabic-first-aid'; END IF;
  IF contains_blocked_term('هیچ‌کس اینجا نیست')           THEN v_fail := v_fail || ' Persian-nobody'; END IF;
  IF contains_blocked_term('Scunthorpe')                THEN v_fail := v_fail || ' CONTROL-substring-match-reappeared'; END IF;
  IF v_fail <> '' THEN
    RAISE EXCEPTION 'false positive introduced:%', v_fail;
  END IF;

  SELECT count(*) INTO v_terms  FROM blocked_terms;
  SELECT count(*) INTO v_broken FROM blocked_terms WHERE NOT contains_blocked_term(term);
  IF v_broken > 0 THEN
    RAISE EXCEPTION '% of % existing terms no longer match themselves', v_broken, v_terms;
  END IF;
  RAISE NOTICE 'moderation normalization OK — % existing terms all still match', v_terms;
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
VALUES ('20260925_moderation_normalization.sql', 'f0fb8563f3279dccd9b030a19f5883d291b80f0c8b146d6458f935fba260fcba')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- No ADD COLUMN, so no column can be masked by a stale cache. The NOTIFY is still sent
-- because this migration CREATEs a function, and PostgREST enumerates functions into the
-- same cache — without it the new name can linger in the RPC listing despite the REVOKE.
NOTIFY pgrst, 'reload schema';

-- ─── Verify (run separately, after the COMMIT above) ────────────────────────
--
--   -- 1. the body that is actually installed, not the file that claims to install it:
--   SELECT pg_get_functiondef('public.contains_blocked_term(text)'::regprocedure)
--            LIKE '%normalize_for_moderation%' AS matcher_normalizes;
--   -- expect t
--
--   -- 2. still off the API surface:
--   SELECT has_function_privilege('anon',          'public.normalize_for_moderation(text)', 'EXECUTE') AS anon_can_call,
--          has_function_privilege('authenticated', 'public.normalize_for_moderation(text)', 'EXECUTE') AS auth_can_call;
--   -- expect f, f
--
--   -- 3. then, from the repo root — the full battery, client and server together:
--   --      npm run moderation:check
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
-- Re-apply the contains_blocked_term definition from
-- supabase/migrations/20260718_capture_3_functions.sql:171 verbatim, then
--   DROP FUNCTION public.normalize_for_moderation(text);
-- ⚠ Roll utils/moderationNormalize.js back in the same change, or the client preview
--   normalizes and the server does not — which is the drift this file exists to prevent.
--   DELETE FROM public.schema_migrations_applied
--    WHERE filename = '20260925_moderation_normalization.sql';

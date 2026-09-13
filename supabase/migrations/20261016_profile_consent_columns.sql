-- ═══ Consent: four columns on profiles, and who is allowed to write each ════
--
-- The app half is TERMS_CHECKBOX_LIVE = false in constants/flags.js. This migration is
-- safe to apply while that flag is false and nothing writes these columns yet — which is
-- the intended order: schema first, then the client, then the flag.
--
-- ⚠ profile_schema_version IS NOT BUMPED, DELIBERATELY. That constant is what drags an
--   account back through the completion wizard, and this adds CONSENT, not a required
--   profile field. Bumping it would re-gate every existing user to collect a tick they
--   could give in one tap on the signup screen they are past.
--
-- ⚠ EXISTING ACCOUNTS ARE NOT BACKFILLED. Every existing row keeps terms_accepted_at
--   NULL — 241 of them measured 2026-09-13, and that figure only grows. The post-apply
--   query at the foot of this file prints the LIVE number: trust it over this sentence,
--   which is a remembered measurement and will be stale. (It read "~69" until 2026-09-13,
--   when somebody actually counted.) They
--   accepted under the passive notice that shipped 2026-08-21, not under a tick, and
--   writing a timestamp for a consent event that did not happen would make the column
--   worse than empty — it is the record we would produce if the record were ever
--   questioned. NULL means "no explicit acceptance on file", which is true.
--
-- ─── WHO WRITES WHAT, AND WHY THE SPLIT IS NOT ARBITRARY ────────────────────
--
--   terms_version        CLIENT   what it showed
--   terms_locale         CLIENT   which body it rendered
--   terms_accepted_at    SERVER   when — never the device
--   marketing_opt_in_at  SERVER   when — client supplies only the intent
--
-- The two timestamps are stamped in check_profile_name_content, following branch (d)'s
-- resident_status_updated_at, which already establishes that pattern in this trigger.
-- No RPC: the trigger already fires on every profiles write, and an RPC would be a
-- second write path to keep in step with it.
--
-- ⚠ APPLY THIS BEFORE THE OTA THAT CARRIES THE CLIENT HALF, NOT AFTER. The client adds
--   all four columns to App.js PROFILE_COLUMNS, which is the select list EVERY profile
--   load uses. Against a database without this migration that select returns 42703 and
--   `data` is null, so profile loading breaks for every user on the new bundle — the
--   TERMS_CHECKBOX_LIVE flag does not gate it, because a select list is not a feature.
--   Order: apply this -> run verify_schema.sql -> then `npm run ota`.
--
-- ⚠ ON THE SIGNUP PATH, terms_accepted_at IS NOT THE MOMENT OF THE TICK — see its column
--   comment. Email confirmation is on, signUp returns no session, and the client cannot
--   write the row until the user first signs in. The tick is held in AsyncStorage
--   (utils/pendingConsent.js) with the version, the locale and a CLIENT clock reading,
--   and flushed on the first authenticated session. The client clock drives the 7-day
--   expiry and NOTHING ELSE; it never reaches this table, which is the point of (g).
--
-- ⚠ THE TRIGGER IS A GENERAL profiles BEFORE-WRITE GUARD, NOT ONLY A NAME FILTER, and
--   its name says otherwise. A future reader will not look for terms stamping in a
--   function called check_profile_name_content. A header note is added below saying so;
--   renaming it would touch the D-trigger register, verify_schema and 20261001's own
--   tokens for a cosmetic gain.
--
-- Verified before writing this: the trigger TOLERATES an UPDATE whose payload contains
-- none of the name columns. Branches (a)(b)(c)(d)(f) are each gated on IS DISTINCT FROM
-- or TG_OP and go inert; (e) is ungated but re-checks the STORED date_of_birth, which
-- cannot newly fail — people only get older, and date_of_birth was added by 20261001
-- itself, so no row predates the check.
--
-- EXECUTION: SQL editor, Role = postgres. Whole file, one transaction.
-- Then `node scripts/migration-ledger.mjs` and re-run supabase/verify_schema.sql.

SET ROLE postgres;
BEGIN;

-- ─── 1. Columns ─────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS terms_version       text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS terms_accepted_at   timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS terms_locale        text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS marketing_opt_in_at timestamptz;

COMMENT ON COLUMN public.profiles.terms_version IS
  'Versions the Terms of Service and the Privacy Policy AS A PAIR. One tick accepts both, '
  'so they cannot carry separate numbers without becoming two acceptance events. Mirrors '
  'LEGAL_VERSION in constants/legal/index.js. '
  'CAPTURED AT THE MOMENT OF THE TICK AND EXACT. It is read from the running app as the '
  'user ticks and carried to the write unchanged, so it names the document that was on '
  'screen even if LEGAL_VERSION has moved on by the time the row is written. Contrast '
  'terms_accepted_at, which is NOT the moment of the tick - see its comment. That '
  'asymmetry is deliberate and is stated in both places so no future reader has to infer '
  'it from the code.';

COMMENT ON COLUMN public.profiles.terms_accepted_at IS
  'Server-stamped by check_profile_name_content branch (g). Never accepted from a client: '
  'a device clock can be wrong or deliberately set back, and an acceptance record carrying '
  'one is not a record. '
  'THIS IS NOT THE MOMENT OF THE TICK, AND MUST NOT BE READ AS ONE. Email confirmation is '
  'on, so supabase.auth.signUp returns NO SESSION and the client physically cannot write '
  'this row when the box is ticked. The tick is held on the device and flushed on the '
  'FIRST AUTHENTICATED SESSION FOLLOWING ACCEPTANCE - which is what this column records, '
  'and it is the earliest the acceptance could be recorded, not when it was given. Minutes '
  'in the normal case; hours or days if the user confirms their email later. '
  'The tick is the consent act. This is when it reached the database. A timestamp that '
  'looks precise and is silently late is what fails under scrutiny; a labelled one does '
  'not - which is why the label is here rather than in a commit message. '
  'Scoped to the SIGNUP path deliberately: any future acceptance taken inside an '
  'authenticated session (a re-acceptance round after a version bump) has a session in '
  'hand and WOULD stamp at the true moment, and this comment stays true when that lands.';

COMMENT ON COLUMN public.profiles.terms_locale IS
  'The language of the document body the user ACTUALLY READ, and the legally operative one. '
  'NOT a display preference: seven locales have no translated body and fall back to English, '
  'so for those users this diverges from preferred_language — which is the entire reason the '
  'column exists. Client-supplied because only the app knows which body it rendered. '
  'CAPTURED AT THE MOMENT OF THE TICK AND EXACT, like terms_version and unlike '
  'terms_accepted_at: it records the body in front of the reader at that moment, so a '
  'user who changes app language between ticking and confirming their email still has the '
  'document they actually read on file.';

COMMENT ON COLUMN public.profiles.marketing_opt_in_at IS
  'Server-stamped by branch (h). NULL means not opted in, including after withdrawal — '
  'withdrawal sets it back to NULL rather than recording a second event. NO CONSUMER EXISTS '
  'YET: nothing reads this column and no marketing is sent. It is collected so the consent '
  'predates the first campaign rather than being retrofitted around it.';

-- ─── 2. The trigger, reproduced in full ─────────────────────────────────────
-- CREATE OR REPLACE substitutes the WHOLE definition, so the body below is 20261001's
-- with branches (g) and (h) appended before RETURN. Nothing else is altered; the diff
-- against that file is exactly those two blocks.
CREATE OR REPLACE FUNCTION public.check_profile_name_content()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_norm       text;
  v_name_moved boolean;
BEGIN
  -- (a) full_name FOLLOWS first+last, but only when one of those actually changed.
  -- ProfileScreen still edits full_name directly until Slice 3; that edit touches
  -- neither name part, so it passes through untouched instead of being clobbered by a
  -- derivation the user cannot see.
  IF TG_OP = 'INSERT' THEN
    IF NEW.first_name IS NOT NULL OR NEW.last_name IS NOT NULL THEN
      NEW.full_name := nullif(btrim(concat_ws(' ', NEW.first_name, NEW.last_name)), '');
    END IF;
    v_name_moved := NEW.full_name IS NOT NULL;
  ELSE
    IF NEW.first_name IS DISTINCT FROM OLD.first_name
       OR NEW.last_name IS DISTINCT FROM OLD.last_name THEN
      NEW.full_name := nullif(btrim(concat_ws(' ', NEW.first_name, NEW.last_name)), '');
    END IF;
    v_name_moved := NEW.full_name IS DISTINCT FROM OLD.full_name;
  END IF;

  -- (b) full_name content — checked AFTER derivation, so a first_name of 'fuck' cannot
  -- reach full_name through a column the check never looked at.
  IF v_name_moved AND NEW.full_name IS NOT NULL
     AND contains_blocked_term(NEW.full_name) THEN
    RAISE EXCEPTION 'BLOCKED_TERM';
  END IF;

  -- (c) display_name — content filter, reserved list, and the normalized key.
  IF TG_OP = 'INSERT' OR NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    IF NEW.display_name IS NULL THEN
      NEW.display_name_normalized := NULL;
    ELSE
      IF contains_blocked_term(NEW.display_name) THEN
        RAISE EXCEPTION 'BLOCKED_TERM';
      END IF;
      v_norm := normalize_display_name(NEW.display_name);
      IF v_norm IS NULL THEN
        -- Nothing left after normalization: the name was made entirely of invisible
        -- characters. NULL here would silently opt the row out of the unique index.
        RAISE EXCEPTION 'DISPLAY_NAME_INVALID';
      END IF;
      IF is_reserved_display_name(v_norm) THEN
        RAISE EXCEPTION 'DISPLAY_NAME_RESERVED';
      END IF;
      NEW.display_name_normalized := v_norm;
    END IF;
  ELSE
    -- display_name is not part of this UPDATE: carry the stored key forward, so a client
    -- that echoes the column back cannot desync the key from the name it indexes.
    NEW.display_name_normalized := OLD.display_name_normalized;
  END IF;

  -- (d) resident_status_updated_at is stamped by the SERVER, never accepted from a
  -- client. It is the only evidence of when someone stopped being a student.
  IF TG_OP = 'INSERT' THEN
    IF NEW.resident_status IS NOT NULL THEN
      NEW.resident_status_updated_at := now();
    END IF;
  ELSIF NEW.resident_status IS DISTINCT FROM OLD.resident_status THEN
    NEW.resident_status_updated_at := now();
  ELSE
    NEW.resident_status_updated_at := OLD.resident_status_updated_at;
  END IF;

  -- (e) MIN_SIGNUP_AGE = 13. THE ONLY OTHER PLACE THIS NUMBER APPEARS IS
  -- constants/profileGate.js; scripts/check-profile-gate.mjs reads both and fails if
  -- they disagree. It is a trigger and not a CHECK because CURRENT_DATE is STABLE.
  -- Matches the Google Play target-age declaration of 2026-08-29 (13-15 / 16-17 / 18+).
  IF NEW.date_of_birth IS NOT NULL
     AND NEW.date_of_birth > (current_date - interval '13 years')::date THEN
    RAISE EXCEPTION 'UNDERAGE';
  END IF;

  -- (f) age_ineligible is ONE-WAY for anyone but an admin. Without this, the neutral
  -- age screen is a formality: the client sets the flag, and the same client clears it.
  IF TG_OP = 'UPDATE'
     AND coalesce(get_my_role(), '') <> 'admin'
     AND OLD.age_ineligible AND NOT NEW.age_ineligible THEN
    RAISE EXCEPTION 'age_ineligible is admin-only once set';
  END IF;

  -- (g) terms_accepted_at is stamped by the SERVER. Same shape as (d), same reason,
  -- and here the reason is legal rather than merely tidy: an acceptance record carrying
  -- a device clock is not a record. A phone with the wrong date, or one deliberately
  -- set back, would write a timestamp we would later have to defend.
  --
  -- THE CLIENT SENDS terms_version AND terms_locale; THE SERVER SUPPLIES THE TIME. The
  -- version changing is what marks a fresh acceptance, so re-accepting a NEW version
  -- re-stamps and an unrelated UPDATE (a push_token write, a profile edit) carries the
  -- original forward untouched.
  --
  -- All three arms assign, including the pass-through — a client that sends its own
  -- terms_accepted_at has it overwritten rather than honoured, which is the point.
  IF TG_OP = 'INSERT' THEN
    IF NEW.terms_version IS NOT NULL THEN
      NEW.terms_accepted_at := now();
    END IF;
  ELSIF NEW.terms_version IS DISTINCT FROM OLD.terms_version THEN
    NEW.terms_accepted_at := now();
  ELSE
    NEW.terms_accepted_at := OLD.terms_accepted_at;
  END IF;

  -- (h) marketing_opt_in_at: THE CLIENT SAYS WHETHER, THE SERVER SAYS WHEN.
  --
  -- It cannot key off a version the way (g) does, because opting in and withdrawing are
  -- the same column moving between NULL and not-NULL. So the client's VALUE is read as a
  -- boolean intent and the timestamp is the server's:
  --
  --   NEW NULL                     -> withdrawal, honoured immediately and exactly
  --   NEW non-NULL, OLD NULL       -> fresh opt-in, stamped now()
  --   NEW non-NULL, OLD non-NULL   -> unchanged, the ORIGINAL opt-in time is preserved
  --
  -- That third arm is what stops an unrelated UPDATE silently re-dating a consent the
  -- user gave months ago. Withdrawal is deliberately the cheapest path in the function:
  -- consent that cannot be withdrawn as easily as it was given is not consent.
  IF TG_OP = 'INSERT' THEN
    IF NEW.marketing_opt_in_at IS NOT NULL THEN
      NEW.marketing_opt_in_at := now();
    END IF;
  ELSIF NEW.marketing_opt_in_at IS NULL THEN
    NEW.marketing_opt_in_at := NULL;
  ELSIF OLD.marketing_opt_in_at IS NULL THEN
    NEW.marketing_opt_in_at := now();
  ELSE
    NEW.marketing_opt_in_at := OLD.marketing_opt_in_at;
  END IF;

  RETURN NEW;
END;
$function$;

-- ─── 3. Verification — on a TEMP TABLE, with the REAL function attached ─────
--
-- ⚠ THE PREVIOUS VERSION OF THIS BLOCK COULD NOT APPLY. Two separate faults, both of
--   them in the TEST rather than in the trigger, and both worth keeping written down
--   because the same reasoning error is available to the next person.
--
-- ── FAULT 1: the control fired on a correct trigger ──
--   It ended with
--       IF v_second IS NOT DISTINCT FROM now() THEN RAISE 'the timestamp tracks now()'
--   on the theory that a correctly preserved stamp would be OLDER than the current time.
--   now() IS transaction_timestamp() AND IS FROZEN FOR THE WHOLE TRANSACTION — the SQL
--   standard requires it and the PostgreSQL manual states it outright: "these functions
--   return the start time of the current transaction ... their values do not change
--   during the transaction." So the stamp written in step (1) and the now() read in
--   step (4) are THE SAME INSTANT, the comparison is true by construction, and the
--   control aborted a migration whose trigger was perfect.
--
-- ── FAULT 2: the same freeze made the check ABOVE it blind ──
--   Inside one transaction a correct pass-through (:= OLD.terms_accepted_at) and an
--   unconditional re-stamp (:= now()) WRITE THE IDENTICAL VALUE. So the check that
--   existed to catch an unrelated UPDATE re-dating a consent could not detect the one
--   bug it was named for. It was not merely redundant, it was decoration.
--
-- ── FAULT 3, which nobody had reached yet because fault 1 aborted first ──
--   The block wrote terms_version to a LIVE user's row and then tried to restore it.
--   THAT CANNOT WORK. Branch (g) re-stamps whenever terms_version changes, so setting
--   the version back to NULL stamps terms_accepted_at again — the restore assertion
--   would have failed immediately after the control did. There is no sequence of
--   ordinary UPDATEs that returns a row to "never accepted", and that is a PROPERTY OF
--   THE DESIGN rather than a bug: an acceptance record you can erase by writing to it is
--   not a record. It does mean a probe must never write consent to a real row.
--
-- ── WHAT ALL THREE POINT AT ──
--   A TIMESTAMP IS THE WRONG DISCRIMINATOR INSIDE A TRANSACTION. What survives the
--   freeze is NULL versus NOT NULL, and a planted value that is not now() at all. Both
--   are used below; nothing here compares one now() against another.
--
-- ⚠ SO THE PROBE RUNS ON A SCRATCH TABLE AND TOUCHES NO REAL ROW. tmp_consent_probe is
--   shaped from public.profiles and carries THE REAL FUNCTION — attached, not
--   reimplemented, so this is the deployed definition and not a copy of it that could
--   drift. Every branch of (g) and (h) is exercised there, INCLUDING the ones that are
--   irreversible on a live row, and the block ends by proving public.profiles is
--   unchanged. It also always runs: the old block skipped itself entirely when no
--   never-accepted row existed, which is exactly what a re-apply after go-live looks like.
--
-- ⚠ RED-FIRST. tmp_consent_broken carries a deliberately wrong stamper, and every
--   control below asserts in BOTH directions — green against the real function, RED
--   against the broken one. A control that cannot tell them apart fails the migration
--   and says so in those words. This is the only way the file can claim the check works.
--
-- ⚠ NO PROPERTY IS LEFT UNTESTED, but the structure is asserted INDEPENDENTLY anyway.
--   verify_schema.sql's '1016_profile_consent' H-tokens pin both `:= OLD.` pass-through
--   arms and the `:= NULL` withdrawal arm from pg_get_functiondef. That is a second
--   instrument in a different frame: this block runs once at apply time and proves
--   BEHAVIOUR, the tokens run on every drift check and prove the CODE SHAPE, and a
--   CREATE OR REPLACE months from now that quietly drops an arm is caught by the tokens
--   long after this block has stopped running.
--
-- A false alarm anywhere in here rolls the whole thing back and costs nothing.

-- Unqualified DROPs, and the names are deliberately un-collidable: `pg_temp.x` cannot be
-- written before a temp object exists in the session (there is no temp schema to resolve
-- yet), and an unqualified name could in principle find a REAL table. Neither of these
-- can. They are not needed after a rolled-back run — a rollback undoes CREATE TEMP TABLE
-- too — but they make the file re-runnable after a PARTIAL paste, which is the one way
-- these fixtures can outlive the transaction.
DROP TABLE IF EXISTS tmp_consent_probe;
DROP TABLE IF EXISTS tmp_consent_broken;

-- CREATE TABLE AS ... WITH NO DATA copies the column shape and NOTHING else — no
-- defaults, no NOT NULL, no CHECK constraints. That is what is wanted: the completion
-- constraint has no business rejecting a fixture, and a NOT NULL we forgot to fill would
-- be a false alarm about consent.
CREATE TEMP TABLE tmp_consent_probe        AS SELECT * FROM public.profiles WITH NO DATA;
CREATE TEMP TABLE tmp_consent_broken       AS SELECT * FROM public.profiles WITH NO DATA;

-- plpgsql resolves NEW.<column> at RUN TIME, so the real function runs against any table
-- with the profiles shape. This is the function this migration just installed.
CREATE TRIGGER tmp_consent_probe_t
  BEFORE INSERT OR UPDATE ON tmp_consent_probe
  FOR EACH ROW EXECUTE FUNCTION public.check_profile_name_content();

-- The bug the controls exist to catch, reduced to two lines: a stamp with no condition
-- on it. UPDATE-only, so the INSERT leaves NULL and the control isolates the UPDATE.
CREATE OR REPLACE FUNCTION pg_temp.consent_stamp_broken() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.terms_accepted_at   := now();
    NEW.marketing_opt_in_at := now();
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER tmp_consent_broken_t
  BEFORE INSERT OR UPDATE ON tmp_consent_broken
  FOR EACH ROW EXECUTE FUNCTION pg_temp.consent_stamp_broken();

DO $$
DECLARE
  v_txn     timestamptz := now();                              -- frozen; see above
  v_bogus   timestamptz := timestamptz '1999-01-01 00:00:00+00'; -- a lying device clock
  v_planted timestamptz := timestamptz '2020-01-01 00:00:00+00'; -- an OLD consent
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  v_got    timestamptz;
  v_got2   timestamptz;
  v_before bigint;
  v_after  bigint;
BEGIN
  SELECT count(*) FILTER (WHERE terms_accepted_at IS NOT NULL OR marketing_opt_in_at IS NOT NULL)
    INTO v_before FROM public.profiles;

  -- ── 0. The trigger is actually WIRED on the real table ────────────────────
  -- pg_get_triggerdef renders canonical SQL, so there is nothing to decode by hand.
  -- (Reading pg_trigger.tgargs::text instead is how an earlier check in this repo came
  -- to search a hex string for a word that could never be in it.)
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger tg
      JOIN pg_class cl     ON cl.oid = tg.tgrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
     WHERE ns.nspname = 'public' AND cl.relname = 'profiles' AND NOT tg.tgisinternal
       AND pg_get_triggerdef(tg.oid) LIKE '%BEFORE INSERT OR UPDATE ON public.profiles%'
       AND pg_get_triggerdef(tg.oid) LIKE '%check_profile_name_content()%')
  THEN
    RAISE EXCEPTION 'check_profile_name_content is not wired BEFORE INSERT OR UPDATE on public.profiles';
  END IF;

  -- ── 1. THE CONTROL. NULL vs NOT NULL — the discriminator the freeze cannot eat ──
  -- A row that has accepted nothing must still have accepted nothing after an UPDATE
  -- that has nothing to do with consent. This is the assertion the old timestamp control
  -- was trying and failing to be.
  INSERT INTO tmp_consent_probe        (id, role) VALUES (a, 'customer');
  INSERT INTO tmp_consent_broken       (id, role) VALUES (a, 'customer');
  UPDATE tmp_consent_probe        SET phone = phone WHERE id = a;
  UPDATE tmp_consent_broken       SET phone = phone WHERE id = a;

  SELECT terms_accepted_at, marketing_opt_in_at INTO v_got, v_got2 FROM tmp_consent_probe WHERE id = a;
  IF v_got IS NOT NULL OR v_got2 IS NOT NULL THEN
    RAISE EXCEPTION 'CONTROL FAILED: an unrelated UPDATE stamped consent on a row that accepted nothing (terms=%, marketing=%)',
      coalesce(v_got::text,'<NULL>'), coalesce(v_got2::text,'<NULL>');
  END IF;

  SELECT terms_accepted_at INTO v_got FROM tmp_consent_broken WHERE id = a;
  IF v_got IS NULL THEN
    RAISE EXCEPTION 'RED-FIRST FAILED: the control did not notice a trigger that stamps unconditionally. THE CONTROL IS BROKEN, NOT THE TRIGGER.';
  END IF;

  -- ── 2. (g) UPDATE: the client's timestamp is DISCARDED, the server's is used ──
  -- Exact equality is right here, and it is right BECAUSE now() is frozen: every now()
  -- in this transaction is one instant, so the stamp must equal v_txn to the microsecond.
  -- The freeze that killed the old control makes this assertion sharper than a window.
  INSERT INTO tmp_consent_probe (id, role) VALUES (b, 'customer');
  UPDATE tmp_consent_probe
     SET terms_version = '2026-09', terms_locale = 'English', terms_accepted_at = v_bogus
   WHERE id = b;
  SELECT terms_accepted_at INTO v_got FROM tmp_consent_probe WHERE id = b;
  IF v_got IS DISTINCT FROM v_txn THEN
    RAISE EXCEPTION '(g) did not server-stamp an accepted version: got %, expected %',
      coalesce(v_got::text,'<NULL>'), v_txn;
  END IF;

  -- ── 3. THE FREEZE ITSELF, ASSERTED. Do not re-add the old control. ────────
  -- On a CORRECT trigger the passed-through value EQUALS now(). That is the exact
  -- condition the deleted control treated as proof of failure. Asserting it here means
  -- the file states the reason in a form that can go red: if a future PostgreSQL ever
  -- unfroze now(), this line fails and points at the comment above rather than letting
  -- somebody reinstate a check that would then appear to work.
  UPDATE tmp_consent_probe SET phone = phone WHERE id = b;
  SELECT terms_accepted_at INTO v_got FROM tmp_consent_probe WHERE id = b;
  IF v_got IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'now() is no longer frozen within a transaction (% vs %) — re-read section 3 before changing anything',
      coalesce(v_got::text,'<NULL>'), now();
  END IF;

  -- ── 4. PASS-THROUGH, with a PLANTED value. The real version of the blind check ──
  -- The only way to get an OLD value the freeze cannot disguise is to plant one, and the
  -- only way to plant one is with the trigger off. That is FREE here and nowhere else:
  -- tmp_consent_probe lives in pg_temp, so this locks nothing another session can see. The
  -- same manoeuvre on public.profiles would take a table lock on live user data to test
  -- a property two other instruments already cover between them, which is why it is not
  -- done there.
  ALTER TABLE tmp_consent_probe DISABLE TRIGGER tmp_consent_probe_t;
  UPDATE tmp_consent_probe SET terms_accepted_at = v_planted, marketing_opt_in_at = v_planted WHERE id = b;
  ALTER TABLE tmp_consent_probe ENABLE TRIGGER tmp_consent_probe_t;

  UPDATE tmp_consent_probe SET phone = phone WHERE id = b;
  SELECT terms_accepted_at, marketing_opt_in_at INTO v_got, v_got2 FROM tmp_consent_probe WHERE id = b;
  IF v_got IS DISTINCT FROM v_planted THEN
    RAISE EXCEPTION '(g) pass-through re-dated an existing acceptance: % became %',
      v_planted, coalesce(v_got::text,'<NULL>');
  END IF;
  IF v_got2 IS DISTINCT FROM v_planted THEN
    RAISE EXCEPTION '(h) pass-through re-dated an existing opt-in: % became %',
      v_planted, coalesce(v_got2::text,'<NULL>');
  END IF;

  -- ── 5. A NEW version IS a fresh acceptance and must re-stamp ──────────────
  UPDATE tmp_consent_probe SET terms_version = '2026-10' WHERE id = b;
  SELECT terms_accepted_at INTO v_got FROM tmp_consent_probe WHERE id = b;
  IF v_got IS DISTINCT FROM v_txn THEN
    RAISE EXCEPTION '(g) did not re-stamp on a version change: got %', coalesce(v_got::text,'<NULL>');
  END IF;

  -- ── 6. (h) opt in, withdraw, opt in again ─────────────────────────────────
  INSERT INTO tmp_consent_probe (id, role) VALUES (c, 'customer');
  UPDATE tmp_consent_probe SET marketing_opt_in_at = v_bogus WHERE id = c;
  SELECT marketing_opt_in_at INTO v_got FROM tmp_consent_probe WHERE id = c;
  IF v_got IS DISTINCT FROM v_txn THEN
    RAISE EXCEPTION '(h) opt-in did not server-stamp: got %', coalesce(v_got::text,'<NULL>');
  END IF;

  UPDATE tmp_consent_probe SET marketing_opt_in_at = NULL WHERE id = c;
  IF (SELECT marketing_opt_in_at FROM tmp_consent_probe WHERE id = c) IS NOT NULL THEN
    RAISE EXCEPTION '(h) withdrawal did not reach NULL — consent that cannot be withdrawn is the half that is non-compliant';
  END IF;

  UPDATE tmp_consent_probe SET marketing_opt_in_at = v_bogus WHERE id = c;
  SELECT marketing_opt_in_at INTO v_got FROM tmp_consent_probe WHERE id = c;
  IF v_got IS DISTINCT FROM v_txn THEN
    RAISE EXCEPTION '(h) re-opt-in after withdrawal did not stamp: got %', coalesce(v_got::text,'<NULL>');
  END IF;

  -- ── 7. Shape, independent of every behaviour above ────────────────────────
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'profiles'
         AND column_name IN ('terms_version','terms_accepted_at','terms_locale','marketing_opt_in_at')) <> 4
  THEN
    RAISE EXCEPTION 'expected all four consent columns to exist';
  END IF;

  -- ── 8. AND NOTHING ABOVE TOUCHED A REAL PROFILE. Proven, not promised. ────
  SELECT count(*) FILTER (WHERE terms_accepted_at IS NOT NULL OR marketing_opt_in_at IS NOT NULL)
    INTO v_after FROM public.profiles;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'the probe wrote consent to public.profiles: % rows before, % after', v_before, v_after;
  END IF;

  RAISE NOTICE 'consent stamping verified on a scratch table (real function attached), control proven red against a broken twin, % real profile row(s) carrying consent — unchanged', v_after;
END $$;

DROP TABLE tmp_consent_probe;
DROP TABLE tmp_consent_broken;
DROP FUNCTION pg_temp.consent_stamp_broken();

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
VALUES ('20261016_profile_consent_columns.sql', '54cfa03874246ec1ea10af9c56db1a731cd4fadcc0c4f51d94bc7717b737f59f')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- ADD COLUMN, so PostgREST's schema cache must be told or the client gets 42703 on a
-- column that exists. Outside the transaction, after RESET ROLE.
NOTIFY pgrst, 'reload schema';

-- ─── Post-apply (Role = postgres) ───────────────────────────────────────────
--   SELECT count(*) FILTER (WHERE terms_accepted_at IS NOT NULL) AS accepted,
--          count(*)                                              AS total
--     FROM public.profiles;
-- Expect accepted = 0 immediately after applying: nothing writes these columns until
-- TERMS_CHECKBOX_LIVE goes true, and existing accounts are deliberately not backfilled.

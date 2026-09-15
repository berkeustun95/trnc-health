-- ═══ profiles — the two coupling CHECKs made null-safe (hand-applied) ═══════════════
--
-- ALREADY APPLIED. Run by hand against production on 2026-09-15, Role = postgres. Section 2
-- is that SQL byte-for-byte, including its own DO guard, minus the outer BEGIN/COMMIT
-- (the transaction here is this file's, so the stamp can sit inside it). Sections 1 and 3
-- were written afterwards and did NOT run in production.
--
-- ─── THE DEFECT ──────────────────────────────────────────────────────────────
-- 20261001 wrote both couplings as a bare comparison:
--   institution_id IS NULL OR student_level IN ('university','postgraduate')
--   student_level  IS NULL OR resident_status = 'student'
-- A CHECK passes on UNKNOWN. With student_level NULL the first arm is false and the IN is
-- NULL, so a row holding an institution and no level was ACCEPTED; the same for a level
-- with no resident_status. Each rewrite asserts the operand IS NOT NULL before comparing.
--
-- ─── WHAT PRODUCTION HELD ────────────────────────────────────────────────────
-- Three rows violated the tightened form earlier on 2026-09-15. By the time this ran there
-- were 0 — a user completed the wizard in between — so no cleanup was needed, and the
-- recorded guard (which refuses on any such row) passed. Afterwards, pg_get_constraintdef:
--   profiles_institution_coupling_check:
--     CHECK (((institution_id IS NULL) OR ((student_level IS NOT NULL) AND (student_level = ANY (ARRAY['university'::text, 'postgraduate'::text])))))
--   profiles_student_level_coupling_check:
--     CHECK (((student_level IS NULL) OR ((resident_status IS NOT NULL) AND (resident_status = 'student'::text))))
-- Section 3 asserts exactly those strings.
--
-- ─── RE-RUN ──────────────────────────────────────────────────────────────────
-- Against its own end state the recorded SQL drops and re-adds identical constraints: a
-- no-op in effect. The hazard is a LATER edit to either constraint, which a re-run would
-- silently revert. Section 1 therefore accepts exactly two states per constraint — the
-- 20261001 form or this file's — and refuses anything else, printing what it found.
-- ⚠ The 20261001 form is PGlite 16.4's rendering of 20261001's source, not a string read
--   from production (production was replaced before anyone captured it). PGlite renders
--   this file's two definitions identically to production. If a database renders the old
--   form differently, section 1 refuses and prints it — the safe direction.
--
-- ⚠ RE-RUNNING 20261001 REVERTS THIS FILE. Its DROP IF EXISTS / ADD writes the old,
--   looser forms, which every existing row satisfies, so it succeeds with no error.
--   verify_schema.sql's 1022 token is what catches that.
--
-- 20261024 refuses to apply unless these definitions are live.
--
-- EXECUTION (only ever as a re-run): SQL editor, Role = postgres, the WHOLE FILE. No
-- NOTIFY — no column changes.

SET ROLE postgres;

BEGIN;

-- ─── 1. Guard ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  c       record;
  v_def   text;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('profiles_institution_coupling_check',
     'CHECK (((institution_id IS NULL) OR (student_level = ANY (ARRAY[''university''::text, ''postgraduate''::text]))))',
     'CHECK (((institution_id IS NULL) OR ((student_level IS NOT NULL) AND (student_level = ANY (ARRAY[''university''::text, ''postgraduate''::text])))))'),
    ('profiles_student_level_coupling_check',
     'CHECK (((student_level IS NULL) OR (resident_status = ''student''::text)))',
     'CHECK (((student_level IS NULL) OR ((resident_status IS NOT NULL) AND (resident_status = ''student''::text))))')
  ) AS t(conname, def_1001, def_1022) LOOP
    SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass AND conname = c.conname AND contype = 'c';
    IF v_def IS NULL THEN
      RAISE EXCEPTION 'REFUSING: % does not exist on public.profiles, so 20261001 has not run here. Nothing applied.', c.conname;
    END IF;
    IF v_def IS DISTINCT FROM c.def_1001 AND v_def IS DISTINCT FROM c.def_1022 THEN
      RAISE EXCEPTION 'REFUSING: % was edited after this file ran — re-running would revert it. Found: %. Nothing applied.', c.conname, v_def;
    END IF;
    RAISE NOTICE '% before: %', c.conname,
      CASE WHEN v_def = c.def_1022 THEN 'already this file''s form' ELSE '20261001 form' END;
  END LOOP;
END $$;

-- ─── 2. RECORDED — as run by hand against production, 2026-09-15 (verbatim) ───
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM profiles
   WHERE (institution_id IS NOT NULL AND student_level IS NULL)
      OR (student_level  IS NOT NULL AND resident_status IS NULL);
  IF n > 0 THEN
    RAISE EXCEPTION 'ABORT: % row(s) would violate the tightened constraints. Clean first.', n;
  END IF;
END $$;

ALTER TABLE public.profiles DROP CONSTRAINT profiles_institution_coupling_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_institution_coupling_check
  CHECK (institution_id IS NULL
         OR (student_level IS NOT NULL AND student_level IN ('university','postgraduate')));

ALTER TABLE public.profiles DROP CONSTRAINT profiles_student_level_coupling_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_student_level_coupling_check
  CHECK (student_level IS NULL
         OR (resident_status IS NOT NULL AND resident_status = 'student'));
-- ─── END RECORDED ───────────────────────────────────────────────────────────

-- ─── 3. State check — this file's end state ─────────────────────────────────
-- (a) The catalog text is production's, VALIDATED (a NOT VALID CHECK skips existing rows).
-- (b) Behaviour: the installed definitions are attached to a TEMP table shaped like
--     profiles and run through a case table. No real profile row is written or read. The
--     two "rejected" rows marked UNKNOWN are the ones 20261001's forms accepted.
-- ONE DO BLOCK, EVERY TEMP STATEMENT VIA EXECUTE. Until 2026-09-15 the probe table was
-- created by a top-level statement, used in this block and dropped by another top-level
-- statement — the shape that failed 20261024's first production apply with 42P01. This
-- section had never run in production; it was rewritten to 24's shape before it could.
DO $$
DECLARE
  c        record;
  v_def    text;
  v_valid  boolean;
  v_got    boolean;
  v_rel    text;
BEGIN
  EXECUTE 'CREATE TEMP TABLE tmp_coupling_probe ON COMMIT DROP AS SELECT * FROM public.profiles WITH NO DATA';
  SELECT relpersistence::text INTO v_rel FROM pg_class WHERE oid = to_regclass('tmp_coupling_probe');
  IF v_rel IS DISTINCT FROM 't' THEN
    RAISE EXCEPTION 'tmp_coupling_probe does not resolve to a temp relation (relpersistence=%)', coalesce(v_rel, '<missing>');
  END IF;

  FOR c IN SELECT * FROM (VALUES
    ('profiles_institution_coupling_check',
     'CHECK (((institution_id IS NULL) OR ((student_level IS NOT NULL) AND (student_level = ANY (ARRAY[''university''::text, ''postgraduate''::text])))))'),
    ('profiles_student_level_coupling_check',
     'CHECK (((student_level IS NULL) OR ((resident_status IS NOT NULL) AND (resident_status = ''student''::text))))')
  ) AS t(conname, expected) LOOP
    SELECT pg_get_constraintdef(oid), convalidated INTO v_def, v_valid FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass AND conname = c.conname AND contype = 'c';
    IF v_def IS DISTINCT FROM c.expected OR v_valid IS DISTINCT FROM true THEN
      RAISE EXCEPTION '% is % (validated=%) — expected %', c.conname, coalesce(v_def, '<missing>'), v_valid, c.expected;
    END IF;
    EXECUTE format('ALTER TABLE tmp_coupling_probe ADD CONSTRAINT %I %s', c.conname, v_def);
  END LOOP;

  FOR c IN SELECT * FROM (VALUES
    (NULL::text, NULL::text,        NULL::uuid,        true,  'all empty'),
    ('student',  'university',      gen_random_uuid(), true,  'university student with an institution'),
    ('student',  'postgraduate',    gen_random_uuid(), true,  'postgraduate with an institution'),
    ('student',  'language_course', NULL,              true,  'language course, no institution'),
    ('working',  NULL,              NULL,              true,  'not a student, nothing else'),
    (NULL,       NULL,              gen_random_uuid(), false, 'UNKNOWN: institution, student_level NULL'),
    (NULL,       'university',      NULL,              false, 'UNKNOWN: student_level, resident_status NULL'),
    ('student',  'language_course', gen_random_uuid(), false, 'institution under language_course'),
    ('working',  'university',      NULL,              false, 'student_level while working')
  ) AS t(resident, level, inst, expected, label) LOOP
    BEGIN
      EXECUTE 'INSERT INTO tmp_coupling_probe (id, resident_status, student_level, institution_id)
               VALUES (gen_random_uuid(), $1, $2, $3)' USING c.resident, c.level, c.inst;
      v_got := true;
    EXCEPTION WHEN check_violation THEN
      v_got := false;
    END;
    IF v_got IS DISTINCT FROM c.expected THEN
      RAISE EXCEPTION 'coupling case [%] was %, expected %', c.label,
        CASE WHEN v_got THEN 'ACCEPTED' ELSE 'REJECTED' END,
        CASE WHEN c.expected THEN 'accepted' ELSE 'rejected' END;
    END IF;
  END LOOP;

  EXECUTE 'DROP TABLE tmp_coupling_probe';
  RAISE NOTICE 'both coupling CHECKs match production, are validated, and reject both UNKNOWN cases';
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
VALUES ('20261022_profiles_coupling_checks_null_safe.sql', '2bf1b71156ddb7aa5ec7e3179b23ceba93f87c64eafa86224f2a7a652806a393')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

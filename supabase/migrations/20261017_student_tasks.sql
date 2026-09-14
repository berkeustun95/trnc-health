-- ═══ Student Hub — Slice 2: arrival tasks (schema + 5 structural rows) ═══════
--
-- PROPOSED, NOT APPLIED. Apply with Role = postgres after review.
--
-- Two tables. student_tasks carries what is the same in every language (slug, icon, order,
-- the official link). student_task_i18n carries what is not (title, summary, steps,
-- documents, hours, note) — one row per task per language. The i18n table is left EMPTY:
-- content arrives in a separate seed, and the app renders a task with no row as pending.
--
-- ─── lang IS THE FULL ENGLISH NAME, NOT AN ISO CODE ─────────────────────────
--
-- The app never has 'tr'. `lang` in App.js is profile.preferred_language || pendingLang,
-- and the only writers are LANGUAGES keys (constants/i18n.js) — 'English', 'Turkish', ….
-- An ISO-keyed column would match nothing and every task would read as pending. The CHECK
-- rejects 'tr'/'en' outright so a seed written in the wrong convention fails loudly
-- instead of loading rows no client can find. Section 6 proves it.
--
-- ─── steps: jsonb, NOT a child table ────────────────────────────────────────
--
-- Steps are ordered, edited as a unit per language, never queried or joined on, and no
-- other table points at one. A child table pair (steps + step translations) would be
-- ~5 tasks × 5 steps × 9 languages of hand-seeded rows for no query the app makes.
-- What a child table WOULD give for free is a stable per-step identity — and the app
-- needs one, because checked steps are stored on the device. So each step carries an
-- explicit `id`, and progress is keyed on (task slug, step id), never on position:
-- inserting a step must not move a student's tick onto the wrong line.
-- student_task_steps_valid() enforces the shape on every write path (seed, future admin
-- screen, hand-typed row). What it cannot enforce is that the Turkish row uses the same
-- ids as the English row — that is cross-row, so it is a content check (see footer).
--
-- ─── documents: text[], NOT jsonb ───────────────────────────────────────────
--
-- A list of plain strings with no identity and no progress attached. text[] gets the
-- shape from the type system; jsonb would need a validator to say "array of strings".
--
-- ─── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
--
-- • NO fees or prices, anywhere. They change and they are not ours to state; each task
--   links out (external_url) and the fee is reached there.
-- • NO external_url values. None could be verified from the repo, and a wrong link on a
--   residence-permit task is worse than no button. The app hides the button when NULL.
--   Fill with the UPDATE template in the footer once each URL is checked.
-- • NO RLS on is_active. Mirrors institutions: read for signed-in sessions, the client
--   filters is_active. Guests are anonymous sessions (WelcomeScreen signInAnonymously),
--   which Postgres sees as role `authenticated`, so they read too.
-- • NOT in search_content, so an active row is not publicly findable while
--   MODULE_FLAGS.studentHub is false. That is why the seed may be active on insert.

SET ROLE postgres;
BEGIN;

-- ─── 1. Step validator ──────────────────────────────────────────────────────
-- An array of {id, text}: id a lowercase slug unique within the array, text non-blank.
-- The CASE guard matters: jsonb_array_elements() raises on a non-array, and a CHECK that
-- raises instead of returning false reports the wrong error.
CREATE OR REPLACE FUNCTION public.student_task_steps_valid(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public
AS $function$
  SELECT CASE
    WHEN p IS NULL OR jsonb_typeof(p) <> 'array' THEN false
    ELSE NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(p) e
           WHERE jsonb_typeof(e) IS DISTINCT FROM 'object'
              OR jsonb_typeof(e->'id')   IS DISTINCT FROM 'string'
              OR jsonb_typeof(e->'text') IS DISTINCT FROM 'string'
              OR (e->>'id') !~ '^[a-z][a-z0-9_]{0,39}$'
              OR btrim(e->>'text') = '')
         AND (SELECT count(*) FROM jsonb_array_elements(p))
           = (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(p) e)
  END
$function$;

-- ─── 2. student_tasks ───────────────────────────────────────────────────────
-- is_active DEFAULTs to FALSE (the 20260907 towing rule): an INSERT that omits it lands
-- unpublished, so going live is always an explicit act. The seed below sets it on purpose.
CREATE TABLE IF NOT EXISTS public.student_tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL,
  icon         text NOT NULL,
  sort_order   integer NOT NULL,
  external_url text,
  is_active    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.student_tasks DROP CONSTRAINT IF EXISTS student_tasks_slug_unique;
ALTER TABLE public.student_tasks ADD  CONSTRAINT student_tasks_slug_unique UNIQUE (slug);

-- The slug is the device-side progress key. Renaming one orphans every student's ticks
-- for that task, so treat it as permanent.
ALTER TABLE public.student_tasks DROP CONSTRAINT IF EXISTS student_tasks_slug_check;
ALTER TABLE public.student_tasks ADD  CONSTRAINT student_tasks_slug_check
  CHECK (slug ~ '^[a-z][a-z0-9_]{1,39}$');

-- An Ionicons glyph name. The shape is checked here; that the glyph EXISTS is checked by
-- the client, which falls back to a neutral icon rather than rendering a '?'.
ALTER TABLE public.student_tasks DROP CONSTRAINT IF EXISTS student_tasks_icon_check;
ALTER TABLE public.student_tasks ADD  CONSTRAINT student_tasks_icon_check
  CHECK (icon ~ '^[a-z][a-z0-9-]{1,59}$');

ALTER TABLE public.student_tasks DROP CONSTRAINT IF EXISTS student_tasks_link_scheme_check;
ALTER TABLE public.student_tasks ADD  CONSTRAINT student_tasks_link_scheme_check
  CHECK (external_url IS NULL OR external_url ~ '^https://');

-- ─── 3. student_task_i18n ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.student_task_i18n (
  task_id   uuid NOT NULL REFERENCES public.student_tasks(id) ON DELETE CASCADE,
  lang      text NOT NULL,
  title     text NOT NULL,
  summary   text,
  steps     jsonb  NOT NULL DEFAULT '[]'::jsonb,
  documents text[] NOT NULL DEFAULT '{}'::text[],
  hours     text,
  note      text,
  PRIMARY KEY (task_id, lang)
);

ALTER TABLE public.student_task_i18n DROP CONSTRAINT IF EXISTS student_task_i18n_lang_check;
ALTER TABLE public.student_task_i18n ADD  CONSTRAINT student_task_i18n_lang_check
  CHECK (lang IN ('English','Turkish','Arabic','Russian','Greek','French','Spanish','German','Persian'));

ALTER TABLE public.student_task_i18n DROP CONSTRAINT IF EXISTS student_task_i18n_title_check;
ALTER TABLE public.student_task_i18n ADD  CONSTRAINT student_task_i18n_title_check
  CHECK (btrim(title) <> '');

ALTER TABLE public.student_task_i18n DROP CONSTRAINT IF EXISTS student_task_i18n_steps_check;
ALTER TABLE public.student_task_i18n ADD  CONSTRAINT student_task_i18n_steps_check
  CHECK (public.student_task_steps_valid(steps));

-- array_position() compares with IS NOT DISTINCT FROM, so it finds a NULL element too.
ALTER TABLE public.student_task_i18n DROP CONSTRAINT IF EXISTS student_task_i18n_documents_check;
ALTER TABLE public.student_task_i18n ADD  CONSTRAINT student_task_i18n_documents_check
  CHECK (array_position(documents, NULL) IS NULL AND array_position(documents, '') IS NULL);

COMMENT ON COLUMN public.student_task_i18n.lang IS
  'Full English language name as the app stores it (''Turkish''), never an ISO code.';
COMMENT ON COLUMN public.student_task_i18n.steps IS
  'Ordered [{id, text}]. The SAME ids in every language row of a task: the device stores '
  'checked steps by (slug, id). Give a changed step a NEW id if a tick on the old one '
  'should no longer count.';
COMMENT ON COLUMN public.student_task_i18n.hours IS
  'Opening hours as display text in this language. NULL hides the section.';

-- ─── 4. RLS — one read policy each, no write policy ─────────────────────────
-- Plain English: any signed-in session, guests included (they are anonymous sessions),
-- can READ every row of both tables. Nobody using the app can insert, update or delete;
-- the only writer is postgres / service_role, which RLS does not constrain. A request
-- with no session at all (the bare anon key) reads nothing.
ALTER TABLE public.student_tasks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_task_i18n ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student_tasks_read_authenticated" ON public.student_tasks;
CREATE POLICY "student_tasks_read_authenticated" ON public.student_tasks
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "student_task_i18n_read_authenticated" ON public.student_task_i18n;
CREATE POLICY "student_task_i18n_read_authenticated" ON public.student_task_i18n
  FOR SELECT TO authenticated USING (true);

-- ─── 5. Seed — structure only ───────────────────────────────────────────────
-- Fixed ids so the content seed can reference a task without a lookup.
-- sim_line BEFORE mcks is a dependency, not a preference: the MCKS student exemption needs
-- a phone line already registered in the student's own name. The other three keep the
-- order they were given in; no further dependency between them is asserted here.
INSERT INTO public.student_tasks (id, slug, icon, sort_order, external_url, is_active) VALUES
  ('00000000-0000-4000-c000-000000000001','sim_line',         'cellular-outline',       10, NULL, true),
  ('00000000-0000-4000-c000-000000000002','mcks',             'phone-portrait-outline', 20, NULL, true),
  ('00000000-0000-4000-c000-000000000003','residence_permit', 'id-card-outline',        30, NULL, true),
  ('00000000-0000-4000-c000-000000000004','health_check',     'medkit-outline',         40, NULL, true),
  ('00000000-0000-4000-c000-000000000005','bank_account',     'card-outline',           50, NULL, true)
ON CONFLICT (id) DO NOTHING;

-- ─── 6. Assertions ──────────────────────────────────────────────────────────
-- Re-runnable: nothing here assumes the i18n table is still empty or the URLs still NULL,
-- because the content seed and the URL UPDATEs will have run by the next re-apply. Every
-- probe row is written inside a sub-block that is always rolled back.
DO $$
DECLARE
  v_probe  uuid;
  v_got    boolean;
  v_rows   text;
  c        record;
BEGIN
  -- (a) the validator, case table. The valid cases are the controls: a validator that
  --     returns false for everything would pass every negative.
  FOR c IN SELECT * FROM (VALUES
    ('[{"id":"buy_sim","text":"x"},{"id":"register","text":"y"}]'::jsonb, true,  'two valid steps'),
    ('[]'::jsonb,                                                          true,  'no steps'),
    ('{"id":"a","text":"x"}'::jsonb,                                       false, 'object, not array'),
    ('"a"'::jsonb,                                                         false, 'string, not array'),
    ('[1]'::jsonb,                                                         false, 'element not an object'),
    ('[{"id":"a"}]'::jsonb,                                                false, 'missing text'),
    ('[{"text":"x"}]'::jsonb,                                              false, 'missing id'),
    ('[{"id":"a","text":"   "}]'::jsonb,                                   false, 'blank text'),
    ('[{"id":"Step 1","text":"x"}]'::jsonb,                                false, 'id not a slug'),
    ('[{"id":1,"text":"x"}]'::jsonb,                                       false, 'numeric id'),
    ('[{"id":"a","text":"x"},{"id":"a","text":"y"}]'::jsonb,               false, 'duplicate id')
  ) AS t(input, expected, label) LOOP
    v_got := public.student_task_steps_valid(c.input);
    IF v_got IS DISTINCT FROM c.expected THEN
      RAISE EXCEPTION 'student_task_steps_valid(%) [%] returned %, expected %',
        c.input, c.label, coalesce(v_got::text, '<NULL>'), c.expected;
    END IF;
  END LOOP;

  -- (b) constraints and defaults, against a throwaway task that never commits.
  BEGIN
    INSERT INTO public.student_tasks (slug, icon, sort_order)
      VALUES ('zz_probe', 'ellipse-outline', 9999) RETURNING id INTO v_probe;

    SELECT is_active INTO v_got FROM public.student_tasks WHERE id = v_probe;
    IF v_got IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'student_tasks.is_active DEFAULT is %, expected false', coalesce(v_got::text, '<NULL>');
    END IF;

    -- Control: a well-formed Turkish row is accepted. If this raises, the negatives below
    -- prove nothing.
    INSERT INTO public.student_task_i18n (task_id, lang, title, steps, documents)
      VALUES (v_probe, 'Turkish', 'zz probe', '[{"id":"a","text":"x"}]', ARRAY['Pasaport']);

    BEGIN
      INSERT INTO public.student_task_i18n (task_id, lang, title) VALUES (v_probe, 'tr', 'zz probe');
      RAISE EXCEPTION 'ASSERT: lang ''tr'' was ACCEPTED — the column must reject ISO codes';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
      INSERT INTO public.student_task_i18n (task_id, lang, title) VALUES (v_probe, 'en', 'zz probe');
      RAISE EXCEPTION 'ASSERT: lang ''en'' was ACCEPTED — the column must reject ISO codes';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
      INSERT INTO public.student_task_i18n (task_id, lang, title, steps)
        VALUES (v_probe, 'English', 'zz probe', '[{"id":"a","text":"x"},{"id":"a","text":"y"}]');
      RAISE EXCEPTION 'ASSERT: duplicate step ids were ACCEPTED';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
      INSERT INTO public.student_task_i18n (task_id, lang, title, documents)
        VALUES (v_probe, 'English', 'zz probe', ARRAY['Passport', NULL]);
      RAISE EXCEPTION 'ASSERT: a NULL document was ACCEPTED';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
      INSERT INTO public.student_task_i18n (task_id, lang, title, documents)
        VALUES (v_probe, 'English', 'zz probe', ARRAY['']);
      RAISE EXCEPTION 'ASSERT: an empty document was ACCEPTED';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    BEGIN
      INSERT INTO public.student_tasks (slug, icon, sort_order, external_url)
        VALUES ('zz_probe_http', 'ellipse-outline', 9999, 'http://example.com');
      RAISE EXCEPTION 'ASSERT: an http:// external_url was ACCEPTED';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    RAISE EXCEPTION 'zz_probe_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'zz_probe_rollback' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.student_tasks WHERE slug LIKE 'zz\_probe%') THEN
    RAISE EXCEPTION 'probe rows survived the rollback';
  END IF;

  -- (c) the seed's one hard ordering rule.
  IF (SELECT sort_order FROM public.student_tasks WHERE slug = 'sim_line')
     >= (SELECT sort_order FROM public.student_tasks WHERE slug = 'mcks')
     OR (SELECT count(*) FROM public.student_tasks WHERE slug IN
          ('sim_line','mcks','residence_permit','health_check','bank_account')) <> 5 THEN
    RAISE EXCEPTION 'seed: the five slugs are not all present, or sim_line does not sort before mcks';
  END IF;

  -- (d) RLS on, and DERIVED policy counts — printed, not remembered.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.student_tasks'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.student_task_i18n'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on both student task tables';
  END IF;

  SELECT string_agg(format('%s.%s [%s → %s]', tablename, policyname, cmd, roles::text), '; ' ORDER BY tablename, policyname)
    INTO v_rows
    FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('student_tasks','student_task_i18n');
  RAISE NOTICE 'student task policies: %', v_rows;

  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_tasks') <> 1
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'student_task_i18n') <> 1
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename IN ('student_tasks','student_task_i18n')
                  AND (cmd <> 'SELECT' OR roles <> '{authenticated}'::name[])) THEN
    RAISE EXCEPTION 'expected exactly one SELECT-to-authenticated policy per table, found: %', v_rows;
  END IF;
END
$$;

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
VALUES ('20261017_student_tasks.sql', '7823d9faca7f36e82402a47527f0fa5a1fd24ad507d7f926ff04b7a61771a833')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── After the content seed (Role = postgres) ───────────────────────────────
--   -- 1. every active task has all 9 languages (derived: lists what is missing)
--   SELECT t.slug, l.lang AS missing
--   FROM student_tasks t
--   CROSS JOIN unnest(ARRAY['English','Turkish','Arabic','Russian','Greek','French',
--                           'Spanish','German','Persian']) AS l(lang)
--   LEFT JOIN student_task_i18n i ON i.task_id = t.id AND i.lang = l.lang
--   WHERE t.is_active AND i.task_id IS NULL
--   ORDER BY t.sort_order, l.lang;                                   -- expect 0 rows
--
--   -- 2. step ids agree across languages (the one rule no CHECK can hold)
--   SELECT t.slug, i.lang,
--          (SELECT string_agg(e->>'id', ',' ORDER BY o) FROM jsonb_array_elements(i.steps) WITH ORDINALITY x(e, o)) AS ids,
--          (SELECT string_agg(e->>'id', ',' ORDER BY o) FROM jsonb_array_elements(en.steps) WITH ORDINALITY x(e, o)) AS english_ids
--   FROM student_task_i18n i
--   JOIN student_tasks t ON t.id = i.task_id
--   JOIN student_task_i18n en ON en.task_id = i.task_id AND en.lang = 'English'
--   WHERE (SELECT string_agg(e->>'id', ',' ORDER BY o) FROM jsonb_array_elements(i.steps) WITH ORDINALITY x(e, o))
--         IS DISTINCT FROM
--         (SELECT string_agg(e->>'id', ',' ORDER BY o) FROM jsonb_array_elements(en.steps) WITH ORDINALITY x(e, o));
--                                                                    -- expect 0 rows
--
--   -- 3. no active task without a link
--   SELECT slug FROM student_tasks WHERE is_active AND external_url IS NULL;   -- expect 0 rows
--
-- ─── URL template (fill once each link is verified) ─────────────────────────
--   UPDATE public.student_tasks SET external_url = 'https://…' WHERE slug = 'sim_line';
--   UPDATE public.student_tasks SET external_url = 'https://…' WHERE slug = 'mcks';
--   UPDATE public.student_tasks SET external_url = 'https://…' WHERE slug = 'residence_permit';
--   UPDATE public.student_tasks SET external_url = 'https://…' WHERE slug = 'health_check';
--   UPDATE public.student_tasks SET external_url = 'https://…' WHERE slug = 'bank_account';
--
-- ─── Which language values do profiles actually hold? (unverifiable as anon) ─
--   SELECT preferred_language, count(*) FROM profiles GROUP BY 1 ORDER BY 2 DESC;
--   -- Anything outside the nine names renders tasks in English (the client falls back
--   -- exactly as t() does), so this sizes a cosmetic gap, not a crash.
--
-- ─── REVERT ─────────────────────────────────────────────────────────────────
--   BEGIN;
--     SET ROLE postgres;
--     DROP TABLE IF EXISTS public.student_task_i18n;
--     DROP TABLE IF EXISTS public.student_tasks;
--     DROP FUNCTION IF EXISTS public.student_task_steps_valid(jsonb);
--   COMMIT;
--   RESET ROLE;
--   NOTIFY pgrst, 'reload schema';

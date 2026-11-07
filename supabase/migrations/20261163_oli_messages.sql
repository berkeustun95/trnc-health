-- ═══════════════════════════════════════════════════════════════════════════
-- 20261163 — oli_messages: saved Ask Oli chat history (guided chat, no AI), 90-day retention
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SCHEMA ONLY, no data. Ask Oli becomes a guided chat (keyword match + tap-chips, answers only from ADA's own
-- tables, no AI provider). Each signed-in user's chat is saved so it is there the next time they open Oli. One
-- thread per user: a row is one message, either what the user typed/spoke (role 'user', `body`) or Oli's answer
-- (role 'oli', `payload` = the answer provider's structured output, versioned, rendered by the app in the
-- current language). The app is behind OLI_CHAT (constants/redesign.js); nothing writes here until it is on.
--
-- ─── WHO CAN READ / WRITE / DELETE ──────────────────────────────────────────
--   SELECT  A signed-in, NON-GUEST user reads ONLY their own rows. Nobody else: no admin policy, no public
--           policy. An admin reading another person's chat gets zero rows like anyone else. Guests
--           (signInAnonymously(), which is `authenticated`) read nothing: NOT is_anonymous_session().
--   INSERT  The same user, own rows only, three columns (role, body, payload). `user_id` is filled by its
--           DEFAULT auth.uid() and is NOT in the column grant, so nobody can write into someone else's
--           history; `id` and `created_at` are not in it either, so nobody can pick a key or backdate a row.
--           Guests cannot insert: their chat stays on the phone only (a guest account is throwaway, and
--           script-made guests were found on 2026-11-05, vault 2026-11-05_admin-user-counts.md).
--   DELETE  The user deletes their own rows ("Delete my chat history" in the Oli sheet). Guests own none.
--   UPDATE  NOBODY (no permissive policy, no UPDATE grant, plus a RESTRICTIVE USING(false) veto).
--   anon    (no session) has no privilege at all.
--   Account deletion erases the chat: user_id REFERENCES auth.users ON DELETE CASCADE.
--
-- ─── RETENTION: 90 days ─────────────────────────────────────────────────────
--   public.purge_oli_messages() deletes rows older than 90 days, nightly at 03:57 UTC (after
--   purge-partner-booking-requests 03:53). Same posture as 20261148: SECURITY INVOKER as the cron owner
--   (postgres, the table owner, RLS does not apply), EXECUTE revoked from PUBLIC, anon and authenticated.
--   The privacy text states the same 90 days.
--
-- ─── ABUSE BOUND ────────────────────────────────────────────────────────────
--   Anyone signed in can write into their OWN history, so without a bound one account could grow the table
--   without limit. A BEFORE INSERT trigger refuses a row once the same user has 40 rows in the last 10
--   minutes (one exchange = 2 rows, so 20 questions in 10 minutes; a person tapping chips does not reach it)
--   or 400 rows in the last 24 hours. It first takes a per-user transaction advisory lock, so parallel
--   requests from one account queue behind each other instead of each counting before the others commit
--   (READ COMMITTED); different users never wait on each other. It counts with the inserting role's own RLS
--   view, which is exactly that user's rows (index below). The app treats a refused insert as "not saved"
--   and still shows the answer. Oli's answers are written by the client, so a user can put any JSON object
--   into their own oli rows: it reaches only their own screen, and the app renders payload as data (known
--   navigation targets only, no URLs). body <= 500 chars, payload is a
--   JSON object <= 8000 bytes: the table CHECKs hold those bounds for every writer; the policies
--   carry only "own rows AND not a guest", so the assertions below can refuse any OR in them.
--
-- Apply: gh workflow run supabase-migrate -f file=20261163_oli_messages.sql (dry), then -f apply=true
-- (Berke approves production-db). Creates a table ⇒ ends with NOTIFY pgrst (after COMMIT and RESET ROLE).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.oli_messages (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL DEFAULT auth.uid(),
  role       text        NOT NULL,
  body       text,
  payload    jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oli_messages_pkey PRIMARY KEY (id),
  CONSTRAINT oli_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT oli_messages_role_check CHECK (role IN ('user', 'oli')),
  CONSTRAINT oli_messages_shape_check CHECK (
    (role = 'user' AND body IS NOT NULL AND char_length(body) BETWEEN 1 AND 500 AND payload IS NULL)
    OR (role = 'oli' AND body IS NULL AND payload IS NOT NULL)),
  CONSTRAINT oli_messages_payload_check CHECK (
    payload IS NULL OR (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 8000))
);

CREATE INDEX IF NOT EXISTS oli_messages_user_created_idx ON public.oli_messages (user_id, created_at DESC);

COMMENT ON TABLE public.oli_messages IS
  'Ask Oli guided-chat history, one thread per user: role user (body) or oli (payload = the answer provider output). A signed-in non-guest user may SELECT, INSERT (role, body, payload) and DELETE only their own rows; nobody else can read them, admins included; nobody may UPDATE. Guests: nothing. Rows older than 90 days are deleted nightly by cron purge-oli-messages (03:57 UTC). Cascades with auth.users. 20261163.';

ALTER TABLE public.oli_messages ENABLE ROW LEVEL SECURITY;

-- Supabase default privileges hand anon/authenticated ALL on a new public table; this REVOKE is what makes
-- the rest mean anything.
REVOKE ALL ON TABLE public.oli_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.oli_messages TO authenticated;
GRANT INSERT (role, body, payload) ON public.oli_messages TO authenticated;

DROP POLICY IF EXISTS "oli_select_own" ON public.oli_messages;
CREATE POLICY "oli_select_own" ON public.oli_messages
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()) AND NOT (select public.is_anonymous_session()));

DROP POLICY IF EXISTS "oli_insert_own" ON public.oli_messages;
CREATE POLICY "oli_insert_own" ON public.oli_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    AND NOT (select public.is_anonymous_session())
  );

DROP POLICY IF EXISTS "oli_delete_own" ON public.oli_messages;
CREATE POLICY "oli_delete_own" ON public.oli_messages
  FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()) AND NOT (select public.is_anonymous_session()));

DROP POLICY IF EXISTS "oli_no_update" ON public.oli_messages;
CREATE POLICY "oli_no_update" ON public.oli_messages
  AS RESTRICTIVE FOR UPDATE TO public
  USING (false) WITH CHECK (false);

-- ─── Abuse bound: 40 rows per user per 10 minutes, 400 per 24 hours ─────────
CREATE OR REPLACE FUNCTION public.oli_messages_rate_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('oli_messages:' || NEW.user_id::text, 0));
  IF (SELECT count(*) FROM public.oli_messages
       WHERE user_id = NEW.user_id AND created_at > now() - interval '10 minutes') >= 40
     OR (SELECT count(*) FROM public.oli_messages
       WHERE user_id = NEW.user_id AND created_at > now() - interval '24 hours') >= 400 THEN
    RAISE EXCEPTION 'OLI_RATE_LIMIT' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.oli_messages_rate_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.oli_messages_rate_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS oli_messages_rate_guard ON public.oli_messages;
CREATE TRIGGER oli_messages_rate_guard BEFORE INSERT ON public.oli_messages
  FOR EACH ROW EXECUTE FUNCTION public.oli_messages_rate_guard();

-- ─── Retention: 90 days ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_oli_messages()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_cut timestamptz := now() - interval '90 days';
  n int;
BEGIN
  DELETE FROM public.oli_messages WHERE created_at < v_cut;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('deleted', n, 'cutoff', v_cut);
END;
$function$;

ALTER FUNCTION public.purge_oli_messages() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.purge_oli_messages() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.purge_oli_messages() IS
  'Nightly retention for oli_messages: deletes rows older than 90 days. Cron purge-oli-messages 03:57 UTC. Not client-callable. 20261163.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-oli-messages') THEN
    PERFORM cron.unschedule('purge-oli-messages');
  END IF;
END $$;
SELECT cron.schedule('purge-oli-messages', '57 3 * * *', $$SELECT public.purge_oli_messages()$$);

-- ─── Assertions + probes (inside the transaction; a failure rolls the file back) ─
-- Probes print no user id and no row count of real data (Actions logs are public): the table is new, and the
-- behaviour probe borrows one existing auth.users id only as a foreign-key target, never printed.
DO $$
DECLARE
  v_t      regclass := to_regclass('public.oli_messages');
  v_purge  regprocedure := to_regprocedure('public.purge_oli_messages()');
  v_guard  regprocedure := to_regprocedure('public.oli_messages_rate_guard()');
  v_n      int;
  v_names  text;
  v_cols   text;
  v_priv   text;
  v_role   text;
  v_fn     regprocedure;
  v_cmd    text;
  v_sched  text;
  v_active boolean;
  v_uid    uuid;
  v_old    uuid;
  v_edge   uuid;
  v_fresh  uuid;
  v_res    jsonb;
  v_old_left   int;
  v_edge_left  int;
  v_fresh_left int;
BEGIN
  IF v_t IS NULL THEN RAISE EXCEPTION 'oli_messages is not visible to this block'; END IF;
  IF v_purge IS NULL OR v_guard IS NULL THEN RAISE EXCEPTION 'purge_oli_messages() or oli_messages_rate_guard() was not created'; END IF;
  IF (SELECT relowner::regrole::text FROM pg_class WHERE oid = v_t) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'oli_messages is owned by %, expected postgres', (SELECT relowner::regrole::text FROM pg_class WHERE oid = v_t);
  END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_t) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RLS is not enabled on oli_messages';
  END IF;

  -- Columns: exactly these six, printed.
  SELECT count(*), string_agg(column_name || ':' || data_type, ', ' ORDER BY ordinal_position) INTO v_n, v_cols
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'oli_messages';
  IF v_n IS DISTINCT FROM 6 THEN RAISE EXCEPTION 'oli_messages has % columns (want 6): %', v_n, v_cols; END IF;
  RAISE NOTICE 'oli_messages columns: %', v_cols;

  -- Constraints: pkey + fkey + 3 CHECK = 5, printed. contype filter: PG 18 also lists NOT NULL in pg_constraint.
  SELECT count(*), string_agg(conname, ', ' ORDER BY conname) INTO v_n, v_names
    FROM pg_constraint WHERE conrelid = v_t AND contype IN ('p','f','c');
  IF v_n IS DISTINCT FROM 5 THEN RAISE EXCEPTION 'oli_messages has % constraints (want 5): %', v_n, v_names; END IF;
  IF (SELECT confdeltype FROM pg_constraint WHERE conrelid = v_t AND conname = 'oli_messages_user_id_fkey') IS DISTINCT FROM 'c' THEN
    RAISE EXCEPTION 'oli_messages_user_id_fkey is not ON DELETE CASCADE';
  END IF;

  -- FULL policy set: exactly these four, three permissive.
  SELECT count(*), string_agg(policyname || ':' || cmd || ':' || permissive, ', ' ORDER BY policyname)
    INTO v_n, v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = 'oli_messages';
  IF v_n IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'oli_messages must carry exactly 4 policies; found %: %', v_n, v_names; END IF;
  IF (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'oli_messages')
     IS DISTINCT FROM ARRAY['oli_delete_own','oli_insert_own','oli_no_update','oli_select_own'] THEN
    RAISE EXCEPTION 'oli_messages policy names unexpected: %', v_names;
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'oli_messages' AND permissive = 'PERMISSIVE') IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'expected exactly 3 PERMISSIVE policies (select, insert, delete own): %', v_names;
  END IF;
  -- Every permissive policy is scoped to the caller's own rows and excludes guests, and joins its terms with AND
  -- only: a policy that ORs them ("own rows OR not a guest") would leak every user's chat while still naming
  -- both functions. Read from the rendered expressions, without depending on one major's exact rendering.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'oli_messages' AND permissive = 'PERMISSIVE'
              AND ((coalesce(qual, '') || coalesce(with_check, '')) NOT LIKE '%auth.uid()%'
                OR (coalesce(qual, '') || coalesce(with_check, '')) NOT LIKE '%is_anonymous_session()%'
                OR upper(coalesce(qual, '') || ' ' || coalesce(with_check, '')) LIKE '% OR %')) THEN
    RAISE EXCEPTION 'a permissive oli_messages policy is not own-rows + non-guest: %', v_names;
  END IF;
  RAISE NOTICE 'oli_messages policies (4): %', v_names;

  -- Privileges. anon: nothing. authenticated: SELECT, DELETE, INSERT on exactly (body, payload, role); no UPDATE.
  FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege('anon', v_t, v_priv) THEN RAISE EXCEPTION 'anon holds % on oli_messages', v_priv; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_t AND a.attnum > 0 AND NOT a.attisdropped
              AND has_column_privilege('anon', a.attrelid, a.attnum, 'SELECT,INSERT,UPDATE,REFERENCES')) THEN
    RAISE EXCEPTION 'anon holds a column privilege on oli_messages';
  END IF;
  FOREACH v_priv IN ARRAY ARRAY['UPDATE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
    IF has_table_privilege('authenticated', v_t, v_priv) THEN RAISE EXCEPTION 'authenticated holds % on oli_messages', v_priv; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_t AND a.attnum > 0 AND NOT a.attisdropped
              AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE,REFERENCES')) THEN
    RAISE EXCEPTION 'authenticated holds a column UPDATE/REFERENCES privilege on oli_messages';
  END IF;
  IF (SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM pg_attribute a
       WHERE a.attrelid = v_t AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT'))
     IS DISTINCT FROM 'body,payload,role' THEN
    RAISE EXCEPTION 'authenticated INSERT columns are not exactly body,payload,role: %',
      (SELECT string_agg(a.attname, ',' ORDER BY a.attname) FROM pg_attribute a WHERE a.attrelid = v_t AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT'));
  END IF;
  IF NOT has_table_privilege('authenticated', v_t, 'SELECT') OR NOT has_table_privilege('authenticated', v_t, 'DELETE') THEN
    RAISE EXCEPTION 'positive control: authenticated lost SELECT or DELETE on oli_messages';
  END IF;

  -- Functions: neither is callable by a client. Positive control: the owner can execute both.
  FOREACH v_fn IN ARRAY ARRAY[v_purge, v_guard] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_function_privilege(v_role, v_fn, 'EXECUTE') THEN RAISE EXCEPTION '% can EXECUTE %', v_role, v_fn; END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = v_fn AND a.grantee = 0) THEN
      RAISE EXCEPTION 'PUBLIC holds EXECUTE on %', v_fn;
    END IF;
    IF NOT has_function_privilege('postgres', v_fn, 'EXECUTE') THEN RAISE EXCEPTION 'positive control: postgres cannot EXECUTE %', v_fn; END IF;
  END LOOP;

  -- The trigger: exactly one user trigger on the table, BEFORE INSERT, calling the guard.
  SELECT count(*), string_agg(pg_get_triggerdef(oid), ' | ') INTO v_n, v_names FROM pg_trigger WHERE tgrelid = v_t AND NOT tgisinternal;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = v_t AND NOT tgisinternal AND tgenabled = 'D') THEN
    RAISE EXCEPTION 'the oli_messages rate guard trigger is disabled';
  END IF;
  IF v_n IS DISTINCT FROM 1 OR v_names NOT LIKE '%BEFORE INSERT ON public.oli_messages FOR EACH ROW EXECUTE FUNCTION %oli_messages_rate_guard()%' THEN
    RAISE EXCEPTION 'oli_messages triggers unexpected (% ): %', v_n, v_names;
  END IF;

  -- The cron row: exactly one, active, exact schedule and command. PRINTED.
  SELECT count(*), max(schedule), max(command), bool_and(active) INTO v_n, v_sched, v_cmd, v_active
    FROM cron.job WHERE jobname = 'purge-oli-messages';
  RAISE NOTICE 'cron.job purge-oli-messages: rows=%, schedule=%, active=%, command=%', v_n, v_sched, v_active, v_cmd;
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'expected exactly 1 cron job purge-oli-messages; found %', v_n; END IF;
  IF v_sched IS DISTINCT FROM '57 3 * * *' THEN RAISE EXCEPTION 'schedule is %, expected 57 3 * * *', v_sched; END IF;
  IF btrim(v_cmd) IS DISTINCT FROM 'SELECT public.purge_oli_messages()' THEN RAISE EXCEPTION 'cron command is %', v_cmd; END IF;
  IF v_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'cron job is not active'; END IF;

  IF coalesce(obj_description(v_t, 'pg_class'), '') NOT LIKE '%90 days%' THEN RAISE EXCEPTION 'table comment does not state the 90-day retention'; END IF;

  -- BEHAVIOUR: old goes, fresh stays. Inserted as postgres (owner, bypasses RLS and the column grant) with a
  -- backdated created_at; one existing auth.users id is the foreign-key target (never printed). The table is
  -- new, so the purge can only meet the probe rows. Probe rows are removed again so a re-run is safe.
  SELECT id INTO v_uid FROM auth.users LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE NOTICE 'no auth.users row to borrow: purge behaviour probe skipped (structure asserted above)';
  ELSE
    INSERT INTO public.oli_messages (user_id, role, body, created_at) VALUES (v_uid, 'user', 'probe 91d', now() - interval '91 days') RETURNING id INTO v_old;
    INSERT INTO public.oli_messages (user_id, role, body, created_at) VALUES (v_uid, 'user', 'probe 89d', now() - interval '89 days') RETURNING id INTO v_edge;
    INSERT INTO public.oli_messages (user_id, role, payload) VALUES (v_uid, 'oli', '{"v":1,"kind":"noMatch"}'::jsonb) RETURNING id INTO v_fresh;

    v_res := public.purge_oli_messages();

    SELECT count(*) INTO v_old_left   FROM public.oli_messages WHERE id = v_old;
    SELECT count(*) INTO v_edge_left  FROM public.oli_messages WHERE id = v_edge;
    SELECT count(*) INTO v_fresh_left FROM public.oli_messages WHERE id = v_fresh;
    -- v_res is not printed: on a re-run against a table holding real rows its 'deleted' would be a real-data count.
    RAISE NOTICE 'purge probe: 91-day row left=%, 89-day row left=%, fresh row left=%', v_old_left, v_edge_left, v_fresh_left;

    DELETE FROM public.oli_messages WHERE id IN (v_old, v_edge, v_fresh);

    IF v_old_left   IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'a 91-day-old row survived the purge'; END IF;
    IF v_edge_left  IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'positive control: an 89-day-old row was deleted (retention too aggressive)'; END IF;
    IF v_fresh_left IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'positive control: a fresh row was deleted'; END IF;
    IF EXISTS (SELECT 1 FROM public.oli_messages WHERE id IN (v_old, v_edge, v_fresh)) THEN
      RAISE EXCEPTION 'probe rows leaked into oli_messages';
    END IF;
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
VALUES ('20261163_oli_messages.sql', 'e608791a9ad77125b090e5dba67278c3e652e719ce51ccaed2294e5d029071e0')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   verify_schema QUERY 1: the 20261163_oli_messages rows must read OK; QUERY 2: purge-oli-messages.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   SELECT cron.unschedule('purge-oli-messages'); DROP TABLE public.oli_messages;
--   DROP FUNCTION public.purge_oli_messages(); DROP FUNCTION public.oli_messages_rate_guard();
--   (and delete its schema_migrations_applied row)

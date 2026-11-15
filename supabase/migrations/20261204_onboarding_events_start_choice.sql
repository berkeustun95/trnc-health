-- ═══════════════════════════════════════════════════════════════════════════
-- 20261204 — onboarding_events: count which choice is tapped on the Onboarding v2 Start screen
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The Start screen offers three ways in. Each tap becomes one counter row:
--
--   start_choice_signup    "Kayıt ol"                    (sign up)
--   start_choice_signin    "Giriş yap"                   (sign in)
--   start_choice_guest     "Misafir olarak devam et"     (continue as a guest)
--
-- The ONLY change: the event list grows from the 11 values of 20261202 to 14, in both places that
-- hold it (the CHECK constraint onboarding_events_event_check, same name, and the INSERT policy
-- oe_insert_public, same name and shape). No new column, no identifier, no grant change, no new
-- policy; the 90-day purge of 20261203 covers these rows like every other.
--
-- ─── WHO CAN READ / WRITE (unchanged from 20261202) ─────────────────────────
--   • INSERT: everyone — no session (anon), guests and signed-up users alike (a guest is an
--     anonymous session, which Postgres sees as `authenticated`, so the grant names both roles).
--     Only the three payload columns (event, platform, runtime_version); id and created_at are set
--     by the server. The INSERT policy repeats the CHECKs, now with the 14 events.
--   • READ / UPDATE / DELETE: no client, ever. No SELECT policy and no SELECT grant; UPDATE and
--     DELETE are pinned shut by policy AND have no grant. Reporting runs as postgres.
--
-- No counts, ids or e-mails anywhere: supabase-migrate prints this file to public Actions logs.
--
-- Apply: supabase-migrate (dry), then apply=true after Berke's go. Policy change => ends with NOTIFY pgrst.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.onboarding_events DROP CONSTRAINT IF EXISTS onboarding_events_event_check;
ALTER TABLE public.onboarding_events ADD  CONSTRAINT onboarding_events_event_check CHECK (event = ANY (ARRAY[
    'start_shown','offer_shown','offer_granted','offer_denied','offer_later',
    'reoffer_shown','reoffer_granted','reoffer_declined',
    'reoffer_existing_shown','reoffer_existing_granted','reoffer_existing_declined',
    'start_choice_signup','start_choice_signin','start_choice_guest']::text[]));

DROP POLICY IF EXISTS oe_insert_public ON public.onboarding_events;
CREATE POLICY oe_insert_public ON public.onboarding_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    event = ANY (ARRAY[
      'start_shown','offer_shown','offer_granted','offer_denied','offer_later',
      'reoffer_shown','reoffer_granted','reoffer_declined',
      'reoffer_existing_shown','reoffer_existing_granted','reoffer_existing_declined',
      'start_choice_signup','start_choice_signin','start_choice_guest']::text[])
    AND platform = ANY (ARRAY['ios','android']::text[])
    AND (runtime_version IS NULL OR length(runtime_version) <= 64)
  );

-- ─── Assertions. Each derives what it checks and prints what it read. ───────
-- The behaviour probes switch role with SET LOCAL ROLE inside a block that always ends in a
-- sentinel exception; the rollback of that block restores the role and the claims, so no bare
-- RESET ROLE is needed (which would drop back to the login role, not postgres).
DO $$
DECLARE
  v_e         regclass := to_regclass('public.onboarding_events');
  v_me        text := current_user;
  -- The full list, in one place: both the constraint and the policy must carry exactly this set.
  v_events    text[] := ARRAY[
    'start_shown','offer_shown','offer_granted','offer_denied','offer_later',
    'reoffer_shown','reoffer_granted','reoffer_declined',
    'reoffer_existing_shown','reoffer_existing_granted','reoffer_existing_declined',
    'start_choice_signup','start_choice_signin','start_choice_guest'];
  v_new       text[] := ARRAY['start_choice_signup','start_choice_signin','start_choice_guest'];
  v_want      text;
  v_got       text;
  v_n         int;
  v_names     text;
  v_cons      text;
  v_def       text;
  v_wc        text;
  v_ev        text;
  v_role      text;
  v_priv      text;
  v_pre       bigint;
  v_who       text;
  v_ins       text;
  v_old       text;
  v_read      text;
  v_upd       text;
  v_del       text;
  v_bad_ev    text;
  v_report    text := '';
BEGIN
  IF v_e IS NULL THEN
    RAISE EXCEPTION 'onboarding_events is not visible to this DO block (20261202 not applied?). Nothing committed.';
  END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_e) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RLS is not enabled on onboarding_events';
  END IF;

  -- The FULL policy set, derived and printed. RLS is permissive-OR: a fourth could only widen.
  SELECT count(*), coalesce(string_agg(policyname || ':' || cmd || ':' || permissive, ', ' ORDER BY policyname), '(none)')
    INTO v_n, v_names
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'onboarding_events';
  IF v_n IS DISTINCT FROM 3
     OR v_names IS DISTINCT FROM 'oe_insert_public:INSERT:PERMISSIVE, oe_no_delete:DELETE:PERMISSIVE, oe_no_update:UPDATE:PERMISSIVE' THEN
    RAISE EXCEPTION 'onboarding_events must carry exactly 3 policies (INSERT + no-UPDATE + no-DELETE); found %: %', v_n, v_names;
  END IF;
  IF (SELECT roles::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'onboarding_events' AND policyname = 'oe_insert_public')
     IS DISTINCT FROM '{anon,authenticated}' THEN
    RAISE EXCEPTION 'oe_insert_public is not TO anon, authenticated; roles are %',
      (SELECT roles::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'onboarding_events' AND policyname = 'oe_insert_public');
  END IF;

  -- The event SET, read back from both renderings and compared exactly (sorted): nothing missing,
  -- nothing extra. The policy also holds the two platform literals, so they join its expectation.
  SELECT string_agg(x, ',' ORDER BY x) INTO v_want FROM unnest(v_events) x;
  SELECT pg_get_constraintdef(c.oid) INTO v_def
    FROM pg_constraint c WHERE c.conrelid = v_e AND c.conname = 'onboarding_events_event_check';
  SELECT string_agg(m[1], ',' ORDER BY m[1]) INTO v_got FROM regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''::text', 'g') m;
  IF v_got IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION 'onboarding_events_event_check does not hold exactly the 14 events; definition is %', coalesce(v_def, '(missing)');
  END IF;
  SELECT with_check INTO v_wc FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'onboarding_events' AND policyname = 'oe_insert_public';
  SELECT string_agg(x, ',' ORDER BY x) INTO v_want FROM unnest(v_events || ARRAY['ios','android']) x;
  SELECT string_agg(m[1], ',' ORDER BY m[1]) INTO v_got FROM regexp_matches(coalesce(v_wc, ''), '''([a-z_]+)''::text', 'g') m;
  IF v_got IS DISTINCT FROM v_want THEN
    RAISE EXCEPTION 'oe_insert_public does not repeat exactly the 14 events + 2 platforms; WITH CHECK is %', coalesce(v_wc, '(none)');
  END IF;
  -- Named anchors beside the set check: the three new values, an old one, platform and runtime.
  FOREACH v_ev IN ARRAY v_new || ARRAY['reoffer_existing_declined'] LOOP
    IF v_def NOT LIKE '%''' || v_ev || '''%' OR v_wc NOT LIKE '%''' || v_ev || '''%' THEN
      RAISE EXCEPTION 'event % missing from the constraint or the policy', v_ev;
    END IF;
  END LOOP;
  -- Shape: the event list is the policy's FIRST AND-conjunct, so no OR in front of it can widen it.
  IF v_wc NOT LIKE '((event = ANY (ARRAY[%])) AND (platform = ANY (ARRAY[%'
     OR v_wc NOT LIKE '%''android''%' OR v_wc NOT LIKE '%length(runtime_version) <= 64%' THEN
    RAISE EXCEPTION 'oe_insert_public is not event-list AND platform AND runtime (an OR can widen it); WITH CHECK is %', v_wc;
  END IF;

  -- Primary key + three CHECKs; NOT NULL rows filtered out (PG 17+ gives them their own rows).
  SELECT count(*), coalesce(string_agg(conname || ':' || contype::text, ', ' ORDER BY conname), '(none)')
    INTO v_n, v_cons
    FROM pg_constraint WHERE conrelid = v_e AND contype IN ('p','c');
  IF v_n IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'onboarding_events must carry exactly 4 pkey/check constraints; found %: %', v_n, v_cons;
  END IF;

  -- Privileges, both directions (unchanged by this file; re-asserted). has_*_privilege resolves inherited grants.
  IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = v_e AND a.grantee = 0) THEN
    RAISE EXCEPTION 'PUBLIC holds a privilege on onboarding_events';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege(v_role, v_e, v_priv) THEN
        RAISE EXCEPTION '% holds % on onboarding_events', v_role, v_priv;
      END IF;
    END LOOP;
    IF has_any_column_privilege(v_role, v_e, 'SELECT') OR has_any_column_privilege(v_role, v_e, 'UPDATE') THEN
      RAISE EXCEPTION '% holds a column-level SELECT or UPDATE on onboarding_events', v_role;
    END IF;
    IF NOT has_column_privilege(v_role, v_e, 'event', 'INSERT')
       OR NOT has_column_privilege(v_role, v_e, 'platform', 'INSERT')
       OR NOT has_column_privilege(v_role, v_e, 'runtime_version', 'INSERT') THEN
      RAISE EXCEPTION '% cannot INSERT a payload column — every event would be dropped silently', v_role;
    END IF;
    IF has_column_privilege(v_role, v_e, 'id', 'INSERT') OR has_column_privilege(v_role, v_e, 'created_at', 'INSERT') THEN
      RAISE EXCEPTION '% can write id/created_at on onboarding_events — a client could backdate a row', v_role;
    END IF;
  END LOOP;

  -- BEHAVIOUR, per caller: no session (anon), a guest, a signed-up user. Count compared before and
  -- after (never printed), so a re-apply on a table holding real events is still correct.
  SELECT count(*) INTO v_pre FROM public.onboarding_events;
  FOREACH v_who IN ARRAY ARRAY['anon','guest','user'] LOOP
    v_ins := ''; v_old := 'unset'; v_read := 'unset'; v_upd := 'unset'; v_del := 'unset'; v_bad_ev := 'unset';
    BEGIN
      IF v_who = 'anon' THEN
        SET LOCAL ROLE anon;
        PERFORM set_config('request.jwt.claims', '', true);
      ELSE
        SET LOCAL ROLE authenticated;
        PERFORM set_config('request.jwt.claims',
          json_build_object('sub', '00000000-0000-4000-8000-000000001204', 'role', 'authenticated',
                            'is_anonymous', v_who = 'guest')::text, true);
      END IF;

      FOREACH v_ev IN ARRAY v_new LOOP
        BEGIN
          INSERT INTO public.onboarding_events (event, platform, runtime_version) VALUES (v_ev, 'android', '1.4.2');
          v_ins := v_ins || v_ev || ' allowed;';
        EXCEPTION WHEN OTHERS THEN v_ins := v_ins || v_ev || ' DENIED ' || SQLSTATE || ';';
        END;
      END LOOP;
      -- POSITIVE CONTROL for the rewrite: an event from the original list still goes in.
      BEGIN
        INSERT INTO public.onboarding_events (event, platform) VALUES ('reoffer_existing_declined', 'ios');
        v_old := 'allowed';
      EXCEPTION WHEN OTHERS THEN v_old := 'DENIED ' || SQLSTATE;
      END;
      BEGIN
        PERFORM 1 FROM public.onboarding_events LIMIT 1;
        v_read := 'READABLE';
      EXCEPTION WHEN insufficient_privilege THEN v_read := 'denied';
      END;
      BEGIN
        UPDATE public.onboarding_events SET event = 'start_shown' WHERE true;
        v_upd := 'ALLOWED';
      EXCEPTION WHEN insufficient_privilege THEN v_upd := 'denied';
      END;
      BEGIN
        DELETE FROM public.onboarding_events WHERE true;
        v_del := 'ALLOWED';
      EXCEPTION WHEN insufficient_privilege THEN v_del := 'denied';
      END;
      BEGIN
        INSERT INTO public.onboarding_events (event, platform) VALUES ('nonsense', 'ios');
        v_bad_ev := 'ACCEPTED';
      EXCEPTION WHEN check_violation OR insufficient_privilege THEN v_bad_ev := 'rejected';
      END;

      RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
    END;

    IF current_user IS DISTINCT FROM v_me THEN
      RAISE EXCEPTION 'the probe did not restore the role (now %, expected %)', current_user, v_me;
    END IF;
    v_report := v_report || format(' [%s: new events %s old event %s, select %s, update %s, delete %s, bad event %s]',
                                   v_who, v_ins, v_old, v_read, v_upd, v_del, v_bad_ev);
    -- POSITIVE CONTROLS FIRST: without them the denials below score full marks on a table nobody can write.
    IF v_ins IS DISTINCT FROM 'start_choice_signup allowed;start_choice_signin allowed;start_choice_guest allowed;'
       OR v_old IS DISTINCT FROM 'allowed'
       OR v_read IS DISTINCT FROM 'denied' OR v_upd IS DISTINCT FROM 'denied' OR v_del IS DISTINCT FROM 'denied'
       OR v_bad_ev IS DISTINCT FROM 'rejected' THEN
      RAISE EXCEPTION 'onboarding_events behaved wrongly:%', v_report;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM public.onboarding_events) IS DISTINCT FROM v_pre THEN
    RAISE EXCEPTION 'onboarding_events probe rows survived the rollback';
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
VALUES ('20261204_onboarding_events_start_choice.sql', '0338f3daee79b884fbd6f6aab339651ac17b9415c1657c0360abfb08b187d437')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';

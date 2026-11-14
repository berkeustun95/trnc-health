-- ═══════════════════════════════════════════════════════════════════════════
-- 20261202 — onboarding_events: did the onboarding notification offer appear, and what was answered?
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Onboarding v2 (slice S1, backend only). One row each time the app shows the start screen or a
-- notification offer, and one for each answer. Modelled on app_update_events (20261051): a COUNTER,
-- not a log of people.
--
--   start_shown                                      the onboarding start screen appeared
--   offer_shown / offer_granted / offer_denied / offer_later
--                                                    the first notification offer and its three answers
--   reoffer_shown / reoffer_granted / reoffer_declined
--                                                    the one re-offer after "Şimdi değil"
--   reoffer_existing_shown / _granted / _declined    EXISTING users with notifications off get one
--                                                    second offer after closing a duty-pharmacy list;
--                                                    counted apart from the "Şimdi değil" re-offer
--
-- NO IDENTIFIER COLUMN: no user, device, session or token column. That alone does not stop rows
-- being linked: runtime_version is free client text (up to 64 characters) and created_at is
-- precise, so reports should aggregate by day and never list single rows.
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   • INSERT: everyone — no session (anon), guests and signed-up users alike (a guest is an
--     anonymous session, which Postgres sees as `authenticated`, so the grant names both roles).
--     Only the three payload columns (event, platform, runtime_version); id and created_at are set
--     by the server, so a client cannot backdate a row. The INSERT policy repeats the CHECKs.
--   • READ / UPDATE / DELETE: no client, ever. No SELECT policy and no SELECT grant; UPDATE and
--     DELETE are pinned shut by policy AND have no grant. Reporting runs as postgres.
--     (A client insert must not ask for the row back: `returning` needs SELECT.)
--
-- No index on created_at: 20261051's index served its purge job, and retention for this table is
-- out of scope for this file. No retention cron here.
--
-- No counts, ids or e-mails anywhere: supabase-migrate prints this file to public Actions logs.
--
-- Apply: supabase-migrate (dry), then apply=true after Berke's go. New table => ends with NOTIFY pgrst.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.onboarding_events (
  id               bigint      GENERATED ALWAYS AS IDENTITY,
  event            text        NOT NULL,
  platform         text        NOT NULL,
  runtime_version  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_events_pkey PRIMARY KEY (id),
  CONSTRAINT onboarding_events_event_check CHECK (event = ANY (ARRAY[
    'start_shown','offer_shown','offer_granted','offer_denied','offer_later',
    'reoffer_shown','reoffer_granted','reoffer_declined',
    'reoffer_existing_shown','reoffer_existing_granted','reoffer_existing_declined']::text[])),
  CONSTRAINT onboarding_events_platform_check CHECK (platform = ANY (ARRAY['ios','android']::text[])),
  CONSTRAINT onboarding_events_runtime_len_check CHECK (runtime_version IS NULL OR length(runtime_version) <= 64)
);

COMMENT ON TABLE public.onboarding_events IS
  'Onboarding v2: one row per start screen / notification offer shown and per answer. No identifiers of any '
  'kind — counts only. Clients may INSERT event, platform, runtime_version; no client reads. 20261202.';

ALTER TABLE public.onboarding_events ENABLE ROW LEVEL SECURITY;

-- Supabase's default privileges hand anon and authenticated ALL on a new table in `public`; the
-- REVOKE is what closes it. The INSERT grant is column-level.
REVOKE ALL ON public.onboarding_events FROM anon, authenticated;
GRANT INSERT (event, platform, runtime_version) ON public.onboarding_events TO anon, authenticated;

DROP POLICY IF EXISTS oe_insert_public ON public.onboarding_events;
CREATE POLICY oe_insert_public ON public.onboarding_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    event = ANY (ARRAY[
      'start_shown','offer_shown','offer_granted','offer_denied','offer_later',
      'reoffer_shown','reoffer_granted','reoffer_declined',
      'reoffer_existing_shown','reoffer_existing_granted','reoffer_existing_declined']::text[])
    AND platform = ANY (ARRAY['ios','android']::text[])
    AND (runtime_version IS NULL OR length(runtime_version) <= 64)
  );

DROP POLICY IF EXISTS oe_no_update ON public.onboarding_events;
CREATE POLICY oe_no_update ON public.onboarding_events
  FOR UPDATE TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS oe_no_delete ON public.onboarding_events;
CREATE POLICY oe_no_delete ON public.onboarding_events
  FOR DELETE TO anon, authenticated
  USING (false);

-- ─── Assertions. Each derives what it checks and prints what it read. ───────
-- The behaviour probes switch role with SET LOCAL ROLE inside a block that always ends in a
-- sentinel exception; the rollback of that block restores the role and the claims, so no bare
-- RESET ROLE is needed (which would drop back to the login role, not postgres).
DO $$
DECLARE
  v_e         regclass := to_regclass('public.onboarding_events');
  v_me        text := current_user;
  v_n         int;
  v_names     text;
  v_cons      text;
  v_role      text;
  v_priv      text;
  v_pre       bigint;
  v_who       text;
  v_ins       text;
  v_read      text;
  v_upd       text;
  v_del       text;
  v_bad_ev    text;
  v_bad_pf    text;
  v_long      text;
  v_id        text;
  v_ts        text;
  v_report    text := '';
BEGIN
  IF v_e IS NULL THEN
    RAISE EXCEPTION 'onboarding_events is not visible to this DO block. Nothing committed; re-run the file as one paste.';
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
  -- The INSERT policy repeats the CHECKs (a WITH CHECK (true) would lean on the constraints alone).
  SELECT with_check INTO v_names FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'onboarding_events' AND policyname = 'oe_insert_public';
  IF coalesce(v_names, '') NOT LIKE '%reoffer_existing_declined%' OR v_names NOT LIKE '%''android''%'
     OR v_names NOT LIKE '%length(runtime_version) <= 64%' THEN
    RAISE EXCEPTION 'oe_insert_public does not repeat the event / platform / runtime checks; WITH CHECK is %', coalesce(v_names, '(none)');
  END IF;

  -- Primary key + three CHECKs; NOT NULL rows filtered out (PG 17+ gives them their own rows).
  SELECT count(*), coalesce(string_agg(conname || ':' || contype::text, ', ' ORDER BY conname), '(none)')
    INTO v_n, v_cons
    FROM pg_constraint WHERE conrelid = v_e AND contype IN ('p','c');
  IF v_n IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'onboarding_events must carry exactly 4 pkey/check constraints; found %: %', v_n, v_cons;
  END IF;

  -- Privileges, both directions. has_*_privilege resolves inherited grants.
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
    v_ins := 'unset'; v_read := 'unset'; v_upd := 'unset'; v_del := 'unset';
    v_bad_ev := 'unset'; v_bad_pf := 'unset'; v_long := 'unset'; v_id := 'unset'; v_ts := 'unset';
    BEGIN
      IF v_who = 'anon' THEN
        SET LOCAL ROLE anon;
        PERFORM set_config('request.jwt.claims', '', true);
      ELSE
        SET LOCAL ROLE authenticated;
        PERFORM set_config('request.jwt.claims',
          json_build_object('sub', '00000000-0000-4000-8000-000000001202', 'role', 'authenticated',
                            'is_anonymous', v_who = 'guest')::text, true);
      END IF;

      BEGIN
        INSERT INTO public.onboarding_events (event, platform, runtime_version) VALUES ('offer_shown', 'android', '1.4.2');
        v_ins := 'allowed';
      EXCEPTION WHEN OTHERS THEN v_ins := 'DENIED ' || SQLSTATE;
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
      BEGIN
        INSERT INTO public.onboarding_events (event, platform) VALUES ('offer_shown', 'web');
        v_bad_pf := 'ACCEPTED';
      EXCEPTION WHEN check_violation OR insufficient_privilege THEN v_bad_pf := 'rejected';
      END;
      BEGIN
        INSERT INTO public.onboarding_events (event, platform, runtime_version) VALUES ('offer_shown', 'ios', repeat('9', 65));
        v_long := 'ACCEPTED';
      EXCEPTION WHEN check_violation OR insufficient_privilege THEN v_long := 'rejected';
      END;
      BEGIN
        INSERT INTO public.onboarding_events (id, event, platform) OVERRIDING SYSTEM VALUE VALUES (-1, 'offer_shown', 'ios');
        v_id := 'ACCEPTED';
      EXCEPTION WHEN insufficient_privilege THEN v_id := 'denied';
      END;
      BEGIN
        INSERT INTO public.onboarding_events (event, platform, created_at) VALUES ('offer_shown', 'ios', now() - interval '1 year');
        v_ts := 'ACCEPTED';
      EXCEPTION WHEN insufficient_privilege THEN v_ts := 'denied';
      END;

      RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
    END;

    IF current_user IS DISTINCT FROM v_me THEN
      RAISE EXCEPTION 'the probe did not restore the role (now %, expected %)', current_user, v_me;
    END IF;
    v_report := v_report || format(' [%s: insert %s, select %s, update %s, delete %s, bad event %s, bad platform %s, long runtime %s, id %s, created_at %s]',
                                   v_who, v_ins, v_read, v_upd, v_del, v_bad_ev, v_bad_pf, v_long, v_id, v_ts);
    -- POSITIVE CONTROL FIRST: without it the denials below score full marks on a table nobody can write.
    IF v_ins IS DISTINCT FROM 'allowed' OR v_read IS DISTINCT FROM 'denied' OR v_upd IS DISTINCT FROM 'denied'
       OR v_del IS DISTINCT FROM 'denied' OR v_bad_ev IS DISTINCT FROM 'rejected' OR v_bad_pf IS DISTINCT FROM 'rejected'
       OR v_long IS DISTINCT FROM 'rejected' OR v_id IS DISTINCT FROM 'denied' OR v_ts IS DISTINCT FROM 'denied' THEN
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
VALUES ('20261202_onboarding_events.sql', 'db7978846e92c7b89082ed8f124a0fd315f31974e5aefd252460d652e32ecd9a')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';

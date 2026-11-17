-- ═══════════════════════════════════════════════════════════════════════════
-- 20261217 — admin_push_sends: the send-once ledger of the admin-push edge function
-- ═══════════════════════════════════════════════════════════════════════════
--
-- admin-push sends the admin's two many-recipient pushes (duty swap, Broadcast tab) from the server. The app sends a
-- client-made request id with every call; the function inserts it here BEFORE it reads or writes any recipient. A
-- second call with the same id hits the primary key (23505) and sends nothing, and a claim that cannot be written
-- sends nothing. A crash after the claim means that id never sends again: a missed push is recoverable, a double push
-- to everyone is not. The function updates the row at the end with counts and the outcome.
--
-- Kept apart from duty_push_runs on purpose: the duty-push send-once watch reads duty_push_runs only.
--
-- WHAT IS RECORDED: the request id, the kind ('duty_swap' / 'broadcast'), whether it was a test-mode send, the admin's
-- id (admin_id has NO foreign key: an FK on auth.users / profiles would break account deletion), times, the outcome,
-- counts and error_kinds (counts by Expo error code). NO title, NO body, NO pharmacy name, NO push token.
--
-- WHO CAN READ / WRITE WHAT, IN PLAIN ENGLISH
--   Nobody but the service role. RLS is ON, there are ZERO policies, and every privilege is revoked from PUBLIC, anon
--   and authenticated (guests, customers, providers and admins-in-the-app included). The service role (the edge
--   function; it bypasses RLS) may select, insert, update and delete. An admin in the app cannot read this table.
--
-- Apply: supabase-migrate. Adds one table; no function is added, so the notification-writer count is unchanged (the
-- edge function writes notifications through the service client, not through SQL).

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.admin_push_sends (
  request_id     uuid        NOT NULL,
  kind           text        NOT NULL,
  test           boolean     NOT NULL,
  admin_id       uuid        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  outcome        text        NOT NULL DEFAULT 'running',
  recipients     int,
  notified       int,
  push_attempted int,
  push_ok        int,
  push_errors    int,
  error_kinds    jsonb,
  CONSTRAINT admin_push_sends_pkey PRIMARY KEY (request_id),
  CONSTRAINT admin_push_sends_kind_check CHECK (kind = ANY (ARRAY['duty_swap','broadcast']::text[])),
  CONSTRAINT admin_push_sends_error_kinds_check CHECK (error_kinds IS NULL OR jsonb_typeof(error_kinds) = 'object')
);

COMMENT ON TABLE public.admin_push_sends IS
  'Send-once ledger of the admin-push edge function: one row per client request id, claimed before any recipient is read or written. Counts only: no text, no token. RLS on, zero policies: service_role only. admin_id has no foreign key on purpose (account deletion). 20261217.';

ALTER TABLE public.admin_push_sends ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_push_sends FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_push_sends TO service_role;

DO $$
DECLARE
  v_t        regclass := to_regclass('public.admin_push_sends');
  v_n        int;
  v_names    text;
  v_role     text;
  v_priv     text;
  v_anon_ins text := 'unset';
  v_auth_sel text := 'unset';
  v_dup      text := 'unset';
  v_bad_kind text := 'unset';
  v_svc_rows int  := -1;
  v_before   int;
  v_id       uuid := gen_random_uuid();
BEGIN
  IF v_t IS NULL THEN RAISE EXCEPTION 'admin_push_sends is not visible to this block'; END IF;
  IF (SELECT relowner::regrole::text FROM pg_class WHERE oid = v_t) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'admin_push_sends is owned by %, expected postgres (SET ROLE postgres missing?)', (SELECT relowner::regrole::text FROM pg_class WHERE oid = v_t);
  END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_t) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RLS is not enabled on admin_push_sends';
  END IF;

  SELECT count(*), coalesce(string_agg(policyname || ':' || cmd, ', ' ORDER BY policyname), '(none)')
    INTO v_n, v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = 'admin_push_sends';
  RAISE NOTICE 'admin_push_sends policies: % (%)', v_n, v_names;
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'admin_push_sends must carry ZERO policies; found %: %', v_n, v_names;
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(v_role, v_t, v_priv) THEN
        RAISE EXCEPTION '% holds % on admin_push_sends', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_t AND a.attnum > 0 AND NOT a.attisdropped
              AND (has_column_privilege('anon', v_t, a.attnum, 'SELECT,INSERT,UPDATE,REFERENCES')
                OR has_column_privilege('authenticated', v_t, a.attnum, 'SELECT,INSERT,UPDATE,REFERENCES'))) THEN
    RAISE EXCEPTION 'a column of admin_push_sends is reachable by anon or authenticated';
  END IF;
  -- positive control for the denials above: the role the function runs as keeps its access
  FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
    IF NOT has_table_privilege('service_role', v_t, v_priv) THEN
      RAISE EXCEPTION 'service_role lost % on admin_push_sends: the function could not claim', v_priv;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_before FROM public.admin_push_sends;

  BEGIN
    SET LOCAL ROLE service_role;
    INSERT INTO public.admin_push_sends (request_id, kind, test, admin_id) VALUES (v_id, 'duty_swap', true, gen_random_uuid());
    UPDATE public.admin_push_sends SET outcome = 'sent', finished_at = now(), recipients = 2, notified = 2,
           push_attempted = 2, push_ok = 1, push_errors = 1, error_kinds = '{"DeviceNotRegistered":1}'::jsonb
     WHERE request_id = v_id;
    SELECT count(*) INTO v_svc_rows FROM public.admin_push_sends WHERE request_id = v_id AND outcome = 'sent';
    BEGIN
      INSERT INTO public.admin_push_sends (request_id, kind, test, admin_id) VALUES (v_id, 'broadcast', false, gen_random_uuid());
      v_dup := 'ACCEPTED';
    EXCEPTION WHEN unique_violation THEN v_dup := 'rejected';
    END;
    BEGIN
      INSERT INTO public.admin_push_sends (request_id, kind, test, admin_id) VALUES (gen_random_uuid(), 'banana', false, gen_random_uuid());
      v_bad_kind := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_kind := 'rejected';
    END;
    RESET ROLE;

    SET LOCAL ROLE anon;
    BEGIN
      INSERT INTO public.admin_push_sends (request_id, kind, test, admin_id) VALUES (gen_random_uuid(), 'broadcast', false, gen_random_uuid());
      v_anon_ins := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_anon_ins := 'denied';
    END;
    RESET ROLE;

    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM 1 FROM public.admin_push_sends LIMIT 1;
      v_auth_sel := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_auth_sel := 'denied';
    END;
    RESET ROLE;

    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;
  RESET ROLE;

  IF v_svc_rows  IS DISTINCT FROM 1        THEN RAISE EXCEPTION 'service_role insert+update+select returned % rows, expected 1', v_svc_rows; END IF;
  IF v_dup       IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'a repeated request_id was %: the send-once claim does not hold', v_dup; END IF;
  IF v_bad_kind  IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'kind ''banana'' was %', v_bad_kind; END IF;
  IF v_anon_ins  IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'anon INSERT into admin_push_sends was %', v_anon_ins; END IF;
  IF v_auth_sel  IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'authenticated SELECT on admin_push_sends was %', v_auth_sel; END IF;
  IF (SELECT count(*) FROM public.admin_push_sends) IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'probe rows leaked into admin_push_sends';
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
VALUES ('20261217_admin_push_sends.sql', '0df2370c53723ce814a80f1d8f80b6dec04eeef9667b315454195f2a1daf187b')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

NOTIFY pgrst, 'reload schema';

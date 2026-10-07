-- ─── 20261088 — clients may mark a notification read, and nothing else ─────────
--
-- 20261087 added notifications.conversation_id. Read live on 2026-10-06
-- (supabase/probe_notifications_grants.sql): anon and authenticated held Supabase's default
-- table-level ALL on notifications, so a signed-in user could write conversation_id (and
-- title, body, type …) on their own rows. Only notify_new_message — SECURITY DEFINER, owned
-- by postgres — may set conversation_id.
--
-- ─── THE CHANGE: COLUMN PRIVILEGES, NOT A TRIGGER ────────────────────────────
--   REVOKE INSERT, UPDATE ON notifications FROM anon, authenticated
--   GRANT  UPDATE (read)  ON notifications TO authenticated
--
-- A column-level UPDATE grant does nothing while a table-level one exists, so the table
-- grant goes first. No trigger: 20261087's ON DELETE SET NULL is safe precisely because
-- notifications has none (an UPDATE trigger would see the SET NULL), and verify_schema
-- asserts that.
--
-- What each role can do afterwards (RLS unchanged):
--   • authenticated (signed-in users, and guests — but the RESTRICTIVE no_anon_* policies
--     already refuse guests every write): SELECT own rows · UPDATE only `read` on own rows
--     (App.js: mark one / mark all read) · DELETE own rows (Clear all). No INSERT — which
--     changes nothing: the permissive INSERT policy is WITH CHECK (false), so no client
--     insert has ever succeeded.
--   • anon (no session): SELECT/DELETE grants stay but RLS matches no row (auth.uid() NULL).
--   • service_role (send-duty-notification inserts): untouched.
--   • The six SECURITY DEFINER writers (insert_notification, notify_facility_owner,
--     notify_new_message, notify_admins, notify_module_waitlist, process_featured_expiring)
--     run as their owner, postgres, which owns the table: untouched.

SET ROLE postgres;

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.notifications') IS NULL OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'conversation_id') THEN
    RAISE EXCEPTION 'REFUSING: notifications.conversation_id missing — apply 20261087 first. Nothing applied.';
  END IF;
  IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.notifications'::regclass)) IS DISTINCT FROM 'postgres'
     OR pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.notify_new_message(uuid)'::regprocedure)) IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'REFUSING: notifications / notify_new_message are not owned by postgres; the definer reasoning above does not hold. Nothing applied.';
  END IF;
END $$;

REVOKE INSERT, UPDATE ON public.notifications FROM anon, authenticated;
GRANT UPDATE (read) ON public.notifications TO authenticated;

-- ─── Assertions ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_col record; v_bad text := '';
  v_conv uuid; v_init uuid; v_recp uuid; v_probe uuid := '00000000-0000-4000-8000-000000010880';
  v_leg text := 'setup'; v_n int;
  r_read text := 'unset'; r_conv text := 'unset'; r_title text := 'unset'; r_ins text := 'unset'; r_role text;
  a_users int; a_profiles int; a_convs int; a_msgs int; a_notifs int;
  b_users int; b_profiles int; b_convs int; b_msgs int; b_notifs int;
  r_a_row text := 'unset'; r_a_conv text := 'unset'; r_b_row text := 'unset';
BEGIN
  -- (a) The catalog, derived over every column: authenticated may UPDATE `read` and nothing
  --     else; neither client role may INSERT or UPDATE any column.
  FOR v_col IN SELECT attname FROM pg_attribute
                WHERE attrelid = 'public.notifications'::regclass AND attnum > 0 AND NOT attisdropped LOOP
    IF has_column_privilege('anon', 'public.notifications', v_col.attname, 'INSERT')
       OR has_column_privilege('anon', 'public.notifications', v_col.attname, 'UPDATE')
       OR has_column_privilege('authenticated', 'public.notifications', v_col.attname, 'INSERT')
       OR (has_column_privilege('authenticated', 'public.notifications', v_col.attname, 'UPDATE')
           IS DISTINCT FROM (v_col.attname = 'read')) THEN
      v_bad := v_bad || v_col.attname || ' ';
    END IF;
  END LOOP;
  IF v_bad <> '' THEN RAISE EXCEPTION 'client column privileges wrong on: %', v_bad; END IF;
  -- Positive controls: the paths that must keep working.
  IF NOT (has_table_privilege('authenticated', 'public.notifications', 'SELECT')
      AND has_table_privilege('authenticated', 'public.notifications', 'DELETE')
      AND has_table_privilege('service_role', 'public.notifications', 'INSERT')
      AND has_table_privilege('service_role', 'public.notifications', 'UPDATE')) THEN
    RAISE EXCEPTION 'a legitimate path lost its grant (authenticated SELECT/DELETE or service_role INSERT/UPDATE)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.notifications'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'notifications has triggers; 20261087''s SET NULL premise no longer holds';
  END IF;
  -- The FULL policy set on the table (unchanged by this file; a grant change is only as good as
  -- the RLS beside it). Six, read live 2026-10-06. Note: no PERMISSIVE DELETE policy exists, so a
  -- client delete matches no row — pre-existing, outside this file.
  SELECT string_agg(policyname || ' ' || permissive || ' ' || cmd, ' | ' ORDER BY policyname), count(*)
    INTO v_bad, v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications';
  IF v_n IS DISTINCT FROM 6 THEN RAISE EXCEPTION 'notifications has % policies, expected 6: %', v_n, v_bad; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications'
              AND permissive = 'PERMISSIVE' AND cmd IN ('INSERT', 'ALL') AND with_check IS DISTINCT FROM 'false') THEN
    RAISE EXCEPTION 'a permissive INSERT policy other than WITH CHECK (false) exists: %', v_bad;
  END IF;
  v_bad := '';

  SELECT id, initiator_id, recipient_id INTO v_conv, v_init, v_recp FROM public.conversations
   WHERE initiator_id IS NOT NULL AND recipient_id IS NOT NULL ORDER BY created_at LIMIT 1;
  IF v_conv IS NULL THEN RAISE EXCEPTION 'no conversation with both participants to test with'; END IF;
  SELECT (SELECT count(*) FROM auth.users), (SELECT count(*) FROM public.profiles), (SELECT count(*) FROM public.conversations),
         (SELECT count(*) FROM public.messages), (SELECT count(*) FROM public.notifications)
    INTO b_users, b_profiles, b_convs, b_msgs, b_notifs;

  -- (b) Behaviour, as a real signed-in participant, and (c) the deletion test again — all in
  --     one subtransaction, rolled back by a sentinel. Local variables survive the rollback.
  BEGIN
    v_leg := 'probe row';
    INSERT INTO public.notifications (id, user_id, title, body, type, conversation_id)
    VALUES (v_probe, v_recp, '20261088 probe', '20261088 probe', 'message', NULL);

    v_leg := 'client writes as the row owner';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_recp, 'role', 'authenticated', 'is_anonymous', false)::text, true);
    SET LOCAL ROLE authenticated;
    r_role := current_user;
    -- Positive control: marking read still works on one's own row …
    UPDATE public.notifications SET read = true WHERE id = v_probe;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    r_read := CASE WHEN v_n = 1 THEN 'updated' ELSE v_n || ' rows' END;
    -- … conversation_id is refused …
    BEGIN
      UPDATE public.notifications SET conversation_id = v_conv WHERE id = v_probe;
      r_conv := 'ACCEPTED';
    EXCEPTION WHEN insufficient_privilege THEN r_conv := 'refused';
    END;
    -- … so is any other column …
    BEGIN
      UPDATE public.notifications SET title = 'x' WHERE id = v_probe;
      r_title := 'ACCEPTED';
    EXCEPTION WHEN insufficient_privilege THEN r_title := 'refused';
    END;
    -- … and so is an insert carrying a thread.
    BEGIN
      INSERT INTO public.notifications (user_id, title, body, type, conversation_id)
      VALUES (v_recp, 'x', 'x', 'message', v_conv);
      r_ins := 'ACCEPTED';
    EXCEPTION WHEN insufficient_privilege THEN r_ins := 'refused';
    END;
    SET LOCAL ROLE postgres;
    PERFORM set_config('request.jwt.claims', '', true);
    -- Owner path (what notify_new_message runs as) can still set it; the deletion legs need it.
    UPDATE public.notifications SET conversation_id = v_conv WHERE id = v_probe;

    v_leg := 'A: delete_own_account as the initiator';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_init, 'role', 'authenticated')::text, true);
    PERFORM public.delete_own_account();
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT CASE WHEN conversation_id IS NOT DISTINCT FROM v_conv THEN 'kept, id intact'
                ELSE 'kept, id = ' || coalesce(conversation_id::text, 'NULL') END
      INTO r_a_row FROM public.notifications WHERE id = v_probe;
    r_a_conv := CASE WHEN EXISTS (SELECT 1 FROM public.conversations WHERE id = v_conv) THEN 'kept' ELSE 'GONE' END;

    v_leg := 'B: DELETE FROM conversations';
    DELETE FROM public.conversations WHERE id = v_conv;
    SELECT CASE WHEN conversation_id IS NULL THEN 'kept, id NULL' ELSE 'kept, id = ' || conversation_id::text END
      INTO r_b_row FROM public.notifications WHERE id = v_probe;

    RAISE EXCEPTION 'sentinel' USING ERRCODE = 'ZX088';
  EXCEPTION
    WHEN SQLSTATE 'ZX088' THEN NULL;
    WHEN OTHERS THEN
      RAISE EXCEPTION '20261088 test, leg [%]: % (SQLSTATE %)', v_leg, SQLERRM, SQLSTATE;
  END;
  SET LOCAL ROLE postgres;
  PERFORM set_config('request.jwt.claims', '', true);

  IF r_role IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'client leg ran as %, not authenticated', r_role; END IF;
  IF r_read  IS DISTINCT FROM 'updated' THEN RAISE EXCEPTION 'marking read as the owner: %', r_read; END IF;
  IF r_conv  IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'a client UPDATE of conversation_id was %', r_conv; END IF;
  IF r_title IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'a client UPDATE of title was %', r_title; END IF;
  IF r_ins   IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'a client INSERT was %', r_ins; END IF;
  IF r_a_row IS DISTINCT FROM 'kept, id intact' THEN RAISE EXCEPTION 'leg A: the other participant''s notification was %', coalesce(r_a_row, 'DELETED'); END IF;
  IF r_a_conv IS DISTINCT FROM 'kept' THEN RAISE EXCEPTION 'leg A: the conversation was %', r_a_conv; END IF;
  IF r_b_row IS DISTINCT FROM 'kept, id NULL' THEN RAISE EXCEPTION 'leg B: after the conversation delete the notification was %', coalesce(r_b_row, 'DELETED'); END IF;

  SELECT (SELECT count(*) FROM auth.users), (SELECT count(*) FROM public.profiles), (SELECT count(*) FROM public.conversations),
         (SELECT count(*) FROM public.messages), (SELECT count(*) FROM public.notifications)
    INTO a_users, a_profiles, a_convs, a_msgs, a_notifs;
  IF (a_users, a_profiles, a_convs, a_msgs, a_notifs) IS DISTINCT FROM (b_users, b_profiles, b_convs, b_msgs, b_notifs) THEN
    RAISE EXCEPTION 'test did not roll back: users %->% profiles %->% convs %->% msgs %->% notifs %->%',
      b_users, a_users, b_profiles, a_profiles, b_convs, a_convs, b_msgs, a_msgs, b_notifs, a_notifs;
  END IF;
  IF EXISTS (SELECT 1 FROM public.notifications WHERE id = v_probe) THEN RAISE EXCEPTION 'probe row survived the rollback'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_init) THEN RAISE EXCEPTION 'the test account is gone after the rollback'; END IF;
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
VALUES ('20261088_notifications_lock_client_writes.sql', 'b4ae3960489db005519c44d95107992c37a5b96bf433ba0b66c03f9fc4ff1546')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;
NOTIFY pgrst, 'reload schema';

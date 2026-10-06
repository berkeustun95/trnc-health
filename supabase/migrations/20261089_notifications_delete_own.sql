-- ─── 20261089 — a signed-in user can delete their own notifications ─────────────
--
-- THE DEFECT. notifications has had a DELETE grant for authenticated all along, but no
-- PERMISSIVE DELETE policy — only the RESTRICTIVE no_anon_delete_notifications (read live
-- 2026-10-06, supabase/probe_notifications_grants.sql). RLS with no permissive policy for a
-- command matches no row, and a DELETE that matches no row is not an error: PostgREST returns
-- success. So "Clear all" in the app emptied the list on screen and every row came back on
-- the next load. The client now checks the outcome too (App.js clearAllNotifs).
--
-- THE POLICY, IN PLAIN ENGLISH:
--   "users delete own notifications" — PERMISSIVE, FOR DELETE, TO authenticated,
--   USING (user_id = auth.uid()).
--   • A signed-in user can delete their own notification rows, and no one else's.
--   • A guest (anonymous sign-in) still cannot: the RESTRICTIVE no_anon_delete_notifications
--     ANDs NOT is_anonymous_session() onto it. Guests never get rows anyway (no push token,
--     no writer targets them), so nothing they could see is lost.
--   • anon (no session): not in the TO list, and auth.uid() is NULL.
--   • Nothing else changes: SELECT own rows, UPDATE (read) only (20261088), no client INSERT.
--
-- NO TRIGGER. 20261087's ON DELETE SET NULL is safe because notifications has none; a
-- policy keeps that true. Nothing references notifications, so deleting a row cascades nowhere.

SET ROLE postgres;

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261088_notifications_lock_client_writes.sql') THEN
    RAISE EXCEPTION 'REFUSING: 20261088 is not recorded as applied; this file assumes its grants. Nothing applied.';
  END IF;
END $$;

DROP POLICY IF EXISTS "users delete own notifications" ON public.notifications;
CREATE POLICY "users delete own notifications" ON public.notifications
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ─── Assertions ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_list text; v_n int;
  v_conv uuid; v_init uuid; v_recp uuid;
  v_mine uuid := '00000000-0000-4000-8000-000000010890';
  v_theirs uuid := '00000000-0000-4000-8000-000000010891';
  v_leg text := 'setup'; r_role text;
  r_own text := 'unset'; r_other text := 'unset'; r_guest text := 'unset';
  a_users int; a_profiles int; a_convs int; a_msgs int; a_notifs int;
  b_users int; b_profiles int; b_convs int; b_msgs int; b_notifs int;
  r_a_row text := 'unset'; r_a_conv text := 'unset'; r_b_row text := 'unset';
BEGIN
  -- (a) The FULL policy set on the table, printed in any failure: seven, and exactly one
  --     permissive DELETE policy, owner-scoped (live rendering of the qual).
  SELECT string_agg(policyname || ' ' || permissive || ' ' || cmd, ' | ' ORDER BY policyname), count(*)
    INTO v_list, v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications';
  IF v_n IS DISTINCT FROM 7 THEN RAISE EXCEPTION 'notifications has % policies, expected 7: %', v_n, v_list; END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications'
     AND permissive = 'PERMISSIVE' AND cmd IN ('DELETE', 'ALL');
  IF v_n IS DISTINCT FROM 1 OR NOT EXISTS (
       SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications'
          AND policyname = 'users delete own notifications' AND cmd = 'DELETE'
          AND roles = '{authenticated}' AND qual = '(user_id = auth.uid())') THEN
    RAISE EXCEPTION 'permissive DELETE policies on notifications are not exactly the owner-scoped one: %', v_list;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.notifications'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'notifications has triggers; 20261087''s SET NULL premise no longer holds';
  END IF;

  SELECT id, initiator_id, recipient_id INTO v_conv, v_init, v_recp FROM public.conversations
   WHERE initiator_id IS NOT NULL AND recipient_id IS NOT NULL ORDER BY created_at LIMIT 1;
  IF v_conv IS NULL THEN RAISE EXCEPTION 'no conversation with both participants to test with'; END IF;
  SELECT (SELECT count(*) FROM auth.users), (SELECT count(*) FROM public.profiles), (SELECT count(*) FROM public.conversations),
         (SELECT count(*) FROM public.messages), (SELECT count(*) FROM public.notifications)
    INTO b_users, b_profiles, b_convs, b_msgs, b_notifs;

  -- (b) Behaviour as real accounts, and (c) the deletion legs, in one subtransaction rolled
  --     back by a sentinel. Local variables survive the rollback.
  BEGIN
    v_leg := 'probe rows';
    INSERT INTO public.notifications (id, user_id, title, body, type, conversation_id) VALUES
      (v_mine,   v_recp, '20261089 probe', '20261089 probe', 'message', v_conv),
      (v_theirs, v_init, '20261089 probe', '20261089 probe', 'message', v_conv);

    -- A guest session cannot delete, even its "own" row (restrictive policy) …
    v_leg := 'guest delete';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_recp, 'role', 'authenticated', 'is_anonymous', true)::text, true);
    SET LOCAL ROLE authenticated;
    DELETE FROM public.notifications WHERE id = v_mine;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    r_guest := v_n || ' rows';
    SET LOCAL ROLE postgres;

    -- … the owner can delete their own row (the positive control) …
    v_leg := 'owner delete';
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_recp, 'role', 'authenticated', 'is_anonymous', false)::text, true);
    SET LOCAL ROLE authenticated;
    r_role := current_user;
    DELETE FROM public.notifications WHERE id = v_mine;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    r_own := v_n || ' rows';
    -- … and not someone else's.
    v_leg := 'delete another user''s row';
    DELETE FROM public.notifications WHERE id = v_theirs;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    r_other := v_n || ' rows';
    SET LOCAL ROLE postgres;
    PERFORM set_config('request.jwt.claims', '', true);

    -- The deletion legs, on a fresh probe for the recipient.
    INSERT INTO public.notifications (id, user_id, title, body, type, conversation_id)
    VALUES (v_mine, v_recp, '20261089 probe', '20261089 probe', 'message', v_conv);
    v_leg := 'A: delete_own_account as the initiator';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_init, 'role', 'authenticated')::text, true);
    PERFORM public.delete_own_account();
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT CASE WHEN conversation_id IS NOT DISTINCT FROM v_conv THEN 'kept, id intact'
                ELSE 'kept, id = ' || coalesce(conversation_id::text, 'NULL') END
      INTO r_a_row FROM public.notifications WHERE id = v_mine;
    r_a_conv := CASE WHEN EXISTS (SELECT 1 FROM public.conversations WHERE id = v_conv) THEN 'kept' ELSE 'GONE' END;

    v_leg := 'B: DELETE FROM conversations';
    DELETE FROM public.conversations WHERE id = v_conv;
    SELECT CASE WHEN conversation_id IS NULL THEN 'kept, id NULL' ELSE 'kept, id = ' || conversation_id::text END
      INTO r_b_row FROM public.notifications WHERE id = v_mine;

    RAISE EXCEPTION 'sentinel' USING ERRCODE = 'ZX089';
  EXCEPTION
    WHEN SQLSTATE 'ZX089' THEN NULL;
    WHEN OTHERS THEN
      RAISE EXCEPTION '20261089 test, leg [%]: % (SQLSTATE %)', v_leg, SQLERRM, SQLSTATE;
  END;
  SET LOCAL ROLE postgres;
  PERFORM set_config('request.jwt.claims', '', true);

  IF r_role  IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'owner leg ran as %, not authenticated', r_role; END IF;
  IF r_guest IS DISTINCT FROM '0 rows' THEN RAISE EXCEPTION 'a guest delete removed %', r_guest; END IF;
  IF r_own   IS DISTINCT FROM '1 rows' THEN RAISE EXCEPTION 'the owner deleting their own row removed %', r_own; END IF;
  IF r_other IS DISTINCT FROM '0 rows' THEN RAISE EXCEPTION 'deleting another user''s row removed %', r_other; END IF;
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
  IF EXISTS (SELECT 1 FROM public.notifications WHERE id IN (v_mine, v_theirs)) THEN RAISE EXCEPTION 'probe rows survived the rollback'; END IF;
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
VALUES ('20261089_notifications_delete_own.sql', '1c5efa3a859f02a38e1495a7ee6aea1dc97c144f1e0c7b72eb24077b1a1a15ed')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;
NOTIFY pgrst, 'reload schema';

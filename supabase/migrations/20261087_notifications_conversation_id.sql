-- ─── 20261087 — a message notification row knows its thread ─────────────────
--
-- 1. notifications.conversation_id: uuid, nullable, FK → conversations ON DELETE SET NULL,
--    partial index. Set only on type = 'message' rows; every other kind leaves it NULL.
-- 2. notify_new_message: the in-app row gets the thread id, and the push `data` gains
--    'type' = 'message' beside the existing 'screen' / 'conversation_id' (20261031).
--    Body carried over VERBATIM from 20261066 (refused unless the live body's md5 matches
--    that text), changing only the INSERT and the data object.
-- 3. Backfill of existing 'message' rows, exact matches only (see the block).
--
-- WHY THE APP NEEDS IT: utils/notificationRoute.js left 'message' rows inert because the row
-- had no thread to open. With the id, a tap in the in-app list opens the Student Hub on that
-- conversation (a row without one opens the Messages tab). The PUSH path never needed this
-- column — its payload already carries the id.
--
-- ─── WHY ON DELETE SET NULL, AND WHY IT IS SAFE HERE ─────────────────────────
-- A SET NULL is performed as an UPDATE, so triggers and CHECKs see it — the bug class that
-- broke delete_own_account three times in 20261029. Read from the live catalogs on
-- 2026-10-06 (supabase/probe_message_deeplink.sql): notifications has NO triggers, and its
-- one CHECK (type) does not mention this column. Nothing in the database deletes a
-- conversations row today (its profile FKs are SET NULL; only messages cascade from it), so
-- the action fires on no current path. When it does, the notification stays and opens the
-- Messages tab. Block 4 re-asserts "no triggers" and runs account deletion and a
-- conversation delete for real, rolled back by a sentinel.
--
-- WHO CAN READ/WRITE WHAT: unchanged. Same RLS (a user reads and updates only their own
-- rows). A user can write this column on their OWN rows, as with every other column of
-- theirs; the hub resolves the id through list_conversations(), which returns only threads
-- the caller is in, so a forged id opens nothing.

SET ROLE postgres;

BEGIN;

-- ─── 0. Refuse on a database this was not written against ───────────────────
DO $$
DECLARE v_md5 text;
BEGIN
  IF to_regclass('public.conversations') IS NULL OR to_regprocedure('public.notify_new_message(uuid)') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: conversations / notify_new_message(uuid) missing (20261029 not applied). Nothing applied.';
  END IF;
  -- md5 of 20261066's body, read live on 2026-10-06 (supabase/probe_message_deeplink_md5.sql),
  -- or of this file's own body (a re-run after a successful apply).
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.notify_new_message(uuid)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('9daa04e8ad5be2dd4c66ba4616bc2a32', '3cd1e046ff8149cfb09214421c469f2b') THEN
    RAISE EXCEPTION 'REFUSING: live notify_new_message body (md5 %) is not 20261066''s text — it changed since; re-derive this file from the live body. Nothing applied.', v_md5;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.notifications'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'REFUSING: notifications has triggers now; the ON DELETE SET NULL reasoning above assumed none. Nothing applied.';
  END IF;
END $$;

-- ─── 1. The column, its FK and its index ─────────────────────────────────────
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS conversation_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.notifications'::regclass
                  AND conname = 'notifications_conversation_id_fkey') THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_conversation_id_fkey
      FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;
  END IF;
END $$;
-- Partial: almost every row is NULL. It also serves the FK's lookup on a conversation delete.
CREATE INDEX IF NOT EXISTS notifications_conversation_id_idx
  ON public.notifications (conversation_id) WHERE conversation_id IS NOT NULL;

COMMENT ON COLUMN public.notifications.conversation_id IS
  'The Student Hub thread a type=''message'' row is about (20261087); NULL for every other kind and for rows whose thread is gone. Set by notify_new_message. The app opens the thread on tap, resolving it via list_conversations().';

-- ─── 2. notify_new_message: the row and the push both carry the thread ───────
CREATE OR REPLACE FUNCTION public.notify_new_message(p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_to       uuid;
  -- Added by 20261031: the thread the push should open.
  v_conv     uuid;
  v_accepted boolean;
  v_name     text;
  v_body     text;
  v_lang     text;
  v_token    text;
  v_title    text;
  v_text     text;
BEGIN
  SELECT CASE WHEN m.sender_id = c.initiator_id THEN c.recipient_id ELSE c.initiator_id END,
         m.conversation_id,
         c.accepted_at IS NOT NULL, m.sender_display_name, m.body
    INTO v_to, v_conv, v_accepted, v_name, v_body
    FROM messages m JOIN conversations c ON c.id = m.conversation_id
   WHERE m.id = p_message_id;

  IF v_to IS NULL THEN RETURN; END IF;

  SELECT coalesce(preferred_language, 'English'), push_token
    INTO v_lang, v_token FROM profiles WHERE id = v_to;

  IF v_accepted THEN
    v_title := v_name;
    -- ► THE ELLIPSIS IS CONDITIONAL, AND THAT IS THE WHOLE POINT. A bare
    --   left(v_body, 140) makes a truncated message read as a COMPLETE short one:
    --   "I need to tell you something about" looks like the entire thing somebody sent,
    --   and the recipient acts on a sentence that was never finished. Appending it
    --   unconditionally is the mirror error — every short message would look cut off.
    --   rtrim first, or a truncation landing after a space reads as "word …".
    --
    --   WRITTEN AS U&'\2026', NOT AS THE CHARACTER. This file is APPLIED BY PASTING IT
    --   INTO THE SUPABASE SQL EDITOR, and 20261001 escapes its whitespace class for
    --   exactly that reason. The escape is pure ASCII, so it cannot be mangled at all —
    --   which beats detecting the mangling afterwards. A single '.' repeated three times
    --   would also be paste-proof, but renders as three glyphs where every notification
    --   UI on both platforms elides with one.
    v_text  := CASE WHEN char_length(v_body) > 140
                    THEN rtrim(left(v_body, 140)) || U&'\2026'
                    ELSE v_body END;
  ELSE
    -- No name, no content, and no count either — "3 people want to message you" is
    -- itself information about how exposed somebody is.
    --
    -- ALL NINE LANGUAGES, with an English fallback, in the shape module_notif_text()
    -- already uses. An English/Turkish CASE would have been two lines and would have put
    -- English on the lock screen of every Greek, Persian, Arabic, Russian, French,
    -- Spanish and German user — and this is the ONE notification that reaches somebody
    -- who has not agreed to be reached, so it is the worst one to leave untranslated.
    -- preferred_language holds FULL ENGLISH NAMES ('Turkish'), never ISO codes: an ISO
    -- comparison never errors, it just matches nothing and silently falls back.
    SELECT coalesce(t.title, 'New message request'), coalesce(t.body, 'Someone wants to message you.')
      INTO v_title, v_text
      FROM (VALUES
        ('English', 'New message request',  'Someone wants to message you.'),
        ('Turkish', 'Yeni mesaj isteği',    'Biri sana mesaj göndermek istiyor.'),
        ('Arabic',  'طلب رسالة جديد',        'شخص ما يريد مراسلتك.'),
        ('Russian', 'Новый запрос на переписку', 'Кто-то хочет написать вам.'),
        ('Greek',   'Νέο αίτημα μηνύματος', 'Κάποιος θέλει να σας στείλει μήνυμα.'),
        ('French',  'Nouvelle demande de message', 'Quelqu''un souhaite vous écrire.'),
        ('Spanish', 'Nueva solicitud de mensaje',  'Alguien quiere enviarte un mensaje.'),
        ('German',  'Neue Nachrichtenanfrage',     'Jemand möchte dir schreiben.'),
        ('Persian', 'درخواست پیام جدید',
         -- ► THE ONLY INVISIBLE CHARACTER THIS FILE EVER CONTAINED, now escaped.
         --   Persian for "wants" carries a ZERO-WIDTH NON-JOINER between its two halves.
         --   It is correct orthography, it is INVISIBLE IN A DIFF, and if the SQL
         --   editor's clipboard drops it the string silently becomes 'میخواهد' —
         --   wrong, unnoticeable in review, and findable only by a Persian reader
         --   looking at a real notification. This is precisely the failure
         --   20261001 escapes its whitespace class to avoid. The visible Persian
         --   stays readable; only the invisible character becomes an escape.
                    'کسی می' || U&'\200C' || 'خواهد به شما پیام بدهد.')
      ) AS t(lang, title, body)
     WHERE t.lang = v_lang;

    IF v_title IS NULL THEN
      v_title := 'New message request';
      v_text  := 'Someone wants to message you.';
    END IF;
  END IF;

  -- 20261087: the row carries the thread too, so tapping it in the in-app list opens it.
  INSERT INTO notifications (user_id, title, body, type, conversation_id) VALUES (v_to, v_title, v_text, 'message', v_conv);

  IF v_token IS NOT NULL THEN
    PERFORM net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      -- ► THE ONLY CHANGE TO THE WIRE FORMAT. 'screen' is the discriminator App.js's two
      --   notification handlers already switch on; 'conversation_id' is the thread, which
      --   the recipient is a participant in by construction (v_to is derived from the row).
      --   Nothing else goes in here — see the header on why a data blob is not a quieter
      --   place to put a name or a message body.
      body    := jsonb_build_object(
                   'to', v_token, 'title', v_title, 'body', v_text, 'sound', 'default',
                   --   20261087 adds 'type' = 'message', the same value as notifications.type.
                   'data', jsonb_build_object('screen', 'conversation', 'type', 'message',
                                              'conversation_id', v_conv)),
      headers := jsonb_build_object('Content-Type', 'application/json'));
  END IF;
END;
$function$;

-- ─── 3. Backfill: exact matches only ─────────────────────────────────────────
-- notify_new_message runs inside send_message / start_conversation's transaction, and both
-- created_at columns DEFAULT now() — the transaction start time — so a message and its
-- notification carry the IDENTICAL timestamp. Match = same created_at, the row's owner is a
-- participant of the message's thread and is not its sender. More than one match for a row
-- is a hard failure (never guess); no match stays NULL (thread or message gone) and is
-- counted. Pre-flight read on 2026-10-06: 0 'message' rows, so 0 matched / 0 unmatched.
DO $$
DECLARE v_total int; v_one int; v_many int; v_upd int;
BEGIN
  SELECT count(*) INTO v_total FROM public.notifications WHERE type = 'message' AND conversation_id IS NULL;
  WITH bf AS (
    SELECT n.id AS nid, count(*) AS k
      FROM public.notifications n
      JOIN public.messages m ON m.created_at = n.created_at
      JOIN public.conversations c ON c.id = m.conversation_id
     WHERE n.type = 'message' AND n.conversation_id IS NULL
       AND n.user_id IN (c.initiator_id, c.recipient_id)
       AND n.user_id IS DISTINCT FROM m.sender_id
     GROUP BY n.id)
  SELECT count(*) FILTER (WHERE k = 1), count(*) FILTER (WHERE k > 1) INTO v_one, v_many FROM bf;
  IF v_many > 0 THEN
    RAISE EXCEPTION '20261087 backfill: % row(s) match more than one message; refusing to guess. Nothing applied.', v_many;
  END IF;
  UPDATE public.notifications n SET conversation_id = m.conversation_id
    FROM public.messages m JOIN public.conversations c ON c.id = m.conversation_id
   WHERE n.type = 'message' AND n.conversation_id IS NULL
     AND m.created_at = n.created_at
     AND n.user_id IN (c.initiator_id, c.recipient_id)
     AND n.user_id IS DISTINCT FROM m.sender_id;
  GET DIAGNOSTICS v_upd = ROW_COUNT;
  IF v_upd IS DISTINCT FROM v_one THEN
    RAISE EXCEPTION '20261087 backfill: expected to set % row(s), set %', v_one, v_upd;
  END IF;
  RAISE NOTICE '20261087 backfill: message rows % · matched exactly one % · unmatched % · ambiguous %',
    v_total, v_one, v_total - v_one, v_many;
END $$;

-- ─── 4. Assertions ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def text; v_src text;
  v_conv uuid; v_init uuid; v_recp uuid; v_probe uuid := '00000000-0000-4000-8000-000000010870';
  v_leg text := 'setup';
  a_users int; a_profiles int; a_convs int; a_msgs int; a_notifs int;
  b_users int; b_profiles int; b_convs int; b_msgs int; b_notifs int;
  r_a_row text := 'unset'; r_a_conv text := 'unset'; r_b_row text := 'unset';
BEGIN
  -- (a) Shape, from the catalogs.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications'
                  AND column_name = 'conversation_id' AND data_type = 'uuid' AND is_nullable = 'YES') THEN
    RAISE EXCEPTION 'notifications.conversation_id is missing or not a nullable uuid';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_conversation_id_fkey';
  IF v_def IS DISTINCT FROM 'FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL' THEN
    RAISE EXCEPTION 'notifications_conversation_id_fkey renders as: %', coalesce(v_def, 'MISSING');
  END IF;
  IF to_regclass('public.notifications_conversation_id_idx') IS NULL THEN
    RAISE EXCEPTION 'notifications_conversation_id_idx missing';
  END IF;

  -- (b) The function: both new pieces present, and 20261031/20261066's markers survived.
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.notify_new_message(uuid)'::regprocedure;
  IF position('INSERT INTO notifications (user_id, title, body, type, conversation_id) VALUES (v_to, v_title, v_text, ''message'', v_conv)' in v_src) = 0
     OR position('''screen'', ''conversation'', ''type'', ''message''' in v_src) = 0
     OR position('''conversation_id'', v_conv' in v_src) = 0
     OR position('Yeni mesaj isteği' in v_src) = 0
     OR position('U&''\200C''' in v_src) = 0
     OR position('U&''\2026''' in v_src) = 0 THEN
    RAISE EXCEPTION 'notify_new_message body is missing a 20261087 change or lost a 20261031/20261066 marker';
  END IF;
  -- CREATE OR REPLACE keeps the ACL; assert it anyway: no client role may call it directly …
  IF has_function_privilege('authenticated', 'public.notify_new_message(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.notify_new_message(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'notify_new_message became EXECUTE-able by a client role';
  END IF;
  -- … and the definer path that does call it still can (positive control).
  IF NOT has_function_privilege('postgres', 'public.notify_new_message(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'postgres cannot EXECUTE notify_new_message';
  END IF;

  -- (c) Account deletion and a conversation delete, FOR REAL, then rolled back by a sentinel.
  --     Picks a thread with both participants; nothing outside this subtransaction changes.
  SELECT id, initiator_id, recipient_id INTO v_conv, v_init, v_recp FROM public.conversations
   WHERE initiator_id IS NOT NULL AND recipient_id IS NOT NULL ORDER BY created_at LIMIT 1;
  IF v_conv IS NULL THEN
    RAISE EXCEPTION 'no conversation with both participants to run the deletion test on';
  END IF;
  SELECT (SELECT count(*) FROM auth.users), (SELECT count(*) FROM public.profiles), (SELECT count(*) FROM public.conversations),
         (SELECT count(*) FROM public.messages), (SELECT count(*) FROM public.notifications)
    INTO b_users, b_profiles, b_convs, b_msgs, b_notifs;
  BEGIN
    v_leg := 'probe row';
    INSERT INTO public.notifications (id, user_id, title, body, type, conversation_id)
    VALUES (v_probe, v_recp, '20261087 probe', '20261087 probe', 'message', v_conv);

    -- Leg A: the OTHER participant deletes their account (the real RPC, as them).
    v_leg := 'A: delete_own_account as the initiator';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_init, 'role', 'authenticated')::text, true);
    PERFORM public.delete_own_account();
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT CASE WHEN conversation_id IS NOT DISTINCT FROM v_conv THEN 'kept, id intact'
                ELSE 'kept, id = ' || coalesce(conversation_id::text, 'NULL') END
      INTO r_a_row FROM public.notifications WHERE id = v_probe;
    r_a_conv := CASE WHEN EXISTS (SELECT 1 FROM public.conversations WHERE id = v_conv) THEN 'kept' ELSE 'GONE' END;

    -- Leg B: the conversation itself is deleted → the FK nulls the row, never deletes it.
    v_leg := 'B: DELETE FROM conversations';
    DELETE FROM public.conversations WHERE id = v_conv;
    SELECT CASE WHEN conversation_id IS NULL THEN 'kept, id NULL' ELSE 'kept, id = ' || conversation_id::text END
      INTO r_b_row FROM public.notifications WHERE id = v_probe;

    RAISE EXCEPTION 'sentinel' USING ERRCODE = 'ZX087';
  EXCEPTION
    WHEN SQLSTATE 'ZX087' THEN NULL;   -- the database work above is rolled back; local variables are not
    WHEN OTHERS THEN
      RAISE EXCEPTION '20261087 deletion test, leg [%]: % (SQLSTATE %)', v_leg, SQLERRM, SQLSTATE;
  END;
  PERFORM set_config('request.jwt.claims', '', true);

  IF r_a_row IS DISTINCT FROM 'kept, id intact' THEN
    RAISE EXCEPTION 'leg A: the other participant''s notification was %', coalesce(r_a_row, 'DELETED');
  END IF;
  IF r_a_conv IS DISTINCT FROM 'kept' THEN RAISE EXCEPTION 'leg A: the conversation was %', r_a_conv; END IF;
  IF r_b_row IS DISTINCT FROM 'kept, id NULL' THEN
    RAISE EXCEPTION 'leg B: after the conversation delete the notification was %', coalesce(r_b_row, 'DELETED');
  END IF;

  -- The rollback happened: every count is back where it was, and the probe row is gone.
  SELECT (SELECT count(*) FROM auth.users), (SELECT count(*) FROM public.profiles), (SELECT count(*) FROM public.conversations),
         (SELECT count(*) FROM public.messages), (SELECT count(*) FROM public.notifications)
    INTO a_users, a_profiles, a_convs, a_msgs, a_notifs;
  IF (a_users, a_profiles, a_convs, a_msgs, a_notifs) IS DISTINCT FROM (b_users, b_profiles, b_convs, b_msgs, b_notifs) THEN
    RAISE EXCEPTION 'deletion test did not roll back: users %->% profiles %->% convs %->% msgs %->% notifs %->%',
      b_users, a_users, b_profiles, a_profiles, b_convs, a_convs, b_msgs, a_msgs, b_notifs, a_notifs;
  END IF;
  IF EXISTS (SELECT 1 FROM public.notifications WHERE id = v_probe) THEN RAISE EXCEPTION 'probe row survived the rollback'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_init) THEN RAISE EXCEPTION 'the test account is gone after the rollback'; END IF;

  RAISE NOTICE '20261087 deletion test: A % / conversation % · B % · counts restored (users % convs % notifs %)',
    r_a_row, r_a_conv, r_b_row, a_users, a_convs, a_notifs;
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
VALUES ('20261087_notifications_conversation_id.sql', '493c50d2a053cd4bc8bc7e3f242fe631f0cc42b8517278e7229cf23b4c924ae0')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;
NOTIFY pgrst, 'reload schema';

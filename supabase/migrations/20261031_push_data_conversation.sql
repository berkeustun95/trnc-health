-- ─── 20261031 — the message push carries somewhere to go ────────────────────
--
-- ONE function body, CREATE OR REPLACE. No tables, no columns, no policies, no grants,
-- no new named object at all — which is why its only registration is an H token.
--
-- ─── THE DEFECT ──────────────────────────────────────────────────────────────
--
-- 20261029's push body is:
--
--     jsonb_build_object('to', v_token, 'title', v_title, 'body', v_text, 'sound', 'default')
--
-- There is no `data` key, so `response.notification.request.content.data` arrives EMPTY.
-- App.js's notification handlers route on `data.screen`, so a tapped message notification
-- matches no branch and the app opens wherever it was. Found 2026-09-19 in a two-account
-- test: the notification arrived, and tapping it did nothing.
--
-- ► THE HANDLERS ARE NOT MISSING. addNotificationResponseReceivedListener (App.js:1012)
--   and the cold-start getLastNotificationResponseAsync (App.js:1031) have both existed
--   since the duty roster work and route 'duty' / 'profile' / 'notifications'. Messaging
--   simply never joined them, on either side — no payload here, no branch there. This file
--   is the database half; the client half lands in the same commit.
--
-- ─── WHAT IS IN THE PAYLOAD, AND WHAT DELIBERATELY IS NOT ───────────────────
--
--   screen          'conversation'   — the discriminator the handlers already switch on.
--   conversation_id the thread's id  — a uuid, and the recipient is a participant in it
--                                      by construction (v_to is derived from the row).
--
-- NOT the sender's name, NOT the message body, NOT the other user's id. The title and body
-- above already say as much as the lock screen is allowed to (and for an UNACCEPTED thread
-- they deliberately say neither name nor content — 20261029's header explains why). A data
-- payload is not a second, quieter place to put the same information: it is delivered to
-- the device by the same route, survives in the notification record, and would be readable
-- by anything that can read notifications. It carries the minimum needed to open a screen.
--
-- ─── ⚠ THIS CANNOT BE VERIFIED BEFORE THE OTA ───────────────────────────────
--
-- Expo Go cannot hold a push token on SDK 53+, so the token in profiles.push_token belongs
-- to the PLAY STORE build. During the 2026-09-19 test the push was therefore delivered to
-- the production app — which has no messaging in its bundle — and tapping it correctly did
-- nothing. That is not a bug and it is not fixable from here: the deep link can only be
-- exercised once the OTA has shipped this JS to the production channel.
--
-- The go-live checklist carries it as a required step, next to the stale-affiliation
-- recovery test, for the same reason: a window that closes.

BEGIN;

-- ─── 0. Refuse on a database that never got 20261029 ────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.notify_new_message(uuid)') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: notify_new_message(uuid) does not exist — 20261029 has not been applied here. Nothing applied.';
  END IF;
  RAISE NOTICE '20261031: replacing notify_new_message. data payload before = %',
    CASE WHEN pg_get_functiondef(to_regprocedure('public.notify_new_message(uuid)')) LIKE '%''data''%'
         THEN 'present (already applied?)' ELSE 'ABSENT (the defect)' END;
END $$;

-- ─── 1. The body, carried over verbatim except for v_conv and the data key ──
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

  INSERT INTO notifications (user_id, title, body) VALUES (v_to, v_title, v_text);

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
                   'data', jsonb_build_object('screen', 'conversation',
                                              'conversation_id', v_conv)),
      headers := jsonb_build_object('Content-Type', 'application/json'));
  END IF;
END;
$function$;

-- ─── 2. Verification, read from pg_proc and not from this file ──────────────
--
-- BOTH DIRECTIONS, and the second half is not decoration. The first draft of this file
-- retyped the function body from memory and replaced the nine-language request copy with
-- a call to module_notif_text() that does not exist here — which would have silently
-- destroyed the Turkish, Arabic, Russian, Greek, French, Spanish, German and Persian
-- strings, including the escaped ZWNJ, on a CREATE OR REPLACE that reports success. It was
-- caught by diffing the replacement against 20261029 before this ran, and the body is now
-- spliced from that file verbatim rather than retyped. These assertions are the same check
-- expressed against the live catalogue, so the next edit cannot lose them either.
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef(to_regprocedure('public.notify_new_message(uuid)'));

  -- What this file adds.
  IF position('''conversation_id''' in v_def) = 0 OR position('''screen''' in v_def) = 0 THEN
    RAISE EXCEPTION 'notify_new_message carries no routing data after the replace. Body: %', left(v_def, 600);
  END IF;

  -- What this file must not have cost. One marker per thing that is expensive to lose and
  -- invisible when it goes: a non-English request title, the zero-width non-joiner inside
  -- the Persian, and the conditional ellipsis.
  IF position('Yeni mesaj isteği' in v_def) = 0 THEN
    RAISE EXCEPTION 'the nine-language request copy is gone — an unaccepted request would reach every non-English user in English. Body: %', left(v_def, 900);
  END IF;
  IF position('200C' in v_def) = 0 THEN
    RAISE EXCEPTION 'the escaped ZWNJ in the Persian request copy is gone. Body: %', left(v_def, 900);
  END IF;
  IF position('2026' in v_def) = 0 THEN
    RAISE EXCEPTION 'the conditional truncation ellipsis is gone — a cut-off message would read as a complete one. Body: %', left(v_def, 900);
  END IF;

  -- The payload must carry ONLY what opens a screen. A name in a data blob would put on the
  -- device, for an UNACCEPTED request, exactly what the ELSE arm refuses to put in the title.
  IF position('''name''' in v_def) > 0 OR position('v_name)' in v_def) > 0 THEN
    RAISE EXCEPTION 'the data payload carries a name it should not. Body: %', left(v_def, 900);
  END IF;

  RAISE NOTICE '20261031 verified: routing data present, all nine languages and both escapes intact.';
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
VALUES ('20261031_push_data_conversation.sql', '758213dbe6c3ce4a46ff0718b78241f21340f83a42d628ca6d7e7d9063fef4dd')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

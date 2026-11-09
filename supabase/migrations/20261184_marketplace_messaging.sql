-- ═══════════════════════════════════════════════════════════════════════════
-- 20261184 — Dükkân chat: a conversation can be about a listing (conversations.kind / listing_id)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Plan: vault 10-ada/2026-11-07_marketplace-plan.md ("reuse existing messaging"; Berke approved the
-- listing_id extension with Student Hub regression tests first). Needs 20261183 (marketplace_listings).
--
-- ─── WHAT CHANGES FOR STUDENT HUB: NOTHING OBSERVABLE ───────────────────────
--   Every existing row becomes kind = 'student' (column DEFAULT). The bodies below are the live ones
--   (probe 42413063083, md5-guarded) with only these edits:
--     start_conversation   the "live thread exists" and "was declined" lookups also say kind = 'student'
--     send_message         a listing thread is handed to send_listing_message() before the first line;
--                          the student path below it is the live text
--     list_conversations   gains p_kind DEFAULT 'student' and four trailing columns; with no argument
--                          (every bundle in the field) it returns exactly today's rows
--     notify_new_message   a listing thread's push says screen 'marketplace_conversation' (+ listing_id);
--                          older bundles ignore an unknown screen instead of opening Student Hub
--   conversations_one_live_per_pair becomes partial on kind = 'student'; Dükkân threads get their own
--   per-(pair, listing) index. scripts/test-marketplace-messaging-sql.mjs runs the 16 Student Hub outcomes
--   against the live bodies AND with this file applied.
--
-- ─── DÜKKÂN THREADS ─────────────────────────────────────────────────────────
--   Only a BUYER starts one, from a visible, active listing (start_listing_conversation). Rules:
--   signed-in, not a guest, has read the safety notice (marketplace_notice_at), not the seller, at most
--   one live thread per (buyer, seller, listing), the shared 50-new-threads-per-24h cap, no block either
--   way, not previously declined for that listing, and may_initiate_by_age(buyer, seller) — UNCHANGED.
--   Sellers are 18+ (20261183), so in practice: a teen buyer may open a thread with an adult seller and
--   the seller may reply; an adult never opens one with a teen. No student listing is required on
--   either side. Accept-first, decline, leave, block, delete and report work as in Student Hub (those
--   functions are untouched). The sender must ALSO have read the notice to reply (seller included).
--
-- Apply: one supabase-migrate run with 20261183 and 20261185 (Berke approves production-db).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE v_bad text;
BEGIN
  IF to_regclass('public.marketplace_listings') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: marketplace_listings is missing — apply 20261183 first. Nothing applied.';
  END IF;
  -- Live md5s (probe 42413063083) or this file's own (re-run).
  SELECT string_agg(f.sig || ' md5 ' || coalesce(md5(p.prosrc), 'MISSING'), '; ') INTO v_bad
    FROM (VALUES
      ('public.start_conversation(uuid,text)', 'ebc64230658bf71451bd47d3abf236d7', 'c053fc5fcd770d95965316810acfc79a'),
      ('public.send_message(uuid,text)',       '384abcad73aaa28c00d15a2dbf84a63d', 'e74e414e1dc2902510c09a6bc76e142f'),
      ('public.notify_new_message(uuid)',      '3cd1e046ff8149cfb09214421c469f2b', 'a6d656b979628ca52be155b6b8dc5bbc')
    ) AS f(sig, live, mine)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(f.sig)
   WHERE p.prosrc IS NULL OR md5(p.prosrc) NOT IN (f.live, f.mine);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'REFUSING: live messaging bodies changed since the probe: %. Re-derive. Nothing applied.', v_bad;
  END IF;
  IF to_regprocedure('public.list_conversations()') IS NOT NULL
     AND (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.list_conversations()'))
         IS DISTINCT FROM 'da2984e37a90a7ceff8128b5d4bdafb0' THEN
    RAISE EXCEPTION 'REFUSING: live list_conversations() changed since the probe. Nothing applied.';
  END IF;
END $pre$;

-- ─── 1. conversations.kind / listing_id ────────────────────────────────────
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'student';
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS listing_id uuid;
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_kind_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_kind_check CHECK (kind IN ('student', 'listing'));
-- A purged listing (ON DELETE SET NULL) leaves a listing thread with no listing; never the other way.
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_listing_kind_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_listing_kind_check CHECK (kind = 'listing' OR listing_id IS NULL);
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_listing_id_fkey;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_listing_id_fkey
  FOREIGN KEY (listing_id) REFERENCES public.marketplace_listings(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS public.conversations_one_live_per_pair;
CREATE UNIQUE INDEX conversations_one_live_per_pair ON public.conversations USING btree (pair_lo, pair_hi)
  WHERE ((declined_at IS NULL) AND (closed_at IS NULL) AND (initiator_id IS NOT NULL) AND (recipient_id IS NOT NULL)
         AND (kind = 'student'));
CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_live_per_listing ON public.conversations USING btree (pair_lo, pair_hi, listing_id)
  WHERE ((declined_at IS NULL) AND (closed_at IS NULL) AND (initiator_id IS NOT NULL) AND (recipient_id IS NOT NULL)
         AND (kind = 'listing'));
CREATE INDEX IF NOT EXISTS conversations_listing_idx ON public.conversations (listing_id) WHERE listing_id IS NOT NULL;

COMMENT ON COLUMN public.conversations.kind IS
  'student = Student Hub (both listed students); listing = Dükkân, about listing_id (20261184).';

-- ─── 2. Student Hub bodies, live + the edits named in the header ────────────
CREATE OR REPLACE FUNCTION public.start_conversation(p_recipient_id uuid, p_body text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me      uuid := auth.uid();
  v_body    text := btrim(coalesce(p_body, ''));
  v_refused boolean;
  v_conv    uuid;
  v_msg     uuid;
BEGIN
  -- ── the gates that RAISE: nothing was attempted, nothing is counted ──────
  IF v_me IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT can_see_student_lists() THEN
    RAISE EXCEPTION 'NOT_LISTED';
  END IF;
  IF p_recipient_id IS NULL OR p_recipient_id = v_me THEN
    RAISE EXCEPTION 'INVALID_RECIPIENT';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 1000 THEN
    RAISE EXCEPTION 'BODY_LENGTH';
  END IF;

  -- A live thread already exists; the client should have opened it. Not a secret — the
  -- caller is a participant of it by definition.
  IF EXISTS (
    SELECT 1 FROM conversations
     WHERE pair_lo = least(v_me, p_recipient_id) AND pair_hi = greatest(v_me, p_recipient_id)
       AND declined_at IS NULL AND closed_at IS NULL
       AND kind = 'student'  -- 20261184: a Dükkân thread with the same person is not this thread
  ) THEN
    RAISE EXCEPTION 'CONVERSATION_EXISTS';
  END IF;

  -- ── THE CAP. Fifty new conversations a day, counting refusals. ───────────
  -- SECURITY DEFINER is not decoration here. An INVOKER count would read
  -- conversation_attempts under the caller's own RLS, which grants them nothing, so it
  -- would return 0 forever and the cap would be structurally dead — the exact defect
  -- `check_report_rate_limit` shipped with, where a non-admin counting an admin-read
  -- table could never reach the threshold. A rate limit that cannot see its own
  -- denominator is not a rate limit.
  IF (SELECT count(*) FROM conversation_attempts
       WHERE initiator_id = v_me AND created_at > now() - interval '24 hours') >= 50 THEN
    RAISE EXCEPTION 'RATE_LIMITED';
  END IF;

  -- A uuid that is nobody is not an attempt on anyone, so it records nothing. (It costs
  -- no slot either, which is an oracle only in the sense that spending fifty attempts a
  -- day and watching for the cap would distinguish it. The answer is identical, the cost
  -- is a day per bit, and the alternative is a foreign-key error that says "no such
  -- user" outright.)
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_recipient_id) THEN
    RETURN 'refused';
  END IF;

  -- ── the refusable gates, evaluated together and answered as one word ─────
  v_refused :=
       EXISTS (SELECT 1 FROM blocks
                WHERE (blocker_id = v_me AND blocked_id = p_recipient_id)
                   OR (blocker_id = p_recipient_id AND blocked_id = v_me))
    OR NOT is_listed_student(p_recipient_id)
    -- PERMANENT, ONE-DIRECTIONAL DECLINE: any past thread this person declined while I
    -- was the initiator seals me out of initiating again. It does not seal them out of
    -- initiating to me — a decline means "not from you", not "this pair is over".
    OR EXISTS (SELECT 1 FROM conversations
                WHERE pair_lo = least(v_me, p_recipient_id)
                  AND pair_hi = greatest(v_me, p_recipient_id)
                  AND declined_at IS NOT NULL
                  AND initiator_id = v_me
                  AND kind = 'student')  -- 20261184: declining a Dükkân thread is about that item only
    OR NOT may_initiate_by_age(v_me, p_recipient_id);

  INSERT INTO conversation_attempts (initiator_id, recipient_id, outcome)
  VALUES (v_me, p_recipient_id, CASE WHEN v_refused THEN 'refused' ELSE 'sent' END);

  IF v_refused THEN
    RETURN 'refused';
  END IF;

  -- The EXISTS check above and this INSERT are not atomic with respect to another
  -- session doing the same thing, so two simultaneous openers both pass it and the
  -- second meets the partial unique index as a raw 23505 the client cannot read.
  -- 20261026's own belt, worn for the same reason.
  BEGIN
    INSERT INTO conversations (initiator_id, recipient_id) VALUES (v_me, p_recipient_id)
    RETURNING id INTO v_conv;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'CONVERSATION_EXISTS';
  END;

  -- sender_display_name is stamped by msg_10; the placeholder is never stored.
  INSERT INTO messages (conversation_id, sender_id, sender_display_name, body)
  VALUES (v_conv, v_me, '-', v_body)
  RETURNING id INTO v_msg;

  PERFORM notify_new_message(v_msg);
  RETURN 'sent';
END;
$function$;

CREATE OR REPLACE FUNCTION public.send_message(p_conversation_id uuid, p_body text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me   uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  c      conversations%ROWTYPE;
  v_them uuid;
  v_msg  uuid;
BEGIN
  -- 20261184: a Dükkân thread has its own eligibility (no student listing); everything below this
  -- line is the Student Hub path, unchanged.
  IF (SELECT kind FROM conversations WHERE id = p_conversation_id) = 'listing' THEN
    RETURN send_listing_message(p_conversation_id, p_body);
  END IF;
  IF v_me IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT can_see_student_lists() THEN
    RAISE EXCEPTION 'NOT_LISTED';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 1000 THEN
    RAISE EXCEPTION 'BODY_LENGTH';
  END IF;

  SELECT * INTO c FROM conversations WHERE id = p_conversation_id;
  -- A non-participant gets the same answer as a nonexistent id: the thread is not
  -- theirs, and "wrong id" versus "not yours" is a membership oracle.
  IF c.id IS NULL OR v_me NOT IN (coalesce(c.initiator_id, '00000000-0000-0000-0000-000000000000'::uuid),
                                  coalesce(c.recipient_id, '00000000-0000-0000-0000-000000000000'::uuid)) THEN
    RAISE EXCEPTION 'NO_SUCH_CONVERSATION';
  END IF;

  v_them := CASE WHEN c.initiator_id = v_me THEN c.recipient_id ELSE c.initiator_id END;

  -- Left by either side, or the other person is gone.
  IF c.closed_at IS NOT NULL OR v_them IS NULL THEN
    RAISE EXCEPTION 'CONVERSATION_CLOSED';
  END IF;

  -- A block in either direction closes the thread in practice. The blocked party is told
  -- the conversation is closed, never that they were blocked.
  IF EXISTS (SELECT 1 FROM blocks
              WHERE (blocker_id = v_me AND blocked_id = v_them)
                 OR (blocker_id = v_them AND blocked_id = v_me)) THEN
    RAISE EXCEPTION 'CONVERSATION_CLOSED';
  END IF;

  IF c.initiator_id = v_me THEN
    -- ACCEPT-FIRST: one opener, then nothing until the recipient lets it through.
    -- Declined threads land here too, wearing the same answer. See the note above.
    IF c.accepted_at IS NULL THEN
      RAISE EXCEPTION 'AWAITING_ACCEPTANCE';
    END IF;
  ELSE
    IF c.declined_at IS NOT NULL THEN
      RAISE EXCEPTION 'CONVERSATION_CLOSED';
    END IF;
    -- REPLYING IS ACCEPTING. An explicit accept exists too, but making somebody tap
    -- Accept before they may answer is a step that means nothing: the reply IS the
    -- acceptance. Declining stays explicit, because it is permanent.
    IF c.accepted_at IS NULL THEN
      UPDATE conversations SET accepted_at = now() WHERE id = c.id;
    END IF;
  END IF;

  IF NOT is_listed_student(v_them) THEN
    -- They left the hub. Nothing more lands in the thread; it stays readable.
    RAISE EXCEPTION 'CONVERSATION_CLOSED';
  END IF;

  INSERT INTO messages (conversation_id, sender_id, sender_display_name, body)
  VALUES (c.id, v_me, '-', v_body)
  RETURNING id INTO v_msg;

  PERFORM notify_new_message(v_msg);
  RETURN 'sent';
END;
$function$;

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
  -- 20261184: a Dükkân thread opens in Dükkân, not Student Hub.
  v_kind     text;
  v_listing  uuid;
BEGIN
  SELECT CASE WHEN m.sender_id = c.initiator_id THEN c.recipient_id ELSE c.initiator_id END,
         m.conversation_id,
         c.accepted_at IS NOT NULL, m.sender_display_name, m.body, c.kind, c.listing_id
    INTO v_to, v_conv, v_accepted, v_name, v_body, v_kind, v_listing
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
                   --   20261184: a Dükkân thread says 'marketplace_conversation' (+ listing_id). An older
                   --   bundle does not know that screen and ignores the tap, instead of opening Student Hub
                   --   on a thread its inbox will never list.
                   'data', CASE WHEN v_kind = 'listing'
                                THEN jsonb_build_object('screen', 'marketplace_conversation', 'type', 'message',
                                                        'conversation_id', v_conv, 'listing_id', v_listing)
                                ELSE jsonb_build_object('screen', 'conversation', 'type', 'message',
                                                        'conversation_id', v_conv) END),
      headers := jsonb_build_object('Content-Type', 'application/json'));
  END IF;
END;
$function$;

-- ─── 3. Dükkân: reply path ───────────────────────────────────────────────────
-- Internal: reached only through send_message. Same steps and error words as the student path, with
-- the student-listing checks replaced by the Dükkân ones (notice read; the other party still exists).
CREATE OR REPLACE FUNCTION public.send_listing_message(p_conversation_id uuid, p_body text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me   uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  c      conversations%ROWTYPE;
  v_them uuid;
  v_msg  uuid;
BEGIN
  IF v_me IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 1000 THEN
    RAISE EXCEPTION 'BODY_LENGTH';
  END IF;
  SELECT * INTO c FROM conversations WHERE id = p_conversation_id AND kind = 'listing';
  IF c.id IS NULL OR v_me NOT IN (coalesce(c.initiator_id, '00000000-0000-0000-0000-000000000000'::uuid),
                                  coalesce(c.recipient_id, '00000000-0000-0000-0000-000000000000'::uuid)) THEN
    RAISE EXCEPTION 'NO_SUCH_CONVERSATION';
  END IF;
  IF (SELECT marketplace_notice_at FROM profiles WHERE id = v_me) IS NULL THEN
    RAISE EXCEPTION 'NOTICE_REQUIRED';
  END IF;
  v_them := CASE WHEN c.initiator_id = v_me THEN c.recipient_id ELSE c.initiator_id END;
  IF c.closed_at IS NOT NULL OR v_them IS NULL THEN
    RAISE EXCEPTION 'CONVERSATION_CLOSED';
  END IF;
  IF EXISTS (SELECT 1 FROM blocks
              WHERE (blocker_id = v_me AND blocked_id = v_them)
                 OR (blocker_id = v_them AND blocked_id = v_me)) THEN
    RAISE EXCEPTION 'CONVERSATION_CLOSED';
  END IF;
  IF c.initiator_id = v_me THEN
    IF c.accepted_at IS NULL THEN
      RAISE EXCEPTION 'AWAITING_ACCEPTANCE';
    END IF;
  ELSE
    IF c.declined_at IS NOT NULL THEN
      RAISE EXCEPTION 'CONVERSATION_CLOSED';
    END IF;
    IF c.accepted_at IS NULL THEN
      UPDATE conversations SET accepted_at = now() WHERE id = c.id;
    END IF;
  END IF;
  INSERT INTO messages (conversation_id, sender_id, sender_display_name, body)
  VALUES (c.id, v_me, '-', v_body)
  RETURNING id INTO v_msg;
  PERFORM notify_new_message(v_msg);
  RETURN 'sent';
END;
$function$;
REVOKE ALL ON FUNCTION public.send_listing_message(uuid, text) FROM PUBLIC, anon, authenticated;

-- ─── 4. Dükkân: a buyer opens a thread about a listing ──────────────────────
-- Returns 'sent' or 'refused' like start_conversation: block, earlier decline for this listing and the
-- age rule share ONE word, so the answer does not tell the buyer which applied.
CREATE OR REPLACE FUNCTION public.start_listing_conversation(p_listing_id uuid, p_body text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me      uuid := auth.uid();
  v_body    text := btrim(coalesce(p_body, ''));
  v_seller  uuid;
  v_refused boolean;
  v_conv    uuid;
  v_msg     uuid;
BEGIN
  IF v_me IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF char_length(v_body) < 1 OR char_length(v_body) > 1000 THEN
    RAISE EXCEPTION 'BODY_LENGTH';
  END IF;
  SELECT owner_id INTO v_seller FROM marketplace_listings
   WHERE id = p_listing_id AND status = 'active' AND deleted_at IS NULL AND hidden_at IS NULL AND expires_at > now();
  IF v_seller IS NULL THEN
    RAISE EXCEPTION 'NO_SUCH_LISTING';
  END IF;
  IF v_seller = v_me THEN
    RAISE EXCEPTION 'OWN_LISTING';
  END IF;
  IF (SELECT marketplace_notice_at FROM profiles WHERE id = v_me) IS NULL THEN
    RAISE EXCEPTION 'NOTICE_REQUIRED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM conversations
     WHERE kind = 'listing' AND listing_id = p_listing_id
       AND pair_lo = least(v_me, v_seller) AND pair_hi = greatest(v_me, v_seller)
       AND declined_at IS NULL AND closed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'CONVERSATION_EXISTS';
  END IF;
  -- The same 24 h cap as Student Hub, on the same table: one budget for both.
  IF (SELECT count(*) FROM conversation_attempts
       WHERE initiator_id = v_me AND created_at > now() - interval '24 hours') >= 50 THEN
    RAISE EXCEPTION 'RATE_LIMITED';
  END IF;

  v_refused :=
       EXISTS (SELECT 1 FROM blocks
                WHERE (blocker_id = v_me AND blocked_id = v_seller)
                   OR (blocker_id = v_seller AND blocked_id = v_me))
    OR EXISTS (SELECT 1 FROM conversations
                WHERE kind = 'listing' AND listing_id = p_listing_id
                  AND pair_lo = least(v_me, v_seller) AND pair_hi = greatest(v_me, v_seller)
                  AND declined_at IS NOT NULL AND initiator_id = v_me)
    OR NOT may_initiate_by_age(v_me, v_seller);

  INSERT INTO conversation_attempts (initiator_id, recipient_id, outcome)
  VALUES (v_me, v_seller, CASE WHEN v_refused THEN 'refused' ELSE 'sent' END);

  IF v_refused THEN
    RETURN 'refused';
  END IF;

  BEGIN
    INSERT INTO conversations (initiator_id, recipient_id, kind, listing_id)
    VALUES (v_me, v_seller, 'listing', p_listing_id)
    RETURNING id INTO v_conv;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'CONVERSATION_EXISTS';
  END;

  INSERT INTO messages (conversation_id, sender_id, sender_display_name, body)
  VALUES (v_conv, v_me, '-', v_body)
  RETURNING id INTO v_msg;

  PERFORM notify_new_message(v_msg);
  RETURN 'sent';
END;
$function$;
REVOKE ALL ON FUNCTION public.start_listing_conversation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_listing_conversation(uuid, text) TO authenticated;

-- ─── 5. Inbox: one function, two kinds ──────────────────────────────────────
-- DROP + CREATE because the signature and the result columns change. With no argument it is today's
-- function (kind 'student', NOT_LISTED for a non-student); the four new columns trail the old nine so a
-- bundle reading by name sees the same object plus fields it ignores. listing_title is NULL once the
-- listing is gone or hidden (a removed listing's title may be the reason it was removed).
DROP FUNCTION IF EXISTS public.list_conversations();
CREATE OR REPLACE FUNCTION public.list_conversations(p_kind text DEFAULT 'student')
 RETURNS TABLE(conversation_id uuid, other_user_id uuid, display_name text, avatar_url text, is_accepted boolean,
               awaiting_me boolean, is_closed boolean, last_message_at timestamp with time zone, last_body text,
               listing_id uuid, listing_title text, listing_status text, listing_available boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL OR is_anonymous_session() THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('student', 'listing') THEN RAISE EXCEPTION 'BAD_KIND'; END IF;
  IF p_kind = 'student' AND NOT can_see_student_lists() THEN RAISE EXCEPTION 'NOT_LISTED'; END IF;
  RETURN QUERY
  SELECT c.id,
         o.id,
         o.display_name,
         o.avatar_url,
         c.accepted_at IS NOT NULL,
         (c.recipient_id = v_me AND c.accepted_at IS NULL AND c.declined_at IS NULL),
         (c.closed_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM blocks b
                      WHERE (b.blocker_id = v_me AND b.blocked_id = o.id)
                         OR (b.blocker_id = o.id AND b.blocked_id = v_me))),
         c.last_message_at,
         (SELECT m.body FROM messages m
           WHERE m.conversation_id = c.id AND m.deleted_at IS NULL AND m.hidden_at IS NULL
           ORDER BY m.created_at DESC LIMIT 1),
         c.listing_id,
         CASE WHEN l.deleted_at IS NULL AND l.hidden_at IS NULL THEN l.title END,
         l.status,
         coalesce(l.deleted_at IS NULL AND l.hidden_at IS NULL AND l.expires_at > now(), false)
    FROM conversations c
    JOIN profiles o
      ON o.id = CASE WHEN c.initiator_id = v_me THEN c.recipient_id ELSE c.initiator_id END
    LEFT JOIN marketplace_listings l ON l.id = c.listing_id
   WHERE (c.initiator_id = v_me OR c.recipient_id = v_me)
     AND c.kind = p_kind
     AND c.closed_by IS DISTINCT FROM v_me
     AND NOT (c.declined_at IS NOT NULL)
   ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC;
END;
$function$;
REVOKE ALL ON FUNCTION public.list_conversations(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_conversations(text) TO authenticated;

-- ─── 6. Assertions ──────────────────────────────────────────────────────────
DO $assert$
BEGIN
  -- Old rows: all student, none linked (this file creates no listing thread).
  IF EXISTS (SELECT 1 FROM conversations WHERE kind = 'student' AND listing_id IS NOT NULL) THEN
    RAISE EXCEPTION 'a student thread carries a listing_id';
  END IF;
  -- The two partial unique indexes, read back from the catalog.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'conversations_one_live_per_pair'
                  AND indexdef LIKE 'CREATE UNIQUE INDEX%(pair_lo, pair_hi)%kind = ''student''%') THEN
    RAISE EXCEPTION 'conversations_one_live_per_pair is not the student-scoped unique index';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'conversations_one_live_per_listing'
                  AND indexdef LIKE 'CREATE UNIQUE INDEX%(pair_lo, pair_hi, listing_id)%kind = ''listing''%') THEN
    RAISE EXCEPTION 'conversations_one_live_per_listing missing';
  END IF;
  -- Grants: the internal reply path and the push sender are not client-callable; the two entry points are.
  IF has_function_privilege('authenticated', 'public.send_listing_message(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.notify_new_message(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'send_listing_message / notify_new_message must not be client-callable';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.start_listing_conversation(uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.list_conversations(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'positive control: start_listing_conversation / list_conversations must be callable';
  END IF;
  IF to_regprocedure('public.list_conversations()') IS NOT NULL THEN
    RAISE EXCEPTION 'the zero-argument list_conversations() must be gone (one function, defaulted argument)';
  END IF;
  -- The age rule and the Student Hub gates are still in the paths that need them.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.start_listing_conversation(uuid,text)')
                  AND prosrc LIKE '%NOT may_initiate_by_age(v_me, v_seller)%') THEN
    RAISE EXCEPTION 'start_listing_conversation lost the age rule';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.send_message(uuid,text)')
                  AND prosrc LIKE '%IF NOT is_listed_student(v_them) THEN%' AND prosrc LIKE '%IF NOT can_see_student_lists() THEN%') THEN
    RAISE EXCEPTION 'send_message lost a Student Hub gate';
  END IF;
END $assert$;

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
VALUES ('20261184_marketplace_messaging.sql', 'c13bd082da484842bb53aa600b5d4a11b7eeb4fbc92a398868fdf53d04c865e8')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   verify_schema QUERY 1: the 20261184_marketplace_messaging rows must read OK.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   Only while no kind = 'listing' row exists: restore the four bodies from probe 42413063083 (DROP
--   list_conversations(text), re-create list_conversations()), DROP start_listing_conversation and
--   send_listing_message, re-create conversations_one_live_per_pair without the kind clause, DROP
--   conversations_one_live_per_listing / conversations_listing_idx, the two CHECKs, the FK and the two
--   columns; delete the schema_migrations_applied row.

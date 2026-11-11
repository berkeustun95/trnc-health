-- Student Hub messaging AS LIVE, for the marketplace migrations' regression tests.
-- Source: readonly probe run 42413063083 (supabase/probe_marketplace_baseline.sql, 2026-11-07,
-- PostgreSQL 17.6): every function body below is pg_get_functiondef output VERBATIM, policies are
-- pg_policies rows. Table DDL is 20261029's, matching the probe's columns and constraints.
-- NOT modelled (stated, not discovered): the word list (contains_blocked_term is a stub that
-- matches the single word 'yasakkelime'), get_my_role (stub), pg_net (records posts in _posts),
-- student onboarding (student_education/institutions carry only the columns is_listed_student reads).
-- Do not edit bodies by hand: regenerate from a fresh probe if production changes.

CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE public._posts (body jsonb);
CREATE FUNCTION net.http_post(url text, body jsonb, headers jsonb) RETURNS bigint LANGUAGE sql
  AS 'INSERT INTO public._posts VALUES (body) RETURNING 1::bigint';
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
  AS $j$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb $j$;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text, display_name text, avatar_url text, date_of_birth date,
  ugc_banned_until timestamptz, preferred_language text, push_token text,
  terms_version text);  -- profiles.terms_version (20261016); the live column, added for the Bandabuliya terms tests (20261190)
CREATE TABLE public.institutions (id uuid PRIMARY KEY, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.student_education (user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  institution_id uuid REFERENCES public.institutions(id), level text, listing_opt_in boolean NOT NULL DEFAULT false);
CREATE TABLE public.blocks (
  blocker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  origin text NOT NULL DEFAULT 'content' CHECK (origin = ANY (ARRAY['content'::text, 'person'::text])),
  PRIMARY KEY (blocker_id, blocked_id), CHECK (blocker_id <> blocked_id));
CREATE TABLE public.content_reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE, content_type text NOT NULL,
  content_id uuid NOT NULL, reason text NOT NULL, status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, title text NOT NULL, body text NOT NULL,
  read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), type text,
  conversation_id uuid);

CREATE TABLE public.conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  accepted_at     timestamptz,
  declined_at     timestamptz,
  closed_at       timestamptz,
  closed_by       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_message_at timestamptz,
  pair_lo uuid GENERATED ALWAYS AS
    (CASE WHEN initiator_id < recipient_id THEN initiator_id ELSE recipient_id END) STORED,
  pair_hi uuid GENERATED ALWAYS AS
    (CASE WHEN initiator_id < recipient_id THEN recipient_id ELSE initiator_id END) STORED,
  CONSTRAINT conversations_not_self CHECK (initiator_id <> recipient_id),
  CONSTRAINT conversations_not_both CHECK (accepted_at IS NULL OR declined_at IS NULL),
  CONSTRAINT conversations_closed_pair CHECK (closed_by IS NULL OR closed_at IS NOT NULL)
);
CREATE UNIQUE INDEX conversations_one_live_per_pair ON public.conversations USING btree (pair_lo, pair_hi)
  WHERE ((declined_at IS NULL) AND (closed_at IS NULL) AND (initiator_id IS NOT NULL) AND (recipient_id IS NOT NULL));
CREATE INDEX conversations_pair_idx ON public.conversations (pair_lo, pair_hi);
CREATE INDEX conversations_recipient_idx ON public.conversations (recipient_id, last_message_at DESC NULLS LAST);
CREATE INDEX conversations_initiator_idx ON public.conversations (initiator_id, last_message_at DESC NULLS LAST);
CREATE TABLE public.messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_display_name text NOT NULL,
  body                text NOT NULL CONSTRAINT messages_body_check CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  hidden_at           timestamptz,
  hidden_reason       text
);
CREATE INDEX messages_conversation_idx ON public.messages (conversation_id, created_at);
CREATE TABLE public.conversation_attempts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  outcome      text NOT NULL CHECK (outcome IN ('sent', 'refused')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $f$ SELECT coalesce((SELECT role FROM profiles WHERE id = auth.uid()), 'customer') $f$;
CREATE FUNCTION public.contains_blocked_term(p text) RETURNS boolean LANGUAGE sql IMMUTABLE
  AS $f$ SELECT p ~* '\myasakkelime\M' $f$;
CREATE OR REPLACE FUNCTION public.is_anonymous_session()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
$function$;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$function$;

CREATE OR REPLACE FUNCTION public.check_ugc_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_text   text;
  v_banned timestamptz;
BEGIN
  -- Nobody but an admin may create content that is already hidden.
  IF get_my_role() <> 'admin' THEN
    NEW.hidden_at     := NULL;
    NEW.hidden_reason := NULL;
  END IF;

  SELECT ugc_banned_until INTO v_banned FROM profiles WHERE id = auth.uid();
  IF v_banned IS NOT NULL AND v_banned > now() THEN
    RAISE EXCEPTION 'UGC_BANNED';
  END IF;

  v_text := to_jsonb(NEW) ->> TG_ARGV[0];
  IF v_text IS NOT NULL AND contains_blocked_term(v_text) THEN
    RAISE EXCEPTION 'BLOCKED_TERM';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_listed_student(p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Visible in the Student Hub = an opted-in enrolment at an institution that HAS a list
  -- (active, not Other), a display name, and no UGC ban. The institution join is the same
  -- one get_student_list uses; if the two ever differ, somebody can see without being seen.
  SELECT auth.uid() IS NOT NULL
     AND NOT is_anonymous_session()
     AND EXISTS (
    SELECT 1
      FROM student_education e
      JOIN profiles p     ON p.id = e.user_id
      JOIN institutions i ON i.id = e.institution_id AND i.is_active
                         AND i.id <> '00000000-0000-4000-b000-0000000000ff'
     WHERE e.user_id = p_user_id
       AND e.listing_opt_in
       AND p.display_name IS NOT NULL
       AND (p.ugc_banned_until IS NULL OR p.ugc_banned_until <= now())
  );
$function$;

CREATE OR REPLACE FUNCTION public.can_see_student_lists()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Unchanged in meaning from 20261026: a non-anonymous caller who is themselves listed.
  -- The `is_anonymous_session()` half stays HERE and is not pushed into
  -- is_listed_student, because it is a fact about the CALLER's session, not about a user.
  SELECT NOT public.is_anonymous_session()
     AND public.is_listed_student(auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.may_initiate_by_age(p_sender uuid, p_recipient uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sender    date;
  v_recipient date;
  v_cutoff    date := (current_date - interval '18 years')::date;  -- ADULT_AGE
BEGIN
  -- ⚠ TWO CLAUSES, AND THE SECOND ONE IS 20261036. Without it a guest — one tap from a
  --   cold start, no credentials — gets a minor/adult bit on any uuid they name. The
  --   first clause alone reads like "a real user is asking"; in this app it only means
  --   "a session exists", and signInAnonymously() makes one.
  IF auth.uid() IS NULL OR is_anonymous_session() THEN
    RETURN false;
  END IF;

  SELECT date_of_birth INTO v_sender    FROM profiles WHERE id = p_sender;
  SELECT date_of_birth INTO v_recipient FROM profiles WHERE id = p_recipient;

  -- Born AFTER the cutoff = younger than 18 = a minor.
  IF v_sender IS NOT NULL AND v_sender > v_cutoff THEN
    RETURN true;   -- the sender is a known minor
  END IF;
  IF v_recipient IS NOT NULL AND v_recipient <= v_cutoff THEN
    RETURN true;   -- the recipient is a known adult
  END IF;

  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.stamp_message_sender()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- The CALLER never supplies this. Whatever arrived is discarded.
  SELECT display_name INTO NEW.sender_display_name FROM profiles WHERE id = NEW.sender_id;
  IF NEW.sender_display_name IS NULL THEN
    RAISE EXCEPTION 'NO_DISPLAY_NAME';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_message_age_rule()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_initiator uuid;
  v_recipient uuid;
BEGIN
  SELECT initiator_id, recipient_id INTO v_initiator, v_recipient
    FROM conversations WHERE id = NEW.conversation_id;

  -- A deleted participant leaves a null here. Nothing can be sent into such a thread
  -- anyway (send_message requires both), so this is a belt on an already-closed path.
  IF v_initiator IS NULL OR v_recipient IS NULL THEN
    RAISE EXCEPTION 'CONVERSATION_CLOSED';
  END IF;

  IF NOT may_initiate_by_age(v_initiator, v_recipient) THEN
    RAISE EXCEPTION 'AGE_RULE';
  END IF;

  RETURN NEW;
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
                  AND initiator_id = v_me)
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

CREATE OR REPLACE FUNCTION public.list_conversations()
 RETURNS TABLE(conversation_id uuid, other_user_id uuid, display_name text, avatar_url text, is_accepted boolean, awaiting_me boolean, is_closed boolean, last_message_at timestamp with time zone, last_body text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL OR is_anonymous_session() THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT can_see_student_lists() THEN RAISE EXCEPTION 'NOT_LISTED'; END IF;

  RETURN QUERY
  SELECT c.id,
         o.id,
         o.display_name,
         o.avatar_url,
         c.accepted_at IS NOT NULL,
         -- Only the recipient is ever "awaiting me". The initiator is never told a
         -- decline happened, so for them an unaccepted thread simply has no reply.
         (c.recipient_id = v_me AND c.accepted_at IS NULL AND c.declined_at IS NULL),
         -- ► A BLOCK MUST READ AS "CLOSED", NEVER AS "GONE". block_user() closes the
         --   thread, so a block and a leave normally look identical here — which is the
         --   rule: the blocked party is told the conversation is closed, never that they
         --   were blocked. The older block_content_author() path does NOT close anything
         --   though, so without this clause a thread blocked from the review flow would
         --   sit in the list looking live while every send returned CONVERSATION_CLOSED.
         --   Note what this deliberately does NOT do: it does not FILTER the row out. A
         --   thread that vanishes when a leave would have left it visible is exactly the
         --   signal that tells somebody they were blocked.
         (c.closed_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM blocks b
                      WHERE (b.blocker_id = v_me AND b.blocked_id = o.id)
                         OR (b.blocker_id = o.id AND b.blocked_id = v_me))),
         c.last_message_at,
         -- The opener IS shown in full in-app even before acceptance: the recipient has
         -- to read it to decide. Push is the surface that stays blank, not this one.
         (SELECT m.body FROM messages m
           WHERE m.conversation_id = c.id AND m.deleted_at IS NULL AND m.hidden_at IS NULL
           ORDER BY m.created_at DESC LIMIT 1)
    FROM conversations c
    JOIN profiles o
      ON o.id = CASE WHEN c.initiator_id = v_me THEN c.recipient_id ELSE c.initiator_id END
   WHERE (c.initiator_id = v_me OR c.recipient_id = v_me)
     -- The leaver does not see what they left. The other party still does.
     AND c.closed_by IS DISTINCT FROM v_me
     -- A declined thread is gone from the decliner's list, and INVISIBLE AS DECLINED to
     -- the initiator: it drops out of their list too, reading as a conversation that was
     -- never answered rather than one that was refused.
     AND NOT (c.declined_at IS NOT NULL)
   ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.accept_conversation(p_conversation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c conversations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR is_anonymous_session() THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO c FROM conversations WHERE id = p_conversation_id;
  -- Only the RECIPIENT accepts. An initiator accepting their own opener would defeat
  -- accept-first entirely.
  IF c.id IS NULL OR c.recipient_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'NO_SUCH_CONVERSATION';
  END IF;
  IF c.declined_at IS NOT NULL OR c.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'CONVERSATION_CLOSED';
  END IF;
  UPDATE conversations SET accepted_at = coalesce(accepted_at, now()) WHERE id = c.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.decline_conversation(p_conversation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c conversations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR is_anonymous_session() THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO c FROM conversations WHERE id = p_conversation_id;
  IF c.id IS NULL OR c.recipient_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'NO_SUCH_CONVERSATION';
  END IF;
  IF c.accepted_at IS NOT NULL THEN
    -- Already accepted: the action you want is Leave. (conversations_not_both would
    -- refuse this anyway; saying so is friendlier than a constraint violation.)
    RAISE EXCEPTION 'ALREADY_ACCEPTED';
  END IF;
  UPDATE conversations SET declined_at = coalesce(declined_at, now()) WHERE id = c.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.leave_conversation(p_conversation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE c conversations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR is_anonymous_session() THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO c FROM conversations WHERE id = p_conversation_id;
  IF c.id IS NULL OR auth.uid() NOT IN (coalesce(c.initiator_id, '00000000-0000-0000-0000-000000000000'::uuid),
                                        coalesce(c.recipient_id, '00000000-0000-0000-0000-000000000000'::uuid)) THEN
    RAISE EXCEPTION 'NO_SUCH_CONVERSATION';
  END IF;
  UPDATE conversations
     SET closed_at = coalesce(closed_at, now()),
         closed_by = coalesce(closed_by, auth.uid())
   WHERE id = c.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_message(p_message_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR is_anonymous_session() THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  UPDATE messages SET deleted_at = coalesce(deleted_at, now())
   WHERE id = p_message_id AND sender_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_SUCH_MESSAGE';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.block_user(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL OR is_anonymous_session() THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_user_id IS NULL OR p_user_id = v_me THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'NO_SUCH_USER';
  END IF;

  -- ► origin = 'person' NAMES THIS ROW in the blocked list. Reached only from a profile
  --   page or a conversation, so the blocker already knows who this is by name.
  --
  -- ► ON CONFLICT DO NOTHING IS LOAD-BEARING AND MUST NOT BECOME DO UPDATE.
  --   If a row already exists it was a review-block, and upgrading it to 'person' would
  --   put a name on it — telling the blocker WHICH anonymous reviewer this was. Once
  --   'content', always 'content'. The cost is that a later person-block of the same
  --   individual shows as an unnamed row; the alternative is a leak.
  INSERT INTO blocks (blocker_id, blocked_id, origin) VALUES (v_me, p_user_id, 'person')
  ON CONFLICT DO NOTHING;

  UPDATE conversations
     SET closed_at = coalesce(closed_at, now()),
         closed_by = coalesce(closed_by, v_me)
   WHERE pair_lo = least(v_me, p_user_id) AND pair_hi = greatest(v_me, p_user_id)
     AND closed_at IS NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_blocks()
 RETURNS TABLE(blocked_id uuid, created_at timestamp with time zone, origin text, display_name text, avatar_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT b.blocked_id,
         b.created_at,
         b.origin,
         CASE WHEN b.origin = 'person' THEN p.display_name END,
         CASE WHEN b.origin = 'person' THEN p.avatar_url  END
    FROM blocks b
    LEFT JOIN profiles p ON p.id = b.blocked_id
   WHERE b.blocker_id = auth.uid()
   ORDER BY b.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.guard_message_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.body                IS DISTINCT FROM OLD.body
     OR NEW.sender_display_name IS DISTINCT FROM OLD.sender_display_name
     OR NEW.conversation_id     IS DISTINCT FROM OLD.conversation_id
     OR NEW.created_at          IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'MESSAGE_IMMUTABLE';
  END IF;

  -- ► sender_id GETS ITS OWN CLAUSE, AND THE REASON IS NOT COSMETIC.
  --   The flat `NEW.sender_id IS DISTINCT FROM OLD.sender_id` this started as also blocks
  --   the FOREIGN KEY'S OWN `ON DELETE SET NULL`, which Postgres performs as an ordinary
  --   UPDATE that fires this trigger. The effect is that delete_own_account RAISES for
  --   any user who has ever sent a message — account deletion, which we are obliged to
  --   honour, broken by a guard meant to protect the messages. Caught by the test that
  --   deletes an account, never by reading the trigger.
  --   So: a sender may become NULL (they left), and may never become anyone else.
  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id AND NEW.sender_id IS NOT NULL THEN
    RAISE EXCEPTION 'MESSAGE_IMMUTABLE';
  END IF;

  RETURN NEW;
END;
$function$;

-- ─── 6d. msg_50_touch_conversation ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS msg_10_stamp_sender       ON public.messages;
DROP TRIGGER IF EXISTS msg_20_age_rule           ON public.messages;
DROP TRIGGER IF EXISTS msg_30_ugc_screen         ON public.messages;
DROP TRIGGER IF EXISTS msg_40_immutable          ON public.messages;
DROP TRIGGER IF EXISTS msg_50_touch_conversation ON public.messages;

CREATE TRIGGER msg_10_stamp_sender
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.stamp_message_sender();

CREATE TRIGGER msg_20_age_rule
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_message_age_rule();

-- The EXISTING screening trigger, bound to this table's text column. No new matcher, no
-- second copy of the rule: `check_ugc_on_insert` reads `to_jsonb(NEW) ->> TG_ARGV[0]`,
-- which is why it needs no change to cover a table it has never seen. It also clears
-- hidden_at/hidden_reason for non-admins, so a client cannot post a pre-hidden message.
CREATE TRIGGER msg_30_ugc_screen
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.check_ugc_on_insert('body');

CREATE TRIGGER msg_40_immutable
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_message_immutable();

CREATE TRIGGER msg_50_touch_conversation
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_conversation();

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blocks_delete_own" ON public.blocks AS PERMISSIVE FOR DELETE TO public USING ((blocker_id = auth.uid()));
CREATE POLICY "blocks_insert_own" ON public.blocks AS PERMISSIVE FOR INSERT TO public WITH CHECK ((blocker_id = auth.uid()));
CREATE POLICY "blocks_read_own" ON public.blocks AS PERMISSIVE FOR SELECT TO public USING ((blocker_id = auth.uid()));
CREATE POLICY "no_anon_delete_blocks" ON public.blocks AS RESTRICTIVE FOR DELETE TO authenticated USING ((NOT is_anonymous_session()));
CREATE POLICY "no_anon_insert_blocks" ON public.blocks AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "no_anon_update_blocks" ON public.blocks AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT is_anonymous_session())) WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "conversations participant read" ON public.conversations AS PERMISSIVE FOR SELECT TO authenticated USING (((NOT is_anonymous_session()) AND (closed_by IS DISTINCT FROM auth.uid()) AND ((recipient_id = auth.uid()) OR ((initiator_id = auth.uid()) AND (declined_at IS NULL)))));
CREATE POLICY "no_anon_delete_conversations" ON public.conversations AS RESTRICTIVE FOR DELETE TO authenticated USING (false);
CREATE POLICY "no_anon_insert_conversations" ON public.conversations AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "no_anon_update_conversations" ON public.conversations AS RESTRICTIVE FOR UPDATE TO authenticated USING (false);
CREATE POLICY "messages admin hide reported" ON public.messages AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_admin() AND (EXISTS ( SELECT 1
   FROM content_reports cr
  WHERE ((cr.content_type = 'message'::text) AND (cr.content_id = messages.id)))))) WITH CHECK (is_admin());
CREATE POLICY "messages admin read reported" ON public.messages AS PERMISSIVE FOR SELECT TO authenticated USING ((is_admin() AND (EXISTS ( SELECT 1
   FROM content_reports cr
  WHERE ((cr.content_type = 'message'::text) AND (cr.content_id = messages.id))))));
CREATE POLICY "messages participant read" ON public.messages AS PERMISSIVE FOR SELECT TO authenticated USING (((deleted_at IS NULL) AND (hidden_at IS NULL) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND (NOT is_anonymous_session()) AND (c.closed_by IS DISTINCT FROM auth.uid()) AND ((c.recipient_id = auth.uid()) OR ((c.initiator_id = auth.uid()) AND (c.declined_at IS NULL))))))));
CREATE POLICY "no_anon_delete_messages" ON public.messages AS RESTRICTIVE FOR DELETE TO authenticated USING (false);
CREATE POLICY "no_anon_insert_messages" ON public.messages AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "no_anon_update_messages" ON public.messages AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT is_anonymous_session()));
REVOKE ALL ON public.conversations         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.messages              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.conversation_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT          ON public.conversations         TO authenticated;
GRANT SELECT, UPDATE  ON public.messages              TO authenticated;
GRANT SELECT          ON public.conversation_attempts TO authenticated;
REVOKE ALL ON FUNCTION public.notify_new_message(uuid) FROM PUBLIC, anon, authenticated;

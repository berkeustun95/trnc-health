-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20261066_notification_type.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- ORDER MATTERS. The six functions name notifications.type, so dropping the column first
-- makes every notification write fail with 42703. So: (1) put the six pre-20261066 bodies
-- back, verbatim from their source files, (2) THEN drop the CHECK and the column.
-- Also: redeploy send-duty-notification WITHOUT `type` BEFORE running this, and make sure
-- no OTA that selects `type` is live (the notifications list would 42703 → empty).
-- Loses: the type of every row (backfilled and new). Nothing else.
-- Apply: SQL Editor, Role = postgres, whole file ONCE.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- (1) insert_notification — restored verbatim from 20261004_appointments_removal.sql
CREATE OR REPLACE FUNCTION public.insert_notification(p_user_id uuid, p_title text, p_body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- ADMIN ONLY, as of 20261004. The other two branches keyed on appointments
  -- (owner to customer, and customer to owner) and both are gone with the table.
  -- This function accepts client-written title and body, which is the injection
  -- channel 20260923 closed for provider alerts by introducing notify_facility_owner.
  -- Narrowing it to admins closes what remained of it. Do not re-add a branch here
  -- to solve a notification problem: add a p_kind-style function instead.
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    INSERT INTO notifications (user_id, title, body) VALUES (p_user_id, p_title, p_body);
    RETURN;
  END IF;

  RAISE EXCEPTION 'permission denied';
END;
$function$;

-- (2) notify_facility_owner — restored verbatim from 20261004_appointments_removal.sql
CREATE OR REPLACE FUNCTION public.notify_facility_owner(p_facility_id uuid, p_kind text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  owner_id  uuid;
  fac_name  text;
  tok       text;
  plang     text;
  ttl       text;
  bdy       text;
  req       bigint;
BEGIN
  -- 'appointment' removed 20261004. STILL AN ENUM, not client-written text: the whole
  -- point of this function is that the client names a facility and a KIND the server
  -- interprets, never a recipient and never a title. If a second kind is ever added,
  -- add it here — do not accept p_title/p_body.
  IF p_kind NOT IN ('question') THEN
    RAISE EXCEPTION 'notify_facility_owner: unknown kind %', p_kind;
  END IF;

  SELECT provider_id, name INTO owner_id, fac_name
    FROM facilities WHERE id = p_facility_id;

  -- An unclaimed facility has nobody to notify. Not an error: most of the directory is
  -- unclaimed, and a customer asking a question there must not see a failure.
  IF owner_id IS NULL THEN RETURN; END IF;

  -- AUTHORIZATION, derived from the tables — never asserted by the caller. Reads a row
  -- the caller JUST inserted, so ordering matters at the call site: insert the question
  -- FIRST, then notify. That is how the caller already works.
  IF NOT EXISTS (SELECT 1 FROM questions
                  WHERE facility_id = p_facility_id AND customer_id = auth.uid()) THEN
    RAISE EXCEPTION 'notify_facility_owner: no question at this facility';
  END IF;

  -- The recipient's language, read here rather than in the client. This is bug 3: the
  -- old client read `prov.preferred_language` from a query RLS always emptied, so `lang`
  -- fell back to English every time, against a comment promising localisation.
  SELECT push_token, preferred_language INTO tok, plang
    FROM profiles WHERE id = owner_id;

  ttl := notify_owner_text(p_kind || '_title', plang);
  bdy := replace(notify_owner_text(p_kind || '_body', plang), '{name}', coalesce(fac_name, 'A facility'));

  INSERT INTO notifications (user_id, title, body) VALUES (owner_id, ttl, bdy);

  IF tok IS NOT NULL THEN
    SELECT net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      body    := jsonb_build_object('to', tok, 'title', ttl, 'body', bdy, 'sound', 'default'),
      headers := jsonb_build_object('Content-Type', 'application/json')) INTO req;
  END IF;

  -- Logged even when req IS NULL. "No token, so nothing was sent" is a DIFFERENT fact
  -- from "we never got here", and telling them apart is the whole reason that outage
  -- lasted 70 days. A NULL request_id row is evidence; a missing row is not.
  INSERT INTO push_log (user_id, kind, request_id) VALUES (owner_id, p_kind, req);
END $function$;

-- (3) notify_admins — restored verbatim from 20260923_server_side_notifications.sql
CREATE OR REPLACE FUNCTION public.notify_admins(p_kind text, p_ref_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r     record;
  ttl   text;
  bdy   text;
  label text;
  req   bigint;
  n     integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;

  IF p_kind = 'content_report' THEN
    -- Authorized by the reporter's OWN report row, which also supplies the label — so
    -- the caller cannot pick the words and cannot notify about a report it did not file.
    SELECT content_type INTO label FROM content_reports
      WHERE content_id = p_ref_id AND reporter_id = auth.uid()
      ORDER BY created_at DESC LIMIT 1;
    IF label IS NULL THEN
      RAISE EXCEPTION 'notify_admins: no report by this user for that content';
    END IF;
    ttl := 'Content reported';
    bdy := 'A ' || (CASE WHEN label = 'facility' THEN 'business listing' ELSE label END)
           || ' was reported and is awaiting review.';

  ELSIF p_kind = 'facility_submission' THEN
    -- create_facility_claim always writes a claim_requests row, in both the claim and
    -- the new-application flow, so this one predicate authorizes both.
    IF NOT EXISTS (SELECT 1 FROM claim_requests
                    WHERE facility_id = p_ref_id AND requester_id = auth.uid()) THEN
      RAISE EXCEPTION 'notify_admins: no submission by this user for that facility';
    END IF;
    SELECT name INTO label FROM facilities WHERE id = p_ref_id;
    ttl := 'New facility submission';
    bdy := coalesce(label, 'A facility') || ' submitted for review.';

  ELSE
    RAISE EXCEPTION 'notify_admins: unknown kind %', p_kind;
  END IF;

  FOR r IN SELECT id, push_token FROM profiles WHERE role = 'admin' LOOP
    INSERT INTO notifications (user_id, title, body) VALUES (r.id, ttl, bdy);
    req := NULL;
    IF r.push_token IS NOT NULL THEN
      SELECT net.http_post(
        url     := 'https://exp.host/--/api/v2/push/send',
        body    := jsonb_build_object('to', r.push_token, 'title', ttl, 'body', bdy, 'sound', 'default'),
        headers := jsonb_build_object('Content-Type', 'application/json')) INTO req;
    END IF;
    INSERT INTO push_log (user_id, kind, request_id) VALUES (r.id, p_kind, req);
    n := n + 1;
  END LOOP;

  RETURN n;
END $function$;

-- (4) notify_module_waitlist — restored verbatim from 20261034_waitlist_blast_not_anon.sql
CREATE OR REPLACE FUNCTION public.notify_module_waitlist(p_module text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r     record;
  tok   text;
  plang text;
  ttl   text;
  bdy   text;
  n     integer := 0;
BEGIN
  -- ⚠ THE GUARD THAT LET THE INTERNET IN, AND WHY IT READ AS CORRECT.
  --   It used to be `IF auth.uid() IS NOT NULL AND NOT is_admin()`, with a comment saying
  --   "postgres in the SQL editor (uid null) passes". That is true, and it is also true of
  --   the `anon` role: a request with no JWT has auth.uid() NULL too. The test was written
  --   to describe ONE caller and it matched TWO, one of which is the open internet.
  --
  --   current_setting('role') is what tells them apart. PostgREST does SET ROLE per
  --   request from the validated JWT (or the anon role when there is none), and that GUC
  --   survives SECURITY DEFINER — unlike current_user, which inside this function is the
  --   OWNER and therefore says 'postgres' no matter who called. Measured in PGlite:
  --       as anon           current_user=postgres  role=anon
  --       as authenticated  current_user=postgres  role=authenticated
  --       no SET ROLE       current_user=postgres  role=none
  --
  --   Written as a DENY LIST on purpose. An allow-list of what the SQL editor reports
  --   would be a guess about somebody else's connection string, and being wrong about it
  --   breaks go-live step 10 at the moment it is needed. Denying the two roles PostgREST
  --   can possibly be in cannot break the editor, and the NOTICE below prints the real
  --   value so the next person does not have to guess either.
  --
  --   ⚠ THIS IS DEFENCE IN DEPTH, NOT THE FIX. The fix is the REVOKE below: anon cannot
  --     call what it has no EXECUTE on. This guard is what holds if that grant is ever
  --     restored by a default-privilege change or a careless GRANT ... TO anon.
  IF NOT is_admin()
     AND coalesce(current_setting('role', true), 'none') IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'notify_module_waitlist: admin only (role=%)',
      coalesce(current_setting('role', true), 'none');
  END IF;

  -- Validate against the module keys MODULE_FLAGS declares. The module_waitlist CHECK
  -- itself is only a shape guard (^[a-zA-Z]{2,40}$ since 20260814), so THIS list is the
  -- only thing that rejects a typo'd module name.
  IF p_module NOT IN ('homeServices','grooming','garages','transport',
                      'insurance','pets','events','jobs','accommodation',
                      'explore','studentHub','towing','checkins') THEN
    RAISE EXCEPTION 'notify_module_waitlist: unknown module %', p_module;
  END IF;

  FOR r IN
    SELECT user_id FROM module_waitlist
    WHERE module = p_module AND notified_at IS NULL
  LOOP
    -- Stamp first so a mid-run error / retry never double-notifies this row.
    UPDATE module_waitlist SET notified_at = now()
      WHERE user_id = r.user_id AND module = p_module;

    SELECT push_token, preferred_language INTO tok, plang
      FROM profiles WHERE id = r.user_id;
    ttl := module_notif_text('title', p_module, plang);
    bdy := module_notif_text('body',  p_module, plang);

    INSERT INTO notifications (user_id, title, body) VALUES (r.user_id, ttl, bdy);
    IF tok IS NOT NULL THEN
      PERFORM net.http_post(
        url     := 'https://exp.host/--/api/v2/push/send',
        body    := jsonb_build_object('to', tok, 'title', ttl, 'body', bdy, 'sound', 'default'),
        headers := jsonb_build_object('Content-Type', 'application/json'));
    END IF;

    n := n + 1;
  END LOOP;

  RETURN n;
END;
$function$;

-- (5) notify_new_message — restored verbatim from 20261031_push_data_conversation.sql
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

-- (6) process_featured_expiring — restored verbatim from 20260809_featured_expiry_reminder.sql
CREATE OR REPLACE FUNCTION public.process_featured_expiring() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  r     record;
  tok   text;
  plang text;
  ttl   text;
  bdy   text;
BEGIN
  FOR r IN
    SELECT f.id, f.name, f.provider_id, f.featured_until
    FROM facilities f
    WHERE f.featured_until IS NOT NULL
      AND f.featured_until >  now()
      AND f.featured_until <= now() + interval '3 days'
      AND f.provider_id IS NOT NULL
      -- Not yet reminded THIS period. A new/extended featured_until pushes the
      -- threshold past the old reminded_at → self-re-arms even without the
      -- activation-path reset.
      AND (f.featured_reminded_at IS NULL
           OR f.featured_reminded_at < f.featured_until - interval '3 days')
  LOOP
    UPDATE facilities SET featured_reminded_at = now() WHERE id = r.id;

    SELECT push_token, preferred_language INTO tok, plang
      FROM profiles WHERE id = r.provider_id;
    ttl := featured_notif_text('featTitle', plang);
    bdy := replace(featured_notif_text('featBody', plang), '{date}',
                   to_char(r.featured_until, 'DD/MM/YYYY'));

    INSERT INTO notifications (user_id, title, body) VALUES (r.provider_id, ttl, bdy);
    IF tok IS NOT NULL THEN
      PERFORM net.http_post(
        url     := 'https://exp.host/--/api/v2/push/send',
        body    := jsonb_build_object('to', tok, 'title', ttl, 'body', bdy, 'sound', 'default'),
        headers := jsonb_build_object('Content-Type', 'application/json'));
    END IF;
  END LOOP;
END;
$function$;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications DROP COLUMN IF EXISTS type;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('insert_notification', 'uuid, text, text', '17c96b09dc11bd1843fc4bcd80f7ad55', 'cfa50ccdfc1db219b6626b212f8c6baf', 'admin_message'),
      ('notify_facility_owner', 'uuid, text', '2b587c63289b98cfda60e43bb619f412', 'c966f2a4c37938eb6c2d7fd1ca313538', 'question'),
      ('notify_admins', 'text, uuid', '4ad3d6f4e156d77cf34d1e08ff2e8682', 'd2d83c89a69568524e5a43ff8592dbcd', 'admin_alert'),
      ('notify_module_waitlist', 'text', 'a01c7354cf9afec8dee66b85c52ca3f3', '49f87d365afa6b3cc1f367ea120961bc', 'waitlist'),
      ('notify_new_message', 'uuid', '0502ad280b4851ed274dc58c90c44778', '9daa04e8ad5be2dd4c66ba4616bc2a32', 'message'),
      ('process_featured_expiring', '', 'fb6690a8b7bdbed61633d90bc8083343', '586b03b9b889cef47afe38e8a54cc62c', 'featured')
    ) AS t(fn, args, md5_old, md5_new, typ)
  LOOP
    IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.' || r.fn || '(' || r.args || ')'))
       IS DISTINCT FROM r.md5_old THEN
      RAISE EXCEPTION 'rollback 20261066: % was not restored to its pre-migration body', r.fn;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='notifications' AND column_name='type') THEN
    RAISE EXCEPTION 'rollback 20261066: notifications.type still exists';
  END IF;
END $$;

COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

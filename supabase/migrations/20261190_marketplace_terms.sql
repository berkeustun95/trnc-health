-- ═══════════════════════════════════════════════════════════════════════════
-- 20261190 — Bandabuliya: the terms must be accepted before posting or messaging (server side)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Berke: posting, editing, renewing or re-listing a listing, adding a photo to one, and sending a
-- Bandabuliya message are refused on the server when the account's accepted terms (profiles.terms_version) are
-- older than the floor below or missing. The app asks for the terms first; this makes a modified client unable to
-- skip that. Functions and triggers only: NO policy, grant on a table, storage policy, column or index changes.
-- Needs 20261183 and 20261184 applied (it re-creates six of their function bodies); refuses otherwise.
--
-- ─── THE FLOOR: ONE HELPER, ONE LINE ────────────────────────────────────────
--   public.i_have_marketplace_terms() answers for the CALLER only (no uuid argument, so it is never an oracle on
--   someone else's account; same shape as i_am_adult(), 20261183). The floor is the only date in this file, on the
--   one line of the helper that carries the text comparison. The comparison is plain text, as the client's
--   needsMarketplaceTerms does it; COLLATE "C" pins it to byte order so the database's locale cannot reorder it.
--   Raising the floor later = a new migration that re-creates this one function.
--
-- ─── WHO CAN NOW WRITE WHAT ─────────────────────────────────────────────────
--   Every refusal below raises the word TERMS_REQUIRED, and only for the signed-in person acting:
--   • Post (INSERT into marketplace_listings): refused without terms. Checked right after the sign-in check.
--   • Edit (UPDATE): refused when any item column (title, description, price_tl, is_free, category, condition,
--     district) changes, or when the status changes to anything but 'sold' (re-listing a sold item). Marking an
--     active listing sold, and the server-owned moves (hide / restore / delete / expiry / purge) change none of
--     those, so they keep working for a seller whose terms are missing. Decided on the OLD/NEW difference, not on
--     the trusted switch, so a client that fakes the switch gains nothing.
--   • Renew (renew_marketplace_listing): refused without terms.
--   • Add a photo (INSERT into marketplace_photos): refused without terms; deleting a photo and the storage
--     upload policy are untouched (see the note on orphan uploads below).
--   • Message: start_listing_conversation (right after the sign-in check) and send_listing_message (after the
--     check that the caller is in the thread, so a non-participant still gets NO_SUCH_CONVERSATION and the word
--     is no oracle on other people's threads) refuse without terms, BEFORE the safety-notice gate. Student Hub's
--     send_message / start_conversation are NOT replaced: their bodies are asserted byte-identical below.
--   Untouched, and asserted by tests with terms missing: report auto-hide, admin hide / restore, the nightly
--   maintenance (soft delete, purge), photo approve / reject (service role), the seller's own delete.
--   Also still allowed without terms (none of them is a post, an edit or a message): accept / decline / leave a
--   conversation, block, delete one's own message, and the file upload into one's own pending/ folder (an upload
--   with no photo row stays invisible and the nightly sweep removes it).
--   One side effect: a guest's photo-row insert now answers TERMS_REQUIRED (guests have no terms). It is still
--   refused; that guard never had a sign-in check, so there is no AUTH_REQUIRED word to lose.
--   A photo row refused after its upload leaves one object in pending/<uid>/…; marketplace_orphan_objects
--   (20261185) lists it after 24 h and the nightly function removes it.
--
-- ⚠ Re-applying 20261183 or 20261184 AFTER this file restores their ungated bodies (their pre-flights do not pin
--   these six). Production's ledger refuses a recorded file, so only a hand-pasted run could do it; the
--   verify_schema H tokens of this file go red if it happens.
--
-- Apply: one supabase-migrate run (Berke approves production-db), after the 20261183/84/85 run has finished.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── 0. Pre-flight: the bodies replaced here are 20261183's / 20261184's, or this file's own (re-run) ─────
DO $pre$
DECLARE v_bad text;
BEGIN
  IF to_regclass('public.marketplace_listings') IS NULL OR to_regclass('public.marketplace_photos') IS NULL
     OR to_regprocedure('public.i_am_adult()') IS NULL
     OR to_regprocedure('public.send_listing_message(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: apply 20261183 and 20261184 first (Bandabuliya tables or functions missing). Nothing applied.';
  END IF;
  SELECT string_agg(f.sig || ' md5 ' || coalesce(md5(p.prosrc), 'MISSING'), '; ') INTO v_bad
    FROM (VALUES
      ('public.marketplace_listing_insert_guard()', '34e06554c3d8bd24d683842966745848', '1f7079d0a746e8d77ccbddbc4d37d30d'),
      ('public.marketplace_listing_update_guard()', 'ab6f6f344c0862b63c15e5a7a1719438', '2bcdd84608c396bdd2a8f997d55c14ee'),
      ('public.renew_marketplace_listing(uuid)', '8d5b434f409bba0820666058b9dee24c', '4822285b932310062f16a35064d3993e'),
      ('public.marketplace_photo_insert_guard()', 'be306a3e031efe80de03af633f07a96a', 'eb0da12c22290e39a00b05e07eef9ff5'),
      ('public.send_listing_message(uuid,text)', '3f94abb884a453910bccd567eca5f686', '34e243cc3d436d6f009ac03eadf76362'),
      ('public.start_listing_conversation(uuid,text)', '99deea220571b8fd72f757c1abde6646', 'f53b4ff3dceff3c34502c3314efa2010')
    ) AS f(sig, original, mine)
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(f.sig)
   WHERE p.prosrc IS NULL OR md5(p.prosrc) NOT IN (f.original, f.mine);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'REFUSING: live Bandabuliya bodies differ from 20261183/20261184 (apply those first, or re-derive): %. Nothing applied.', v_bad;
  END IF;
  -- Remembered for the assertions: the Student Hub bodies, and the full policy sets this file must not move.
  PERFORM set_config('mig1190.send_message', (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.send_message(uuid,text)')), true);
  PERFORM set_config('mig1190.start_conversation', (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.start_conversation(uuid,text)')), true);
  PERFORM set_config('mig1190.policies',
    (SELECT string_agg(schemaname || '.' || tablename || ':' || policyname || ':' || permissive || ':' || cmd, ', ' ORDER BY schemaname, tablename, policyname)
       FROM pg_policies WHERE (schemaname = 'public' AND tablename IN ('marketplace_listings', 'marketplace_photos'))
                           OR (schemaname = 'storage' AND tablename = 'objects')), true);
END $pre$;

-- ─── 1. The helper: did the CALLER accept the terms? ────────────────────────────────────────
-- STABLE SECURITY DEFINER (profiles is owner-read; the update guard below is a SECURITY INVOKER trigger, so this
-- must be executable by authenticated, as i_am_adult() is, and by service_role: a service-role UPDATE of a listing
-- (photo review, maintenance, SQL fixes) runs that trigger as service_role, so the grant is explicit and does not
-- lean on Supabase's default privileges). No session, no profile row, NULL → false.
CREATE OR REPLACE FUNCTION public.i_have_marketplace_terms()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce((SELECT p.terms_version IS NOT NULL AND p.terms_version COLLATE "C" >= '2026-11-11' FROM profiles p WHERE p.id = auth.uid()), false);
$function$;
REVOKE ALL ON FUNCTION public.i_have_marketplace_terms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.i_have_marketplace_terms() TO authenticated, service_role;

-- ─── 2. Listings: post, edit / relist, renew, photo ─────────────────────────────────────────
-- Each body below is 20261183's with only the TERMS_REQUIRED check added (CREATE OR REPLACE keeps owner, ACL and
-- the triggers that call them). The insert and photo guards are SECURITY DEFINER and the update guard is
-- SECURITY INVOKER, as before; all three ask for the CALLER (auth.uid()), which on these paths is the seller.
CREATE OR REPLACE FUNCTION public.marketplace_listing_insert_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.owner_id      := auth.uid();
  NEW.status        := 'active';
  NEW.sold_at       := NULL;
  NEW.created_at    := now();
  NEW.updated_at    := now();
  NEW.bumped_at     := now();
  NEW.expires_at    := now() + interval '30 days';
  NEW.deleted_at    := NULL;
  NEW.hidden_at     := NULL;
  NEW.hidden_reason := NULL;
  NEW.boosted_until := NULL;
  NEW.title         := btrim(NEW.title);
  NEW.description   := btrim(NEW.description);
  IF NEW.is_free THEN NEW.price_tl := NULL; END IF;

  IF NEW.owner_id IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT i_have_marketplace_terms() THEN
    RAISE EXCEPTION 'TERMS_REQUIRED';
  END IF;
  IF NOT i_am_adult() THEN
    RAISE EXCEPTION 'NOT_ADULT';
  END IF;
  IF (SELECT display_name FROM profiles WHERE id = NEW.owner_id) IS NULL THEN
    RAISE EXCEPTION 'NO_DISPLAY_NAME';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('marketplace_listing:' || NEW.owner_id::text));
  IF (SELECT count(*) FROM marketplace_listings
       WHERE owner_id = NEW.owner_id AND created_at > now() - interval '24 hours') >= 10 THEN
    RAISE EXCEPTION 'LISTING_RATE_LIMIT';
  END IF;
  IF (SELECT count(*) FROM marketplace_listings
       WHERE owner_id = NEW.owner_id AND status = 'active' AND deleted_at IS NULL AND expires_at > now()) >= 50 THEN
    RAISE EXCEPTION 'ACTIVE_LISTING_LIMIT';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.marketplace_listing_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_banned timestamptz; v_content_edit boolean;
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'MARKETPLACE_IMMUTABLE';
  END IF;
  IF (NEW.expires_at    IS DISTINCT FROM OLD.expires_at
      OR NEW.bumped_at  IS DISTINCT FROM OLD.bumped_at
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.hidden_at  IS DISTINCT FROM OLD.hidden_at
      OR NEW.hidden_reason IS DISTINCT FROM OLD.hidden_reason
      OR NEW.boosted_until IS DISTINCT FROM OLD.boosted_until)
     AND current_setting('app.trusted_marketplace', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'MARKETPLACE_SERVER_ONLY';
  END IF;
  -- Terms: the seller's own content edit or relist needs accepted terms. Decided on the OLD/NEW difference taken
  -- before this guard assigns anything, and never on the trusted switch: a path that moves only server-owned
  -- columns (hide, restore, delete, renew, expiry, purge) or only marks sold changes no item column and passes.
  -- auth.uid() NULL = no seller acting (service role, SQL editor): not this check's business.
  v_content_edit := ROW(NEW.title, NEW.description, NEW.price_tl, NEW.is_free, NEW.category, NEW.condition, NEW.district)
                    IS DISTINCT FROM ROW(OLD.title, OLD.description, OLD.price_tl, OLD.is_free, OLD.category, OLD.condition, OLD.district)
                 OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IS DISTINCT FROM 'sold');
  IF v_content_edit AND auth.uid() IS NOT NULL AND NOT i_have_marketplace_terms() THEN
    RAISE EXCEPTION 'TERMS_REQUIRED';
  END IF;
  IF NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description THEN
    SELECT ugc_banned_until INTO v_banned FROM profiles WHERE id = auth.uid();
    IF v_banned IS NOT NULL AND v_banned > now() THEN
      RAISE EXCEPTION 'UGC_BANNED';
    END IF;
    NEW.title := btrim(NEW.title);
    NEW.description := btrim(NEW.description);
    IF contains_blocked_term(NEW.title) OR contains_blocked_term(NEW.description) THEN
      RAISE EXCEPTION 'BLOCKED_TERM';
    END IF;
  END IF;
  IF NEW.is_free THEN NEW.price_tl := NULL; END IF;
  NEW.sold_at := CASE WHEN NEW.status = 'sold' THEN coalesce(OLD.sold_at, now()) END;
  IF ROW(NEW.title, NEW.description, NEW.price_tl, NEW.is_free, NEW.category, NEW.condition, NEW.district, NEW.status)
     IS DISTINCT FROM ROW(OLD.title, OLD.description, OLD.price_tl, OLD.is_free, OLD.category, OLD.condition, OLD.district, OLD.status) THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.renew_marketplace_listing(p_listing_id uuid)
 RETURNS timestamptz
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE l marketplace_listings%ROWTYPE; v_new timestamptz;
BEGIN
  IF auth.uid() IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT i_have_marketplace_terms() THEN
    RAISE EXCEPTION 'TERMS_REQUIRED';
  END IF;
  SELECT * INTO l FROM marketplace_listings
   WHERE id = p_listing_id AND owner_id = auth.uid() AND deleted_at IS NULL FOR UPDATE;
  IF l.id IS NULL THEN
    RAISE EXCEPTION 'NO_SUCH_LISTING';
  END IF;
  IF l.expires_at > now() + interval '3 days' THEN
    RAISE EXCEPTION 'TOO_EARLY_TO_RENEW';
  END IF;
  IF NOT i_am_adult() THEN
    RAISE EXCEPTION 'NOT_ADULT';
  END IF;
  IF l.expires_at <= now() AND l.status = 'active'
     AND (SELECT count(*) FROM marketplace_listings
           WHERE owner_id = auth.uid() AND status = 'active' AND deleted_at IS NULL AND expires_at > now()) >= 50 THEN
    RAISE EXCEPTION 'ACTIVE_LISTING_LIMIT';
  END IF;
  PERFORM set_config('app.trusted_marketplace', 'on', true);
  UPDATE marketplace_listings SET expires_at = now() + interval '30 days', bumped_at = now()
   WHERE id = l.id RETURNING expires_at INTO v_new;
  PERFORM set_config('app.trusted_marketplace', 'off', true);
  RETURN v_new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.marketplace_photo_insert_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.owner_id      := auth.uid();
  NEW.status        := 'pending';
  NEW.width         := NULL;
  NEW.height        := NULL;
  NEW.reject_reason := NULL;
  NEW.reviewed_by   := NULL;
  NEW.reviewed_at   := NULL;
  NEW.review_source := NULL;
  NEW.scan          := NULL;
  NEW.created_at    := now();
  IF NOT i_have_marketplace_terms() THEN
    RAISE EXCEPTION 'TERMS_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM marketplace_listings
                  WHERE id = NEW.listing_id AND owner_id = NEW.owner_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'NO_SUCH_LISTING';
  END IF;
  IF NEW.storage_path NOT LIKE 'pending/' || NEW.owner_id::text || '/' || NEW.listing_id::text || '/%' THEN
    RAISE EXCEPTION 'BAD_PHOTO_PATH';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('marketplace_photos:' || NEW.listing_id::text));
  IF (SELECT count(*) FROM marketplace_photos WHERE listing_id = NEW.listing_id AND status <> 'rejected') >= 8 THEN
    RAISE EXCEPTION 'PHOTO_LIMIT';
  END IF;
  RETURN NEW;
END;
$function$;

-- ─── 3. Messages: Bandabuliya threads only ──────────────────────────────────────────────────
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
  IF NOT i_have_marketplace_terms() THEN
    RAISE EXCEPTION 'TERMS_REQUIRED';
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
  IF NOT i_have_marketplace_terms() THEN
    RAISE EXCEPTION 'TERMS_REQUIRED';
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

-- CREATE OR REPLACE keeps the ACLs; stated again so this file does not depend on that.
REVOKE ALL ON FUNCTION public.marketplace_listing_insert_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.marketplace_listing_update_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.marketplace_photo_insert_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.send_listing_message(uuid, text) FROM PUBLIC, anon, authenticated;

-- ─── 4. Assertions ──────────────────────────────────────────────────────────────────────────
DO $assert$
DECLARE v_n int; v_names text; v_sig text;
BEGIN
  -- The helper: no uuid-taking overload (no oracle), authenticated yes (positive control), anon / PUBLIC no.
  IF to_regprocedure('public.i_have_marketplace_terms(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'i_have_marketplace_terms must take no argument';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.i_have_marketplace_terms()', 'EXECUTE') THEN
    RAISE EXCEPTION 'positive control: authenticated must be able to call i_have_marketplace_terms()';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.i_have_marketplace_terms()', 'EXECUTE') THEN
    RAISE EXCEPTION 'positive control: service_role must be able to call i_have_marketplace_terms() (the update guard runs as the caller)';
  END IF;
  IF has_function_privilege('anon', 'public.i_have_marketplace_terms()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not call i_have_marketplace_terms()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.i_have_marketplace_terms()')
                  AND prosecdef AND provolatile = 's' AND prosrc LIKE '%p.id = auth.uid()%') THEN
    RAISE EXCEPTION 'i_have_marketplace_terms is not a STABLE SECURITY DEFINER caller-only function';
  END IF;

  -- The six bodies carry the check, and none of them states the floor (it lives in the helper only).
  FOREACH v_sig IN ARRAY ARRAY['public.marketplace_listing_insert_guard()', 'public.marketplace_listing_update_guard()',
                               'public.renew_marketplace_listing(uuid)', 'public.marketplace_photo_insert_guard()',
                               'public.send_listing_message(uuid,text)', 'public.start_listing_conversation(uuid,text)'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure(v_sig)
                    AND prosrc LIKE '%NOT i_have_marketplace_terms() THEN%RAISE EXCEPTION ''TERMS_REQUIRED'';%') THEN
      RAISE EXCEPTION '% lacks the terms check', v_sig;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure(v_sig) AND prosrc LIKE '%terms_version%') THEN
      RAISE EXCEPTION '% states the floor itself; it belongs to the helper only', v_sig;
    END IF;
  END LOOP;
  -- Messages: the terms word comes before the safety-notice word, in both paths.
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid IN (to_regprocedure('public.send_listing_message(uuid,text)'), to_regprocedure('public.start_listing_conversation(uuid,text)'))
              AND NOT (strpos(prosrc, 'TERMS_REQUIRED') > 0 AND strpos(prosrc, 'TERMS_REQUIRED') < strpos(prosrc, 'NOTICE_REQUIRED'))) THEN
    RAISE EXCEPTION 'a message path checks the safety notice before the terms';
  END IF;
  -- The update guard is still SECURITY INVOKER (the helper grant above depends on it) and the triggers still point at the guards.
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.marketplace_listing_update_guard()') AND prosecdef) THEN
    RAISE EXCEPTION 'marketplace_listing_update_guard must stay SECURITY INVOKER';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND (tgrelid, tgname) IN (
        ('public.marketplace_listings'::regclass, 'mkt_10_insert_guard'), ('public.marketplace_listings'::regclass, 'mkt_30_update_guard'),
        ('public.marketplace_photos'::regclass, 'mkp_10_insert_guard'))) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'a Bandabuliya guard trigger is missing';
  END IF;

  -- Student Hub: send_message and start_conversation are byte-identical to before this file, and ask nothing of terms.
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.send_message(uuid,text)')) IS DISTINCT FROM current_setting('mig1190.send_message')
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.start_conversation(uuid,text)')) IS DISTINCT FROM current_setting('mig1190.start_conversation') THEN
    RAISE EXCEPTION 'a Student Hub body changed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE oid IN (to_regprocedure('public.send_message(uuid,text)'), to_regprocedure('public.start_conversation(uuid,text)'))
              AND prosrc LIKE '%TERMS_REQUIRED%') THEN
    RAISE EXCEPTION 'Student Hub must not ask for Bandabuliya terms';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.send_message(uuid,text)')
                  AND prosrc LIKE '%RETURN send_listing_message(p_conversation_id, p_body);%') THEN
    RAISE EXCEPTION 'send_message no longer hands a listing thread to send_listing_message';
  END IF;
  IF has_function_privilege('authenticated', 'public.send_listing_message(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.send_listing_message(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'send_listing_message must stay internal';
  END IF;

  -- No policy moved on any table this file touches (permissive-OR: the whole set, printed).
  SELECT string_agg(schemaname || '.' || tablename || ':' || policyname || ':' || permissive || ':' || cmd, ', ' ORDER BY schemaname, tablename, policyname), count(*)
    INTO v_names, v_n FROM pg_policies WHERE (schemaname = 'public' AND tablename IN ('marketplace_listings', 'marketplace_photos'))
                                            OR (schemaname = 'storage' AND tablename = 'objects');
  RAISE NOTICE 'policies on marketplace_listings, marketplace_photos, storage.objects (% total): %', v_n, v_names;
  IF v_names IS DISTINCT FROM current_setting('mig1190.policies') THEN
    RAISE EXCEPTION 'a policy changed during this file';
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
VALUES ('20261190_marketplace_terms.sql', 'b436cffa085b47c49d70b752becbdb3fee51682bd3c8b718367449acf62fa3fd')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   verify_schema QUERY 1: the 20261190_marketplace_terms rows must read OK.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   One BEGIN … COMMIT as postgres: re-create the six bodies below (20261183's and 20261184's, verbatim; the
--   REVOKEs above stay), DROP FUNCTION public.i_have_marketplace_terms(); delete the schema_migrations_applied
--   row. Nothing else of this file needs undoing (no table, policy or grant on a table moved).
--
--   ── public.marketplace_listing_insert_guard()
--   CREATE OR REPLACE FUNCTION public.marketplace_listing_insert_guard()
--    RETURNS trigger
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO 'public'
--   AS $function$
--   BEGIN
--     NEW.owner_id      := auth.uid();
--     NEW.status        := 'active';
--     NEW.sold_at       := NULL;
--     NEW.created_at    := now();
--     NEW.updated_at    := now();
--     NEW.bumped_at     := now();
--     NEW.expires_at    := now() + interval '30 days';
--     NEW.deleted_at    := NULL;
--     NEW.hidden_at     := NULL;
--     NEW.hidden_reason := NULL;
--     NEW.boosted_until := NULL;
--     NEW.title         := btrim(NEW.title);
--     NEW.description   := btrim(NEW.description);
--     IF NEW.is_free THEN NEW.price_tl := NULL; END IF;
--   
--     IF NEW.owner_id IS NULL OR is_anonymous_session() THEN
--       RAISE EXCEPTION 'AUTH_REQUIRED';
--     END IF;
--     IF NOT i_am_adult() THEN
--       RAISE EXCEPTION 'NOT_ADULT';
--     END IF;
--     IF (SELECT display_name FROM profiles WHERE id = NEW.owner_id) IS NULL THEN
--       RAISE EXCEPTION 'NO_DISPLAY_NAME';
--     END IF;
--   
--     PERFORM pg_advisory_xact_lock(hashtext('marketplace_listing:' || NEW.owner_id::text));
--     IF (SELECT count(*) FROM marketplace_listings
--          WHERE owner_id = NEW.owner_id AND created_at > now() - interval '24 hours') >= 10 THEN
--       RAISE EXCEPTION 'LISTING_RATE_LIMIT';
--     END IF;
--     IF (SELECT count(*) FROM marketplace_listings
--          WHERE owner_id = NEW.owner_id AND status = 'active' AND deleted_at IS NULL AND expires_at > now()) >= 50 THEN
--       RAISE EXCEPTION 'ACTIVE_LISTING_LIMIT';
--     END IF;
--     RETURN NEW;
--   END;
--   $function$;
--
--   ── public.marketplace_listing_update_guard()
--   CREATE OR REPLACE FUNCTION public.marketplace_listing_update_guard()
--    RETURNS trigger
--    LANGUAGE plpgsql
--    SET search_path TO 'public'
--   AS $function$
--   DECLARE v_banned timestamptz;
--   BEGIN
--     IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
--       RAISE EXCEPTION 'MARKETPLACE_IMMUTABLE';
--     END IF;
--     IF (NEW.expires_at    IS DISTINCT FROM OLD.expires_at
--         OR NEW.bumped_at  IS DISTINCT FROM OLD.bumped_at
--         OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
--         OR NEW.hidden_at  IS DISTINCT FROM OLD.hidden_at
--         OR NEW.hidden_reason IS DISTINCT FROM OLD.hidden_reason
--         OR NEW.boosted_until IS DISTINCT FROM OLD.boosted_until)
--        AND current_setting('app.trusted_marketplace', true) IS DISTINCT FROM 'on' THEN
--       RAISE EXCEPTION 'MARKETPLACE_SERVER_ONLY';
--     END IF;
--     IF NEW.title IS DISTINCT FROM OLD.title OR NEW.description IS DISTINCT FROM OLD.description THEN
--       SELECT ugc_banned_until INTO v_banned FROM profiles WHERE id = auth.uid();
--       IF v_banned IS NOT NULL AND v_banned > now() THEN
--         RAISE EXCEPTION 'UGC_BANNED';
--       END IF;
--       NEW.title := btrim(NEW.title);
--       NEW.description := btrim(NEW.description);
--       IF contains_blocked_term(NEW.title) OR contains_blocked_term(NEW.description) THEN
--         RAISE EXCEPTION 'BLOCKED_TERM';
--       END IF;
--     END IF;
--     IF NEW.is_free THEN NEW.price_tl := NULL; END IF;
--     NEW.sold_at := CASE WHEN NEW.status = 'sold' THEN coalesce(OLD.sold_at, now()) END;
--     IF ROW(NEW.title, NEW.description, NEW.price_tl, NEW.is_free, NEW.category, NEW.condition, NEW.district, NEW.status)
--        IS DISTINCT FROM ROW(OLD.title, OLD.description, OLD.price_tl, OLD.is_free, OLD.category, OLD.condition, OLD.district, OLD.status) THEN
--       NEW.updated_at := now();
--     END IF;
--     RETURN NEW;
--   END;
--   $function$;
--
--   ── public.renew_marketplace_listing(uuid)
--   CREATE OR REPLACE FUNCTION public.renew_marketplace_listing(p_listing_id uuid)
--    RETURNS timestamptz
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO 'public'
--   AS $function$
--   DECLARE l marketplace_listings%ROWTYPE; v_new timestamptz;
--   BEGIN
--     IF auth.uid() IS NULL OR is_anonymous_session() THEN
--       RAISE EXCEPTION 'AUTH_REQUIRED';
--     END IF;
--     SELECT * INTO l FROM marketplace_listings
--      WHERE id = p_listing_id AND owner_id = auth.uid() AND deleted_at IS NULL FOR UPDATE;
--     IF l.id IS NULL THEN
--       RAISE EXCEPTION 'NO_SUCH_LISTING';
--     END IF;
--     IF l.expires_at > now() + interval '3 days' THEN
--       RAISE EXCEPTION 'TOO_EARLY_TO_RENEW';
--     END IF;
--     IF NOT i_am_adult() THEN
--       RAISE EXCEPTION 'NOT_ADULT';
--     END IF;
--     IF l.expires_at <= now() AND l.status = 'active'
--        AND (SELECT count(*) FROM marketplace_listings
--              WHERE owner_id = auth.uid() AND status = 'active' AND deleted_at IS NULL AND expires_at > now()) >= 50 THEN
--       RAISE EXCEPTION 'ACTIVE_LISTING_LIMIT';
--     END IF;
--     PERFORM set_config('app.trusted_marketplace', 'on', true);
--     UPDATE marketplace_listings SET expires_at = now() + interval '30 days', bumped_at = now()
--      WHERE id = l.id RETURNING expires_at INTO v_new;
--     PERFORM set_config('app.trusted_marketplace', 'off', true);
--     RETURN v_new;
--   END;
--   $function$;
--
--   ── public.marketplace_photo_insert_guard()
--   CREATE OR REPLACE FUNCTION public.marketplace_photo_insert_guard()
--    RETURNS trigger
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO 'public'
--   AS $function$
--   BEGIN
--     NEW.owner_id      := auth.uid();
--     NEW.status        := 'pending';
--     NEW.width         := NULL;
--     NEW.height        := NULL;
--     NEW.reject_reason := NULL;
--     NEW.reviewed_by   := NULL;
--     NEW.reviewed_at   := NULL;
--     NEW.review_source := NULL;
--     NEW.scan          := NULL;
--     NEW.created_at    := now();
--     IF NOT EXISTS (SELECT 1 FROM marketplace_listings
--                     WHERE id = NEW.listing_id AND owner_id = NEW.owner_id AND deleted_at IS NULL) THEN
--       RAISE EXCEPTION 'NO_SUCH_LISTING';
--     END IF;
--     IF NEW.storage_path NOT LIKE 'pending/' || NEW.owner_id::text || '/' || NEW.listing_id::text || '/%' THEN
--       RAISE EXCEPTION 'BAD_PHOTO_PATH';
--     END IF;
--     PERFORM pg_advisory_xact_lock(hashtext('marketplace_photos:' || NEW.listing_id::text));
--     IF (SELECT count(*) FROM marketplace_photos WHERE listing_id = NEW.listing_id AND status <> 'rejected') >= 8 THEN
--       RAISE EXCEPTION 'PHOTO_LIMIT';
--     END IF;
--     RETURN NEW;
--   END;
--   $function$;
--
--   ── public.send_listing_message(uuid,text)
--   CREATE OR REPLACE FUNCTION public.send_listing_message(p_conversation_id uuid, p_body text)
--    RETURNS text
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO 'public'
--   AS $function$
--   DECLARE
--     v_me   uuid := auth.uid();
--     v_body text := btrim(coalesce(p_body, ''));
--     c      conversations%ROWTYPE;
--     v_them uuid;
--     v_msg  uuid;
--   BEGIN
--     IF v_me IS NULL OR is_anonymous_session() THEN
--       RAISE EXCEPTION 'AUTH_REQUIRED';
--     END IF;
--     IF char_length(v_body) < 1 OR char_length(v_body) > 1000 THEN
--       RAISE EXCEPTION 'BODY_LENGTH';
--     END IF;
--     SELECT * INTO c FROM conversations WHERE id = p_conversation_id AND kind = 'listing';
--     IF c.id IS NULL OR v_me NOT IN (coalesce(c.initiator_id, '00000000-0000-0000-0000-000000000000'::uuid),
--                                     coalesce(c.recipient_id, '00000000-0000-0000-0000-000000000000'::uuid)) THEN
--       RAISE EXCEPTION 'NO_SUCH_CONVERSATION';
--     END IF;
--     IF (SELECT marketplace_notice_at FROM profiles WHERE id = v_me) IS NULL THEN
--       RAISE EXCEPTION 'NOTICE_REQUIRED';
--     END IF;
--     v_them := CASE WHEN c.initiator_id = v_me THEN c.recipient_id ELSE c.initiator_id END;
--     IF c.closed_at IS NOT NULL OR v_them IS NULL THEN
--       RAISE EXCEPTION 'CONVERSATION_CLOSED';
--     END IF;
--     IF EXISTS (SELECT 1 FROM blocks
--                 WHERE (blocker_id = v_me AND blocked_id = v_them)
--                    OR (blocker_id = v_them AND blocked_id = v_me)) THEN
--       RAISE EXCEPTION 'CONVERSATION_CLOSED';
--     END IF;
--     IF c.initiator_id = v_me THEN
--       IF c.accepted_at IS NULL THEN
--         RAISE EXCEPTION 'AWAITING_ACCEPTANCE';
--       END IF;
--     ELSE
--       IF c.declined_at IS NOT NULL THEN
--         RAISE EXCEPTION 'CONVERSATION_CLOSED';
--       END IF;
--       IF c.accepted_at IS NULL THEN
--         UPDATE conversations SET accepted_at = now() WHERE id = c.id;
--       END IF;
--     END IF;
--     INSERT INTO messages (conversation_id, sender_id, sender_display_name, body)
--     VALUES (c.id, v_me, '-', v_body)
--     RETURNING id INTO v_msg;
--     PERFORM notify_new_message(v_msg);
--     RETURN 'sent';
--   END;
--   $function$;
--
--   ── public.start_listing_conversation(uuid,text)
--   CREATE OR REPLACE FUNCTION public.start_listing_conversation(p_listing_id uuid, p_body text)
--    RETURNS text
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO 'public'
--   AS $function$
--   DECLARE
--     v_me      uuid := auth.uid();
--     v_body    text := btrim(coalesce(p_body, ''));
--     v_seller  uuid;
--     v_refused boolean;
--     v_conv    uuid;
--     v_msg     uuid;
--   BEGIN
--     IF v_me IS NULL OR is_anonymous_session() THEN
--       RAISE EXCEPTION 'AUTH_REQUIRED';
--     END IF;
--     IF char_length(v_body) < 1 OR char_length(v_body) > 1000 THEN
--       RAISE EXCEPTION 'BODY_LENGTH';
--     END IF;
--     SELECT owner_id INTO v_seller FROM marketplace_listings
--      WHERE id = p_listing_id AND status = 'active' AND deleted_at IS NULL AND hidden_at IS NULL AND expires_at > now();
--     IF v_seller IS NULL THEN
--       RAISE EXCEPTION 'NO_SUCH_LISTING';
--     END IF;
--     IF v_seller = v_me THEN
--       RAISE EXCEPTION 'OWN_LISTING';
--     END IF;
--     IF (SELECT marketplace_notice_at FROM profiles WHERE id = v_me) IS NULL THEN
--       RAISE EXCEPTION 'NOTICE_REQUIRED';
--     END IF;
--     IF EXISTS (
--       SELECT 1 FROM conversations
--        WHERE kind = 'listing' AND listing_id = p_listing_id
--          AND pair_lo = least(v_me, v_seller) AND pair_hi = greatest(v_me, v_seller)
--          AND declined_at IS NULL AND closed_at IS NULL
--     ) THEN
--       RAISE EXCEPTION 'CONVERSATION_EXISTS';
--     END IF;
--     -- The same 24 h cap as Student Hub, on the same table: one budget for both.
--     IF (SELECT count(*) FROM conversation_attempts
--          WHERE initiator_id = v_me AND created_at > now() - interval '24 hours') >= 50 THEN
--       RAISE EXCEPTION 'RATE_LIMITED';
--     END IF;
--   
--     v_refused :=
--          EXISTS (SELECT 1 FROM blocks
--                   WHERE (blocker_id = v_me AND blocked_id = v_seller)
--                      OR (blocker_id = v_seller AND blocked_id = v_me))
--       OR EXISTS (SELECT 1 FROM conversations
--                   WHERE kind = 'listing' AND listing_id = p_listing_id
--                     AND pair_lo = least(v_me, v_seller) AND pair_hi = greatest(v_me, v_seller)
--                     AND declined_at IS NOT NULL AND initiator_id = v_me)
--       OR NOT may_initiate_by_age(v_me, v_seller);
--   
--     INSERT INTO conversation_attempts (initiator_id, recipient_id, outcome)
--     VALUES (v_me, v_seller, CASE WHEN v_refused THEN 'refused' ELSE 'sent' END);
--   
--     IF v_refused THEN
--       RETURN 'refused';
--     END IF;
--   
--     BEGIN
--       INSERT INTO conversations (initiator_id, recipient_id, kind, listing_id)
--       VALUES (v_me, v_seller, 'listing', p_listing_id)
--       RETURNING id INTO v_conv;
--     EXCEPTION WHEN unique_violation THEN
--       RAISE EXCEPTION 'CONVERSATION_EXISTS';
--     END;
--   
--     INSERT INTO messages (conversation_id, sender_id, sender_display_name, body)
--     VALUES (v_conv, v_me, '-', v_body)
--     RETURNING id INTO v_msg;
--   
--     PERFORM notify_new_message(v_msg);
--     RETURN 'sent';
--   END;
--   $function$;

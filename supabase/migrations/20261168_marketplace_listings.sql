-- ═══════════════════════════════════════════════════════════════════════════
-- 20261168 — Dükkân (marketplace): listings, photos (private bucket), reports, safety notice
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Plan: vault 10-ada/2026-11-07_marketplace-plan.md (approved by Berke 2026-11-07). The app is behind
-- MODULE_FLAGS.marketplace (dark; dev + ADA Preview only). Chat is 20261169, maintenance cron 20261170.
--
-- ⚠ BUILDS ON ARAÇLAR S1 (20261164-20261167, a parallel session): private.is_adult_on() (Berke 2026-11-07: one
--   SQL home for the adult age), the 8-value content_reports_content_type_check ('vehicle') and the auto-hide
--   body with the vehicle branch. The pre-flight REFUSES until those are live; apply this run after Araçlar's.
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
-- marketplace_listings
--   SELECT  Any signed-in session, guests included (browse only): a listing that is active or sold, not
--           deleted, not hidden, not expired, and whose seller is not in a block with the reader either
--           way. The seller also reads their own non-deleted listings in any state (hidden, expired).
--           Admins read everything. Sold listings stay readable so a chat can show them as "Satıldı";
--           the app's browse query asks for status = 'active' only.
--   INSERT  Signed-in, NOT a guest, 18+ by date of birth (i_am_adult(), unknown DOB = refused), with a
--           display name, not UGC-banned, word filter clean, at most 10 new listings per 24 h and 50 live
--           ones. Only the item columns are granted; owner_id comes from DEFAULT auth.uid().
--   UPDATE  The seller edits the item columns and status (active/sold) of their own non-deleted listing.
--           Column grants keep hidden_*, expires_at, bumped_at, deleted_at and boosted_until out of
--           every client's reach; those change only inside the SECURITY DEFINER functions below.
--   DELETE  Nobody. The seller soft-deletes with delete_marketplace_listing(); rows are purged 30 days
--           later unless a report on them is still pending (marketplace-maintenance, 20261170).
-- marketplace_photos
--   SELECT  The seller sees their own photos in any status. Admins see all. Everyone else sees an
--           APPROVED photo of a listing they can see (the subquery runs under the listing policies).
--   INSERT  The seller, not a guest, 18+, for their own non-deleted listing, at most 8 live photos, path
--           pending/<their uid>/<listing id>/…; status is forced to 'pending'.
--   DELETE  The seller, own rows. UPDATE: nobody — approval is the marketplace-photo-review function
--           (service role), which re-encodes the image (EXIF/GPS stripped) and rewrites the row.
-- storage bucket marketplace-photos — PRIVATE (signed URLs only, no public URL ever)
--   INSERT  The seller into pending/<their uid>/…, 18+, not a guest.
--   SELECT  Whoever may SELECT the photo row whose storage_path is that object (delegated to the table
--           policies above). No UPDATE/DELETE policy: deletes go through the Storage API with the
--           service key (storage.protect_delete blocks SQL deletes, probe 42413063083).
-- content_reports gains 'listing' and the reason 'prohibited_item'; ONE report auto-hides a listing
--   (Berke 2026-11-07; every other type needs 3 — accepted griefing risk, bounded by the 20/day report
--   cap and the 24 h SLA; an admin restores with admin_set_listing_hidden()).
-- profiles gains marketplace_notice_at/_version, written only by accept_marketplace_notice().
-- notifications.type gains 'marketplace' (photo rejected, listing removed).
--
-- boosted_until exists for a later paid "öne çıkar"; nothing reads or writes it yet.
--
-- Apply: one supabase-migrate run with 20261169 and 20261170, after Araçlar S1 (Berke approves production-db).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── 0. Pre-flight: the bodies and constraints this file replaces are the probed ones ─────────
DO $pre$
DECLARE v_md5 text; v_def text;
BEGIN
  IF to_regprocedure('private.is_adult_on(date,date)') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: private.is_adult_on(date,date) is missing — apply Araçlar 20261164 first. Nothing applied.';
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.auto_hide_reported_content()');
  -- 760d… = Araçlar 20261166's body (vehicle branch); the second value is this file's own body (re-run).
  IF v_md5 IS NULL OR v_md5 NOT IN ('760dc1dec2fd8ce4de8467584f6bf6fc', '2915343fc069c2aa745ff418ddc853ad') THEN
    RAISE EXCEPTION 'REFUSING: live auto_hide_reported_content body (md5 %) is not Araçlar 20261166''s — apply that first or re-derive. Nothing applied.', v_md5;
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conname = 'content_reports_content_type_check'
     AND conrelid = 'public.content_reports'::regclass;
  IF v_def IS DISTINCT FROM 'CHECK ((content_type = ANY (ARRAY[''answer''::text, ''facility''::text, ''message''::text, ''place''::text, ''profile''::text, ''question''::text, ''review''::text, ''vehicle''::text])))'
     AND v_def IS DISTINCT FROM 'CHECK ((content_type = ANY (ARRAY[''answer''::text, ''facility''::text, ''listing''::text, ''message''::text, ''place''::text, ''profile''::text, ''question''::text, ''review''::text, ''vehicle''::text])))' THEN
    RAISE EXCEPTION 'REFUSING: content_reports_content_type_check is %, not Araçlar''s 8-value list. Nothing applied.', v_def;
  END IF;
  PERFORM set_config('mig1168.storage_policies',
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname NOT IN ('marketplace photos upload own pending', 'marketplace photos read via row'))::text, true);
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint WHERE conname = 'notifications_type_check'
     AND conrelid = 'public.notifications'::regclass;
  IF v_def IS DISTINCT FROM 'CHECK ((type = ANY (ARRAY[''duty''::text, ''message''::text, ''waitlist''::text, ''question''::text, ''admin_alert''::text, ''admin_message''::text, ''featured''::text, ''general''::text])))'
     AND v_def IS DISTINCT FROM 'CHECK ((type = ANY (ARRAY[''duty''::text, ''message''::text, ''waitlist''::text, ''question''::text, ''admin_alert''::text, ''admin_message''::text, ''featured''::text, ''general''::text, ''marketplace''::text])))' THEN
    RAISE EXCEPTION 'REFUSING: notifications_type_check is %, not the probed list. Nothing applied.', v_def;
  END IF;
END $pre$;

-- ─── 1. 18+ for the CALLER only (no uuid argument: never an age oracle on someone else) ─────────
-- The age itself is private.is_adult_on() (Araçlar 20261164, the one SQL home of ADULT_AGE), on the
-- Europe/Istanbul date as the vehicles guard. Unknown DOB, guest, no session → false.
CREATE OR REPLACE FUNCTION public.i_am_adult()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND NOT is_anonymous_session()
     AND coalesce((SELECT private.is_adult_on(p.date_of_birth, (now() AT TIME ZONE 'Europe/Istanbul')::date)
                     FROM profiles p WHERE p.id = auth.uid()), false);
$function$;
REVOKE ALL ON FUNCTION public.i_am_adult() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.i_am_adult() TO authenticated;

-- A block between the caller and p_other, either direction. blocks_read_own only shows the caller's own
-- rows, so a policy could not see "they blocked me" without this. Returns nothing about third parties.
CREATE OR REPLACE FUNCTION public.marketplace_blocked_with(p_other uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM blocks
     WHERE (blocker_id = auth.uid() AND blocked_id = p_other)
        OR (blocker_id = p_other AND blocked_id = auth.uid()));
$function$;
REVOKE ALL ON FUNCTION public.marketplace_blocked_with(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketplace_blocked_with(uuid) TO authenticated;

-- ─── 2. Safety notice (before a user's first marketplace chat) ──────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS marketplace_notice_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS marketplace_notice_version text;

CREATE OR REPLACE FUNCTION public.guard_marketplace_notice_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.marketplace_notice_at IS DISTINCT FROM OLD.marketplace_notice_at
      OR NEW.marketplace_notice_version IS DISTINCT FROM OLD.marketplace_notice_version)
     AND current_setting('app.trusted_marketplace_notice', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'MARKETPLACE_NOTICE_SERVER_ONLY';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS guard_marketplace_notice_columns ON public.profiles;
CREATE TRIGGER guard_marketplace_notice_columns BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_marketplace_notice_columns();

CREATE OR REPLACE FUNCTION public.accept_marketplace_notice(p_version text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rows int;
BEGIN
  IF auth.uid() IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF p_version IS NULL OR p_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'BAD_VERSION';
  END IF;
  PERFORM set_config('app.trusted_marketplace_notice', 'on', true);
  UPDATE profiles SET marketplace_notice_at = now(), marketplace_notice_version = p_version
   WHERE id = auth.uid();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM set_config('app.trusted_marketplace_notice', 'off', true);
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.accept_marketplace_notice(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_marketplace_notice(text) TO authenticated;

-- ─── 3. Listings ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketplace_listings (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  owner_id      uuid        NOT NULL DEFAULT auth.uid(),
  title         text        NOT NULL,
  description   text        NOT NULL,
  price_tl      integer,
  is_free       boolean     NOT NULL DEFAULT false,
  category      text        NOT NULL,
  condition     text        NOT NULL,
  district      text        NOT NULL,
  status        text        NOT NULL DEFAULT 'active',
  sold_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  bumped_at     timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  deleted_at    timestamptz,
  hidden_at     timestamptz,
  hidden_reason text,
  boosted_until timestamptz,
  CONSTRAINT marketplace_listings_pkey PRIMARY KEY (id),
  CONSTRAINT marketplace_listings_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT marketplace_listings_title_check CHECK (char_length(btrim(title)) BETWEEN 5 AND 70),
  CONSTRAINT marketplace_listings_description_check CHECK (char_length(btrim(description)) BETWEEN 10 AND 1500),
  -- IS NOT NULL spelled out: with price_tl NULL, "price_tl BETWEEN …" is NULL and a NULL CHECK passes.
  CONSTRAINT marketplace_listings_price_check CHECK (
    (is_free AND price_tl IS NULL) OR (NOT is_free AND price_tl IS NOT NULL AND price_tl BETWEEN 1 AND 1000000)),
  -- constants/marketplace.js MARKETPLACE_CATEGORIES mirrors this list. No vehicles, no real estate.
  CONSTRAINT marketplace_listings_category_check CHECK (category IN (
    'electronics', 'home', 'appliances', 'fashion', 'baby_kids', 'sports', 'books', 'hobby_music',
    'garden_diy', 'vehicle_parts', 'pet_supplies', 'other')),
  CONSTRAINT marketplace_listings_condition_check CHECK (condition IN ('new', 'like_new', 'used')),
  -- The six official districts = constants/homeServices.js HS_DISTRICTS (Karpaz sellers pick İskele).
  CONSTRAINT marketplace_listings_district_check CHECK (district IN (
    'nicosia', 'kyrenia', 'famagusta', 'morphou', 'iskele', 'lefke')),
  CONSTRAINT marketplace_listings_status_check CHECK (status IN ('active', 'sold')),
  CONSTRAINT marketplace_listings_hidden_reason_check CHECK (
    hidden_reason IS NULL OR hidden_reason IN ('auto_reports', 'admin_removed'))
);

CREATE INDEX IF NOT EXISTS marketplace_listings_browse_idx
  ON public.marketplace_listings (bumped_at DESC) WHERE deleted_at IS NULL AND hidden_at IS NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS marketplace_listings_owner_idx ON public.marketplace_listings (owner_id, created_at DESC);

COMMENT ON TABLE public.marketplace_listings IS
  'Dükkân: items users sell to each other (no payments in ADA; buyer and seller agree in chat). Sellers 18+. '
  'Item columns are client-writable by the owner; moderation, expiry, deletion and boost only via SECURITY '
  'DEFINER functions. One report auto-hides. Soft delete, purged 30 days later unless a report is pending. 20261168.';
COMMENT ON COLUMN public.marketplace_listings.boosted_until IS
  'Reserved for a paid "öne çıkar" boost. Unused: no grant, no reader, no writer (20261168).';

ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.marketplace_listings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.marketplace_listings TO authenticated;
GRANT INSERT (title, description, price_tl, is_free, category, condition, district)
  ON public.marketplace_listings TO authenticated;
GRANT UPDATE (title, description, price_tl, is_free, category, condition, district, status)
  ON public.marketplace_listings TO authenticated;

DROP POLICY IF EXISTS "marketplace listings public read" ON public.marketplace_listings;
CREATE POLICY "marketplace listings public read" ON public.marketplace_listings
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND hidden_at IS NULL AND expires_at > now()
         AND NOT marketplace_blocked_with(owner_id));
DROP POLICY IF EXISTS "marketplace listings owner read" ON public.marketplace_listings;
CREATE POLICY "marketplace listings owner read" ON public.marketplace_listings
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND deleted_at IS NULL);
DROP POLICY IF EXISTS "marketplace listings admin read" ON public.marketplace_listings;
CREATE POLICY "marketplace listings admin read" ON public.marketplace_listings
  FOR SELECT TO authenticated
  USING (is_admin());
DROP POLICY IF EXISTS "marketplace listings owner insert" ON public.marketplace_listings;
CREATE POLICY "marketplace listings owner insert" ON public.marketplace_listings
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND i_am_adult());
DROP POLICY IF EXISTS "marketplace listings owner update" ON public.marketplace_listings;
CREATE POLICY "marketplace listings owner update" ON public.marketplace_listings
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() AND deleted_at IS NULL)
  WITH CHECK (owner_id = auth.uid() AND deleted_at IS NULL);
DROP POLICY IF EXISTS "no_anon_insert_marketplace_listings" ON public.marketplace_listings;
CREATE POLICY "no_anon_insert_marketplace_listings" ON public.marketplace_listings
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT is_anonymous_session());
DROP POLICY IF EXISTS "no_anon_update_marketplace_listings" ON public.marketplace_listings;
CREATE POLICY "no_anon_update_marketplace_listings" ON public.marketplace_listings
  AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT is_anonymous_session()) WITH CHECK (NOT is_anonymous_session());

-- INSERT guard: forces every server-owned column, then the rules a policy cannot express (counts).
-- SECURITY DEFINER so the counts see the owner's deleted rows too. A per-owner advisory lock makes
-- parallel inserts from one account queue instead of each counting before the others commit.
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
REVOKE ALL ON FUNCTION public.marketplace_listing_insert_guard() FROM PUBLIC, anon, authenticated;

-- UPDATE guard. Column grants already keep clients off the server-owned columns; this keeps the
-- definer paths honest too (only a trusted setting moves expiry/deletion/hiding), screens edits with
-- the word filter, and stamps updated_at / sold_at. check_ugc_on_insert is deliberately NOT bound to
-- UPDATE here: it clears hidden_at for every non-admin, so an edit would un-hide a reported listing.
CREATE OR REPLACE FUNCTION public.marketplace_listing_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_banned timestamptz;
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
REVOKE ALL ON FUNCTION public.marketplace_listing_update_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS mkt_10_insert_guard ON public.marketplace_listings;
CREATE TRIGGER mkt_10_insert_guard BEFORE INSERT ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_listing_insert_guard();
DROP TRIGGER IF EXISTS mkt_20_ugc_title ON public.marketplace_listings;
CREATE TRIGGER mkt_20_ugc_title BEFORE INSERT ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.check_ugc_on_insert('title');
DROP TRIGGER IF EXISTS mkt_21_ugc_description ON public.marketplace_listings;
CREATE TRIGGER mkt_21_ugc_description BEFORE INSERT ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.check_ugc_on_insert('description');
DROP TRIGGER IF EXISTS mkt_30_update_guard ON public.marketplace_listings;
CREATE TRIGGER mkt_30_update_guard BEFORE UPDATE ON public.marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_listing_update_guard();

-- Owner actions that move server-owned columns.
CREATE OR REPLACE FUNCTION public.delete_marketplace_listing(p_listing_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  PERFORM set_config('app.trusted_marketplace', 'on', true);
  UPDATE marketplace_listings SET deleted_at = now()
   WHERE id = p_listing_id AND owner_id = auth.uid() AND deleted_at IS NULL;
  IF NOT FOUND THEN
    PERFORM set_config('app.trusted_marketplace', 'off', true);
    RAISE EXCEPTION 'NO_SUCH_LISTING';
  END IF;
  PERFORM set_config('app.trusted_marketplace', 'off', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.delete_marketplace_listing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_marketplace_listing(uuid) TO authenticated;

-- Renew: only in the last 3 days or after expiry, so "renew" cannot be used to bump a listing daily.
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
REVOKE ALL ON FUNCTION public.renew_marketplace_listing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_marketplace_listing(uuid) TO authenticated;

-- Admin: remove (hide) or restore a listing; resolving the reports stays the Reports tab's update.
CREATE OR REPLACE FUNCTION public.admin_set_listing_hidden(p_listing_id uuid, p_hidden boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;
  PERFORM set_config('app.trusted_marketplace', 'on', true);
  UPDATE marketplace_listings
     SET hidden_at     = CASE WHEN p_hidden THEN coalesce(hidden_at, now()) END,
         hidden_reason = CASE WHEN p_hidden THEN 'admin_removed' END
   WHERE id = p_listing_id;
  IF NOT FOUND THEN
    PERFORM set_config('app.trusted_marketplace', 'off', true);
    RAISE EXCEPTION 'NO_SUCH_LISTING';
  END IF;
  PERFORM set_config('app.trusted_marketplace', 'off', true);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_set_listing_hidden(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_listing_hidden(uuid, boolean) TO authenticated;

-- ─── 4. Photos ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketplace_photos (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  listing_id    uuid        NOT NULL,
  owner_id      uuid        NOT NULL DEFAULT auth.uid(),
  position      smallint    NOT NULL,
  status        text        NOT NULL DEFAULT 'pending',
  storage_path  text        NOT NULL,
  width         integer,
  height        integer,
  reject_reason text,
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  -- 'admin' today; an automatic scanner later writes 'auto' plus its verdict in `scan` — no schema change.
  review_source text,
  scan          jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_photos_pkey PRIMARY KEY (id),
  CONSTRAINT marketplace_photos_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  CONSTRAINT marketplace_photos_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT marketplace_photos_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT marketplace_photos_position_check CHECK (position BETWEEN 0 AND 7),
  CONSTRAINT marketplace_photos_status_check CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT marketplace_photos_path_check CHECK (storage_path ~ '^(pending|approved)/[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$'),
  CONSTRAINT marketplace_photos_reject_reason_check CHECK (reject_reason IS NULL OR reject_reason IN (
    'not_item', 'inappropriate', 'prohibited', 'contact_info', 'low_quality', 'other')),
  CONSTRAINT marketplace_photos_review_source_check CHECK (review_source IS NULL OR review_source IN ('admin', 'auto')),
  CONSTRAINT marketplace_photos_storage_path_key UNIQUE (storage_path)
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_photos_live_position
  ON public.marketplace_photos (listing_id, position) WHERE status <> 'rejected';
CREATE INDEX IF NOT EXISTS marketplace_photos_queue_idx
  ON public.marketplace_photos (created_at) WHERE status = 'pending';

COMMENT ON TABLE public.marketplace_photos IS
  'Dükkân listing photos. Private bucket marketplace-photos; visible to others only once approved (by an admin '
  'today: marketplace-photo-review re-encodes the image, stripping EXIF/GPS). review_source/scan leave room for '
  'an automatic scan. 20261168.';

ALTER TABLE public.marketplace_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketplace_photos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.marketplace_photos TO authenticated;
GRANT INSERT (listing_id, position, storage_path) ON public.marketplace_photos TO authenticated;
GRANT DELETE ON public.marketplace_photos TO authenticated;

DROP POLICY IF EXISTS "marketplace photos owner read" ON public.marketplace_photos;
CREATE POLICY "marketplace photos owner read" ON public.marketplace_photos
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
DROP POLICY IF EXISTS "marketplace photos admin read" ON public.marketplace_photos;
CREATE POLICY "marketplace photos admin read" ON public.marketplace_photos
  FOR SELECT TO authenticated USING (is_admin());
DROP POLICY IF EXISTS "marketplace photos approved read" ON public.marketplace_photos;
CREATE POLICY "marketplace photos approved read" ON public.marketplace_photos
  FOR SELECT TO authenticated
  USING (status = 'approved'
         AND EXISTS (SELECT 1 FROM public.marketplace_listings l WHERE l.id = marketplace_photos.listing_id));
DROP POLICY IF EXISTS "marketplace photos owner insert" ON public.marketplace_photos;
CREATE POLICY "marketplace photos owner insert" ON public.marketplace_photos
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND i_am_adult());
DROP POLICY IF EXISTS "marketplace photos owner delete" ON public.marketplace_photos;
CREATE POLICY "marketplace photos owner delete" ON public.marketplace_photos
  FOR DELETE TO authenticated USING (owner_id = auth.uid());
DROP POLICY IF EXISTS "no_anon_insert_marketplace_photos" ON public.marketplace_photos;
CREATE POLICY "no_anon_insert_marketplace_photos" ON public.marketplace_photos
  AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT is_anonymous_session());
DROP POLICY IF EXISTS "no_anon_delete_marketplace_photos" ON public.marketplace_photos;
CREATE POLICY "no_anon_delete_marketplace_photos" ON public.marketplace_photos
  AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT is_anonymous_session());

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
REVOKE ALL ON FUNCTION public.marketplace_photo_insert_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS mkp_10_insert_guard ON public.marketplace_photos;
CREATE TRIGGER mkp_10_insert_guard BEFORE INSERT ON public.marketplace_photos
  FOR EACH ROW EXECUTE FUNCTION public.marketplace_photo_insert_guard();

-- ─── 5. Storage: private bucket + two policies ──────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('marketplace-photos', 'marketplace-photos', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DROP POLICY IF EXISTS "marketplace photos upload own pending" ON storage.objects;
CREATE POLICY "marketplace photos upload own pending" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'marketplace-photos'
              AND NOT public.is_anonymous_session()
              AND (storage.foldername(name))[1] = 'pending'
              AND (storage.foldername(name))[2] = (auth.uid())::text
              AND public.i_am_adult());
DROP POLICY IF EXISTS "marketplace photos read via row" ON storage.objects;
CREATE POLICY "marketplace photos read via row" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'marketplace-photos'
         AND EXISTS (SELECT 1 FROM public.marketplace_photos p WHERE p.storage_path = objects.name));

-- ─── 6. Reports: 'listing' + 'prohibited_item'; one report hides a listing (on Araçlar's list) ─
ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS content_reports_content_type_check;
ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_content_type_check
  CHECK (content_type = ANY (ARRAY['answer'::text, 'facility'::text, 'listing'::text, 'message'::text,
                                   'place'::text, 'profile'::text, 'question'::text, 'review'::text, 'vehicle'::text]));
ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS content_reports_reason_check;
ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_reason_check
  CHECK (reason = ANY (ARRAY['offensive'::text, 'harassment'::text, 'spam'::text, 'false_info'::text,
                             'prohibited_item'::text, 'other'::text]));

CREATE OR REPLACE FUNCTION public.auto_hide_reported_content()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_count int;
BEGIN
  -- Dükkân (20261168): ONE report hides a listing (Berke 2026-11-07). Before the 3-reporter count.
  IF NEW.content_type = 'listing' THEN
    PERFORM set_config('app.trusted_marketplace', 'on', true);
    UPDATE marketplace_listings SET hidden_at = now(), hidden_reason = 'auto_reports'
     WHERE id = NEW.content_id AND hidden_at IS NULL;
    PERFORM set_config('app.trusted_marketplace', 'off', true);
    RETURN NEW;
  END IF;
  SELECT count(DISTINCT reporter_id) INTO v_count
  FROM content_reports
  WHERE content_type = NEW.content_type AND content_id = NEW.content_id;
  IF v_count < 3 THEN RETURN NEW; END IF;
  IF NEW.content_type = 'review' THEN
    UPDATE reviews    SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'question' THEN
    UPDATE questions  SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'answer' THEN
    UPDATE answers    SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'facility' THEN
    UPDATE facilities SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'place' THEN
    UPDATE places     SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  ELSIF NEW.content_type = 'vehicle' THEN
    UPDATE vehicles   SET hidden_at = now(), hidden_reason = 'auto_reports' WHERE id = NEW.content_id AND hidden_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- ─── 7. Notifications: a 'marketplace' type (photo rejected, listing removed) ───────────────
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY['duty'::text, 'message'::text, 'waitlist'::text, 'question'::text, 'admin_alert'::text,
                           'admin_message'::text, 'featured'::text, 'general'::text, 'marketplace'::text]));

-- ─── 8. Assertions ──────────────────────────────────────────────────────────────────────────
DO $assert$
DECLARE v_n int; v_names text;
BEGIN
  -- Full policy set on each new table, printed (permissive-OR: presence of mine never proves absence of theirs).
  SELECT count(*), string_agg(policyname || ':' || permissive || ':' || cmd, ', ' ORDER BY policyname)
    INTO v_n, v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = 'marketplace_listings';
  RAISE NOTICE 'marketplace_listings policies: %', v_names;
  IF v_n IS DISTINCT FROM 7 THEN RAISE EXCEPTION 'marketplace_listings has % policies, expected 7: %', v_n, v_names; END IF;
  SELECT count(*), string_agg(policyname || ':' || permissive || ':' || cmd, ', ' ORDER BY policyname)
    INTO v_n, v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = 'marketplace_photos';
  RAISE NOTICE 'marketplace_photos policies: %', v_names;
  IF v_n IS DISTINCT FROM 7 THEN RAISE EXCEPTION 'marketplace_photos has % policies, expected 7: %', v_n, v_names; END IF;

  -- No DELETE path on listings for anyone but the table owner (soft delete only).
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'marketplace_listings' AND cmd IN ('DELETE', 'ALL')) THEN
    RAISE EXCEPTION 'marketplace_listings must have no DELETE/ALL policy';
  END IF;
  IF has_table_privilege('anon', 'public.marketplace_listings', 'SELECT')
     OR has_table_privilege('anon', 'public.marketplace_photos', 'SELECT') THEN
    RAISE EXCEPTION 'anon must have no privilege on the marketplace tables';
  END IF;
  -- Column grants: the server-owned columns are out of every client's reach (positive control beside it).
  IF has_column_privilege('authenticated', 'public.marketplace_listings', 'hidden_at', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.marketplace_listings', 'expires_at', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.marketplace_listings', 'deleted_at', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.marketplace_listings', 'boosted_until', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.marketplace_listings', 'owner_id', 'INSERT')
     OR has_column_privilege('authenticated', 'public.marketplace_photos', 'status', 'INSERT') THEN
    RAISE EXCEPTION 'a server-owned marketplace column is client-writable';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.marketplace_listings', 'title', 'UPDATE')
     OR NOT has_column_privilege('authenticated', 'public.marketplace_listings', 'status', 'UPDATE') THEN
    RAISE EXCEPTION 'positive control: the owner must be able to edit title and status';
  END IF;

  -- Bucket is private; both new storage policies name it.
  IF (SELECT public FROM storage.buckets WHERE id = 'marketplace-photos') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'marketplace-photos must be a PRIVATE bucket';
  END IF;
  SELECT count(*), string_agg(policyname, ', ' ORDER BY policyname) INTO v_n, v_names
    FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%marketplace-photos%';
  RAISE NOTICE 'storage.objects marketplace policies: %', v_names;
  IF v_n IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'expected 2 storage policies naming marketplace-photos, got %: %', v_n, v_names; END IF;
  -- Exactly these 2 added (relative to the count before this file, so Araçlar's 4 need no edit here).
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';
  IF v_n IS DISTINCT FROM current_setting('mig1168.storage_policies')::int + 2 THEN
    RAISE EXCEPTION 'storage.objects has % policies, expected % + 2', v_n, current_setting('mig1168.storage_policies');
  END IF;
  SELECT string_agg(policyname, ', ') INTO v_names FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects' AND permissive = 'PERMISSIVE'
     AND policyname LIKE 'marketplace%' AND (coalesce(qual, '') || coalesce(with_check, '')) NOT LIKE '%bucket_id%';
  IF v_names IS NOT NULL THEN RAISE EXCEPTION 'bucket-unscoped marketplace storage policy: %', v_names; END IF;

  -- The one-report branch is in the live auto-hide body, and the 3-reporter path is still there.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.auto_hide_reported_content()')
                  AND prosrc LIKE '%IF NEW.content_type = ''listing'' THEN%' AND prosrc LIKE '%IF v_count < 3 THEN RETURN NEW;%'
                  AND prosrc LIKE '%UPDATE vehicles%') THEN
    RAISE EXCEPTION 'auto_hide_reported_content lacks the listing branch, the vehicle branch or the 3-reporter path';
  END IF;
  -- i_am_adult takes no argument (no age oracle on another user).
  IF to_regprocedure('public.i_am_adult(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'i_am_adult must not take a user argument';
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
VALUES ('20261168_marketplace_listings.sql', 'ea13333d44eae8925c2626296fe0175a7a21bc4e8524237316cfdbc9dff6b9ff')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   verify_schema QUERY 1: the 20261168_marketplace_listings rows must read OK.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   Restore auto_hide_reported_content to Araçlar 20261166's body and the two content_reports and the
--   notifications_type_check constraints to their probed lists (only if no 'listing'/'prohibited_item'/
--   'marketplace' rows exist); DROP the two storage policies; empty and drop the bucket through the
--   Storage API; DROP TABLE marketplace_photos, marketplace_listings; DROP the functions above; DROP the
--   profiles trigger and the two notice columns; delete the schema_migrations_applied row.

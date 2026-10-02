-- ═══════════════════════════════════════════════════════════════════════════
-- 20261069 — check-ins ("Buradayım"): at the place, signed in, named, consented
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Plan: feat/explore-v2, Part 2. Decisions approved by Berke 2026-10-02:
--   1. adults: visible by default; "Check-in'lerimi gizle" switch in Profile
--   2. under-18s (by date of birth): hidden by default; they may switch it on themselves
--   3. the first check-in asks for display_name + shows "others will see this"; no check-in
--      is saved without both
--   4. privacy policy (4 copies) + Play Data safety + App Store privacy go live WITH the flag
--
-- Client side is gated by MODULE_FLAGS.checkins (constants/flags.js). This file is safe to
-- apply while that flag is false — no shipped bundle calls anything here.
-- ⚠ ONE THING IS NOT DARK ONCE APPLIED: the three RPCs are callable through the API by any
--   signed-in, non-guest account during the window between apply and flag flip. Every rule
--   below still holds for such a call (that is the point of putting them here), and nothing
--   it writes is visible to anyone through a shipped bundle until the flip.
--
-- ─── WHAT IS STORED, AND WHAT IS NOT ────────────────────────────────────────
-- checkins holds (user, place, TRNC day, server time, the display name AS IT WAS). It holds
-- NO COORDINATES — not the device's, not an accuracy figure. The fix the client sends is
-- used for the distance check inside check_in() and then discarded.
--
-- The name is SNAPSHOTTED at write time (Slice 3b's rule: the day a surface renders an
-- author name, snapshotting is a prerequisite). Renaming later does not re-attribute old
-- check-ins.
--
-- ─── WHAT THE DISTANCE CHECK PROVES, AND WHAT IT DOES NOT ───────────────────
-- check_in() refuses unless the CLAIMED fix is within 150 m of the place's own coordinates
-- with a reported accuracy of 50 m or better. The server cannot see the phone: a script
-- that sends the place's own coordinates passes. Proving presence needs device attestation
-- (Play Integrity / App Attest) — native work, out of scope. What IS enforced here, so an
-- API caller gains nothing a spoofed GPS would not also give: one per user per place per
-- TRNC day, at most 30 per user per TRNC day, and no "impossible travel" (> 150 km/h
-- between the PLACES of two consecutive check-ins more than 1 km apart).
--
-- Time zone: Europe/Istanbul — the TRNC keeps Turkish time, not Europe/Nicosia (20261056).
--
-- ─── WHO CAN SEE WHAT (plain English) ───────────────────────────────────────
--   checkins rows       — the OWNER only (signed in, not a guest): SELECT their own and
--                         DELETE their own. Nobody can INSERT or UPDATE through the API;
--                         the one write path is check_in(), which only writes auth.uid()'s row.
--   other people        — get_checkin_feed() (DEFINER) returns other people's check-ins
--                         only when ALL hold: the caller is signed in and not a guest; the
--                         author's profiles.checkins_public is true; the author has a
--                         display_name and is not UGC-banned; neither has blocked the other;
--                         the place is active and not hidden. Every "not visible" reason is
--                         simply absent rows — no oracle. Guests get AUTH_REQUIRED (matches
--                         avatars_read_authenticated: a guest could not sign the avatar).
--                         The caller always sees their own check-ins, flagged is_mine.
--   profiles            — two columns, no new policy (the derived "exactly 3 permissive
--                         SELECT/ALL" count on profiles stays true). checkins_public is
--                         owner-writable through the existing owner UPDATE, like
--                         route_badges_public. checkins_notice_at / _version are written only
--                         by accept_checkin_notice(); a direct client write is refused by
--                         guard_checkin_notice_columns.
--   deletion            — user_id → profiles ON DELETE CASCADE (account deletion), place_id
--                         → places ON DELETE CASCADE. Never SET NULL (20261029 broke account
--                         deletion three times that way).
--
-- ─── THE DEFAULT IS DECIDED ONCE, AT CONSENT ────────────────────────────────
-- checkins_public has NO default and starts NULL. accept_checkin_notice() sets it ONLY if
-- still NULL: true for an adult by date of birth, false for an under-18 or an unknown date
-- of birth. It is never recomputed from age afterwards — a 17-year-old turning 18 does not
-- become visible without touching the switch. A choice made on the switch before the first
-- check-in is kept. NULL reads as hidden everywhere.
--
-- Apply: SQL Editor, Role = postgres, WHOLE FILE, once. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── 0. Requires ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.is_anonymous_session()') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: is_anonymous_session() is missing. Nothing applied.';
  END IF;
  IF to_regclass('public.places') IS NULL OR to_regclass('public.blocks') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: places or blocks is missing. Nothing applied.';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'profiles'
         AND column_name IN ('display_name','date_of_birth','age_ineligible','ugc_banned_until','avatar_url')) <> 5 THEN
    RAISE EXCEPTION 'REFUSING: profiles lacks one of display_name, date_of_birth, age_ineligible, ugc_banned_until, avatar_url. Nothing applied.';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'places'
         AND column_name IN ('latitude','longitude','status','hidden_at','name','name_i18n','category')) <> 7 THEN
    RAISE EXCEPTION 'REFUSING: places lacks one of latitude, longitude, status, hidden_at, name, name_i18n, category. Nothing applied.';
  END IF;
  -- Remembered for 7(j): this file must add no profiles policy. The number itself belongs to
  -- verify_schema's 0922 token, not to this file.
  PERFORM set_config('app.m1069_profiles_policies',
    (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles'), true);
END $$;

-- ─── 1. Profile columns ─────────────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS checkins_public         boolean;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS checkins_notice_at      timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS checkins_notice_version text;

COMMENT ON COLUMN public.profiles.checkins_public IS
  'Whether other signed-in users see this person''s check-ins in the feeds. NO DEFAULT: '
  'NULL until accept_checkin_notice() sets it once (adult by DOB → true, else false). '
  'Owner-writable (the Profile switch). NULL reads as hidden. 20261069.';
COMMENT ON COLUMN public.profiles.checkins_notice_at IS
  'When the person saw the "others will see this" check-in notice. SERVER-stamped by '
  'accept_checkin_notice(); direct writes refused by guard_checkin_notice_columns. 20261069.';
COMMENT ON COLUMN public.profiles.checkins_notice_version IS
  'Which notice text they saw (client-supplied, shape-checked). 20261069.';

-- ─── 2. The notice stamp: server-only ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_checkin_notice_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.checkins_notice_at IS DISTINCT FROM OLD.checkins_notice_at
      OR NEW.checkins_notice_version IS DISTINCT FROM OLD.checkins_notice_version)
     AND current_setting('app.trusted_checkin_notice', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'CHECKIN_NOTICE_SERVER_ONLY';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS guard_checkin_notice_columns ON public.profiles;
CREATE TRIGGER guard_checkin_notice_columns BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_checkin_notice_columns();

REVOKE ALL ON FUNCTION public.guard_checkin_notice_columns() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_checkin_notice_columns() FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.accept_checkin_notice(p_version text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me     uuid := auth.uid();
  v_public boolean;
  v_rows   int;
BEGIN
  IF v_me IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF p_version IS NULL OR p_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'BAD_VERSION';
  END IF;

  PERFORM set_config('app.trusted_checkin_notice', 'on', true);
  UPDATE profiles p
     SET checkins_notice_at      = now(),
         checkins_notice_version = p_version,
         -- Decided ONCE: a switch choice made earlier is kept; never recomputed from age.
         checkins_public = COALESCE(p.checkins_public,
           p.date_of_birth IS NOT NULL
           AND p.date_of_birth <= ((now() AT TIME ZONE 'Europe/Istanbul')::date - interval '18 years')::date)
   WHERE p.id = v_me
  RETURNING p.checkins_public INTO v_public;
  GET DIAGNOSTICS v_rows = ROW_COUNT;   -- read before PERFORM, which resets FOUND
  PERFORM set_config('app.trusted_checkin_notice', 'off', true);

  IF v_rows = 0 THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;
  RETURN v_public;
END;
$function$;

COMMENT ON FUNCTION public.accept_checkin_notice(text) IS
  'Stamps that the caller saw the check-in visibility notice (server time) and, if still '
  'unset, sets checkins_public: adult by DOB → true, under-18 or unknown DOB → false. '
  'Returns the effective checkins_public. Guests raise AUTH_REQUIRED. 20261069.';

REVOKE ALL ON FUNCTION public.accept_checkin_notice(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_checkin_notice(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_checkin_notice(text) TO authenticated;

-- ─── 3. The check-ins ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.checkins (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id               uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  place_id              uuid        NOT NULL REFERENCES public.places(id)   ON DELETE CASCADE,
  checked_in_on         date        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  display_name_snapshot text        NOT NULL,
  CONSTRAINT checkins_pkey PRIMARY KEY (id),
  CONSTRAINT checkins_one_per_day UNIQUE (user_id, place_id, checked_in_on)
);
COMMENT ON TABLE public.checkins IS
  'One row per (person, place, TRNC day). No coordinates, ever. Written only by check_in(); '
  'owner-only read and delete; others read through get_checkin_feed(). 20261069.';

CREATE INDEX IF NOT EXISTS checkins_feed_idx       ON public.checkins (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS checkins_place_feed_idx ON public.checkins (place_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS checkins_user_recent_idx ON public.checkins (user_id, created_at DESC);

ALTER TABLE public.checkins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.checkins FROM anon, authenticated;
GRANT SELECT, DELETE ON TABLE public.checkins TO authenticated;

DROP POLICY IF EXISTS checkins_owner_read ON public.checkins;
CREATE POLICY checkins_owner_read ON public.checkins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND NOT is_anonymous_session());

DROP POLICY IF EXISTS checkins_owner_delete ON public.checkins;
CREATE POLICY checkins_owner_delete ON public.checkins
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND NOT is_anonymous_session());

-- ─── 4. Distance (the walking-route badge's metresBetween, in SQL) ──────────
-- Same haversine, same earth radius (6 371 000 m) as constants/walkingRoutes.js, so the
-- client's pre-check and this authority agree to the metre.
CREATE OR REPLACE FUNCTION public.metres_between(lat1 double precision, lng1 double precision,
                                                 lat2 double precision, lng2 double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT 2 * 6371000 * asin(least(1, sqrt(
           power(sin(radians(lat2 - lat1) / 2), 2)
         + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))
$function$;

REVOKE ALL ON FUNCTION public.metres_between(double precision, double precision, double precision, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.metres_between(double precision, double precision, double precision, double precision) FROM anon, authenticated;

-- ─── 5. The one write path ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_in(p_place_id uuid, p_lat double precision,
                                           p_lng double precision, p_accuracy double precision)
 RETURNS TABLE(checkin_id uuid, created_at timestamptz, already boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me    uuid := auth.uid();
  v_prof  profiles%ROWTYPE;
  v_place places%ROWTYPE;
  v_day   date := (now() AT TIME ZONE 'Europe/Istanbul')::date;
  v_prev  record;
  v_id    uuid;
BEGIN
  -- Every refusal happens before any write.
  IF v_me IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  SELECT * INTO v_prof FROM profiles WHERE id = v_me;
  IF NOT FOUND OR v_prof.age_ineligible THEN
    RAISE EXCEPTION 'NOT_ELIGIBLE';
  END IF;
  IF v_prof.ugc_banned_until IS NOT NULL AND v_prof.ugc_banned_until > now() THEN
    RAISE EXCEPTION 'BANNED';
  END IF;
  IF v_prof.display_name IS NULL THEN
    RAISE EXCEPTION 'NAME_REQUIRED';
  END IF;
  IF v_prof.checkins_notice_at IS NULL THEN
    RAISE EXCEPTION 'NOTICE_REQUIRED';
  END IF;

  SELECT * INTO v_place FROM places
   WHERE id = p_place_id AND status = 'active' AND hidden_at IS NULL
     AND latitude IS NOT NULL AND longitude IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLACE_NOT_FOUND';
  END IF;

  -- BETWEEN rejects NaN and ±Infinity (NaN sorts above every number in Postgres).
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'BAD_FIX';
  END IF;
  IF p_accuracy IS NULL OR NOT (p_accuracy > 0 AND p_accuracy <= 50) THEN
    RAISE EXCEPTION 'LOW_ACCURACY';
  END IF;
  IF metres_between(p_lat, p_lng, v_place.latitude, v_place.longitude) > 150 THEN
    RAISE EXCEPTION 'TOO_FAR';
  END IF;

  -- Already here today: not an error, and not subject to the cap or the travel check.
  SELECT c.id, c.created_at INTO v_prev FROM checkins c
   WHERE c.user_id = v_me AND c.place_id = p_place_id AND c.checked_in_on = v_day;
  IF FOUND THEN
    RETURN QUERY SELECT v_prev.id, v_prev.created_at, true;
    RETURN;
  END IF;

  IF (SELECT count(*) FROM checkins c WHERE c.user_id = v_me AND c.checked_in_on = v_day) >= 30 THEN
    RAISE EXCEPTION 'DAILY_LIMIT';
  END IF;

  -- Impossible travel, from the PREVIOUS check-in's PLACE (no coordinates are stored).
  -- The 1 km floor: two places near one spot must never refuse each other.
  SELECT c.created_at, pl.latitude, pl.longitude INTO v_prev
    FROM checkins c JOIN places pl ON pl.id = c.place_id
   WHERE c.user_id = v_me
   ORDER BY c.created_at DESC
   LIMIT 1;
  IF FOUND AND v_prev.latitude IS NOT NULL AND v_prev.longitude IS NOT NULL THEN
    DECLARE
      v_d double precision := metres_between(v_prev.latitude, v_prev.longitude, v_place.latitude, v_place.longitude);
      v_s double precision := greatest(extract(epoch FROM now() - v_prev.created_at), 1);
    BEGIN
      IF v_d > 1000 AND v_d / v_s > 150 / 3.6 THEN
        RAISE EXCEPTION 'TOO_FAST';
      END IF;
    END;
  END IF;

  INSERT INTO checkins (user_id, place_id, checked_in_on, display_name_snapshot)
  VALUES (v_me, p_place_id, v_day, v_prof.display_name)
  ON CONFLICT ON CONSTRAINT checkins_one_per_day DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN   -- lost a same-day race to a concurrent call: report the winner
    RETURN QUERY SELECT c.id, c.created_at, true FROM checkins c
      WHERE c.user_id = v_me AND c.place_id = p_place_id AND c.checked_in_on = v_day;
    RETURN;
  END IF;
  RETURN QUERY SELECT c.id, c.created_at, false FROM checkins c WHERE c.id = v_id;
END;
$function$;

COMMENT ON FUNCTION public.check_in(uuid, double precision, double precision, double precision) IS
  'Checks the caller in at a place. Refuses unless signed in (not a guest), eligible, '
  'unbanned, named, notice accepted, the place active, accuracy in (0, 50] m and the claimed '
  'fix within 150 m. One per place per TRNC day (returns already=true), 30 per day, no '
  'impossible travel. Stores no coordinates. 20261069.';

REVOKE ALL ON FUNCTION public.check_in(uuid, double precision, double precision, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_in(uuid, double precision, double precision, double precision) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_in(uuid, double precision, double precision, double precision) TO authenticated;

-- ─── 6. The two feeds (one function) ────────────────────────────────────────
-- p_place_id NULL = "Son Check-in'ler" across all places; set = one place's detail page.
-- Keyset pagination: pass the last row's (created_at, checkin_id) as (p_before_at, p_before_id).
CREATE OR REPLACE FUNCTION public.get_checkin_feed(
  p_place_id  uuid        DEFAULT NULL,
  p_before_at timestamptz DEFAULT NULL,
  p_before_id uuid        DEFAULT NULL,
  p_limit     integer     DEFAULT 20
)
 RETURNS TABLE(checkin_id uuid, created_at timestamptz, place_id uuid, place_name text,
               place_name_i18n jsonb, place_category text, display_name text,
               avatar_url text, is_mine boolean)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  RETURN QUERY
  SELECT c.id, c.created_at, pl.id, pl.name, pl.name_i18n, pl.category,
         c.display_name_snapshot, p.avatar_url, (c.user_id = v_me)
    FROM checkins c
    JOIN profiles p ON p.id = c.user_id
    JOIN places  pl ON pl.id = c.place_id AND pl.status = 'active' AND pl.hidden_at IS NULL
   WHERE (p_place_id IS NULL OR c.place_id = p_place_id)
     AND (p_before_at IS NULL OR c.created_at < p_before_at
          OR (c.created_at = p_before_at AND c.id < p_before_id))
     AND (
       c.user_id = v_me
       OR (    p.checkins_public IS TRUE
           AND p.display_name IS NOT NULL
           AND (p.ugc_banned_until IS NULL OR p.ugc_banned_until <= now())
           AND NOT EXISTS (
             SELECT 1 FROM blocks b
              WHERE (b.blocker_id = v_me AND b.blocked_id = c.user_id)
                 OR (b.blocker_id = c.user_id AND b.blocked_id = v_me)))
     )
   ORDER BY c.created_at DESC, c.id DESC
   LIMIT least(greatest(coalesce(p_limit, 20), 1), 50);
END;
$function$;

COMMENT ON FUNCTION public.get_checkin_feed(uuid, timestamptz, uuid, integer) IS
  'Recent check-ins, newest first, keyset-paginated, max 50 per page; all places or one. '
  'Others'' rows only when checkins_public, named, unbanned, not blocked either way, place '
  'active and unhidden; the caller''s own rows always (is_mine). Snapshotted names. Guests '
  'raise AUTH_REQUIRED. No coordinates. 20261069.';

REVOKE ALL ON FUNCTION public.get_checkin_feed(uuid, timestamptz, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_checkin_feed(uuid, timestamptz, uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_checkin_feed(uuid, timestamptz, uuid, integer) TO authenticated;

-- ─── 7. Assertions — read back from the catalogs, inside the transaction ────
DO $$
DECLARE
  v_t     regclass := to_regclass('public.checkins');
  v_n     int;
  v_names text;
  v_def   text;
  v_role  text;
  v_priv  text;
  v_fn    text;
  v_err   text;
BEGIN
  IF v_t IS NULL THEN
    RAISE EXCEPTION 'checkins is not visible to this DO block. Nothing committed; re-run the file as one paste.';
  END IF;

  -- (a) Profile columns: checkins_public has NO default (the default is decided at consent).
  SELECT string_agg(format('%s:%s:%s', column_name, data_type, coalesce(column_default, 'nodefault')), ',' ORDER BY column_name)
    INTO v_def
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'profiles'
     AND column_name IN ('checkins_public','checkins_notice_at','checkins_notice_version');
  IF v_def IS DISTINCT FROM 'checkins_notice_at:timestamp with time zone:nodefault,checkins_notice_version:text:nodefault,checkins_public:boolean:nodefault' THEN
    RAISE EXCEPTION 'profiles check-in columns are wrong: %', coalesce(v_def, '<missing>');
  END IF;

  -- (b) RLS on, and the FULL policy set: exactly two permissive, guest-guarded owner policies.
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_t) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RLS is not enabled on checkins';
  END IF;
  SELECT count(*), coalesce(string_agg(policyname || ':' || cmd || ':' || permissive || ':' || qual, ' | ' ORDER BY policyname), '(none)')
    INTO v_n, v_names
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'checkins';
  IF v_n IS DISTINCT FROM 2
     OR v_names NOT LIKE 'checkins_owner_delete:DELETE:PERMISSIVE:%auth.uid()%is_anonymous_session%'
     OR v_names NOT LIKE '%checkins_owner_read:SELECT:PERMISSIVE:%auth.uid()%is_anonymous_session%' THEN
    RAISE EXCEPTION 'checkins must carry exactly the two guest-guarded owner policies; found %: %', v_n, v_names;
  END IF;

  -- (c) Grants: no client INSERT/UPDATE; anon nothing; authenticated SELECT + DELETE.
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','TRUNCATE'] LOOP
      IF has_table_privilege(v_role, v_t, v_priv) THEN
        RAISE EXCEPTION '% holds % on checkins', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;
  IF has_table_privilege('anon', v_t, 'SELECT') OR has_table_privilege('anon', v_t, 'DELETE') THEN
    RAISE EXCEPTION 'anon holds SELECT or DELETE on checkins';
  END IF;
  IF NOT has_table_privilege('authenticated', v_t, 'SELECT') OR NOT has_table_privilege('authenticated', v_t, 'DELETE') THEN
    RAISE EXCEPTION 'authenticated lost SELECT or DELETE on checkins — owners could not list or delete their own';
  END IF;

  -- (d) No coordinate column, ever.
  SELECT count(*), string_agg(column_name, ',') INTO v_n, v_names
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'checkins'
     AND (column_name ILIKE '%lat%' OR column_name ILIKE '%lng%' OR column_name ILIKE '%lon%' OR column_name ILIKE '%accura%');
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'checkins carries a location column: %', v_names;
  END IF;

  -- (e) Both FKs CASCADE; the one-per-day UNIQUE is the triple.
  SELECT count(*), string_agg(pg_get_constraintdef(oid), ' | ' ORDER BY conname) INTO v_n, v_names
    FROM pg_constraint WHERE conrelid = v_t AND contype = 'f';
  IF v_n IS DISTINCT FROM 2
     OR v_names NOT LIKE '%(place_id) REFERENCES places(id) ON DELETE CASCADE%'
     OR v_names NOT LIKE '%(user_id) REFERENCES profiles(id) ON DELETE CASCADE%' THEN
    RAISE EXCEPTION 'checkins FKs are not the two CASCADEs: % : %', v_n, coalesce(v_names, '<none>');
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = v_t AND conname = 'checkins_one_per_day';
  IF v_def IS DISTINCT FROM 'UNIQUE (user_id, place_id, checked_in_on)' THEN
    RAISE EXCEPTION 'checkins_one_per_day is %', coalesce(v_def, '<missing>');
  END IF;

  -- (f) The three RPCs: DEFINER, search_path pinned, no anon/PUBLIC EXECUTE.
  FOREACH v_fn IN ARRAY ARRAY['accept_checkin_notice','check_in','get_checkin_feed'] LOOP
    SELECT count(*) INTO v_n
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_fn
       AND p.prosecdef AND p.proconfig::text ILIKE '%search_path=public%';
    IF v_n IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION '% is not exactly one DEFINER function with search_path pinned (matched %)', v_fn, v_n;
    END IF;
  END LOOP;
  -- …and the two helpers are callable by NO client role.
  FOREACH v_fn IN ARRAY ARRAY['accept_checkin_notice','check_in','get_checkin_feed','metres_between','guard_checkin_notice_columns'] LOOP
    SELECT count(*) INTO v_n
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      LEFT JOIN LATERAL aclexplode(p.proacl) a ON TRUE
      LEFT JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname = 'public' AND p.proname = v_fn
       AND a.privilege_type = 'EXECUTE'
       AND (a.grantee = 0 OR r.rolname = 'anon'
            OR (v_fn IN ('metres_between','guard_checkin_notice_columns') AND r.rolname = 'authenticated'));
    IF v_n IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION '% client EXECUTE grant(s) on % that must not exist', v_n, v_fn;
    END IF;
  END LOOP;

  -- (g) The guard trigger is attached to profiles.
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'guard_checkin_notice_columns' AND NOT tgisinternal;
  IF v_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'guard_checkin_notice_columns is not attached to profiles (found %)', v_n;
  END IF;

  -- (h) metres_between agrees with the client's haversine. Positive control: 0.001° of
  --     latitude ≈ 111.19 m on R = 6 371 000 m.
  IF abs(public.metres_between(35.0, 33.0, 35.001, 33.0) - 111.19) > 0.05 THEN
    RAISE EXCEPTION 'metres_between(35,33 → 35.001,33) = %, expected ≈ 111.19', public.metres_between(35.0, 33.0, 35.001, 33.0);
  END IF;

  -- (i) POSITIVE CONTROLS: as postgres there is no auth.uid(), so all three must RAISE
  --     AUTH_REQUIRED before touching a table. A healthy system raises; a broken one returns.
  v_err := NULL;
  BEGIN PERFORM * FROM public.check_in('00000000-0000-4000-8000-000000001069', 35, 33, 10);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'AUTH_REQUIRED' THEN
    RAISE EXCEPTION 'check_in with no caller did not raise AUTH_REQUIRED (got %)', coalesce(v_err, 'NO EXCEPTION');
  END IF;
  v_err := NULL;
  BEGIN PERFORM count(*) FROM public.get_checkin_feed();
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'AUTH_REQUIRED' THEN
    RAISE EXCEPTION 'get_checkin_feed with no caller did not raise AUTH_REQUIRED (got %)', coalesce(v_err, 'NO EXCEPTION');
  END IF;
  v_err := NULL;
  BEGIN PERFORM public.accept_checkin_notice('2026-10-02');
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'AUTH_REQUIRED' THEN
    RAISE EXCEPTION 'accept_checkin_notice with no caller did not raise AUTH_REQUIRED (got %)', coalesce(v_err, 'NO EXCEPTION');
  END IF;

  -- (j) No profiles policy came with this file: the count is what section 0 saw.
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles';
  IF v_n::text IS DISTINCT FROM current_setting('app.m1069_profiles_policies', true) THEN
    RAISE EXCEPTION 'profiles policies went from % to % inside this file', current_setting('app.m1069_profiles_policies', true), v_n;
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
VALUES ('20261069_checkins.sql', 'fce48a55082b3302f046de0898b471a63f2d1b312eb3d4c7a3c3ed8511dba77f')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';

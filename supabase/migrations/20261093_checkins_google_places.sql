-- ═══════════════════════════════════════════════════════════════════════════
-- 20261093 — check-ins at Google places ("Buradayım" nearby list)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- REQUIRES 20261092 (check-ins) APPLIED FIRST. Renumbered 2026-10-07 from 20261078/20261091
-- (written before 1079-1090 were applied) so that file order = apply order. Applied 2026-10-07
-- with the feature still dark: MODULE_FLAGS.checkins stays false until the flip (Berke).
--
-- What changes:
--   • a check-in is at EITHER an ADA place (place_id) OR a Google place (google_place_id).
--   • Google places are checked into ONLY through the google-places Edge Function, which
--     reads the place's location from Google with the server key and then calls
--     check_in_google() as service_role. The app can never send a place's coordinates.
--   • google_place_pins: the map pins for Google places at least one visible ADA user has
--     checked into. Pharmacy-type places never get a pin (no free promotion); they can still
--     be checked into from the list.
--
-- ─── GOOGLE MAPS PLATFORM TERMS (Service Specific Terms §14, read 2026-10-07, page
--     "last modified June 10, 2026") ──────────────────────────────────────────────
--   14.2 Places content must not be used with a non-Google map  → pins render only on a
--        Google-provider MapView (app side).
--   14.3 lat/lng may be cached for up to 30 consecutive calendar days, then deleted.
--        Place IDs are exempt (Places policies page).
-- So the ONLY Google-derived values stored are: google_place_id (indefinitely) and a pin's
-- latitude/longitude (fetched_at < 29 days, enforced by the read filter AND a nightly purge).
-- NOT stored: names, addresses, types, photos, ratings. "Pharmacy" is decided from types at
-- check-in/refresh time and recorded only as the ABSENCE of a pin row.
--
-- ─── WHO CAN SEE WHAT (plain English) ───────────────────────────────────────
--   checkins.google_place_id — same owner-only RLS as 1092 (no policy change).
--   google_place_pins        — no client role can read or write the table. Everyone signed
--                              in (guests included) reads pins through get_google_place_pins(),
--                              which returns only (place id, lat, lng) for places with at
--                              least one check-in by a VISIBLE author (checkins_public, named,
--                              not banned). A hidden or under-18 user's check-in never makes
--                              a pin, so a pin never says "a hidden person was here".
--   google_places_usage      — per-user and global daily call counters for the Edge Function
--                              (Google bills per call). service_role only; rows older than
--                              2 days are purged nightly. Holds user id + counts, nothing else.
--   check_in_google()        — service_role only. Re-runs every 1092 rule for p_user_id.
--   get_checkin_feed()       — also returns Google check-ins (name resolved live by the app).
--
-- ─── CRON ───────────────────────────────────────────────────────────────────
--   purge-google-places-cache   03:41 UTC  pins older than 29 days or with no check-in left;
--                                          usage rows older than 2 days.
--   google-places-refresh       03:21 UTC  POSTs {"action":"refresh"} to the google-places
--                                          function, which re-reads location+types for pins
--                                          older than 20 days (Essentials SKU). A failed
--                                          refresh means the pin is purged at day 29 and
--                                          returns on the next check-in — never kept stale.
--
-- Apply: gh workflow run supabase-migrate -f file=20261093_checkins_google_places.sql
-- PRECONDITION: 20261092 applied; google-places deployed; GOOGLE_PLACES_SERVER_KEY set.
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── 0. Requires ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.checkins') IS NULL
     OR to_regprocedure('public.check_in(uuid,double precision,double precision,double precision)') IS NULL
     OR to_regprocedure('public.metres_between(double precision,double precision,double precision,double precision)') IS NULL THEN
    RAISE EXCEPTION 'REFUSING: 20261092 (check-ins) is not applied. Nothing applied.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'is_anonymous') THEN
    RAISE EXCEPTION 'REFUSING: auth.users.is_anonymous is missing (check_in_google needs it). Nothing applied.';
  END IF;
  IF (SELECT count(*) FROM vault.secrets WHERE name = 'novest_sync_key') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'REFUSING: Vault secret novest_sync_key is missing — the refresh job would POST without a key.';
  END IF;
  PERFORM set_config('app.m1093_profiles_policies',
    (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles'), true);
  PERFORM set_config('app.m1093_checkins_policies',
    (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'checkins'), true);
END $$;

-- ─── 1. checkins: ADA place XOR Google place ───────────────────────────────
ALTER TABLE public.checkins ALTER COLUMN place_id DROP NOT NULL;
ALTER TABLE public.checkins ADD COLUMN IF NOT EXISTS google_place_id text;

ALTER TABLE public.checkins DROP CONSTRAINT IF EXISTS checkins_one_place;
ALTER TABLE public.checkins ADD CONSTRAINT checkins_one_place
  CHECK (num_nonnulls(place_id, google_place_id) = 1);
-- Google place IDs are URL-safe base64-ish tokens. The shape check keeps anything else
-- (whitespace, quotes, a URL) out of a column the app later sends back to Google.
ALTER TABLE public.checkins DROP CONSTRAINT IF EXISTS checkins_google_place_id_shape;
ALTER TABLE public.checkins ADD CONSTRAINT checkins_google_place_id_shape
  CHECK (google_place_id IS NULL OR google_place_id ~ '^[A-Za-z0-9_-]{16,255}$');

-- 1092's UNIQUE (user_id, place_id, checked_in_on) never fires when place_id is NULL.
CREATE UNIQUE INDEX IF NOT EXISTS checkins_one_per_day_google
  ON public.checkins (user_id, google_place_id, checked_in_on) WHERE google_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS checkins_google_feed_idx
  ON public.checkins (google_place_id, created_at DESC, id DESC) WHERE google_place_id IS NOT NULL;

COMMENT ON COLUMN public.checkins.google_place_id IS
  'Google Places place ID (stored indefinitely, permitted by the Places policies). Exactly one '
  'of place_id / google_place_id is set. Written only by check_in_google(). 20261093.';

-- ─── 2. Pins (lat/lng only, ≤ 29 days) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.google_place_pins (
  google_place_id text             NOT NULL,
  latitude        double precision NOT NULL,
  longitude       double precision NOT NULL,
  fetched_at      timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT google_place_pins_pkey PRIMARY KEY (google_place_id),
  CONSTRAINT google_place_pins_id_shape CHECK (google_place_id ~ '^[A-Za-z0-9_-]{16,255}$'),
  CONSTRAINT google_place_pins_coords CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
);
COMMENT ON TABLE public.google_place_pins IS
  'Map pins for Google places with a visible ADA check-in. Google Maps Content: ONLY lat/lng, '
  'cached < 30 days (SST §14.3) — read filter and nightly purge at 29 days. No names/types. '
  'No pharmacy-type place ever has a row. service_role only. 20261093.';

ALTER TABLE public.google_place_pins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.google_place_pins FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.google_place_pins TO service_role;

-- ─── 3. Call counters (Google bills per call) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.google_places_usage (
  day     date    NOT NULL,
  user_id uuid    NOT NULL,   -- 00000000-0000-0000-0000-000000000000 = the global row
  kind    text    NOT NULL,
  n       integer NOT NULL DEFAULT 0,
  CONSTRAINT google_places_usage_pkey PRIMARY KEY (day, user_id, kind),
  CONSTRAINT google_places_usage_kind_check CHECK (kind IN ('nearby','details','checkin','refresh'))
);
COMMENT ON TABLE public.google_places_usage IS
  'Daily Google Places call counters per user (and one global row, nil uuid) for the '
  'google-places Edge Function. No FK on purpose (the global row); purged after 2 days. 20261093.';

ALTER TABLE public.google_places_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.google_places_usage FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.google_places_usage TO service_role;

-- true = the call may go to Google. Both rows are locked, so concurrent calls cannot both
-- pass the last unit. Caps per (UTC day): see the CASE. Tuning is a new migration.
CREATE OR REPLACE FUNCTION public.claim_google_places_call(p_user_id uuid, p_kind text, p_cost integer DEFAULT 1)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_day    date := (now() AT TIME ZONE 'UTC')::date;
  v_global uuid := '00000000-0000-0000-0000-000000000000';
  v_ucap   int;
  v_gcap   int;
  v_u      int;
  v_g      int;
BEGIN
  IF p_cost IS NULL OR p_cost < 1 OR p_cost > 50 THEN
    RAISE EXCEPTION 'BAD_COST';
  END IF;
  v_ucap := CASE p_kind WHEN 'nearby' THEN 40 WHEN 'details' THEN 400 WHEN 'checkin' THEN 40 WHEN 'refresh' THEN 2000 END;
  v_gcap := CASE p_kind WHEN 'nearby' THEN 3000 WHEN 'details' THEN 6000 WHEN 'checkin' THEN 3000 WHEN 'refresh' THEN 2000 END;
  IF v_ucap IS NULL THEN
    RAISE EXCEPTION 'BAD_KIND';
  END IF;

  INSERT INTO google_places_usage (day, user_id, kind) VALUES (v_day, p_user_id, p_kind), (v_day, v_global, p_kind)
  ON CONFLICT DO NOTHING;
  SELECT n INTO v_g FROM google_places_usage WHERE day = v_day AND user_id = v_global AND kind = p_kind FOR UPDATE;
  SELECT n INTO v_u FROM google_places_usage WHERE day = v_day AND user_id = p_user_id AND kind = p_kind FOR UPDATE;
  IF v_g + p_cost > v_gcap OR (p_user_id IS DISTINCT FROM v_global AND v_u + p_cost > v_ucap) THEN
    RETURN false;
  END IF;
  UPDATE google_places_usage SET n = n + p_cost
   WHERE day = v_day AND kind = p_kind AND user_id IN (p_user_id, v_global);
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_google_places_call(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_google_places_call(uuid, text, integer) TO service_role;

-- ─── 4. The rules, once, for both kinds of place ────────────────────────────
-- 1092's check_in() held every rule inline. They move into two helpers so the ADA path and
-- the Google path cannot drift; check_in() keeps its signature, refusal order and codes.
-- Neither helper is callable by any API role: they trust the uid they are handed.
CREATE OR REPLACE FUNCTION public.checkin_guard_person(p_user_id uuid)
 RETURNS profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prof profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_prof FROM profiles WHERE id = p_user_id;
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
  RETURN v_prof;
END;
$function$;

REVOKE ALL ON FUNCTION public.checkin_guard_person(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.checkin_write(
  p_user_id uuid, p_display_name text, p_place_id uuid, p_google_place_id text,
  p_place_lat double precision, p_place_lng double precision,
  p_lat double precision, p_lng double precision, p_accuracy double precision)
 RETURNS TABLE(checkin_id uuid, created_at timestamptz, already boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_day  date := (now() AT TIME ZONE 'Europe/Istanbul')::date;
  v_prev record;
  v_id   uuid;
BEGIN
  -- BETWEEN rejects NaN and ±Infinity (NaN sorts above every number in Postgres).
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'BAD_FIX';
  END IF;
  IF p_accuracy IS NULL OR NOT (p_accuracy > 0 AND p_accuracy <= 50) THEN
    RAISE EXCEPTION 'LOW_ACCURACY';
  END IF;
  IF metres_between(p_lat, p_lng, p_place_lat, p_place_lng) > 150 THEN
    RAISE EXCEPTION 'TOO_FAR';
  END IF;

  -- Already here today: not an error, and not subject to the cap or the travel check.
  SELECT c.id, c.created_at INTO v_prev FROM checkins c
   WHERE c.user_id = p_user_id AND c.checked_in_on = v_day
     AND c.place_id IS NOT DISTINCT FROM p_place_id
     AND c.google_place_id IS NOT DISTINCT FROM p_google_place_id;
  IF FOUND THEN
    RETURN QUERY SELECT v_prev.id, v_prev.created_at, true;
    RETURN;
  END IF;

  IF (SELECT count(*) FROM checkins c WHERE c.user_id = p_user_id AND c.checked_in_on = v_day) >= 30 THEN
    RAISE EXCEPTION 'DAILY_LIMIT';
  END IF;

  -- Impossible travel, from the PREVIOUS check-in's PLACE (no device coordinates are stored).
  -- LEFT JOINs: the previous one may be a Google place, whose position is its pin if one is
  -- still cached (none for a pharmacy or after the purge → that comparison is skipped, never
  -- the next-older row). The 1 km floor: two places near one spot never refuse each other.
  SELECT c.created_at, coalesce(pl.latitude, gp.latitude) AS latitude, coalesce(pl.longitude, gp.longitude) AS longitude
    INTO v_prev
    FROM checkins c
    LEFT JOIN places pl ON pl.id = c.place_id
    LEFT JOIN google_place_pins gp ON gp.google_place_id = c.google_place_id
   WHERE c.user_id = p_user_id
   ORDER BY c.created_at DESC
   LIMIT 1;
  IF FOUND AND v_prev.latitude IS NOT NULL AND v_prev.longitude IS NOT NULL THEN
    DECLARE
      v_d double precision := metres_between(v_prev.latitude, v_prev.longitude, p_place_lat, p_place_lng);
      v_s double precision := greatest(extract(epoch FROM now() - v_prev.created_at), 1);
    BEGIN
      IF v_d > 1000 AND v_d / v_s > 150 / 3.6 THEN
        RAISE EXCEPTION 'TOO_FAST';
      END IF;
    END;
  END IF;

  INSERT INTO checkins (user_id, place_id, google_place_id, checked_in_on, display_name_snapshot)
  VALUES (p_user_id, p_place_id, p_google_place_id, v_day, p_display_name)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN   -- lost a same-day race to a concurrent call: report the winner
    RETURN QUERY SELECT c.id, c.created_at, true FROM checkins c
      WHERE c.user_id = p_user_id AND c.checked_in_on = v_day
        AND c.place_id IS NOT DISTINCT FROM p_place_id
        AND c.google_place_id IS NOT DISTINCT FROM p_google_place_id;
    RETURN;
  END IF;
  RETURN QUERY SELECT c.id, c.created_at, false FROM checkins c WHERE c.id = v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.checkin_write(uuid, text, uuid, text, double precision, double precision, double precision, double precision, double precision)
  FROM PUBLIC, anon, authenticated, service_role;

-- ─── 5. check_in(): same signature, same refusal order, now through the helpers ──
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
BEGIN
  IF v_me IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  v_prof := checkin_guard_person(v_me);

  SELECT * INTO v_place FROM places
   WHERE id = p_place_id AND status = 'active' AND hidden_at IS NULL
     AND latitude IS NOT NULL AND longitude IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLACE_NOT_FOUND';
  END IF;

  RETURN QUERY SELECT * FROM checkin_write(v_me, v_prof.display_name, p_place_id, NULL,
    v_place.latitude, v_place.longitude, p_lat, p_lng, p_accuracy);
END;
$function$;

-- ─── 6. check_in_google(): service_role only (the Edge Function) ────────────
-- p_user_id comes from the Edge Function's auth.getUser() on the caller's JWT, never from
-- the request body. p_place_lat/lng come from Google (Place Details, server key), never from
-- the app. p_pin = false for pharmacy-type places: no pin row, and any old one is removed.
CREATE OR REPLACE FUNCTION public.check_in_google(
  p_user_id uuid, p_google_place_id text,
  p_place_lat double precision, p_place_lng double precision,
  p_lat double precision, p_lng double precision, p_accuracy double precision,
  p_pin boolean)
 RETURNS TABLE(checkin_id uuid, created_at timestamptz, already boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prof profiles%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id AND u.is_anonymous IS NOT TRUE) THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  v_prof := checkin_guard_person(p_user_id);

  IF p_google_place_id IS NULL OR p_google_place_id !~ '^[A-Za-z0-9_-]{16,255}$'
     OR p_place_lat IS NULL OR p_place_lng IS NULL
     OR p_place_lat NOT BETWEEN -90 AND 90 OR p_place_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'PLACE_NOT_FOUND';
  END IF;

  RETURN QUERY SELECT * FROM checkin_write(p_user_id, v_prof.display_name, NULL, p_google_place_id,
    p_place_lat, p_place_lng, p_lat, p_lng, p_accuracy);

  -- Reached only when the check-in exists (every refusal raised above, rolling this back).
  IF p_pin IS TRUE THEN
    INSERT INTO google_place_pins (google_place_id, latitude, longitude, fetched_at)
    VALUES (p_google_place_id, p_place_lat, p_place_lng, now())
    ON CONFLICT (google_place_id) DO UPDATE
      SET latitude = excluded.latitude, longitude = excluded.longitude, fetched_at = excluded.fetched_at;
  ELSE
    DELETE FROM google_place_pins WHERE google_place_id = p_google_place_id;
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.check_in_google(uuid, text, double precision, double precision, double precision, double precision, double precision, boolean) IS
  'Google-place check-in for the google-places Edge Function (service_role only). Same rules as '
  'check_in() via checkin_guard_person + checkin_write. Place coordinates come from Google, not '
  'the app. Upserts the pin unless p_pin is false (pharmacy), which removes it. 20261093.';

REVOKE ALL ON FUNCTION public.check_in_google(uuid, text, double precision, double precision, double precision, double precision, double precision, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_in_google(uuid, text, double precision, double precision, double precision, double precision, double precision, boolean)
  TO service_role;

-- ─── 7. The feed, with Google rows ──────────────────────────────────────────
-- The signature gains p_google_place_id LAST, so 1092's positional order still works; the
-- old 4-argument function is dropped (two overloads would make named calls ambiguous).
-- Google rows: place_* columns are NULL and google_place_id is set; the app resolves the name
-- live (it may not be stored).
DROP FUNCTION IF EXISTS public.get_checkin_feed(uuid, timestamptz, uuid, integer);
CREATE OR REPLACE FUNCTION public.get_checkin_feed(
  p_place_id        uuid        DEFAULT NULL,
  p_before_at       timestamptz DEFAULT NULL,
  p_before_id       uuid        DEFAULT NULL,
  p_limit           integer     DEFAULT 20,
  p_google_place_id text        DEFAULT NULL
)
 RETURNS TABLE(checkin_id uuid, created_at timestamptz, place_id uuid, place_name text,
               place_name_i18n jsonb, place_category text, display_name text,
               avatar_url text, is_mine boolean, google_place_id text)
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
         c.display_name_snapshot, p.avatar_url, (c.user_id = v_me), c.google_place_id
    FROM checkins c
    JOIN profiles p ON p.id = c.user_id
    LEFT JOIN places pl ON pl.id = c.place_id
   WHERE (c.google_place_id IS NOT NULL OR (pl.status = 'active' AND pl.hidden_at IS NULL))
     AND (p_place_id IS NULL OR c.place_id = p_place_id)
     AND (p_google_place_id IS NULL OR c.google_place_id = p_google_place_id)
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

COMMENT ON FUNCTION public.get_checkin_feed(uuid, timestamptz, uuid, integer, text) IS
  'Recent check-ins, newest first, keyset-paginated, max 50 per page; all places, one ADA place '
  'or one Google place. Others'' rows only when checkins_public, named, unbanned, not blocked '
  'either way, ADA place active and unhidden; the caller''s own rows always (is_mine). Google '
  'rows carry google_place_id and NULL place_*. Guests raise AUTH_REQUIRED. 20261092/20261093.';

REVOKE ALL ON FUNCTION public.get_checkin_feed(uuid, timestamptz, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_checkin_feed(uuid, timestamptz, uuid, integer, text) TO authenticated;

-- ─── 8. Pins for the map ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_google_place_pins()
 RETURNS TABLE(google_place_id text, latitude double precision, longitude double precision)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT gp.google_place_id, gp.latitude, gp.longitude
    FROM google_place_pins gp
   WHERE gp.fetched_at > now() - interval '29 days'
     AND EXISTS (
       SELECT 1 FROM checkins c JOIN profiles p ON p.id = c.user_id
        WHERE c.google_place_id = gp.google_place_id
          AND p.checkins_public IS TRUE
          AND p.display_name IS NOT NULL
          AND (p.ugc_banned_until IS NULL OR p.ugc_banned_until <= now()))
$function$;

COMMENT ON FUNCTION public.get_google_place_pins() IS
  'Google place pins (id, lat, lng) with a cached position younger than 29 days and at least '
  'one check-in by a visible author. No names, no counts, no people. 20261093.';

REVOKE ALL ON FUNCTION public.get_google_place_pins() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_google_place_pins() TO authenticated;

-- ─── 9. Purge + refresh jobs ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_google_places_cache()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n_pins  int;
  n_usage int;
BEGIN
  DELETE FROM google_place_pins gp
   WHERE gp.fetched_at <= now() - interval '29 days'
      OR NOT EXISTS (SELECT 1 FROM checkins c WHERE c.google_place_id = gp.google_place_id);
  GET DIAGNOSTICS n_pins = ROW_COUNT;
  DELETE FROM google_places_usage WHERE day < (now() AT TIME ZONE 'UTC')::date - 2;
  GET DIAGNOSTICS n_usage = ROW_COUNT;
  RETURN jsonb_build_object('pins', n_pins, 'usage', n_usage);
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_google_places_cache() FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE j text;
BEGIN
  FOREACH j IN ARRAY ARRAY['purge-google-places-cache','google-places-refresh'] LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = j) THEN PERFORM cron.unschedule(j); END IF;
  END LOOP;
END $$;

SELECT cron.schedule('purge-google-places-cache', '41 3 * * *', $$ SELECT public.purge_google_places_cache() $$);
SELECT cron.schedule('google-places-refresh', '21 3 * * *', $job$
  SELECT net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/google-places',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),
    body    := '{"action":"refresh"}'::jsonb);
$job$);

-- ─── 10. Assertions — read back from the catalogs, inside the transaction ───
DO $$
DECLARE
  v_n     int;
  v_names text;
  v_def   text;
  v_fn    text;
  v_err   text;
  v_t     regclass;
BEGIN
  -- (a) checkins: exactly-one CHECK, shape CHECK, partial unique; place_id nullable now.
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.checkins'::regclass AND conname = 'checkins_one_place';
  IF v_def IS DISTINCT FROM 'CHECK ((num_nonnulls(place_id, google_place_id) = 1))' THEN
    RAISE EXCEPTION 'checkins_one_place is %', coalesce(v_def, '<missing>');
  END IF;
  SELECT indexdef INTO v_def FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'checkins_one_per_day_google';
  IF v_def NOT LIKE 'CREATE UNIQUE INDEX%(user_id, google_place_id, checked_in_on) WHERE (google_place_id IS NOT NULL)' THEN
    RAISE EXCEPTION 'checkins_one_per_day_google is %', coalesce(v_def, '<missing>');
  END IF;
  -- Still no device-location column (1092's rule; derived, not a name list).
  SELECT count(*), string_agg(column_name, ',') INTO v_n, v_names FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'checkins'
     AND (column_name ILIKE '%lat%' OR column_name ILIKE '%lng%' OR column_name ILIKE '%lon%' OR column_name ILIKE '%accura%');
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'checkins carries a location column: %', v_names;
  END IF;

  -- (b) The two new tables: RLS on, NO policies, no client privilege at all.
  FOREACH v_fn IN ARRAY ARRAY['google_place_pins','google_places_usage'] LOOP
    v_t := to_regclass('public.' || v_fn);
    IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_t) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'RLS is not enabled on %', v_fn;
    END IF;
    SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = v_fn;
    IF v_n IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION '% must have no policies (service_role only); found %', v_fn, v_n;
    END IF;
    IF has_table_privilege('anon', v_t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
       OR has_table_privilege('authenticated', v_t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') THEN
      RAISE EXCEPTION 'a client role holds a privilege on %', v_fn;
    END IF;
    IF NOT has_table_privilege('service_role', v_t, 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'service_role cannot write % — the Edge Function would fail', v_fn;
    END IF;
  END LOOP;

  -- (c) The pins table holds exactly the four columns the terms allow (derived).
  SELECT string_agg(column_name, ',' ORDER BY column_name) INTO v_names FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'google_place_pins';
  IF v_names IS DISTINCT FROM 'fetched_at,google_place_id,latitude,longitude' THEN
    RAISE EXCEPTION 'google_place_pins columns are %, expected exactly fetched_at,google_place_id,latitude,longitude', v_names;
  END IF;

  -- (d) EXECUTE among the API roles. Client-facing: authenticated only (never anon/PUBLIC).
  --     Service-facing: no client role, and service_role MUST hold it (the Edge Function).
  --     Helpers: no API role at all, service_role included. service_role on the client-facing
  --     ones is Supabase's default grant and harmless. aclexplode sees PUBLIC as grantee 0.
  FOR v_fn, v_names IN SELECT * FROM (VALUES
      ('check_in',                  'authenticated'),
      ('get_checkin_feed',          'authenticated'),
      ('get_google_place_pins',     'authenticated'),
      ('check_in_google',           'service_role'),
      ('claim_google_places_call',  'service_role'),
      ('checkin_guard_person',      'none'),
      ('checkin_write',             'none'),
      ('purge_google_places_cache', 'none')) x(f, who) LOOP
    SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_fn;
    IF v_n IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION '% must be exactly one function (found %)', v_fn, v_n;
    END IF;
    SELECT coalesce(string_agg(DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END, ','), '')
      INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      LEFT JOIN LATERAL aclexplode(p.proacl) a ON TRUE
      LEFT JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname = 'public' AND p.proname = v_fn AND a.privilege_type = 'EXECUTE'
       AND (a.grantee = 0 OR r.rolname IN ('anon','authenticated','service_role'));
    IF (v_names = 'authenticated' AND (v_def NOT LIKE '%authenticated%' OR v_def LIKE '%anon%' OR v_def LIKE '%PUBLIC%'))
       OR (v_names = 'service_role' AND v_def IS DISTINCT FROM 'service_role')
       OR (v_names = 'none' AND v_def IS DISTINCT FROM '') THEN
      RAISE EXCEPTION '% EXECUTE is held by [%], expected %', v_fn, v_def, v_names;
    END IF;
    IF NOT (SELECT prosecdef AND proconfig::text ILIKE '%search_path=public%' FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = v_fn) THEN
      RAISE EXCEPTION '% is not SECURITY DEFINER with search_path pinned', v_fn;
    END IF;
  END LOOP;

  -- (e) POSITIVE CONTROLS: as postgres there is no auth.uid() → both client RPCs refuse first.
  v_err := NULL;
  BEGIN PERFORM * FROM public.check_in('00000000-0000-4000-8000-000000001091', 35, 33, 10);
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
  -- …and check_in_google refuses a uuid that is no user.
  v_err := NULL;
  BEGIN PERFORM * FROM public.check_in_google('00000000-0000-4000-8000-000000001091', 'ChIJ0000000000000000', 35, 33, 35, 33, 10, true);
  EXCEPTION WHEN OTHERS THEN v_err := SQLERRM; END;
  IF v_err IS DISTINCT FROM 'AUTH_REQUIRED' THEN
    RAISE EXCEPTION 'check_in_google for a non-user did not raise AUTH_REQUIRED (got %)', coalesce(v_err, 'NO EXCEPTION');
  END IF;

  -- (f) Both jobs scheduled and active; no inline JWT in either command.
  SELECT count(*) INTO v_n FROM cron.job
   WHERE jobname IN ('purge-google-places-cache','google-places-refresh') AND active;
  IF v_n IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'expected 2 active google-places cron jobs, found %', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'google-places-refresh' AND command ~ 'eyJ[A-Za-z0-9_-]{10,}') THEN
    RAISE EXCEPTION 'google-places-refresh carries an inline JWT';
  END IF;

  -- (g) No policy was added to profiles or checkins by this file.
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles')::text
       IS DISTINCT FROM current_setting('app.m1093_profiles_policies', true)
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'checkins')::text
       IS DISTINCT FROM current_setting('app.m1093_checkins_policies', true) THEN
    RAISE EXCEPTION 'a profiles or checkins policy changed inside this file';
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
VALUES ('20261093_checkins_google_places.sql', 'de646ea056400cc96c550ce190a9d0a436093a205d55395d9a177af5fe521d9f')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- 20261165 — Araçlar (cars) schema: vehicle_sources, dealers, vehicles, vehicle_images, bucket, expiry
-- ═══════════════════════════════════════════════════════════════════════════
--
-- SCHEMA ONLY, no data. Car listings for sale and rent, from dealers, private users and (later) imported
-- sites. The app module is MODULE_FLAGS.cars (false): nothing reads or writes here until a later slice.
-- Plan + Berke's decisions: vault 10-ada/2026-11-07_araclar-PLAN.md.
--
-- ─── TABLES ─────────────────────────────────────────────────────────────────
--   vehicle_sources  one row per import site. is_active DEFAULT false and a CHECK: a site can only be
--                    switched on once its terms of use AND robots.txt check dates are recorded
--                    (the "check before any adapter" rule, held by the database).
--   dealers          admin-seeded dealer/rental companies, is_active DEFAULT false.
--   vehicles         every listing. source: 'private' (a user's own), 'dealer' (seeded for a dealer),
--                    'import' (a site adapter, service_role). status: pending | active | rejected |
--                    expired | removed. Reports use hidden_at/hidden_reason (20261166), not a status.
--   vehicle_images   one row per photo, a storage path in bucket vehicle-images (never a free URL).
--
-- ─── WHO CAN READ ───────────────────────────────────────────────────────────
--   Anyone (anon + signed in) sees a listing only when ALL hold: status 'active'; not past expires_at;
--   its dealer (if any) is active; its import source (if any) is active; it has at least one photo
--   (RESTRICTIVE vehicles_hide_photoless); not hidden by reports (RESTRICTIVE, 20261166).
--   The owner sees their own listings in every state (a signed-in non-guest only). Admins see all.
--   ADA Preview (is_previewer(): the preview key header, Preview builds only) additionally sees ACTIVE
--   listings of INACTIVE dealers / sources, and those dealers / sources — the 20261120 contract:
--   is_previewer() only in SELECT policies, always paired with an unpublished condition. Production
--   bundles never carry the key (check-ota-preflight).
--   Photos (vehicle_images) are readable exactly when their listing is (the policy reads vehicles
--   under the caller's own RLS).
--
-- ─── WHO CAN WRITE ──────────────────────────────────────────────────────────
--   vehicle_sources, dealers: service_role only (no client grant at all).
--   vehicles, INSERT: a signed-in NON-GUEST user, their own private listing only, through the column
--     grant (listing fields only). The guard trigger then forces owner_id = caller, source 'private',
--     status 'pending' and blanks every system column, and REFUSES when the caller:
--       • has no date of birth (NO_DOB) or is under 18 (UNDER_18) — private.is_adult_on() (20261164),
--         with "today" in Europe/Istanbul like the app's isAdultForOrder;
--       • is UGC-banned (UGC_BANNED);
--       • already has 3 listings pending or active (VEHICLE_LIMIT; per-user advisory lock, so parallel
--         inserts queue instead of each counting before the others commit);
--       • writes a blocked term or payment instructions (BLOCKED_TERM / BLOCKED_PAYMENT, the same
--         filters as places).
--   vehicles, UPDATE by the owner: listing fields + status. Any field edit on an approved, expired or
--     rejected listing sends it back to 'pending' (admin review again), so an approved listing cannot be
--     turned into something else afterwards. Status moves the owner may make: anything → 'removed',
--     and active/expired/rejected → 'pending' (resubmit; the cap of 3 applies). A removed listing is
--     frozen. System columns (owner, source, dealer, import keys, dates, rejection reason) are locked.
--   vehicles, UPDATE by an admin: status + rejection_reason (+ hidden_* to restore a reported listing) only. pending → active stamps published_at
--     and, for a private listing, expires_at = now() + 30 days.
--   Nobody DELETEs a listing from the app (removed is a status).
--   renew_vehicle(id): the owner puts an active or expired private listing back to active for 30 days
--     from now (cap re-checked when it was expired). SECURITY DEFINER, own rows only, no guests.
--   vehicle_images: the owner adds / reorders / deletes photos of their own listing while it is
--     'pending', storage path '<vehicle id>/<random uuid>.<ext>'; max 8 per listing. Admins may delete.
--   my_vehicles(): the owner's own listings in every state. vehicles.owner_id itself is NOT readable by
--     any client (column grant), so a seller's account id never becomes public.
--   Writes by service_role / postgres (imports, cron, the RPC) skip the client rules in the trigger:
--     it branches on current_user, which is 'authenticated'/'anon' only for a direct client statement.
--
-- ─── EXPIRY ─────────────────────────────────────────────────────────────────
--   Visibility never waits for a job: the read policy itself requires expires_at > now(). The nightly
--   cron expire-vehicles (02:40 UTC) only moves status active → expired so owners see it and can renew.
--
-- ─── STORAGE: bucket vehicle-images ─────────────────────────────────────────
--   Public read (listing photos are public), 5 MB per file, jpeg/png/webp. The app compresses with the
--   image picker (quality 0.6) until expo-image-manipulator ships with the next store build.
--   Files live at '<vehicle id>/<random uuid>.<ext>' (no uploader id in a public URL). A signed-in non-guest
--   may add or delete files only for a listing they own that is still PENDING (so an approved listing's photos
--   cannot be swapped, and the bucket is no general image host); nobody can overwrite (no UPDATE policy).
--   Owners may SELECT their own listings' files (remove() needs it); admins may SELECT and DELETE any.
--   'partner/…' (mirrored import photos) is service_role only.
--
-- ─── contact_events ─────────────────────────────────────────────────────────
--   module 'cars' added, or the Ara / WhatsApp taps would be dropped silently.
--
-- Apply: part of the Araçlar S1 release run (one approval), after 20261164 (needs private.is_adult_on).
-- Creates tables ⇒ ends with NOTIFY pgrst (after COMMIT and RESET ROLE).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  v_fn  text;
  v_def text;
  v_have text[];
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.is_admin()', 'public.is_previewer()', 'public.is_anonymous_session()',
                              'public.contains_blocked_term(text)', 'public.contains_payment_solicitation(text)',
                              'private.is_adult_on(date,date)'] LOOP
    IF to_regprocedure(v_fn) IS NULL THEN RAISE EXCEPTION 'REFUSING: % is missing (is 20261164 applied?). Nothing applied.', v_fn; END IF;
  END LOOP;
  -- vehicles_guard is SECURITY INVOKER: a client's own role must be able to call what it calls.
  FOREACH v_fn IN ARRAY ARRAY['public.is_admin()', 'public.is_anonymous_session()', 'public.contains_blocked_term(text)',
                              'public.contains_payment_solicitation(text)'] LOOP
    IF NOT has_function_privilege('authenticated', to_regprocedure(v_fn), 'EXECUTE') THEN
      RAISE EXCEPTION 'REFUSING: authenticated cannot EXECUTE %, which vehicles_guard calls as the client. Nothing applied.', v_fn;
    END IF;
  END LOOP;
  -- contact_events_module_check must be the 20261115 list, so adding 'cars' cannot drop anything.
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = to_regclass('public.contact_events') AND conname = 'contact_events_module_check';
  SELECT array_agg(m[1] ORDER BY m[1]) INTO v_have FROM regexp_matches(coalesce(v_def, ''), '''([A-Za-z]+)''', 'g') m;
  IF v_have IS DISTINCT FROM ARRAY['accommodation','connectivity','eatery','ehliyet','events','explore','garages','grooming',
                                   'homeServices','hotels','insurance','jobs','pets','studentHub','towing','transport'] THEN
    RAISE EXCEPTION 'REFUSING: contact_events_module_check is not the 20261115 list: %. Rebuild from the live definition. Nothing applied.', v_def;
  END IF;
  -- Remember the storage.objects policy count to prove exactly three were added.
  PERFORM set_config('mig1165.storage_policies',
    (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'), true);
END $$;

-- ─── Tables ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_sources (
  site              text        NOT NULL,
  name              text        NOT NULL,
  terms_checked_at  timestamptz,
  robots_checked_at timestamptz,
  terms_note        text,
  is_active         boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_sources_pkey PRIMARY KEY (site),
  CONSTRAINT vehicle_sources_site_check CHECK (site ~ '^[a-z0-9][a-z0-9.-]{2,79}$'),
  CONSTRAINT vehicle_sources_name_check CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT vehicle_sources_checked_before_active CHECK (NOT is_active OR (terms_checked_at IS NOT NULL AND robots_checked_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.dealers (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  slug              text        NOT NULL,
  name              text        NOT NULL,
  logo_path         text,
  phone             text,
  whatsapp          text,
  region            text,
  area              text,
  website           text,
  is_rental_company boolean     NOT NULL DEFAULT false,
  is_active         boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dealers_pkey PRIMARY KEY (id),
  CONSTRAINT dealers_slug_key UNIQUE (slug),
  CONSTRAINT dealers_slug_check CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  CONSTRAINT dealers_name_check CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT dealers_phone_check CHECK (phone IS NULL OR phone ~ '^\+?[0-9]{7,15}$'),
  CONSTRAINT dealers_whatsapp_check CHECK (whatsapp IS NULL OR whatsapp ~ '^\+?[0-9]{7,15}$'),
  CONSTRAINT dealers_website_check CHECK (website IS NULL OR website ~ '^https://')
);

CREATE TABLE IF NOT EXISTS public.vehicles (
  id               uuid          NOT NULL DEFAULT gen_random_uuid(),
  intent           text          NOT NULL,
  source           text          NOT NULL DEFAULT 'private',
  source_site      text,
  source_url       text,
  external_id      text,
  content_hash     text,
  dealer_id        uuid,
  owner_id         uuid          DEFAULT auth.uid(),
  make             text          NOT NULL,
  model            text          NOT NULL,
  year             smallint      NOT NULL,
  km               integer       NOT NULL,
  fuel             text          NOT NULL,
  gearbox          text          NOT NULL,
  body_type        text          NOT NULL,
  colour           text          NOT NULL,
  steering         text          NOT NULL,
  price            numeric(12,2),
  currency         text          NOT NULL,
  price_per_day    numeric(10,2),
  region           text          NOT NULL,
  area             text,
  description      text,
  contact_phone    text,
  whatsapp         text,
  status           text          NOT NULL DEFAULT 'pending',
  rejection_reason text,
  published_at     timestamptz,
  expires_at       timestamptz,
  hidden_at        timestamptz,
  hidden_reason    text,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT vehicles_pkey PRIMARY KEY (id),
  CONSTRAINT vehicles_dealer_id_fkey FOREIGN KEY (dealer_id) REFERENCES public.dealers(id) ON DELETE RESTRICT,
  CONSTRAINT vehicles_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT vehicles_source_site_fkey FOREIGN KEY (source_site) REFERENCES public.vehicle_sources(site) ON DELETE RESTRICT,
  CONSTRAINT vehicles_external_key UNIQUE (source_site, external_id),
  CONSTRAINT vehicles_intent_check CHECK (intent IN ('sale', 'rent')),
  CONSTRAINT vehicles_source_check CHECK (source IN ('private', 'dealer', 'import')),
  CONSTRAINT vehicles_status_check CHECK (status IN ('pending', 'active', 'rejected', 'expired', 'removed')),
  -- Who a listing belongs to follows from its source.
  CONSTRAINT vehicles_ownership_check CHECK (
       (source = 'private' AND owner_id IS NOT NULL AND dealer_id IS NULL AND source_site IS NULL AND external_id IS NULL)
    OR (source = 'dealer'  AND owner_id IS NULL AND dealer_id IS NOT NULL AND source_site IS NULL)
    OR (source = 'import'  AND owner_id IS NULL AND source_site IS NOT NULL AND external_id IS NOT NULL)),
  -- A sale has a price, a rental a daily price, never both.
  CONSTRAINT vehicles_price_check CHECK (
       (intent = 'sale' AND price IS NOT NULL AND price_per_day IS NULL)
    OR (intent = 'rent' AND price_per_day IS NOT NULL AND price IS NULL)),
  CONSTRAINT vehicles_price_range_check CHECK ((price IS NULL OR price > 0 AND price <= 100000000)
                                           AND (price_per_day IS NULL OR price_per_day > 0 AND price_per_day <= 1000000)),
  CONSTRAINT vehicles_currency_check CHECK (currency IN ('GBP', 'TRY', 'EUR', 'USD')),
  CONSTRAINT vehicles_make_check CHECK (char_length(make) BETWEEN 1 AND 40),
  CONSTRAINT vehicles_model_check CHECK (char_length(model) BETWEEN 1 AND 60),
  CONSTRAINT vehicles_year_check CHECK (year BETWEEN 1950 AND 2100),
  CONSTRAINT vehicles_km_check CHECK (km BETWEEN 0 AND 2000000),
  CONSTRAINT vehicles_fuel_check CHECK (fuel IN ('petrol', 'diesel', 'hybrid', 'electric', 'lpg')),
  CONSTRAINT vehicles_gearbox_check CHECK (gearbox IN ('manual', 'automatic')),
  CONSTRAINT vehicles_body_type_check CHECK (body_type IN ('sedan', 'hatchback', 'suv', 'estate', 'coupe', 'convertible', 'pickup', 'van', 'minivan')),
  CONSTRAINT vehicles_colour_check CHECK (colour IN ('white', 'black', 'grey', 'silver', 'blue', 'red', 'green', 'yellow', 'orange', 'brown', 'beige', 'gold', 'purple', 'other')),
  CONSTRAINT vehicles_steering_check CHECK (steering IN ('right', 'left')),
  CONSTRAINT vehicles_region_check CHECK (char_length(region) BETWEEN 1 AND 60),
  CONSTRAINT vehicles_area_check CHECK (area IS NULL OR char_length(area) BETWEEN 1 AND 80),
  CONSTRAINT vehicles_description_check CHECK (description IS NULL OR char_length(description) <= 3000),
  CONSTRAINT vehicles_phone_check CHECK (contact_phone IS NULL OR contact_phone ~ '^\+?[0-9]{7,15}$'),
  CONSTRAINT vehicles_whatsapp_check CHECK (whatsapp IS NULL OR whatsapp ~ '^\+?[0-9]{7,15}$'),
  -- A private seller must be reachable by the Ara or WhatsApp button.
  CONSTRAINT vehicles_private_contact_check CHECK (source <> 'private' OR contact_phone IS NOT NULL OR whatsapp IS NOT NULL),
  CONSTRAINT vehicles_source_url_check CHECK (source_url IS NULL OR source_url ~ '^https?://'),
  CONSTRAINT vehicles_rejection_reason_check CHECK (rejection_reason IS NULL OR char_length(rejection_reason) <= 500)
);

CREATE INDEX IF NOT EXISTS vehicles_browse_idx ON public.vehicles (status, intent, published_at DESC);
CREATE INDEX IF NOT EXISTS vehicles_owner_idx  ON public.vehicles (owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vehicles_dealer_idx ON public.vehicles (dealer_id) WHERE dealer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vehicles_expiry_idx ON public.vehicles (expires_at) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.vehicle_images (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  vehicle_id   uuid        NOT NULL,
  storage_path text        NOT NULL,
  source_url   text,
  sort_order   smallint    NOT NULL DEFAULT 0,
  is_primary   boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_images_pkey PRIMARY KEY (id),
  CONSTRAINT vehicle_images_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE,
  CONSTRAINT vehicle_images_path_key UNIQUE (vehicle_id, storage_path),
  CONSTRAINT vehicle_images_path_check CHECK (storage_path ~ '^[A-Za-z0-9][A-Za-z0-9/_.-]*$' AND char_length(storage_path) <= 300 AND position('..' IN storage_path) = 0),
  CONSTRAINT vehicle_images_sort_check CHECK (sort_order BETWEEN 0 AND 99)
);

CREATE INDEX IF NOT EXISTS vehicle_images_vehicle_idx ON public.vehicle_images (vehicle_id, sort_order);

COMMENT ON TABLE public.vehicle_sources IS
  'Araçlar import sites. service_role writes only. is_active needs terms_checked_at AND robots_checked_at (CHECK). Public reads active rows; ADA Preview also inactive ones. 20261165.';
COMMENT ON TABLE public.dealers IS
  'Araçlar dealers / rental companies, admin-seeded, is_active DEFAULT false. service_role writes only. Public reads active rows; ADA Preview also inactive ones. 20261165.';
COMMENT ON TABLE public.vehicles IS
  'Araçlar listings (sale/rent; private, dealer, import). Public sees active, unexpired, photographed, unhidden rows of active dealers/sources; owners their own; admins all. Private posting: 18+, not banned, max 3 pending+active, content filter, admin approval, 30-day expiry with renew_vehicle(). 20261165.';
COMMENT ON TABLE public.vehicle_images IS
  'Araçlar listing photos (bucket vehicle-images). Readable when the listing is. Owner writes while the listing is pending, path <uid>/<vehicle id>/, max 8. 20261165.';

-- ─── Private helpers (not exposed by PostgREST: only public is) ─────────────
CREATE OR REPLACE FUNCTION private.vehicle_has_photo(p uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.vehicle_images i WHERE i.vehicle_id = p)
$$;
ALTER FUNCTION private.vehicle_has_photo(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.vehicle_has_photo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.vehicle_has_photo(uuid) TO anon, authenticated;

-- NULL = the caller may post; otherwise the refusal code. Reads only the caller's own profile.
CREATE OR REPLACE FUNCTION private.vehicle_poster_refusal()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p.id IS NULL THEN 'NO_DOB'
    WHEN p.ugc_banned_until IS NOT NULL AND p.ugc_banned_until > now() THEN 'UGC_BANNED'
    WHEN p.date_of_birth IS NULL THEN 'NO_DOB'
    WHEN NOT private.is_adult_on(p.date_of_birth, (now() AT TIME ZONE 'Europe/Istanbul')::date) THEN 'UNDER_18'
  END
  FROM (SELECT auth.uid() AS uid) c
  LEFT JOIN public.profiles p ON p.id = c.uid
$$;
ALTER FUNCTION private.vehicle_poster_refusal() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.vehicle_poster_refusal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.vehicle_poster_refusal() TO authenticated;

-- The status of the caller's OWN listing, NULL for anyone else's (or a guest, or a non-uuid). The photo policies
-- (table rows and storage objects) use it, because clients cannot read vehicles.owner_id themselves.
CREATE OR REPLACE FUNCTION private.my_vehicle_status(p_vehicle text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT v.status FROM public.vehicles v
   WHERE v.id::text = p_vehicle AND v.owner_id = auth.uid() AND NOT public.is_anonymous_session()
$$;
ALTER FUNCTION private.my_vehicle_status(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.my_vehicle_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.my_vehicle_status(text) TO authenticated;

-- The caller's own listings that count toward the cap of 3.
CREATE OR REPLACE FUNCTION private.my_open_vehicle_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*)::int FROM public.vehicles
   WHERE owner_id = auth.uid() AND source = 'private' AND status IN ('pending', 'active')
$$;
ALTER FUNCTION private.my_open_vehicle_count() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.my_open_vehicle_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.my_open_vehicle_count() TO authenticated;

-- ─── The listing guard ──────────────────────────────────────────────────────
-- SECURITY INVOKER on purpose: current_user is then the statement's role, which is how the trigger tells
-- a direct client write ('anon'/'authenticated') from a trusted one (service_role imports, the cron and
-- renew_vehicle(), which run as postgres).
CREATE OR REPLACE FUNCTION public.vehicles_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_refusal text;
  v_edited  boolean;
  v_text    text;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
    RETURN NEW;
  END IF;

  IF v_uid IS NULL OR is_anonymous_session() THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.owner_id := v_uid;            NEW.source := 'private';       NEW.dealer_id := NULL;
    NEW.source_site := NULL;          NEW.source_url := NULL;        NEW.external_id := NULL;
    NEW.content_hash := NULL;         NEW.status := 'pending';       NEW.rejection_reason := NULL;
    NEW.published_at := NULL;         NEW.expires_at := NULL;
    NEW.hidden_at := NULL;            NEW.hidden_reason := NULL;
    NEW.created_at := now();          NEW.updated_at := now();
    v_edited := true;
  ELSIF is_admin() THEN
    -- Admins moderate: status and the rejection reason, nothing else (hidden_* is guard_moderation_columns').
    IF (NEW.intent, NEW.source, NEW.source_site, NEW.source_url, NEW.external_id, NEW.content_hash, NEW.dealer_id, NEW.owner_id,
        NEW.make, NEW.model, NEW.year, NEW.km, NEW.fuel, NEW.gearbox, NEW.body_type, NEW.colour, NEW.steering, NEW.price,
        NEW.currency, NEW.price_per_day, NEW.region, NEW.area, NEW.description, NEW.contact_phone, NEW.whatsapp,
        NEW.published_at, NEW.expires_at, NEW.created_at)
       IS DISTINCT FROM
       (OLD.intent, OLD.source, OLD.source_site, OLD.source_url, OLD.external_id, OLD.content_hash, OLD.dealer_id, OLD.owner_id,
        OLD.make, OLD.model, OLD.year, OLD.km, OLD.fuel, OLD.gearbox, OLD.body_type, OLD.colour, OLD.steering, OLD.price,
        OLD.currency, OLD.price_per_day, OLD.region, OLD.area, OLD.description, OLD.contact_phone, OLD.whatsapp,
        OLD.published_at, OLD.expires_at, OLD.created_at) THEN
      RAISE EXCEPTION 'VEHICLE_FIELD_LOCKED' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
      NEW.published_at := now();
      NEW.expires_at := CASE WHEN NEW.source = 'private' THEN now() + interval '30 days' END;
      NEW.rejection_reason := NULL;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  ELSE
    -- The owner (vehicles_update_own admits only their own private rows).
    IF OLD.status = 'removed' THEN RAISE EXCEPTION 'VEHICLE_REMOVED' USING ERRCODE = 'P0001'; END IF;
    IF (NEW.source, NEW.source_site, NEW.source_url, NEW.external_id, NEW.content_hash, NEW.dealer_id, NEW.owner_id,
        NEW.rejection_reason, NEW.published_at, NEW.expires_at, NEW.created_at, NEW.hidden_at, NEW.hidden_reason)
       IS DISTINCT FROM
       (OLD.source, OLD.source_site, OLD.source_url, OLD.external_id, OLD.content_hash, OLD.dealer_id, OLD.owner_id,
        OLD.rejection_reason, OLD.published_at, OLD.expires_at, OLD.created_at, OLD.hidden_at, OLD.hidden_reason) THEN
      RAISE EXCEPTION 'VEHICLE_FIELD_LOCKED' USING ERRCODE = 'P0001';
    END IF;
    v_edited := (NEW.intent, NEW.make, NEW.model, NEW.year, NEW.km, NEW.fuel, NEW.gearbox, NEW.body_type, NEW.colour,
                 NEW.steering, NEW.price, NEW.currency, NEW.price_per_day, NEW.region, NEW.area, NEW.description,
                 NEW.contact_phone, NEW.whatsapp)
                IS DISTINCT FROM
                (OLD.intent, OLD.make, OLD.model, OLD.year, OLD.km, OLD.fuel, OLD.gearbox, OLD.body_type, OLD.colour,
                 OLD.steering, OLD.price, OLD.currency, OLD.price_per_day, OLD.region, OLD.area, OLD.description,
                 OLD.contact_phone, OLD.whatsapp);
    NEW.updated_at := now();

    IF NEW.status = 'removed' THEN
      RETURN NEW;
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (NEW.status = 'pending' AND OLD.status IN ('active', 'expired', 'rejected')) THEN
      RAISE EXCEPTION 'VEHICLE_STATUS' USING ERRCODE = 'P0001';
    END IF;
    -- An edit to an approved / expired / rejected listing goes back to review.
    IF v_edited AND OLD.status IN ('active', 'expired', 'rejected') THEN
      NEW.status := 'pending';
    END IF;
    IF NEW.status = 'pending' AND OLD.status IS DISTINCT FROM 'pending' THEN
      NEW.expires_at := NULL;
    END IF;
    IF NOT v_edited AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;
  END IF;

  -- INSERT, or an owner edit / resubmission: the poster rules.
  v_refusal := private.vehicle_poster_refusal();
  IF v_refusal IS NOT NULL THEN RAISE EXCEPTION '%', v_refusal USING ERRCODE = 'P0001'; END IF;

  IF TG_OP = 'INSERT' OR OLD.status IN ('expired', 'rejected') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('vehicles:' || v_uid::text, 0));
    IF private.my_open_vehicle_count() >= 3 THEN
      RAISE EXCEPTION 'VEHICLE_LIMIT' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_edited THEN
    v_text := NEW.make || '  ' || NEW.model || '  ' || NEW.region || '  ' || coalesce(NEW.area, '') || '  ' || coalesce(NEW.description, '');
    IF contains_blocked_term(v_text) THEN RAISE EXCEPTION 'BLOCKED_TERM' USING ERRCODE = 'P0001'; END IF;
    IF contains_payment_solicitation(v_text) THEN RAISE EXCEPTION 'BLOCKED_PAYMENT' USING ERRCODE = 'P0001'; END IF;
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.vehicles_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.vehicles_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS vehicles_guard ON public.vehicles;
CREATE TRIGGER vehicles_guard BEFORE INSERT OR UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.vehicles_guard();

-- ─── Photo guard: max 8 per listing for client writes ───────────────────────
CREATE OR REPLACE FUNCTION public.vehicle_images_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN RETURN NEW; END IF;
  NEW.source_url := NULL;
  PERFORM pg_advisory_xact_lock(hashtextextended('vehicle_images:' || NEW.vehicle_id::text, 0));
  IF (SELECT count(*) FROM vehicle_images WHERE vehicle_id = NEW.vehicle_id) >= 8 THEN
    RAISE EXCEPTION 'VEHICLE_PHOTO_LIMIT' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.vehicle_images_guard() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.vehicle_images_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS vehicle_images_guard ON public.vehicle_images;
CREATE TRIGGER vehicle_images_guard BEFORE INSERT ON public.vehicle_images
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_images_guard();

-- ─── Renew ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.renew_vehicle(p_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_status  text;
  v_refusal text;
  v_until   timestamptz;
BEGIN
  IF v_uid IS NULL OR is_anonymous_session() THEN RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = 'P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('vehicles:' || v_uid::text, 0));
  SELECT status INTO v_status FROM vehicles WHERE id = p_id AND owner_id = v_uid AND source = 'private' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'VEHICLE_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;
  IF v_status NOT IN ('active', 'expired') THEN RAISE EXCEPTION 'VEHICLE_STATUS' USING ERRCODE = 'P0001'; END IF;
  v_refusal := private.vehicle_poster_refusal();
  IF v_refusal IS NOT NULL THEN RAISE EXCEPTION '%', v_refusal USING ERRCODE = 'P0001'; END IF;
  IF v_status = 'expired' AND private.my_open_vehicle_count() >= 3 THEN
    RAISE EXCEPTION 'VEHICLE_LIMIT' USING ERRCODE = 'P0001';
  END IF;
  UPDATE vehicles SET status = 'active', expires_at = now() + interval '30 days'
   WHERE id = p_id RETURNING expires_at INTO v_until;
  RETURN v_until;
END;
$function$;

ALTER FUNCTION public.renew_vehicle(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.renew_vehicle(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_vehicle(uuid) TO authenticated;
COMMENT ON FUNCTION public.renew_vehicle(uuid) IS
  'Owner puts their active or expired private listing back to active for 30 days from now. No guests; banned / under-18 / no-DOB refused; cap of 3 re-checked when it was expired. 20261165.';

-- ─── The owner's own listings ───────────────────────────────────────────────
-- owner_id is not readable by clients (column grant below), so "my listings" is this RPC, not a filter.
CREATE OR REPLACE FUNCTION public.my_vehicles()
RETURNS SETOF public.vehicles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT * FROM vehicles
   WHERE owner_id = auth.uid() AND auth.uid() IS NOT NULL AND NOT is_anonymous_session()
   ORDER BY created_at DESC
$function$;
ALTER FUNCTION public.my_vehicles() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.my_vehicles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_vehicles() TO authenticated;
COMMENT ON FUNCTION public.my_vehicles() IS
  'The caller''s own listings in every state (İlanlarım). Signed-in non-guests only; nobody else''s rows. 20261165.';

-- ─── Expiry ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expire_vehicles()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE n int;
BEGIN
  UPDATE vehicles SET status = 'expired' WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('expired', n);
END;
$function$;

ALTER FUNCTION public.expire_vehicles() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.expire_vehicles() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.expire_vehicles() IS
  'Nightly: active listings past expires_at become expired (visibility never waited for this: the read policy checks expires_at). Cron expire-vehicles 02:40 UTC. Not client-callable. 20261165.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-vehicles') THEN PERFORM cron.unschedule('expire-vehicles'); END IF;
END $$;
SELECT cron.schedule('expire-vehicles', '40 2 * * *', $$SELECT public.expire_vehicles()$$);

-- ─── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.vehicle_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_images  ENABLE ROW LEVEL SECURITY;

-- Supabase default privileges hand anon/authenticated ALL on a new public table; these REVOKEs are what make
-- the grants below mean anything.
REVOKE ALL ON TABLE public.vehicle_sources, public.dealers, public.vehicles, public.vehicle_images FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vehicle_sources, public.dealers, public.vehicle_images TO anon, authenticated;
-- Every column but owner_id: a seller's account id is not public (it resolves to a name elsewhere; 20261033).
-- Clients select named columns, never *; owners reach their own rows through my_vehicles().
GRANT SELECT (id, intent, source, source_site, source_url, external_id, content_hash, dealer_id, make, model, year, km, fuel,
              gearbox, body_type, colour, steering, price, currency, price_per_day, region, area, description, contact_phone,
              whatsapp, status, rejection_reason, published_at, expires_at, hidden_at, hidden_reason, created_at, updated_at)
  ON public.vehicles TO anon, authenticated;
GRANT INSERT (intent, make, model, year, km, fuel, gearbox, body_type, colour, steering, price, currency, price_per_day,
              region, area, description, contact_phone, whatsapp) ON public.vehicles TO authenticated;
GRANT UPDATE (intent, make, model, year, km, fuel, gearbox, body_type, colour, steering, price, currency, price_per_day,
              region, area, description, contact_phone, whatsapp, status, rejection_reason, hidden_at, hidden_reason) ON public.vehicles TO authenticated;
-- status / rejection_reason / hidden_* are in the grant for ADMINS (approve, reject, restore a hidden listing). Owners are
-- held off them by vehicles_guard (status moves, rejection_reason) and guard_moderation_columns (hidden_*, 20261166).
GRANT INSERT (vehicle_id, storage_path, sort_order, is_primary) ON public.vehicle_images TO authenticated;
GRANT UPDATE (sort_order, is_primary) ON public.vehicle_images TO authenticated;
GRANT DELETE ON public.vehicle_images TO authenticated;

-- vehicle_sources
DROP POLICY IF EXISTS vehicle_sources_select_public ON public.vehicle_sources;
CREATE POLICY vehicle_sources_select_public ON public.vehicle_sources
  FOR SELECT TO anon, authenticated USING (is_active);
DROP POLICY IF EXISTS vehicle_sources_select_preview ON public.vehicle_sources;
CREATE POLICY vehicle_sources_select_preview ON public.vehicle_sources
  FOR SELECT TO anon, authenticated USING (NOT is_active AND (SELECT public.is_previewer()));
DROP POLICY IF EXISTS vehicle_sources_select_admin ON public.vehicle_sources;
CREATE POLICY vehicle_sources_select_admin ON public.vehicle_sources
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

-- dealers
DROP POLICY IF EXISTS dealers_select_public ON public.dealers;
CREATE POLICY dealers_select_public ON public.dealers
  FOR SELECT TO anon, authenticated USING (is_active);
DROP POLICY IF EXISTS dealers_select_preview ON public.dealers;
CREATE POLICY dealers_select_preview ON public.dealers
  FOR SELECT TO anon, authenticated USING (NOT is_active AND (SELECT public.is_previewer()));
DROP POLICY IF EXISTS dealers_select_admin ON public.dealers;
CREATE POLICY dealers_select_admin ON public.dealers
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

-- vehicles: reads
DROP POLICY IF EXISTS vehicles_select_public ON public.vehicles;
CREATE POLICY vehicles_select_public ON public.vehicles
  FOR SELECT TO anon, authenticated
  USING (
    status = 'active'
    AND (expires_at IS NULL OR expires_at > now())
    AND (dealer_id IS NULL OR EXISTS (SELECT 1 FROM public.dealers d WHERE d.id = vehicles.dealer_id AND d.is_active))
    AND (source_site IS NULL OR EXISTS (SELECT 1 FROM public.vehicle_sources s WHERE s.site = vehicles.source_site AND s.is_active))
  );
DROP POLICY IF EXISTS vehicles_select_preview ON public.vehicles;
CREATE POLICY vehicles_select_preview ON public.vehicles
  FOR SELECT TO anon, authenticated
  USING (
    (SELECT public.is_previewer())
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now())
    AND (EXISTS (SELECT 1 FROM public.dealers d WHERE d.id = vehicles.dealer_id AND NOT d.is_active)
      OR EXISTS (SELECT 1 FROM public.vehicle_sources s WHERE s.site = vehicles.source_site AND NOT s.is_active))
  );
DROP POLICY IF EXISTS vehicles_select_own ON public.vehicles;
CREATE POLICY vehicles_select_own ON public.vehicles
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND NOT (SELECT public.is_anonymous_session()));
DROP POLICY IF EXISTS vehicles_select_admin ON public.vehicles;
CREATE POLICY vehicles_select_admin ON public.vehicles
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
DROP POLICY IF EXISTS vehicles_hide_photoless ON public.vehicles;
CREATE POLICY vehicles_hide_photoless ON public.vehicles
  AS RESTRICTIVE FOR SELECT TO public
  USING (owner_id = (SELECT auth.uid()) OR (SELECT public.is_admin()) OR private.vehicle_has_photo(id));

-- vehicles: writes
DROP POLICY IF EXISTS vehicles_insert_own ON public.vehicles;
CREATE POLICY vehicles_insert_own ON public.vehicles
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()) AND NOT (SELECT public.is_anonymous_session())
              AND source = 'private' AND status = 'pending' AND dealer_id IS NULL AND source_site IS NULL);
DROP POLICY IF EXISTS vehicles_update_own ON public.vehicles;
CREATE POLICY vehicles_update_own ON public.vehicles
  FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()) AND NOT (SELECT public.is_anonymous_session()) AND source = 'private')
  WITH CHECK (owner_id = (SELECT auth.uid()) AND NOT (SELECT public.is_anonymous_session()) AND source = 'private');
DROP POLICY IF EXISTS vehicles_update_admin ON public.vehicles;
CREATE POLICY vehicles_update_admin ON public.vehicles
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- vehicle_images
DROP POLICY IF EXISTS vehicle_images_select ON public.vehicle_images;
CREATE POLICY vehicle_images_select ON public.vehicle_images
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_images.vehicle_id));
DROP POLICY IF EXISTS vehicle_images_insert_own ON public.vehicle_images;
CREATE POLICY vehicle_images_insert_own ON public.vehicle_images
  FOR INSERT TO authenticated
  WITH CHECK (NOT (SELECT public.is_anonymous_session())
              AND storage_path ~ ('^' || vehicle_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$')
              AND private.my_vehicle_status(vehicle_id::text) = 'pending');
DROP POLICY IF EXISTS vehicle_images_update_own ON public.vehicle_images;
CREATE POLICY vehicle_images_update_own ON public.vehicle_images
  FOR UPDATE TO authenticated
  USING (NOT (SELECT public.is_anonymous_session()) AND private.my_vehicle_status(vehicle_id::text) = 'pending')
  WITH CHECK (NOT (SELECT public.is_anonymous_session()) AND private.my_vehicle_status(vehicle_id::text) = 'pending');
DROP POLICY IF EXISTS vehicle_images_delete_own ON public.vehicle_images;
CREATE POLICY vehicle_images_delete_own ON public.vehicle_images
  FOR DELETE TO authenticated
  USING (NOT (SELECT public.is_anonymous_session()) AND private.my_vehicle_status(vehicle_id::text) = 'pending');
DROP POLICY IF EXISTS vehicle_images_delete_admin ON public.vehicle_images;
CREATE POLICY vehicle_images_delete_admin ON public.vehicle_images
  FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- ─── Storage ────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('vehicle-images', 'vehicle-images', true, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true, file_size_limit = 5242880, allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

-- Path: <vehicle id>/<random uuid>.<ext>. A file can only be ADDED to, or DELETED from, a listing the caller owns
-- while it is PENDING (under review), so an approved listing's photos can never be swapped, and the bucket is no
-- general image host. No UPDATE policy at all: no overwrite (upload with upsert: false). The owner can SELECT
-- (Storage's remove() reads before it deletes) their own listings' files; admins can SELECT + DELETE any.
-- No uploader id in any public URL. partner/… (mirrored imports) never matches a listing id: service_role only.
DROP POLICY IF EXISTS "vehicle_images_upload" ON storage.objects;
CREATE POLICY "vehicle_images_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'vehicle-images'
    AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
    AND private.my_vehicle_status((storage.foldername(name))[1]) = 'pending'
    AND NOT (select public.is_anonymous_session())
  );
DROP POLICY IF EXISTS "vehicle_images_select" ON storage.objects;
CREATE POLICY "vehicle_images_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'vehicle-images'
    AND NOT (select public.is_anonymous_session())
    AND (private.my_vehicle_status((storage.foldername(name))[1]) IS NOT NULL OR (select public.is_admin()))
  );
DROP POLICY IF EXISTS "vehicle_images_delete" ON storage.objects;
CREATE POLICY "vehicle_images_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'vehicle-images'
    AND NOT (select public.is_anonymous_session())
    AND (private.my_vehicle_status((storage.foldername(name))[1]) = 'pending' OR (select public.is_admin()))
  );

-- ─── contact_events: module 'cars' ──────────────────────────────────────────
-- Static on purpose: scripts/audit-schema-drift.mjs reads CHECK literals from this file.
ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_module_check;
ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_module_check
  CHECK (module IN ('accommodation','events','explore','garages','grooming','homeServices','hotels',
                    'insurance','jobs','pets','studentHub','towing','transport','ehliyet','connectivity','eatery','cars'));

-- ─── Assertions (inside the transaction; a failure rolls the file back) ─────
-- Catalog reads only; the tables are new, so nothing printed is user data.
DO $$
DECLARE
  v_t      text;
  v_n      int;
  v_names  text;
  v_want   int;
  v_expr   text;
  v_fn     text;
  v_def    text;
BEGIN
  -- RLS on, owned by postgres.
  FOREACH v_t IN ARRAY ARRAY['vehicle_sources', 'dealers', 'vehicles', 'vehicle_images'] LOOP
    IF (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || v_t)) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'RLS is not enabled on %', v_t;
    END IF;
    IF (SELECT relowner::regrole::text FROM pg_class WHERE oid = to_regclass('public.' || v_t)) IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION '% is not owned by postgres', v_t;
    END IF;
  END LOOP;

  -- FULL policy set per table, printed.
  FOR v_t, v_want IN SELECT * FROM (VALUES ('vehicle_sources', 3), ('dealers', 3), ('vehicles', 8), ('vehicle_images', 5)) x(t, n) LOOP
    SELECT count(*), string_agg(policyname || ':' || cmd || ':' || permissive, ', ' ORDER BY policyname) INTO v_n, v_names
      FROM pg_policies WHERE schemaname = 'public' AND tablename = v_t;
    IF v_n IS DISTINCT FROM v_want THEN RAISE EXCEPTION '% has % policies (want %): %', v_t, v_n, v_want, v_names; END IF;
    RAISE NOTICE '% policies (%): %', v_t, v_n, v_names;
  END LOOP;
  -- Only SELECT policies on the two directory tables: no client write path at all.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('vehicle_sources', 'dealers') AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'a non-SELECT policy exists on vehicle_sources or dealers';
  END IF;
  -- The preview contract: every is_previewer() policy is a SELECT and is paired with NOT is_active.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('vehicle_sources', 'dealers', 'vehicles', 'vehicle_images')
              AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%is_previewer%'
              AND (cmd <> 'SELECT' OR coalesce(qual, '') NOT LIKE '%NOT %is_active%')) THEN
    RAISE EXCEPTION 'an is_previewer() policy breaks the 20261120 contract (SELECT only, paired with NOT is_active)';
  END IF;
  -- The public read must carry every condition; the photoless one must be RESTRICTIVE.
  SELECT qual INTO v_expr FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicles' AND policyname = 'vehicles_select_public';
  IF v_expr NOT LIKE '%''active''%' OR v_expr NOT LIKE '%expires_at > now()%' OR v_expr NOT LIKE '%d.is_active%' OR v_expr NOT LIKE '%s.is_active%' THEN
    RAISE EXCEPTION 'vehicles_select_public lost a condition: %', v_expr;
  END IF;
  IF (SELECT permissive FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicles' AND policyname = 'vehicles_hide_photoless') IS DISTINCT FROM 'RESTRICTIVE' THEN
    RAISE EXCEPTION 'vehicles_hide_photoless is not RESTRICTIVE';
  END IF;
  -- Every permissive client write policy excludes guests.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('vehicles', 'vehicle_images')
              AND cmd IN ('INSERT', 'UPDATE', 'DELETE') AND permissive = 'PERMISSIVE'
              AND coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%is_anonymous_session()%'
              AND coalesce(qual, '') || coalesce(with_check, '') NOT LIKE '%is_admin()%') THEN
    RAISE EXCEPTION 'a vehicles / vehicle_images write policy neither excludes guests nor requires an admin';
  END IF;

  -- Privileges: anon reads only; authenticated: no DELETE / TRUNCATE on listings, column grants only.
  FOREACH v_t IN ARRAY ARRAY['vehicle_sources', 'dealers', 'vehicles', 'vehicle_images'] LOOP
    IF has_table_privilege('anon', 'public.' || v_t, 'INSERT') OR has_table_privilege('anon', 'public.' || v_t, 'UPDATE')
       OR has_table_privilege('anon', 'public.' || v_t, 'DELETE') OR has_table_privilege('anon', 'public.' || v_t, 'TRUNCATE') THEN
      RAISE EXCEPTION 'anon can write %', v_t;
    END IF;
    IF NOT has_any_column_privilege('anon', ('public.' || v_t)::regclass, 'SELECT') THEN RAISE EXCEPTION 'positive control: anon cannot read %', v_t; END IF;
    IF has_table_privilege('authenticated', 'public.' || v_t, 'TRUNCATE') THEN RAISE EXCEPTION 'authenticated can TRUNCATE %', v_t; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attnum > 0 AND NOT a.attisdropped
              AND a.attrelid IN (to_regclass('public.vehicle_sources'), to_regclass('public.dealers'))
              AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT,UPDATE')) THEN
    RAISE EXCEPTION 'authenticated can write a column of vehicle_sources or dealers';
  END IF;
  IF has_table_privilege('authenticated', 'public.vehicles', 'DELETE') THEN RAISE EXCEPTION 'authenticated can DELETE vehicles'; END IF;
  -- The seller's account id is not readable by any client; the listing id is (positive control).
  IF has_column_privilege('anon', 'public.vehicles', 'owner_id', 'SELECT') OR has_column_privilege('authenticated', 'public.vehicles', 'owner_id', 'SELECT')
     OR has_table_privilege('anon', 'public.vehicles', 'SELECT') OR has_table_privilege('authenticated', 'public.vehicles', 'SELECT') THEN
    RAISE EXCEPTION 'a client can read vehicles.owner_id';
  END IF;
  IF NOT has_column_privilege('anon', 'public.vehicles', 'id', 'SELECT') OR NOT has_column_privilege('anon', 'public.vehicles', 'contact_phone', 'SELECT') THEN
    RAISE EXCEPTION 'positive control: anon cannot read the listing columns';
  END IF;
  IF has_function_privilege('anon', 'public.my_vehicles()', 'EXECUTE') OR NOT has_function_privilege('authenticated', 'public.my_vehicles()', 'EXECUTE') THEN
    RAISE EXCEPTION 'my_vehicles(): anon may call it, or authenticated may not';
  END IF;
  SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO v_names FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.vehicles') AND a.attnum > 0 AND NOT a.attisdropped
     AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT');
  IF v_names IS DISTINCT FROM 'area,body_type,colour,contact_phone,currency,description,fuel,gearbox,intent,km,make,model,price,price_per_day,region,steering,whatsapp,year' THEN
    RAISE EXCEPTION 'vehicles INSERT columns for authenticated: %', v_names;
  END IF;
  SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO v_names FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.vehicles') AND a.attnum > 0 AND NOT a.attisdropped
     AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE');
  IF v_names IS DISTINCT FROM 'area,body_type,colour,contact_phone,currency,description,fuel,gearbox,hidden_at,hidden_reason,intent,km,make,model,price,price_per_day,region,rejection_reason,status,steering,whatsapp,year' THEN
    RAISE EXCEPTION 'vehicles UPDATE columns for authenticated: %', v_names;
  END IF;

  -- Functions: client-callable exactly where intended.
  FOREACH v_fn IN ARRAY ARRAY['public.vehicles_guard()', 'public.vehicle_images_guard()', 'public.expire_vehicles()'] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'a client role can EXECUTE %', v_fn;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.renew_vehicle(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'anon can EXECUTE renew_vehicle'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.renew_vehicle(uuid)', 'EXECUTE') THEN RAISE EXCEPTION 'positive control: authenticated cannot renew'; END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.vehicles_guard()')) THEN
    RAISE EXCEPTION 'vehicles_guard must be SECURITY INVOKER (it branches on current_user)';
  END IF;
  IF has_function_privilege('anon', 'private.vehicle_poster_refusal()', 'EXECUTE') OR has_function_privilege('anon', 'private.my_open_vehicle_count()', 'EXECUTE')
     OR has_function_privilege('anon', 'private.my_vehicle_status(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can EXECUTE a private vehicles helper';
  END IF;

  -- Triggers: exactly one user trigger on each written table.
  SELECT string_agg(pg_get_triggerdef(oid), ' | ') INTO v_def FROM pg_trigger WHERE tgrelid = to_regclass('public.vehicles') AND NOT tgisinternal;
  IF v_def NOT LIKE 'CREATE TRIGGER vehicles_guard BEFORE INSERT OR UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION %vehicles_guard()' THEN
    RAISE EXCEPTION 'vehicles triggers: %', v_def;
  END IF;
  SELECT string_agg(pg_get_triggerdef(oid), ' | ') INTO v_def FROM pg_trigger WHERE tgrelid = to_regclass('public.vehicle_images') AND NOT tgisinternal;
  IF v_def NOT LIKE 'CREATE TRIGGER vehicle_images_guard BEFORE INSERT ON public.vehicle_images FOR EACH ROW EXECUTE FUNCTION %vehicle_images_guard()' THEN
    RAISE EXCEPTION 'vehicle_images triggers: %', v_def;
  END IF;

  -- Defaults that keep pre-launch rows unpublished.
  IF (SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dealers' AND column_name = 'is_active') IS DISTINCT FROM 'false'
     OR (SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vehicle_sources' AND column_name = 'is_active') IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'dealers / vehicle_sources is_active must DEFAULT false';
  END IF;

  -- Storage: exactly three new policies, all scoped to the bucket, guest-guarded and tied to a listing; the bucket itself.
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';
  IF v_n IS DISTINCT FROM current_setting('mig1165.storage_policies')::int + 3 THEN
    RAISE EXCEPTION 'storage.objects policies: % before, % after (want +3)', current_setting('mig1165.storage_policies'), v_n;
  END IF;
  SELECT count(*), string_agg(policyname, ', ' ORDER BY policyname) INTO v_n, v_names FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects' AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%vehicle-images%';
  IF v_n IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'vehicle-images storage policies: % (want 3): %', v_n, v_names; END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'vehicle_images_%' AND cmd = 'UPDATE') THEN
    RAISE EXCEPTION 'a vehicle-images UPDATE policy exists: photos must not be overwritable';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'vehicle_images_%'
              AND ((coalesce(qual, '') || coalesce(with_check, '')) NOT LIKE '%is_anonymous_session()%'
                OR (coalesce(qual, '') || coalesce(with_check, '')) NOT LIKE '%my_vehicle_status(%')) THEN
    RAISE EXCEPTION 'a vehicle-images storage policy lacks the guest guard or the listing tie';
  END IF;
  IF (SELECT with_check FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'vehicle_images_upload') NOT LIKE '%''pending''%' THEN
    RAISE EXCEPTION 'vehicle_images_upload no longer requires a pending listing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'vehicle-images' AND public AND file_size_limit = 5242880) THEN
    RAISE EXCEPTION 'bucket vehicle-images is missing or not public / 5 MB';
  END IF;

  -- contact_events admits cars and lost nothing.
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = to_regclass('public.contact_events') AND conname = 'contact_events_module_check';
  IF (SELECT count(*) FROM regexp_matches(v_def, '''([A-Za-z]+)''', 'g')) IS DISTINCT FROM 17 OR v_def NOT LIKE '%''cars''%' THEN
    RAISE EXCEPTION 'contact_events_module_check: %', v_def;
  END IF;

  -- The cron row.
  SELECT count(*), max(schedule) INTO v_n, v_names FROM cron.job WHERE jobname = 'expire-vehicles' AND active;
  IF v_n IS DISTINCT FROM 1 OR v_names IS DISTINCT FROM '40 2 * * *' THEN RAISE EXCEPTION 'cron expire-vehicles: % row(s), schedule %', v_n, v_names; END IF;
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
VALUES ('20261165_vehicles.sql', '506b0ba0508ed32f2232a1db064dad8457126a4b98b84cf8265e57c1b3894178')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   verify_schema QUERY 1: the 20261165_vehicles rows must read OK; QUERY 2: expire-vehicles;
--   QUERY 3: vehicle_sources 3, dealers 3, vehicles 8 (+1 from 20261166), vehicle_images 5; QUERY 4: +3 storage policies.
--
-- ─── Rollback ───────────────────────────────────────────────────────────────
--   SELECT cron.unschedule('expire-vehicles');
--   DROP POLICY "vehicle_images_upload" ON storage.objects; DROP POLICY "vehicle_images_select" ON storage.objects;
--   DROP POLICY "vehicle_images_delete" ON storage.objects; DELETE FROM storage.buckets WHERE id = 'vehicle-images';
--   DROP TABLE public.vehicle_images, public.vehicles, public.dealers, public.vehicle_sources;
--   DROP FUNCTION public.vehicles_guard(), public.vehicle_images_guard(), public.renew_vehicle(uuid), public.expire_vehicles(),
--     private.vehicle_has_photo(uuid), private.vehicle_poster_refusal(), private.my_open_vehicle_count(),
--     private.my_vehicle_status(text), public.my_vehicles();
--   Restore contact_events_module_check without 'cars' (the 20261115 list); delete the schema_migrations_applied row.

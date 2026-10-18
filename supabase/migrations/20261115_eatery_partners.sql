-- ═══════════════════════════════════════════════════════════════════════════
-- 20261115 — Yeme-İçme (eatery partners), DARK: three tables, a public image bucket, contact_events vocabulary
-- ═══════════════════════════════════════════════════════════════════════════
--
-- An admin-seeded partner directory on the driving_schools precedent (20261108): ships INACTIVE,
-- activated by one UPDATE in the go-live SOP. Seed = Crunchy Express ONLY, with nothing but its id,
-- slug, name, category and is_active = false. No phone, no address, no region (we do not know
-- Crunchy Express's region and never invent one), no menu, no photo.
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   • eatery_partners, READ: anyone using the app (anon, signed-in, guest) sees a partner only while
--     it is active (is_active). An inactive partner is invisible to every client role. Public
--     business-directory data (name, category, phone, WhatsApp, website, menu link, maps link, town,
--     street address, opening hours, a logo path); a business's own published details, no personal data.
--   • eatery_menu_items and eatery_photos, READ: anyone sees a row only while its partner is active
--     (the policies ask eatery_partners, so a child can never outlive its parent's visibility).
--   • WRITE, all three tables: service_role only (migrations / the admin's SQL / the Edge Functions).
--     No client write policy and no client write privilege: a customer, a provider and a guest cannot
--     insert, edit or delete a partner, a menu item or a photo.
--   • Nothing in these tables concerns the person reading it.
--   • Storage bucket eatery-images is PUBLIC (reads need no policy) and carries ZERO storage.objects
--     policies. service_role bypasses RLS, so it uploads without one; a SELECT policy on a public
--     bucket would grant nothing Storage does not already serve, and would only enable listing
--     (precedent: 20261063 hotel-images, 20261071 team-logos). Clients cannot write to it at all.
--
-- ─── LAUNCH COMPLETENESS ────────────────────────────────────────────────────
-- eatery_partners_launch_complete_check: NOT is_active OR (lat, logo_path and menu_verified_on are all
-- set). That is the part a CHECK can hold. CHILD completeness (at least one menu item, or a menu_url)
-- cannot be a CHECK (it spans tables); the future activation migration asserts it.
--
-- ─── ACTIVATION (separate from the module flag) ─────────────────────────────
--   UPDATE public.eatery_partners SET is_active = true WHERE id = '<id>';
--
-- ─── contact_events ─────────────────────────────────────────────────────────
-- module gains 'eatery'; action gains 'menu' (the "open the menu" tap). Both CHECKs are re-added as
-- static literals (scripts/audit-schema-drift.mjs reads them). Pre-state asserts the exact sets
-- 20261112 (15 modules) and 20261109 (10 actions) left; post-state is those + the new value.
--
-- Apply: gh workflow run supabase-migrate -f file=20261115_eatery_partners.sql (dry), then
-- -f apply=true. New tables ⇒ ends with NOTIFY pgrst (after COMMIT).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── Pre-state ──────────────────────────────────────────────────────────────
-- (1) towing_hours_valid exists and is IMMUTABLE (a CHECK may only call an immutable function).
-- (2) contact_events module CHECK is exactly the 15 modules 20261112 left; action CHECK exactly the
--     10 actions 20261109 left.
-- (3) The storage.objects policy count is captured in a transaction-local setting, so the closing
--     block can prove this file changed none.
DO $$
DECLARE
  v_vol  "char";
  v_def  text;
  v_set  text[];
  v_want_mod constant text[] := ARRAY['accommodation','connectivity','ehliyet','events','explore','garages','grooming',
                                      'homeServices','hotels','insurance','jobs','pets','studentHub','towing','transport'];
  v_want_act constant text[] := ARRAY['book','call','call_secondary','email','facebook','instagram','maps',
                                      'route_complete','website','whatsapp'];
  v_new_mod  constant text[] := v_want_mod || ARRAY['eatery'];
  v_new_act  constant text[] := v_want_act || ARRAY['menu'];
BEGIN
  SELECT provolatile INTO v_vol FROM pg_proc
   WHERE oid = to_regprocedure('public.towing_hours_valid(jsonb)');
  IF v_vol IS DISTINCT FROM 'i' THEN
    RAISE EXCEPTION 'public.towing_hours_valid(jsonb) is missing or not IMMUTABLE (provolatile=%)', coalesce(v_vol::text, '<missing>');
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_module_check';
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_set
    FROM regexp_matches(coalesce(v_def, ''), '''([a-zA-Z]+)''::text', 'g') AS m;
  IF v_set IS NULL OR NOT ((v_set @> v_want_mod AND v_set <@ v_want_mod) OR (v_set @> v_new_mod AND v_set <@ v_new_mod)) THEN
    RAISE EXCEPTION 'contact_events_module_check is neither the 15-module set (20261112) nor that + eatery (this file, re-applied). live set=% def=%', v_set, coalesce(v_def, '<missing>');
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_action_check';
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_set
    FROM regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''::text', 'g') AS m;
  IF v_set IS NULL OR NOT ((v_set @> v_want_act AND v_set <@ v_want_act) OR (v_set @> v_new_act AND v_set <@ v_new_act)) THEN
    RAISE EXCEPTION 'contact_events_action_check is neither the 10-action set (20261109) nor that + menu (this file, re-applied). live set=% def=%', v_set, coalesce(v_def, '<missing>');
  END IF;

  PERFORM set_config('ada.storage_pol_before',
                     (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects')::text, true);
  PERFORM set_config('ada.storage_pol_names_before',
                     coalesce((SELECT string_agg(policyname, ',' ORDER BY policyname) FROM pg_policies
                                WHERE schemaname = 'storage' AND tablename = 'objects'), ''), true);
  PERFORM set_config('ada.storage_unscoped_before',
                     coalesce((SELECT string_agg(policyname, ',' ORDER BY policyname) FROM pg_policies
                                WHERE schemaname = 'storage' AND tablename = 'objects' AND permissive = 'PERMISSIVE'
                                  AND COALESCE(qual, '') || COALESCE(with_check, '') NOT LIKE '%bucket_id%'), ''), true);
END $$;

-- ─── eatery_partners ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eatery_partners (
  id               uuid             NOT NULL DEFAULT gen_random_uuid(),
  slug             text             NOT NULL,
  name             text             NOT NULL,
  category         text             NOT NULL,
  phone            text,
  whatsapp         text,
  website_url      text,
  menu_url         text,
  maps_url         text,
  region           text,
  address          text,
  lat              double precision,
  lng              double precision,
  geocode_source   text,
  opening_hours    jsonb,
  logo_path        text,
  menu_verified_on date,
  sort_order       int              NOT NULL DEFAULT 0,
  is_active        boolean          NOT NULL DEFAULT false,
  created_at       timestamptz      NOT NULL DEFAULT now(),
  updated_at       timestamptz      NOT NULL DEFAULT now(),
  CONSTRAINT eatery_partners_pkey PRIMARY KEY (id)
);
ALTER TABLE public.eatery_partners DROP CONSTRAINT IF EXISTS eatery_partners_slug_key;
ALTER TABLE public.eatery_partners ADD  CONSTRAINT eatery_partners_slug_key UNIQUE (slug);
ALTER TABLE public.eatery_partners DROP CONSTRAINT IF EXISTS eatery_partners_slug_check;
ALTER TABLE public.eatery_partners ADD  CONSTRAINT eatery_partners_slug_check
  CHECK (slug ~ '^[a-z0-9-]+$');
ALTER TABLE public.eatery_partners DROP CONSTRAINT IF EXISTS eatery_partners_name_check;
ALTER TABLE public.eatery_partners ADD  CONSTRAINT eatery_partners_name_check
  CHECK (length(btrim(name)) BETWEEN 2 AND 120);
ALTER TABLE public.eatery_partners DROP CONSTRAINT IF EXISTS eatery_partners_category_check;
ALTER TABLE public.eatery_partners ADD  CONSTRAINT eatery_partners_category_check
  CHECK (category IN ('fast_food','restaurant','cafe','bakery','dessert'));
ALTER TABLE public.eatery_partners DROP CONSTRAINT IF EXISTS eatery_partners_phone_check;
ALTER TABLE public.eatery_partners ADD  CONSTRAINT eatery_partners_phone_check
  CHECK (phone IS NULL OR phone ~ '^\+[0-9][0-9 ]{7,19}$');
ALTER TABLE public.eatery_partners DROP CONSTRAINT IF EXISTS eatery_partners_whatsapp_check;
ALTER TABLE public.eatery_partners ADD  CONSTRAINT eatery_partners_whatsapp_check
  CHECK (whatsapp IS NULL OR whatsapp ~ '^\+[0-9][0-9 ]{7,19}$');
ALTER TABLE public.eatery_partners DROP CONSTRAINT IF EXISTS eatery_partners_website_url_check;
ALTER TABLE public.eatery_partners ADD  CONSTRAINT eatery_partners_website_url_check
  CHECK (website_url IS NULL OR (website_url ~ '^https://[^[:space:]]+$' AND length(website_url) <= 2048));
ALTER TABLE public.eatery_partners DROP CONSTRAINT IF EXISTS eatery_partners_menu_url_check;
ALTER TABLE public.eatery_partners ADD  CONSTRAINT eatery_partners_menu_url_check
  CHECK (menu_url IS NULL OR (menu_url ~ '^https://[^[:space:]]+$' AND length(menu_url) <= 2048));
ALTER TABLE public.eatery_partners DROP CONSTRAINT IF EXISTS eatery_partners_maps_url_check;
ALTER TABLE public.eatery_partners ADD  CONSTRAINT eatery_partners_maps_url_check
  CHECK (maps_url IS NULL OR (maps_url ~ '^https://[^[:space:]]+$' AND length(maps_url) <= 2048));
-- region is NULLABLE on purpose: NULL = unknown, never a guess.
ALTER TABLE public.eatery_partners DROP CONSTRAINT IF EXISTS eatery_partners_region_check;
ALTER TABLE public.eatery_partners ADD  CONSTRAINT eatery_partners_region_check
  CHECK (region IS NULL OR region IN ('nicosia','kyrenia','famagusta','morphou','iskele','lefke','karpaz'));
ALTER TABLE public.eatery_partners DROP CONSTRAINT IF EXISTS eatery_partners_address_check;
ALTER TABLE public.eatery_partners ADD  CONSTRAINT eatery_partners_address_check
  CHECK (address IS NULL OR length(btrim(address)) BETWEEN 5 AND 200);
ALTER TABLE public.eatery_partners DROP CONSTRAINT IF EXISTS eatery_partners_coords_check;
ALTER TABLE public.eatery_partners ADD  CONSTRAINT eatery_partners_coords_check
  CHECK (((lat IS NULL) = (lng IS NULL))
         AND (lat IS NULL OR (lat BETWEEN 34.5 AND 35.8 AND lng BETWEEN 32.2 AND 34.8)));
-- osm or partner only: Google Places pins are an accepted risk for pharmacies and hotels, not here.
ALTER TABLE public.eatery_partners DROP CONSTRAINT IF EXISTS eatery_partners_geocode_source_check;
ALTER TABLE public.eatery_partners ADD  CONSTRAINT eatery_partners_geocode_source_check
  CHECK (geocode_source IS NULL OR geocode_source IN ('partner','osm'));
-- Two-way: a pin has a provenance and a provenance has a pin.
ALTER TABLE public.eatery_partners DROP CONSTRAINT IF EXISTS eatery_partners_provenance_check;
ALTER TABLE public.eatery_partners ADD  CONSTRAINT eatery_partners_provenance_check
  CHECK ((lat IS NULL) = (geocode_source IS NULL));
ALTER TABLE public.eatery_partners DROP CONSTRAINT IF EXISTS eatery_partners_opening_hours_check;
ALTER TABLE public.eatery_partners ADD  CONSTRAINT eatery_partners_opening_hours_check
  CHECK (public.towing_hours_valid(opening_hours));
-- Storage path inside eatery-images: folder segments of [a-z0-9_-], an image extension, no dots
-- elsewhere (so no '..'), no leading slash, no scheme.
ALTER TABLE public.eatery_partners DROP CONSTRAINT IF EXISTS eatery_partners_logo_path_check;
ALTER TABLE public.eatery_partners ADD  CONSTRAINT eatery_partners_logo_path_check
  CHECK (logo_path IS NULL OR logo_path ~ '^[a-z0-9-]+(/[a-z0-9][a-z0-9_-]*)+\.(jpg|jpeg|png|webp)$');
ALTER TABLE public.eatery_partners DROP CONSTRAINT IF EXISTS eatery_partners_launch_complete_check;
ALTER TABLE public.eatery_partners ADD  CONSTRAINT eatery_partners_launch_complete_check
  CHECK (NOT is_active OR (lat IS NOT NULL AND logo_path IS NOT NULL AND menu_verified_on IS NOT NULL));

COMMENT ON CONSTRAINT eatery_partners_launch_complete_check ON public.eatery_partners IS
  'Active needs a pin, a logo and a menu verification date. Child completeness (at least one eatery_menu_items row or a menu_url) cannot be a CHECK; the activation migration asserts it. 20261115.';

-- ─── eatery_menu_items ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eatery_menu_items (
  id            bigint        GENERATED ALWAYS AS IDENTITY,
  partner_id    uuid          NOT NULL,
  section       text          NOT NULL,
  section_order int           NOT NULL DEFAULT 0,
  name          text          NOT NULL,
  description   text,
  price         numeric(8,2),
  currency      text          NOT NULL DEFAULT 'TRY',
  sort_order    int           NOT NULL DEFAULT 0,
  is_available  boolean       NOT NULL DEFAULT true,
  CONSTRAINT eatery_menu_items_pkey PRIMARY KEY (id)
);
ALTER TABLE public.eatery_menu_items DROP CONSTRAINT IF EXISTS eatery_menu_items_partner_id_fkey;
ALTER TABLE public.eatery_menu_items ADD  CONSTRAINT eatery_menu_items_partner_id_fkey
  FOREIGN KEY (partner_id) REFERENCES public.eatery_partners (id) ON DELETE CASCADE;
ALTER TABLE public.eatery_menu_items DROP CONSTRAINT IF EXISTS eatery_menu_items_section_check;
ALTER TABLE public.eatery_menu_items ADD  CONSTRAINT eatery_menu_items_section_check
  CHECK (length(btrim(section)) BETWEEN 1 AND 80);
ALTER TABLE public.eatery_menu_items DROP CONSTRAINT IF EXISTS eatery_menu_items_name_check;
ALTER TABLE public.eatery_menu_items ADD  CONSTRAINT eatery_menu_items_name_check
  CHECK (length(btrim(name)) BETWEEN 1 AND 120);
ALTER TABLE public.eatery_menu_items DROP CONSTRAINT IF EXISTS eatery_menu_items_description_check;
ALTER TABLE public.eatery_menu_items ADD  CONSTRAINT eatery_menu_items_description_check
  CHECK (description IS NULL OR length(description) <= 300);
ALTER TABLE public.eatery_menu_items DROP CONSTRAINT IF EXISTS eatery_menu_items_price_check;
ALTER TABLE public.eatery_menu_items ADD  CONSTRAINT eatery_menu_items_price_check
  CHECK (price IS NULL OR price >= 0);
ALTER TABLE public.eatery_menu_items DROP CONSTRAINT IF EXISTS eatery_menu_items_currency_check;
ALTER TABLE public.eatery_menu_items ADD  CONSTRAINT eatery_menu_items_currency_check
  CHECK (currency IN ('TRY','EUR','GBP'));
CREATE INDEX IF NOT EXISTS eatery_menu_items_partner_idx ON public.eatery_menu_items (partner_id);

-- ─── eatery_photos ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.eatery_photos (
  id           bigint   GENERATED ALWAYS AS IDENTITY,
  partner_id   uuid     NOT NULL,
  kind         text     NOT NULL,
  storage_path text     NOT NULL,
  width        int,
  height       int,
  sort_order   int      NOT NULL DEFAULT 0,
  CONSTRAINT eatery_photos_pkey PRIMARY KEY (id)
);
ALTER TABLE public.eatery_photos DROP CONSTRAINT IF EXISTS eatery_photos_partner_id_fkey;
ALTER TABLE public.eatery_photos ADD  CONSTRAINT eatery_photos_partner_id_fkey
  FOREIGN KEY (partner_id) REFERENCES public.eatery_partners (id) ON DELETE CASCADE;
ALTER TABLE public.eatery_photos DROP CONSTRAINT IF EXISTS eatery_photos_kind_check;
ALTER TABLE public.eatery_photos ADD  CONSTRAINT eatery_photos_kind_check
  CHECK (kind IN ('gallery','menu'));
ALTER TABLE public.eatery_photos DROP CONSTRAINT IF EXISTS eatery_photos_storage_path_check;
ALTER TABLE public.eatery_photos ADD  CONSTRAINT eatery_photos_storage_path_check
  CHECK (storage_path ~ '^[a-z0-9-]+(/[a-z0-9][a-z0-9_-]*)+\.(jpg|jpeg|png|webp)$');
ALTER TABLE public.eatery_photos DROP CONSTRAINT IF EXISTS eatery_photos_size_check;
ALTER TABLE public.eatery_photos ADD  CONSTRAINT eatery_photos_size_check
  CHECK (((width IS NULL) = (height IS NULL)) AND (width IS NULL OR (width > 0 AND height > 0)));
CREATE INDEX IF NOT EXISTS eatery_photos_partner_idx ON public.eatery_photos (partner_id);

-- ─── RLS and grants ─────────────────────────────────────────────────────────
ALTER TABLE public.eatery_partners    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eatery_menu_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eatery_photos      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.eatery_partners, public.eatery_menu_items, public.eatery_photos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.eatery_partners, public.eatery_menu_items, public.eatery_photos TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.eatery_partners, public.eatery_menu_items, public.eatery_photos TO service_role;

DROP POLICY IF EXISTS eatery_partners_select_active ON public.eatery_partners;
CREATE POLICY eatery_partners_select_active ON public.eatery_partners
  FOR SELECT TO anon, authenticated
  USING (is_active);

DROP POLICY IF EXISTS eatery_menu_items_select_active ON public.eatery_menu_items;
CREATE POLICY eatery_menu_items_select_active ON public.eatery_menu_items
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.eatery_partners p WHERE p.id = eatery_menu_items.partner_id AND p.is_active));

DROP POLICY IF EXISTS eatery_photos_select_active ON public.eatery_photos;
CREATE POLICY eatery_photos_select_active ON public.eatery_photos
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.eatery_partners p WHERE p.id = eatery_photos.partner_id AND p.is_active));

-- ─── Storage bucket: PUBLIC, no storage.objects policy ──────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('eatery-images', 'eatery-images', true, 2097152, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true, file_size_limit = 2097152, allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp'];

-- ─── Seed: Crunchy Express, INACTIVE, and nothing else ──────────────────────
INSERT INTO public.eatery_partners (id, slug, name, category, is_active)
VALUES ('bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434', 'crunchy-express', 'Crunchy Express', 'fast_food', false)
ON CONFLICT (id) DO NOTHING;

-- ─── contact_events: module 'eatery', action 'menu' ─────────────────────────
-- Static on purpose: scripts/audit-schema-drift.mjs reads CHECK literals from this file.
ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_module_check;
ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_module_check
  CHECK (module IN ('accommodation','events','explore','garages','grooming','homeServices','hotels',
                    'insurance','jobs','pets','studentHub','towing','transport','ehliyet','connectivity','eatery'));

ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_action_check;
ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_action_check
  CHECK (action IN ('call','whatsapp','call_secondary','website','maps','route_complete','book',
                    'instagram','facebook','email','menu'));

-- ─── Assertions (inside the transaction; a failure rolls the file back) ─────
DO $$
DECLARE
  v_policies   text;
  v_n_p        int; v_n_i int; v_n_f int;
  v_nonsel     int;
  v_badroles   int;
  v_rls        int;
  v_priv       text;
  v_seed       public.eatery_partners%ROWTYPE;
  v_seed_n     int;
  v_total_n    int;
  v_probe_on   uuid;
  v_probe_off  uuid;
  v_seed_id    constant uuid := 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434';
  v_anon_seed  int; v_auth_seed int; v_own_seed int;
  v_anon_p int; v_anon_i int; v_anon_f int;
  v_auth_p int; v_auth_i int; v_auth_f int;
  v_own_p  int; v_own_i  int; v_own_f  int;
  v_anon_w_p text := 'not run'; v_anon_w_i text := 'not run'; v_anon_w_f text := 'not run';
  v_auth_w_p text := 'not run'; v_auth_w_i text := 'not run'; v_auth_w_f text := 'not run';
  v_auth_u_i text := 'not run'; v_auth_d_f text := 'not run';
  v_ce_anon text := 'not run'; v_ce_auth text := 'not run';
  v_ce_mod text := 'not run'; v_ce_act text := 'not run'; v_ce_oldact text := 'not run';
  v_ce_badmod text := 'not run'; v_ce_badact text := 'not run';
  c            record;
  v_cases_run  int := 0;
  v_fail       text := '';
  v_def        text;
  v_set        text[];
  v_sc_def     text;
  v_st_before  int; v_st_after int; v_st_names text; v_st_named int; v_st_unscoped text;
  v_bucket     record;
  v_post_mod   constant text[] := ARRAY['accommodation','connectivity','eatery','ehliyet','events','explore','garages','grooming',
                                        'homeServices','hotels','insurance','jobs','pets','studentHub','towing','transport'];
  v_post_act   constant text[] := ARRAY['book','call','call_secondary','email','facebook','instagram','maps','menu',
                                        'route_complete','website','whatsapp'];
  v_complete_set constant text := 'lat = 35.1, lng = 33.3, geocode_source = ''partner'', logo_path = ''zz/logo.png'', menu_verified_on = DATE ''2026-10-01''';
  v_case_id    uuid;
  v_item_id    bigint;
  v_photo_id   bigint;
BEGIN
  -- The FULL policy set on the three tables, printed: presence of mine never proves absence of others.
  SELECT count(*) FILTER (WHERE tablename = 'eatery_partners'),
         count(*) FILTER (WHERE tablename = 'eatery_menu_items'),
         count(*) FILTER (WHERE tablename = 'eatery_photos'),
         count(*) FILTER (WHERE cmd IS DISTINCT FROM 'SELECT' OR permissive IS DISTINCT FROM 'PERMISSIVE'),
         count(*) FILTER (WHERE roles::text[] IS DISTINCT FROM ARRAY['anon','authenticated']::text[]),
         string_agg(tablename || '.' || policyname || ' ' || cmd || ' ' || array_to_string(roles, ',') || ' USING ' || coalesce(qual, '<none>'), '; ' ORDER BY tablename, policyname)
    INTO v_n_p, v_n_i, v_n_f, v_nonsel, v_badroles, v_policies
    FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('eatery_partners','eatery_menu_items','eatery_photos');
  IF v_n_p IS DISTINCT FROM 1 OR v_n_i IS DISTINCT FROM 1 OR v_n_f IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'policy set: eatery_partners % / eatery_menu_items % / eatery_photos % (want 1/1/1): %', v_n_p, v_n_i, v_n_f, v_policies;
  END IF;
  IF v_nonsel IS DISTINCT FROM 0 OR v_badroles IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'a policy is not a permissive SELECT for exactly {anon,authenticated}: %', v_policies;
  END IF;

  SELECT count(*) INTO v_rls FROM pg_class
   WHERE oid IN ('public.eatery_partners'::regclass, 'public.eatery_menu_items'::regclass, 'public.eatery_photos'::regclass)
     AND relrowsecurity;
  IF v_rls IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'RLS is not enabled on all three tables (% of 3)', v_rls; END IF;

  -- Grants per role from the catalog; denial and the positive control side by side.
  SELECT string_agg(t || ':' || r || ' sel=' || has_table_privilege(r, t, 'SELECT')
                    || ' write=' || has_table_privilege(r, t, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), '; ' ORDER BY t, r)
    INTO v_priv
    FROM unnest(ARRAY['public.eatery_partners','public.eatery_menu_items','public.eatery_photos']) t,
         unnest(ARRAY['anon','authenticated']) r;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['public.eatery_partners','public.eatery_menu_items','public.eatery_photos']) t,
                                unnest(ARRAY['anon','authenticated']) r
              WHERE NOT has_table_privilege(r, t, 'SELECT')
                 OR has_table_privilege(r, t, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) THEN
    RAISE EXCEPTION 'client grants wrong (want SELECT only): %', v_priv;
  END IF;
  IF NOT (has_table_privilege('service_role', 'public.eatery_partners', 'SELECT,INSERT,UPDATE,DELETE')
      AND has_table_privilege('service_role', 'public.eatery_menu_items', 'SELECT,INSERT,UPDATE,DELETE')
      AND has_table_privilege('service_role', 'public.eatery_photos', 'SELECT,INSERT,UPDATE,DELETE')) THEN
    RAISE EXCEPTION 'CONTROL FAILED: service_role lost write access';
  END IF;

  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'eatery_partners' AND column_name = 'is_active') IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'eatery_partners.is_active DEFAULT is not false';
  END IF;

  -- Seed: present, inactive, and bare (no invented phone, address, region, pin, logo or menu date).
  SELECT count(*) INTO v_seed_n FROM public.eatery_partners WHERE id = v_seed_id;
  SELECT count(*) INTO v_total_n FROM public.eatery_partners;
  IF v_seed_n IS DISTINCT FROM 1 OR v_total_n IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'seed: seed rows=% total partner rows=% (want 1 / 1)', v_seed_n, v_total_n;
  END IF;
  SELECT * INTO v_seed FROM public.eatery_partners WHERE id = v_seed_id;
  IF v_seed.slug IS DISTINCT FROM 'crunchy-express' OR v_seed.name IS DISTINCT FROM 'Crunchy Express'
     OR v_seed.category IS DISTINCT FROM 'fast_food' OR v_seed.is_active IS DISTINCT FROM false
     OR v_seed.phone IS NOT NULL OR v_seed.whatsapp IS NOT NULL OR v_seed.website_url IS NOT NULL
     OR v_seed.menu_url IS NOT NULL OR v_seed.maps_url IS NOT NULL OR v_seed.region IS NOT NULL
     OR v_seed.address IS NOT NULL OR v_seed.lat IS NOT NULL OR v_seed.lng IS NOT NULL
     OR v_seed.geocode_source IS NOT NULL OR v_seed.opening_hours IS NOT NULL OR v_seed.logo_path IS NOT NULL
     OR v_seed.menu_verified_on IS NOT NULL THEN
    RAISE EXCEPTION 'seed row is not the bare inactive Crunchy Express: %', to_jsonb(v_seed);
  END IF;
  IF (SELECT count(*) FROM public.eatery_menu_items) IS DISTINCT FROM 0 OR (SELECT count(*) FROM public.eatery_photos) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'seed: menu items or photos exist (want 0 / 0)';
  END IF;

  -- BEHAVIOUR, rolled back by a sentinel. PL/pgSQL variables survive it; rows do not (re-runnable).
  BEGIN
    -- Owner inserts: an ACTIVE, launch-complete probe partner (positive control) and an INACTIVE one,
    -- each with one menu item and one photo.
    INSERT INTO public.eatery_partners (slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active)
      VALUES ('zz-on', 'zz on', 'cafe', 35.1, 33.3, 'partner', 'zz-on/logo.png', DATE '2026-10-01', true) RETURNING id INTO v_probe_on;
    INSERT INTO public.eatery_partners (slug, name, category, is_active)
      VALUES ('zz-off', 'zz off', 'cafe', false) RETURNING id INTO v_probe_off;
    INSERT INTO public.eatery_menu_items (partner_id, section, name) VALUES (v_probe_on, 'zz', 'zz item on'), (v_probe_off, 'zz', 'zz item off');
    INSERT INTO public.eatery_photos (partner_id, kind, storage_path) VALUES (v_probe_on, 'gallery', 'zz-on/zz-1.jpg'), (v_probe_off, 'gallery', 'zz-off/zz-1.jpg');

    SET LOCAL ROLE anon;
    PERFORM set_config('request.jwt.claims', '', true);
    SELECT count(*) INTO v_anon_seed FROM public.eatery_partners WHERE id = v_seed_id;
    SELECT count(*) INTO v_anon_p FROM public.eatery_partners WHERE slug LIKE 'zz-%';
    SELECT count(*) INTO v_anon_i FROM public.eatery_menu_items WHERE partner_id IN (v_probe_on, v_probe_off);
    SELECT count(*) INTO v_anon_f FROM public.eatery_photos WHERE partner_id IN (v_probe_on, v_probe_off);
    BEGIN
      INSERT INTO public.eatery_partners (slug, name, category) VALUES ('zz-anon', 'zz anon', 'cafe');
      v_anon_w_p := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_anon_w_p := 'denied';
    END;
    BEGIN
      INSERT INTO public.eatery_menu_items (partner_id, section, name) VALUES (v_probe_on, 'zz', 'zz anon');
      v_anon_w_i := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_anon_w_i := 'denied';
    END;
    BEGIN
      INSERT INTO public.eatery_photos (partner_id, kind, storage_path) VALUES (v_probe_on, 'gallery', 'zz-on/zz-anon.jpg');
      v_anon_w_f := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_anon_w_f := 'denied';
    END;
    BEGIN
      INSERT INTO public.contact_events (id, module, entity_id, action) VALUES (gen_random_uuid(), 'eatery', v_probe_on, 'menu');
      v_ce_anon := 'accepted';
    EXCEPTION WHEN OTHERS THEN v_ce_anon := 'REFUSED: ' || SQLERRM;
    END;
    RESET ROLE;

    -- authenticated covers every signed-in user AND every guest.
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    SELECT count(*) INTO v_auth_seed FROM public.eatery_partners WHERE id = v_seed_id;
    SELECT count(*) INTO v_auth_p FROM public.eatery_partners WHERE slug LIKE 'zz-%';
    SELECT count(*) INTO v_auth_i FROM public.eatery_menu_items WHERE partner_id IN (v_probe_on, v_probe_off);
    SELECT count(*) INTO v_auth_f FROM public.eatery_photos WHERE partner_id IN (v_probe_on, v_probe_off);
    BEGIN
      INSERT INTO public.eatery_partners (slug, name, category) VALUES ('zz-auth', 'zz auth', 'cafe');
      v_auth_w_p := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_auth_w_p := 'denied';
    END;
    BEGIN
      INSERT INTO public.eatery_menu_items (partner_id, section, name) VALUES (v_probe_on, 'zz', 'zz auth');
      v_auth_w_i := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_auth_w_i := 'denied';
    END;
    BEGIN
      INSERT INTO public.eatery_photos (partner_id, kind, storage_path) VALUES (v_probe_on, 'gallery', 'zz-on/zz-auth.jpg');
      v_auth_w_f := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_auth_w_f := 'denied';
    END;
    BEGIN
      UPDATE public.eatery_menu_items SET name = 'zz hijack' WHERE partner_id = v_probe_on;
      v_auth_u_i := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_auth_u_i := 'denied';
    END;
    BEGIN
      DELETE FROM public.eatery_photos WHERE partner_id = v_probe_on;
      v_auth_d_f := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_auth_d_f := 'denied';
    END;
    BEGIN
      INSERT INTO public.contact_events (id, module, entity_id, action) VALUES (gen_random_uuid(), 'eatery', v_probe_on, 'menu');
      v_ce_auth := 'accepted';
    EXCEPTION WHEN OTHERS THEN v_ce_auth := 'REFUSED: ' || SQLERRM;
    END;
    PERFORM set_config('request.jwt.claims', '', true);
    RESET ROLE;

    -- Control: the owner sees everything, so a 0/1 above is the policy and not an empty table.
    SELECT count(*) INTO v_own_seed FROM public.eatery_partners WHERE id = v_seed_id;
    SELECT count(*) INTO v_own_p FROM public.eatery_partners WHERE slug LIKE 'zz-%';
    SELECT count(*) INTO v_own_i FROM public.eatery_menu_items WHERE partner_id IN (v_probe_on, v_probe_off);
    SELECT count(*) INTO v_own_f FROM public.eatery_photos WHERE partner_id IN (v_probe_on, v_probe_off);

    -- Constraint negatives, each paired with a good-row control. A case = (label, BAD assignments,
    -- GOOD assignments) applied by UPDATE to a fresh valid base row, so the CHECK under test is the only
    -- thing that can fire. A bad change ACCEPTED, or a good change REFUSED, is recorded in v_fail.
    FOR c IN SELECT * FROM (VALUES
      ('bad slug',            'slug = ''Bad Slug''',                 'slug = ''good-slug'''),
      ('short name',          'name = ''x''',                        'name = ''good name'''),
      ('bad category',        'category = ''sushi''',                'category = ''bakery'''),
      ('bad phone',           'phone = ''0533 000 00 01''',          'phone = ''+90 533 000 00 01'''),
      ('bad whatsapp',        'whatsapp = ''533''',                  'whatsapp = ''+90 533 000 00 01'''),
      ('http website',        'website_url = ''http://x.example''',  'website_url = ''https://x.example'''),
      ('http menu_url',       'menu_url = ''http://x.example''',     'menu_url = ''https://x.example'''),
      ('whitespace in website', 'website_url = ''https://x.example/a b''', 'website_url = ''https://x.example/a-b'''),
      ('2049-char menu_url',  'menu_url = ''https://x.example/'' || repeat(''a'', 2031)', 'menu_url = ''https://x.example/'' || repeat(''a'', 2030)'),
      ('http maps_url',       'maps_url = ''http://x.example''',     'maps_url = ''https://x.example'''),
      ('bad region',          'region = ''mars''',                   'region = ''kyrenia'''),
      ('short address',       'address = ''abc''',                   'address = ''Zz Sokak 1, Girne'''),
      ('coords outside bbox', 'lat = 36.0, lng = 33.3, geocode_source = ''partner''', 'lat = 35.1, lng = 33.3, geocode_source = ''osm'''),
      ('lat without lng',     'lat = 35.1, geocode_source = ''osm''', 'lat = 35.1, lng = 33.3, geocode_source = ''osm'''),
      ('pin without source',  'lat = 35.1, lng = 33.3',              'lat = 35.1, lng = 33.3, geocode_source = ''partner'''),
      ('source without pin',  'geocode_source = ''osm''',            'lat = 35.1, lng = 33.3, geocode_source = ''osm'''),
      ('google_places source','lat = 35.1, lng = 33.3, geocode_source = ''google_places''', 'lat = 35.1, lng = 33.3, geocode_source = ''osm'''),
      ('bad opening hours',   'opening_hours = ''{"mon":{"open":"25:00","close":"10:00"}}''::jsonb',
                              'opening_hours = ''{"mon":{"open":"09:00","close":"23:00"},"tue":null}''::jsonb'),
      ('bad logo path',       'logo_path = ''../x.png''',            'logo_path = ''zz-ok/logo.png'''),
      ('active with nothing', 'is_active = true',                    v_complete_set || ', is_active = true'),
      ('active without lat',  'logo_path = ''zz/logo.png'', menu_verified_on = DATE ''2026-10-01'', is_active = true', v_complete_set || ', is_active = true'),
      ('active without logo', 'lat = 35.1, lng = 33.3, geocode_source = ''partner'', menu_verified_on = DATE ''2026-10-01'', is_active = true', v_complete_set || ', is_active = true'),
      ('active without menu_verified_on', 'lat = 35.1, lng = 33.3, geocode_source = ''partner'', logo_path = ''zz/logo.png'', is_active = true', v_complete_set || ', is_active = true')
    ) AS t(label, bad_set, good_set) LOOP
      v_cases_run := v_cases_run + 1;
      INSERT INTO public.eatery_partners (slug, name, category) VALUES ('zz-case-' || v_cases_run, 'zz case ' || v_cases_run, 'cafe') RETURNING id INTO v_case_id;
      BEGIN
        EXECUTE format('UPDATE public.eatery_partners SET %s WHERE id = %L', c.bad_set, v_case_id);
        v_fail := v_fail || ' ACCEPTED(' || c.label || ')';
      EXCEPTION WHEN check_violation THEN NULL;
      END;
      BEGIN
        EXECUTE format('UPDATE public.eatery_partners SET %s WHERE id = %L', c.good_set, v_case_id);
      EXCEPTION WHEN check_violation THEN v_fail := v_fail || ' GOOD-REFUSED(' || c.label || ')';
      END;
    END LOOP;
    -- Children, same method, against a base item / photo on the active probe partner.
    INSERT INTO public.eatery_menu_items (partner_id, section, name) VALUES (v_probe_on, 'zz', 'zz base') RETURNING id INTO v_item_id;
    INSERT INTO public.eatery_photos (partner_id, kind, storage_path) VALUES (v_probe_on, 'gallery', 'zz-on/zz-base.jpg') RETURNING id INTO v_photo_id;
    FOR c IN SELECT * FROM (VALUES
      ('eatery_menu_items', 'blank section',    'section = ''  ''',              'section = ''Burgers'''),
      ('eatery_menu_items', 'bad currency',      'currency = ''USD''',            'currency = ''EUR'''),
      ('eatery_menu_items', 'negative price',    'price = -1',                    'price = 0'),
      ('eatery_menu_items', 'blank item name',   'name = ''   ''',                'name = ''Tost'''),
      ('eatery_menu_items', 'long description',  'description = repeat(''x'', 301)', 'description = repeat(''x'', 300)'),
      ('eatery_photos',     'bad kind',          'kind = ''video''',              'kind = ''menu'''),
      ('eatery_photos',     'bad storage path',  'storage_path = ''https://x.example/a.jpg''', 'storage_path = ''zz-on/zz-good.webp'''),
      ('eatery_photos',     'width without height', 'width = 100',                'width = 100, height = 80'),
      ('eatery_photos',     'zero width',        'width = 0, height = 80',        'width = 100, height = 80')
    ) AS t(tbl, label, bad_set, good_set) LOOP
      v_cases_run := v_cases_run + 1;
      BEGIN
        EXECUTE format('UPDATE public.%I SET %s WHERE id = %L', c.tbl, c.bad_set, CASE c.tbl WHEN 'eatery_photos' THEN v_photo_id ELSE v_item_id END);
        v_fail := v_fail || ' ACCEPTED(' || c.label || ')';
      EXCEPTION WHEN check_violation THEN NULL;
      END;
      BEGIN
        EXECUTE format('UPDATE public.%I SET %s WHERE id = %L', c.tbl, c.good_set, CASE c.tbl WHEN 'eatery_photos' THEN v_photo_id ELSE v_item_id END);
      EXCEPTION WHEN check_violation THEN v_fail := v_fail || ' GOOD-REFUSED(' || c.label || ')';
      END;
    END LOOP;

    -- contact_events: new values accepted, a made-up one still refused, an old one still accepted.
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action) VALUES ('eatery', v_probe_on, 'menu');
      v_ce_mod := 'accepted';
    EXCEPTION WHEN check_violation THEN v_ce_mod := 'REFUSED';
    END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action) VALUES ('hotels', v_probe_on, 'menu');
      v_ce_act := 'accepted';
    EXCEPTION WHEN check_violation THEN v_ce_act := 'REFUSED';
    END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action) VALUES ('eatery', v_probe_on, 'call');
      v_ce_oldact := 'accepted';
    EXCEPTION WHEN check_violation THEN v_ce_oldact := 'REFUSED';
    END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action) VALUES ('zzmodule', v_probe_on, 'menu');
      v_ce_badmod := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_ce_badmod := 'refused';
    END;
    BEGIN
      INSERT INTO public.contact_events (module, entity_id, action) VALUES ('eatery', v_probe_on, 'zzaction');
      v_ce_badact := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_ce_badact := 'refused';
    END;

    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_anon_seed IS DISTINCT FROM 0 OR v_auth_seed IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'the inactive seed is visible: anon % / authenticated % (want 0 / 0)', v_anon_seed, v_auth_seed; END IF;
  IF v_own_seed IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'CONTROL FAILED: owner sees % seed rows (want 1)', v_own_seed; END IF;
  IF v_anon_p IS DISTINCT FROM 1 OR v_anon_i IS DISTINCT FROM 1 OR v_anon_f IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'anon sees % partners / % items / % photos of the probes (want 1/1/1: active partner only)', v_anon_p, v_anon_i, v_anon_f; END IF;
  IF v_auth_p IS DISTINCT FROM 1 OR v_auth_i IS DISTINCT FROM 1 OR v_auth_f IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'authenticated sees % partners / % items / % photos of the probes (want 1/1/1)', v_auth_p, v_auth_i, v_auth_f; END IF;
  IF v_own_p IS DISTINCT FROM 2 OR v_own_i IS DISTINCT FROM 2 OR v_own_f IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'CONTROL FAILED: owner sees % partners / % items / % photos of the probes (want 2/2/2)', v_own_p, v_own_i, v_own_f; END IF;
  IF v_anon_w_p IS DISTINCT FROM 'denied' OR v_anon_w_i IS DISTINCT FROM 'denied' OR v_anon_w_f IS DISTINCT FROM 'denied' THEN
    RAISE EXCEPTION 'anon INSERT: partners % / items % / photos % (want denied x3)', v_anon_w_p, v_anon_w_i, v_anon_w_f; END IF;
  IF v_auth_w_p IS DISTINCT FROM 'denied' OR v_auth_w_i IS DISTINCT FROM 'denied' OR v_auth_w_f IS DISTINCT FROM 'denied'
     OR v_auth_u_i IS DISTINCT FROM 'denied' OR v_auth_d_f IS DISTINCT FROM 'denied' THEN
    RAISE EXCEPTION 'authenticated writes: INSERT partners % / items % / photos %, UPDATE items %, DELETE photos % (want denied x5)',
      v_auth_w_p, v_auth_w_i, v_auth_w_f, v_auth_u_i, v_auth_d_f; END IF;
  IF v_fail <> '' THEN RAISE EXCEPTION 'constraint cases failed (% run):%', v_cases_run, v_fail; END IF;
  IF v_cases_run IS DISTINCT FROM 32 THEN RAISE EXCEPTION 'constraint case loop ran % cases (want 32)', v_cases_run; END IF;
  IF v_ce_anon IS DISTINCT FROM 'accepted' OR v_ce_auth IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'contact_events eatery/menu tap: as anon was %, as authenticated was %', v_ce_anon, v_ce_auth; END IF;
  IF v_ce_mod IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'contact_events module eatery + action menu was %', v_ce_mod; END IF;
  IF v_ce_act IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'contact_events action menu (module hotels) was %', v_ce_act; END IF;
  IF v_ce_oldact IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'CONTROL FAILED: contact_events action call (module eatery) was %', v_ce_oldact; END IF;
  IF v_ce_badmod IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: made-up module was %', v_ce_badmod; END IF;
  IF v_ce_badact IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: made-up action was %', v_ce_badact; END IF;
  IF EXISTS (SELECT 1 FROM public.eatery_partners WHERE slug LIKE 'zz-%') THEN
    RAISE EXCEPTION 'probe partners survived the rollback'; END IF;
  IF (SELECT count(*) FROM public.eatery_partners) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'eatery_partners holds % rows after the probes (want only the seed)', (SELECT count(*) FROM public.eatery_partners); END IF;

  -- contact_events CHECKs, post-state from the catalog: exact sets.
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_module_check';
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_set
    FROM regexp_matches(coalesce(v_def, ''), '''([a-zA-Z]+)''::text', 'g') AS m;
  IF v_set IS NULL OR NOT (v_set @> v_post_mod AND v_set <@ v_post_mod) THEN
    RAISE EXCEPTION 'contact_events_module_check post-state is not the 15 + eatery. def=%', coalesce(v_def, '<missing>');
  END IF;
  RAISE NOTICE 'contact_events_module_check now: %', v_def;
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.contact_events'::regclass AND conname = 'contact_events_action_check';
  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_set
    FROM regexp_matches(coalesce(v_def, ''), '''([a-z_]+)''::text', 'g') AS m;
  IF v_set IS NULL OR NOT (v_set @> v_post_act AND v_set <@ v_post_act) THEN
    RAISE EXCEPTION 'contact_events_action_check post-state is not the 10 + menu. def=%', coalesce(v_def, '<missing>');
  END IF;
  RAISE NOTICE 'contact_events_action_check now: %', v_def;

  -- search_content has NO eatery arm. pg_get_functiondef returns the comments too, so the negative is
  -- anchored to a code shape ('FROM eatery_partners'), and paired with a positive ('FROM places p')
  -- proving the definition was read and is the one with the places arm.
  v_sc_def := pg_get_functiondef(to_regprocedure('public.search_content(text,double precision,double precision)'));
  IF v_sc_def IS NULL OR v_sc_def NOT ILIKE '%FROM places p%' THEN
    RAISE EXCEPTION 'CONTROL FAILED: search_content definition not read, or lost its places arm (len=%)', length(coalesce(v_sc_def, ''));
  END IF;
  IF v_sc_def ILIKE '%FROM eatery_partners%' OR v_sc_def ILIKE '%FROM public.eatery_partners%'
     OR v_sc_def ILIKE '%JOIN eatery_partners%' OR v_sc_def ILIKE '%JOIN public.eatery_partners%' THEN
    RAISE EXCEPTION 'search_content has an eatery arm; it must not (pre-launch content is searchable the moment a row is active)';
  END IF;

  -- Bucket and storage.objects: public, and the policy set is exactly as it was before this file.
  SELECT public, file_size_limit, allowed_mime_types INTO v_bucket FROM storage.buckets WHERE id = 'eatery-images';
  IF v_bucket IS NULL OR v_bucket.public IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'bucket eatery-images is missing or not public';
  END IF;
  SELECT count(*), string_agg(policyname, ', ' ORDER BY policyname),
         count(*) FILTER (WHERE COALESCE(qual, '') || COALESCE(with_check, '') LIKE '%eatery-images%'),
         coalesce(string_agg(policyname, ',' ORDER BY policyname) FILTER (WHERE permissive = 'PERMISSIVE'
                    AND COALESCE(qual, '') || COALESCE(with_check, '') NOT LIKE '%bucket_id%'), '')
    INTO v_st_after, v_st_names, v_st_named, v_st_unscoped
    FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';
  v_st_before := current_setting('ada.storage_pol_before', true)::int;
  IF v_st_before IS DISTINCT FROM v_st_after THEN
    RAISE EXCEPTION 'storage.objects policy count changed: % -> %', v_st_before, v_st_after;
  END IF;
  IF coalesce(v_st_names, '') IS DISTINCT FROM current_setting('ada.storage_pol_names_before', true) THEN
    RAISE EXCEPTION 'storage.objects policy NAMES changed: [%] -> [%]', current_setting('ada.storage_pol_names_before', true), v_st_names;
  END IF;
  IF v_st_unscoped IS DISTINCT FROM current_setting('ada.storage_unscoped_before', true) THEN
    RAISE EXCEPTION 'the set of bucket-unscoped permissive storage.objects policies changed: [%] -> [%]', current_setting('ada.storage_unscoped_before', true), v_st_unscoped;
  END IF;
  IF v_st_named IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION '% storage.objects policies name eatery-images (want 0)', v_st_named;
  END IF;

  RAISE NOTICE 'eatery policies (% on partners, % on items, % on photos): %', v_n_p, v_n_i, v_n_f, v_policies;
  RAISE NOTICE 'eatery grants: %', v_priv;
  RAISE NOTICE 'constraint cases run: % (bad refused + good accepted)', v_cases_run;
  RAISE NOTICE 'storage.objects policies: % before, % after, % name eatery-images, bucket-unscoped permissive (unchanged): [%]; names: %', v_st_before, v_st_after, v_st_named, v_st_unscoped, v_st_names;
  RAISE NOTICE 'bucket eatery-images: public=% limit=% mime=%', v_bucket.public, v_bucket.file_size_limit, v_bucket.allowed_mime_types;
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
VALUES ('20261115_eatery_partners.sql', '5afbb0f76df516618cd7713f3a07feaba26904a62a79d5491e518d7ea323a110')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: every 1115_eatery_partners row must read OK, and the
--   1112 module / 1109 action tokens stand down (superseded) once the ledger records this file.
--
-- ─── Rollback (only if the module is abandoned) ──
--   ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_module_check;
--   ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_module_check
--     CHECK (module IN ('accommodation','events','explore','garages','grooming','homeServices','hotels',
--                       'insurance','jobs','pets','studentHub','towing','transport','ehliyet','connectivity'));
--   ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_action_check;
--   ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_action_check
--     CHECK (action IN ('call','whatsapp','call_secondary','website','maps','route_complete','book',
--                       'instagram','facebook','email'));
--   DROP TABLE IF EXISTS public.eatery_photos, public.eatery_menu_items, public.eatery_partners;
--   (Empty the bucket through the Storage API first, then: DELETE FROM storage.buckets WHERE id = 'eatery-images';)

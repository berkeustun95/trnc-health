-- ═══════════════════════════════════════════════════════════════════════════
-- 20261229 — Döveç projects: the feed we mirror, the single settings row, and the enquiry ledger
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Döveç Group (a developer; partner API at atlas.dovecgroup.com) publishes a list of its projects. The
-- sync-dovec edge function copies that list into dovec_projects every 10 minutes; the app shows it read-only
-- and sends an enquiry through the dovec-lead edge function, which saves it in dovec_leads and forwards it.
--
-- WHAT THIS FILE ADDS
--   dovec_settings   exactly one row (id = 1): the go-live gate, the kill switch, the WhatsApp number, sync state.
--   dovec_projects   one row per Döveç project id. Projects are never deleted, only delisted (listed = false).
--   dovec_leads      one row per enquiry. No policy and no grant for any app role: edge functions only. At most ONE row may be
--                    the agreed test enquiry (is_test, external_id 'TEST-1'); see "THE TEST ENQUIRY" below.
--   dovec_project_coords  five seeded map pins (the feed carries no coordinates) and their attachment state; edge functions only.
--   dovec_sync_coords() / dovec_coord_status()  attach a pin to a project by EXACT name and report what is unmatched; service role only.
--   dovec_feed_is_fresh()       STABLE helper the dovec_projects read policy calls.
--   dovec_lead_counts()         admin-only counts per project / month / status. No personal field.
--   dovec_leads_wipe_pii()      90-day retention (service role / cron only).
--   contact_events_module_check gains 'dovec' (thank-you screen WhatsApp taps), see section 5.
--   dovec_leads_forget_user()   AFTER DELETE trigger on profiles: account deletion wipes that user's lead PII.
--
-- WHO CAN READ / WRITE WHAT, IN PLAIN ENGLISH
--   dovec_settings
--     Read:  anyone, signed in or not (anon and authenticated), but only the columns id, published, suspended,
--            whatsapp_e164 and last_good_sync_at. The run-status text columns are not readable by an app role.
--     Write: nobody from the app. The sync function (service role) may update suspended, last_good_sync_at,
--            last_run_at, last_run_status and last_run_detail. `published` and `whatsapp_e164` change only by a
--            migration. The row cannot be inserted a second time or deleted by the service role.
--   dovec_projects
--     Read:  anyone (anon and authenticated, guests included) sees a project ONLY WHILE ALL THREE hold:
--            the project is listed, the feed is not suspended, and the last good sync was under 24 hours ago.
--            The check lives in the read policy itself, so if the cron or the function dies, every project
--            disappears from the app 24 hours later without anyone doing anything.
--     Write: nobody from the app. The sync function (service role) may insert and update; it cannot delete.
--   dovec_leads
--     RLS is on and there are ZERO policies; every privilege is revoked from PUBLIC, anon and authenticated.
--     No app user, guest, provider or admin can read or write a lead through the API. Only the edge functions
--     (service role, which bypasses RLS) can, and they never return another person's lead. The service role may
--     select, insert and update, not delete.
--   dovec_lead_counts()
--     Executable by signed-in users, but it raises ADMIN_ONLY unless is_admin(). Returns project, month, status
--     and a count. No name, phone, e-mail, message or user id leaves it. anon cannot execute it.
--
--   dovec_project_coords
--     RLS is on and there are ZERO policies; anon and authenticated hold no privilege. The service role may SELECT only; the
--     rows change through dovec_sync_coords() (SECURITY DEFINER, EXECUTE service_role only), never by a client write.
--     dovec_coord_status() (service_role only) lists unmatched seeds, renamed projects and live projects without a pin: public
--     marketing names and Döveç ids, no user data. The latitude / longitude that the app reads are copied onto
--     dovec_projects, which the existing read policy already covers.
--
-- COORDINATES (the feed has none)
--   dovec_project_coords is seeded below with exactly five pins. After each good feed sync, sync-dovec calls
--   dovec_sync_coords(). A seed with project_id NULL attaches ONLY when exactly ONE listed project has
--   name = seed_name BYTE FOR BYTE (compared COLLATE "C": no trim, no case folding, no Unicode normalisation: 'D-point',
--   'D-Point ' and an NFD spelling are all different). Zero matches ('no_match') or two or more ('ambiguous') or a project
--   already pinned by another seed ('claimed') attach nothing and are reported. Once attached the pin stays with that
--   project id forever: if the project is later renamed the pin is kept and reported ('renamed'); a delisted project keeps its
--   pin. Latitude and longitude are copied onto dovec_projects for attached ids only and are never written anywhere else, never
--   guessed and never cleared (the sync upsert does not name the columns). NOTE: sync-dovec stores the feed name after
--   trimming leading / trailing whitespace (mapProject, unchanged), so the byte comparison is against that stored name.
--
-- THE TEST ENQUIRY (prepared here, never sent by this file)
--   Döveç asked for exactly one agreed test enquiry (name "ADA TEST", external id TEST-1, no project). dovec_leads.is_test marks
--   it. CHECKs: is_test <=> external_id = 'TEST-1' (every other row must be ADA-n); project_id may be NULL only when is_test;
--   a partial unique index allows exactly one is_test row, ever. dovec_lead_counts() and the rate limits ignore it. The send is
--   a separate service-only mode of dovec-lead behind its own two locks (see supabase/functions/sync-dovec/PLUG-IN.md).
--
-- WHY `published` IS NOT IN THE dovec_projects READ POLICY (a decision, written down on purpose)
--   `published` is the production go-live gate: the app reads it and hides the whole module while it is false.
--   It is deliberately NOT part of the RLS expression, because the design mockup needs real rows on a dev bundle
--   while published = false. The rows are Döveç's own public marketing data (project name, city, from-price, a
--   website link): there is no personal data in the table, so seeing them early is not a privacy question; the
--   gate exists so users do not see an unfinished screen, not to protect data. The leads table, which does hold
--   personal data, has no read path at all regardless of `published`.
--
-- ACCOUNT DELETION (read why this is shaped the way it is)
--   dovec_leads.user_id has NO foreign key. 20261029 hit the ON DELETE SET NULL trap three times: SET NULL is run
--   as an ordinary UPDATE, so triggers and CHECK constraints see it, and each one broke delete_own_account.
--   Instead an AFTER DELETE trigger on profiles (delete_own_account deletes the profile; an admin deleting the
--   auth user cascades to it) runs UPDATE ... SET user_id = NULL, name/phone/email/message = NULL,
--   pii_wiped_at = now() for that user. The row stays, so lead counts survive forever; the person does not. A lead
--   still waiting to be sent loses its payload with the person, so it is marked 'failed' (it cannot be resent).
--   Proven against the migration harness (scripts/test-dovec-sql.mjs): a user delete succeeds and leaves a wiped row.
--
-- NOTES
--   * The conventions in CLAUDE.md apply: language is a full English name (CHECK rejects 'tr' / 'en'); the code sent
--     to Döveç is the separate 2-letter language_code.
--   * `published` DEFAULT false is registered as an H token in verify_schema.sql (a reverted DEFAULT creates no named
--     object).
--   * The retention function nulls user_id as well as the four PII columns (data minimisation; a pseudonymous id
--     serves no purpose once the payload is gone). external_id, project, dates and status are kept forever.
--   * No function here writes `notifications`, so the 1066_notification_type writer count is unchanged.
--
-- Apply: supabase-migrate. New tables and functions: ends with NOTIFY pgrst after RESET ROLE.

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── 1. dovec_settings ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dovec_settings (
  id                smallint    NOT NULL DEFAULT 1,
  published         boolean     NOT NULL DEFAULT false,
  suspended         boolean     NOT NULL DEFAULT false,
  whatsapp_e164     text,
  last_good_sync_at timestamptz,
  last_run_at       timestamptz,
  last_run_status   text,
  last_run_detail   text,
  CONSTRAINT dovec_settings_pkey PRIMARY KEY (id),
  CONSTRAINT dovec_settings_single_row CHECK (id = 1),
  CONSTRAINT dovec_settings_whatsapp_check CHECK (whatsapp_e164 IS NULL OR whatsapp_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT dovec_settings_status_check CHECK (last_run_status IS NULL OR last_run_status = ANY (ARRAY[
    'ok','refused_empty','refused_count_mismatch','refused_mass_delist','http_401','http_429','not_provisioned',
    'http_error','network_error','parse_error','write_error']::text[])),
  CONSTRAINT dovec_settings_detail_check CHECK (last_run_detail IS NULL OR char_length(last_run_detail) <= 1000)
);

COMMENT ON TABLE public.dovec_settings IS
  'Single row (id = 1). published = production go-live gate (default false, read by the app); suspended = kill switch set by sync-dovec on a 401; whatsapp_e164 and published change only by migration; the run columns are written by sync-dovec (service role). Readable columns for app roles: id, published, suspended, whatsapp_e164, last_good_sync_at. 20261229.';

-- whatsapp_e164 is Döveç's public sales line (Berke, 2026-11-23); it changes only by a migration, so this re-asserts it.
INSERT INTO public.dovec_settings (id, whatsapp_e164) VALUES (1, '+905338880515')
ON CONFLICT (id) DO UPDATE SET whatsapp_e164 = excluded.whatsapp_e164;

ALTER TABLE public.dovec_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.dovec_settings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (id, published, suspended, whatsapp_e164, last_good_sync_at) ON TABLE public.dovec_settings TO anon, authenticated;
GRANT SELECT ON TABLE public.dovec_settings TO service_role;
GRANT UPDATE (suspended, last_good_sync_at, last_run_at, last_run_status, last_run_detail) ON TABLE public.dovec_settings TO service_role;

-- Anyone may read the one settings row (the column grants above decide which columns).
DROP POLICY IF EXISTS dovec_settings_read ON public.dovec_settings;
CREATE POLICY dovec_settings_read ON public.dovec_settings FOR SELECT TO anon, authenticated USING (true);

-- ─── 2. dovec_projects ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dovec_projects (
  id                     text        NOT NULL,
  name                   text        NOT NULL,
  city                   text        NOT NULL,
  area                   text,
  status                 text        NOT NULL,
  planned_delivery_month date,
  from_price             numeric,
  currency               text        NOT NULL DEFAULT 'GBP',
  available_units        integer,
  unit_types             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  cover_url              text,
  website_url            text        NOT NULL,
  listed                 boolean     NOT NULL DEFAULT true,
  first_seen_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at           timestamptz NOT NULL DEFAULT now(),
  delisted_at            timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  description            text,
  gallery                jsonb,
  entity_uuid            uuid        NOT NULL DEFAULT gen_random_uuid(),
  latitude               numeric(10,7),
  longitude              numeric(10,7),
  CONSTRAINT dovec_projects_pkey PRIMARY KEY (id),
  CONSTRAINT dovec_projects_entity_uuid_key UNIQUE (entity_uuid),
  CONSTRAINT dovec_projects_id_check CHECK (char_length(id) BETWEEN 1 AND 100),
  CONSTRAINT dovec_projects_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT dovec_projects_city_check CHECK (char_length(btrim(city)) BETWEEN 1 AND 100),
  CONSTRAINT dovec_projects_status_check CHECK (status = ANY (ARRAY['on_sale','under_construction']::text[])),
  CONSTRAINT dovec_projects_delivery_check CHECK (planned_delivery_month IS NULL OR planned_delivery_month = date_trunc('month', planned_delivery_month)::date),
  CONSTRAINT dovec_projects_price_check CHECK (from_price IS NULL OR from_price >= 0),
  CONSTRAINT dovec_projects_currency_check CHECK (currency = 'GBP'),
  CONSTRAINT dovec_projects_units_check CHECK (available_units IS NULL OR available_units >= 0),
  CONSTRAINT dovec_projects_unit_types_check CHECK (jsonb_typeof(unit_types) = 'array'),
  CONSTRAINT dovec_projects_gallery_check CHECK (gallery IS NULL OR jsonb_typeof(gallery) = 'array'),
  CONSTRAINT dovec_projects_cover_check CHECK (cover_url IS NULL OR cover_url ~ '^https://'),
  CONSTRAINT dovec_projects_website_check CHECK (website_url ~ '^https://'),
  CONSTRAINT dovec_projects_delisted_check CHECK (listed OR delisted_at IS NOT NULL),
  CONSTRAINT dovec_projects_coords_check CHECK ((latitude IS NULL) = (longitude IS NULL)
    AND (latitude IS NULL OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)))
);

COMMENT ON TABLE public.dovec_projects IS
  'Mirror of the Döveç partner feed (GET /api/partner/projects), written by sync-dovec only. Never deleted: a project that leaves the feed is delisted (listed = false). RLS read: listed AND dovec_feed_is_fresh() (not suspended, last good sync under 24 h). description and gallery are empty on purpose until Döveç supplies them. latitude / longitude are NULL until dovec_sync_coords() attaches a seeded pin by exact name (the feed has none). `published` is deliberately not in the policy (see 20261229 header). 20261229.';

CREATE INDEX IF NOT EXISTS dovec_projects_listed_idx ON public.dovec_projects (listed, name);

ALTER TABLE public.dovec_projects ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.dovec_projects FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.dovec_projects TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.dovec_projects TO service_role;

-- The freshness and kill-switch test, in one place. SECURITY DEFINER so the policy does not depend on the caller's
-- column grants on dovec_settings; fixed search_path; returns false (never NULL) when the row or the stamp is missing.
CREATE OR REPLACE FUNCTION public.dovec_feed_is_fresh()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT NOT s.suspended
       AND s.last_good_sync_at IS NOT NULL
       AND s.last_good_sync_at > now() - interval '24 hours'
      FROM public.dovec_settings s
     WHERE s.id = 1), false);
$function$;

REVOKE ALL ON FUNCTION public.dovec_feed_is_fresh() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dovec_feed_is_fresh() TO anon, authenticated, service_role;

-- Anyone (guests included) may read a project while it is listed AND the feed is fresh and not suspended.
DROP POLICY IF EXISTS dovec_projects_read ON public.dovec_projects;
CREATE POLICY dovec_projects_read ON public.dovec_projects FOR SELECT TO anon, authenticated
  USING (listed AND public.dovec_feed_is_fresh());

-- ─── 2b. Map pins: the seed table, and the exact-name attach ─────────────────
CREATE TABLE IF NOT EXISTS public.dovec_project_coords (
  seed_name   text          NOT NULL,
  latitude    numeric(10,7) NOT NULL,
  longitude   numeric(10,7) NOT NULL,
  project_id  text,
  matched_at  timestamptz,
  last_status text          NOT NULL DEFAULT 'pending',
  CONSTRAINT dovec_project_coords_pkey PRIMARY KEY (seed_name),
  CONSTRAINT dovec_project_coords_project_key UNIQUE (project_id),
  CONSTRAINT dovec_project_coords_project_fkey FOREIGN KEY (project_id) REFERENCES public.dovec_projects (id),
  CONSTRAINT dovec_project_coords_name_check CHECK (char_length(seed_name) BETWEEN 1 AND 200),
  CONSTRAINT dovec_project_coords_range_check CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180),
  CONSTRAINT dovec_project_coords_status_check CHECK (last_status = ANY (ARRAY['pending','matched','renamed','no_match','ambiguous','claimed']::text[])),
  CONSTRAINT dovec_project_coords_matched_check CHECK ((project_id IS NULL) = (matched_at IS NULL))
);

COMMENT ON TABLE public.dovec_project_coords IS
  'Five seeded map pins (the Döveç feed has no coordinates). dovec_sync_coords() attaches a seed to a project ONLY when exactly one listed project has name = seed_name byte for byte; once attached it stays. RLS on, zero policies, service_role SELECT only. 20261229.';

ALTER TABLE public.dovec_project_coords ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.dovec_project_coords FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.dovec_project_coords TO service_role;

INSERT INTO public.dovec_project_coords (seed_name, latitude, longitude) VALUES
  ('D-Point',            35.2695453, 33.9016350),
  ('Natulux',            35.3632832, 33.6722565),
  ('Courtyard Platinum', 35.3261494, 33.9589785),
  ('Querencia Long Beach', 35.2656637, 33.9091918),
  ('Long Beach Panorama', 35.2572000, 33.8945000)
ON CONFLICT (seed_name) DO NOTHING;

-- What is not pinned: public marketing names and Döveç ids only, no user data.
CREATE OR REPLACE FUNCTION public.dovec_coord_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'unmatched', COALESCE((SELECT jsonb_agg(jsonb_build_object('seed', c.seed_name, 'reason', c.last_status) ORDER BY c.seed_name)
                             FROM public.dovec_project_coords c WHERE c.project_id IS NULL), '[]'::jsonb),
    'renamed', COALESCE((SELECT jsonb_agg(jsonb_build_object('seed', c.seed_name, 'project_id', p.id, 'name', p.name) ORDER BY c.seed_name)
                           FROM public.dovec_project_coords c JOIN public.dovec_projects p ON p.id = c.project_id
                          WHERE p.name COLLATE "C" <> c.seed_name COLLATE "C"), '[]'::jsonb),
    'live_without_coords', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) ORDER BY p.name, p.id)
                                       FROM public.dovec_projects p
                                      WHERE p.listed AND (p.latitude IS NULL OR p.longitude IS NULL)), '[]'::jsonb));
$function$;

-- Called by sync-dovec after a good sync. Idempotent. Writes dovec_project_coords (attach + status) and copies latitude /
-- longitude onto dovec_projects for attached ids; it never clears a coordinate and never writes any other project column.
CREATE OR REPLACE FUNCTION public.dovec_sync_coords()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s    record;
  v_n  int;
  v_id text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('dovec_coords:sync', 0));
  FOR s IN SELECT * FROM public.dovec_project_coords ORDER BY seed_name LOOP
    IF s.project_id IS NOT NULL THEN
      UPDATE public.dovec_project_coords c
         SET last_status = CASE WHEN EXISTS (SELECT 1 FROM public.dovec_projects p
                                              WHERE p.id = s.project_id AND p.name COLLATE "C" = s.seed_name COLLATE "C")
                                THEN 'matched' ELSE 'renamed' END
       WHERE c.seed_name = s.seed_name;
    ELSE
      SELECT count(*), min(p.id) INTO v_n, v_id
        FROM public.dovec_projects p WHERE p.listed AND p.name COLLATE "C" = s.seed_name COLLATE "C";
      IF v_n = 0 THEN
        UPDATE public.dovec_project_coords c SET last_status = 'no_match' WHERE c.seed_name = s.seed_name;
      ELSIF v_n > 1 THEN
        UPDATE public.dovec_project_coords c SET last_status = 'ambiguous' WHERE c.seed_name = s.seed_name;
      ELSIF EXISTS (SELECT 1 FROM public.dovec_project_coords c WHERE c.project_id = v_id) THEN
        UPDATE public.dovec_project_coords c SET last_status = 'claimed' WHERE c.seed_name = s.seed_name;
      ELSE
        UPDATE public.dovec_project_coords c SET project_id = v_id, matched_at = now(), last_status = 'matched' WHERE c.seed_name = s.seed_name;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.dovec_projects p SET latitude = c.latitude, longitude = c.longitude
    FROM public.dovec_project_coords c
   WHERE c.project_id = p.id AND (p.latitude IS DISTINCT FROM c.latitude OR p.longitude IS DISTINCT FROM c.longitude);

  RETURN public.dovec_coord_status();
END;
$function$;

REVOKE ALL ON FUNCTION public.dovec_coord_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dovec_sync_coords() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dovec_coord_status() TO service_role;
GRANT EXECUTE ON FUNCTION public.dovec_sync_coords() TO service_role;

-- ─── 3. dovec_leads ────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.dovec_lead_external_seq START 1;

CREATE TABLE IF NOT EXISTS public.dovec_leads (
  id                  bigint      GENERATED ALWAYS AS IDENTITY,
  external_id         text        NOT NULL DEFAULT ('ADA-' || nextval('public.dovec_lead_external_seq')::text),
  user_id             uuid,
  client_request_id   uuid        NOT NULL,
  payload_hash        text        NOT NULL,
  project_id          text,
  project_name        text,
  unit_type           text,
  name                text,
  phone               text,
  email               text,
  message             text,
  language            text        NOT NULL,
  language_code       text        NOT NULL,
  consent             boolean     NOT NULL,
  consent_at          timestamptz NOT NULL DEFAULT now(),
  consent_text_version text       NOT NULL,
  status              text        NOT NULL DEFAULT 'pending',
  attempts            integer     NOT NULL DEFAULT 0,
  last_http_status    integer,
  next_attempt_at     timestamptz,
  sent_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  pii_wiped_at        timestamptz,
  is_test             boolean     NOT NULL DEFAULT false,
  CONSTRAINT dovec_leads_pkey PRIMARY KEY (id),
  CONSTRAINT dovec_leads_external_id_key UNIQUE (external_id),
  CONSTRAINT dovec_leads_request_key UNIQUE (user_id, client_request_id),
  CONSTRAINT dovec_leads_project_fkey FOREIGN KEY (project_id) REFERENCES public.dovec_projects (id),
  CONSTRAINT dovec_leads_external_id_check CHECK ((NOT is_test AND external_id ~ '^ADA-[0-9]+$') OR (is_test AND external_id = 'TEST-1')),
  CONSTRAINT dovec_leads_project_check CHECK (project_id IS NOT NULL OR is_test),
  CONSTRAINT dovec_leads_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT dovec_leads_consent_check CHECK (consent = true),
  CONSTRAINT dovec_leads_consent_version_check CHECK (char_length(consent_text_version) BETWEEN 1 AND 100),
  CONSTRAINT dovec_leads_status_check CHECK (status = ANY (ARRAY['pending','mock','sent','retry','rejected','failed']::text[])),
  CONSTRAINT dovec_leads_language_check CHECK (lower(language) <> ALL (ARRAY['tr','en']::text[]) AND char_length(language) BETWEEN 2 AND 40),
  CONSTRAINT dovec_leads_language_code_check CHECK (language_code ~ '^[a-z]{2}$'),
  CONSTRAINT dovec_leads_attempts_check CHECK (attempts >= 0),
  CONSTRAINT dovec_leads_http_check CHECK (last_http_status IS NULL OR last_http_status BETWEEN 100 AND 599),
  CONSTRAINT dovec_leads_name_check CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT dovec_leads_phone_check CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT dovec_leads_email_check CHECK (email IS NULL OR char_length(email) <= 254),
  CONSTRAINT dovec_leads_message_check CHECK (message IS NULL OR char_length(message) <= 2000),
  CONSTRAINT dovec_leads_unit_type_check CHECK (unit_type IS NULL OR char_length(unit_type) <= 100),
  CONSTRAINT dovec_leads_pii_wiped_check CHECK (pii_wiped_at IS NOT NULL OR (name IS NOT NULL AND phone IS NOT NULL))
);

COMMENT ON TABLE public.dovec_leads IS
  'Enquiries sent to Döveç through the dovec-lead edge function (plus at most one is_test row, external_id TEST-1, no project, excluded from counts and limits). RLS on, ZERO policies, no privilege for anon / authenticated: service role only. user_id has NO foreign key on purpose: an AFTER DELETE trigger on profiles wipes the PII and user_id of a deleted user and keeps the row (counts survive); dovec_leads_wipe_pii() wipes it at 90 days. 20261229.';

CREATE UNIQUE INDEX IF NOT EXISTS dovec_leads_one_test_idx ON public.dovec_leads ((true)) WHERE is_test;
CREATE INDEX IF NOT EXISTS dovec_leads_user_created_idx ON public.dovec_leads (user_id, created_at) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS dovec_leads_created_idx ON public.dovec_leads (created_at);
CREATE INDEX IF NOT EXISTS dovec_leads_due_idx ON public.dovec_leads (status, next_attempt_at) WHERE status IN ('pending', 'retry');

ALTER TABLE public.dovec_leads ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.dovec_leads FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.dovec_leads TO service_role;
REVOKE ALL ON SEQUENCE public.dovec_lead_external_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.dovec_lead_external_seq TO service_role;

-- ─── 3b. Enquiry limits, enforced where the rows are made ───────────────────
-- 3 per person per hour, 10 per person per day, 200 in all per day. One transaction-level advisory lock serialises every
-- insert, so two simultaneous requests cannot both pass the count (a count-then-insert in the edge function could).
-- The edge function maps SQLSTATE DV429 to HTTP 429. Rows whose user_id was wiped still count towards the global limit.
CREATE OR REPLACE FUNCTION public.dovec_leads_enforce_limits()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_test THEN RETURN NEW; END IF;   -- the one agreed test enquiry neither counts against nor is stopped by the limits
  PERFORM pg_advisory_xact_lock(hashtextextended('dovec_leads:insert', 0));
  IF (SELECT count(*) FROM public.dovec_leads WHERE NOT is_test AND created_at >= now() - interval '1 day') >= 200 THEN
    RAISE EXCEPTION 'dovec_rate_limited' USING ERRCODE = 'DV429';
  END IF;
  IF NEW.user_id IS NOT NULL THEN
    IF (SELECT count(*) FROM public.dovec_leads WHERE user_id = NEW.user_id AND NOT is_test AND created_at >= now() - interval '1 hour') >= 3
       OR (SELECT count(*) FROM public.dovec_leads WHERE user_id = NEW.user_id AND NOT is_test AND created_at >= now() - interval '1 day') >= 10 THEN
      RAISE EXCEPTION 'dovec_rate_limited' USING ERRCODE = 'DV429';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.dovec_leads_enforce_limits() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS dovec_leads_rate_limit ON public.dovec_leads;
CREATE TRIGGER dovec_leads_rate_limit BEFORE INSERT ON public.dovec_leads
  FOR EACH ROW EXECUTE FUNCTION public.dovec_leads_enforce_limits();

-- ─── 4. Account deletion: wipe the person, keep the row ────────────────────
CREATE OR REPLACE FUNCTION public.dovec_leads_forget_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.dovec_leads
     SET user_id      = NULL,
         name         = NULL,
         phone        = NULL,
         email        = NULL,
         message      = NULL,
         pii_wiped_at = COALESCE(pii_wiped_at, now()),
         status       = CASE WHEN status = ANY (ARRAY['pending','retry']::text[]) THEN 'failed' ELSE status END
   WHERE user_id = OLD.id;
  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.dovec_leads_forget_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS dovec_leads_forget_user ON public.profiles;
CREATE TRIGGER dovec_leads_forget_user AFTER DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.dovec_leads_forget_user();

-- ─── 5. Retention: 90 days ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dovec_leads_wipe_pii()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  -- A lead still 'retry' / 'pending' after 7 days will never be sent: settle it so the 90-day wipe below covers it.
  UPDATE public.dovec_leads
     SET status = 'failed', next_attempt_at = NULL
   WHERE status = ANY (ARRAY['pending','retry']::text[])
     AND created_at < now() - interval '7 days';

  UPDATE public.dovec_leads
     SET name = NULL, phone = NULL, email = NULL, message = NULL, user_id = NULL,
         pii_wiped_at = now()
   WHERE created_at < now() - interval '90 days'
     AND pii_wiped_at IS NULL
     AND status = ANY (ARRAY['sent','rejected','failed','mock']::text[]);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

REVOKE ALL ON FUNCTION public.dovec_leads_wipe_pii() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dovec_leads_wipe_pii() TO service_role;

-- ─── 6. Admin counts (no personal field) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.dovec_lead_counts()
 RETURNS TABLE (project_id text, project_name text, month date, status text, n bigint)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;
  RETURN QUERY
    SELECT l.project_id, l.project_name,
           date_trunc('month', l.created_at AT TIME ZONE 'Europe/Nicosia')::date,
           l.status, count(*)
      FROM public.dovec_leads l
     WHERE NOT l.is_test
     GROUP BY l.project_id, l.project_name, date_trunc('month', l.created_at AT TIME ZONE 'Europe/Nicosia')::date, l.status
     ORDER BY 3 DESC, 1, 4;
END;
$function$;

-- anon is named in a new function's ACL on Supabase (see 20261033): revoke both.
REVOKE ALL ON FUNCTION public.dovec_lead_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dovec_lead_counts() FROM anon;
GRANT EXECUTE ON FUNCTION public.dovec_lead_counts() TO authenticated;

-- ─── 7. Assertions (they print what they read; no counts of users or leads) ─
DO $$
DECLARE
  v_t        text;
  v_oid      regclass;
  v_n        int;
  v_names    text;
  v_role     text;
  v_priv     text;
BEGIN
  -- 7a. RLS on, owner postgres, and the FULL policy set of every table (permissive policies OR together).
  FOREACH v_t IN ARRAY ARRAY['dovec_settings','dovec_projects','dovec_leads','dovec_project_coords'] LOOP
    v_oid := to_regclass('public.' || v_t);
    IF v_oid IS NULL THEN RAISE EXCEPTION '% is not visible to this block', v_t; END IF;
    IF (SELECT relowner::regrole::text FROM pg_class WHERE oid = v_oid) IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION '% is not owned by postgres (SET ROLE postgres missing?)', v_t;
    END IF;
    IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_oid) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'RLS is not enabled on %', v_t;
    END IF;
    SELECT count(*), coalesce(string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, '+'), ', ' ORDER BY policyname), '(none)')
      INTO v_n, v_names FROM pg_policies WHERE schemaname = 'public' AND tablename = v_t;
    RAISE NOTICE '% policies: % (%)', v_t, v_n, v_names;
    IF v_n IS DISTINCT FROM (CASE WHEN v_t IN ('dovec_leads','dovec_project_coords') THEN 0 ELSE 1 END) THEN
      RAISE EXCEPTION '% carries % policies (%)', v_t, v_n, v_names;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = v_t AND cmd IS DISTINCT FROM 'SELECT') THEN
      RAISE EXCEPTION '% has a non-SELECT policy: no client write path was intended', v_t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = v_t AND permissive IS DISTINCT FROM 'PERMISSIVE') THEN
      RAISE EXCEPTION '% has a restrictive policy: unexpected', v_t;
    END IF;
  END LOOP;

  -- 7b. dovec_leads: no privilege of any kind for anon / authenticated, table or column; service_role keeps its own.
  v_oid := to_regclass('public.dovec_leads');
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(v_role, v_oid, v_priv) THEN RAISE EXCEPTION '% holds % on dovec_leads', v_role, v_priv; END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_oid AND a.attnum > 0 AND NOT a.attisdropped
                AND has_column_privilege(v_role, v_oid, a.attnum, 'SELECT,INSERT,UPDATE,REFERENCES')) THEN
      RAISE EXCEPTION 'a column of dovec_leads is reachable by %', v_role;
    END IF;
    IF has_sequence_privilege(v_role, 'public.dovec_lead_external_seq', 'USAGE,SELECT,UPDATE') THEN
      RAISE EXCEPTION '% can use the lead sequence', v_role;
    END IF;
  END LOOP;
  FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE'] LOOP
    IF NOT has_table_privilege('service_role', v_oid, v_priv) THEN RAISE EXCEPTION 'service_role lost % on dovec_leads', v_priv; END IF;
  END LOOP;
  IF has_table_privilege('service_role', v_oid, 'DELETE') THEN RAISE EXCEPTION 'service_role can DELETE leads: unexpected'; END IF;
  IF NOT has_sequence_privilege('service_role', 'public.dovec_lead_external_seq', 'USAGE') THEN RAISE EXCEPTION 'service_role lost the lead sequence'; END IF;

  -- 7c. dovec_projects / dovec_settings: app roles read only; write columns are the intended ones.
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(v_role, 'public.dovec_projects', v_priv) THEN RAISE EXCEPTION '% holds % on dovec_projects', v_role, v_priv; END IF;
      IF has_table_privilege(v_role, 'public.dovec_settings', v_priv) THEN RAISE EXCEPTION '% holds % on dovec_settings', v_role, v_priv; END IF;
    END LOOP;
    IF NOT has_table_privilege(v_role, 'public.dovec_projects', 'SELECT') THEN RAISE EXCEPTION '% lost SELECT on dovec_projects', v_role; END IF;
    IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.dovec_settings'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                AND has_column_privilege(v_role, 'public.dovec_settings'::regclass, a.attnum, 'INSERT,UPDATE,REFERENCES')) THEN
      RAISE EXCEPTION 'a column of dovec_settings is writable by %', v_role;
    END IF;
    SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO v_names FROM pg_attribute a
     WHERE a.attrelid = 'public.dovec_settings'::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND has_column_privilege(v_role, 'public.dovec_settings'::regclass, a.attnum, 'SELECT');
    RAISE NOTICE 'dovec_settings columns readable by %: %', v_role, v_names;
    IF v_names IS DISTINCT FROM 'id,last_good_sync_at,published,suspended,whatsapp_e164' THEN
      RAISE EXCEPTION 'dovec_settings readable columns for % are %', v_role, v_names;
    END IF;
  END LOOP;
  SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO v_names FROM pg_attribute a
   WHERE a.attrelid = 'public.dovec_settings'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND has_column_privilege('service_role', 'public.dovec_settings'::regclass, a.attnum, 'UPDATE');
  RAISE NOTICE 'dovec_settings columns updatable by service_role: %', v_names;
  IF v_names IS DISTINCT FROM 'last_good_sync_at,last_run_at,last_run_detail,last_run_status,suspended' THEN
    RAISE EXCEPTION 'dovec_settings service_role UPDATE columns are %', v_names;
  END IF;
  IF has_table_privilege('service_role', 'public.dovec_settings', 'INSERT') OR has_table_privilege('service_role', 'public.dovec_settings', 'DELETE')
     OR has_table_privilege('service_role', 'public.dovec_projects', 'DELETE') THEN
    RAISE EXCEPTION 'service_role holds INSERT/DELETE on settings or DELETE on projects';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.dovec_projects', 'INSERT,UPDATE') THEN RAISE EXCEPTION 'service_role cannot write dovec_projects'; END IF;

  -- 7c2. dovec_project_coords: no privilege of any kind for an app role (table or column); service_role may only SELECT.
  v_oid := to_regclass('public.dovec_project_coords');
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_table_privilege(v_role, v_oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_oid AND a.attnum > 0 AND NOT a.attisdropped
                   AND has_column_privilege(v_role, v_oid, a.attnum, 'SELECT,INSERT,UPDATE,REFERENCES')) THEN
      RAISE EXCEPTION '% holds a privilege on dovec_project_coords', v_role;
    END IF;
  END LOOP;
  IF NOT has_table_privilege('service_role', v_oid, 'SELECT') OR has_table_privilege('service_role', v_oid, 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'service_role must SELECT and nothing else on dovec_project_coords';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = v_oid AND a.grantee = 0) THEN
    RAISE EXCEPTION 'dovec_project_coords carries a PUBLIC grant';
  END IF;

  -- 7d. Function grants (aclexplode, so a missing grant reads as absent).
  FOREACH v_t IN ARRAY ARRAY['public.dovec_sync_coords()','public.dovec_coord_status()'] LOOP
    IF to_regprocedure(v_t) IS NULL THEN RAISE EXCEPTION '% is missing', v_t; END IF;
    IF has_function_privilege('anon', v_t, 'EXECUTE') OR has_function_privilege('authenticated', v_t, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = to_regprocedure(v_t) AND a.grantee = 0) THEN
      RAISE EXCEPTION '% is executable by an app role or PUBLIC', v_t;
    END IF;
    IF NOT has_function_privilege('service_role', v_t, 'EXECUTE') THEN RAISE EXCEPTION 'service_role lost EXECUTE on %', v_t; END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.dovec_lead_counts()', 'EXECUTE') THEN RAISE EXCEPTION 'anon can EXECUTE dovec_lead_counts'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.dovec_lead_counts()', 'EXECUTE') THEN RAISE EXCEPTION 'authenticated lost EXECUTE on dovec_lead_counts'; END IF;
  FOREACH v_t IN ARRAY ARRAY['public.dovec_leads_wipe_pii()','public.dovec_leads_forget_user()'] LOOP
    IF has_function_privilege('anon', v_t, 'EXECUTE') OR has_function_privilege('authenticated', v_t, 'EXECUTE') THEN
      RAISE EXCEPTION '% is executable by an app role', v_t;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.dovec_leads_wipe_pii()', 'EXECUTE') THEN RAISE EXCEPTION 'service_role lost the wipe function'; END IF;
  IF NOT (has_function_privilege('anon', 'public.dovec_feed_is_fresh()', 'EXECUTE') AND has_function_privilege('authenticated', 'public.dovec_feed_is_fresh()', 'EXECUTE')) THEN
    RAISE EXCEPTION 'the read policy helper is not executable by an app role: every read would fail';
  END IF;

  -- 7e. The settings row exists exactly once and the go-live gate is closed.
  IF (SELECT count(*) FROM public.dovec_settings) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'dovec_settings must hold exactly one row'; END IF;
  IF (SELECT published FROM public.dovec_settings WHERE id = 1) IS DISTINCT FROM false THEN RAISE EXCEPTION 'dovec_settings.published is not false'; END IF;
  IF (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
       WHERE d.adrelid = 'public.dovec_settings'::regclass AND a.attname = 'published') IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'dovec_settings.published DEFAULT is not false';
  END IF;

  -- 7e2. The WhatsApp line and the five seeded pins are exactly what was agreed (derived from the table, printed).
  IF (SELECT whatsapp_e164 FROM public.dovec_settings WHERE id = 1) IS DISTINCT FROM '+905338880515' THEN
    RAISE EXCEPTION 'dovec_settings.whatsapp_e164 is not the agreed sales line';
  END IF;
  SELECT count(*), string_agg(seed_name, ', ' ORDER BY seed_name) INTO v_n, v_names FROM public.dovec_project_coords;
  RAISE NOTICE 'dovec_project_coords seeds: % (%)', v_n, v_names;
  IF v_n IS DISTINCT FROM 5 OR (SELECT count(*) FROM public.dovec_project_coords c JOIN (VALUES
       ('D-Point', 35.2695453, 33.901635), ('Natulux', 35.3632832, 33.6722565), ('Courtyard Platinum', 35.3261494, 33.9589785),
       ('Querencia Long Beach', 35.2656637, 33.9091918), ('Long Beach Panorama', 35.2572, 33.8945)) e(n, la, lo)
       ON e.n = c.seed_name AND e.la = c.latitude AND e.lo = c.longitude) IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'dovec_project_coords is not exactly the five agreed pins';
  END IF;

  -- 7f. No foreign key from dovec_leads to anything that account deletion touches (only the project FK exists).
  SELECT string_agg(conname || '->' || confrelid::regclass::text, ', ') INTO v_names
    FROM pg_constraint WHERE conrelid = 'public.dovec_leads'::regclass AND contype = 'f';
  RAISE NOTICE 'dovec_leads foreign keys: %', v_names;
  IF v_names IS DISTINCT FROM 'dovec_leads_project_fkey->dovec_projects' THEN RAISE EXCEPTION 'dovec_leads foreign keys are %', v_names; END IF;

  -- 7g0. The limit trigger: one BEFORE INSERT row trigger on dovec_leads, function not executable by an app role.
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.dovec_leads'::regclass AND tgname = 'dovec_leads_rate_limit' AND NOT tgisinternal) IS DISTINCT FROM 1
     OR (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'public.dovec_leads'::regclass AND tgname = 'dovec_leads_rate_limit')
        NOT LIKE '%BEFORE INSERT ON public.dovec_leads FOR EACH ROW EXECUTE FUNCTION dovec_leads_enforce_limits()%' THEN
    RAISE EXCEPTION 'dovec_leads_rate_limit trigger missing or wrong';
  END IF;
  IF has_function_privilege('anon', 'public.dovec_leads_enforce_limits()', 'EXECUTE') OR has_function_privilege('authenticated', 'public.dovec_leads_enforce_limits()', 'EXECUTE') THEN
    RAISE EXCEPTION 'dovec_leads_enforce_limits is executable by an app role';
  END IF;

  -- 7g. The deletion trigger exists, is a row trigger AFTER DELETE on profiles, and its function wipes user_id and the four PII columns.
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'dovec_leads_forget_user' AND NOT tgisinternal) IS DISTINCT FROM 1
     OR (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'dovec_leads_forget_user')
        NOT LIKE '%AFTER DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION dovec_leads_forget_user()%' THEN
    RAISE EXCEPTION 'dovec_leads_forget_user trigger missing or wrong: %', (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'dovec_leads_forget_user' LIMIT 1);
  END IF;
  IF pg_get_functiondef(to_regprocedure('public.dovec_leads_forget_user()')) NOT LIKE '%SET user_id      = NULL,%'
     OR pg_get_functiondef(to_regprocedure('public.dovec_leads_forget_user()')) NOT LIKE '%message      = NULL,%' THEN
    RAISE EXCEPTION 'dovec_leads_forget_user no longer wipes user_id / PII';
  END IF;
END $$;

-- 7h. Behaviour, measured as the roles that matter. Rows are made inside a block that ends in a deliberate
--     exception, so nothing it inserts survives and the settings row is left exactly as it was found.
--     Every denial has a positive control beside it.
DO $$
DECLARE
  v_admin    uuid;
  v_probe    text := 'zz-probe-project';
  v_seen     int;
  v_fresh    int := -1;
  v_stale    int := -1;
  v_susp     int := -1;
  v_unlisted int := -1;
  v_leads    text := 'unset';
  v_leads_c  text := 'unset';
  v_svc_ok   int := -1;
  v_dup      text := 'unset';
  v_consent  text := 'unset';
  v_ext      text;
  v_denied   boolean := false;
  v_cnt      int := -1;
  v_sets_w   text := 'unset';
  v_projs_w  text := 'unset';
  v_wipe     int := -1;
  v_pii_left int := -1;
BEGIN
  SELECT id INTO v_admin FROM public.profiles WHERE role = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'no admin profile to run the positive control with'; END IF;

  BEGIN
    UPDATE public.dovec_settings SET suspended = false, last_good_sync_at = now() WHERE id = 1;
    INSERT INTO public.dovec_projects (id, name, city, status, website_url) VALUES (v_probe, 'Probe', 'Probe city', 'on_sale', 'https://example.com/p');

    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_fresh FROM public.dovec_projects WHERE id = v_probe;          -- positive control: visible while fresh
    RESET ROLE;
    UPDATE public.dovec_settings SET last_good_sync_at = now() - interval '25 hours' WHERE id = 1;
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_stale FROM public.dovec_projects WHERE id = v_probe;
    RESET ROLE;
    UPDATE public.dovec_settings SET last_good_sync_at = now(), suspended = true WHERE id = 1;
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_susp FROM public.dovec_projects WHERE id = v_probe;
    RESET ROLE;
    UPDATE public.dovec_settings SET suspended = false WHERE id = 1;
    UPDATE public.dovec_projects SET listed = false, delisted_at = now() WHERE id = v_probe;
    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_unlisted FROM public.dovec_projects WHERE id = v_probe;
    RESET ROLE;
    UPDATE public.dovec_projects SET listed = true, delisted_at = NULL WHERE id = v_probe;

    -- app roles cannot write projects or settings
    SET LOCAL ROLE authenticated;
    BEGIN UPDATE public.dovec_projects SET name = 'x' WHERE id = v_probe; GET DIAGNOSTICS v_seen = ROW_COUNT; v_projs_w := 'ALLOWED(' || v_seen || ')';
    EXCEPTION WHEN insufficient_privilege THEN v_projs_w := 'denied'; END;
    BEGIN UPDATE public.dovec_settings SET published = true; v_sets_w := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_sets_w := 'denied'; END;
    RESET ROLE;

    -- leads: closed to anon and authenticated, open to the service role
    SET LOCAL ROLE anon;
    BEGIN PERFORM 1 FROM public.dovec_leads LIMIT 1; v_leads := 'ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN v_leads := 'denied'; END;
    RESET ROLE;
    SET LOCAL ROLE authenticated;
    BEGIN PERFORM 1 FROM public.dovec_leads LIMIT 1; v_leads_c := 'ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN v_leads_c := 'denied'; END;
    RESET ROLE;

    SET LOCAL ROLE service_role;
    INSERT INTO public.dovec_leads (user_id, client_request_id, payload_hash, project_id, project_name, name, phone, language, language_code, consent, consent_text_version, status)
    VALUES (v_admin, '00000000-0000-4000-8000-0000000000f1', repeat('a', 64), v_probe, 'Probe', 'Probe Person', '+441234567890', 'English', 'en', true, 'probe', 'sent')
    RETURNING external_id INTO v_ext;
    SELECT count(*) INTO v_svc_ok FROM public.dovec_leads WHERE external_id = v_ext;      -- positive control for the two denials above
    BEGIN
      INSERT INTO public.dovec_leads (user_id, client_request_id, payload_hash, project_id, name, phone, language, language_code, consent, consent_text_version)
      VALUES (v_admin, '00000000-0000-4000-8000-0000000000f1', repeat('b', 64), v_probe, 'Probe Person', '+441234567890', 'English', 'en', true, 'probe');
      v_dup := 'ACCEPTED';
    EXCEPTION WHEN unique_violation THEN v_dup := 'rejected'; END;
    BEGIN
      INSERT INTO public.dovec_leads (user_id, client_request_id, payload_hash, project_id, name, phone, language, language_code, consent, consent_text_version)
      VALUES (v_admin, '00000000-0000-4000-8000-0000000000f2', repeat('b', 64), v_probe, 'Probe Person', '+441234567890', 'English', 'en', false, 'probe');
      v_consent := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_consent := 'rejected'; END;
    RESET ROLE;

    -- admin counts: a non-admin is refused, the admin gets the probe row, with no personal column in the result
    PERFORM set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000aa","role":"authenticated"}', true);
    SET LOCAL ROLE authenticated;
    BEGIN PERFORM public.dovec_lead_counts(); EXCEPTION WHEN raise_exception THEN v_denied := SQLERRM = 'ADMIN_ONLY'; END;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT coalesce(sum(c.n), 0) INTO v_cnt FROM public.dovec_lead_counts() c WHERE c.project_id = v_probe;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);

    -- retention: an old final lead is wiped (and loses user_id), a young one is not
    UPDATE public.dovec_leads SET created_at = now() - interval '91 days' WHERE external_id = v_ext;
    INSERT INTO public.dovec_leads (user_id, client_request_id, payload_hash, project_id, name, phone, language, language_code, consent, consent_text_version, status, created_at)
    VALUES (v_admin, '00000000-0000-4000-8000-0000000000f3', repeat('c', 64), v_probe, 'Young Person', '+441234567891', 'English', 'en', true, 'probe', 'retry', now() - interval '2 days');
    SELECT public.dovec_leads_wipe_pii() INTO v_wipe;
    SELECT count(*) INTO v_pii_left FROM public.dovec_leads WHERE project_id = v_probe AND name IS NOT NULL;

    RAISE EXCEPTION 'probe_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'probe_rollback' THEN RAISE; END IF;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);

  RAISE NOTICE 'read path as anon/authenticated: fresh=%, 25h stale=%, suspended=%, unlisted=%', v_fresh, v_stale, v_susp, v_unlisted;
  RAISE NOTICE 'writes by app roles: projects=%, settings=%; leads read: anon=%, authenticated=%; service_role sees its row=%; dup request=%; consent=false=%',
    v_projs_w, v_sets_w, v_leads, v_leads_c, v_svc_ok, v_dup, v_consent;
  IF v_fresh IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'positive control failed: a fresh listed project is not readable (fresh=%)', v_fresh; END IF;
  IF v_stale IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'a project stayed readable 25 hours after the last good sync'; END IF;
  IF v_susp IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'a project stayed readable while suspended'; END IF;
  IF v_unlisted IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'a delisted project stayed readable'; END IF;
  IF v_projs_w IS DISTINCT FROM 'denied' OR v_sets_w IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'an app role could write projects or settings'; END IF;
  IF v_svc_ok IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'positive control failed: service_role cannot read back its own lead'; END IF;
  IF v_leads IS DISTINCT FROM 'denied' OR v_leads_c IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'an app role could read dovec_leads'; END IF;
  IF v_dup IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'the same (user, client_request_id) was accepted twice'; END IF;
  IF v_consent IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'a lead without consent was accepted'; END IF;
  IF v_ext IS NULL OR v_ext !~ '^ADA-[0-9]+$' THEN RAISE EXCEPTION 'external_id was not generated server-side in the ADA-n shape'; END IF;
  IF NOT v_denied THEN RAISE EXCEPTION 'a non-admin was not refused with ADMIN_ONLY'; END IF;
  IF v_cnt IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'positive control failed: the admin did not see the probe lead in the counts (%)', v_cnt; END IF;
  IF v_wipe IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'the wipe touched % rows, expected exactly the one old final lead', v_wipe; END IF;
  IF v_pii_left IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'expected the young / still-retrying lead to keep its PII (left=%)', v_pii_left; END IF;
  IF (SELECT count(*) FROM public.dovec_projects WHERE id = v_probe) IS DISTINCT FROM 0
     OR (SELECT count(*) FROM public.dovec_leads WHERE project_id = v_probe) IS DISTINCT FROM 0
     OR (SELECT last_good_sync_at FROM public.dovec_settings WHERE id = 1) IS NOT NULL THEN
    RAISE EXCEPTION 'the probe left rows or a settings change behind';
  END IF;
  RAISE NOTICE 'dovec: read path hides stale / suspended / delisted, leads closed to app roles, wipe works, probe rolled back';
END $$;

-- 7i. Pins and the test enquiry, measured as the roles that matter, in a block that ends in a deliberate exception.
DO $$
DECLARE
  v_anon  text := 'unset';
  v_att   int  := -1;
  v_lat   numeric;
  v_near  text;
  v_stat  jsonb;
  v_t1    text := 'skipped';
  v_dup   text := 'unset';
  v_t2    text := 'unset';
  v_nt    text := 'unset';
  v_np    text := 'unset';
  v_skip  boolean := EXISTS (SELECT 1 FROM public.dovec_leads WHERE is_test);
BEGIN
  BEGIN
    INSERT INTO public.dovec_projects (id, name, city, status, website_url) VALUES
      ('zz-coord-1', 'D-Point', 'Probe city', 'on_sale', 'https://example.com/c1'),
      ('zz-coord-2', 'natulux', 'Probe city', 'on_sale', 'https://example.com/c2');
    SET LOCAL ROLE anon;
    BEGIN PERFORM public.dovec_sync_coords(); v_anon := 'ALLOWED'; EXCEPTION WHEN insufficient_privilege THEN v_anon := 'denied'; END;
    RESET ROLE;
    SET LOCAL ROLE service_role;
    v_stat := public.dovec_sync_coords();                                              -- positive control for the denial above
    RESET ROLE;
    SELECT latitude INTO v_lat FROM public.dovec_projects WHERE id = 'zz-coord-1';
    SELECT count(*) INTO v_att FROM public.dovec_project_coords WHERE seed_name = 'D-Point' AND project_id = 'zz-coord-1' AND last_status = 'matched';
    SELECT last_status INTO v_near FROM public.dovec_project_coords WHERE seed_name = 'Natulux';

    IF NOT v_skip THEN
      SET LOCAL ROLE service_role;
      -- first, while no test row exists, so only the CHECK can refuse it (not the one-row index)
      BEGIN
        INSERT INTO public.dovec_leads (client_request_id, payload_hash, name, phone, language, language_code, consent, consent_text_version, status, external_id, is_test)
        VALUES (gen_random_uuid(), repeat('a', 64), 'ADA TEST', '+441234567890', 'Turkish', 'tr', true, 'probe', 'pending', 'TEST-2', true);
        v_t2 := 'ACCEPTED';
      EXCEPTION WHEN check_violation THEN v_t2 := 'rejected'; END;
      IF v_t2 IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'external id TEST-2 was accepted'; END IF;
      -- before the real TEST-1 exists, so only the CHECK can refuse it (not the unique external_id)
      BEGIN
        INSERT INTO public.dovec_leads (client_request_id, payload_hash, project_id, name, phone, language, language_code, consent, consent_text_version, status, external_id)
        VALUES (gen_random_uuid(), repeat('a', 64), 'zz-coord-1', 'Probe Person', '+441234567890', 'English', 'en', true, 'probe', 'pending', 'TEST-1');
        v_nt := 'ACCEPTED';
      EXCEPTION WHEN check_violation THEN v_nt := 'rejected'; END;
      IF v_nt IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'TEST-1 was accepted on a row that is not is_test'; END IF;
      INSERT INTO public.dovec_leads (client_request_id, payload_hash, name, phone, language, language_code, consent, consent_text_version, status, external_id, is_test)
      VALUES (gen_random_uuid(), repeat('a', 64), 'ADA TEST', '+441234567890', 'Turkish', 'tr', true, 'probe', 'pending', 'TEST-1', true);
      v_t1 := 'accepted';
      BEGIN
        INSERT INTO public.dovec_leads (client_request_id, payload_hash, name, phone, language, language_code, consent, consent_text_version, status, external_id, is_test)
        VALUES (gen_random_uuid(), repeat('a', 64), 'ADA TEST', '+441234567890', 'Turkish', 'tr', true, 'probe', 'pending', 'TEST-1', true);
        v_dup := 'ACCEPTED';
      EXCEPTION WHEN unique_violation THEN v_dup := 'rejected'; END;
      BEGIN
        INSERT INTO public.dovec_leads (client_request_id, payload_hash, name, phone, language, language_code, consent, consent_text_version, status)
        VALUES (gen_random_uuid(), repeat('a', 64), 'Probe Person', '+441234567890', 'English', 'en', true, 'probe', 'pending');
        v_np := 'ACCEPTED';
      EXCEPTION WHEN check_violation THEN v_np := 'rejected'; END;
      RESET ROLE;
    END IF;
    RAISE EXCEPTION 'probe_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'probe_rollback' THEN RAISE; END IF;
  END;
  RESET ROLE;

  RAISE NOTICE 'pins: anon exec=%, exact name attached=%, near-miss status=%; test enquiry: first=%, second=%, TEST-2=%, TEST-1 without is_test=%, no project without is_test=%',
    v_anon, v_att, v_near, v_t1, v_dup, v_t2, v_nt, v_np;
  IF v_anon IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'an app role could run dovec_sync_coords'; END IF;
  IF v_att IS DISTINCT FROM 1 OR v_lat IS DISTINCT FROM 35.2695453 THEN RAISE EXCEPTION 'positive control failed: an exact-name project was not pinned (att=%, lat=%)', v_att, v_lat; END IF;
  IF v_near IS DISTINCT FROM 'no_match' THEN RAISE EXCEPTION 'a lower-case near-miss was attached or mis-reported (%)', v_near; END IF;
  IF jsonb_typeof(v_stat -> 'unmatched') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'dovec_coord_status has no unmatched list'; END IF;
  IF NOT v_skip THEN
    IF v_t1 IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'positive control failed: the test enquiry shape was not accepted'; END IF;
    IF v_dup IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'a second test enquiry was accepted'; END IF;
    IF v_t2 IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'external id TEST-2 was accepted'; END IF;
    IF v_nt IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'TEST-1 was accepted on a row that is not is_test'; END IF;
    IF v_np IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'a non-test enquiry without a project was accepted'; END IF;
  END IF;
  IF (SELECT count(*) FROM public.dovec_projects WHERE id LIKE 'zz-coord-%') IS DISTINCT FROM 0
     OR (SELECT count(*) FROM public.dovec_project_coords WHERE project_id LIKE 'zz-coord-%') IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'the pin probe left rows behind';
  END IF;
END $$;

-- ─── 5. contact_events: module 'dovec' (WhatsApp taps on the thank-you screen) ───
-- contact_events.entity_id is uuid and dovec_projects.id is Döveç's text id, so each project carries its own
-- entity_uuid (above): generated here, never written by sync-dovec (its upsert does not name the column), readable
-- through the existing dovec_projects_read policy and SELECT grant. The tap is the existing anonymous
-- contact_events insert (ce_insert_public); nothing about who may read or write contact_events changes
-- (insert: anon + authenticated; select: admins only; update/delete: nobody).
--
-- SOURCE OF THE LIST: 20261225_contact_events_news.sql (18 modules). The live pg_get_constraintdef is the authority:
-- the file REFUSES if the live CHECK holds a module outside the 18 (+ dovec) or lacks one of the 18. Re-runnable.
-- The list is static on purpose: scripts/audit-schema-drift.mjs reads CHECK literals from this file.
DO $$
DECLARE
  v_def   text;
  v_live  text[];
  v_want  text[] := ARRAY['accommodation','events','explore','garages','grooming','homeServices','hotels',
                          'insurance','jobs','pets','studentHub','towing','transport','ehliyet','connectivity','eatery','cars','news'];
  v_extra text[];
  v_miss  text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = to_regclass('public.contact_events') AND conname = 'contact_events_module_check';
  IF v_def IS NULL THEN RAISE EXCEPTION 'contact_events_module_check does not exist'; END IF;
  RAISE NOTICE 'contact_events_module_check before: %', v_def;
  SELECT coalesce(array_agg(DISTINCT m[1]), ARRAY[]::text[]) INTO v_live
    FROM regexp_matches(v_def, '''([^'']+)''::text', 'g') AS m;
  SELECT coalesce(array_agg(x ORDER BY x), ARRAY[]::text[]) INTO v_extra
    FROM unnest(v_live) x WHERE x <> 'dovec' AND x <> ALL (v_want);
  IF cardinality(v_extra) > 0 THEN
    RAISE EXCEPTION 'REFUSING: the live CHECK has modules this file would drop: %. def=%', v_extra, v_def;
  END IF;
  SELECT coalesce(array_agg(x ORDER BY x), ARRAY[]::text[]) INTO v_miss
    FROM unnest(v_want) x WHERE x <> ALL (v_live);
  IF cardinality(v_miss) > 0 THEN
    RAISE EXCEPTION 'REFUSING: the live CHECK lacks modules this file re-adds: %. def=%', v_miss, v_def;
  END IF;
  IF position('''whatsapp''' in coalesce((SELECT pg_get_constraintdef(oid) FROM pg_constraint
        WHERE conrelid = to_regclass('public.contact_events') AND conname = 'contact_events_action_check'), '')) = 0 THEN
    RAISE EXCEPTION 'contact_events_action_check does not accept whatsapp';
  END IF;
END $$;

ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_module_check;
ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_module_check
  CHECK (module IN ('accommodation','events','explore','garages','grooming','homeServices','hotels',
                    'insurance','jobs','pets','studentHub','towing','transport','ehliyet','connectivity','eatery','cars','news','dovec'));

DO $$
DECLARE
  v_def   text;
  v_live  text[];
  v_probe uuid := '00000000-0000-4000-8000-0000000071e6';
  v_role  text;
  v_bogus text := 'unset';
  v_n     int;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = to_regclass('public.contact_events') AND conname = 'contact_events_module_check';
  SELECT coalesce(array_agg(DISTINCT m[1]), ARRAY[]::text[]) INTO v_live
    FROM regexp_matches(coalesce(v_def, ''), '''([^'']+)''::text', 'g') AS m;
  IF cardinality(v_live) IS DISTINCT FROM 19 OR position('''dovec''' in coalesce(v_def, '')) = 0 THEN
    RAISE EXCEPTION 'contact_events_module_check post-state is not the 18 + dovec. def=%', v_def;
  END IF;
  RAISE NOTICE 'contact_events_module_check after: %', v_def;

  IF EXISTS (SELECT 1 FROM public.contact_events WHERE id = v_probe OR entity_id = v_probe) THEN
    RAISE EXCEPTION 'a probe row already exists before the test';
  END IF;
  SET LOCAL ROLE anon;
  v_role := current_user;
  INSERT INTO public.contact_events (id, module, entity_id, action, region, lang)
  VALUES (v_probe, 'dovec', v_probe, 'whatsapp', NULL, 'Turkish');
  BEGIN
    INSERT INTO public.contact_events (module, entity_id, action, region)
    VALUES ('not_a_real_module', v_probe, 'whatsapp', NULL);
    v_bogus := 'ACCEPTED';
  EXCEPTION WHEN check_violation THEN v_bogus := 'rejected';
  END;
  RESET ROLE;
  IF v_role IS DISTINCT FROM 'anon' THEN RAISE EXCEPTION 'probe did not run as anon (ran as %)', v_role; END IF;
  IF v_bogus IS DISTINCT FROM 'rejected' THEN RAISE EXCEPTION 'CONTROL FAILED: a bogus module was %', v_bogus; END IF;
  SELECT count(*) INTO v_n FROM public.contact_events
   WHERE id = v_probe AND module = 'dovec' AND action = 'whatsapp' AND lang = 'Turkish';
  IF v_n IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'the dovec probe row was not stored exactly once (found %)', v_n; END IF;
  DELETE FROM public.contact_events WHERE id = v_probe OR entity_id = v_probe;
  IF EXISTS (SELECT 1 FROM public.contact_events WHERE id = v_probe OR entity_id = v_probe) THEN
    RAISE EXCEPTION 'probe rows survived the cleanup';
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
VALUES ('20261229_dovec_projects.sql', '0550d478e1279be063b1230233b24624e3aa2523d9f77e2cf45cf73538503f47')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

NOTIFY pgrst, 'reload schema';

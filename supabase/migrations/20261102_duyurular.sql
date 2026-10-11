-- ═══════════════════════════════════════════════════════════════════════════
-- 20261102 — Duyurular: official TRNC announcements (sources + items), DARK
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Plan: vault 10-ada/2026-10-10_duyurular-plan.md (approved 2026-10-10, deadline option C).
-- Writer: scripts/fetch-duyurular.mjs in the `duyurular-fetch` workflow (service_role).
-- Source DEFINITIONS live in scripts/duyurular/sources.mjs; the fetcher upserts them by `key`
-- and writes only the health columns here. The app never writes either table.
--
-- ─── WHO CAN READ / WRITE ───────────────────────────────────────────────────
--   • announcements, READ: anyone using the app (anon, signed-in, guest) sees a row only
--     while it is published (is_published) and not expired (expires_at > now()). Unpublished
--     and expired rows are invisible to every client role. Public institutional notices;
--     we store title, a short excerpt and the official link, never a body or a PDF.
--   • announcement_sources: NO client access at all (RLS on, no policy, no grant). It holds
--     operational state (last_error, failure counts).
--   • WRITE, both tables: service_role only (the fetcher in GitHub Actions).
--
-- ─── PUBLISHING IS A SEPARATE SWITCH FROM THE MODULE FLAG ───────────────────
-- announcement_sources.publish (DEFAULT false) is copied into announcements.is_published at
-- insert. The fetcher's config upsert never writes `publish`, so activation is one UPDATE
-- (SOP step 3), done before the device spot-check (step 4), independent of MODULE_FLAGS:
--   UPDATE announcement_sources SET publish = true;
--   UPDATE announcements SET is_published = true WHERE expires_at > now();
--
-- ─── EXPIRY ─────────────────────────────────────────────────────────────────
-- expires_at is written by the fetcher at insert: deadline_at + 30 days, else
-- published_at + 60 days. A plain column (a generated column cannot read now()); the policy
-- compares it to now().
--
-- Apply: gh workflow run supabase-migrate -f file=20261102_duyurular.sql (dry), then
-- -f apply=true. New tables ⇒ ends with NOTIFY pgrst (after COMMIT).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── announcement_sources ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.announcement_sources (
  id                    bigint      GENERATED ALWAYS AS IDENTITY,
  key                   text        NOT NULL,
  name                  text        NOT NULL,
  institution           text        NOT NULL,
  url                   text        NOT NULL,
  type                  text        NOT NULL,
  parser                text        NOT NULL,
  category              text        NOT NULL,
  region                text        NOT NULL DEFAULT 'all',
  filter_mode           text        NOT NULL DEFAULT 'keywords',
  fetch_interval_min    int         NOT NULL DEFAULT 180,
  crawl_delay_s         int         NOT NULL DEFAULT 2,
  active                boolean     NOT NULL DEFAULT true,
  publish               boolean     NOT NULL DEFAULT false,
  etag                  text,
  last_modified         text,
  last_fetch_at         timestamptz,
  last_ok_at            timestamptz,
  consecutive_failures  int         NOT NULL DEFAULT 0,
  last_error            text,
  last_item_count       int,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcement_sources_pkey PRIMARY KEY (id)
);
ALTER TABLE public.announcement_sources DROP CONSTRAINT IF EXISTS announcement_sources_key_key;
ALTER TABLE public.announcement_sources ADD  CONSTRAINT announcement_sources_key_key UNIQUE (key);
ALTER TABLE public.announcement_sources DROP CONSTRAINT IF EXISTS announcement_sources_key_check;
ALTER TABLE public.announcement_sources ADD  CONSTRAINT announcement_sources_key_check CHECK (key ~ '^[a-z0-9][a-z0-9-]{1,59}$');
ALTER TABLE public.announcement_sources DROP CONSTRAINT IF EXISTS announcement_sources_url_check;
ALTER TABLE public.announcement_sources ADD  CONSTRAINT announcement_sources_url_check CHECK (url ~ '^https?://');
ALTER TABLE public.announcement_sources DROP CONSTRAINT IF EXISTS announcement_sources_type_check;
ALTER TABLE public.announcement_sources ADD  CONSTRAINT announcement_sources_type_check CHECK (type IN ('rss','html','json','ted'));
ALTER TABLE public.announcement_sources DROP CONSTRAINT IF EXISTS announcement_sources_category_check;
ALTER TABLE public.announcement_sources ADD  CONSTRAINT announcement_sources_category_check
  CHECK (category IN ('kamu','egitim','kesinti','ihale','belediye','destek','ulasim'));
ALTER TABLE public.announcement_sources DROP CONSTRAINT IF EXISTS announcement_sources_region_check;
ALTER TABLE public.announcement_sources ADD  CONSTRAINT announcement_sources_region_check
  CHECK (region IN ('all','lefkosa','girne','gazimagusa','guzelyurt','iskele','lefke'));
ALTER TABLE public.announcement_sources DROP CONSTRAINT IF EXISTS announcement_sources_filter_mode_check;
ALTER TABLE public.announcement_sources ADD  CONSTRAINT announcement_sources_filter_mode_check CHECK (filter_mode IN ('all','keywords'));
ALTER TABLE public.announcement_sources DROP CONSTRAINT IF EXISTS announcement_sources_numbers_check;
ALTER TABLE public.announcement_sources ADD  CONSTRAINT announcement_sources_numbers_check
  CHECK (fetch_interval_min BETWEEN 15 AND 10080 AND crawl_delay_s BETWEEN 0 AND 60 AND consecutive_failures >= 0);
ALTER TABLE public.announcement_sources DROP CONSTRAINT IF EXISTS announcement_sources_error_check;
ALTER TABLE public.announcement_sources ADD  CONSTRAINT announcement_sources_error_check CHECK (last_error IS NULL OR length(last_error) <= 500);

-- ─── announcements ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.announcements (
  id               bigint      GENERATED ALWAYS AS IDENTITY,
  source_id        bigint      NOT NULL REFERENCES public.announcement_sources (id) ON DELETE CASCADE,
  title            text        NOT NULL,
  title_key        text        NOT NULL,
  excerpt          text,
  official_url     text        NOT NULL,
  institution      text        NOT NULL,
  category         text        NOT NULL,
  region           text        NOT NULL DEFAULT 'all',
  kind             text        NOT NULL DEFAULT 'info',
  published_at     timestamptz NOT NULL,
  deadline_at      timestamptz,
  deadline_source  text,
  expires_at       timestamptz NOT NULL,
  is_published     boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcements_pkey PRIMARY KEY (id)
);
ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_official_url_key;
ALTER TABLE public.announcements ADD  CONSTRAINT announcements_official_url_key UNIQUE (official_url);
ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_url_check;
ALTER TABLE public.announcements ADD  CONSTRAINT announcements_url_check CHECK (official_url ~ '^https?://');
ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_text_check;
ALTER TABLE public.announcements ADD  CONSTRAINT announcements_text_check
  CHECK (length(btrim(title)) BETWEEN 3 AND 400 AND (excerpt IS NULL OR length(excerpt) <= 300)
         AND length(btrim(institution)) BETWEEN 2 AND 160);
ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_category_check;
ALTER TABLE public.announcements ADD  CONSTRAINT announcements_category_check
  CHECK (category IN ('kamu','egitim','kesinti','ihale','belediye','destek','ulasim'));
ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_region_check;
ALTER TABLE public.announcements ADD  CONSTRAINT announcements_region_check
  CHECK (region IN ('all','lefkosa','girne','gazimagusa','guzelyurt','iskele','lefke'));
ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_kind_check;
ALTER TABLE public.announcements ADD  CONSTRAINT announcements_kind_check CHECK (kind IN ('open','result','info'));
-- A deadline always says where it came from, and a source label never stands alone.
ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_deadline_check;
ALTER TABLE public.announcements ADD  CONSTRAINT announcements_deadline_check
  CHECK ((deadline_at IS NULL) = (deadline_source IS NULL)
         AND (deadline_source IS NULL OR deadline_source IN ('feed','page','pdf','api')));
ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_expiry_check;
ALTER TABLE public.announcements ADD  CONSTRAINT announcements_expiry_check CHECK (expires_at > published_at);

CREATE INDEX IF NOT EXISTS announcements_list_idx     ON public.announcements (published_at DESC) WHERE is_published;
CREATE INDEX IF NOT EXISTS announcements_deadline_idx ON public.announcements (deadline_at) WHERE deadline_at IS NOT NULL AND is_published;
CREATE INDEX IF NOT EXISTS announcements_title_key_idx ON public.announcements (title_key);
CREATE INDEX IF NOT EXISTS announcements_source_idx   ON public.announcements (source_id);

-- ─── RLS and grants ─────────────────────────────────────────────────────────
ALTER TABLE public.announcement_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements        ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.announcement_sources, public.announcements FROM anon, authenticated;
GRANT SELECT ON TABLE public.announcements TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.announcement_sources, public.announcements TO service_role;

DROP POLICY IF EXISTS announcements_select_published ON public.announcements;
CREATE POLICY announcements_select_published ON public.announcements
  FOR SELECT TO anon, authenticated
  USING (is_published AND expires_at > now());

-- ─── Assertions (inside the transaction; a failure rolls the file back) ─────
DO $$
DECLARE
  v_policies   text;
  v_n_ann      int;
  v_n_src      int;
  v_src        bigint;
  v_anon_live  int;
  v_anon_all   int;
  v_auth_live  int;
  v_anon_write text := 'not run';
  v_anon_src   text := 'not run';
  v_auth_src   text := 'not run';
  v_auth_write text := 'not run';
  v_bad_cat    text := 'not run';
  v_bad_dl     text := 'not run';
BEGIN
  -- The FULL policy set on both tables, printed: presence of mine never proves absence of others.
  SELECT count(*) FILTER (WHERE tablename = 'announcements'),
         count(*) FILTER (WHERE tablename = 'announcement_sources'),
         string_agg(tablename || '.' || policyname || ' ' || cmd || ' ' || array_to_string(roles, ','), '; ' ORDER BY tablename, policyname)
    INTO v_n_ann, v_n_src, v_policies
    FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('announcements','announcement_sources');
  IF v_n_ann IS DISTINCT FROM 1 OR v_n_src IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'policy set: announcements % (want 1), announcement_sources % (want 0): %', v_n_ann, v_n_src, v_policies;
  END IF;

  BEGIN
    INSERT INTO public.announcement_sources (key, name, institution, url, type, parser, category)
    VALUES ('zz-probe', 'zz probe', 'zz probe', 'https://example.invalid/', 'rss', 'rss', 'kamu')
    RETURNING id INTO v_src;
    INSERT INTO public.announcements (source_id, title, title_key, official_url, institution, category, published_at, expires_at, is_published)
    VALUES (v_src, 'zz live',        'zz live',        'https://example.invalid/1', 'zz', 'kamu', now() - interval '1 day',  now() + interval '1 day',  true),
           (v_src, 'zz unpublished', 'zz unpublished', 'https://example.invalid/2', 'zz', 'kamu', now() - interval '1 day',  now() + interval '1 day',  false),
           (v_src, 'zz expired',     'zz expired',     'https://example.invalid/3', 'zz', 'kamu', now() - interval '90 day', now() - interval '1 day',  true);

    SET LOCAL ROLE anon;
    SELECT count(*) INTO v_anon_live FROM public.announcements WHERE title LIKE 'zz %';
    BEGIN
      INSERT INTO public.announcements (source_id, title, title_key, official_url, institution, category, published_at, expires_at)
      VALUES (v_src, 'zz anon', 'zz anon', 'https://example.invalid/4', 'zz', 'kamu', now(), now() + interval '1 day');
      v_anon_write := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_anon_write := 'denied';
    END;
    BEGIN
      PERFORM 1 FROM public.announcement_sources LIMIT 1;
      v_anon_src := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_anon_src := 'denied';
    END;
    RESET ROLE;

    -- authenticated covers every signed-in user AND every guest.
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
    SELECT count(*) INTO v_auth_live FROM public.announcements WHERE title LIKE 'zz %';
    BEGIN
      UPDATE public.announcements SET title = 'zz hijack' WHERE title = 'zz live';
      v_auth_write := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_auth_write := 'denied';
    END;
    BEGIN
      PERFORM 1 FROM public.announcement_sources LIMIT 1;
      v_auth_src := 'ALLOWED';
    EXCEPTION WHEN insufficient_privilege THEN v_auth_src := 'denied';
    END;
    PERFORM set_config('request.jwt.claims', '', true);
    RESET ROLE;

    -- Control: the owner sees all three probe rows, so a 1 above is the policy, not an empty table.
    SELECT count(*) INTO v_anon_all FROM public.announcements WHERE title LIKE 'zz %';

    BEGIN
      INSERT INTO public.announcements (source_id, title, title_key, official_url, institution, category, published_at, expires_at)
      VALUES (v_src, 'zz badcat', 'zz badcat', 'https://example.invalid/5', 'zz', 'health', now(), now() + interval '1 day');
      v_bad_cat := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_cat := 'refused';
    END;
    BEGIN
      INSERT INTO public.announcements (source_id, title, title_key, official_url, institution, category, published_at, expires_at, deadline_at)
      VALUES (v_src, 'zz baddl', 'zz baddl', 'https://example.invalid/6', 'zz', 'kamu', now(), now() + interval '1 day', now() + interval '2 day');
      v_bad_dl := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_dl := 'refused';
    END;

    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_anon_live  IS DISTINCT FROM 1        THEN RAISE EXCEPTION 'anon sees % probe rows (want 1: published and unexpired only)', v_anon_live; END IF;
  IF v_auth_live  IS DISTINCT FROM 1        THEN RAISE EXCEPTION 'authenticated sees % probe rows (want 1)', v_auth_live; END IF;
  IF v_anon_all   IS DISTINCT FROM 3        THEN RAISE EXCEPTION 'CONTROL FAILED: owner sees % probe rows (want 3)', v_anon_all; END IF;
  IF v_anon_write IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'anon announcements INSERT was %', v_anon_write; END IF;
  IF v_auth_write IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'authenticated announcements UPDATE was %', v_auth_write; END IF;
  IF v_anon_src   IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'anon read announcement_sources: %', v_anon_src; END IF;
  IF v_auth_src   IS DISTINCT FROM 'denied' THEN RAISE EXCEPTION 'authenticated read announcement_sources: %', v_auth_src; END IF;
  IF v_bad_cat    IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: category health was %', v_bad_cat; END IF;
  IF v_bad_dl     IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: deadline without source was %', v_bad_dl; END IF;
  IF EXISTS (SELECT 1 FROM public.announcement_sources WHERE key = 'zz-probe') THEN
    RAISE EXCEPTION 'probe rows survived the rollback';
  END IF;
  RAISE NOTICE 'duyurular policies: %', v_policies;
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
VALUES ('20261102_duyurular.sql', '6eaee854a4fc1df4066d86690cdd35790e1197ef1a3fd89ba104d6a79ec989ba')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   Run supabase/verify_schema.sql QUERY 1: every 1102_duyurular row must read OK.
--
-- ─── Rollback (only if the module is abandoned) ─────────────────────────────
--   DROP TABLE IF EXISTS public.announcements, public.announcement_sources;

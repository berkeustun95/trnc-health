-- ═══════════════════════════════════════════════════════════
-- 20261175 — weekend digest: the Friday "Bu hafta sonu" push (Explore stage 4)
-- ═══════════════════════════════════════════════════════════
--
-- Berke (2026-11-07): a weekly push on Friday with this weekend's events and one place to visit,
-- ON by default with an off switch (Profil → Bildirimler → "Hafta sonu önerileri").
--
-- This file adds the SWITCH, the TYPE and the RUN LOG. It schedules nothing and sends nothing:
-- the test send is 20261176 (order testers only) and the weekly job is 20261177 (Berke's go).
--
--   1. profiles.weekend_digest boolean NOT NULL DEFAULT true. The owner flips it through the existing
--      profiles self-update path (same as checkins_public: no guard trigger, RLS "own row" only).
--      The Edge Function sends only to rows where it is true.
--   2. notifications_type_check gains 'weekend' (the in-app Bildirimler row the push writes).
--   3. weekend_digest_runs: one counts-only row per invocation, like duty_push_runs (20261141):
--      NO user id, NO token, NO text. RLS on, zero policies, anon/authenticated revoked; only the
--      function (service_role) touches it. 90-day purge at 03:51 UTC.
--
-- Public logs: this file prints no user counts and no ids.
-- Apply: gh workflow run supabase-migrate -f file=20261175_weekend_digest.sql (dry), then -f apply=true.

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS weekend_digest boolean NOT NULL DEFAULT true;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('duty', 'message', 'waitlist', 'question', 'admin_alert', 'admin_message', 'featured', 'general', 'weekend'));

CREATE TABLE IF NOT EXISTS public.weekend_digest_runs (
  id                   bigint      GENERATED ALWAYS AS IDENTITY,
  started_at           timestamptz NOT NULL DEFAULT now(),
  finished_at          timestamptz,
  mode                 text        NOT NULL DEFAULT 'all',
  outcome              text        NOT NULL DEFAULT 'running',
  events               int         NOT NULL DEFAULT 0,
  notified             int         NOT NULL DEFAULT 0,
  notif_batches_failed int         NOT NULL DEFAULT 0,
  push_attempted       int         NOT NULL DEFAULT 0,
  push_ok              int         NOT NULL DEFAULT 0,
  push_errors          int         NOT NULL DEFAULT 0,
  error_kinds          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT weekend_digest_runs_pkey PRIMARY KEY (id),
  CONSTRAINT weekend_digest_runs_mode_check CHECK (mode IN ('all', 'testers')),
  CONSTRAINT weekend_digest_runs_outcome_check CHECK (outcome IN
    ('running', 'sent', 'partial', 'push_failed', 'no_events', 'no_profiles', 'events_query_failed', 'profiles_query_failed')),
  CONSTRAINT weekend_digest_runs_counts_check CHECK (
    events >= 0 AND notified >= 0 AND notif_batches_failed >= 0
    AND push_attempted >= 0 AND push_ok >= 0 AND push_errors >= 0
    AND push_ok + push_errors <= push_attempted),
  CONSTRAINT weekend_digest_runs_error_kinds_check CHECK (jsonb_typeof(error_kinds) = 'object'),
  CONSTRAINT weekend_digest_runs_finished_check CHECK (finished_at IS NULL OR finished_at >= started_at)
);
ALTER TABLE public.weekend_digest_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.weekend_digest_runs FROM anon, authenticated;

SELECT cron.unschedule('purge-weekend-digest-runs') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-weekend-digest-runs');
SELECT cron.schedule('purge-weekend-digest-runs', '51 3 * * *',
  $job$DELETE FROM public.weekend_digest_runs WHERE started_at < now() - interval '90 days'$job$);

-- ─── Assertions ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def text; v_n int;
BEGIN
  SELECT format('%s:%s:%s', data_type, is_nullable, column_default) INTO v_def
    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'weekend_digest';
  IF v_def IS DISTINCT FROM 'boolean:NO:true' THEN
    RAISE EXCEPTION 'profiles.weekend_digest is %, expected boolean NOT NULL DEFAULT true', v_def;
  END IF;
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conrelid = 'public.notifications'::regclass
                            AND conname = 'notifications_type_check')) NOT LIKE '%''weekend''%' THEN
    RAISE EXCEPTION 'notifications_type_check does not admit weekend';
  END IF;
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.weekend_digest_runs'::regclass) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'weekend_digest_runs: RLS is off';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'weekend_digest_runs';
  IF v_n <> 0 THEN RAISE EXCEPTION 'weekend_digest_runs: expected 0 policies, found %', v_n; END IF;
  IF has_table_privilege('authenticated', 'public.weekend_digest_runs', 'SELECT')
     OR has_table_privilege('anon', 'public.weekend_digest_runs', 'SELECT') THEN
    RAISE EXCEPTION 'weekend_digest_runs: anon/authenticated can still read it';
  END IF;
  -- Positive control: the owner path for the switch is the profiles self-update the app already uses.
  IF NOT has_column_privilege('authenticated', 'public.profiles', 'weekend_digest', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated cannot update profiles.weekend_digest: the switch would not save';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-weekend-digest-runs') THEN
    RAISE EXCEPTION 'purge-weekend-digest-runs not scheduled';
  END IF;
  RAISE NOTICE '20261175 OK: weekend_digest switch (default on), type weekend, run log + purge';
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
VALUES ('20261175_weekend_digest.sql', '49726a42249bb6618d80c6a5d96585731c8267fa7365b9e09f1f6fb44fd5c87b')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

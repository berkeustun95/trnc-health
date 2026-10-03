-- ═══════════════════════════════════════════════════════════════════════════
-- 20261071 — Live Scores follow-up: deletes reach viewers, logos are ours, F1 sessions
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Three decisions from review of 20261070 (Berke, 2026-10-03):
--
-- 1. A DELETED KTFF FIXTURE MUST DISAPPEAR FOR VIEWERS WITHOUT A RELOAD.
--    With the default REPLICA IDENTITY a DELETE's WAL record carries only the primary key,
--    so a Realtime subscription filtered on sport=eq.football cannot match it and the
--    delete is never delivered. REPLICA IDENTITY FULL puts the whole old row in the record.
--    match_events too: a removed goal must leave the scorer line, and the client needs the
--    old row's match_id to find it. Cost: larger WAL for UPDATE/DELETE on two small tables.
--
-- 2. NO PHONE EVER FETCHES FROM media.api-sports.io.
--    Logo URLs from the API are an IP + user-agent disclosure to a third party the privacy
--    policy does not name, on a 13+ app. The sync now writes the API's URL to
--    source_logo_url (never selected by the app) and copies the file ONCE into the public
--    team-logos bucket; logo_url holds only that copy. teams_logo_check makes this
--    structural: logo_url may point at the team-logos bucket and nowhere else.
--
-- 3. F1 IS API-SPORTS ONLY (no Jolpica: its terms are non-commercial).
--    The free plan returns races by date (yesterday/today/tomorrow) with no round number,
--    one row per SESSION (practice, qualifying, sprint, race). So a row is a session keyed
--    by API-Sports' race id; round becomes nullable; session_type says which session.
--    f1_standings stays (empty, harmless) — there is no free source for standings.
--
-- ─── WHO CAN READ / WRITE — unchanged from 20261070 ─────────────────────────
-- No policy is added, dropped or altered here; the 15-policy set 20261070 asserts stands.
-- The bucket has NO storage policy: public buckets serve reads without RLS, and only
-- service_role (the sync, which bypasses RLS) writes to it. storage.objects stays at 36.
--
-- Apply: gh workflow run supabase-migrate -f file=20261071_live_scores_followup.sql
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ─── 1. Deletes reach filtered subscriptions ────────────────────────────────
ALTER TABLE public.matches      REPLICA IDENTITY FULL;
ALTER TABLE public.match_events REPLICA IDENTITY FULL;

-- ─── 2. Logos ───────────────────────────────────────────────────────────────
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS source_logo_url text;
COMMENT ON COLUMN public.teams.source_logo_url IS
  'The provider''s logo URL. Read ONLY by the sync, which copies the file into the team-logos bucket. Never selected by the app.';
COMMENT ON COLUMN public.teams.logo_url IS
  'Our copy in the public team-logos bucket (teams_logo_check). NULL until the sync has copied it; the app shows a placeholder.';

ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_source_logo_check;
ALTER TABLE public.teams ADD  CONSTRAINT teams_source_logo_check
  CHECK (source_logo_url IS NULL OR source_logo_url ~ '^https://');

-- Our bucket and nothing else. Anchored on the Supabase public-object path, not on this
-- project's ref, so the rule is the same on any project the schema is rebuilt into.
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_logo_check;
ALTER TABLE public.teams ADD  CONSTRAINT teams_logo_check
  CHECK (logo_url IS NULL
         OR logo_url ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/team-logos/[a-z0-9/_.-]+$');

-- Any row 20261070's sync wrote between the two applies carries the API URL in logo_url:
-- move it to source_logo_url so the sync copies it, and clear what the app would show.
UPDATE public.teams
   SET source_logo_url = coalesce(source_logo_url, logo_url), logo_url = NULL
 WHERE logo_url IS NOT NULL
   AND logo_url !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/team-logos/';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('team-logos', 'team-logos', true, 524288, ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true, file_size_limit = 524288, allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp'];

-- ─── 3. F1 sessions ─────────────────────────────────────────────────────────
ALTER TABLE public.f1_races ALTER COLUMN round DROP NOT NULL;
ALTER TABLE public.f1_races ADD COLUMN IF NOT EXISTS session_type text NOT NULL DEFAULT 'race';
ALTER TABLE public.f1_races DROP CONSTRAINT IF EXISTS f1_races_session_type_check;
ALTER TABLE public.f1_races ADD  CONSTRAINT f1_races_session_type_check
  CHECK (session_type IN ('race','sprint','qualifying','sprint_qualifying','practice1','practice2','practice3'));
ALTER TABLE public.f1_races DROP CONSTRAINT IF EXISTS f1_races_status_check;
ALTER TABLE public.f1_races ADD  CONSTRAINT f1_races_status_check
  CHECK (status IN ('scheduled','live','finished','cancelled','postponed'));
ALTER TABLE public.f1_races DROP CONSTRAINT IF EXISTS f1_races_api_race_id_key;
ALTER TABLE public.f1_races ADD  CONSTRAINT f1_races_api_race_id_key UNIQUE (api_race_id);
CREATE INDEX IF NOT EXISTS f1_races_race_at_idx ON public.f1_races (race_at);

-- ─── Assertions. Each derives what it checks and prints what it read. ───────
DO $$
DECLARE
  v_ri        text;
  v_n         int;
  v_names     text;
  v_team      bigint;
  v_race      bigint;
  v_foreign   text := 'unset';
  v_ours      text := 'unset';
  v_bad_type  text := 'unset';
  v_dup_api   text := 'unset';
  v_no_round  text := 'unset';
BEGIN
  SELECT string_agg(relname || '=' || relreplident::text, ',' ORDER BY relname) INTO v_ri
    FROM pg_class WHERE oid IN (to_regclass('public.matches'), to_regclass('public.match_events'));
  IF v_ri IS DISTINCT FROM 'match_events=f,matches=f' THEN
    RAISE EXCEPTION 'REPLICA IDENTITY should be FULL on matches and match_events; read %', v_ri;
  END IF;

  -- 20261070's policy set is untouched (this file adds none).
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename IN
    ('leagues','teams','matches','match_events','f1_races','f1_results','f1_standings',
     'api_quota_log','api_request_log','live_sync_state','live_score_editors');
  IF v_n IS DISTINCT FROM 15 THEN RAISE EXCEPTION 'live-scores policy count moved: % (want 15)', v_n; END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'team-logos' AND public
                   AND file_size_limit = 524288
                   AND allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp']) THEN
    RAISE EXCEPTION 'bucket team-logos is missing, private, or has the wrong limits';
  END IF;
  SELECT count(*), string_agg(policyname, ', ') INTO v_n, v_names FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND coalesce(qual, '') || coalesce(with_check, '') LIKE '%team-logos%';
  IF v_n IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'a storage policy names team-logos (want none): %', v_names; END IF;

  IF EXISTS (SELECT 1 FROM public.teams WHERE logo_url ~ 'api-sports\.io') THEN
    RAISE EXCEPTION 'a teams.logo_url still points at api-sports.io after the move';
  END IF;

  -- ── BEHAVIOUR, rolled back by a sentinel.
  BEGIN
    INSERT INTO public.teams (sport, name, source, external_id) VALUES ('football', 'zz logo', 'api', 'zz-logo')
      RETURNING id INTO v_team;
    BEGIN
      UPDATE public.teams SET logo_url = 'https://media.api-sports.io/football/teams/40.png' WHERE id = v_team;
      v_foreign := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_foreign := 'refused';
    END;
    BEGIN
      UPDATE public.teams
         SET logo_url = 'https://jeihxnwqytnxtytgkzgf.supabase.co/storage/v1/object/public/team-logos/football/40.png',
             source_logo_url = 'https://media.api-sports.io/football/teams/40.png'
       WHERE id = v_team;
      v_ours := 'accepted';
    EXCEPTION WHEN check_violation THEN v_ours := 'REFUSED';
    END;

    INSERT INTO public.f1_races (season, name, race_at, session_type, api_race_id)
    VALUES (2026, 'zz GP', now(), 'qualifying', -1) RETURNING id INTO v_race;
    v_no_round := 'accepted';
    BEGIN
      INSERT INTO public.f1_races (season, name, race_at, session_type, api_race_id)
      VALUES (2026, 'zz GP', now(), 'race', -1);
      v_dup_api := 'ACCEPTED';
    EXCEPTION WHEN unique_violation THEN v_dup_api := 'refused';
    END;
    BEGIN
      INSERT INTO public.f1_races (season, name, race_at, session_type, api_race_id)
      VALUES (2026, 'zz GP', now(), 'warmup', -2);
      v_bad_type := 'ACCEPTED';
    EXCEPTION WHEN check_violation THEN v_bad_type := 'refused';
    END;

    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  IF v_foreign  IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'an api-sports.io logo_url was %', v_foreign; END IF;
  IF v_ours     IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'POSITIVE CONTROL: a team-logos URL was %', v_ours; END IF;
  IF v_no_round IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'an F1 session without a round was not accepted'; END IF;
  IF v_dup_api  IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'a duplicate api_race_id was %', v_dup_api; END IF;
  IF v_bad_type IS DISTINCT FROM 'refused'  THEN RAISE EXCEPTION 'CONTROL FAILED: session_type warmup was %', v_bad_type; END IF;
  IF EXISTS (SELECT 1 FROM public.teams WHERE external_id = 'zz-logo')
     OR EXISTS (SELECT 1 FROM public.f1_races WHERE api_race_id IN (-1, -2)) THEN
    RAISE EXCEPTION 'probe rows survived the rollback';
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
VALUES ('20261071_live_scores_followup.sql', '612188d82eacbb8527dd5399f4be0dcb445a315cdece5ac226791c7dfcfeb4a3')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

-- ─── Rollback ───────────────────────────────────────────────────────────────
--   ALTER TABLE public.matches REPLICA IDENTITY DEFAULT; ALTER TABLE public.match_events REPLICA IDENTITY DEFAULT;
--   (Empty the bucket through the Storage API first, then: DELETE FROM storage.buckets WHERE id = 'team-logos';)

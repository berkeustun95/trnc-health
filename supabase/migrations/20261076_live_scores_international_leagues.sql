-- ═══════════════════════════════════════════════════════════════════════════
-- 20261076 — Live Scores: international + UEFA club football, Turkish league names, new order
-- ═══════════════════════════════════════════════════════════════════════════
--
-- IDs come from the provider, not memory: 20261075 asked live-scores-football for
-- /leagues?country=World&current=true (180 competitions, read 2026-10-04 via net._http_response).
--
-- ADDED (Berke, 2026-10-04: "all men's senior national-team competitions with a current
-- season; Europa League, Conference League, UEFA Super Cup"):
--   • 28 national-team competitions whose current season is 2025 or later — the proxy for
--     "active". One that has finished costs nothing: no fixtures, no section, no request.
--   • 3 UEFA club cups: Europa League 3, Conference League 848, UEFA Super Cup 531.
-- SKIPPED: women's (666, 904, 926, 949, 1136 …), youth/age-limited (U-age tournaments, Asian
-- Games 803, Southeast Asian Games 911, Mediterranean Games 919, Maurice Revello 914, COTIF
-- 940), club friendlies (667, 937, 903, 1236, 1216), and competitions whose current season is
-- older than 2025 (Euro 4, Copa America 9, Euro qualification 960, old regional cups).
--
-- QUOTA: unchanged per call. The daily run is still two `fixtures?date=` requests and a live
-- poll is still one `fixtures?live=all` (+ one date call per date with ended matches): the
-- sync filters the same responses against more league ids. More leagues can mean more
-- minutes with a match on, so more polls in a day — the quota-spread interval and the 90/day
-- cap (claim_api_request) bound that, unchanged.
--
-- ORDER (sort_order): TRNC 0 → Süper Lig 10 → [Türkiye national team, pinned by the app:
-- any international match with Türkiye in it, sort 15] → internationals 20–49 → Champions
-- League 60 → Europa League 61 → Conference League 62 → UEFA Super Cup 63 → Premier League
-- 70 → La Liga 80 → Serie A 90 → Bundesliga 100 → Ligue 1 110. country = 'World' marks an
-- international (the app's Türkiye pin reads it); 'Europe' marks a UEFA club cup.
--
-- name_i18n: display names keyed by FULL language name (house rule: 'Turkish', never 'tr');
-- Turkish filled now, every other language falls back to `name`.
--
-- WHO CAN READ / WRITE: unchanged. leagues stays public-read, no client writes.
-- Ends with one football daily run so today's and tomorrow's games land now (2 requests).
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS name_i18n jsonb;
ALTER TABLE public.leagues DROP CONSTRAINT IF EXISTS leagues_name_i18n_check;
ALTER TABLE public.leagues ADD  CONSTRAINT leagues_name_i18n_check
  CHECK (name_i18n IS NULL OR (
    jsonb_typeof(name_i18n) = 'object'
    AND (name_i18n - ARRAY['English','Turkish','Arabic','Russian','Greek','French','Spanish','German','Persian']) = '{}'::jsonb
    AND octet_length(name_i18n::text) <= 2000));
COMMENT ON COLUMN public.leagues.name_i18n IS
  'Display names by FULL language name ({"Turkish": "…"}); the app falls back to name. Never ISO codes.';

-- Existing football leagues: new order + Turkish names.
UPDATE public.leagues l SET sort_order = v.sort_order, name_i18n = v.name_i18n
  FROM (VALUES
    ('203', 10,  '{"Turkish":"Süper Lig"}'::jsonb),
    ('2',   60,  '{"Turkish":"UEFA Şampiyonlar Ligi"}'::jsonb),
    ('39',  70,  '{"Turkish":"Premier Lig"}'::jsonb),
    ('140', 80,  '{"Turkish":"La Liga"}'::jsonb),
    ('135', 90,  '{"Turkish":"Serie A"}'::jsonb),
    ('78',  100, '{"Turkish":"Bundesliga"}'::jsonb),
    ('61',  110, '{"Turkish":"Ligue 1"}'::jsonb)
  ) AS v(ext, sort_order, name_i18n)
 WHERE l.sport = 'football' AND l.source = 'api' AND l.external_id = v.ext;
UPDATE public.leagues SET name_i18n = '{"Turkish":"KTFF Süper Lig"}'::jsonb
 WHERE sport = 'football' AND source = 'manual' AND name = 'KTFF Süper Lig';

INSERT INTO public.leagues (sport, name, name_i18n, country, source, external_id, sort_order, enabled) VALUES
  -- Internationals, men's senior (country = 'World').
  ('football', 'World Cup',                              '{"Turkish":"Dünya Kupası"}',                      'World', 'api', '1',    20, true),
  ('football', 'UEFA Nations League',                    '{"Turkish":"UEFA Uluslar Ligi"}',                 'World', 'api', '5',    21, true),
  ('football', 'Finalissima',                            '{"Turkish":"Finalissima"}',                       'World', 'api', '913',  22, true),
  ('football', 'World Cup Qualification – Play-offs',    '{"Turkish":"Dünya Kupası Elemeleri – Play-off"}', 'World', 'api', '37',   23, true),
  ('football', 'World Cup Qualification – South America','{"Turkish":"Dünya Kupası Elemeleri – Güney Amerika"}','World','api','34', 24, true),
  ('football', 'World Cup Qualification – Asia',         '{"Turkish":"Dünya Kupası Elemeleri – Asya"}',     'World', 'api', '30',   25, true),
  ('football', 'World Cup Qualification – CONCACAF',     '{"Turkish":"Dünya Kupası Elemeleri – CONCACAF"}', 'World', 'api', '31',   26, true),
  ('football', 'World Cup Qualification – Oceania',      '{"Turkish":"Dünya Kupası Elemeleri – Okyanusya"}','World', 'api', '33',   27, true),
  ('football', 'Asian Cup',                              '{"Turkish":"Asya Kupası"}',                       'World', 'api', '7',    28, true),
  ('football', 'Africa Cup of Nations',                  '{"Turkish":"Afrika Uluslar Kupası"}',             'World', 'api', '6',    29, true),
  ('football', 'Africa Cup of Nations – Qualification',  '{"Turkish":"Afrika Uluslar Kupası Elemeleri"}',   'World', 'api', '36',   30, true),
  ('football', 'CONCACAF Gold Cup',                      '{"Turkish":"CONCACAF Altın Kupa"}',               'World', 'api', '22',   31, true),
  ('football', 'CONCACAF Gold Cup – Qualification',      '{"Turkish":"CONCACAF Altın Kupa Elemeleri"}',     'World', 'api', '858',  32, true),
  ('football', 'CONCACAF Nations League',                '{"Turkish":"CONCACAF Uluslar Ligi"}',             'World', 'api', '536',  33, true),
  ('football', 'Gulf Cup of Nations',                    '{"Turkish":"Körfez Kupası"}',                     'World', 'api', '25',   34, true),
  ('football', 'Arab Cup',                               '{"Turkish":"Arap Kupası"}',                       'World', 'api', '860',  35, true),
  ('football', 'FIFA Series',                            '{"Turkish":"FIFA Series"}',                       'World', 'api', '1222', 36, true),
  ('football', 'CONCACAF Series',                        '{"Turkish":"CONCACAF Series"}',                   'World', 'api', '1207', 37, true),
  ('football', 'Kirin Cup',                              '{"Turkish":"Kirin Kupası"}',                      'World', 'api', '916',  38, true),
  ('football', 'King''s Cup',                            '{"Turkish":"King''s Cup"}',                       'World', 'api', '1038', 39, true),
  ('football', 'EAFF E-1 Championship',                  '{"Turkish":"EAFF E-1 Şampiyonası"}',              'World', 'api', '23',   40, true),
  ('football', 'EAFF E-1 Championship – Qualification',  '{"Turkish":"EAFF E-1 Şampiyonası Elemeleri"}',    'World', 'api', '1169', 41, true),
  ('football', 'ASEAN Championship',                     '{"Turkish":"ASEAN Şampiyonası"}',                 'World', 'api', '24',   42, true),
  ('football', 'FIFA ASEAN Cup',                         '{"Turkish":"FIFA ASEAN Kupası"}',                 'World', 'api', '1247', 43, true),
  ('football', 'COSAFA Cup',                             '{"Turkish":"COSAFA Kupası"}',                     'World', 'api', '859',  44, true),
  ('football', 'CAFA Nations Cup',                       '{"Turkish":"CAFA Uluslar Kupası"}',               'World', 'api', '1008', 45, true),
  ('football', 'Baltic Cup',                             '{"Turkish":"Baltık Kupası"}',                     'World', 'api', '849',  46, true),
  ('football', 'International Friendlies',               '{"Turkish":"Hazırlık Maçları (Milli)"}',          'World', 'api', '10',   49, true),
  -- UEFA club cups (country = 'Europe', like the Champions League row).
  ('football', 'UEFA Europa League',                     '{"Turkish":"UEFA Avrupa Ligi"}',                  'Europe', 'api', '3',   61, true),
  ('football', 'UEFA Conference League',                 '{"Turkish":"UEFA Konferans Ligi"}',               'Europe', 'api', '848', 62, true),
  ('football', 'UEFA Super Cup',                         '{"Turkish":"UEFA Süper Kupa"}',                   'Europe', 'api', '531', 63, true)
ON CONFLICT (sport, source, external_id) DO UPDATE
  SET name = excluded.name, name_i18n = excluded.name_i18n, country = excluded.country,
      sort_order = excluded.sort_order, enabled = excluded.enabled;

-- ─── Assertions ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_order text;
  v_n     int;
  v_bad   text := 'unset';
BEGIN
  -- The football order the app renders, derived from the rows.
  SELECT string_agg(coalesce(external_id, 'KTFF'), ',' ORDER BY sort_order, external_id) INTO v_order
    FROM public.leagues WHERE sport = 'football' AND enabled AND (country IS DISTINCT FROM 'World');
  IF v_order IS DISTINCT FROM 'KTFF,203,2,3,848,531,39,140,135,78,61' THEN
    RAISE EXCEPTION 'football club order is %', v_order;
  END IF;
  SELECT count(*) INTO v_n FROM public.leagues
   WHERE sport = 'football' AND enabled AND country = 'World' AND sort_order BETWEEN 20 AND 49;
  IF v_n IS DISTINCT FROM 28 THEN RAISE EXCEPTION 'expected 28 enabled internationals in 20..49; found %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.leagues WHERE sport = 'football' AND enabled AND name_i18n ? 'Turkish';
  IF v_n IS DISTINCT FROM 39 THEN RAISE EXCEPTION 'expected a Turkish name on all 39 football leagues; found %', v_n; END IF;
  BEGIN
    UPDATE public.leagues SET name_i18n = '{"tr":"x"}' WHERE external_id = '10' AND sport = 'football';
    v_bad := 'ACCEPTED';
    RAISE EXCEPTION 'ZZ_PROBE_ROLLBACK';
  EXCEPTION
    WHEN check_violation THEN v_bad := 'refused';
    WHEN raise_exception THEN IF SQLERRM IS DISTINCT FROM 'ZZ_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;
  IF v_bad IS DISTINCT FROM 'refused' THEN RAISE EXCEPTION 'CONTROL FAILED: an ISO key in name_i18n was %', v_bad; END IF;
END $$;

-- ─── Backfill: today's + tomorrow's games for the new leagues (sent after COMMIT) ──
SELECT net.http_post(
  url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/live-scores-football',
  headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' ||
               (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'novest_sync_key')),
  body    := '{"mode":"daily"}'::jsonb);

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
VALUES ('20261076_live_scores_international_leagues.sql', 'b93670024e3f1f0e057b0a8461f89139f0893d80bee3af93927b7af89880ee3a')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

NOTIFY pgrst, 'reload schema';

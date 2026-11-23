// 20261228 KTFF tables + ktff_sync_due + cron (supabase/migrations/20261228_live_scores_ktff.sql) against a Supabase-shaped
// Postgres (scripts/migration-harness.mjs; PGlite = PostgreSQL 18, prod is older). By hand:
//   node scripts/test-ktff-sql.mjs
// Evidence of: the file applies and its own DO assertions pass, roles can/cannot read and write as designed (each denial beside a
// positive control), and ktff_sync_due() answers the due table. NOT evidence of: pg_cron / Vault / pg_net on the real database
// (cron.*, net.*, vault.* are stubs), PG 17 renderings, the live Vault secret.
import { fileURLToPath } from 'node:url'
import { freshDb, applyFile, asRole } from './migration-harness.mjs'

const FILE = fileURLToPath(new URL('../supabase/migrations/20261228_live_scores_ktff.sql', import.meta.url))
const SEED = `
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, username text DEFAULT 'postgres', active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (n, s, c) ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command RETURNING jobid::bigint $$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;
CREATE SCHEMA net;
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
CREATE SCHEMA vault;
CREATE TABLE vault.secrets (id serial PRIMARY KEY, name text UNIQUE, secret text);
CREATE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret FROM vault.secrets;
INSERT INTO vault.secrets (name, secret) VALUES ('novest_sync_key', 'test-not-a-real-key');
CREATE TABLE public.data_jobs (key text PRIMARY KEY, runner text NOT NULL, kind text NOT NULL, cron_jobnames text[] NOT NULL DEFAULT '{}', schedule_note text, expected_every interval, sort int NOT NULL DEFAULT 0);
`

let fail = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`  ${ok ? '✓' : '✗'} ${name}: ${JSON.stringify(got)}${ok ? '' : `  WANT ${JSON.stringify(want)}`}`)
}

const db = await freshDb(SEED)
const res = await applyFile(db, FILE)
t('migration applies and its own assertions pass', res, { ok: true, msg: null })
if (!res.ok) { console.error('stopped: file did not apply'); process.exit(1) }

const one = async (role, sql) => (await asRole(db, role, null, sql))
t('anon reads ktff_standings (positive control)', (await one('anon', 'SELECT count(*)::int n FROM public.ktff_standings')).rows?.[0], { n: 0 })
t('authenticated reads ktff_fixtures (positive control)', (await one('authenticated', 'SELECT count(*)::int n FROM public.ktff_fixtures')).rows?.[0], { n: 0 })
t('anon cannot read ktff_sync_state', (await one('anon', 'SELECT 1 FROM public.ktff_sync_state')).ok, false)
t('authenticated cannot read ktff_sync_state', (await one('authenticated', 'SELECT 1 FROM public.ktff_sync_state')).ok, false)
t('service_role writes a logo failure (positive control)', (await one('service_role', "INSERT INTO public.ktff_logo_failures (source_url) VALUES ('https://ktff.org/l/1.png')")).ok, true)
t('anon cannot read ktff_logo_failures', (await one('anon', 'SELECT 1 FROM public.ktff_logo_failures')).ok, false)
t('authenticated cannot write ktff_logo_failures', (await one('authenticated', "INSERT INTO public.ktff_logo_failures (source_url) VALUES ('https://ktff.org/l/2.png')")).ok, false)
t('a non-https logo failure source is refused', (await one('service_role', "INSERT INTO public.ktff_logo_failures (source_url) VALUES ('http://ktff.org/l/3.png')")).ok, false)
t('anon cannot insert a league', (await one('anon', "INSERT INTO public.ktff_leagues (league_id) VALUES (1)")).ok, false)
t('authenticated cannot insert a league', (await one('authenticated', "INSERT INTO public.ktff_leagues (league_id) VALUES (1)")).ok, false)
t('service_role inserts a league (positive control)', (await one('service_role', "INSERT INTO public.ktff_leagues (league_id, name_tr) VALUES (1, 'Süper Lig')")).ok, true)
t('service_role writes sync state (positive control)', (await one('service_role', "INSERT INTO public.ktff_sync_state (endpoint) VALUES ('standings')")).ok, true)
t('anon sees the league service_role wrote', (await one('anon', 'SELECT league_id FROM public.ktff_leagues')).rows, [{ league_id: 1 }])
t('league 3 is refused', (await one('service_role', "INSERT INTO public.ktff_leagues (league_id) VALUES (3)")).ok, false)
t('a non-bucket logo URL is refused', (await one('service_role', "UPDATE public.ktff_leagues SET logo_url = 'https://evil.example.com/x.png' WHERE league_id = 1")).ok, false)
t('a bucket logo URL is accepted', (await one('service_role', "UPDATE public.ktff_leagues SET logo_url = 'https://abc.supabase.co/storage/v1/object/public/team-logos/ktff/0123456789abcdef.png' WHERE league_id = 1")).ok, true)
t('a bad colour is refused', (await one('service_role', "INSERT INTO public.ktff_standings (league_id, team_id, marker_color) VALUES (1, 1, 'red')")).ok, false)
t('a bad sync endpoint is refused', (await one('service_role', "INSERT INTO public.ktff_sync_state (endpoint) VALUES ('fixtures:3')")).ok, false)
t('anon cannot call ktff_sync_due', (await one('anon', 'SELECT public.ktff_sync_due()')).ok, false)
t('authenticated cannot call ktff_sync_due', (await one('authenticated', 'SELECT public.ktff_sync_due()')).ok, false)

const due = async () => (await one('service_role', 'SELECT public.ktff_sync_due() AS d')).rows?.[0]?.d
const reset = async (state) => {
  await db.exec('DELETE FROM public.ktff_sync_state; DELETE FROM public.ktff_fixtures;')
  if (state) await db.exec(`INSERT INTO public.ktff_sync_state (endpoint, last_success_at, next_allowed_at) VALUES ('standings', ${state.ok}, ${state.next})`)
}
await reset(null)
t('due: no state row at all (first ever run)', await due(), true)
await reset({ ok: 'NULL', next: 'NULL' })
t('due: row but never succeeded', await due(), true)
await reset({ ok: "now() - interval '1 hour'", next: 'NULL' })
t('not due: fresh, no match window', await due(), false)
await reset({ ok: "now() - interval '7 hours'", next: 'NULL' })
t('due: older than 6 h', await due(), true)
await reset({ ok: "now() - interval '7 hours'", next: "now() + interval '2 hours'" })
t('not due: stale but inside the back-off window', await due(), false)
await reset({ ok: "now() - interval '1 hour'", next: "now() - interval '1 minute'" })
await db.exec("INSERT INTO public.ktff_fixtures (match_id, league_id, week, kickoff_at) VALUES (1, 1, 1, now() - interval '60 minutes')")
t('due: a match started 60 min ago', await due(), true)
await db.exec("UPDATE public.ktff_fixtures SET kickoff_at = now() + interval '20 minutes'")
t('due: kickoff in 20 min', await due(), true)
await db.exec("UPDATE public.ktff_fixtures SET kickoff_at = now() + interval '50 minutes'")
t('not due: kickoff in 50 min', await due(), false)
await db.exec("UPDATE public.ktff_fixtures SET kickoff_at = now() - interval '200 minutes'")
t('not due: kicked off 200 min ago', await due(), false)
await db.exec("UPDATE public.ktff_fixtures SET kickoff_at = now() + interval '20 minutes'")
await db.exec("UPDATE public.ktff_sync_state SET next_allowed_at = now() + interval '1 hour'")
t('not due: match window open but back-off window closed over it', await due(), false)

const jobs = (await db.query("SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'live-scores-ktff'")).rows
t('exactly one live-scores-ktff job at off-minutes', jobs, [{ jobname: 'live-scores-ktff', schedule: '7,22,37,52 * * * *', active: true }])
t('one data_jobs row covers it', (await db.query("SELECT count(*)::int n FROM public.data_jobs WHERE 'live-scores-ktff' = ANY (cron_jobnames)")).rows[0], { n: 1 })
const again = await applyFile(db, FILE)
t('re-applying is safe (re-runnable)', again.ok, true)
t('still one job after a re-apply', (await db.query("SELECT count(*)::int n FROM cron.job WHERE jobname = 'live-scores-ktff'")).rows[0], { n: 1 })

if (fail) { console.error(`ktff sql test: ${fail} FAILED`); process.exit(1) }
console.log('ktff sql test: OK')

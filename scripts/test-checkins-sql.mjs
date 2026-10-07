// 20261078 check-ins, behaviour as each role, in PGlite (scripts/migration-harness.mjs).
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-checkins-sql.mjs [migration.sql]
//   WITH_1091=1 … applies 20261091 (Google places) on top: every 1078 rule must still hold.
// The optional path is for red-first runs against a deliberately broken copy. PGlite is PG 18;
// prod is older, and the fixture has none of prod's profiles triggers (guard_profile_ban,
// check_profile_name_content) — check those live at apply time.
import { fileURLToPath } from 'node:url'
import { freshDb, applyFile } from './migration-harness.mjs'
const FILE = process.argv[2] || fileURLToPath(new URL('../supabase/migrations/20261078_checkins.sql', import.meta.url))
const FILE_1091 = fileURLToPath(new URL('../supabase/migrations/20261091_checkins_google_places.sql', import.meta.url))
const SEED = `
ALTER TABLE auth.users ADD COLUMN is_anonymous boolean NOT NULL DEFAULT false;
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean NOT NULL DEFAULT true);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $f$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (n, s, c) RETURNING jobid $f$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $f$ DELETE FROM cron.job WHERE jobname = n RETURNING true $f$;
CREATE SCHEMA net;
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $f$ SELECT 1::bigint $f$;
CREATE SCHEMA vault;
CREATE TABLE vault.secrets (name text);
INSERT INTO vault.secrets VALUES ('novest_sync_key');
CREATE VIEW vault.decrypted_secrets AS SELECT name, 'stub'::text AS decrypted_secret FROM vault.secrets;
CREATE FUNCTION public.is_anonymous_session() RETURNS boolean LANGUAGE sql STABLE AS $f$
  SELECT coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false) $f$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, display_name text, date_of_birth date,
  age_ineligible boolean NOT NULL DEFAULT false, ugc_banned_until timestamptz, avatar_url text);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_own_read ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY p_own_upd ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY p_admin ON public.profiles FOR ALL TO authenticated USING (false);
CREATE POLICY p_provider ON public.profiles FOR SELECT TO authenticated USING (false);
CREATE TABLE public.places (id uuid PRIMARY KEY, name text, name_i18n jsonb, category text,
  latitude double precision, longitude double precision, status text, hidden_at timestamptz);
CREATE TABLE public.blocks (blocker_id uuid, blocked_id uuid);
INSERT INTO public.places VALUES
 ('a0000000-0000-4000-8000-000000000001','A',null,'museum',35.0,33.0,'active',null),
 ('a0000000-0000-4000-8000-000000000002','B far',null,'museum',35.27,33.0,'active',null),
 ('a0000000-0000-4000-8000-000000000003','C near',null,'museum',35.004,33.0,'active',null),
 ('a0000000-0000-4000-8000-000000000004','Hidden',null,'museum',35.0,33.0,'active',now()),
 ('a0000000-0000-4000-8000-000000000005','D',null,'museum',35.0,33.0,'active',null);
INSERT INTO public.profiles (id, display_name, date_of_birth) VALUES
 ('u0000000-0000-4000-8000-000000000001'::text::uuid, null, null);
`.replace(/'u0000000[^']*'::text::uuid/, "'b0000000-0000-4000-8000-000000000009'")
const U = n => `b0000000-0000-4000-8000-00000000000${n}`
const P = n => `a0000000-0000-4000-8000-00000000000${n}`
const db = await freshDb(SEED)
await db.exec(`INSERT INTO auth.users SELECT id FROM public.profiles;`)
await db.exec(`INSERT INTO public.profiles (id, display_name, date_of_birth) VALUES
 ('${U(1)}','adult', '1990-01-01'), ('${U(2)}','viewer','1990-01-01'), ('${U(3)}','minor', current_date - interval '15 years'),
 ('${U(4)}','blocker','1990-01-01'), ('${U(5)}', null, '1990-01-01'), ('${U(6)}','nodob', null), ('${U(7)}','optout','1990-01-01');
 INSERT INTO public.blocks VALUES ('${U(4)}','${U(1)}');`)
const r = await applyFile(db, FILE)
let pass = 0, fail = 0
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log('FAIL', name, JSON.stringify(got)) } }
if (!r.ok) { console.log('APPLY FAILED', r.msg); process.exit(1) }
if (process.env.WITH_1091) {
  const r2 = await applyFile(db, FILE_1091)
  if (!r2.ok) { console.log('APPLY 1091 FAILED', r2.msg); process.exit(1) }
  console.log('(with 20261091 applied on top)')
}
async function as(uid, sql, anon = false) {
  await db.exec('RESET ROLE;')
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [uid ? JSON.stringify({ sub: uid, role: 'authenticated', is_anonymous: anon }) : ''])
  await db.exec(uid ? 'SET ROLE authenticated;' : 'SET ROLE anon;')
  try { return { ok: true, rows: (await db.query(sql)).rows } }
  catch (e) { return { ok: false, msg: String(e.message).split('\n')[0] } }
  finally { await db.exec('RESET ROLE;') }
}
const ci = (u, p, lat, lng, acc, anon) => as(u, `SELECT * FROM public.check_in('${P(p)}', ${lat}, ${lng}, ${acc})`, anon)
let x
x = await ci(U(1), 1, 35.0005, 33, 20, true); ok('guest refused', x.msg === 'AUTH_REQUIRED', x)
x = await as(null, `SELECT * FROM public.get_checkin_feed()`); ok('anon feed refused', !x.ok, x)
x = await ci(U(5), 1, 35.0005, 33, 20); ok('no name', x.msg === 'NAME_REQUIRED', x)
x = await ci(U(1), 1, 35.0005, 33, 20); ok('no notice', x.msg === 'NOTICE_REQUIRED', x)
x = await as(U(1), `UPDATE public.profiles SET checkins_notice_at = now() WHERE id = '${U(1)}'`); ok('direct stamp refused', x.msg === 'CHECKIN_NOTICE_SERVER_ONLY', x)
x = await as(U(7), `UPDATE public.profiles SET checkins_public = false WHERE id = '${U(7)}' RETURNING checkins_public`); ok('switch writable', x.ok && x.rows[0]?.checkins_public === false, x)
for (const [u, want] of [[1, true], [2, true], [3, false], [4, true], [6, false], [7, false]]) {
  x = await as(U(u), `SELECT public.accept_checkin_notice('2026-10-02') AS v`); ok(`notice u${u} -> ${want}`, x.ok && x.rows[0].v === want, x)
}
x = await as(U(1), `SELECT public.accept_checkin_notice('v1') AS v`); ok('bad version', x.msg === 'BAD_VERSION', x)
x = await ci(U(1), 1, 35.0019, 33, 60); ok('acc 60', x.msg === 'LOW_ACCURACY', x)
x = await ci(U(1), 1, 35.0005, 33, 0); ok('acc 0', x.msg === 'LOW_ACCURACY', x)
x = await ci(U(1), 1, "'NaN'::float8", 33, 10); ok('NaN', x.msg === 'BAD_FIX', x)
x = await ci(U(1), 1, 35.0018, 33, 10); ok('200 m too far', x.msg === 'TOO_FAR', x)
x = await ci(U(1), 4, 35.0, 33, 10); ok('hidden place', x.msg === 'PLACE_NOT_FOUND', x)
x = await ci(U(1), 1, 35.0013, 33, 50); ok('145 m acc 50 OK (positive control)', x.ok && x.rows[0].already === false, x)
x = await ci(U(1), 1, 35.0005, 33, 10); ok('same day -> already', x.ok && x.rows[0].already === true, x)
x = await ci(U(1), 2, 35.27, 33, 10); ok('30 km in seconds -> TOO_FAST', x.msg === 'TOO_FAST', x)
x = await ci(U(1), 3, 35.004, 33, 10); ok('445 m away place -> allowed (1 km floor)', x.ok && x.rows[0].already === false, x)
x = await ci(U(3), 1, 35.0, 33, 10); ok('minor checks in', x.ok, x)
x = await ci(U(4), 1, 35.0, 33, 10); ok('blocker checks in', x.ok, x)
x = await ci(U(7), 1, 35.0, 33, 10); ok('optout checks in', x.ok, x)
x = await as(U(2), `SELECT display_name, is_mine FROM public.get_checkin_feed() ORDER BY display_name`)
ok('viewer feed = adult x2 + blocker only', x.ok && JSON.stringify(x.rows.map(r => r.display_name).sort()) === '["adult","adult","blocker"]', x)
x = await as(U(4), `SELECT display_name, is_mine FROM public.get_checkin_feed('${P(1)}')`)
ok('blocker sees own only (blocked adult absent)', x.ok && x.rows.length === 1 && x.rows[0].is_mine, x)
x = await as(U(1), `SELECT display_name FROM public.get_checkin_feed('${P(1)}')`)
ok('blocked adult does not see blocker', x.ok && !x.rows.some(r => r.display_name === 'blocker'), x)
x = await as(U(3), `SELECT display_name, is_mine FROM public.get_checkin_feed('${P(1)}')`)
ok('minor sees own hidden row', x.ok && x.rows.some(r => r.display_name === 'minor' && r.is_mine), x)
x = await as(U(2), `SELECT checkin_id, created_at FROM public.get_checkin_feed(null, null, null, 1)`)
const first = x.rows?.[0]
x = await as(U(2), `SELECT checkin_id FROM public.get_checkin_feed(null, '${first?.created_at?.toISOString()}', '${first?.checkin_id}', 50)`)
ok('page 2 excludes page 1 row', x.ok && x.rows.length === 2 && !x.rows.some(r => r.checkin_id === first.checkin_id), x)
x = await as(U(2), `INSERT INTO public.checkins (user_id, place_id, checked_in_on, display_name_snapshot) VALUES ('${U(2)}','${P(5)}', current_date, 'x')`)
ok('direct insert denied', !x.ok && /permission denied/.test(x.msg), x)
x = await as(U(2), `DELETE FROM public.checkins WHERE user_id = '${U(1)}' RETURNING id`); ok('cannot delete others', x.ok && x.rows.length === 0, x)
x = await as(U(1), `DELETE FROM public.checkins WHERE user_id = '${U(1)}' AND place_id = '${P(3)}' RETURNING id`); ok('owner deletes own', x.ok && x.rows.length === 1, x)
x = await as(U(2), `SELECT count(*)::int n FROM public.checkins`); ok('viewer reads 0 rows of table', x.ok && x.rows[0].n === 0, x)
await db.exec(`UPDATE public.profiles SET display_name = 'renamed' WHERE id = '${U(1)}'`)
x = await as(U(2), `SELECT display_name FROM public.get_checkin_feed('${P(1)}')`); ok('snapshot name kept', x.ok && x.rows.some(r => r.display_name === 'adult') && !x.rows.some(r => r.display_name === 'renamed'), x)
x = await as(U(1), `SELECT * FROM public.metres_between(1,1,1,1)`); ok('metres_between not client-callable', !x.ok, x)
console.log(`${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)

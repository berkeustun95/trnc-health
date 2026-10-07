// 20261092 + 20261093 against PRODUCTION's live-only profiles triggers (check_profile_name_content,
// guard_profile_ban), copied verbatim into scripts/fixtures/profiles-triggers-live-2026-10-07.sql.
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-checkins-live-triggers.mjs
// The question (CLAUDE.md check-ins go-live step 2): do those triggers block accept_checkin_notice's
// UPDATE, the first-check-in username save, or a check-in — and does the new
// guard_checkin_notice_columns trigger break ordinary profile writes? Stubs, NOT prod: the four
// helpers the name trigger calls (contains_blocked_term: only 'badword'; normalize_display_name:
// lower+trim; is_reserved_display_name: 'admin'; get_my_role: 'customer').
import { readFileSync } from 'fs'
import { fileURLToPath } from 'node:url'
import { freshDb, applyFile } from './migration-harness.mjs'
const base = readFileSync(new URL('./test-checkins-sql.mjs', import.meta.url), 'utf8')
const SEED = base.match(/const SEED = `([\s\S]*?)`\.replace/)[1].replace(/'u0000000[^']*'::text::uuid/, "'b0000000-0000-4000-8000-000000000009'")
const U = n => `b0000000-0000-4000-8000-00000000000${n}`
const P = n => `a0000000-0000-4000-8000-00000000000${n}`
const db = await freshDb(SEED)
await db.exec(`
  ALTER TABLE public.profiles ADD COLUMN first_name text, ADD COLUMN last_name text, ADD COLUMN full_name text,
    ADD COLUMN display_name_normalized text, ADD COLUMN resident_status text, ADD COLUMN resident_status_updated_at timestamptz,
    ADD COLUMN terms_version text, ADD COLUMN terms_accepted_at timestamptz, ADD COLUMN marketing_opt_in_at timestamptz;
  CREATE FUNCTION public.contains_blocked_term(t text) RETURNS boolean LANGUAGE sql AS $f$ SELECT t ILIKE '%badword%' $f$;
  CREATE FUNCTION public.normalize_display_name(t text) RETURNS text LANGUAGE sql AS $f$ SELECT nullif(lower(btrim(t)), '') $f$;
  CREATE FUNCTION public.is_reserved_display_name(t text) RETURNS boolean LANGUAGE sql AS $f$ SELECT t = 'admin' $f$;
  CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql AS $f$ SELECT 'customer'::text $f$;`)
await db.exec(readFileSync(new URL('./fixtures/profiles-triggers-live-2026-10-07.sql', import.meta.url), 'utf8'))
await db.exec(`INSERT INTO public.profiles (id, display_name, date_of_birth, terms_version, marketing_opt_in_at, first_name) VALUES
  ('${U(1)}', NULL, '1990-01-01', '2026-09-27', now(), 'Ada'), ('${U(2)}', 'viewer', '1990-01-01', '2026-09-27', NULL, NULL);
  INSERT INTO auth.users (id) SELECT id FROM public.profiles ON CONFLICT DO NOTHING;
  UPDATE public.profiles SET terms_accepted_at = '2026-09-27 10:00+00', marketing_opt_in_at = '2026-09-01 10:00+00';`)
for (const f of ['20261092_checkins.sql', '20261093_checkins_google_places.sql']) {
  const r = await applyFile(db, fileURLToPath(new URL(`../supabase/migrations/${f}`, import.meta.url)))
  if (!r.ok) { console.log('APPLY FAILED', f, r.msg); process.exit(1) }
}
let pass = 0, fail = 0
const ok = (n, c, g) => { if (c) pass++; else { fail++; console.log('FAIL', n, JSON.stringify(g)) } }
async function as(uid, sql, role = 'authenticated') {
  await db.exec('RESET ROLE;')
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [uid ? JSON.stringify({ sub: uid, role }) : ''])
  await db.exec(`SET ROLE ${role};`)
  try { return { ok: true, rows: (await db.query(sql)).rows } } catch (e) { return { ok: false, msg: String(e.message).split('\n')[0] } }
  finally { await db.exec('RESET ROLE;') }
}
const before = (await db.query(`SELECT terms_accepted_at, marketing_opt_in_at FROM public.profiles WHERE id = '${U(1)}'`)).rows[0]
let x
x = await as(U(1), `UPDATE public.profiles SET display_name = 'Gezgin' WHERE id = '${U(1)}' RETURNING display_name_normalized`)
ok('first-check-in username save passes the live name trigger', x.ok && x.rows[0]?.display_name_normalized === 'gezgin', x)
x = await as(U(1), `UPDATE public.profiles SET display_name = 'my badword' WHERE id = '${U(1)}'`)
ok('…and the live trigger still refuses a blocked name (positive control)', x.msg === 'BLOCKED_TERM', x)
x = await as(U(1), `SELECT public.accept_checkin_notice('2026-10-07') AS v`)
ok('accept_checkin_notice passes both live triggers (adult -> true)', x.ok && x.rows[0].v === true, x)
const after = (await db.query(`SELECT terms_accepted_at, marketing_opt_in_at, checkins_notice_at, checkins_notice_version FROM public.profiles WHERE id = '${U(1)}'`)).rows[0]
ok('notice stamped by the server', after.checkins_notice_at && after.checkins_notice_version === '2026-10-07', after)
ok('terms_accepted_at and marketing_opt_in_at untouched by the notice UPDATE', +after.terms_accepted_at === +before.terms_accepted_at && +after.marketing_opt_in_at === +before.marketing_opt_in_at, { before, after })
x = await as(U(1), `UPDATE public.profiles SET checkins_notice_at = now() WHERE id = '${U(1)}'`)
ok('direct notice write still refused with live triggers present', x.msg === 'CHECKIN_NOTICE_SERVER_ONLY', x)
x = await as(U(2), `UPDATE public.profiles SET first_name = 'Ayşe', checkins_public = false WHERE id = '${U(2)}' RETURNING full_name, checkins_public`)
ok('ordinary profile edit + the hide switch work (new BEFORE UPDATE trigger is silent)', x.ok && x.rows[0].full_name === 'Ayşe' && x.rows[0].checkins_public === false, x)
x = await as(U(2), `UPDATE public.profiles SET ugc_banned_until = now() + interval '1 day' WHERE id = '${U(2)}'`)
ok('guard_profile_ban still refuses a self-unban/ban (positive control)', x.msg === 'ugc_banned_until is admin-only', x)
x = await as(U(1), `SELECT * FROM public.check_in('${P(1)}', 35.0005, 33.0, 10)`)
ok('check_in works with the live triggers present', x.ok && x.rows[0].already === false, x)
x = await as(null, `SELECT * FROM public.check_in_google('${U(1)}', 'ChIJgooglePlace000001', 35.0, 33.0, 35.0005, 33.0, 10, true)`, 'service_role')
ok('check_in_google works with the live triggers present', x.ok && x.rows[0].already === false, x)
console.log(`${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)

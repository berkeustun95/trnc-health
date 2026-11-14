// Onboarding v2 S1: 20261201_set_guest_push.sql + 20261202_onboarding_events.sql on the PGlite harness
// (PostgreSQL 18; prod is 17.6, see supabase/CLAUDE.md). Run by hand:
//
//   node scripts/test-onboarding-s1-sql.mjs
//
// Fixture: auth.users(id, is_anonymous, created_at); auth.jwt() and is_anonymous_session() as the real ones read the
// JWT claim; profiles with the real FK (ON DELETE CASCADE) and RLS (owner read/update + the RESTRICTIVE
// no_anon_update_profiles), so a guest's direct UPDATE is refused just as it is live.
// What a pass is evidence of: who can call set_guest_push and what it changes, the purge guard, the onboarding_events
// grants / policies / checks, the verify_schema 1201 / 1202 tokens (red before, green after) and the readonly baseline
// probe's arithmetic. NOT evidence of: PostgREST, the live trigger set on profiles (the fixture has none), or whether
// prod's function owner bypasses RLS (PGlite's postgres is a superuser, so that assertion always passes here).
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshDb, applyFile } from './migration-harness.mjs'

const rel = p => fileURLToPath(new URL(p, import.meta.url))
const FA = rel('../supabase/migrations/20261201_set_guest_push.sql')
const FB = rel('../supabase/migrations/20261202_onboarding_events.sql')
const SQLA = readFileSync(FA, 'utf8'), SQLB = readFileSync(FB, 'utf8')
const VS = readFileSync(rel('../supabase/verify_schema.sql'), 'utf8')
const PROBE = readFileSync(rel('../supabase/readonly/onboarding_push_baseline.sql'), 'utf8')
const I18N = readFileSync(rel('../constants/i18n.js'), 'utf8')

const U = {
  G1: '10000000-0000-4000-8000-000000000001',  // guest
  G2: '10000000-0000-4000-8000-000000000002',  // another guest
  S1: '20000000-0000-4000-8000-000000000001',  // signed-up user
  G9: '10000000-0000-4000-8000-000000000009',  // guest with an auth row but no profiles row
}
const OLD_TOKEN = 'ExponentPushToken[OLDOLDOLD0000]'
const fixture = (fk = 'ON DELETE CASCADE', fkName = 'profiles_id_fkey') => `
ALTER TABLE auth.users ADD COLUMN is_anonymous boolean NOT NULL DEFAULT false, ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
  AS $j$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb $j$;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.is_anonymous_session() RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
  AS $function$ SELECT coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) $function$;
CREATE TABLE public.profiles (
  id uuid NOT NULL, role text NOT NULL DEFAULT 'customer', push_token text, preferred_language text,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT ${fkName} FOREIGN KEY (id) REFERENCES auth.users(id) ${fk});
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner read" ON public.profiles FOR SELECT TO public USING (auth.uid() = id);
CREATE POLICY "owner update" ON public.profiles FOR UPDATE TO public USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "no_anon_update_profiles" ON public.profiles AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT is_anonymous_session()) WITH CHECK (NOT is_anonymous_session());
INSERT INTO auth.users (id, is_anonymous) VALUES ('${U.G1}', true), ('${U.G2}', true), ('${U.S1}', false), ('${U.G9}', true);
INSERT INTO public.profiles (id, push_token, preferred_language) VALUES
  ('${U.G1}', NULL, NULL), ('${U.G2}', '${OLD_TOKEN}', 'Greek'), ('${U.S1}', '${OLD_TOKEN}', 'German');
`

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}

// as(): 'anon' = anon role, no JWT. 'nojwt' = authenticated role, no JWT. 'svc' = service_role, no JWT. 'pg' = postgres.
// Otherwise [uid, isAnon] where isAnon is true / false / undefined (claim absent).
async function as(db, who, sql, params = []) {
  let role = 'authenticated', claims = ''
  if (who === 'anon') role = 'anon'
  else if (who === 'pg') role = null
  else if (who === 'svc') role = 'service_role'
  else if (who !== 'nojwt' && who !== 'pg') {
    const [sub, isAnon] = who
    const c = { sub, role: 'authenticated' }
    if (isAnon !== undefined) c.is_anonymous = isAnon
    claims = JSON.stringify(c)
  }
  try {
    await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [claims])
    if (role) await db.exec(`SET ROLE ${role};`)
    const r = await db.query(sql, params)
    return { ok: true, rows: r.rows }
  } catch (e) { return { ok: false, code: e.code, msg: String(e.message || e).split('\n')[0] } }
  finally { await db.exec('RESET ROLE;'); await db.query(`SELECT set_config('request.jwt.claims', '', false)`) }
}
const call = (db, who, tok, lang) => as(db, who, 'SELECT public.set_guest_push($1, $2)', [tok, lang])
const rows = async db => (await db.query(`SELECT id::text, push_token, preferred_language FROM public.profiles ORDER BY id`)).rows
const row = async (db, id) => (await rows(db)).find(r => r.id === id) || null
const outcome = r => r.ok ? 'ok' : (r.code === 'P0001' ? r.msg : `${r.code} ${r.msg}`)

const build = async ({ fk, fkName, a = FA, b = FB } = {}) => {
  const db = await freshDb(fixture(fk, fkName))
  const ra = await applyFile(db, a)
  if (!ra.ok) return { db, err: 'A: ' + ra.msg }
  if (b) { const rb = await applyFile(db, b); if (!rb.ok) return { db, err: 'B: ' + rb.msg } }
  return { db, err: null }
}

const dir = mkdtempSync(join(tmpdir(), 'onb-s1-'))
const mutant = (src, name, from, to) => {
  if (!src.includes(from)) { bad++; console.log(`  ✗ ${name}: anchor missing`); return null }
  const p = join(dir, name.replace(/\W+/g, '_') + '.sql'); writeFileSync(p, src.replace(from, () => to)); return p
}

// verify_schema token slices, evaluated as one query each.
const slice = (from, to) => { const x = VS.indexOf(from), y = VS.indexOf(to, x + 1); if (x < 0 || y < x) throw new Error('verify_schema anchors missing: ' + from); return VS.slice(x, y) }
const tokq = s => `SELECT m, label, ok FROM (SELECT ''::text m, ''::text label, false ok WHERE false\n${s}) z`
const T01 = tokq(slice('    -- 1201-BEGIN', '    -- 1201-END')), T02 = tokq(slice('    -- 1202-BEGIN', '    -- 1202-END'))
// want = an array of booleans, one per token in file order.
const tokens = async (db, label, sql, want) => {
  try {
    const r = (await db.query(sql)).rows
    t(`verify_schema ${label}: ${JSON.stringify(want)}`, r.map(x => x.ok), want)
    return r
  } catch (e) { t(`verify_schema ${label} does not error`, String(e.message).split('\n')[0], 'no error') }
}

const EVENTS = ['start_shown', 'offer_shown', 'offer_granted', 'offer_denied', 'offer_later', 'reoffer_shown', 'reoffer_granted',
  'reoffer_declined', 'reoffer_existing_shown', 'reoffer_existing_granted', 'reoffer_existing_declined']


// ════════════════════════════════════════════════════════════════════════════
console.log('0. verify_schema tokens, red first: a database WITHOUT the two files')
{
  const db = await freshDb(fixture())
  // 1201: the function token is red; the FK token is about the fixture's own FK, which exists before 1201.
  await tokens(db, '1201 before apply', T01, [false, true])
  await tokens(db, '1202 before apply', T02, [false])
  const nf = await freshDb(fixture('ON DELETE NO ACTION'))
  await tokens(nf, '1201 FK token on a NO ACTION FK', T01, [false, false])
}

console.log('1. both files apply, twice (re-runnable), and the tokens go green')
const { db, err } = await build()
t('A + B apply cleanly', err, null)
t('A applies a second time', await applyFile(db, FA), { ok: true, msg: null })
t('B applies a second time', await applyFile(db, FB), { ok: true, msg: null })
await tokens(db, '1201 after apply', T01, [true, true])
await tokens(db, '1202 after apply', T02, [true])
t('ledger rows written for both', (await db.query(`SELECT filename FROM public.schema_migrations_applied ORDER BY 1`)).rows.map(r => r.filename),
  ['20261201_set_guest_push.sql', '20261202_onboarding_events.sql'].filter(f => readFileSync(rel('../supabase/migrations/' + f), 'utf8').includes('ledger:stamp:begin')))
t('probe rows did not survive B', (await db.query(`SELECT count(*)::int n FROM public.onboarding_events`)).rows[0].n, 0)
t('current_user is postgres again after the files', (await db.query(`SELECT current_user::text u`)).rows[0].u, 'postgres')

console.log('2. set_guest_push: a guest sets its own token + language, then clears the token')
{
  const before = await rows(db)
  const tok = 'ExponentPushToken[AbC_-0123456789xyz]'
  t('guest G1 sets token + Turkish', outcome(await call(db, [U.G1, true], tok, 'Turkish')), 'ok')
  t('G1 row changed', await row(db, U.G1), { id: U.G1, push_token: tok, preferred_language: 'Turkish' })
  t('every other row untouched', (await rows(db)).filter(r => r.id !== U.G1), before.filter(r => r.id !== U.G1))
  t('guest G1 clears the token (NULL), language French', outcome(await call(db, [U.G1, true], null, 'French')), 'ok')
  t('G1 token NULL, language French', await row(db, U.G1), { id: U.G1, push_token: null, preferred_language: 'French' })
  t('every other row still untouched', (await rows(db)).filter(r => r.id !== U.G1), before.filter(r => r.id !== U.G1))
  // The function is the only door: the same guest's direct UPDATE is refused by no_anon_update_profiles.
  const direct = await as(db, [U.G1, true], `UPDATE public.profiles SET push_token = 'ExponentPushToken[DIRECTDIRECT]' WHERE id = '${U.G1}' RETURNING id`)
  t('guest direct UPDATE of its own row changes nothing (restrictive policy)', [direct.ok, direct.rows?.length ?? -1], [true, 0])
  t('  ...row unchanged', (await row(db, U.G1)).push_token, null)
  const sdirect = await as(db, [U.S1, false], `UPDATE public.profiles SET preferred_language = 'German' WHERE id = '${U.S1}' RETURNING id`)
  t('  positive control: a signed-up user CAN update its own row directly', [sdirect.ok, sdirect.rows?.length ?? -1], [true, 1])
}

console.log('3. a guest only ever reaches auth.uid()\'s row')
{
  const before = await rows(db)
  t('guest G2 sets its token', outcome(await call(db, [U.G2, true], 'ExponentPushToken[G2G2G2G2G2G2]', 'Arabic')), 'ok')
  const after = await rows(db)
  t('only G2 changed', after.filter(r => r.id !== U.G2), before.filter(r => r.id !== U.G2))
  t('G2 has its own token', (await row(db, U.G2)).push_token, 'ExponentPushToken[G2G2G2G2G2G2]')
  t('a guest with no profiles row: no_profile, nothing changed', [outcome(await call(db, [U.G9, true], 'ExponentPushToken[G9G9G9G9G9G9]', 'English')), await rows(db)], ['no_profile', after])
}

console.log('4. who may call it')
{
  const before = await rows(db)
  t('signed-up user (is_anonymous false): guest_only', outcome(await call(db, [U.S1, false], 'ExponentPushToken[S1S1S1S1S1S1]', 'English')), 'guest_only')
  t('signed-up user (claim absent): guest_only', outcome(await call(db, [U.S1, undefined], 'ExponentPushToken[S1S1S1S1S1S1]', 'English')), 'guest_only')
  t('authenticated role, no JWT: guest_only', outcome(await call(db, 'nojwt', 'ExponentPushToken[S1S1S1S1S1S1]', 'English')), 'guest_only')
  const an = await call(db, 'anon', 'ExponentPushToken[ANANANANANAN]', 'English')
  t('anon role (no session): permission denied, 42501', [an.ok, an.code], [false, '42501'])
  const sv = await call(db, 'svc', 'ExponentPushToken[SVSVSVSVSVSV]', 'English')
  t('service_role: permission denied, 42501', [sv.ok, sv.code], [false, '42501'])
  t('none of those changed a row', await rows(db), before)
  t('positive control beside them: the guest call still works', outcome(await call(db, [U.G1, true], 'ExponentPushToken[G1G1G1G1G1G1]', 'English')), 'ok')
  const priv = (await db.query(`SELECT has_function_privilege('anon','public.set_guest_push(text,text)','EXECUTE') a,
    has_function_privilege('authenticated','public.set_guest_push(text,text)','EXECUTE') u,
    has_function_privilege('service_role','public.set_guest_push(text,text)','EXECUTE') s,
    (SELECT proacl::text FROM pg_proc WHERE proname = 'set_guest_push') acl`)).rows[0]
  t('EXECUTE: anon no, authenticated yes, service_role no', [priv.a, priv.u, priv.s], [false, true, false])
  console.log('      proacl:', priv.acl)
}

console.log('5. token and language validation')
{
  const before = await rows(db)
  for (const tok of ['ExpoPushToken[abcdefghijk]', 'ExponentPushToken[short]', 'ExponentPushToken[abc def ghij]', 'ExponentPushToken[abcdefghij.k]',
                     '', 'ExponentPushToken[abcdefghijk]x', 'xExponentPushToken[abcdefghijk]', 'ExponentPushToken[]', 'ExponentPushToken[abcdefghijk]\n'])
    t(`token ${JSON.stringify(tok)} refused`, outcome(await call(db, [U.G1, true], tok, 'English')), 'bad_token')
  for (const lang of ['tr', 'en', 'turkish', 'TURKISH', 'Kurdish', '', null])
    t(`language ${JSON.stringify(lang)} refused`, outcome(await call(db, [U.G1, true], 'ExponentPushToken[abcdefghijk]', lang)), 'bad_lang')
  t('none of the refusals changed a row', await rows(db), before)
  t('token of exactly 10 inner characters accepted (boundary)', outcome(await call(db, [U.G1, true], 'ExponentPushToken[abcdefghij]', 'English')), 'ok')
  t('token of 9 inner characters refused (boundary)', outcome(await call(db, [U.G1, true], 'ExponentPushToken[abcdefghi]', 'English')), 'bad_token')
  t('token of exactly 64 inner characters accepted (upper boundary)', outcome(await call(db, [U.G1, true], 'ExponentPushToken[' + 'a'.repeat(64) + ']', 'English')), 'ok')
  t('token of 65 inner characters refused (upper boundary)', outcome(await call(db, [U.G1, true], 'ExponentPushToken[' + 'a'.repeat(65) + ']', 'English')), 'bad_token')

  // The nine names, read from constants/i18n.js LANGUAGES and compared to the SQL list.
  const block = I18N.slice(I18N.indexOf('export const LANGUAGES = ['), I18N.indexOf(']', I18N.indexOf('export const LANGUAGES = [')))
  const fromI18n = [...block.matchAll(/key:\s*'([^']+)'/g)].map(m => m[1])
  const arr = SQLA.match(/p_lang <> ALL \(ARRAY\[([^\]]+)\]\)/)
  const fromSql = arr ? [...arr[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : []
  t('LANGUAGES has 9 keys', fromI18n.length, 9)
  t('the SQL list equals LANGUAGES keys (same order)', fromSql, fromI18n)
  for (const lang of fromI18n) {
    const r = outcome(await call(db, [U.G1, true], 'ExponentPushToken[abcdefghijk]', lang))
    t(`  ${lang} accepted and stored`, [r, (await row(db, U.G1)).preferred_language], ['ok', lang])
  }
}

console.log('6. the purge: deleting the guest\'s auth user removes its profiles row and token')
{
  t('G1 holds a token before', (await row(db, U.G1)).push_token !== null, true)
  await db.exec(`DELETE FROM auth.users WHERE id = '${U.G1}'`)
  t('G1 profiles row gone', await row(db, U.G1), null)
  t('no row holds G1\'s token', (await db.query(`SELECT count(*)::int n FROM public.profiles WHERE push_token = 'ExponentPushToken[abcdefghijk]'`)).rows[0].n, 0)
  t('other rows still there', (await rows(db)).map(r => r.id), [U.G2, U.S1])
}

console.log('7. onboarding_events')
{
  const who = { anon: 'anon', guest: [U.G2, true], user: [U.S1, false] }
  for (const [w, c] of Object.entries(who)) {
    const res = []
    for (const e of EVENTS) res.push(outcome(await as(db, c, `INSERT INTO public.onboarding_events (event, platform, runtime_version) VALUES ($1, $2, $3)`, [e, e.length % 2 ? 'ios' : 'android', '1.4.2'])))
    t(`${w}: all 11 events insert`, res, EVENTS.map(() => 'ok'))
    t(`${w}: runtime_version NULL is fine`, outcome(await as(db, c, `INSERT INTO public.onboarding_events (event, platform) VALUES ('offer_shown', 'ios')`)), 'ok')
    t(`${w}: 64-char runtime_version is fine (boundary)`, outcome(await as(db, c, `INSERT INTO public.onboarding_events (event, platform, runtime_version) VALUES ('offer_shown', 'ios', repeat('9', 64))`)), 'ok')
    const deny = async (sql) => { const r = await as(db, c, sql); return r.ok ? 'ALLOWED' : r.code }
    t(`${w}: bad event refused`, await deny(`INSERT INTO public.onboarding_events (event, platform) VALUES ('offer_maybe', 'ios')`) !== 'ALLOWED', true)
    t(`${w}: bad platform refused`, await deny(`INSERT INTO public.onboarding_events (event, platform) VALUES ('offer_shown', 'web')`) !== 'ALLOWED', true)
    t(`${w}: 65-char runtime refused`, await deny(`INSERT INTO public.onboarding_events (event, platform, runtime_version) VALUES ('offer_shown', 'ios', repeat('9', 65))`) !== 'ALLOWED', true)
    t(`${w}: insert of id refused (42501)`, await deny(`INSERT INTO public.onboarding_events (id, event, platform) OVERRIDING SYSTEM VALUE VALUES (-5, 'offer_shown', 'ios')`), '42501')
    t(`${w}: insert of created_at refused (42501)`, await deny(`INSERT INTO public.onboarding_events (event, platform, created_at) VALUES ('offer_shown', 'ios', now() - interval '1 year')`), '42501')
    t(`${w}: SELECT denied (42501)`, await deny(`SELECT count(*) FROM public.onboarding_events`), '42501')
    t(`${w}: UPDATE denied (42501)`, await deny(`UPDATE public.onboarding_events SET event = 'start_shown' WHERE true`), '42501')
    t(`${w}: DELETE denied (42501)`, await deny(`DELETE FROM public.onboarding_events WHERE true`), '42501')
    t(`${w}: insert … RETURNING denied (needs SELECT; the app must not ask for the row back)`, await deny(`INSERT INTO public.onboarding_events (event, platform) VALUES ('offer_shown', 'ios') RETURNING id`), '42501')
  }
  // Read back as postgres (a role allowed to read them): the rows the three callers wrote, and only those.
  const got = (await db.query(`SELECT count(*)::int n, count(DISTINCT event)::int e, min(created_at) > now() - interval '1 minute' fresh FROM public.onboarding_events`)).rows[0]
  t('as postgres: 3 × (11 + 2) rows, all 11 events, server-stamped now', [got.n, got.e, got.fresh], [39, 11, true])
  t('the CHECK itself refuses a bad event even for postgres (constraint, not just policy)',
    (await as(db, 'pg', `INSERT INTO public.onboarding_events (event, platform) VALUES ('nope', 'ios')`)).code, '23514')
}

console.log('8. readonly probe supabase/readonly/onboarding_push_baseline.sql')
{
  const pdb = await freshDb(fixture())
  const run = async () => (await pdb.query(PROBE)).rows
  t('empty denominator: one row, one column, \'n/a\'', await run(), [{ push_token_share_signed_up_30d: 'n/a' }])
  // Fixture rows above are created now() (today, excluded). Add signed-up accounts in the window and outside it.
  await pdb.exec(`
    INSERT INTO auth.users (id, is_anonymous, created_at) VALUES
      ('30000000-0000-4000-8000-000000000001', false, current_date - 1),
      ('30000000-0000-4000-8000-000000000002', false, current_date - 10),
      ('30000000-0000-4000-8000-000000000003', false, current_date - 30),
      ('30000000-0000-4000-8000-000000000004', false, current_date - 31),
      ('30000000-0000-4000-8000-000000000005', true,  current_date - 2);
    INSERT INTO public.profiles (id, push_token) VALUES
      ('30000000-0000-4000-8000-000000000001', 'ExponentPushToken[aaaaaaaaaaaa]'),
      ('30000000-0000-4000-8000-000000000002', NULL),
      ('30000000-0000-4000-8000-000000000003', NULL),
      ('30000000-0000-4000-8000-000000000004', 'ExponentPushToken[bbbbbbbbbbbb]'),
      ('30000000-0000-4000-8000-000000000005', 'ExponentPushToken[cccccccccccc]');`)
  t('1 of 3 in-window signed-up accounts has a token → 33% (31-day-old, today\'s and the guest excluded)', await run(), [{ push_token_share_signed_up_30d: '33%' }])
  await pdb.exec(`UPDATE public.profiles SET push_token = 'ExponentPushToken[dddddddddddd]' WHERE id = '30000000-0000-4000-8000-000000000002'`)
  t('2 of 3 → 67% (rounded)', await run(), [{ push_token_share_signed_up_30d: '67%' }])
}

console.log('MUTANTS (each must be refused by the guarding layer named)')
const refusedA = async (name, p, wantMsg, fk, fkName) => {
  if (!p) return
  const r = await build({ a: p, b: null, fk, fkName })
  t(`${name}: migration A refuses`, r.err !== null, true)
  t(`  message mentions "${wantMsg}"`, (r.err || '').includes(wantMsg), true)
  console.log(`      ${r.err}`)
}
const refusedB = async (name, p, wantMsg) => {
  if (!p) return
  const r = await build({ b: p })
  t(`${name}: migration B refuses`, r.err !== null && r.err.startsWith('B:'), true)
  t(`  message mentions "${wantMsg}"`, (r.err || '').includes(wantMsg), true)
  console.log(`      ${r.err}`)
}
// Applies cleanly; caught by the behaviour cases above re-run on the mutant, and by the 1201 token.
const behaves = async (name, p, check) => {
  if (!p) return
  const r = await build({ a: p })
  t(`${name}: applies (the file cannot see it)`, r.err, null)
  await check(r.db)
  await tokens(r.db, `${name}: 1201 tokens`, T01, [false, true])
}

const GUARD = "  IF public.is_anonymous_session() IS NOT TRUE THEN\n    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest_only';\n  END IF;\n"
await behaves('guest guard removed', mutant(SQLA, 'guard', GUARD, ''), async m => {
  t('  a signed-up user is NO LONGER refused (case 4 flips)', outcome(await call(m, [U.S1, false], 'ExponentPushToken[S1S1S1S1S1S1]', 'English')), 'ok')
})
await behaves('WHERE widened to every row', mutant(SQLA, 'where', 'WHERE id = auth.uid();', 'WHERE id = auth.uid() OR true;'), async m => {
  const before = await rows(m)
  t('  the guest call is refused by the exactly-one-row check', outcome(await call(m, [U.G1, true], 'ExponentPushToken[WIDEWIDEWIDE]', 'English')), 'no_profile')
  t('  and no row changed', await rows(m), before)
})
await behaves('regex loosened to {1,64}', mutant(SQLA, 'regex', '[A-Za-z0-9_-]{10,64}', '[A-Za-z0-9_-]{1,64}'), async m => {
  t('  a short token is NO LONGER refused (case 5 flips)', outcome(await call(m, [U.G1, true], 'ExponentPushToken[short]', 'English')), 'ok')
})
await behaves('regex cap removed ({10,})', mutant(SQLA, 'cap', '[A-Za-z0-9_-]{10,64}', '[A-Za-z0-9_-]{10,}'), async m => {
  t('  a 65-char token is NO LONGER refused (case 5 flips)', outcome(await call(m, [U.G1, true], 'ExponentPushToken[' + 'a'.repeat(65) + ']', 'English')), 'ok')
})
await refusedA('EXECUTE granted to anon', mutant(SQLA, 'anon', 'TO authenticated;\n', 'TO authenticated;\nGRANT EXECUTE ON FUNCTION public.set_guest_push(text, text) TO anon;\n'), 'anon can EXECUTE')
await refusedA('PUBLIC left in place', mutant(SQLA, 'public', 'FROM PUBLIC, anon, authenticated, service_role;', 'FROM anon, authenticated, service_role;'), 'PUBLIC can EXECUTE')
await refusedA('service_role granted', mutant(SQLA, 'svc', 'TO authenticated;\n', 'TO authenticated, service_role;\n'), 'service_role can EXECUTE')
await refusedA('EXECUTE not granted to authenticated', mutant(SQLA, 'noauth', 'GRANT EXECUTE ON FUNCTION public.set_guest_push(text, text) TO authenticated;\n', ''), 'authenticated cannot EXECUTE')
await refusedA('SECURITY INVOKER', mutant(SQLA, 'invoker', 'SECURITY DEFINER\nSET search_path', 'SECURITY INVOKER\nSET search_path'), 'not SECURITY DEFINER')
await refusedA('search_path = public', mutant(SQLA, 'sp', "SET search_path = ''\nAS $function$", "SET search_path = public\nAS $function$"), 'search_path')
await refusedA('fixture FK is ON DELETE NO ACTION', FA, 'does not cascade (profiles_id_fkey (on delete a))', 'ON DELETE NO ACTION')
{
  // Found by shape, not by name: a renamed FK that cascades is accepted, a renamed one that does not is refused BY ITS NEW NAME.
  const ok = await build({ b: null, fkName: 'zz_renamed_profile_user_fk' })
  t('fixture FK renamed, still CASCADE: migration A applies', ok.err, null)
  await refusedA('fixture FK renamed and RESTRICT', FA, 'does not cascade (zz_renamed_profile_user_fk (on delete r))', 'ON DELETE RESTRICT', 'zz_renamed_profile_user_fk')
}
{
  // No FK at all: build the fixture, drop it, then apply.
  const d = await freshDb(fixture())
  await d.exec('ALTER TABLE public.profiles DROP CONSTRAINT profiles_id_fkey')
  const r = await applyFile(d, FA)
  t('fixture FK dropped: migration A refuses', r.ok, false)
  t('  message mentions "found: (none)"', (r.msg || '').includes('found: (none)'), true)
  console.log(`      ${r.msg}`)
}
await refusedB('SELECT granted on events', mutant(SQLB, 'select', 'TO anon, authenticated;\n\nDROP POLICY IF EXISTS oe_insert_public', 'TO anon, authenticated;\nGRANT SELECT ON public.onboarding_events TO authenticated;\n\nDROP POLICY IF EXISTS oe_insert_public'), 'authenticated holds SELECT')
await refusedB('REVOKE dropped (default ALL stays)', mutant(SQLB, 'revoke', 'REVOKE ALL ON public.onboarding_events FROM anon, authenticated;\n', ''), 'holds SELECT')
await refusedB('created_at made insertable', mutant(SQLB, 'cols', 'GRANT INSERT (event, platform, runtime_version)', 'GRANT INSERT (event, platform, runtime_version, created_at)'), 'backdate')
{
  const x = SQLB.indexOf('  WITH CHECK (\n    event = ANY'), y = SQLB.indexOf('<= 64)\n  );', x)
  const wc = x < 0 || y < 0 ? '\u0000anchor missing' : SQLB.slice(x, y + '<= 64)\n  );'.length)
  await refusedB('INSERT policy WITH CHECK (true)', mutant(SQLB, 'wc', wc, '  WITH CHECK (true);'), 'does not repeat')
}
await refusedB('a fourth (SELECT) policy', mutant(SQLB, 'pol', '-- ─── Assertions.', 'CREATE POLICY oe_read ON public.onboarding_events FOR SELECT TO authenticated USING (true);\n-- ─── Assertions.'), 'exactly 3 policies')
await refusedB('INSERT policy to anon only', mutant(SQLB, 'anononly', "CREATE POLICY oe_insert_public ON public.onboarding_events\n  FOR INSERT TO anon, authenticated", "CREATE POLICY oe_insert_public ON public.onboarding_events\n  FOR INSERT TO anon"), 'behaved wrongly')

console.log('DRIFT AFTER A CLEAN APPLY (fresh database each; the drift is checked to have landed, then the tokens must notice)')
const drift = async (name, sql, landedSql, want01, want02) => {
  const r = await build()
  t(`${name}: both files apply first`, r.err, null)
  if (r.err) return
  await tokens(r.db, `${name}: clean-apply control 1201`, T01, [true, true])
  await tokens(r.db, `${name}: clean-apply control 1202`, T02, [true])
  try { await r.db.exec(sql) } catch (e) { t(`${name}: drift SQL runs`, String(e.message).split('\n')[0], 'no error'); return }
  const landed = (await r.db.query(landedSql)).rows[0]
  t(`${name}: the drift landed`, landed.v, true)
  console.log(`      read back: ${JSON.stringify(landed)}`)
  await tokens(r.db, `${name}: 1201`, T01, want01)
  await tokens(r.db, `${name}: 1202`, T02, want02)
}
await drift('GRANT SELECT to authenticated', `GRANT SELECT ON public.onboarding_events TO authenticated;`,
  `SELECT has_table_privilege('authenticated', 'public.onboarding_events', 'SELECT') v`, [true, true], [false])
await drift('a 4th policy on onboarding_events', `CREATE POLICY oe_read ON public.onboarding_events FOR SELECT TO authenticated USING (true);`,
  `SELECT count(*) = 4 v, string_agg(policyname, ',' ORDER BY policyname) names FROM pg_policies WHERE schemaname = 'public' AND tablename = 'onboarding_events'`, [true, true], [false])
await drift('GRANT EXECUTE to anon', `GRANT EXECUTE ON FUNCTION public.set_guest_push(text,text) TO anon;`,
  `SELECT has_function_privilege('anon', 'public.set_guest_push(text,text)', 'EXECUTE') v, (SELECT proacl::text FROM pg_proc WHERE proname = 'set_guest_push') acl`, [false, true], [true])
await drift('SECURITY INVOKER', `ALTER FUNCTION public.set_guest_push(text,text) SECURITY INVOKER;`,
  `SELECT NOT prosecdef v FROM pg_proc WHERE proname = 'set_guest_push'`, [false, true], [true])
await drift('profiles FK to NO ACTION', `ALTER TABLE public.profiles DROP CONSTRAINT profiles_id_fkey,
  ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE NO ACTION;`,
  `SELECT confdeltype = 'a' v, confdeltype::text del FROM pg_constraint WHERE conname = 'profiles_id_fkey'`, [true, false], [true])
// Red cases for the two conditions item 3 added to the 1201 tokens (owner pin, confkey).
await drift('function owner changed', `CREATE ROLE onb_s1_other_owner; ALTER FUNCTION public.set_guest_push(text,text) OWNER TO onb_s1_other_owner;`,
  `SELECT pg_get_userbyid(proowner) = 'onb_s1_other_owner' v, pg_get_userbyid(proowner) owner FROM pg_proc WHERE proname = 'set_guest_push'`, [false, true], [true])
await drift('profiles FK re-pointed at another auth.users column (CASCADE kept)', `ALTER TABLE auth.users ADD COLUMN alt_id uuid UNIQUE;
  UPDATE auth.users SET alt_id = id;
  ALTER TABLE public.profiles DROP CONSTRAINT profiles_id_fkey,
  ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(alt_id) ON DELETE CASCADE;`,
  `SELECT pg_get_constraintdef(oid) LIKE '%REFERENCES auth.users(alt_id) ON DELETE CASCADE%' v, pg_get_constraintdef(oid) def FROM pg_constraint WHERE conname = 'profiles_id_fkey'`, [true, false], [true])

console.log(bad ? `\n${bad} FAILED` : '\nALL PASS')
process.exit(bad ? 1 : 0)

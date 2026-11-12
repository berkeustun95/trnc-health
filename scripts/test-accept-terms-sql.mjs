// 20261191 (accept_terms + the soft guard on direct terms writes) against the REAL production profiles triggers
// (scripts/fixtures/profiles-triggers-live-2026-10-07.sql: check_profile_name_content with branch (g), guard_profile_ban),
// with row level security and the real profiles policies seeded (a harness without RLS proves nothing about guests or other
// users). PGlite = PostgreSQL 18; prod is older: error words are compared, never SQLSTATEs or pg_get_*def renderings.
//   node scripts/test-accept-terms-sql.mjs
// A pass is evidence about: which call/write outcome follows from (caller, version, language, recorded version), the grants,
// the trigger/policy sets, the pre-flight. Not PostgREST, not the app's own code (see __tests__/acceptTerms*.test.js).
// Red-first: every refusal is also run on a MUTANT of the migration (the refusing text broken, an `assert anchor in text`
// first) and on the database WITHOUT 20261191, where it must NOT be refused; each is printed.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshDb, applyFile } from './migration-harness.mjs'

const rel = p => fileURLToPath(new URL(p, import.meta.url))
const F191 = rel('../supabase/migrations/20261191_accept_terms_server.sql')
const T191 = readFileSync(F191, 'utf8')
const TRIGGERS = readFileSync(rel('./fixtures/profiles-triggers-live-2026-10-07.sql'), 'utf8')
const PREREQ = readFileSync(rel('./fixtures/profiles-terms-prereqs.sql'), 'utf8')
const LEGAL = readFileSync(rel('../constants/legal/index.js'), 'utf8')
const I18N = readFileSync(rel('../constants/i18n.js'), 'utf8')
const dir = mkdtempSync(join(tmpdir(), 'accept-terms-'))

const U = {
  A: 'a1000000-0000-4000-8000-0000000000a1', B: 'b1000000-0000-4000-8000-0000000000b1',
  G: 'a2000000-0000-4000-8000-0000000000a2', X: 'e1000000-0000-4000-8000-0000000000e1',
  M: 'f1000000-0000-4000-8000-0000000000f1',   // an auth user with NO profiles row
}
const BASE = `
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $j$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb $j$;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text, display_name text, date_of_birth date, push_token text);
CREATE FUNCTION public.get_my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $f$ SELECT role FROM profiles WHERE id = auth.uid() $f$;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $f$ SELECT coalesce(get_my_role() = 'admin', false) $f$;
CREATE FUNCTION public.is_anonymous_session() RETURNS boolean LANGUAGE sql STABLE SET search_path TO ''
  AS $f$ SELECT coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) $f$;
GRANT EXECUTE ON FUNCTION public.get_my_role(), public.is_admin(), public.is_anonymous_session() TO anon, authenticated, service_role;
${PREREQ}
${TRIGGERS}
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner read" ON public.profiles FOR SELECT TO public USING (auth.uid() = id);
CREATE POLICY "admin read all" ON public.profiles FOR SELECT TO public USING (is_admin());
CREATE POLICY "owner update" ON public.profiles FOR UPDATE TO public USING (auth.uid() = id) WITH CHECK (auth.uid() = id AND role = get_my_role());
CREATE POLICY "admin update all" ON public.profiles FOR UPDATE TO public USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "no_anon_update_profiles" ON public.profiles AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT is_anonymous_session()) WITH CHECK (NOT is_anonymous_session());
CREATE POLICY "no_anon_insert_profiles" ON public.profiles AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT is_anonymous_session());
INSERT INTO auth.users VALUES ${Object.values(U).map(u => `('${u}')`).join(',')};
INSERT INTO public.profiles (id, role, display_name, date_of_birth) VALUES
  ('${U.A}', 'customer', 'Ayşe', '1990-01-01'), ('${U.B}', 'customer', 'Berk', '1991-01-01'),
  ('${U.G}', 'customer', NULL, NULL), ('${U.X}', 'admin', 'Yönetici', '1985-01-01');
`
async function build(file = F191) {
  const db = await freshDb(BASE)
  if (file) { const r = await applyFile(db, file); if (!r.ok) throw new Error('apply: ' + r.msg) }
  return db
}
// who: a key of U, 'G' = guest (is_anonymous), null = anon role (no session), 'svc' = service role, 'sql' = superuser, no JWT.
async function as(db, who, sql) {
  const claims = who === 'G' ? { sub: U.G, is_anonymous: true } : (who === null || who === 'svc' || who === 'sql') ? null : { sub: U[who] }
  try {
    await db.exec('RESET role;')
    await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [claims ? JSON.stringify(claims) : ''])
    if (who !== 'sql') await db.exec(who === null ? 'SET role anon;' : who === 'svc' ? 'SET role service_role;' : 'SET role authenticated;')
    const r = await db.query(sql)
    return { ok: true, rows: r.rows, value: r.rows[0] ? Object.values(r.rows[0])[0] : null }
  } catch (e) { return { ok: false, err: String(e.message).split('\n')[0] } } finally { await db.exec('RESET role;') }
}
const row = async (db, k) => (await as(db, 'sql', `SELECT terms_version v, terms_locale l, terms_accepted_at a FROM profiles WHERE id = '${U[k]}'`)).rows[0]
const accept = (db, who, v, l) => as(db, who, `SELECT accept_terms(${v === null ? 'NULL' : `'${v}'`}, ${l === null ? 'NULL' : `'${l}'`}) AS r`)
const direct = (db, who, k, set) => as(db, who, `UPDATE profiles SET ${set} WHERE id = '${U[k]}' RETURNING terms_version v`)
const seedTerms = (db, k, v, l = 'English') => as(db, 'sql', `UPDATE profiles SET terms_version = ${v === null ? 'NULL' : `'${v}'`}, terms_locale = ${l === null ? 'NULL' : `'${l}'`} WHERE id = '${U[k]}'`)
const errIs = (r, w) => !r.ok && r.err.includes(w)

let failed = 0
const check = (name, ok, got) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  got: ' + JSON.stringify(got)}`) }

// mutant(): the migration with one text change. The anchor must exist (a silent no-op replace would make a mutant that is
// the real file and every "red" check below meaningless).
let mutN = 0
function mutant(...pairs) {
  let t = T191
  for (const [a, b] of pairs) { if (!t.includes(a)) throw new Error('mutant anchor not in migration text: ' + a.slice(0, 80)); t = t.replace(a, b) }
  const p = join(dir, `mut${++mutN}.sql`); writeFileSync(p, t); return p
}

// mutation shapes (each keeps the text the in-migration assertion pins, so the BEHAVIOUR is what turns red)
const RPC_V = ['IF p_version IS NULL OR NOT is_published_terms_version(p_version) THEN', 'IF false THEN']
const RPC_L = ['IF p_locale IS NULL OR NOT is_terms_locale(p_locale) THEN', 'IF false THEN']
const GRD_V = ['IF v_version_moved AND NEW.terms_version IS NOT NULL AND NOT is_published_terms_version(NEW.terms_version) THEN', 'IF false AND v_version_moved AND NEW.terms_version IS NOT NULL AND NOT is_published_terms_version(NEW.terms_version) THEN']
const GRD_L = ['IF v_locale_moved AND NEW.terms_locale IS NOT NULL AND NOT is_terms_locale(NEW.terms_locale) THEN', 'IF false AND v_locale_moved AND NEW.terms_locale IS NOT NULL AND NOT is_terms_locale(NEW.terms_locale) THEN']

// ── 0. The published list: derived from the file, checked against the git evidence, and the client's current constant ──
const body = n => { const i = T191.indexOf(`CREATE OR REPLACE FUNCTION public.${n}(`); const a = T191.indexOf('AS $function$', i) + 13; return T191.slice(a, T191.indexOf('$function$;', a)) }
const VERSIONS = [...body('is_published_terms_version').matchAll(/'(\d{4}-\d{2}(?:-\d{2})?)'/g)].map(m => m[1])
const LOCALES = [...body('is_terms_locale').matchAll(/'([A-Za-z]+)'/g)].map(m => m[1])
const EVIDENCE = ['2026-09', '2026-09-20', '2026-09-24', '2026-09-27', '2026-10-02', '2026-10-08', '2026-10-21', '2026-10-22',
  '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-30', '2026-11-09', '2026-11-11']   // git log --all -m -G"LEGAL_VERSION *=", header of the file
const LEGAL_VERSION = /export const LEGAL_VERSION = '([^']+)'/.exec(LEGAL)?.[1]
const LANG_KEYS = [...(/export const LANGUAGES = \[([\s\S]*?)\n\]/.exec(I18N)?.[1] ?? '').matchAll(/key: '([A-Za-z]+)'/g)].map(m => m[1])
console.log('published versions in the helper: ' + VERSIONS.join(' '))
console.log('languages in the helper: ' + LOCALES.join(' '))
check('the published list is exactly the 14 values found in git history (ALL refs, merges included), ascending, no duplicates', JSON.stringify(VERSIONS) === JSON.stringify(EVIDENCE) && new Set(VERSIONS).size === VERSIONS.length && [...VERSIONS].sort().join() === VERSIONS.join(), VERSIONS)
check('the list contains the current LEGAL_VERSION read from constants/legal/index.js (' + LEGAL_VERSION + ')', !!LEGAL_VERSION && VERSIONS.includes(LEGAL_VERSION), { LEGAL_VERSION })
check('the language list equals the LANGUAGES keys of constants/i18n.js (9, no ISO codes)', LANG_KEYS.length === 9 && JSON.stringify(LOCALES) === JSON.stringify(LANG_KEYS) && !LOCALES.some(l => /^(tr|en)$/i.test(l)), { LOCALES, LANG_KEYS })

// ── 1. accept_terms: the legitimate path, and who else is untouched ─────────────────────────────────────────────
{
  const db = await build()
  const b0 = await row(db, 'B')
  const r = await accept(db, 'A', '2026-11-11', 'Turkish')
  const a1 = await row(db, 'A')
  const stampOk = a1.a && Math.abs(Date.now() - new Date(a1.a).getTime()) < 120000
  check('signed-in user: accept_terms writes version + locale and the SERVER stamps the time', r.ok && a1.v === '2026-11-11' && a1.l === 'Turkish' && stampOk, { r, a1 })
  check('  …returns the row as it now stands (version, locale, accepted_at)', r.ok && r.value.terms_version === '2026-11-11' && r.value.terms_locale === 'Turkish' && +new Date(r.value.terms_accepted_at) === +new Date(a1.a), r.value)
  check('  …another user\'s row is untouched (positive control: A\'s changed, B\'s did not)', JSON.stringify(await row(db, 'B')) === JSON.stringify(b0) && b0.v === null && b0.a === null, await row(db, 'B'))
}

// ── 2. accept_terms: refusals, each with a positive control, each seen red on a mutant and without the file ──────────
const BAD_VERSIONS = ['2099-01-01', '2026-08', '2026-11-10', '2026-11-11T09:00', '', null]
const BAD_LOCALES = ['tr', 'en', 'TR', 'turkish', '', null]
{
  const db = await build()
  const none = await build(null)
  const m1 = await build(mutant(RPC_V, GRD_V)), m1rpc = await build(mutant(RPC_V))
  const m2 = await build(mutant(RPC_L, GRD_L)), m2rpc = await build(mutant(RPC_L))
  for (const v of BAD_VERSIONS) {
    const r = await accept(db, 'A', v, 'English')
    check(`accept_terms refuses version ${JSON.stringify(v)} (TERMS_VERSION_UNKNOWN) and writes nothing`, errIs(r, 'TERMS_VERSION_UNKNOWN') && (await row(db, 'A')).v === null, r)
  }
  check('  …positive control: a published version with a valid locale is accepted', (await accept(db, 'A', '2026-10-25', 'English')).ok === true)
  for (const l of BAD_LOCALES) {
    const r = await accept(db, 'B', '2026-11-11', l)
    check(`accept_terms refuses locale ${JSON.stringify(l)} (TERMS_LOCALE_UNKNOWN) and writes nothing`, errIs(r, 'TERMS_LOCALE_UNKNOWN') && (await row(db, 'B')).v === null, r)
  }
  for (const l of LOCALES) check(`  …positive control: ${l} is accepted`, (await accept(db, 'B', '2026-11-11', l)).ok === true)
  const rm1 = await accept(m1, 'A', '2099-01-01', 'English')
  console.log('RED (version check removed from accept_terms): far-future accepted=' + rm1.ok + ' → recorded ' + (await row(m1, 'A')).v)
  check('red-first: with the version check broken in the function AND the guard, the far-future version IS recorded (so the checks above measure something)', rm1.ok === true && (await row(m1, 'A')).v === '2099-01-01', rm1)
  const rm1r = await accept(m1rpc, 'A', '2099-01-01', 'English')
  check('  …defence in depth: with only the function\'s check broken, the guard still refuses it (TERMS_VERSION_UNKNOWN)', errIs(rm1r, 'TERMS_VERSION_UNKNOWN') && (await row(m1rpc, 'A')).v === null, rm1r)
  const rm2 = await accept(m2, 'A', '2026-11-11', 'tr')
  console.log('RED (locale check removed from accept_terms): "tr" accepted=' + rm2.ok + ' → recorded ' + (await row(m2, 'A')).l)
  check('red-first: with the locale check broken in the function AND the guard, the ISO locale IS recorded', rm2.ok === true && (await row(m2, 'A')).l === 'tr', rm2)
  const rm2r = await accept(m2rpc, 'A', '2026-11-11', 'tr')
  check('  …defence in depth: with only the function\'s check broken, the guard still refuses it (TERMS_LOCALE_UNKNOWN)', errIs(rm2r, 'TERMS_LOCALE_UNKNOWN') && (await row(m2rpc, 'A')).l === null, rm2r)
  check('red-first (database WITHOUT 20261191): accept_terms does not exist', errIs(await accept(none, 'A', '2026-11-11', 'English'), 'accept_terms'))
}
{
  const db = await build()
  // who may call: the signed-in customer yes (control), guest / anon / service role / a user with no profiles row no.
  const g = await accept(db, 'G', '2026-11-11', 'English')
  check('guest JWT (is_anonymous) → AUTH_REQUIRED, nothing written', errIs(g, 'AUTH_REQUIRED') && (await row(db, 'G')).v === null, g)
  check('anon role (no session) cannot call accept_terms (no EXECUTE)', errIs(await accept(db, null, '2026-11-11', 'English'), 'permission denied'), await accept(db, null, '2026-11-11', 'English'))
  check('service role cannot call accept_terms (no EXECUTE; it has no user id)', errIs(await accept(db, 'svc', '2026-11-11', 'English'), 'permission denied'))
  const m = await accept(db, 'M', '2026-11-11', 'English')
  check('a signed-in user with NO profiles row → PROFILE_MISSING (zero rows is never a silent success)', errIs(m, 'PROFILE_MISSING'), m)
  check('  …positive control: a signed-in customer with a row is accepted', (await accept(db, 'A', '2026-11-11', 'English')).ok === true)
  // mutants
  const mg = await build(mutant(['IF v_me IS NULL OR is_anonymous_session() THEN\n    RAISE EXCEPTION \'AUTH_REQUIRED\';', 'IF v_me IS NULL THEN\n    RAISE EXCEPTION \'AUTH_REQUIRED\';']))
  const rg = await accept(mg, 'G', '2026-11-11', 'English')
  console.log('RED (guest check removed): guest accepted=' + rg.ok + ' → recorded ' + (await row(mg, 'G')).v)
  check('red-first: without the is_anonymous_session() check a guest IS recorded', rg.ok === true && (await row(mg, 'G')).v === '2026-11-11', rg)
  const mm = await build(mutant(['  IF NOT FOUND THEN\n    RAISE EXCEPTION \'PROFILE_MISSING\';\n  END IF;', '']))
  const rm = await accept(mm, 'M', '2026-11-11', 'English')
  console.log('RED (PROFILE_MISSING removed): missing-profile call ok=' + rm.ok + ' value=' + JSON.stringify(rm.value))
  check('red-first: without the check a missing profile row is a SILENT success (ok, all-null row)', rm.ok === true && rm.value?.terms_version === null, rm)
  const ma = await build(mutant(['GRANT EXECUTE ON FUNCTION public.accept_terms(text, text) TO authenticated;', 'GRANT EXECUTE ON FUNCTION public.accept_terms(text, text) TO authenticated, anon;'],
    ['  IF has_function_privilege(\'anon\', \'public.accept_terms(text,text)\', \'EXECUTE\')\n     OR has_function_privilege(\'service_role\', \'public.accept_terms(text,text)\', \'EXECUTE\') THEN\n    RAISE EXCEPTION \'anon and service_role must not call accept_terms\';\n  END IF;', '']))
  console.log('RED (anon granted, assertion removed): anon call → ' + JSON.stringify((await accept(ma, null, '2026-11-11', 'English')).err ?? 'ok'))
  check('red-first: with anon granted the anon role is NOT refused by privilege (it reaches the AUTH_REQUIRED check)', errIs(await accept(ma, null, '2026-11-11', 'English'), 'AUTH_REQUIRED'))
  const mAssert = mutant(['GRANT EXECUTE ON FUNCTION public.accept_terms(text, text) TO authenticated;', 'GRANT EXECUTE ON FUNCTION public.accept_terms(text, text) TO authenticated, anon;'])
  check('  …and with the assertion kept the migration itself refuses that grant', !(await applyFile(await freshDb(BASE), mAssert)).ok)
}

// ── 3. Never lowers, never re-stamps ────────────────────────────────────────────────────────────────────────────
{
  const db = await build()
  await accept(db, 'A', '2026-10-25', 'Turkish')
  const a0 = await row(db, 'A')
  const same = await accept(db, 'A', '2026-10-25', 'English')
  const a1 = await row(db, 'A')
  check('same-version re-accept does NOT restamp terms_accepted_at and writes nothing (locale stays), returns the recorded row',
    same.ok && +new Date(a1.a) === +new Date(a0.a) && a1.l === 'Turkish' && same.value.terms_locale === 'Turkish' && +new Date(same.value.terms_accepted_at) === +new Date(a0.a), { a0, a1, same })
  const lower = await accept(db, 'A', '2026-09', 'English')
  const a2 = await row(db, 'A')
  check('a LOWER version does not lower: no error, the recorded row is returned unchanged', lower.ok && a2.v === '2026-10-25' && lower.value.terms_version === '2026-10-25' && +new Date(a2.a) === +new Date(a0.a), { lower, a2 })
  const up = await accept(db, 'A', '2026-11-11', 'English')
  const a3 = await row(db, 'A')
  check('  …positive control: a HIGHER version is written and restamped', up.ok && a3.v === '2026-11-11' && a3.l === 'English' && +new Date(a3.a) !== +new Date(a0.a), { up, a3 })
  // COLLATE "C" ordering, not the database's: '2026-09' < '2026-09-20' (prefix), and every list entry accepted in ascending order
  const d2 = await build()
  let prev = null, all = true
  for (const v of VERSIONS) { const r = await accept(d2, 'B', v, 'English'); const rec = await row(d2, 'B'); if (!r.ok || rec.v !== v || (prev && +new Date(rec.a) === +prev)) all = false; prev = new Date(rec.a) }
  check(`every published version (${VERSIONS.length}) is accepted by accept_terms, in ascending order, each one recorded`, all, await row(d2, 'B'))
  // red-first for the early return: its mutant (a lower version goes to the UPDATE) is stopped by the guard with a WORD, not a silent no-op
  const mr = await build(mutant(['IF v_ver IS NOT NULL AND v_ver COLLATE "C" >= p_version COLLATE "C" THEN', 'IF false THEN']))
  await accept(mr, 'A', '2026-10-25', 'English')
  const rl = await accept(mr, 'A', '2026-09', 'English')
  console.log('RED (early return removed): lower version → ' + (rl.err ?? 'ok'))
  check('red-first: without the early return a lower version reaches the UPDATE and the guard answers TERMS_VERSION_LOWER (the test above would see an error)', errIs(rl, 'TERMS_VERSION_LOWER'), rl)
}

{
  const gone = mutant(['IF v_version_moved AND NEW.terms_version IS NOT NULL AND NOT is_published_terms_version(NEW.terms_version) THEN', 'IF false THEN'])
  const r = await applyFile(await freshDb(BASE), gone)
  check('the migration\'s own assertion refuses a guard whose version check was deleted ("not the validating SECURITY DEFINER function")', !r.ok && /not the validating SECURITY DEFINER function/.test(r.msg), r.msg)
}
// ── 4. Direct writes (what every app already in the field does) ─────────────────────────────────────────────────
{
  const db = await build()
  const none = await build(null)
  const mV = await build(mutant(GRD_V))
  const mL = await build(mutant(GRD_L))
  const mD = await build(mutant(['AND (NEW.terms_version IS NULL OR NEW.terms_version COLLATE "C" < OLD.terms_version COLLATE "C") THEN', 'AND NEW.terms_version COLLATE "C" < OLD.terms_version COLLATE "C" THEN']))
  const mLow = await build(mutant(['AND (NEW.terms_version IS NULL OR NEW.terms_version COLLATE "C" < OLD.terms_version COLLATE "C") THEN', 'AND false THEN']))
  const mNoUid = await build(mutant(['AND auth.uid() IS NOT NULL AND coalesce(get_my_role(), \'\') <> \'admin\'', 'AND coalesce(get_my_role(), \'\') <> \'admin\'']))

  // old-bundle path: a published version >= recorded, valid locale, succeeds and is stamped by branch (g)
  await seedTerms(db, 'A', '2026-10-25', 'Turkish'); await seedTerms(none, 'A', '2026-10-25', 'Turkish')
  const a0 = await row(db, 'A')
  const ok1 = await direct(db, 'A', 'A', `terms_version = '2026-11-11', terms_locale = 'English'`)
  const a1 = await row(db, 'A')
  check('OLD-BUNDLE PATH: a direct client UPDATE to a published version >= recorded with a valid locale still succeeds and branch (g) stamps the time',
    ok1.ok && ok1.rows.length === 1 && a1.v === '2026-11-11' && a1.l === 'English' && +new Date(a1.a) !== +new Date(a0.a), { ok1, a0, a1 })
  const sameW = await direct(db, 'A', 'A', `terms_version = '2026-11-11', terms_locale = 'English'`)
  check('  …re-writing the SAME version (a token refresh re-fires the old flush) passes untouched and does not restamp', sameW.ok && +new Date((await row(db, 'A')).a) === +new Date(a1.a), sameW)
  const fromNull = await direct(db, 'B', 'B', `terms_version = '2026-09', terms_locale = 'Turkish'`)
  check('  …from NULL (first acceptance at signup) with an OLDER published version (a stale pending entry) succeeds', fromNull.ok && fromNull.rows.length === 1 && (await row(db, 'B')).v === '2026-09', fromNull)

  for (const v of ['2099-01-01', '2026-11-10', '2026-08', 'z']) {
    const r = await direct(db, 'A', 'A', `terms_version = '${v}', terms_locale = 'English'`)
    check(`direct write of unlisted version ${v} is refused for a client (TERMS_VERSION_UNKNOWN), row unchanged`, errIs(r, 'TERMS_VERSION_UNKNOWN') && (await row(db, 'A')).v === '2026-11-11', r)
  }
  for (const l of ['tr', 'en', '', 'Klingon']) {
    const r = await direct(db, 'A', 'A', `terms_version = '2026-11-11', terms_locale = '${l}'`)
    check(`direct write of locale ${JSON.stringify(l)} is refused for a client (TERMS_LOCALE_UNKNOWN), row unchanged`, errIs(r, 'TERMS_LOCALE_UNKNOWN') && (await row(db, 'A')).l === 'English', r)
  }
  const dn = await direct(db, 'A', 'A', `terms_version = '2026-09'`)
  check('direct DOWNGRADE of the version is refused for a client (TERMS_VERSION_LOWER), row unchanged', errIs(dn, 'TERMS_VERSION_LOWER') && (await row(db, 'A')).v === '2026-11-11', dn)
  const nu = await direct(db, 'A', 'A', `terms_version = NULL`)
  check('direct NULLing of the version is refused for a client (TERMS_VERSION_LOWER), row unchanged', errIs(nu, 'TERMS_VERSION_LOWER') && (await row(db, 'A')).v === '2026-11-11', nu)
  const allowed = [
    ['a client writing a published version >= recorded (positive control for the refusals above)', await direct(db, 'A', 'A', `terms_version = '2026-11-11', terms_locale = 'German'`)],
  ]
  for (const [n, r] of allowed) check(n, r.ok && r.rows.length === 1, r)
  // no-JWT SQL (superuser): downgrade and NULL allowed (the existing suites do exactly this); an UNLISTED value refused for every writer
  const sqlDown = await as(db, 'sql', `UPDATE profiles SET terms_version = '2026-09' WHERE id = '${U.A}'`)
  const sqlNull = await as(db, 'sql', `UPDATE profiles SET terms_version = NULL WHERE id = '${U.A}'`)
  check('no-JWT SQL (superuser): lowering to a published version and NULLing are ALLOWED (existing suites rely on it)', sqlDown.ok && sqlNull.ok && (await row(db, 'A')).v === null, { sqlDown, sqlNull })
  const sqlBad = await as(db, 'sql', `UPDATE profiles SET terms_version = '2099-01-01' WHERE id = '${U.A}'`)
  check('  …but an UNLISTED version is refused even there (every writer)', errIs(sqlBad, 'TERMS_VERSION_UNKNOWN'), sqlBad)
  const svcBad = await as(db, 'svc', `UPDATE profiles SET terms_locale = 'tr' WHERE id = '${U.A}'`)
  check('  …service role: an ISO locale is refused (TERMS_LOCALE_UNKNOWN); positive control: a valid one passes', errIs(svcBad, 'TERMS_LOCALE_UNKNOWN') && (await as(db, 'svc', `UPDATE profiles SET terms_locale = 'French' WHERE id = '${U.A}' RETURNING 1`)).rows?.length === 1, svcBad)
  // admin session: may lower another's row (admin update all), still not to an unlisted value
  await seedTerms(db, 'B', '2026-11-11')
  const adDown = await direct(db, 'X', 'B', `terms_version = '2026-09'`)
  const adBad = await direct(db, 'X', 'B', `terms_version = '2099-01-01'`)
  check('an ADMIN session may lower a version (exempt from "no lowering") but not to an unlisted one', adDown.ok && adDown.rows.length === 1 && errIs(adBad, 'TERMS_VERSION_UNKNOWN'), { adDown, adBad })
  // other fields: terms untouched
  await seedTerms(db, 'A', '2026-11-11', 'Turkish')
  const before = await row(db, 'A')
  const other = await direct(db, 'A', 'A', `display_name = 'Ayşe Yılmaz', push_token = 'ExponentPushToken[abc]'`)
  check('other profile fields still update, and the terms (version, locale, accepted_at) stay exactly as they were', other.ok && other.rows.length === 1 && JSON.stringify(await row(db, 'A')) === JSON.stringify(before), { other, before })
  // guest and other user: the policies still hold (zero rows, not an error)
  const gu = await as(db, 'G', `UPDATE profiles SET terms_version = '2026-11-11', terms_locale = 'English' WHERE id = '${U.G}' RETURNING 1`)
  check('a guest\'s direct UPDATE still changes nothing (no_anon_update_profiles: zero rows)', gu.ok && gu.rows.length === 0 && (await row(db, 'G')).v === null, gu)
  const oth = await as(db, 'A', `UPDATE profiles SET terms_version = '2026-11-11', terms_locale = 'English' WHERE id = '${U.B}' RETURNING 1`)
  check('  …and A cannot update B\'s row (owner update: zero rows); positive control: A updates A\'s own row', oth.ok && oth.rows.length === 0 && (await direct(db, 'A', 'A', `terms_locale = 'English'`)).rows.length === 1, oth)

  // red-first: each of the direct-write refusals on a database where it is broken, and without the file
  await seedTerms(mV, 'A', '2026-10-25', 'Turkish'); await seedTerms(mL, 'A', '2026-10-25', 'Turkish'); await seedTerms(mD, 'A', '2026-10-25'); await seedTerms(mLow, 'A', '2026-10-25'); await seedTerms(mNoUid, 'A', '2026-11-11')
  const rv = await direct(mV, 'A', 'A', `terms_version = '2099-01-01'`)
  console.log('RED (version check removed from the guard): far-future direct write ok=' + rv.ok + ' → ' + (await row(mV, 'A')).v)
  check('red-first: with the guard\'s version check broken, a far-future direct write IS recorded', rv.ok && (await row(mV, 'A')).v === '2099-01-01', rv)
  const rl = await direct(mL, 'A', 'A', `terms_locale = 'tr'`)
  console.log('RED (locale check removed from the guard): ISO locale direct write ok=' + rl.ok + ' → ' + (await row(mL, 'A')).l)
  check('red-first: with the guard\'s locale check broken, an ISO locale IS recorded', rl.ok && (await row(mL, 'A')).l === 'tr', rl)
  const rd = await direct(mLow, 'A', 'A', `terms_version = '2026-09'`)
  console.log('RED (no-lowering check removed): downgrade ok=' + rd.ok + ' → ' + (await row(mLow, 'A')).v)
  check('red-first: with the no-lowering check broken, a client downgrade IS recorded', rd.ok && (await row(mLow, 'A')).v === '2026-09', rd)
  const rn = await direct(mD, 'A', 'A', `terms_version = NULL`)
  console.log('RED (NULL arm removed): NULLing ok=' + rn.ok + ' → ' + JSON.stringify((await row(mD, 'A')).v))
  check('red-first: without the `IS NULL` arm a client can UN-RECORD an acceptance (NULL)', rn.ok && (await row(mD, 'A')).v === null, rn)
  const rs = await as(mNoUid, 'sql', `UPDATE profiles SET terms_version = '2026-09' WHERE id = '${U.A}'`)
  console.log('RED (auth.uid() IS NOT NULL removed from the guard): no-JWT SQL downgrade → ' + (rs.err ?? 'ok'))
  check('red-first (positive-control side): without the `auth.uid() IS NOT NULL` clause the no-JWT SQL downgrade is REFUSED, which the allowed-path check above would catch', errIs(rs, 'TERMS_VERSION_LOWER'), rs)
  // without the file: every one of the refusals is absent
  const nr = await direct(none, 'A', 'A', `terms_version = '2099-01-01', terms_locale = 'tr'`)
  check('red-first (database WITHOUT 20261191): the far-future version and ISO locale ARE recorded by a direct client write', nr.ok && (await row(none, 'A')).v === '2099-01-01' && (await row(none, 'A')).l === 'tr', nr)
  const nd = await direct(none, 'A', 'A', `terms_version = NULL`)
  check('red-first (database WITHOUT 20261191): a client can NULL the version', nd.ok && (await row(none, 'A')).v === null, nd)
}

// ── 5. Firing order: the guard cannot change what branch (g) sees ───────────────────────────────────────────────
{
  const withF = await build(), without = await build(null)
  for (const d of [withF, without]) await seedTerms(d, 'A', '2026-10-25')
  const a = await direct(withF, 'A', 'A', `terms_version = '2026-11-11'`), b = await direct(without, 'A', 'A', `terms_version = '2026-11-11'`)
  const ra = await row(withF, 'A'), rb = await row(without, 'A')
  check('branch (g) stamps the time identically with and without the guard (set, and strictly later than the previous stamp)', a.ok && b.ok && ra.a && rb.a, { ra, rb })
  const rows = (await as(withF, 'sql', `SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal ORDER BY tgname`)).rows.map(r => r.tgname)
  console.log('triggers on profiles after 20261191 (BEFORE triggers fire in this name order): ' + rows.join(', '))
  check('the guard is the only trigger added; check_profile_name_content sorts BEFORE it, and the guard never assigns to NEW',
    rows.includes('guard_profile_terms_columns') && rows.indexOf('check_profile_name_content') < rows.indexOf('guard_profile_terms_columns') && !/NEW\.[a-z_]+ *:=/.test(body('guard_profile_terms_columns')) && rows.length === (await as(without, 'sql', `SELECT count(*)::int FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal`)).value + 1, rows)
}

// ── 6. The file: grants, policies, pre-flight, re-run ───────────────────────────────────────────────────────────
{
  const db = await build(), none = await build(null)
  const priv = async (r, f) => (await as(db, 'sql', `SELECT has_function_privilege('${r}', '${f}', 'EXECUTE') p`)).value
  check('accept_terms: authenticated yes (positive control); anon, service_role no', await priv('authenticated', 'public.accept_terms(text,text)') === true && await priv('anon', 'public.accept_terms(text,text)') === false && await priv('service_role', 'public.accept_terms(text,text)') === false)
  const internal = ['public.is_published_terms_version(text)', 'public.is_terms_locale(text)', 'public.guard_profile_terms_columns()']
  const iv = []; for (const f of internal) for (const r of ['anon', 'authenticated', 'service_role']) iv.push(await priv(r, f))
  check('the two list helpers and the guard are executable by none of anon / authenticated / service_role', iv.every(x => x === false), iv)
  const pol = async d => (await as(d, 'sql', `SELECT string_agg(policyname || ':' || permissive || ':' || cmd, ',' ORDER BY policyname) p FROM pg_policies WHERE tablename = 'profiles'`)).value
  check('the policy set on profiles is identical with and without 20261191', (await pol(db)) === (await pol(none)) && (await pol(db)).split(',').length === 6, [await pol(db)])
  check('a second apply is a clean re-run', (await applyFile(db, F191)).ok === true)
  const pre = async (setup, w) => { const d = await freshDb(BASE); await d.exec(setup); const r = await applyFile(d, F191); await d.exec('ROLLBACK').catch(() => {}); return { r, d } }
  const REFUSE = /REFUSING: at least one profiles row carries a terms_version or terms_locale outside the published lists/
  const p1 = await pre(`ALTER TABLE profiles DISABLE TRIGGER USER; UPDATE profiles SET terms_version = '2026-08' WHERE id = '${U.A}'`)
  check('pre-flight refuses a live row with an unlisted version (2026-08), prints no value, count or id, and applies nothing',
    !p1.r.ok && REFUSE.test(p1.r.msg) && !p1.r.msg.includes('2026-08') && !p1.r.msg.includes(U.A) && !/\d/.test(p1.r.msg), p1.r.msg)
  const gone = (await as(p1.d, 'sql', `SELECT to_regprocedure('public.accept_terms(text,text)') IS NULL AS n`)).value
  check('  …and nothing was applied (accept_terms absent after the refusal)', gone === true)
  const p2 = await pre(`ALTER TABLE profiles DISABLE TRIGGER USER; UPDATE profiles SET terms_locale = 'tr' WHERE id = '${U.A}'`)
  check('pre-flight refuses a live row with an unlisted language (tr)', !p2.r.ok && REFUSE.test(p2.r.msg), p2.r.msg)
  const p3 = await pre(`UPDATE profiles SET terms_version = '2026-09', terms_locale = 'Persian' WHERE id = '${U.A}'; UPDATE profiles SET terms_version = '2026-11-11' WHERE id = '${U.B}'`)
  check('  …positive control: rows carrying only published versions and valid languages apply cleanly', p3.r.ok, p3.r.msg)
  const d4 = await freshDb(BASE.replace(/CREATE TRIGGER check_profile_name_content[^\n]*\n/, ''))
  const p4 = await applyFile(d4, F191); await d4.exec('ROLLBACK').catch(() => {})
  check('pre-flight refuses when check_profile_name_content is not on profiles', !p4.ok && /check_profile_name_content that stamps terms_accepted_at is not on profiles/.test(p4.msg), p4.msg)
  const d5 = await freshDb(BASE.replaceAll('NEW.terms_accepted_at := now();', 'NEW.terms_accepted_at := NEW.terms_accepted_at;'))
  const p5 = await applyFile(d5, F191); await d5.exec('ROLLBACK').catch(() => {})
  check('  …or when its branch (g) no longer stamps the time', !p5.ok && /stamps terms_accepted_at/.test(p5.msg), p5.msg)
  // in-migration assertion: the stamping function is not replaced
  const mm = mutant(['-- ─── 5. Assertions', "CREATE OR REPLACE FUNCTION public.check_profile_name_content() RETURNS trigger LANGUAGE plpgsql AS $x$ BEGIN NEW.terms_accepted_at := now(); RETURN NEW; END $x$;\n-- ─── 5. Assertions"])
  const rm = await applyFile(await freshDb(BASE), mm)
  check('red: a variant that replaces check_profile_name_content is refused by the in-migration assertion', !rm.ok && /check_profile_name_content changed during this file/.test(rm.msg), rm.msg)
  const mt = mutant(['-- ─── 5. Assertions', 'CREATE TRIGGER aaa_extra BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_profile_terms_columns();\n-- ─── 5. Assertions'])
  const rt = await applyFile(await freshDb(BASE), mt)
  check('red: a variant that adds a second trigger on profiles is refused (trigger set differs by more than one)', !rt.ok && /differs by more than the one added here/.test(rt.msg), rt.msg)
  const mp = mutant(['-- ─── 5. Assertions', 'CREATE POLICY extra_p ON public.profiles FOR SELECT USING (true);\n-- ─── 5. Assertions'])
  const rp = await applyFile(await freshDb(BASE), mp)
  check('red: a variant that adds a policy on profiles is refused', !rp.ok && /a policy on profiles changed/.test(rp.msg), rp.msg)
}

// ── 7. verify_schema: no existing token moves because of this file ──────────────────────────────────────────────
{
  const vs = readFileSync(rel('../supabase/verify_schema.sql'), 'utf8')
  const q1 = vs.slice(vs.indexOf('WITH report AS ('), vs.indexOf('═══ QUERY 2 / 5'))
  const db = await build(), none = await build(null)
  const code = async (d, sql) => { try { await d.query(sql); return 'ok' } catch (e) { await d.exec('ROLLBACK').catch(() => {}); return String(e.code ?? e.message) } }
  const got = await code(db, q1)
  console.log('QUERY 1 on the fixture database: ' + got + ' (a non-42601 error = past the parser, on a table this fixture lacks)')
  check('verify_schema QUERY 1 parses (any error but 42601 syntax)', q1.length > 100000 && got !== '42601', got)
  const start = vs.indexOf('-- ── H. BEHAVIOR / VERSION TOKENS'), end = vs.indexOf('  ) z', start)
  const H = vs.slice(start, end)
  const marks = []
  const first = /SELECT '([^']*)' m, '((?:[^']|'')*)' label,\n/.exec(H)
  if (first) marks.push({ m: first[1], label: first[2], at: first.index + first[0].length, kind: 'first' })
  const re = /UNION ALL SELECT '([^']*)',\s*'((?:[^']|'')*)',\s*\n?/g
  let m; while ((m = re.exec(H))) marks.push({ m: m[1], label: m[2], at: m.index + m[0].length, kind: 'u', idx: m.index })
  marks.sort((a, b) => a.at - b.at)
  const tokens = marks.map((k, i) => ({ label: `${k.m}: ${k.label.replace(/''/g, "'").slice(0, 70)}`, expr: H.slice(k.at, marks[i + 1] ? (marks[i + 1].kind === 'u' ? marks[i + 1].idx : H.length) : H.length) }))
  const run = async (d, tk) => { try { await d.exec('RESET role;'); return String((await d.query(`SELECT (${tk.expr}) AS ok`)).rows[0].ok) } catch (e) { return 'error: ' + String(e.message).split('\n')[0].slice(0, 60) } }
  const rows = []; for (const tk of tokens) rows.push({ label: tk.label, before: await run(none, tk), after: await run(db, tk) })
  const changed = rows.filter(r => r.before !== r.after), mine = rows.filter(r => r.label.startsWith('20261191'))
  console.log(`H tokens parsed: ${rows.length}; this file's: ${mine.length}`)
  console.log('tokens whose result differs before/after 20261191:'); for (const r of changed) console.log(`  ${r.label}   ${r.before} -> ${r.after}`)
  check('H tokens: the parser found them (positive control)', rows.length >= 400, rows.length)
  check('H tokens: EVERY existing token reads the same before and after 20261191', changed.filter(r => !r.label.startsWith('20261191')).length === 0, changed.filter(r => !r.label.startsWith('20261191')))
  check('H tokens: this file\'s tokens are TRUE after and not true before', mine.length >= 4 && mine.every(r => r.after === 'true' && r.before !== 'true'), mine)
  // each of this file's tokens goes RED on a mutant that breaks what it pins
  const MUT = [
    ['published list', mutant(["    '2026-11-11'\n  ]::text[]);", "    '2026-11-10'\n  ]::text[]);"], ["IF NOT (public.is_published_terms_version('2026-11-11') AND", "IF NOT (public.is_published_terms_version('2026-11-10') AND"])],
    ['locale list', mutant(["    'Persian'\n  ]::text[]);", "    'Farsi'\n  ]::text[]);"], ["public.is_terms_locale('Persian')", "public.is_terms_locale('Farsi')"])],
    ['accept_terms profile check', mutant(["  IF NOT FOUND THEN\n    RAISE EXCEPTION 'PROFILE_MISSING';\n  END IF;", "  IF NOT FOUND THEN\n    RAISE EXCEPTION 'NOPE';\n  END IF;"])],
    ['guard lowering', mutant(['AND (NEW.terms_version IS NULL OR NEW.terms_version COLLATE "C" < OLD.terms_version COLLATE "C") THEN', 'AND (NEW.terms_version IS NULL OR NEW.terms_version COLLATE "C" > OLD.terms_version COLLATE "C") THEN'])],
    ['guard validation', mutant(GRD_V)],
  ]
  for (const [n, p] of MUT) {
    const d = await build(p); const out = []; for (const tk of tokens.filter(t => t.label.startsWith('20261191'))) out.push(await run(d, tk))
    check(`H tokens red-first: a mutant (${n}) turns at least one 20261191 token red`, out.some(v => v === 'false'), out)
  }
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)

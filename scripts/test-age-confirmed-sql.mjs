// 20261219 (profiles.age_confirmed_at + completion CHECK) against the PGlite harness (PostgreSQL 18;
// prod is older, see supabase/CLAUDE.md). The fixture is a slim profiles table carrying the LIVE completion
// CHECK as printed by the 2026-11-18 read-only probe, plus a stub is_admin() driven by a JWT claim.
// Not wired into CI, like its siblings: run by hand.
//
//   node scripts/test-age-confirmed-sql.mjs
//
// Red-first: mutants of the migration (anchors asserted) must each make this suite fail, with the migration's own
// in-file behaviour block stripped so it is THIS suite that is measured; one more mutant proves the in-file block
// refuses an apply by itself.
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile as applyRaw } from './migration-harness.mjs'

const FILE = fileURLToPath(new URL('../supabase/migrations/20261219_age_confirmed_at.sql', import.meta.url))
const SQL = readFileSync(FILE, 'utf8')
const dir = mkdtempSync(join(tmpdir(), 'age-confirmed-'))

const LIVE_CHECK = `CHECK (profile_completed_at IS NULL OR (first_name IS NOT NULL AND last_name IS NOT NULL AND display_name IS NOT NULL AND date_of_birth IS NOT NULL AND region IS NOT NULL AND resident_status IS NOT NULL AND nationality_code IS NOT NULL AND (resident_status <> 'student' OR student_level IS NOT NULL)))`
const U = n => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`

const fixture = (check = LIVE_CHECK) => `
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $f$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'app_role' = 'admin', false)
$f$;
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  first_name text, last_name text, display_name text, date_of_birth date, region text,
  resident_status text, student_level text, nationality_code char(2), nationality text,
  profile_completed_at timestamptz, note text,
  CONSTRAINT profiles_completion_requires_fields_check ${check}
);
INSERT INTO auth.users (id) VALUES ${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `('${U(n)}')`).join(', ')};
`

async function apply(sql) {
  const p = join(dir, `m-${Math.random().toString(36).slice(2)}.sql`)
  writeFileSync(p, sql)
  const d = await freshDb(fixture())
  const r = await applyRaw(d, p)
  if (!r.ok) await d.exec('ROLLBACK; RESET ROLE;')
  return { d, r }
}

const q = async (d, sql) => (await d.query(sql)).rows
const tryq = async (d, sql) => { try { await d.exec(sql); return { ok: true } } catch (e) { return { ok: false, code: e.code, msg: String(e.message).split('\n')[0] } } }
const asClient = (d, sql, claims = {}) => d.exec(`SELECT set_config('request.jwt.claims', '${JSON.stringify(claims)}', false); ${sql}`)

const COMPLETE = `first_name='A', last_name='B', display_name='AB', region='Girne', resident_status='resident', profile_completed_at=now()`

async function suite(d, t) {
  const col = await q(d, `SELECT is_nullable, data_type FROM information_schema.columns WHERE table_name='profiles' AND column_name='age_confirmed_at'`)
  t('column exists, nullable timestamptz', col, [{ is_nullable: 'YES', data_type: 'timestamp with time zone' }])
  const trg = await q(d, `SELECT tgenabled FROM pg_trigger WHERE tgname='profiles_age_confirmed_stamp' AND NOT tgisinternal`)
  t('trigger exists and is enabled', trg, [{ tgenabled: 'O' }])
  const grants = await q(d, `SELECT has_function_privilege('anon','public.stamp_age_confirmed_at()','EXECUTE') a, has_function_privilege('authenticated','public.stamp_age_confirmed_at()','EXECUTE') b, has_function_privilege('postgres','public.stamp_age_confirmed_at()','EXECUTE') c`)
  t('trigger function: anon/authenticated denied, owner keeps EXECUTE (control)', grants, [{ a: false, b: false, c: true }])

  // ── the stamp ──
  const BOGUS = `'2001-01-01 00:00+00'`
  await d.exec(`INSERT INTO public.profiles (id, age_confirmed_at) VALUES ('${U(1)}', ${BOGUS}), ('${U(2)}', NULL)`)
  const ins = await q(d, `SELECT id, age_confirmed_at > now() - interval '1 minute' AS fresh, age_confirmed_at IS NULL AS isnull FROM public.profiles WHERE id IN ('${U(1)}','${U(2)}') ORDER BY id`)
  t('INSERT with a client timestamp is stamped now()', ins[0], { id: U(1), fresh: true, isnull: false })
  t('INSERT with NULL stays NULL', ins[1].isnull, true)

  await d.exec(`UPDATE public.profiles SET age_confirmed_at = ${BOGUS} WHERE id = '${U(2)}'`)
  const first = (await q(d, `SELECT age_confirmed_at v, age_confirmed_at > now() - interval '1 minute' AS fresh FROM public.profiles WHERE id='${U(2)}'`))[0]
  t('UPDATE NULL -> non-NULL stores now(), not the client value', first.fresh, true)

  await d.exec(`UPDATE public.profiles SET age_confirmed_at = '2002-02-02 00:00+00' WHERE id = '${U(2)}'`)
  const moved = (await q(d, `SELECT age_confirmed_at = '${first.v.toISOString()}' AS same FROM public.profiles WHERE id='${U(2)}'`))[0]
  t('a client cannot move a set value', moved.same, true)

  await asClient(d, `UPDATE public.profiles SET age_confirmed_at = NULL WHERE id = '${U(2)}'`, { sub: U(2), role: 'authenticated' })
  const kept = (await q(d, `SELECT age_confirmed_at IS NOT NULL AS set FROM public.profiles WHERE id='${U(2)}'`))[0]
  t('a non-admin cannot clear a set value', kept.set, true)

  await asClient(d, `UPDATE public.profiles SET age_confirmed_at = NULL WHERE id = '${U(2)}'`, { sub: U(3), role: 'authenticated', app_role: 'admin' })
  const cleared = (await q(d, `SELECT age_confirmed_at IS NULL AS isnull FROM public.profiles WHERE id='${U(2)}'`))[0]
  t('is_admin() can clear it (positive control for the denial above)', cleared.isnull, true)

  await d.exec(`UPDATE public.profiles SET age_confirmed_at = ${BOGUS} WHERE id = '${U(2)}'`)
  const before = (await q(d, `SELECT age_confirmed_at v FROM public.profiles WHERE id='${U(2)}'`))[0].v.toISOString()
  await d.exec(`UPDATE public.profiles SET note = 'x' WHERE id = '${U(2)}'`)
  t('an unrelated update leaves the stamp alone', (await q(d, `SELECT age_confirmed_at = '${before}' AS same FROM public.profiles WHERE id='${U(2)}'`))[0].same, true)

  // ── the CHECK ──
  const upd = (id, set) => tryq(d, `UPDATE public.profiles SET ${set} WHERE id = '${U(id)}'`)
  await d.exec(`INSERT INTO public.profiles (id) VALUES ('${U(4)}'), ('${U(5)}'), ('${U(6)}'), ('${U(7)}')`)
  t('complete, no DOB, no tick: refused (23514)', (await upd(4, COMPLETE)).code, '23514')
  t('complete with the tick only, no DOB, no nationality: accepted', (await upd(4, `${COMPLETE}, age_confirmed_at=now()`)).ok, true)
  t('complete with DOB only, no tick, no nationality: accepted', (await upd(5, `${COMPLETE}, date_of_birth='1990-01-01'`)).ok, true)
  t('complete with both: accepted', (await upd(6, `${COMPLETE}, date_of_birth='1990-01-01', age_confirmed_at=now()`)).ok, true)
  await d.exec(`UPDATE public.profiles SET age_confirmed_at = now() WHERE id = '${U(7)}'`)
  t('tick but no region: refused (other arms survive)', (await upd(7, `first_name='A', last_name='B', display_name='AB', resident_status='resident', profile_completed_at=now()`)).code, '23514')
  t('tick but student without level: refused (student arm survives)', (await upd(7, `${COMPLETE.replace("'resident'", "'student'")}`)).code, '23514')
  t('incomplete row (profile_completed_at NULL) needs nothing', (await upd(7, `profile_completed_at = NULL, region = NULL`)).ok, true)
}

let bad = 0
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  - got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}

console.log('real migration')
{
  const { d, r } = await apply(SQL)
  T('applies cleanly (incl. its own in-file behaviour block and live-definition pre-assert)', r, { ok: true, msg: null })
  await suite(d, T)
  const led = await q(d, `SELECT filename FROM public.schema_migrations_applied WHERE filename = '20261219_age_confirmed_at.sql'`)
  T('ledger row written in the same transaction', led.length, 1)
}

console.log('pre-assert: a different live CHECK refuses and applies nothing')
{
  const d = await freshDb(fixture(LIVE_CHECK.replace('AND nationality_code IS NOT NULL ', '')))
  const p = join(dir, 'm-pre.sql'); writeFileSync(p, SQL)
  const r = await applyRaw(d, p); await d.exec('ROLLBACK; RESET ROLE;')
  T('refused with REFUSING', r.ok === false && /REFUSING/.test(r.msg), true)
  T('no column added', (await q(d, `SELECT count(*)::int n FROM information_schema.columns WHERE table_name='profiles' AND column_name='age_confirmed_at'`))[0].n, 0)
}

console.log('red-first mutants (in-file behaviour block stripped, so THIS suite is measured)')
const stripBlock = s => {
  const a = s.indexOf('-- ─── 5. Behaviour'), b = s.indexOf('DROP TABLE tmp_age_broken;')
  if (a < 0 || b < 0) throw new Error('block anchors missing')
  return s.slice(0, a) + s.slice(b + 'DROP TABLE tmp_age_broken;'.length)
}
const mutate = (s, from, to) => { if (!s.includes(from)) throw new Error(`anchor missing: ${from}`); return s.replace(from, to) }
const MUTANTS = {
  'client may move/clear a set value (ELSE arm removed)': s => mutate(s, `  ELSE\n    NEW.age_confirmed_at := OLD.age_confirmed_at;\n  END IF;\n  RETURN NEW;`, `  END IF;\n  RETURN NEW;`),
  'anyone may clear (is_admin check dropped)': s => mutate(s, `NEW.age_confirmed_at IS NULL AND public.is_admin() IS NOT DISTINCT FROM true`, `NEW.age_confirmed_at IS NULL`),
  'NULL -> non-NULL honours the client value': s => mutate(s, `  ELSIF OLD.age_confirmed_at IS NULL THEN\n    NEW.age_confirmed_at := now();`, `  ELSIF OLD.age_confirmed_at IS NULL THEN\n    NULL;`),
  'CHECK ignores the tick': s => mutate(s, `(date_of_birth IS NOT NULL OR age_confirmed_at IS NOT NULL)`, `date_of_birth IS NOT NULL`),
  'CHECK drops region': s => mutate(s, `    AND region           IS NOT NULL\n    AND resident_status  IS NOT NULL\n    AND (resident_status <> 'student'`, `    AND resident_status  IS NOT NULL\n    AND (resident_status <> 'student'`),
  'CHECK still requires nationality': s => mutate(s, `    AND (resident_status <> 'student' OR student_level IS NOT NULL)\n  ));`, `    AND nationality_code IS NOT NULL\n    AND (resident_status <> 'student' OR student_level IS NOT NULL)\n  ));`),
}
for (const [name, fn] of Object.entries(MUTANTS)) {
  const { d, r } = await apply(stripBlock(fn(SQL)))
  let failed = !r.ok
  if (r.ok) { const local = []; await suite(d, (n, g, w) => { if (JSON.stringify(g) !== JSON.stringify(w)) local.push(n) }); failed = local.length > 0; if (failed) console.log(`    caught by: ${local.join(' | ')}`) } else console.log(`    refused at apply: ${r.msg}`)
  T(`mutant noticed: ${name}`, failed, true)
}
{
  const { r } = await apply(mutate(SQL, `  ELSE\n    NEW.age_confirmed_at := OLD.age_confirmed_at;\n  END IF;\n  RETURN NEW;`, `  END IF;\n  RETURN NEW;`))
  console.log(`    in-file block says: ${r.msg}`)
  T('in-file behaviour block refuses a stamp that lets the client move the value', r.ok === false && /moved|cleared/.test(r.msg), true)
}

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)

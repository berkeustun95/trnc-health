// 20261164 (shared adult age) against the PGlite harness (PostgreSQL 18; prod is older, see supabase/CLAUDE.md).
// The messaging age rule is tested ON ITS OWN here, before vehicles uses the helper (Berke, 2026-11-07).
// Seeds profiles + is_anonymous_session() + the 20261036 may_initiate_by_age (sliced from that file), records its
// answers over a date-of-birth × session matrix, applies 20261164, and requires the same answers. Red-first
// mutants prove each guard in the file can fail. Not wired into CI, like its siblings: run by hand.
//
//   node scripts/test-adult-age-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile as applyRaw } from './migration-harness.mjs'

// A refused file leaves its BEGIN open; roll it back so the next query sees the pre-apply state.
const applyFile = async (d, f) => {
  const r = await applyRaw(d, f)
  if (!r.ok) await d.exec('ROLLBACK; RESET ROLE;')
  return r
}

const FILE = fileURLToPath(new URL('../supabase/migrations/20261164_shared_adult_age.sql', import.meta.url))
const SQL = readFileSync(FILE, 'utf8')
const OLD_FILE = fileURLToPath(new URL('../supabase/migrations/20261036_age_oracle_needs_a_real_caller.sql', import.meta.url))
const OLD = readFileSync(OLD_FILE, 'utf8')
const start = OLD.indexOf('CREATE OR REPLACE FUNCTION public.may_initiate_by_age(')
const OLD_FN = OLD.slice(start, OLD.indexOf('$function$;', OLD.indexOf('$function$', OLD.indexOf('AS $function$', start) + 13)) + 11)

// Ages relative to the harness's own today, so the matrix never goes stale.
const PEOPLE = {
  nodob:    { id: '00000000-0000-4000-8000-0000000000a1', dob: 'NULL' },
  adult:    { id: '00000000-0000-4000-8000-0000000000a2', dob: "(current_date - interval '30 years')::date" },
  turns18:  { id: '00000000-0000-4000-8000-0000000000a3', dob: "(current_date - interval '18 years')::date" },
  almost18: { id: '00000000-0000-4000-8000-0000000000a4', dob: "((current_date - interval '18 years') + interval '1 day')::date" },
  minor:    { id: '00000000-0000-4000-8000-0000000000a5', dob: "(current_date - interval '15 years')::date" },
}

const FIXTURE = (oldFn = OLD_FN) => `
CREATE SCHEMA private;
CREATE FUNCTION public.is_anonymous_session() RETURNS boolean LANGUAGE sql STABLE SET search_path TO '' AS $f$
  SELECT coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous')::boolean, false)
$f$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), date_of_birth date);
INSERT INTO auth.users (id) VALUES ${Object.values(PEOPLE).map(p => `('${p.id}')`).join(', ')};
INSERT INTO public.profiles (id, date_of_birth) VALUES ${Object.values(PEOPLE).map(p => `('${p.id}', ${p.dob})`).join(', ')};
${oldFn}
`

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}

const SESSIONS = {
  real:  id => JSON.stringify({ sub: id, role: 'authenticated' }),
  guest: id => JSON.stringify({ sub: id, role: 'authenticated', is_anonymous: true }),
  none:  () => '',
}
async function matrix(d) {
  const out = {}
  for (const [sName, claims] of Object.entries(SESSIONS)) {
    for (const [sender, s] of Object.entries(PEOPLE)) {
      for (const [recipient, r] of Object.entries(PEOPLE)) {
        await d.query("SELECT set_config('request.jwt.claims', $1, false)", [claims(s.id)])
        const { rows } = await d.query(`SELECT public.may_initiate_by_age('${s.id}', '${r.id}') AS ok`)
        out[`${sName}:${sender}→${recipient}`] = rows[0].ok
      }
    }
  }
  await d.query("SELECT set_config('request.jwt.claims', '', false)")
  return out
}

console.log('20261164 — real file')
{
  const d = await freshDb(FIXTURE())
  // The fixture's slice must be the live body the migration's own md5 guard expects, or every result below is moot.
  t('the fixture holds the 20261036 body (md5 of prosrc)',
    (await d.query("SELECT md5(prosrc) m FROM pg_proc WHERE proname = 'may_initiate_by_age'")).rows[0].m, '4ba8dd5b6f6fb8410870084a27ad8d8b')
  const before = await matrix(d)
  const r = await applyFile(d, FILE)
  t('applies, including its own equivalence, boundary and side-by-side assertions', r, { ok: true, msg: null })
  const after = await matrix(d)
  const diffs = Object.keys(before).filter(k => before[k] !== after[k])
  t(`messaging answers identical before and after over ${Object.keys(before).length} cases`, diffs, [])

  // Spot values, so "identical" is not "identically wrong".
  t('real adult → minor is refused', after['real:adult→minor'], false)
  t('real adult → adult is allowed', after['real:adult→adult'], true)
  t('real minor → minor is allowed', after['real:minor→minor'], true)
  t('real minor → adult is allowed', after['real:minor→adult'], true)
  t('real adult → unknown age is refused (fail closed)', after['real:adult→nodob'], false)
  t('real unknown → unknown is refused (fail closed)', after['real:nodob→nodob'], false)
  t('18th birthday today counts as adult (recipient)', after['real:adult→turns18'], true)
  t('one day short of 18 counts as minor (adult may not initiate)', after['real:adult→almost18'], false)
  t('a guest gets false for every pair', Object.entries(after).filter(([k, v]) => k.startsWith('guest:') && v !== false).length, 0)
  t('no session gets false for every pair', Object.entries(after).filter(([k, v]) => k.startsWith('none:') && v !== false).length, 0)

  t('the helper is not callable by authenticated', (await d.query("SELECT has_function_privilege('authenticated', 'private.is_adult_on(date,date)', 'EXECUTE') x")).rows[0].x, false)
  t('the helper is not callable by anon', (await d.query("SELECT has_function_privilege('anon', 'private.is_adult_on(date,date)', 'EXECUTE') x")).rows[0].x, false)
  t('may_initiate_by_age no longer carries its own 18', (await d.query("SELECT prosrc LIKE '%18 years%' x FROM pg_proc WHERE proname = 'may_initiate_by_age'")).rows[0].x, false)
  t('the ACL survived the replace (anon keeps what it had; the in-body guard is the gate)', (await d.query("SELECT has_function_privilege('anon', 'public.may_initiate_by_age(uuid,uuid)', 'EXECUTE') x")).rows[0].x, true)
  t('re-applying is refused (live body is no longer 20261036)', /REFUSING: may_initiate_by_age is not the 20261036 body/.test((await applyFile(d, FILE)).msg), true)
}

// Mutants: each break must make the file refuse at apply.
const dir = mkdtempSync(join(tmpdir(), 'adult-age-'))
function mutant(name, from, to, src = SQL) {
  if (!src.includes(from)) throw new Error(`mutant "${name}": anchor not found`)
  const p = join(dir, `${name}.sql`)
  writeFileSync(p, src.replace(from, () => to))  // a function: `$$` in `to` must stay `$$`
  return p
}
const refused = async (name, file, fixture = FIXTURE()) => {
  const d = await freshDb(fixture)
  const r = await applyFile(d, file)
  t(`${name} → refused`, r.ok, false)
  if (!r.ok) console.log(`      ${r.msg}`)
}
console.log('mutants (each must be refused at apply)')
await refused('helper says 17 years', mutant('17', "AND p_dob <= (p_today - interval '18 years')::date", "AND p_dob <= (p_today - interval '17 years')::date"))
await refused('helper uses < (18th birthday not adult)', mutant('lt', "AND p_dob <= (p_today - interval '18 years')::date", "AND p_dob < (p_today - interval '18 years')::date"))
await refused('helper treats NULL dob as adult', mutant('null', 'SELECT p_dob IS NOT NULL AND p_today IS NOT NULL', 'SELECT (p_dob IS NULL OR p_dob IS NOT NULL) AND p_today IS NOT NULL'))
await refused('messaging falls through to RETURN true', mutant('open', '  RETURN false;\nEND;\n$function$;\n\nDO $$', '  RETURN true;\nEND;\n$function$;\n\nDO $$'))
await refused('recipient test inverted', mutant('inv', 'IF v_recipient IS NOT NULL AND private.is_adult_on(v_recipient, current_date) THEN\n    RETURN true;   -- the recipient',
  'IF v_recipient IS NOT NULL AND NOT private.is_adult_on(v_recipient, current_date) THEN\n    RETURN true;   -- the recipient'))
await refused('helper granted to authenticated', mutant('grant', 'REVOKE ALL ON FUNCTION private.is_adult_on(date, date) FROM PUBLIC, anon, authenticated;',
  'REVOKE ALL ON FUNCTION private.is_adult_on(date, date) FROM PUBLIC, anon;\nGRANT EXECUTE ON FUNCTION private.is_adult_on(date, date) TO authenticated;'))
await refused('ACL changed by the file', mutant('acl', 'CREATE OR REPLACE FUNCTION private.is_adult_on', 'REVOKE ALL ON FUNCTION public.may_initiate_by_age(uuid, uuid) FROM anon;\n\nCREATE OR REPLACE FUNCTION private.is_adult_on'))
await refused('live body is not 20261036 (someone changed messaging since)', FILE,
  FIXTURE(OLD_FN.replace('RETURN true;   -- the sender is a known minor', 'RETURN true;   -- the sender is a known minor (edited)')))

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)

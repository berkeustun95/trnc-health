// 20261199 (push token dedupe) and supabase/probe_push_token_cleanup_dry.sql against the PGlite harness
// (PostgreSQL 18; prod is older, see supabase/CLAUDE.md). The harness models no triggers, so this loads the
// LATEST real body of every trigger function on profiles, sliced out of the migration files at run time
// (check_profile_name_content 20261016, guard_profile_ban_column + get_my_role capture_3, guard_checkin_notice_columns
// 20261092, guard_marketplace_notice_columns 20261183), wired as prod wires them. contains_blocked_term,
// normalize_display_name and is_reserved_display_name are stubs that RAISE: a push_token-only change must never
// reach them. Says nothing about prod's row data beyond what the fixture seeds; the dry run covers that.
// Mutants break the WRITE (or the trigger), never the assertion, and must come back with their specific message.
// Not wired into CI, like its siblings: run by hand.
//
//   node scripts/test-push-token-dedupe-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile as rawApply } from './migration-harness.mjs'

// A refused file leaves its transaction open in PGlite; close it the way the workflow's connection would.
const applyFile = async (d, path) => {
  const r = await rawApply(d, path)
  if (!r.ok) await d.exec('ROLLBACK; RESET ROLE;')
  return r
}

const MIG = fileURLToPath(new URL('../supabase/migrations/20261199_push_token_dedupe.sql', import.meta.url))
const PROBE = fileURLToPath(new URL('../supabase/probe_push_token_cleanup_dry.sql', import.meta.url))
const SQL = readFileSync(MIG, 'utf8')
const PROBE_SQL = readFileSync(PROBE, 'utf8')
const mig = f => readFileSync(fileURLToPath(new URL(`../supabase/migrations/${f}`, import.meta.url)), 'utf8')

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}

// ─── the shared predicate ───────────────────────────────────────────────────
const slice = s => {
  const m = /-- predicate:begin[^\n]*\n([\s\S]*?)\n-- predicate:end/.exec(s)
  if (!m) throw new Error('predicate markers missing')
  return m[1]
}
console.log('predicate slice')
t('migration and probe carry a byte-identical predicate slice', slice(SQL) === slice(PROBE_SQL), true)
t('red-first: a one-character change in the probe slice is noticed',
  slice(SQL) === slice(PROBE_SQL.replace('p.id DESC) AS rn', 'p.id ASC) AS rn')), false)
t('no uuid, e-mail or token literal in either file',
  [SQL, PROBE_SQL].map(s => /[0-9a-f]{8}-[0-9a-f]{4}-|@[a-z0-9-]+\.[a-z]|ExponentPushToken/i.test(s)), [false, false])

// ─── real trigger functions, sliced from the files that last defined them ───
const fn = (file, head) => {
  const s = mig(file)
  const i = s.indexOf(head)
  if (i < 0) throw new Error(`anchor missing: ${head} in ${file}`)
  const j = s.indexOf('$function$;', i)
  if (j < 0) throw new Error(`end missing: ${head} in ${file}`)
  return s.slice(i, j + '$function$;'.length)
}
const TRIGGER_FNS = [
  fn('20260718_capture_3_functions.sql', 'CREATE OR REPLACE FUNCTION public.get_my_role()'),
  fn('20260718_capture_3_functions.sql', 'CREATE OR REPLACE FUNCTION public.guard_profile_ban_column()'),
  fn('20261016_profile_consent_columns.sql', 'CREATE OR REPLACE FUNCTION public.check_profile_name_content()'),
  fn('20261092_checkins.sql', 'CREATE OR REPLACE FUNCTION public.guard_checkin_notice_columns()'),
  fn('20261183_marketplace_listings.sql', 'CREATE OR REPLACE FUNCTION public.guard_marketplace_notice_columns()'),
].join('\n')

// ids: the second-to-last hex digit is the group, the last the member. Higher id = later in "id DESC".
const id = (g, m) => `00000000-0000-4000-8000-0000000000${g}${m}`
const TOK = g => `ExponentPushToken[fixture-${g}]`
const day = n => (n === null ? 'NULL' : `now() - interval '${n} days'`)
// [group, member, role, token group or null, last_sign_in days ago, created days ago]
const ROWS = [
  [1, 1, 'customer', 1, 1, 100], [1, 2, 'customer', 1, 5, 50],                  // keep 11 (newest sign-in, LOWER id)
  [2, 1, 'admin', 2, 2, 200], [2, 2, 'admin', 2, 9, 10],                         // keep 21
  [3, 1, 'customer', 3, 3, 30], [3, 2, 'admin', 3, 1, 300], [3, 3, 'customer', 3, 2, 40], // triple: keep 32
  [4, 1, 'customer', 4, 10, 20], [4, 2, 'customer', 4, null, 400],               // NULL sign-in loses: keep 41
  [5, 1, 'customer', 5, 'tie', 60], [5, 2, 'customer', 5, 'tie', 70],            // tie: keep 52 (id DESC)
  [6, 1, 'customer', 6, null, 80], [6, 2, 'customer', 6, null, 90],              // both NULL: keep 62
  [7, 1, 'customer', 7, 1, 10], [7, 2, 'provider', 7, 2, 20],                    // excluded: provider
  [8, 1, 'customer', 8, 1, 10], [8, 2, null, 8, 2, 20],                          // excluded: NULL role
  [9, 1, 'customer', 'solo-a', 1, 10], [9, 2, 'provider', 'solo-b', 1, 10],     // singletons
  [9, 3, 'customer', null, 1, 10], [9, 4, 'admin', null, null, 10],              // no token
]
const KEEP = [id(1, 1), id(2, 1), id(3, 2), id(4, 1), id(5, 2), id(6, 2)].sort()
const CLEAR = [id(1, 2), id(2, 2), id(3, 1), id(3, 3), id(4, 2), id(5, 1), id(6, 1)].sort()

const usersSql = rows => rows.map(([g, m, , , s, c]) =>
  `('${id(g, m)}', 'u${g}${m}@test.invalid', ${day(c)}, ${s === 'tie' ? "timestamptz '2026-11-01 10:00:00+00'" : day(s)})`).join(',\n  ')
const profSql = rows => rows.map(([g, m, role, tk]) =>
  `('${id(g, m)}', ${role ? `'${role}'` : 'NULL'}, ${tk === null ? 'NULL' : `'${TOK(tk)}'`})`).join(',\n  ')

const fixture = (rows, extra = '') => `
ALTER TABLE auth.users ADD COLUMN email text, ADD COLUMN created_at timestamptz, ADD COLUMN last_sign_in_at timestamptz,
  ADD COLUMN is_anonymous boolean NOT NULL DEFAULT false;
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id), role text, push_token text,
  first_name text, last_name text, full_name text, display_name text, display_name_normalized text,
  resident_status text, resident_status_updated_at timestamptz, date_of_birth date,
  age_ineligible boolean NOT NULL DEFAULT false, terms_version text, terms_accepted_at timestamptz, terms_locale text,
  marketing_opt_in_at timestamptz, ugc_banned_until timestamptz, checkins_notice_at timestamptz,
  checkins_notice_version text, marketplace_notice_at timestamptz, marketplace_notice_version text);
CREATE FUNCTION public.contains_blocked_term(text) RETURNS boolean LANGUAGE plpgsql AS $s$
BEGIN RAISE EXCEPTION 'STUB_REACHED contains_blocked_term'; END $s$;
CREATE FUNCTION public.normalize_display_name(text) RETURNS text LANGUAGE plpgsql AS $s$
BEGIN RAISE EXCEPTION 'STUB_REACHED normalize_display_name'; END $s$;
CREATE FUNCTION public.is_reserved_display_name(text) RETURNS boolean LANGUAGE plpgsql AS $s$
BEGIN RAISE EXCEPTION 'STUB_REACHED is_reserved_display_name'; END $s$;
INSERT INTO auth.users (id, email, created_at, last_sign_in_at) VALUES
  ${usersSql(rows)};
INSERT INTO public.profiles (id, role, push_token) VALUES
  ${profSql(rows)};
-- Distinctive values in every column a trigger could rewrite, set BEFORE the triggers exist.
UPDATE public.profiles SET first_name = 'F' || right(id::text, 2), last_name = 'L', full_name = 'stale full name',
  display_name = 'Dn' || right(id::text, 2), display_name_normalized = 'not-what-normalize-would-say',
  resident_status = 'resident', resident_status_updated_at = timestamptz '2020-02-02 00:00:00+00',
  date_of_birth = DATE '1990-01-01', terms_version = '2026-09-20', terms_accepted_at = timestamptz '2020-03-03 00:00:00+00',
  terms_locale = 'Turkish', marketing_opt_in_at = timestamptz '2020-04-04 00:00:00+00',
  ugc_banned_until = timestamptz '2030-01-01 00:00:00+00', checkins_notice_at = timestamptz '2020-05-05 00:00:00+00',
  checkins_notice_version = '2026-10-08', marketplace_notice_at = timestamptz '2020-06-06 00:00:00+00',
  marketplace_notice_version = '2026-11-01';
${extra}
${TRIGGER_FNS}
CREATE TRIGGER guard_profile_ban BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION guard_profile_ban_column();
CREATE TRIGGER check_profile_name_content BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.check_profile_name_content();
CREATE TRIGGER guard_checkin_notice_columns BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_checkin_notice_columns();
CREATE TRIGGER guard_marketplace_notice_columns BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_marketplace_notice_columns();
`

const snap = async d => Object.fromEntries((await d.query(
  `SELECT id::text AS id, to_jsonb(p)::text AS j FROM public.profiles p ORDER BY id`)).rows.map(r => [r.id, r.j]))
const holders = async (d, toks) => (await d.query(
  `SELECT id::text AS id FROM public.profiles WHERE push_token = ANY($1) ORDER BY id`, [toks])).rows.map(r => r.id)
const probe = async d => (await d.query(PROBE_SQL)).rows[0].push_token_cleanup_dry
const ELIG_TOKS = [1, 2, 3, 4, 5, 6].map(TOK)
const EXCL_IDS = [id(7, 1), id(7, 2), id(8, 1), id(8, 2)]

console.log('20261199 — real file, real triggers')
{
  const d = await freshDb(fixture(ROWS))
  const live = await d.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal`)
  t('four triggers on profiles, as in prod', live.rows[0].n, 4)
  const guard = await applyFileText(d, `UPDATE public.profiles SET checkins_notice_at = now() WHERE id = '${id(1, 1)}'`)
  t('triggers are live: a notice-column write is refused', guard.msg, 'CHECKIN_NOTICE_SERVER_ONLY')
  const ban = await applyFileText(d, `UPDATE public.profiles SET ugc_banned_until = NULL WHERE id = '${id(1, 1)}'`)
  t('triggers are live: a ban write by a non-admin is refused', ban.msg, 'ugc_banned_until is admin-only')

  const p = await probe(d)
  t('probe controls: token rows and auth.users visible', [p.control_token_rows_visible, p.control_auth_users_visible], [true, true])
  t('probe lists every shared group (six eligible, two excluded)', [p.groups.length, p.groups.filter(g => g.eligible).length], [8, 6])
  t('probe excludes the provider group and the NULL-role group, with a reason',
    p.groups.filter(g => !g.eligible).map(g => [g.members.map(m => m.email).sort().join(), g.excluded_reason !== null,
      g.members.every(m => m.kept_by_last_sign_in === null && m.kept_by_created_at === null)]).sort(),
    [['u71@test.invalid,u72@test.invalid', true, true], ['u81@test.invalid,u82@test.invalid', true, true]])
  const keptProbe = p.groups.flatMap(g => g.members.filter(m => m.kept_by_last_sign_in).map(m => m.email)).sort()
  const email = i => `u${i.slice(-2)}@test.invalid`
  t('probe keepers (last sign-in) are the hand-stated ones', keptProbe, KEEP.map(email).sort())
  t('probe keepers (oldest account) differ where they should', p.groups.flatMap(g => g.members.filter(m => m.kept_by_created_at).map(m => m.email)).sort(),
    ['u11@test.invalid', 'u21@test.invalid', 'u32@test.invalid', 'u42@test.invalid', 'u52@test.invalid', 'u62@test.invalid'])
  t('probe prints no token, only an 8-hex fingerprint', p.groups.every(g => /^[0-9a-f]{8}$/.test(g.token_fp)) && !JSON.stringify(p).includes('ExponentPushToken'), true)
  t('probe flags no under-13 blocker in this fixture', p.groups.some(g => g.members.some(m => m.underage_dob_blocks)), false)

  const before = await snap(d)
  const r = await applyFile(d, MIG)
  t('applies, including its own assertions', r, { ok: true, msg: null })
  const after = await snap(d)
  t('rows holding an eligible token afterwards = the hand-stated keepers', await holders(d, ELIG_TOKS), KEEP)
  t('… = exactly the probe\'s kept_by_last_sign_in set', (await holders(d, ELIG_TOKS)).map(email).sort(), keptProbe)
  t('cleared rows now have no token', CLEAR.map(i => JSON.parse(after[i]).push_token), CLEAR.map(() => null))
  t('excluded groups byte-identical', EXCL_IDS.map(i => after[i] === before[i]), EXCL_IDS.map(() => true))
  const strip = j => { const o = JSON.parse(j); delete o.push_token; return JSON.stringify(o) }
  t('no other column changed on any row (triggers did not rewrite)', Object.keys(before).every(k => strip(before[k]) === strip(after[k])), true)
  t('rows outside the cleared set fully identical', Object.keys(before).filter(k => !CLEAR.includes(k)).every(k => before[k] === after[k]), true)
  t('ledger row stamped', (await d.query(`SELECT filename FROM public.schema_migrations_applied`)).rows.map(x => x.filename), ['20261199_push_token_dedupe.sql'])

  const r2 = await applyFile(d, MIG)
  t('second apply passes (ledger ON CONFLICT)', r2, { ok: true, msg: null })
  t('second apply is a no-op', JSON.stringify(await snap(d)) === JSON.stringify(after), true)
  const p2 = await probe(d)
  t('probe after: only the two excluded groups remain', p2.groups.map(g => g.eligible), [false, false])
}

console.log('zero eligible groups')
{
  const noElig = ROWS.filter(([g]) => g >= 7)
  const d = await freshDb(fixture(noElig))
  const before = await snap(d)
  t('only excluded groups + singletons: passes', await applyFile(d, MIG), { ok: true, msg: null })
  t('… and changes nothing', JSON.stringify(await snap(d)) === JSON.stringify(before), true)
  const d2 = await freshDb(fixture(ROWS.filter(([, , , tk]) => tk === null)))
  t('no tokens at all: passes (positive control is conditional on tokens before)', await applyFile(d2, MIG), { ok: true, msg: null })
}

console.log('a member with no auth.users row (the join must not shrink a group)')
{
  // Prod's FK makes this unreachable today; the rule is that groups come from profiles alone regardless.
  const d = await freshDb(fixture(ROWS, `ALTER TABLE public.profiles DROP CONSTRAINT profiles_id_fkey;
DELETE FROM auth.users WHERE id = '${id(1, 1)}';`))
  const p = await probe(d)
  const g1 = p.groups.find(g => g.members.some(m => m.email === 'u12@test.invalid'))
  t('probe keeps the group whole, the auth-less member ranked last', g1.members.map(m => [m.email, m.kept_by_last_sign_in]),
    [['u12@test.invalid', true], [null, false]])
  t('applies', await applyFile(d, MIG), { ok: true, msg: null })
  t('group 1 token now only on the member with a sign-in', await holders(d, [TOK(1)]), [id(1, 2)])
}

console.log('under-13 date of birth on a row to be cleared (the one trigger raise path)')
{
  const d = await freshDb(fixture(ROWS, `UPDATE public.profiles SET date_of_birth = current_date - interval '5 years' WHERE id = '${id(1, 2)}';`))
  const p = await probe(d)
  t('probe flags it', p.groups.flatMap(g => g.members.filter(m => m.underage_dob_blocks).map(m => m.email)), ['u12@test.invalid'])
  const before = await snap(d)
  t('the file rolls back on UNDERAGE', (await applyFile(d, MIG)).msg, 'UNDERAGE')
  t('… with nothing changed', JSON.stringify(await snap(d)) === JSON.stringify(before), true)
}

console.log('mutants (each must be refused with its own message)')
const dir = mkdtempSync(join(tmpdir(), 'ptd-'))
const mutant = (name, edits) => {
  let s = SQL
  for (const [from, to] of edits) {
    if (!s.includes(from)) throw new Error(`mutant anchor missing: ${name}: ${from.slice(0, 60)}`)
    s = s.replace(from, to)
  }
  const p = join(dir, `${name}.sql`)
  writeFileSync(p, s)
  return p
}
const UPD = 'GET DIAGNOSTICS v_cleared = ROW_COUNT;'
const C_CHECK = /  IF EXISTS \(SELECT 1 FROM unnest\(v_elig_tokens\)[\s\S]*?END IF;\n/
const expectRefused = async (name, path, re, extra = '') => {
  const d = await freshDb(fixture(ROWS, extra))
  const before = await snap(d)
  const r = await applyFile(d, path)
  t(`${name}: refused`, [r.ok, re.test(r.msg ?? '') ? 'matched' : r.msg], [false, 'matched'])
  t(`${name}: rolled back`, JSON.stringify(await snap(d)) === JSON.stringify(before), true)
}
await expectRefused('(b) the write takes one extra row',
  mutant('b', [['AND push_token = ANY (v_elig_tokens);', 'AND push_token = ANY (v_elig_tokens) OR id = v_excl_ids[1];']]),
  /did not clear exactly the rows planned/)
await expectRefused('(a) an excluded group is touched after the counted write',
  mutant('a', [[UPD, `${UPD}\n  UPDATE public.profiles SET push_token = NULL WHERE id = v_excl_ids[2];`]]),
  /non-customer\/admin member changed/)
await expectRefused('(c) the keeper is cleared too (whole group cleared)',
  mutant('c', [['FILTER (WHERE r.eligible AND r.rn > 1)', 'FILTER (WHERE r.eligible)']]),
  /not on exactly one row/)
{
  const s = SQL.replace('FILTER (WHERE r.eligible AND r.rn > 1)', 'FILTER (WHERE r.eligible)').replace(C_CHECK, '')
  if (s === SQL || C_CHECK.test(s)) throw new Error('mutant anchor missing: distinct')
  const p = join(dir, 'distinct.sql'); writeFileSync(p, s)
  await expectRefused('(distinct) same, with (c) removed: the distinct-token check still catches it', p, /disappeared from profiles entirely/)
}
await expectRefused('(c) the plan leaves a group shared (triple keeps two)',
  mutant('c2', [['FILTER (WHERE r.eligible AND r.rn > 1)', 'FILTER (WHERE r.eligible AND r.rn > 2)']]),
  /not on exactly one row/)
await expectRefused('(d) plan and after-check disagree on eligibility (plan drops admin)',
  mutant('d', [["coalesce(bool_and(coalesce(p.role IN ('customer', 'admin'), false)), false) AS eligible",
                "coalesce(bool_and(coalesce(p.role IN ('customer'), false)), false) AS eligible"]]),
  /shared token remains that is not one of the left-as-is groups/)
await expectRefused('(e) every token gone at the end',
  mutant('e', [['  IF coalesce(v_any_before, false)', '  UPDATE public.profiles SET push_token = NULL;\n  IF coalesce(v_any_before, false)']]),
  /positive control/)
await expectRefused('(rows) a trigger that rewrites another column',
  MIG, /something other than the planned push_token values changed/,
  `CREATE FUNCTION public.rewrite_mutant() RETURNS trigger LANGUAGE plpgsql AS $m$
   BEGIN IF NEW.push_token IS DISTINCT FROM OLD.push_token THEN NEW.terms_locale := 'English'; END IF; RETURN NEW; END $m$;
   CREATE TRIGGER rewrite_mutant BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.rewrite_mutant();`)

async function applyFileText(d, sql) {
  try { await d.exec(sql); return { ok: true, msg: null } } catch (e) { return { ok: false, msg: String(e.message || e).split('\n')[0] } }
}

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)

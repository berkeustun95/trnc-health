// Onboarding v2 Start choice: 20261204_onboarding_events_start_choice.sql on the PGlite harness, applied after
// 20261202_onboarding_events.sql + 20261203_onboarding_events_retention.sql (PostgreSQL 18; prod is 17.6, see
// supabase/CLAUDE.md). Run by hand:
//
//   node scripts/test-onboarding-start-choice-sql.mjs
//
// The S1 suite (scripts/test-onboarding-s1-sql.mjs) stays the owner of 20261201-03 and of the 11-event list as 20261202
// wrote it; this file owns the 14-event list.
// Fixture: pg_cron stub (cron.job + schedule/unschedule) for 20261203; no profiles (20261202-04 never read them).
// What a pass is evidence of: the three start_choice_* events are accepted for anon / guest / signed-up user and still
// unreadable to all three, the old events still go in, nonsense is refused by policy AND constraint, the file's own
// assertions refuse a value missing from either list, and the verify_schema 1204 token (red before, green after, red on
// either half drifting back). NOT evidence of: PostgREST, or prod's catalog rendering on 17.6 (the token reads LIKE on a
// quoted literal, which both majors render the same way; check the live output after the apply).
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshDb, applyFile } from './migration-harness.mjs'

const rel = p => fileURLToPath(new URL(p, import.meta.url))
const FB = rel('../supabase/migrations/20261202_onboarding_events.sql')
const FC = rel('../supabase/migrations/20261203_onboarding_events_retention.sql')
const FD = rel('../supabase/migrations/20261204_onboarding_events_start_choice.sql')
const SQLD = readFileSync(FD, 'utf8')
const VS = readFileSync(rel('../supabase/verify_schema.sql'), 'utf8')

const G = '10000000-0000-4000-8000-000000000001', S = '20000000-0000-4000-8000-000000000001'
const fixture = `
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean NOT NULL DEFAULT true);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS $f$ INSERT INTO cron.job (jobname, schedule, command) VALUES (n, s, c) RETURNING jobid $f$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $f$ DELETE FROM cron.job WHERE jobname = n RETURNING true $f$;
`

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}

// 'anon' = anon role, no JWT; 'pg' = postgres; otherwise [uid, isAnon] as authenticated.
async function as(db, who, sql, params = []) {
  let role = 'authenticated', claims = ''
  if (who === 'anon') role = 'anon'
  else if (who === 'pg') role = null
  else claims = JSON.stringify({ sub: who[0], role: 'authenticated', is_anonymous: who[1] })
  try {
    await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [claims])
    if (role) await db.exec(`SET ROLE ${role};`)
    return { ok: true, rows: (await db.query(sql, params)).rows }
  } catch (e) { return { ok: false, code: e.code, msg: String(e.message || e).split('\n')[0] } }
  finally { await db.exec('RESET ROLE;'); await db.query(`SELECT set_config('request.jwt.claims', '', false)`) }
}
const outcome = r => r.ok ? 'ok' : r.code

// d: null stops after 20261203.
const build = async ({ d = FD } = {}) => {
  const db = await freshDb(fixture)
  for (const [k, f] of [['B', FB], ['C', FC], ['D', d]]) {
    if (!f) break
    const r = await applyFile(db, f)
    if (!r.ok) return { db, err: `${k}: ${r.msg}` }
  }
  return { db, err: null }
}

const dir = mkdtempSync(join(tmpdir(), 'onb-start-choice-'))
const mutant = (name, from, to) => {
  if (!SQLD.includes(from)) { bad++; console.log(`  ✗ ${name}: anchor missing`); return null }
  const p = join(dir, name.replace(/\W+/g, '_') + '.sql'); writeFileSync(p, SQLD.replace(from, () => to)); return p
}

const slice = (from, to) => { const x = VS.indexOf(from), y = VS.indexOf(to, x + 1); if (x < 0 || y < x) throw new Error('verify_schema anchors missing: ' + from); return VS.slice(x, y) }
const tokq = s => `SELECT m, label, ok FROM (SELECT ''::text m, ''::text label, false ok WHERE false\n${s}) z`
const T02 = tokq(slice('    -- 1202-BEGIN', '    -- 1202-END')), T04 = tokq(slice('    -- 1204-BEGIN', '    -- 1204-END'))
const tokens = async (db, label, sql, want) => {
  try { t(`verify_schema ${label}: ${JSON.stringify(want)}`, (await db.query(sql)).rows.map(x => x.ok), want) }
  catch (e) { t(`verify_schema ${label} does not error`, String(e.message).split('\n')[0], 'no error') }
}

const OLD = ['start_shown', 'offer_shown', 'offer_granted', 'offer_denied', 'offer_later', 'reoffer_shown', 'reoffer_granted',
  'reoffer_declined', 'reoffer_existing_shown', 'reoffer_existing_granted', 'reoffer_existing_declined']
const NEW = ['start_choice_signup', 'start_choice_signin', 'start_choice_guest']
const WHO = { anon: 'anon', guest: [G, true], user: [S, false] }
const ins = (db, c, e) => as(db, c, `INSERT INTO public.onboarding_events (event, platform, runtime_version) VALUES ($1, 'ios', '1.4.2')`, [e])

// ════════════════════════════════════════════════════════════════════════════
console.log('0. the 1204 token is red (never an error) on a database without onboarding_events')
await tokens(await freshDb(fixture), '1204 with no table', T04, [false])

console.log('1. RED FIRST: 20261202 + 20261203 only — the new events are refused, the token is red')
{
  const { db, err } = await build({ d: null })
  t('B + C apply', err, null)
  await tokens(db, '1202 before 1204 (the 1202 token is already green)', T02, [true])
  await tokens(db, '1204 before apply', T04, [false])
  for (const [w, c] of Object.entries(WHO)) {
    const res = []
    for (const e of NEW) res.push(outcome(await ins(db, c, e)))
    t(`${w}: the three new events are refused before 1204`, res.map(x => x !== 'ok'), NEW.map(() => true))
  }
  t('  ...and by the constraint too, for postgres (23514)', outcome(await ins(db, 'pg', 'start_choice_guest')), '23514')
  t('  positive control: an old event goes in for anon', outcome(await ins(db, 'anon', 'offer_shown')), 'ok')
  const rd = await applyFile(db, FD)
  t('D applies on top, with that client row present', rd, { ok: true, msg: null })
  // A refused apply leaves this session in an aborted transaction: read nothing more from it.
  if (rd.ok) t('  ...and the client row is untouched', (await db.query(`SELECT count(*)::int n FROM public.onboarding_events`)).rows[0].n, 1)
}

console.log('2. 20261204 applies, twice (re-runnable), and the tokens go green')
const { db, err } = await build()
t('B + C + D apply cleanly', err, null)
if (err) { console.log(`\n${bad} FAILED (stopped: nothing below can run on a refused apply)`); process.exit(1) }
t('D applies a second time', await applyFile(db, FD), { ok: true, msg: null })
await tokens(db, '1202 after 1204', T02, [true])
await tokens(db, '1204 after apply', T04, [true])
t('probe rows did not survive D', (await db.query(`SELECT count(*)::int n FROM public.onboarding_events`)).rows[0].n, 0)
t('current_user is postgres again', (await db.query(`SELECT current_user::text u`)).rows[0].u, 'postgres')
t('ledger row for D (when stamped)', (await db.query(`SELECT count(*)::int n FROM public.schema_migrations_applied WHERE filename = '20261204_onboarding_events_start_choice.sql'`)).rows[0].n,
  SQLD.includes('ledger:stamp:begin') ? 1 : 0)
const pol = (await db.query(`SELECT string_agg(policyname || ':' || cmd || ':' || roles::text, ', ' ORDER BY policyname) p FROM pg_policies WHERE tablename = 'onboarding_events'`)).rows[0].p
t('policies: the same three as 20261202', pol, 'oe_insert_public:INSERT:{anon,authenticated}, oe_no_delete:DELETE:{anon,authenticated}, oe_no_update:UPDATE:{anon,authenticated}')
t('pkey + 3 CHECKs, same names', (await db.query(`SELECT string_agg(conname, ',' ORDER BY conname) c FROM pg_constraint WHERE conrelid = 'public.onboarding_events'::regclass AND contype IN ('p','c')`)).rows[0].c,
  'onboarding_events_event_check,onboarding_events_pkey,onboarding_events_platform_check,onboarding_events_runtime_len_check')
console.log('      event_check:', (await db.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'onboarding_events_event_check'`)).rows[0].d)

console.log('3. behaviour per caller')
for (const [w, c] of Object.entries(WHO)) {
  const res = []
  for (const e of [...OLD, ...NEW]) res.push(outcome(await ins(db, c, e)))
  t(`${w}: all ${OLD.length + NEW.length} events insert (the 3 new + the ${OLD.length} old)`, res, [...OLD, ...NEW].map(() => 'ok'))
  const deny = async sql => { const r = await as(db, c, sql); return r.ok ? 'ALLOWED' : r.code }
  t(`${w}: 'nonsense' refused`, await deny(`INSERT INTO public.onboarding_events (event, platform) VALUES ('nonsense', 'ios')`) !== 'ALLOWED', true)
  t(`${w}: 'start_choice_other' refused`, await deny(`INSERT INTO public.onboarding_events (event, platform) VALUES ('start_choice_other', 'ios')`) !== 'ALLOWED', true)
  t(`${w}: a new event on platform 'web' refused`, await deny(`INSERT INTO public.onboarding_events (event, platform) VALUES ('start_choice_guest', 'web')`) !== 'ALLOWED', true)
  t(`${w}: insert of created_at refused (42501)`, await deny(`INSERT INTO public.onboarding_events (event, platform, created_at) VALUES ('start_choice_guest', 'ios', now() - interval '1 year')`), '42501')
  t(`${w}: SELECT denied (42501)`, await deny(`SELECT count(*) FROM public.onboarding_events`), '42501')
  t(`${w}: UPDATE denied (42501)`, await deny(`UPDATE public.onboarding_events SET event = 'start_choice_guest' WHERE true`), '42501')
  t(`${w}: DELETE denied (42501)`, await deny(`DELETE FROM public.onboarding_events WHERE true`), '42501')
}
{
  const got = (await db.query(`SELECT count(*)::int n, count(DISTINCT event)::int e, count(*) FILTER (WHERE event LIKE 'start_choice_%')::int s FROM public.onboarding_events`)).rows[0]
  const N = OLD.length + NEW.length
  t(`as postgres: 3 × ${N} rows, ${N} distinct events, 3 × 3 start_choice rows`, [got.n, got.e, got.s], [3 * N, N, 9])
  t('the CHECK refuses nonsense even for postgres (constraint, not just policy)', outcome(await ins(db, 'pg', 'nonsense')), '23514')
}

console.log('MUTANTS of 20261204 (each must be refused by its own assertions; fresh database each)')
const refused = async (name, p, wantMsg) => {
  if (!p) return
  const r = await build({ d: p })
  t(`${name}: D refuses`, r.err !== null && r.err.startsWith('D:'), true)
  t(`  message mentions "${wantMsg}"`, (r.err || '').includes(wantMsg), true)
  console.log(`      ${r.err}`)
}
const POLICY_LIST = "      'start_choice_signup','start_choice_signin','start_choice_guest']::text[])\n    AND platform"
const CON_LIST = "    'start_choice_signup','start_choice_signin','start_choice_guest']::text[]));"
await refused('start_choice_guest dropped from the POLICY only', mutant('pol_drop', POLICY_LIST, POLICY_LIST.replace(",'start_choice_guest'", '')), 'oe_insert_public does not repeat exactly')
await refused('start_choice_signin dropped from the CONSTRAINT only', mutant('con_drop', CON_LIST, CON_LIST.replace(",'start_choice_signin'", '')), 'onboarding_events_event_check does not hold exactly')
await refused('an extra event in the POLICY only', mutant('pol_extra', POLICY_LIST, POLICY_LIST.replace("'start_choice_guest'", "'start_choice_guest','start_choice_other'")), 'oe_insert_public does not repeat exactly')
await refused('INSERT policy WITH CHECK widened to any event', mutant('pol_any', '  WITH CHECK (\n    event = ANY', '  WITH CHECK (\n    event IS NOT NULL OR event = ANY'), 'an OR can widen it')
await refused('INSERT policy to anon only', mutant('anononly', 'FOR INSERT TO anon, authenticated', 'FOR INSERT TO anon'), 'is not TO anon, authenticated')
await refused('a fourth (SELECT) policy', mutant('fourth', '-- ─── Assertions.', 'CREATE POLICY oe_read ON public.onboarding_events FOR SELECT TO authenticated USING (true);\n-- ─── Assertions.'), 'exactly 3 policies')
await refused('SELECT granted', mutant('select', '-- ─── Assertions.', 'GRANT SELECT ON public.onboarding_events TO anon;\n-- ─── Assertions.'), 'anon holds SELECT')

console.log('DRIFT AFTER A CLEAN APPLY (the drift is checked to have landed, then the 1204 token must notice)')
const OLD_ARR = `ARRAY[${OLD.map(e => `'${e}'`).join(',')}]::text[]`
const drift = async (name, sql, landedSql) => {
  const r = await build()
  t(`${name}: B + C + D apply first`, r.err, null)
  if (r.err) return
  await tokens(r.db, `${name}: clean-apply control 1204`, T04, [true])
  try { await r.db.exec(sql) } catch (e) { t(`${name}: drift SQL runs`, String(e.message).split('\n')[0], 'no error'); return }
  const landed = (await r.db.query(landedSql)).rows[0]
  t(`${name}: the drift landed`, landed.v, true)
  await tokens(r.db, `${name}: 1202 (still green: its own half)`, T02, [true])
  await tokens(r.db, `${name}: 1204`, T04, [false])
}
await drift('constraint reverted to the 11 events (policy keeps 14)',
  `ALTER TABLE public.onboarding_events DROP CONSTRAINT onboarding_events_event_check;
   ALTER TABLE public.onboarding_events ADD CONSTRAINT onboarding_events_event_check CHECK (event = ANY (${OLD_ARR}));`,
  `SELECT pg_get_constraintdef(c.oid) NOT LIKE '%start_choice%' AND (SELECT with_check FROM pg_policies WHERE policyname = 'oe_insert_public') LIKE '%start_choice_guest%' v
     FROM pg_constraint c WHERE c.conname = 'onboarding_events_event_check'`)
await drift('policy reverted to the 11 events (constraint keeps 14)',
  `DROP POLICY oe_insert_public ON public.onboarding_events;
   CREATE POLICY oe_insert_public ON public.onboarding_events FOR INSERT TO anon, authenticated
     WITH CHECK (event = ANY (${OLD_ARR}) AND platform = ANY (ARRAY['ios','android']::text[]) AND (runtime_version IS NULL OR length(runtime_version) <= 64));`,
  `SELECT (SELECT with_check FROM pg_policies WHERE policyname = 'oe_insert_public') NOT LIKE '%start_choice%' AND pg_get_constraintdef(c.oid) LIKE '%start_choice_guest%' v
     FROM pg_constraint c WHERE c.conname = 'onboarding_events_event_check'`)

console.log(bad ? `\n${bad} FAILED` : '\nALL PASS')
process.exit(bad ? 1 : 0)

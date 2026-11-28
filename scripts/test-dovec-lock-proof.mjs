// Döveck lock proof (scripts/lib/dovec-lock-proof.mjs): the pure parts with injected clients, plus the proof's SQL run for real
// against the PGlite harness (PostgreSQL 18, one session). PGlite is ONE connection: it cannot model two sessions blocking on
// the advisory lock, so the lock case's SQL is only run end to end with a zero hold (it must be valid and roll back); the
// blocking itself is shown only by the live run. The twin case runs for real, as service_role.
//
//   node scripts/test-dovec-lock-proof.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { freshDb, applyFile } from './migration-harness.mjs'
import { refusal, evalPrecondition, PRECONDITION_SQL, caseASql, caseBSql, caseTwinSql, LEFTOVER_SQL, parseMarker, verdictLock, verdictTwin,
  runProof, HOLD_MS, B_DELAY_MS } from './lib/dovec-lock-proof.mjs'

const M = n => fileURLToPath(new URL(`../supabase/migrations/${n}`, import.meta.url))
const ADMIN = '00000000-0000-4000-8000-000000000001', CUSTOMER = '00000000-0000-4000-8000-000000000002', OTHER = '00000000-0000-4000-8000-000000000003'
const MODS18 = ['accommodation','events','explore','garages','grooming','homeServices','hotels','insurance','jobs','pets','studentHub','towing','transport','ehliyet','connectivity','eatery','cars','news']
const CE = (mods = MODS18) => `
CREATE TABLE public.contact_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), module text NOT NULL, entity_id uuid NOT NULL, action text NOT NULL,
  region text, lang text, item_id text, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_events_module_check CHECK (module IN (${mods.map(m => `'${m}'`).join(',')})),
  CONSTRAINT contact_events_action_check CHECK (action IN ('call','whatsapp','call_secondary','website')));
ALTER TABLE public.contact_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contact_events FROM PUBLIC, anon, authenticated;
GRANT INSERT (id, module, entity_id, action, region, item_id, lang) ON public.contact_events TO anon, authenticated;
CREATE POLICY ce_insert_public ON public.contact_events FOR INSERT TO anon, authenticated WITH CHECK (true);
`
const FIXTURE = CE() + `
CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, role text NOT NULL DEFAULT 'customer');
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $f$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$f$;
-- auth.role() is not in the shared harness: stand-in = the JWT role claim, as in Supabase.
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
$f$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $f$;
GRANT EXECUTE ON FUNCTION auth.jwt() TO anon, authenticated, service_role;
CREATE FUNCTION public.is_anonymous_session() RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) $f$;
INSERT INTO auth.users (id) VALUES ('${ADMIN}'), ('${CUSTOMER}'), ('${OTHER}');
INSERT INTO public.profiles (id, role) VALUES ('${ADMIN}', 'admin'), ('${CUSTOMER}', 'customer'), ('${OTHER}', 'customer');
`

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}

console.log('refusals')
t('missing apply is refused', !!refusal({ ref: 'refs/heads/main', inCI: true, apply: undefined }), true)
t('apply "yes" is refused', !!refusal({ ref: 'refs/heads/main', inCI: true, apply: 'yes' }), true)
t('a feature branch is refused', !!refusal({ ref: 'refs/heads/feat/x', inCI: true, apply: 'false' }), true)
t('a write run outside CI is refused', !!refusal({ ref: undefined, inCI: false, apply: 'true' }), true)
t('main + apply false passes (control)', refusal({ ref: 'refs/heads/main', inCI: true, apply: 'false' }), null)
t('main + apply true passes (control)', refusal({ ref: 'refs/heads/main', inCI: true, apply: 'true' }), null)

console.log('precondition, from real catalog rows')
const catalog = async (files) => {
  const d = await freshDb(FIXTURE)
  for (const f of files) { const r = await applyFile(d, M(f)); if (!r.ok) { bad++; console.log(`  ✗ ${f} did not apply: ${r.msg}`) } }
  await d.exec(`INSERT INTO public.dovec_projects (id, name, city, status, website_url, listed) VALUES ('p1','P','C','on_sale','https://example.com/p', true)`)
  return d
}
const before = await catalog(['20261229_dovec_projects.sql', '20261231_dovec_read_gate.sql'])
const rowOld = (await before.query(PRECONDITION_SQL)).rows[0]
console.log(`  (20261229 definition: secdef=${rowOld.secdef} config=${JSON.stringify(rowOld.config)} has_skip=${rowOld.has_skip})`)
const failsOld = evalPrecondition(rowOld)
t('RED FIRST: the 20261229 definition (INVOKER, no search_path, no EXISTS skip) is refused', failsOld.length >= 3, true)
console.log(`    refusal reasons: ${failsOld.join(' | ')}`)
const d = await catalog(['20261229_dovec_projects.sql', '20261231_dovec_read_gate.sql', '20261240_dovec_leads_limits_definer.sql'])
const rowNew = (await d.query(PRECONDITION_SQL)).rows[0]
console.log(`  (20261240 definition: secdef=${rowNew.secdef} config=${JSON.stringify(rowNew.config)} has_skip=${rowNew.has_skip} triggers=${rowNew.before_insert_row_triggers}/${rowNew.rate_limit_triggers})`)
t('the 20261240 definition is accepted', evalPrecondition(rowNew), [])
t('no function at all is refused', evalPrecondition(undefined).length, 1)
t('one broken field each is refused: secdef', evalPrecondition({ ...rowNew, secdef: false }).length, 1)
t('  search_path public', evalPrecondition({ ...rowNew, config: ['search_path=public'] }).length, 1)
t('  search_path missing', evalPrecondition({ ...rowNew, config: [] }).length, 1)
t('  no skip', evalPrecondition({ ...rowNew, has_skip: false }).length, 1)
t('  a second BEFORE INSERT row trigger', evalPrecondition({ ...rowNew, before_insert_row_triggers: 2 }).length, 1)
t('  no listed project', evalPrecondition({ ...rowNew, has_listed_project: false }).length, 1)

console.log('the SQL, for real (PGlite)')
const exec = async sql => { try { await d.exec(sql); return { rows: [] } } catch (e) { return { error: String(e.message || e) } } }
const user = randomUUID()
t('lock case, session A (hold shortened to zero) is valid SQL and ends in its marker', parseMarker(await exec(caseASql(user).replace(`pg_sleep(${HOLD_MS / 1000})`, 'pg_sleep(0)')), 'a')?.length, 2)
t('lock case, session B is valid SQL and ends in its marker', parseMarker(await exec(caseBSql(user)), 'b')?.length, 2)
const tw = parseMarker(await exec(caseTwinSql(randomUUID(), randomUUID())), 't')
t('twin case against the 20261240 function: accepted, twin = 23505, new 4th = DV429, other person accepted', tw, ['accepted', '23505', 'DV429', 'accepted'])
t('twin case verdict PASS', verdictTwin(tw).ok, true)
t('nothing was committed (leftover = false)', (await d.query(LEFTOVER_SQL)).rows[0].leftover, false)
t('control: the leftover probe sees a LOCKPROOF row when one exists', (await (async () => {
  await d.exec(`INSERT INTO public.dovec_leads (client_request_id, payload_hash, project_id, name, phone, language, language_code, consent, consent_text_version, status) VALUES (gen_random_uuid(), repeat('a',64), 'p1', 'LOCKPROOF', '+900000000000', 'English', 'en', true, 'x', 'mock')`)
  const r = (await d.query(LEFTOVER_SQL)).rows[0].leftover
  await d.exec(`DELETE FROM public.dovec_leads WHERE name = 'LOCKPROOF'`)
  return r
})()), true)
const twOld = parseMarker(await (async () => { try { await before.exec(caseTwinSql(randomUUID(), randomUUID())); return {} } catch (e) { return { error: String(e.message) } } })(), 't')
t('red: against the 20261229 function the twin case does NOT pass (twin at the limit is a rate limit, not a unique violation)', verdictTwin(twOld).ok, false)
console.log(`    old function reported: ${JSON.stringify(twOld)}`)

console.log('verdicts')
const base = 1_000_000
t('B waited for A: PASS', verdictLock([`${base}`, `${base + 10000}`], [`${base + 3000}`, `${base + 10040}`]).ok, true)
t('B not blocked (finished in 20 ms inside the hold): FAIL, not inconclusive', verdictLock([`${base}`, `${base + 10000}`], [`${base + 3000}`, `${base + 3020}`]).line.startsWith('lock case: FAIL'), true)
t('calls serialised (B started after A ended): INCONCLUSIVE, not a pass', verdictLock([`${base}`, `${base + 10000}`], [`${base + 10100}`, `${base + 10120}`]).ok, false)
t('missing timings: not a pass', verdictLock(null, ['1', '2']).ok, false)
t('twin that returns DV429: FAIL', verdictTwin(['accepted', 'DV429', 'DV429', 'accepted']).ok, false)

console.log('runProof with injected clients')
const marks = (a, b, tt = 'accepted:23505:DV429:accepted', left = false) => {
  const calls = []
  const post = async sql => {
    calls.push(sql)
    if (sql === PRECONDITION_SQL) return { rows: [rowNew] }
    if (sql === LEFTOVER_SQL) return { rows: [{ leftover: left }] }
    if (sql.includes("'lockproof_a")) return { error: `HTTP 400: ERROR: lockproof_a:${a}` }
    if (sql.includes("'lockproof_b")) return { error: `HTTP 400: ERROR: lockproof_b:${b}` }
    return { error: `HTTP 400: ERROR: lockproof_t:${tt}` }
  }
  return { post, calls }
}
const run = async (apply, mk, extra = {}) => {
  const lines = []
  const r = await runProof({ apply, post: mk.post, sleep: async () => {}, uuid: randomUUID, log: l => lines.push(l), ...extra })
  return { ...r, text: lines.join('\n') }
}
const writes = calls => calls.filter(s => /INSERT INTO public\.dovec_leads/.test(s)).length
{
  const mk = marks(`${base}:${base + 10000}`, `${base + 3000}:${base + 10040}`)
  const dry = await run('false', mk)
  t('dry: exit 0, only the catalog read was sent, no INSERT', [dry.code, mk.calls.length, writes(mk.calls)], [0, 1, 0])
  const mk2 = marks(`${base}:${base + 10000}`, `${base + 3000}:${base + 10040}`)
  const ap = await run('true', mk2)
  t('apply with passing timings: exit 0, INSERTs sent, leftover read last', [ap.code, writes(mk2.calls) > 0, mk2.calls.at(-1) === LEFTOVER_SQL], [0, true, true])
  const noDigits = ap.text.replace(/[a-z_]*_ms=\d+/g, '')
  t('output: no uuid', /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(ap.text + dry.text), false)
  t('output: no ADA-n / TEST-1', /ADA-\d|TEST-1/.test(ap.text + dry.text), false)
  t('output: no digit beyond the *_ms values', /\d/.test(noDigits + dry.text.replace(/[a-z_]*_ms=\d+/g, '')), false)
  console.log(ap.text.split('\n').map(l => '    | ' + l).join('\n'))
  const mk3 = marks(`${base}:${base + 10000}`, `${base + 3000}:${base + 3020}`)
  t('apply, B not blocked: exit non-zero', (await run('true', mk3)).code, 1)
  const mk4 = marks(`${base}:${base + 10000}`, `${base + 3000}:${base + 10040}`, 'accepted:23505:DV429:accepted', true)
  t('apply, a LOCKPROOF row left behind: exit non-zero', (await run('true', mk4)).code, 1)
  const mk5 = { calls: [], post: async s => { mk5.calls.push(s); return s === PRECONDITION_SQL ? { rows: [rowOld] } : { rows: [] } } }
  const old = await run('true', mk5)
  t('apply against the OLD function: refused before any write', [old.code, mk5.calls.length, writes(mk5.calls)], [1, 1, 0])
  const mk6 = marks(`${base}:${base + 10000}`, `${base + 3000}:${base + 10040}`)
  const failing = { post: async s => (s.includes('lockproof_b') ? { error: 'HTTP 500: Key (user_id)=(' + randomUUID() + ') ADA-77' } : mk6.post(s)) }
  const f = await run('true', failing)
  t('an unexpected error is printed redacted and still runs the leftover check', [f.code, /[0-9a-f]{8}-[0-9a-f]{4}/.test(f.text), /ADA-77/.test(f.text), f.text.includes('leftover')], [1, false, false, true])
}
t('timing constants: B starts inside the hold with margin', HOLD_MS - B_DELAY_MS >= 2000, true)

console.log(bad ? `\n  ${bad} failure(s).` : '\n  All checks passed.')
process.exit(bad ? 1 : 0)

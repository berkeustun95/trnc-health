// 20261143_eatery_order_method.sql against the PGlite harness (PostgreSQL 18; prod is older — see supabase/CLAUDE.md).
// Fixture: the SAME fixture text as scripts/test-eatery-orders-sql.mjs (sliced out of that file, not retyped) + the Crunchy
// Express seed row of 20261115 (the file's backfill target) + the 20261120 preview-key policies, then the REAL 20261125,
// 20261132 and 20261134 files. The 1143 file's own probes do the role work; this script adds
//   (a) "identical except": pg_get_functiondef of create after 1134 vs after 1143, line-diffed, only the listed lines
//       differ; verify_eatery_order byte-identical; owner / DEFINER / search_path / ACL identical;
//   (b) the data: crunchy-express = whatsapp, the column text NOT NULL no default, a re-apply writes nothing and survives a
//       second partner (seeded after the first apply), a phone partner cannot order;
//   (c) RED-FIRST mutants of the file (every anchor asserted present, the apply must FAIL with the expected message);
//   (d) the verify_schema.sql 1143 H token block + the B / E registrations: never error before 1143, false before, true after.
// Not wired into package.json / pre-push / CI, like its siblings: run by hand.
//
//   node scripts/test-eatery-order-method-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile } from './migration-harness.mjs'

const M = (n) => fileURLToPath(new URL(`../supabase/migrations/${n}`, import.meta.url))
const F1125 = M('20261125_eatery_orders.sql'), F1132 = M('20261132_eatery_orders_is_test.sql'), F1134 = M('20261134_eatery_item_options.sql')
const F1143 = M('20261143_eatery_order_method.sql')
const SQL = readFileSync(F1143, 'utf8')
const PRIOR = readFileSync(M('20261115_eatery_partners.sql'), 'utf8')
const a = PRIOR.indexOf('CREATE TABLE IF NOT EXISTS public.eatery_partners'), b = PRIOR.indexOf('-- ─── Storage bucket')
const s0 = PRIOR.indexOf('-- ─── Seed: Crunchy Express, INACTIVE'), s1 = PRIOR.indexOf('-- ─── contact_events: module')
if (a < 0 || b < a || s0 < 0 || s1 < s0) throw new Error('fixture anchors missing in 20261115')
const SIB = readFileSync(fileURLToPath(new URL('./test-eatery-orders-sql.mjs', import.meta.url)), 'utf8')
const fa = SIB.indexOf('const FIXTURE = `'), fb = SIB.indexOf('`\n\nlet bad', fa)
if (fa < 0 || fb < fa) throw new Error('FIXTURE anchors missing in test-eatery-orders-sql.mjs')
const BASE = new Function('PRIOR', 'a', 'b', 'return ' + SIB.slice(fa + 'const FIXTURE = '.length, fb + 1))(PRIOR, a, b)
const KEY = readFileSync(M('20261120_eatery_preview_key.sql'), 'utf8')
const pa = KEY.indexOf('DROP POLICY IF EXISTS eatery_partners_select_preview'), pb = KEY.indexOf('-- ─── Post-state + proof')
if (pa < 0 || pb < pa) throw new Error('policy anchors missing in 20261120')
const FIXTURE = BASE + '\n' + PRIOR.slice(s0, s1) + '\n' + KEY.slice(pa, pb)

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const dir = mkdtempSync(join(tmpdir(), 'om-'))
const after1134 = async () => {
  const d = await freshDb(FIXTURE)
  for (const f of [F1125, F1132, F1134]) { const r = await applyFile(d, f); if (!r.ok) throw new Error(f + ' did not apply: ' + r.msg) }
  return d
}
const q = async (d, sql) => (await d.query(sql)).rows

// mutant: list of [from, to, all?]; every anchor is asserted present (once, unless all).
const mutant = (name, pairs) => {
  let text = SQL
  for (const [from, to, all] of pairs) {
    const n = text.split(from).length - 1
    if (n < 1 || (!all && n !== 1)) { bad++; console.log(`  ✗ ${name}: anchor ${JSON.stringify(from.slice(0, 70))} found ${n}x`); return null }
    text = all ? text.split(from).join(to) : text.replace(from, () => to)
  }
  const p = join(dir, name.replace(/\W+/g, '_') + '.sql'); writeFileSync(p, text); return p
}
const table = []
const refused = async (name, p, wantMsg, { seed = '' } = {}) => {
  if (!p) { table.push([name, 'ANCHOR MISSING', '']); return }
  const d = await after1134()
  if (seed) await d.exec(seed)
  const r = await applyFile(d, p)
  const hit = !r.ok && (r.msg || '').includes(wantMsg)
  t(`${name}: apply FAILS with "${wantMsg}"`, [r.ok, hit], [false, true])
  console.log(`      ${r.ok ? '(applied!)' : r.msg}`)
  table.push([name, r.ok ? 'GREEN (BAD)' : hit ? 'RED (as expected)' : 'RED, wrong message', r.ok ? '' : r.msg.slice(0, 110)])
}

console.log('20261143_eatery_order_method — real files on the 20261115-state fixture (+ Crunchy seed row, + 1120 policies), 1125 / 1132 / 1134 applied first')

// ── green ──
const db = await after1134()
const defs = async (d) => ({
  create: (await q(d, `SELECT pg_get_functiondef('public.create_eatery_order(uuid,jsonb,text)'::regprocedure) d`))[0].d,
  verify: (await q(d, `SELECT pg_get_functiondef('public.verify_eatery_order(text)'::regprocedure) d`))[0].d })
const meta = async (d) => q(d, `SELECT p.proname, pg_get_userbyid(p.proowner) o, p.prosecdef sd, p.proconfig cfg, p.pronargs na, pg_get_function_arguments(p.oid) args,
    (SELECT string_agg(CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END, ',' ORDER BY 1) FROM aclexplode(p.proacl) x LEFT JOIN pg_roles r ON r.oid = x.grantee WHERE x.privilege_type = 'EXECUTE') grants
  FROM pg_proc p WHERE p.proname IN ('create_eatery_order','verify_eatery_order') AND p.pronamespace = 'public'::regnamespace ORDER BY 1`)
const d1 = await defs(db), m1 = await meta(db)

// verify_schema tokens: the 1143 block is cut between its own header and the 1135 comment that follows it.
const VS = readFileSync(fileURLToPath(new URL('../supabase/verify_schema.sql', import.meta.url)), 'utf8')
const i43 = VS.indexOf('    -- ── 1143: eatery_partners.order_method'), i35 = VS.indexOf('    -- 1135 Crunchy per-dish options (data).')
if (i43 < 0 || i35 < i43) throw new Error('verify_schema 1143 token anchors missing')
const tokq = (s) => `SELECT migration, object, ok FROM (SELECT ''::text migration, ''::text object, false ok WHERE false\n${s}) z`
const T43 = tokq(VS.slice(i43, i35))
const tokens = async (d, label, sql, want) => {
  try {
    const rows = (await d.query(sql)).rows
    t(`verify_schema ${label}: ${rows.length} tokens, all ${want}`, [rows.length === 2, rows.every(r => r.ok === want)], [true, true])
    if (rows.some(r => r.ok !== want)) console.log(rows.filter(r => r.ok !== want).map(r => '      ' + r.object.slice(0, 100)).join('\n'))
  } catch (e) { t(`verify_schema ${label} does not error`, String(e.message).split('\n')[0], 'no error') }
}
// Registered B / E rows exist in the file (the harness has no verify_schema QUERY 1, so the text is the evidence here).
t('verify_schema registers B order_method and E eatery_partners_order_method_check',
  [VS.includes("('20261143_eatery_order_method','eatery_partners','order_method')"), VS.includes("('20261143_eatery_order_method','eatery_partners_order_method_check')")], [true, true])
await tokens(db, '1143 tokens BEFORE 1143 (must not error; red is fine)', T43, false)

const first = await applyFile(db, F1143)
t('1143 applies cleanly on the 1134 state (in-file probes green)', first, { ok: true, msg: null })
if (!first.ok) process.exit(1)
t('1143 applies a SECOND time (re-runnable, ledger row present)', await applyFile(db, F1143), { ok: true, msg: null })
t('ledger row written', (await q(db, `SELECT filename FROM public.schema_migrations_applied ORDER BY 1`)).map(r => r.filename),
  ['20261125_eatery_orders.sql', '20261132_eatery_orders_is_test.sql', '20261134_eatery_item_options.sql', '20261143_eatery_order_method.sql'])
await tokens(db, '1143 tokens AFTER 1143', T43, true)
// The OLDER tokens that read create_eatery_order / its COMMENT must still be green on a post-1143 database (the sibling probes stop at 1134).
{
  const i34 = VS.indexOf('    -- ── 1134: per-dish options'), i32 = VS.indexOf('    -- ── 1132: server-marked TEST orders'),
    i25 = VS.indexOf('    -- ── 1125: WhatsApp order proof.'), i19 = VS.indexOf("    UNION ALL SELECT '1119_eatery_preview_read','eatery_partners: exactly 2")
  if (i34 < 0 || i32 < i34 || i25 < i32 || i19 < i25) throw new Error('verify_schema 1134 / 1132 / 1125 token anchors missing')
  const old = async (label, s) => {
    const rows = (await db.query(tokq(s))).rows
    t(`verify_schema ${label} AFTER 1143: ${rows.length} tokens, all true`, [rows.length > 0, rows.every(r => r.ok === true)], [true, true])
    if (rows.some(r => r.ok !== true)) console.log(rows.filter(r => r.ok !== true).map(r => '      ' + r.object.slice(0, 110)).join('\n'))
  }
  await old('1134 tokens', VS.slice(i34, i32)); await old('1132 tokens', VS.slice(i32, i25)); await old('1125 tokens', VS.slice(i25, i19))
}
t('crunchy-express is whatsapp, and it is the only partner', await q(db, `SELECT slug, order_method FROM public.eatery_partners ORDER BY slug`), [{ slug: 'crunchy-express', order_method: 'whatsapp' }])
t('column: text, NOT NULL, no default', await q(db, `SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='eatery_partners' AND column_name='order_method'`),
  [{ data_type: 'text', is_nullable: 'NO', column_default: null }])
t('CHECK rendering (PG 18, printed for the record)', (await q(db, `SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='eatery_partners_order_method_check'`)).length, 1)
console.log('     ', (await q(db, `SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='eatery_partners_order_method_check'`))[0].d)
t('no probe row survived', (await q(db, `SELECT (SELECT count(*) FROM public.eatery_orders)::int o, (SELECT count(*) FROM public.eatery_partners WHERE slug LIKE 'zz-%')::int p, (SELECT count(*) FROM private.preview_key_hashes)::int k`)), [{ o: 0, p: 0, k: 0 }])

// ── (a) only the listed lines differ ──
const d2 = await defs(db), m2 = await meta(db)
const lineDiff = (x, y) => {
  const A = x.split('\n'), B = y.split('\n')
  const L = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0))
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const removed = [], added = []
  let i = 0, j = 0
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { i++; j++ } else if (L[i + 1][j] >= L[i][j + 1]) removed.push(A[i++]); else added.push(B[j++])
  }
  while (i < A.length) removed.push(A[i++])
  while (j < B.length) added.push(B[j++])
  return { removed: removed.filter(l => l.trim()), added: added.filter(l => l.trim()) }
}
t('create_eatery_order: exactly the v_partner select changed (one line out, one in) and the refusal block was added', lineDiff(d1.create, d2.create), {
  removed: [`  SELECT p.id, p.is_active, p.order_requires_account, p.adult_only INTO v_partner`],
  added: [`  SELECT p.id, p.is_active, p.order_requires_account, p.adult_only, p.order_method INTO v_partner`,
    `  -- 20261143: a phone-only restaurant has no basket. Unconditional: the ADA Preview key does not bypass it, so a`,
    `  -- phone partner can never gain an order row, even while it is being previewed.`,
    `  IF v_partner.order_method IS DISTINCT FROM 'whatsapp' THEN`,
    `    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'order_not_supported';`,
    `  END IF;`] })
t('verify_eatery_order: byte-identical', d2.verify === d1.verify, true)
t('create/verify: owner, DEFINER, search_path, argument list, ACL identical before and after', m2, m1)
t('create: argument names unchanged', (await q(db, `SELECT proargnames FROM pg_proc WHERE oid = 'public.create_eatery_order(uuid,jsonb,text)'::regprocedure`))[0].proargnames, ['p_partner', 'p_items', 'p_client_id'])

// ── (b) re-apply after a second partner exists (the 20261144 situation) ──
{
  await db.exec(`INSERT INTO public.eatery_partners (slug, name, category, order_method) VALUES ('zz-second', 'zz second', 'cafe', 'phone')`)
  t('re-apply with a second (phone) partner present is accepted', await applyFile(db, F1143), { ok: true, msg: null })
  t('the second partner kept its method; crunchy kept whatsapp', await q(db, `SELECT slug, order_method FROM public.eatery_partners ORDER BY slug`),
    [{ slug: 'crunchy-express', order_method: 'whatsapp' }, { slug: 'zz-second', order_method: 'phone' }])
  await db.exec(`DELETE FROM public.eatery_partners WHERE slug = 'zz-second'`)
}

// ── pre-state ──
{
  const d = await freshDb(FIXTURE)
  const r = await applyFile(d, F1143)
  t('pre-state: refuses without 20261134 in the ledger', [r.ok, (r.msg || '').includes('20261134_eatery_item_options.sql is not in the ledger')], [false, true])
  table.push(['1134 not applied', r.ok ? 'GREEN (BAD)' : 'RED (as expected)', (r.msg || '').slice(0, 110)])
}

console.log('\nMUTANTS (each must be refused by the guarding probe/assertion)')
const REF = `  IF v_partner.order_method IS DISTINCT FROM 'whatsapp' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'order_not_supported';
  END IF;
`
const SELECT_NEW = `  SELECT p.id, p.is_active, p.order_requires_account, p.adult_only, p.order_method INTO v_partner`
const NEUT = [
  ["RAISE EXCEPTION 'create_eatery_order body: the order_method select / refusal shapes are missing'", "RAISE NOTICE 'create_eatery_order body: the order_method select / refusal shapes are missing'"],
  ["RAISE EXCEPTION 'create_eatery_order body: the refusal is not between", "RAISE NOTICE 'create_eatery_order body: the refusal is not between"],
  ["RAISE EXCEPTION 'the refusal block is not unconditional", "RAISE NOTICE 'the refusal block is not unconditional"]]
// structural-red: only the function body is mutated, the in-file assertion that reads the body fires
await refused('refusal block deleted (body only)', mutant('ref_del_s', [[REF, '']]), 'the order_method select / refusal shapes are missing')
await refused('previewer bypass in the refusal (body only)', mutant('bypass_s', [[`IF v_partner.order_method IS DISTINCT FROM 'whatsapp' THEN`, `IF v_partner.order_method IS DISTINCT FROM 'whatsapp' AND NOT public.is_previewer() THEN`]]), 'the order_method select / refusal shapes are missing')
await refused('refusal moved after the adult_only / account checks (body only)', mutant('moved_s', [[REF, ''], [`  IF v_partner.order_requires_account AND public.is_anonymous_session() THEN`, REF + `  IF v_partner.order_requires_account AND public.is_anonymous_session() THEN`]]), 'the refusal is not between')
await refused('error message renamed (body only)', mutant('msg_s', [[`MESSAGE = 'order_not_supported';\n  END IF;`, `MESSAGE = 'order_unsupported';\n  END IF;`]]), 'the order_method select / refusal shapes are missing')
await refused('select forgets p.order_method (body only)', mutant('sel_s', [[SELECT_NEW, '  SELECT p.id, p.is_active, p.order_requires_account, p.adult_only INTO v_partner']]), 'the order_method select / refusal shapes are missing')
// behaviour-red: the structural assertions are neutralised too, so only the in-file BEHAVIOUR probes can notice
await refused('refusal block deleted (body + assertions): behaviour probe', mutant('ref_del_b', [[REF, ''], ...NEUT]), 'STEP "phone, active, signed-in user: order_not_supported"')
await refused('previewer bypass (body + assertions): behaviour probe', mutant('bypass_b', [[`IF v_partner.order_method IS DISTINCT FROM 'whatsapp' THEN`, `IF v_partner.order_method IS DISTINCT FROM 'whatsapp' AND NOT public.is_previewer() THEN`], ...NEUT]), 'STEP "phone, active + Preview key: order_not_supported"')
await refused('refusal after the adult_only check (body + assertions): behaviour probe', mutant('moved_b', [[REF, ''], [`  IF v_partner.order_requires_account AND public.is_anonymous_session() THEN`, REF + `  IF v_partner.order_requires_account AND public.is_anonymous_session() THEN`], ...NEUT]), 'STEP "phone adult_only, guest: order_not_supported BEFORE adult_only"')
await refused('refusal runs before partner_unavailable (body + assertions): behaviour probe', mutant('early_b', [[REF, ''], [`  IF NOT FOUND OR NOT (v_partner.is_active OR public.is_previewer()) THEN`, `  IF NOT FOUND THEN\n    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'partner_unavailable';\n  END IF;\n` + REF + `  IF NOT (v_partner.is_active OR public.is_previewer()) THEN`], ...NEUT]), 'STEP "phone, inactive, no key: still partner_unavailable"')
await refused('refusal refuses everyone incl. whatsapp (body + assertions): positive control', mutant('all_b', [[`IF v_partner.order_method IS DISTINCT FROM 'whatsapp' THEN`, `IF true THEN`], ...NEUT]), 'STEP "whatsapp, active: accepted"')
// the column and its rules
await refused('CHECK never created (DDL only)', mutant('chk_s', [[`ALTER TABLE public.eatery_partners ADD  CONSTRAINT eatery_partners_order_method_check\n  CHECK (order_method IN ('whatsapp','phone'));\n`, '']]), 'CHECK constraint(s) mention order_method (want exactly 1)')
await refused("CHECK widened to allow 'fax' (DDL only)", mutant('chk_w', [[`CHECK (order_method IN ('whatsapp','phone'))`, `CHECK (order_method IN ('whatsapp','phone','fax'))`]]), 'eatery_partners_order_method_check allows')
await refused("CHECK widened to allow 'fax' (DDL + assertion): in-file insert/update probe", mutant('chk_w_b', [[`CHECK (order_method IN ('whatsapp','phone'))`, `CHECK (order_method IN ('whatsapp','phone','fax'))`], ["IF v_set IS DISTINCT FROM ARRAY['phone','whatsapp']::text[] THEN", 'IF false THEN']]), 'STEP "CHECK: order_method = fax refused"')
await refused("DEFAULT 'whatsapp' added", mutant('dflt', [['ADD COLUMN IF NOT EXISTS order_method text;', "ADD COLUMN IF NOT EXISTS order_method text DEFAULT 'whatsapp';"]]), 'order_method is type=')
await refused('SET NOT NULL removed', mutant('nn', [['ALTER TABLE public.eatery_partners ALTER COLUMN order_method SET NOT NULL;\n', '']]), 'order_method is type=')
await refused('backfill slug typo (nothing backfilled)', mutant('typo', [[`WHERE slug = 'crunchy-express' AND order_method IS NULL;`, `WHERE slug = 'crunchy-expres' AND order_method IS NULL;`]]), 'backfill left 1 partner(s)')
await refused('backfill sets the wrong method', mutant('wrongm', [[`SET order_method = 'whatsapp' WHERE slug = 'crunchy-express' AND order_method IS NULL;`, `SET order_method = 'phone' WHERE slug = 'crunchy-express' AND order_method IS NULL;`]]), 'crunchy-express is not whatsapp after the first-apply backfill')
// the pre-state refusals are mutations of the DATABASE, not the file
{
  const d = await after1134()
  await d.exec(`INSERT INTO public.eatery_partners (slug, name, category) VALUES ('zz-extra', 'zz extra', 'cafe')`)
  const r = await applyFile(d, F1143)
  const hit = !r.ok && (r.msg || '').includes('expected exactly {crunchy-express}')
  t('pre-state: a second partner before the first apply is refused, and the message prints what is there', [r.ok, hit], [false, true])
  console.log(`      ${r.msg}`)
  table.push(['second partner on first apply', hit ? 'RED (as expected)' : 'WRONG', (r.msg || '').slice(0, 110)])
}
{
  const d = await after1134()
  await d.exec(`DELETE FROM public.eatery_partners WHERE slug = 'crunchy-express'`)
  const r = await applyFile(d, F1143)
  const hit = !r.ok && (r.msg || '').includes('expected exactly {crunchy-express}')
  t('pre-state: no crunchy-express row is refused', [r.ok, hit], [false, true])
  table.push(['no crunchy row on first apply', hit ? 'RED (as expected)' : 'WRONG', (r.msg || '').slice(0, 110)])
}
{
  // body drift: a hand-edited live body (the 1134 shape lost) must be refused, never overwritten
  const d = await after1134()
  const def = (await q(d, `SELECT pg_get_functiondef('public.create_eatery_order(uuid,jsonb,text)'::regprocedure) d`))[0].d
  const drift = def.replace('v_test := public.is_previewer() OR public.is_order_tester(v_uid);', 'v_test := false;')
  if (drift === def) { bad++; console.log('  ✗ drift anchor missing') }
  await d.exec(drift)
  const r = await applyFile(d, F1143)
  const hit = !r.ok && (r.msg || '').includes('create_eatery_order is not the 20261134 body')
  t('pre-state: a drifted live body (no test derivation) is refused, not overwritten', [r.ok, hit], [false, true])
  table.push(['drifted live body', hit ? 'RED (as expected)' : 'WRONG', (r.msg || '').slice(0, 110)])
}
await refused('verify_eatery_order touched by the file', mutant('ver', [[`-- ─── Assertions (inside the transaction; a failure rolls the file back) ─────`, `ALTER FUNCTION public.verify_eatery_order(text) SECURITY INVOKER;\n-- ─── Assertions (inside the transaction; a failure rolls the file back) ─────`]]), 'verify_eatery_order changed during this file')
await refused('create EXECUTE granted to anon', mutant('ganon', [['GRANT  EXECUTE ON FUNCTION public.create_eatery_order(uuid, jsonb, text) TO authenticated;', 'GRANT  EXECUTE ON FUNCTION public.create_eatery_order(uuid, jsonb, text) TO anon, authenticated;']]), 'create_eatery_order: definer=')
await refused('create search_path unpinned', mutant('sp', [['  SET search_path = public, pg_temp\nAS $fn$', 'AS $fn$']]), 'create_eatery_order: definer=')
await refused('anon given UPDATE on eatery_partners.order_method', mutant('gcol', [['-- ─── Assertions (inside', 'GRANT UPDATE (order_method) ON public.eatery_partners TO anon;\n-- ─── Assertions (inside']]), 'anon or authenticated can write eatery_partners')
await refused('an extra policy on eatery_partners', mutant('pol', [['-- ─── Assertions (inside', 'CREATE POLICY zz_open ON public.eatery_partners FOR SELECT TO anon USING (true);\n-- ─── Assertions (inside']]), 'eatery_partners policies are')

console.log('\nRED / GREEN TABLE')
const w = Math.max(...table.map(r => r[0].length))
for (const [n, s, m] of table) console.log(`  ${n.padEnd(w)}  ${s.padEnd(20)} ${m}`)
console.log(bad ? `\n${bad} FAILED` : '\nALL GREEN')
process.exit(bad ? 1 : 0)

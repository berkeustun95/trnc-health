// 20261134_eatery_item_options.sql against the PGlite harness (PostgreSQL 18; prod is older — see supabase/CLAUDE.md).
// Fixture: the SAME fixture text as scripts/test-eatery-orders-sql.mjs (sliced out of that file, not retyped) + the 20261120
// preview-key policies on the eatery tables (sliced from the real file: without them a Preview key cannot read an INACTIVE
// partner's menu items, and the options policy reads those tables as the calling role), then the REAL 20261125, 20261132 and
// 20261134 files. The 1134 file's own probes do the role work; this script adds
//   (a) "identical except": pg_get_functiondef of create/verify after 1132 vs after 1134;
//   (b) golden: a basket without opts returns the same lines and total under 1132 and under 1134;
//   (c) role probes from outside the file (detail text, price arithmetic, RLS with positive controls, CHECK mutants);
//   (d) RED-FIRST mutants of the file (anchors asserted present, the apply must FAIL with the expected message);
//   (e) the verify_schema.sql 1134 / 1132 / 1125 H tokens: never error before 1134, false before, true after.
// Not wired into package.json / pre-push / CI, like its siblings: run by hand.
//
//   node scripts/test-eatery-item-options-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile, asRole } from './migration-harness.mjs'

const M = (n) => fileURLToPath(new URL(`../supabase/migrations/${n}`, import.meta.url))
const F1125 = M('20261125_eatery_orders.sql'), F1132 = M('20261132_eatery_orders_is_test.sql'), F1134 = M('20261134_eatery_item_options.sql')
const SQL = readFileSync(F1134, 'utf8')
const PRIOR = readFileSync(M('20261115_eatery_partners.sql'), 'utf8')
const a = PRIOR.indexOf('CREATE TABLE IF NOT EXISTS public.eatery_partners')
const b = PRIOR.indexOf('-- ─── Storage bucket')
if (a < 0 || b < a) throw new Error('fixture anchors missing in 20261115')
const SIB = readFileSync(fileURLToPath(new URL('./test-eatery-orders-sql.mjs', import.meta.url)), 'utf8')
const fa = SIB.indexOf('const FIXTURE = `'), fb = SIB.indexOf('`\n\nlet bad', fa)
if (fa < 0 || fb < fa) throw new Error('FIXTURE anchors missing in test-eatery-orders-sql.mjs')
const BASE = new Function('PRIOR', 'a', 'b', 'return ' + SIB.slice(fa + 'const FIXTURE = '.length, fb + 1))(PRIOR, a, b)
const KEY = readFileSync(M('20261120_eatery_preview_key.sql'), 'utf8')
const pa = KEY.indexOf('DROP POLICY IF EXISTS eatery_partners_select_preview'), pb = KEY.indexOf('-- ─── Post-state + proof')
if (pa < 0 || pb < pa) throw new Error('policy anchors missing in 20261120')
const FIXTURE = BASE + '\n' + KEY.slice(pa, pb)

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const dir = mkdtempSync(join(tmpdir(), 'opt-'))
const after1132 = async () => {
  const d = await freshDb(FIXTURE)
  for (const f of [F1125, F1132]) { const r = await applyFile(d, f); if (!r.ok) throw new Error(f + ' did not apply: ' + r.msg) }
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
const refused = async (name, p, wantMsg) => {
  if (!p) { table.push([name, 'ANCHOR MISSING', '']); return }
  const d = await after1132()
  const r = await applyFile(d, p)
  const hit = !r.ok && (r.msg || '').includes(wantMsg)
  t(`${name}: apply FAILS with "${wantMsg}"`, [r.ok, hit], [false, true])
  console.log(`      ${r.ok ? '(applied!)' : r.msg}`)
  table.push([name, r.ok ? 'GREEN (BAD)' : hit ? 'RED (as expected)' : 'RED, wrong message', r.ok ? '' : r.msg.slice(0, 110)])
}

console.log('20261134_eatery_item_options — real files on the 20261115-state fixture (+1120 policies), 1125 and 1132 applied first')

// ── green ──
const db = await after1132()
const defs = async (d) => ({
  create: (await q(d, `SELECT pg_get_functiondef('public.create_eatery_order(uuid,jsonb,text)'::regprocedure) d`))[0].d,
  verify: (await q(d, `SELECT pg_get_functiondef('public.verify_eatery_order(text)'::regprocedure) d`))[0].d })
const meta = async (d) => q(d, `SELECT p.proname, pg_get_userbyid(p.proowner) o, p.prosecdef sd, p.proconfig cfg, p.pronargs na, pg_get_function_arguments(p.oid) args,
    (SELECT string_agg(CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END, ',' ORDER BY 1) FROM aclexplode(p.proacl) x LEFT JOIN pg_roles r ON r.oid = x.grantee WHERE x.privilege_type = 'EXECUTE') grants
  FROM pg_proc p WHERE p.proname IN ('create_eatery_order','verify_eatery_order') AND p.pronamespace = 'public'::regnamespace ORDER BY 1`)
const d1 = await defs(db), m1 = await meta(db)

// verify_schema tokens, sliced: 1134 block, 1132 block, 1125 block.
const VS = readFileSync(fileURLToPath(new URL('../supabase/verify_schema.sql', import.meta.url)), 'utf8')
const i34 = VS.indexOf('    -- ── 1134: per-dish options'), i32 = VS.indexOf('    -- ── 1132: server-marked TEST orders'),
  i25 = VS.indexOf('    -- ── 1125: WhatsApp order proof.'), i19 = VS.indexOf("    UNION ALL SELECT '1119_eatery_preview_read','eatery_partners: exactly 2")
if (i34 < 0 || i32 < i34 || i25 < i32 || i19 < i25) throw new Error('verify_schema 1134 / 1132 / 1125 token anchors missing')
const tokq = (s) => `SELECT migration, object, ok FROM (SELECT ''::text migration, ''::text object, false ok WHERE false\n${s}) z`
const T34 = tokq(VS.slice(i34, i32)), T32 = tokq(VS.slice(i32, i25)), T25 = tokq(VS.slice(i25, i19))
const tokens = async (d, label, sql, want) => {
  try {
    const rows = (await d.query(sql)).rows
    t(`verify_schema ${label}: ${rows.length} tokens, all ${want}`, [rows.length > 0, rows.every(r => r.ok === want)], [true, true])
    if (rows.some(r => r.ok !== want)) console.log(rows.filter(r => r.ok !== want).map(r => '      ' + r.object.slice(0, 110)).join('\n'))
  } catch (e) { t(`verify_schema ${label} does not error`, String(e.message).split('\n')[0], 'no error') }
}
await tokens(db, '1134 tokens BEFORE 1134 (must not error; red is fine)', T34, false)
await tokens(db, '1132 tokens BEFORE 1134', T32, true)
await tokens(db, '1125 tokens BEFORE 1134', T25, true)

// golden: the same plain baskets under 1132 (db) and later under 1134 (db2)
const SETUP = `INSERT INTO public.eatery_partners (id, slug, name, category, lat, lng, geocode_source, logo_path, menu_verified_on, is_active)
    VALUES ('33333333-3333-4333-8333-333333333333','gold','gold','cafe',35.1,33.3,'partner','g/l.png',current_date,true);
  INSERT INTO public.eatery_menu_items (partner_id, section, name, price) VALUES ('33333333-3333-4333-8333-333333333333','s','Crunchy Burger',620.00),('33333333-3333-4333-8333-333333333333','s','Fries',89.90)`
await db.exec(SETUP)
const GP = '33333333-3333-4333-8333-333333333333'
const goldItems = (await q(db, `SELECT id FROM public.eatery_menu_items ORDER BY id`)).map(r => r.id)
const baskets = [
  [{ item_id: goldItems[0], qty: 2 }],
  [{ item_id: goldItems[1], qty: 3 }, { item_id: goldItems[0], qty: 1 }],
  [{ item_id: goldItems[0], qty: 1, unit_price: 0.01 }, { item_id: goldItems[1], qty: 99 }]]
const run = async (d, i, items) => asRole(d, 'authenticated', `00000000-0000-4000-8000-00000000009${i}`, `SELECT public.create_eatery_order('${GP}', '${JSON.stringify(items)}'::jsonb) AS r`)
const gold1132 = []
for (const [i, items] of baskets.entries()) { const r = await run(db, i, items); gold1132.push(r.ok ? { lines: r.rows[0].r.lines, total: r.rows[0].r.total } : r.msg) }
const code0 = (await q(db, `SELECT code FROM public.eatery_orders ORDER BY created_at, id LIMIT 1`))[0].code
const verify1132 = (await asRole(db, 'anon', null, `SELECT public.verify_eatery_order('${code0}') AS v`)).rows[0].v

const first = await applyFile(db, F1134)
t('1134 applies cleanly on the 1132 state (in-file probes green)', first, { ok: true, msg: null })
if (!first.ok) process.exit(1)
t('1134 applies a SECOND time (re-runnable, ledger row present)', await applyFile(db, F1134), { ok: true, msg: null })
t('ledger rows', (await q(db, `SELECT filename FROM public.schema_migrations_applied ORDER BY 1`)).map(r => r.filename), ['20261125_eatery_orders.sql', '20261132_eatery_orders_is_test.sql', '20261134_eatery_item_options.sql'])
t('no probe row survived', (await q(db, `SELECT (SELECT count(*) FROM public.eatery_item_options)::int o, (SELECT count(*) FROM public.eatery_partners WHERE slug LIKE 'zz-%')::int p, (SELECT count(*) FROM private.preview_key_hashes)::int k`)), [{ o: 0, p: 0, k: 0 }])
console.log('  renderings (PG 18):')
for (const r of await q(db, `SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid='public.eatery_item_options'::regclass ORDER BY 1`)) console.log(`    ${r.conname}: ${r.d}`)
for (const r of await q(db, `SELECT policyname, roles, cmd, qual FROM pg_policies WHERE tablename='eatery_item_options' ORDER BY 1`)) console.log(`    policy ${r.policyname} ${r.roles} ${r.cmd} USING ${r.qual}`)

// (a) identical except
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
const between = (s, from, to) => { const x = s.indexOf(from), y = s.indexOf(to); if (x < 0 || y < x) throw new Error('anchor ' + from); return s.slice(x, y) }
const A1 = 'CREATE OR REPLACE FUNCTION', A2 = '  -- Shape of p_items', A3 = '  -- Rate limits.'
t('create: everything before the p_items section is identical except ONE added declaration (v_bad)',
  lineDiff(between(d1.create, A1, A2), between(d2.create, A1, A2)), { removed: [], added: ['  v_bad     int;'] })
t('create: everything from "Rate limits" to the end is byte-identical (is_test derivation aside it holds the cap, locks, code generator, INSERT list, return)',
  d1.create.slice(d1.create.indexOf(A3)) === d2.create.slice(d2.create.indexOf(A3)), true)
const sect1 = between(d1.create, A2, A3), sect2 = between(d2.create, A2, A3)
const sd = lineDiff(sect1, sect2)
t('create: the first p_items checks (array 1..30, per-item shape, 99 qty) survive unchanged inside the new section',
  [sect1.split('\n').slice(1, 14).every(l => sect2.includes(l))], [true])
console.log(`  create p_items section: ${sd.removed.length} lines removed, ${sd.added.length} added (the options logic)`)
const vd = lineDiff(d1.verify, d2.verify)
t('verify_eatery_order: only the line aggregation gained the detail key', vd, {
  removed: [`  SELECT jsonb_agg(jsonb_build_object('name', l -> 'name', 'qty', l -> 'qty', 'unit_price', l -> 'unit_price') ORDER BY t.ord)`],
  added: [`  SELECT jsonb_agg(jsonb_build_object('name', l -> 'name', 'qty', l -> 'qty', 'unit_price', l -> 'unit_price', 'detail', l -> 'detail') ORDER BY t.ord)`] })
t('create/verify: owner, DEFINER, search_path, argument list, ACL identical before and after', m2, m1)
t('create: still 3 argument names', (await q(db, `SELECT proargnames FROM pg_proc WHERE oid = 'public.create_eatery_order(uuid,jsonb,text)'::regprocedure`))[0].proargnames, ['p_partner', 'p_items', 'p_client_id'])
t("create: no 'p_items -> ' anywhere in the body (the 1125 token's trap)", d2.create.includes('p_items -> '), false)

// (b) golden
const gold1134 = []
for (const [i, items] of baskets.entries()) {
  const r = await asRole(db, 'authenticated', `00000000-0000-4000-8000-0000000000a${i}`, `SELECT public.create_eatery_order('${GP}', '${JSON.stringify(items)}'::jsonb) AS r`)
  gold1134.push(r.ok ? { lines: r.rows[0].r.lines, total: r.rows[0].r.total } : r.msg)
}
t('golden: three option-less baskets return the same lines and total under 1132 and 1134', gold1134, gold1132)
t('golden: every plain line is exactly {item_id,name,qty,unit_price}', gold1134.every(g => g.lines.every(l => Object.keys(l).sort().join() === 'item_id,name,qty,unit_price')), true)
t('golden: a client-sent unit_price (0.01) is ignored', gold1134[2].lines[0].unit_price, 620)
t('golden: total is round(sum(qty x price), 2)', gold1134.map(g => g.total), [1240, 89.9 * 3 + 620, 620 + 89.9 * 99].map(x => Math.round(x * 100) / 100))
const verify1134 = (await asRole(db, 'anon', null, `SELECT public.verify_eatery_order('${code0}') AS v`)).rows[0].v
t('golden: verify of an old plain order = the 1132 object, lines identical once detail is removed (view counters aside)', JSON.stringify({ ...verify1134, lines: verify1134.lines.map(({ detail, ...l }) => l) }),
  JSON.stringify({ ...verify1132, view_count_before: verify1134.view_count_before, first_viewed_at_before: verify1134.first_viewed_at_before }))
// an order stored BEFORE 1134 (old line shape) still verifies after it
t('an order stored under 1132 verifies after 1134 (old lines have no detail key -> null)', verify1134.lines.every(l => l.detail === null) && verify1134.status === 'ok', true)

// (c) probes from outside the file (the file runs the full set; these read through asRole, the harness helper)
const item = (await q(db, `INSERT INTO public.eatery_menu_items (partner_id, section, name, price) VALUES ('${GP}','s','Opt dish',100) RETURNING id`))[0].id
await db.exec(`INSERT INTO public.eatery_partners (id, slug, name, category, is_active) VALUES ('44444444-4444-4444-8444-444444444444','offline','offline','cafe',false)`)
const item2 = (await q(db, `INSERT INTO public.eatery_menu_items (partner_id, section, name, price) VALUES ('44444444-4444-4444-8444-444444444444','s','Off dish',100) RETURNING id`))[0].id
const LBL = `(SELECT jsonb_object_agg(k, 'x') FROM unnest(ARRAY['English','Turkish','Arabic','Russian','Greek','French','Spanish','German','Persian']) k)`
const opt = async (it, kind, msg, price = 'NULL', mq = 1) => (await q(db, `INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, price, max_qty) VALUES (${it},'${kind}',${LBL},'${msg}',${price},${mq}) RETURNING id`))[0].id
const o = { tur: await opt(item, 'remove', 'turşusuz'), mar: await opt(item, 'remove', 'marulsuz'), ch: await opt(item, 'extra', 'burger peyniri', '30', 3), kof: await opt(item, 'extra', 'köfte', '55.50', 4), off: await opt(item2, 'remove', 'offline-opt') }
const order = (u, items) => asRole(db, 'authenticated', `00000000-0000-4000-8000-0000000001${u}`, `SELECT public.create_eatery_order('${GP}', '${JSON.stringify(items)}'::jsonb) AS r`)
let r = await order(10, [{ item_id: item, qty: 1, opts: [{ id: o.mar, qty: 1 }, { id: o.tur, qty: 1 }, { id: o.ch, qty: 1 }] }])
t('detail "turşusuz, marulsuz, +ekstra burger peyniri" (removals first, then extras) and unit_price 130', [r.rows[0].r.lines[0].detail, r.rows[0].r.lines[0].unit_price, r.rows[0].r.total], ['turşusuz, marulsuz, +ekstra burger peyniri', 130, 130])
r = await order(11, [{ item_id: item, qty: 2, opts: [{ id: o.kof, qty: 2 }] }])
t('detail "+2 ekstra köfte"; unit 211, total 422', [r.rows[0].r.lines[0].detail, r.rows[0].r.lines[0].unit_price, r.rows[0].r.total], ['+2 ekstra köfte', 211, 422])
t('verify returns the same detail; a plain line gets null', (await asRole(db, 'anon', null, `SELECT public.verify_eatery_order('${r.rows[0].r.code}') v`)).rows[0].v.lines.map(l => l.detail), ['+2 ekstra köfte'])
r = await order(12, [{ item_id: item, qty: 1, opts: [{ id: o.off, qty: 1 }] }])
t('option of another dish -> option_unavailable', r.msg, 'option_unavailable')
r = await order(12, [{ item_id: item, qty: 1, opts: [{ id: o.ch, qty: 4 }] }])
t('extra qty 4 > max_qty 3 -> invalid_items', r.msg, 'invalid_items')
r = await order(12, [{ item_id: item, qty: 1, opts: [{ id: o.tur, qty: 1 }] }, { item_id: item, qty: 1, opts: [{ id: o.tur, qty: 1 }] }])
t('exact duplicate line -> invalid_items', r.msg, 'invalid_items')
await db.exec(`UPDATE public.eatery_item_options SET price = NULL WHERE id = ${o.ch}`)
r = await order(12, [{ item_id: item, qty: 1, opts: [{ id: o.ch, qty: 1 }] }])
t('extra whose price became NULL (hidden) -> option_unavailable', r.msg, 'option_unavailable')
await db.exec(`UPDATE public.eatery_item_options SET price = 30 WHERE id = ${o.ch}; UPDATE public.eatery_item_options SET is_available = false WHERE id = ${o.tur}`)
r = await order(12, [{ item_id: item, qty: 1, opts: [{ id: o.tur, qty: 1 }] }])
t('unavailable removal -> option_unavailable', r.msg, 'option_unavailable')
await db.exec(`UPDATE public.eatery_item_options SET is_available = true WHERE id = ${o.tur}`)
// RLS, with positive controls
const cnt = async (role, uid, extra = '') => { const x = await asRole(db, role, uid, `SELECT count(*)::int n FROM public.eatery_item_options WHERE item_id IN (${item}, ${item2})`); return x.ok ? x.rows[0].n : x.msg }
t('anon reads the 4 options of the live partner and 0 of the non-live one (id filter below)', [await cnt('anon', null)], [4])
t('authenticated user: same', [await cnt('authenticated', '00000000-0000-4000-8000-000000000501')], [4])
const g = await db.query(`SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000502","role":"authenticated","is_anonymous":true}', false)`)
await db.exec('SET ROLE authenticated')
t('guest session: same', (await q(db, `SELECT count(*)::int n FROM public.eatery_item_options WHERE item_id IN (${item}, ${item2})`))[0].n, 4)
t('guest session: 0 options of the non-live partner', (await q(db, `SELECT count(*)::int n FROM public.eatery_item_options WHERE item_id = ${item2}`))[0].n, 0)
await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claims', '', false)`)
await db.exec(`INSERT INTO private.preview_key_hashes (hash, label) VALUES (encode(sha256(convert_to('k-opt-test', 'UTF8')), 'hex'), 'test')`)
await db.exec(`SELECT set_config('request.headers', '{"x-ada-preview-key":"k-opt-test"}', false); SET ROLE anon`)
t('CONTROL anon + Preview key sees the non-live partner option', (await q(db, `SELECT count(*)::int n FROM public.eatery_item_options WHERE item_id = ${item2}`))[0].n, 1)
await db.exec(`RESET ROLE; SELECT set_config('request.headers', '', false)`)
t('authenticated INSERT -> permission denied', (await asRole(db, 'authenticated', '00000000-0000-4000-8000-000000000501', `INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES (${item}, 'remove', ${LBL}, 'zzz')`)).msg, 'permission denied for table eatery_item_options')
t('CONTROL service_role INSERT works', (await asRole(db, 'service_role', null, `INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) VALUES (${item}, 'remove', ${LBL}, 'zzz') RETURNING id`)).ok, true)

// (e) tokens after
await tokens(db, '1134 tokens AFTER 1134', T34, true)
await tokens(db, '1132 tokens AFTER 1134', T32, true)
await tokens(db, '1125 tokens AFTER 1134', T25, true)

// ── pre-state ──
{
  const d = await freshDb(FIXTURE)
  const r1 = await applyFile(d, F1134)
  t('pre-state: refuses without 20261132 in the ledger', [r1.ok, (r1.msg || '').includes('20261132_eatery_orders_is_test.sql is not in the ledger')], [false, true])
  table.push(['1132 not applied', r1.ok ? 'GREEN (BAD)' : 'RED (as expected)', (r1.msg || '').slice(0, 110)])
  const d3 = await after1132()
  await d3.exec(`CREATE OR REPLACE FUNCTION public.verify_eatery_order(p_code text) RETURNS jsonb LANGUAGE sql AS $f$ SELECT '{}'::jsonb $f$`)
  const r2 = await applyFile(d3, F1134)
  t('pre-state: refuses when verify_eatery_order is not the 1132 body', [r2.ok, (r2.msg || '').includes('verify_eatery_order is not the 20261132 body')], [false, true])
  table.push(['verify not the 1132 body', r2.ok ? 'GREEN (BAD)' : 'RED (as expected)', (r2.msg || '').slice(0, 110)])
}

console.log('\nMUTANTS (each must be refused by the guarding probe/assertion)')
const OWN1 = ` AND io.item_id = m.id`, OWN2 = ` AND io.item_id = r.item_id`
const NEUT_OWN = [`OR v_def NOT LIKE '%io.item_id = m.id%' OR v_def NOT LIKE '%io.item_id = r.item_id%'`, '']
const CPRICE = `'unit_price', m.price + ox.extra,`
const CPRICE_M = `'unit_price', COALESCE((p_items -> 0 ->> 'unit_price')::numeric, m.price + ox.extra),`
const PLAIN = `'name', m.name, 'qty', x.qty, 'unit_price', m.price)`
const PLAIN_M = `'name', m.name, 'qty', x.qty, 'unit_price', COALESCE((p_items -> 0 ->> 'unit_price')::numeric, m.price))`
const NEUT_PI = [`     OR v_def LIKE '%p_items -> %' THEN`, ` THEN`]
const HID = ` AND (io.kind = 'remove' OR io.price IS NOT NULL)`
const NEUT_HID = [`OR v_def NOT LIKE '%io.kind = ''remove'' OR io.price IS NOT NULL%'`, '']
// structural-red: only the function body changes, the in-file assertion that reads the body fires
await refused('item-ownership dropped (body only)', mutant('own_s', [[OWN1, '', true], [OWN2, '', true]]), 'create_eatery_order body is not as designed')
await refused('client price read in an option line (body only)', mutant('cp_s', [[CPRICE, CPRICE_M]]), 'create_eatery_order body is not as designed')
await refused('hidden-extra price check dropped (body only)', mutant('hid_s', [[HID, '', true]]), 'create_eatery_order body is not as designed')
// behaviour-red: the same edit PLUS the assertion neutralised, so only the in-file BEHAVIOUR probes can notice
await refused('item-ownership dropped (body + assertion): another dish\'s option is accepted', mutant('own_b', [[OWN1, '', true], [OWN2, '', true], NEUT_OWN]), 'STEP "option of ANOTHER dish"')
await refused('client price read in an option line (body + assertion)', mutant('cp_b', [[CPRICE, CPRICE_M], NEUT_PI]), 'client-sent prices were read')
await refused('client price read in a plain line (body + assertion)', mutant('cpp_b', [[PLAIN, PLAIN_M], NEUT_PI]), 'client prices were read in a plain line')
await refused('hidden-extra price check dropped (body + assertion): a hidden extra is accepted', mutant('hid_b', [[HID, '', true], NEUT_HID]), 'STEP "HIDDEN extra (price NULL)"')
await refused('is_available check dropped (body + assertion)', mutant('av_b', [[` AND io.is_available`, '', true], [`OR v_def NOT LIKE '%io.is_available%'`, '']]), 'STEP "unavailable removal"')
await refused('max_qty check dropped (body + assertion)', mutant('mq_b', [[`WHERE r.qty > io.max_qty OR (io.kind = 'remove' AND r.qty <> 1)`, `WHERE (io.kind = 'remove' AND r.qty <> 1)`], [`OR v_def NOT LIKE '%r.qty > io.max_qty%'`, '']]), 'STEP "extra qty 4 above max_qty 3"')
await refused('duplicate check ignores the option sets (same dish twice is refused)', mutant('dup_s', [[`string_agg((o ->> 'id')::bigint::text || 'x' || (o ->> 'qty')::int::text, ','`, `string_agg('', ','`]]), 'STEP "same dish, two different option sets"')
await refused('duplicate check removed (an exact duplicate line is accepted)', mutant('dup_n', [[`FROM jsonb_array_elements(p_items) e) IS DISTINCT FROM jsonb_array_length(p_items) THEN`, `FROM jsonb_array_elements(p_items) e) IS DISTINCT FROM jsonb_array_length(p_items) AND false THEN`]]), 'STEP "exact duplicate line')
await refused('detail loses the +ekstra prefix', mutant('det_b', [[`WHEN r.qty = 1 THEN '+ekstra ' || io.message_tr`, `WHEN r.qty = 1 THEN io.message_tr`]]), 'removal + extra line wrong')
await refused('extras priced at 0 (sum drops price)', mutant('sum_b', [[`sum(CASE WHEN io.kind = 'extra' THEN io.price * r.qty END)`, `sum(CASE WHEN io.kind = 'extra' THEN 0 * r.qty END)`]]), 'removal + extra line wrong')
// schema mutants
const LABEL9 = `j ?& ARRAY['English','Turkish','Arabic','Russian','Greek','French','Spanish','German','Persian']`
await refused('label helper accepts 8 keys (?& list shortened, body + assertion)', mutant('lab8', [[LABEL9, `j ?& ARRAY['English','Turkish','Arabic','Russian','Greek','French','Spanish','German']`]]), 'MUTANT STEP "8 keys (Persian missing)"')
await refused('remove_shape CHECK dropped', mutant('shape', [[`CHECK (kind <> 'remove' OR (price IS NULL AND max_qty = 1))`, `CHECK (true)`]]), 'does not say what it must')
await refused('price CHECK allows 0', mutant('p0', [[`CHECK (price IS NULL OR price > 0)`, `CHECK (price IS NULL OR price >= 0)`]]), 'does not say what it must')
await refused('remove_shape CHECK weakened to price-only-OR (text still passes): in-file CHECK probe', mutant('shape_b', [[`CHECK (kind <> 'remove' OR (price IS NULL AND max_qty = 1))`, `CHECK (kind <> 'remove' OR (price IS NULL OR max_qty = 1))`]]), 'MUTANT STEP "remove with a price"')
await refused('price CHECK weakened so 0 passes (text still passes): in-file CHECK probe', mutant('p0_b', [[`CHECK (price IS NULL OR price > 0)`, `CHECK (price IS NULL OR price > 0 OR price = 0)`]]), 'MUTANT STEP "extra with price 0"')
await refused('policy opened to everyone (select_active USING true)', mutant('pol', [[`USING (EXISTS (SELECT 1 FROM public.eatery_menu_items m JOIN public.eatery_partners p ON p.id = m.partner_id
                  WHERE m.id = eatery_item_options.item_id AND p.is_active));`, `USING (true);`]]), 'an eatery_item_options policy expression is not as designed')
await refused('an extra INSERT policy for authenticated', mutant('ins', [[`COMMENT ON TABLE public.eatery_item_options IS`, `CREATE POLICY zz_ins ON public.eatery_item_options FOR INSERT TO authenticated WITH CHECK (true);\nCOMMENT ON TABLE public.eatery_item_options IS`]]), 'has 3 policies')
await refused('authenticated granted INSERT', mutant('gr', [[`GRANT SELECT ON TABLE public.eatery_item_options TO anon, authenticated;`, `GRANT SELECT, INSERT ON TABLE public.eatery_item_options TO anon, authenticated;`]]), 'holds INSERT')
await refused('RLS not enabled', mutant('rls', [[`ALTER TABLE public.eatery_item_options ENABLE ROW LEVEL SECURITY;`, '']]), 'RLS is not enabled')
await refused('FK without ON DELETE CASCADE', mutant('fk', [[`REFERENCES public.eatery_menu_items (id) ON DELETE CASCADE;`, `REFERENCES public.eatery_menu_items (id);`]]), 'exactly one FK')

console.log('\nRED / GREEN TABLE')
const w = Math.max(...table.map(r => r[0].length))
for (const [n, s, m] of table) console.log(`  ${n.padEnd(w)}  ${s.padEnd(20)} ${m}`)
console.log(bad ? `\n${bad} FAILED` : '\nALL GREEN')
process.exit(bad ? 1 : 0)

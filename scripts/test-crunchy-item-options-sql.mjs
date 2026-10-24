// 20261135_crunchy_express_item_options.sql (data) against the PGlite harness (PostgreSQL 18; prod is older).
// Fixture: the SAME fixture text as scripts/test-eatery-orders-sql.mjs (sliced, not retyped) + the 20261120 preview-key policies,
// then the REAL 20261116, 20261117, 20261122 (Crunchy's 46-dish menu), 20261125, 20261132 and 20261134 files, then Crunchy made live
// (what 20261127 does; its own gates are tested in test-crunchy-launch-sql.mjs). Proves:
//   apply green + derived counts; a re-apply writes nothing (rows, ids and the identity sequence unchanged);
//   anon reads every row and the app shows exactly the removals (0 extras with a price); an inactive partner is invisible
//   (positive control); the verify_schema token is red before / green after and never errors;
//   RED-FIRST: a renamed dish, a missing dictionary message, a duplicated dish, a partial state, a foreign row and an
//   inactive partner each make the apply FAIL with the readable message (anchor asserted present first).
// Not wired into package.json / pre-push / CI, like its siblings: run by hand.
//
//   node scripts/test-crunchy-item-options-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile, asRole } from './migration-harness.mjs'

const M = (n) => fileURLToPath(new URL(`../supabase/migrations/${n}`, import.meta.url))
const F1135 = M('20261135_crunchy_express_item_options.sql')
const SQL = readFileSync(F1135, 'utf8')
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
const FIXTURE = BASE + '\n' + PRIOR.slice(s0, s1)
const POLICIES = KEY.slice(pa, pb)
const CID0 = 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434'
const PHOTOS = `UPDATE public.eatery_menu_items SET photo_path = 'crunchy/dish-' || id || '.jpg' WHERE id IN (SELECT id FROM public.eatery_menu_items WHERE partner_id = '${CID0}' ORDER BY id LIMIT 16)`
const CID = 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434'
const PRE1 = ['20261116_eatery_dish_photos.sql', '20261117_crunchy_express_data.sql'].map(M)
const PRE = [ '20261122_crunchy_express_menu_1020.sql', '20261125_eatery_orders.sql',
  '20261132_eatery_orders_is_test.sql', '20261134_eatery_item_options.sql'].map(M)

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const q = async (d, sql) => (await d.query(sql)).rows
const dir = mkdtempSync(join(tmpdir(), 'cio-'))

// The fixture state: everything before 1135, Crunchy live. `active:false` leaves it inactive (positive control).
const prepared = async ({ active = true } = {}) => {
  const d = await freshDb(FIXTURE)
  for (const f of PRE1) { const r = await applyFile(d, f); if (!r.ok) throw new Error(f + ' did not apply: ' + r.msg) }
  // 20261122 asserts the 16 dish photos the images workflow had set on prod; the fixture sets 16 (the photos themselves are irrelevant here).
  await d.exec(PHOTOS)
  await d.exec(POLICIES)
  for (const f of PRE) { const r = await applyFile(d, f); if (!r.ok) throw new Error(f + ' did not apply: ' + r.msg) }
  if (active) {
    await d.exec(`UPDATE public.eatery_partners SET logo_path = 'crunchy/logo.png', menu_verified_on = current_date, is_active = true WHERE id = '${CID}'`)
  }
  return d
}
const state = async (d) => (await q(d, `SELECT
  (SELECT count(*)::int FROM public.eatery_menu_items WHERE partner_id = '${CID}') items,
  (SELECT count(*)::int FROM public.eatery_item_options) opts,
  (SELECT md5(coalesce(string_agg(to_jsonb(o)::text, ',' ORDER BY o.id), '')) FROM public.eatery_item_options o) opts_md5,
  (SELECT md5(coalesce(string_agg(to_jsonb(i)::text, ',' ORDER BY i.id), '')) FROM public.eatery_menu_items i) menu_md5,
  (SELECT last_value::int FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'eatery_item_options_id_seq') seq,
  (SELECT is_active FROM public.eatery_partners WHERE id = '${CID}') active`))[0]

// mutant of the real file: [from, to] pairs, every anchor asserted present exactly once.
const mutant = (name, pairs) => {
  let text = SQL
  for (const [from, to] of pairs) {
    const n = text.split(from).length - 1
    if (n !== 1) { bad++; console.log(`  ✗ ${name}: anchor ${JSON.stringify(from.slice(0, 70))} found ${n}x`); return null }
    text = text.replace(from, () => to)
  }
  const p = join(dir, name.replace(/\W+/g, '_') + '.sql'); writeFileSync(p, text); return p
}
const refused = async (name, file, wantMsg, prep = async () => {}) => {
  if (!file) return
  const d = await prepared(); await prep(d)
  const before = await state(d)
  const r = await applyFile(d, file)
  t(`${name}: apply FAILS with "${wantMsg}"`, [r.ok, (r.msg || '').includes(wantMsg)], [false, true])
  console.log(`      ${r.ok ? '(applied!)' : r.msg}`)
  await d.exec('ROLLBACK').catch(() => {}); await d.exec('RESET ROLE').catch(() => {})
  const after = await state(d)
  t(`${name}: nothing written (option rows ${before.opts} -> ${after.opts}), no ledger row`,
    [after.opts, after.opts_md5, (await q(d, `SELECT count(*)::int n FROM public.schema_migrations_applied WHERE filename = '20261135_crunchy_express_item_options.sql'`))[0].n],
    [before.opts, before.opts_md5, 0])
}

console.log('20261135_crunchy_express_item_options — real 20261116/1117/1122/1125/1132/1134 files on the 1115 fixture, Crunchy live')

// ── green ──
const db = await prepared()
const pre = await state(db)
t('fixture: Crunchy live with its 46 dishes and no option rows', [pre.active, pre.items, pre.opts], [true, 46, 0])
t('verify_schema 1135 token BEFORE apply: no error, red', await (async () => {
  const VS = readFileSync(fileURLToPath(new URL('../supabase/verify_schema.sql', import.meta.url)), 'utf8')
  const i0 = VS.indexOf("    UNION ALL SELECT '20261135_crunchy_express_item_options'"), i1 = VS.indexOf('    -- ── 1134: per-dish options')
  if (i0 < 0 || i1 < i0) return 'token anchors missing'
  globalThis.TOK = `SELECT migration, object, ok FROM (SELECT ''::text migration, ''::text object, false ok WHERE false\n${VS.slice(i0, i1)}) z`
  try { return (await q(db, globalThis.TOK)).map(r => r.ok) } catch (e) { return String(e.message).split('\n')[0] }
})(), [false])

{
  // The state prod is in until 20261134 lands: no eatery_item_options table. The token must parse and read red, not error.
  const d = await freshDb(FIXTURE)
  for (const f of PRE1) await applyFile(d, f)
  await d.exec(PHOTOS)
  await d.exec(POLICIES)
  for (const f of [M('20261122_crunchy_express_menu_1020.sql'), M('20261125_eatery_orders.sql'), M('20261132_eatery_orders_is_test.sql')]) { const r = await applyFile(d, f); if (!r.ok) throw new Error(f + ': ' + r.msg) }
  t('fixture for the token check has NO eatery_item_options table', (await q(d, `SELECT to_regclass('public.eatery_item_options') IS NULL n`))[0].n, true)
  t('verify_schema 1135 token with the table MISSING (prod before 1134): no error, red',
    await (async () => { try { return (await q(d, globalThis.TOK)).map(r => r.ok) } catch (e) { return String(e.message).split('\n')[0] } })(), [false])
}
const first = await applyFile(db, F1135)
t('1135 applies cleanly on the live Crunchy menu (in-file asserts green)', first, { ok: true, msg: null })
if (!first.ok) process.exit(1)
const s1st = await state(db)
const byKind = await q(db, `SELECT kind, count(*)::int n, count(DISTINCT item_id)::int dishes FROM public.eatery_item_options GROUP BY kind ORDER BY kind DESC`)
console.log('  derived from the table:', JSON.stringify(byKind))
t('removals: 73 rows on 19 dishes; extras: 34 rows on 20 dishes (printed above)', byKind, [{ kind: 'remove', n: 73, dishes: 19 }, { kind: 'extra', n: 34, dishes: 20 }])
t('every row of the file is in the table (107), menu untouched', [s1st.opts, s1st.items, s1st.menu_md5 === pre.menu_md5], [107, 46, true])
t('removals: all price NULL, qty 1, available; extras: all price NULL (hidden), qty 1',
  (await q(db, `SELECT count(*)::int n FROM public.eatery_item_options WHERE price IS NOT NULL OR max_qty <> 1 OR NOT is_available`))[0].n, 0)
t('no option row on any other partner', (await q(db, `SELECT count(*)::int n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.partner_id <> '${CID}'`))[0].n, 0)
t('dishes with removals = the 19 of the brief (no box, no Kids Box, no drink/side/sauce)',
  (await q(db, `SELECT i.name FROM public.eatery_menu_items i WHERE EXISTS (SELECT 1 FROM public.eatery_item_options o WHERE o.item_id = i.id AND o.kind = 'remove') AND (i.name LIKE '%Box%' OR i.section IN ('Yan Ürünler','Soslar','Tatlılar','İçecekler'))`)).length, 0)
t('extras: tenders on 13 dishes (10 burgers + 3 boxes, not Kids), burger peyniri 9, köfte 5, cheddar 2, dana bacon 2, domuz bacon 1, jalapeño 2',
  (await q(db, `SELECT message_tr, count(*)::int n FROM public.eatery_item_options WHERE kind = 'extra' GROUP BY 1 ORDER BY 1`)),
  [{ message_tr: 'burger peyniri', n: 9 }, { message_tr: 'cheddar', n: 2 }, { message_tr: 'dana bacon', n: 2 }, { message_tr: 'domuz bacon', n: 1 },
   { message_tr: 'jalapeño', n: 2 }, { message_tr: 'köfte', n: 5 }, { message_tr: 'tavuk tenders', n: 13 }])
t('Kids Box has no option at all', (await q(db, `SELECT count(*)::int n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.name = 'Crunchy Kids Box'`))[0].n, 0)
t('pork bacon label says pork in all nine languages',
  (await q(db, `SELECT label_i18n ->> 'English' en, label_i18n ->> 'Turkish' tr, label_i18n ->> 'Arabic' ar, label_i18n ->> 'Russian' ru, label_i18n ->> 'Greek' el, label_i18n ->> 'French' fr, label_i18n ->> 'Spanish' es, label_i18n ->> 'German' de, label_i18n ->> 'Persian' fa FROM public.eatery_item_options WHERE message_tr = 'domuz bacon' LIMIT 1`))
    .map(r => [/pork/i.test(r.en), /domuz/i.test(r.tr), /خنزير/.test(r.ar), /свин/i.test(r.ru), /χοιριν/i.test(r.el), /porc/i.test(r.fr), /cerdo/i.test(r.es), /schwein/i.test(r.de), /خوک/.test(r.fa)].every(Boolean)), [true])
console.log('  sample rows (dish | kind | sort | message_tr | English | Turkish):')
for (const r of await q(db, `SELECT i.name, o.kind, o.sort_order, o.message_tr, o.label_i18n ->> 'English' en, o.label_i18n ->> 'Turkish' tr
    FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id
    WHERE i.name IN ('Crunchy Burger','Big Pork Smash Burger','Crunchy Box') ORDER BY i.name, o.kind DESC, o.sort_order`)) console.log(`    ${r.name} | ${r.kind} | ${r.sort_order} | ${r.message_tr} | ${r.en} | ${r.tr}`)

// ── re-apply writes nothing ──
t('1135 applies a SECOND time (re-runnable)', await applyFile(db, F1135), { ok: true, msg: null })
const s2nd = await state(db)
t('re-apply wrote nothing: rows, ids, identity sequence, menu all identical', [s2nd.opts, s2nd.opts_md5, s2nd.seq, s2nd.menu_md5], [s1st.opts, s1st.opts_md5, s1st.seq, s1st.menu_md5])
// a later price migration must not turn the file red
await db.exec(`UPDATE public.eatery_item_options SET price = 25, max_qty = 3 WHERE kind = 'extra' AND message_tr = 'burger peyniri'`)
t('re-apply after a later price migration still passes', await applyFile(db, F1135), { ok: true, msg: null })

// ── anon ──
{
  const d = await prepared(); await applyFile(d, F1135)
  const anon = await asRole(d, 'anon', null, `SELECT count(*)::int total, count(*) FILTER (WHERE kind = 'remove')::int removals,
      count(*) FILTER (WHERE kind = 'extra' AND price IS NOT NULL)::int priced_extras,
      count(*) FILTER (WHERE kind = 'remove' OR price IS NOT NULL)::int shown FROM public.eatery_item_options`)
  t('anon reads all 107 rows; shown in the app = 73 removals; 0 extras with a price', anon.rows, [{ total: 107, removals: 73, priced_extras: 0, shown: 73 }])
  const auth = await asRole(d, 'authenticated', '00000000-0000-4000-8000-000000000001', `SELECT count(*)::int n FROM public.eatery_item_options`)
  t('a signed-in user reads the same 107', auth.rows, [{ n: 107 }])
  const w = await asRole(d, 'anon', null, `UPDATE public.eatery_item_options SET price = 1`)
  t('anon cannot write (positive control: the SELECT above worked)', w.ok, false)
  await d.exec(`UPDATE public.eatery_partners SET is_active = false WHERE id = '${CID}'`)
  t('positive control: with the partner NOT live anon reads 0 (so the 107 above came from the policy, not a bypass)',
    (await asRole(d, 'anon', null, `SELECT count(*)::int n FROM public.eatery_item_options`)).rows, [{ n: 0 }])
}

// ── verify_schema token after ──
t('verify_schema 1135 token AFTER apply: green', (await q(db, globalThis.TOK)).map(r => r.ok), [true])

// ── red-first mutants ──
console.log('red-first mutants (each makes the apply FAIL, readable message):')
await refused('renamed dish (Crunchy Burger -> Crunchy Burgerr in the literal)',
  mutant('rename', [['["Crunchy Burger", [', '["Crunchy Burgerr", [']]), 'dish names not matching exactly one menu item: Crunchy Burgerr (0 matches)')
await refused('dictionary key without a removed form (burger_peyniri used as a removal)',
  mutant('nokey', [['["Veggy Smash Burger", ["peynir","tursu","burger_sos"]', '["Veggy Smash Burger", ["burger_peyniri","tursu","burger_sos"]']]), 'option without a dictionary entry or message')
await refused('a dish listed twice',
  mutant('dup', [['["Buffalo Nachos", ["parmesan","cheddar"], []],', '["Buffalo Nachos", ["parmesan","cheddar"], []],\n    ["Buffalo Nachos", ["parmesan"], []],']]), 'a dish is listed twice')
await refused('the same removal twice on one dish',
  mutant('dupmsg', [['["Buffalo Nachos", ["parmesan","cheddar"], []]', '["Buffalo Nachos", ["parmesan","cheddar","cheddar"], []]']]), 'duplicate (dish, kind, message)')
await refused('partial state (one Crunchy option row already there)', F1135, 'partial state',
  async (d) => { await d.exec(`INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr) SELECT id, 'remove', jsonb_build_object('English','x','Turkish','x','Arabic','x','Russian','x','Greek','x','French','x','Spanish','x','German','x','Persian','x'), 'x' FROM public.eatery_menu_items WHERE name = 'Crunchy Burger' AND partner_id = '${CID}'`) })
await refused('partner not live', F1135, 'missing or not active',
  async (d) => { await d.exec(`UPDATE public.eatery_partners SET is_active = false WHERE id = '${CID}'`) })
await refused('a Crunchy dish removed from the menu', F1135, 'not matching exactly one menu item',
  async (d) => { await d.exec(`DELETE FROM public.eatery_menu_items WHERE partner_id = '${CID}' AND name = 'Hot Honey Nachos'`) })
{
  const d = await prepared(); await applyFile(d, F1135)
  await d.exec(`UPDATE public.eatery_item_options SET label_i18n = jsonb_set(label_i18n, '{English}', '"changed"') WHERE message_tr = 'turşusuz' AND item_id = (SELECT id FROM public.eatery_menu_items WHERE name = 'Crunchy Burger')`)
  const r = await applyFile(d, F1135); await d.exec('ROLLBACK').catch(() => {}); await d.exec('RESET ROLE').catch(() => {})
  t('re-run on a table whose row differs from the file aborts ("not this file\'s rows")', [r.ok, (r.msg || '').includes('not this file')], [false, true])
  console.log(`      ${r.msg}`)
}
{
  const d = await prepared(); await d.exec(`DELETE FROM public.schema_migrations_applied WHERE filename = '20261134_eatery_item_options.sql'`)
  const r = await applyFile(d, F1135); await d.exec('ROLLBACK').catch(() => {}); await d.exec('RESET ROLE').catch(() => {})
  t('20261134 not in the ledger aborts', [r.ok, (r.msg || '').includes('is not in the ledger')], [false, true])
}

console.log(bad ? `\n${bad} FAILED` : '\nall green')
process.exit(bad ? 1 : 0)

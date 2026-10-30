// 20261150_bidda_badadez_free_options.sql against the PGlite harness (PostgreSQL 18; prod is older — see supabase/CLAUDE.md).
// Fixture: test-bidda-badadez-data-sql.mjs's (sliced, not retyped), then the REAL 1125 / 1132 / 1134 / 1144 / 1145 / 1149 files.
// Checks:
//   (a) order: refused without 1149 in the ledger;
//   (b) the data: price CHECK allows 0 and refuses -1 (a priced 1.50 still inserts; a removal with a price is still
//       refused), the 3 old extras updated in place to 0, 7 rows inserted = 10 options, the two trimmed descriptions,
//       still inactive, anon / authenticated see nothing (positive control: 7 / 10 once live), Crunchy's priced extra and
//       removal byte-identical, a re-apply is a no-op also after the image upload, mixed / drifted states refused,
//       1149 is no longer re-runnable;
//   (c) RED-FIRST mutants of the file (every anchor asserted present, the apply must FAIL with the expected message);
//   (d) verify_schema.sql: the 1150 token (vacuous before, true after, red on a mutated state) and the edited 1134 token.
// Not wired into package.json / pre-push / CI, like its siblings: run by hand.
//
//   node scripts/test-bidda-badadez-free-options-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile } from './migration-harness.mjs'

const M = (n) => fileURLToPath(new URL(`../supabase/migrations/${n}`, import.meta.url))
const PRIOR = ['20261125_eatery_orders.sql', '20261132_eatery_orders_is_test.sql', '20261134_eatery_item_options.sql',
  '20261144_eatery_order_method.sql'].map(M)
const F1145 = M('20261145_bidda_badadez_data.sql'), F1149 = M('20261149_bidda_badadez_owner_data.sql'), F1150 = M('20261150_bidda_badadez_free_options.sql')
const SQL = readFileSync(F1150, 'utf8')

const BT = readFileSync(fileURLToPath(new URL('./test-bidda-badadez-data-sql.mjs', import.meta.url)), 'utf8')
const fa = BT.indexOf('const OM = readFileSync('), fb = BT.indexOf('\nlet bad', fa)
if (fa < 0 || fb < fa) throw new Error('fixture anchors missing in test-bidda-badadez-data-sql.mjs')
const FIXTURE = new Function('readFileSync', 'M', 'fileURLToPath', 'URL',
  BT.slice(fa, fb).replace(/import\.meta\.url/g, JSON.stringify(new URL('./test-bidda-badadez-data-sql.mjs', import.meta.url).href)) + '\nreturn FIXTURE')(readFileSync, M, fileURLToPath, URL)

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const q = async (d, sql) => (await d.query(sql)).rows
// A Crunchy dish with a removal AND a priced extra, so "nothing else moved" has both option kinds to watch.
const CRUNCHY_SEED = `
  INSERT INTO public.eatery_menu_items (partner_id, section, section_order, name, price, sort_order)
  SELECT id, 'Burgers', 1, 'zz burger', 100, 1 FROM public.eatery_partners WHERE slug = 'crunchy-express';
  INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, sort_order)
  SELECT i.id, 'remove', '{"English":"Pickles","Turkish":"Turşu","Arabic":"المخلل","Russian":"Огурцы","Greek":"Τουρσί","French":"Cornichons","Spanish":"Pepinillos","German":"Gurken","Persian":"خیارشور"}', 'turşusuz', 1
    FROM public.eatery_menu_items i WHERE i.name = 'zz burger';
  INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, price, sort_order)
  SELECT i.id, 'extra', '{"English":"Cheese","Turkish":"Peynir","Arabic":"جبنة","Russian":"Сыр","Greek":"Τυρί","French":"Fromage","Spanish":"Queso","German":"Käse","Persian":"پنیر"}', 'peynir', 25, 2
    FROM public.eatery_menu_items i WHERE i.name = 'zz burger';`
const after1149 = async ({ with1149 = true } = {}) => {
  const d = await freshDb(FIXTURE)
  for (const f of [...PRIOR, F1145, ...(with1149 ? [F1149] : [])]) { const r = await applyFile(d, f); if (!r.ok) throw new Error(f + ' did not apply: ' + r.msg) }
  await d.exec(CRUNCHY_SEED)
  return d
}
const dir = mkdtempSync(join(tmpdir(), 'bidda-1150-'))
const mutant = (name, pairs) => {
  let text = SQL
  for (const [from, to] of pairs) {
    const n = text.split(from).length - 1
    if (n !== 1) { bad++; console.log(`  ✗ ${name}: anchor ${JSON.stringify(from.slice(0, 70))} found ${n}x`); return null }
    text = text.replace(from, () => to)
  }
  const p = join(dir, name.replace(/\W+/g, '_') + '.sql'); writeFileSync(p, text); return p
}
const table = []
const refused = async (name, p, wantMsg, seed = '') => {
  if (!p) { table.push([name, 'ANCHOR MISSING', '']); return }
  const d = await after1149()
  if (seed) await d.exec(seed)
  const r = await applyFile(d, p)
  const hit = !r.ok && (r.msg || '').includes(wantMsg)
  t(`${name}: apply FAILS with "${wantMsg}"`, [r.ok, hit], [false, true])
  table.push([name, r.ok ? 'GREEN (BAD)' : hit ? 'RED (as expected)' : 'RED, wrong message', r.ok ? '' : r.msg.slice(0, 110)])
}

const VS = readFileSync(fileURLToPath(new URL('../supabase/verify_schema.sql', import.meta.url)), 'utf8')
const slice = (from, to, n = 1) => {
  const a = VS.indexOf(from), b = VS.indexOf(to, a)
  if (a < 0 || b < a) throw new Error(`verify_schema anchors missing: ${from}`)
  const s = VS.slice(a, b)
  if ((s.match(/UNION ALL SELECT/g) || []).length !== n) throw new Error(`verify_schema slice at ${from} must hold exactly ${n} token(s)`)
  return `SELECT migration, object, ok FROM (SELECT ''::text migration, ''::text object, false ok WHERE false\n${s}) z`
}
const T50 = slice('    -- 1150: free options.', '    -- 1149: the owner')
const T49 = slice('    -- 1149: the owner', '    -- 1145: to_jsonb, so it never names order_method')
const T34 = (() => {
  const a = VS.indexOf("UNION ALL SELECT '20261134_eatery_item_options','eatery_item_options constraints"), b = VS.indexOf("UNION ALL SELECT '20261134_eatery_item_options','eatery_option_label_valid")
  if (a < 0 || b < a) throw new Error('verify_schema 1134 constraints token anchors missing')
  return `SELECT migration, object, ok FROM (SELECT ''::text migration, ''::text object, false ok WHERE false\n    ${VS.slice(a, b)}) z`
})()
const token = async (d, T) => { try { const r = (await d.query(T)).rows; return r.length === 1 ? r[0].ok : `rows=${r.length}` } catch (e) { return 'ERROR ' + e.message.split('\n')[0] } }

const DESC = { 'Bidda Badadez Sade': 'Bidda ekmeği, badadez', 'Bidda Badadez Hellim': 'Bidda ekmeği, hellim, badadez, domates' }
const MENU_SQL = `SELECT i.name, i.price::text price, i.description FROM public.eatery_menu_items i JOIN public.eatery_partners p ON p.id = i.partner_id
  WHERE p.slug = 'bidda-badadez' ORDER BY i.section_order, i.sort_order`
const OPTS_SQL = `SELECT i.name dish, o.kind, o.message_tr, o.label_i18n->>'Turkish' tr, o.price::text price, o.max_qty, o.sort_order, o.is_available
  FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id JOIN public.eatery_partners p ON p.id = i.partner_id
  WHERE p.slug = 'bidda-badadez' ORDER BY i.sort_order, o.sort_order`
const WANT_OPTS = [
  ['Bidda Badadez Sade', 'extra', 'domates', 'Domates', '0.00', 1], ['Bidda Badadez Sade', 'extra', 'maydanoz', 'Maydanoz', '0.00', 2],
  ['Bidda Badadez Hellim', 'remove', 'domatessiz', 'Domates', null, 1], ['Bidda Badadez Hellim', 'extra', 'maydanoz', 'Maydanoz', '0.00', 2],
  ['Bidda Badadez Şiş Köfte', 'remove', 'domatessiz', 'Domates', null, 1], ['Bidda Badadez Şiş Köfte', 'remove', 'maydanozsuz', 'Maydanoz', null, 2],
  ['Bidda Badadez Tavuk Köfte', 'extra', 'domates', 'Domates', '0.00', 1], ['Bidda Badadez Tavuk Köfte', 'remove', 'maydanozsuz', 'Maydanoz', null, 2],
  ['Bidda Badadez Special', 'remove', 'domatessiz', 'Domates', null, 1], ['Bidda Badadez Special', 'remove', 'maydanozsuz', 'Maydanoz', null, 2],
].map(([dish, kind, message_tr, tr, price, sort_order]) => ({ dish, kind, message_tr, tr, price, max_qty: 1, sort_order, is_available: true }))
// the 1149 end state, restored by hand after a mutation test
const ROW = (cond) => `SELECT count(*)::int n FROM public.eatery_item_options o WHERE ${cond}`

console.log('20261150_bidda_badadez_free_options — real files on the 1145 fixture, 1125 / 1132 / 1134 / 1144 / 1145 / 1149 applied first')

// ── (a) order ──
{
  const d = await after1149({ with1149: false })
  t('verify_schema 1150 token before 1150 (never errors; vacuously true)', await token(d, T50), true)
  const r = await applyFile(d, F1150)
  t('refused without 20261149 in the ledger', [r.ok, (r.msg || '').includes('20261149_bidda_badadez_owner_data.sql is not in the ledger')], [false, true])
  table.push(['1149 not applied', r.ok ? 'GREEN (BAD)' : 'RED (as expected)', (r.msg || '').slice(0, 110)])
}

// ── (b) green ──
const db = await after1149()
const crunchyPartnersBefore = await q(db, `SELECT md5(string_agg(to_jsonb(p)::text, ',' ORDER BY id)) h FROM public.eatery_partners p WHERE slug = 'crunchy-express'`)
const crunchyOptsSql = `SELECT md5(string_agg(to_jsonb(o)::text, ',' ORDER BY o.id)) h, count(*)::int n FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.name = 'zz burger'`
const crunchyOptsBefore = await q(db, crunchyOptsSql)
const idsBefore = await q(db, `SELECT i.name, o.message_tr, o.id::text FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id JOIN public.eatery_partners p ON p.id = i.partner_id WHERE p.slug = 'bidda-badadez' ORDER BY o.id`)
const pBefore = await q(db, `SELECT md5(to_jsonb(p)::text) h FROM public.eatery_partners p WHERE slug = 'bidda-badadez'`)
t('1149 end state: 3 options, all price NULL', await q(db, ROW('o.price IS NULL AND o.kind = \'extra\'')), [{ n: 3 }])
t('1134 constraint token before 1150 is true (no price rule in it any more)', await token(db, T34), true)
{
  const d = await after1149()
  await d.exec(`ALTER TABLE public.eatery_item_options DROP CONSTRAINT eatery_item_options_price_check; ALTER TABLE public.eatery_item_options ADD CONSTRAINT eatery_item_options_price_check CHECK (price IS NULL OR price > 0)`)
  t('1134 constraint token stays true either way (price rule retired from it)', await token(d, T34), true)
}
const first = await applyFile(db, F1150)
t('1150 applies cleanly after 1149 (in-file probes green)', first, { ok: true, msg: null })
if (!first.ok) { console.log('   ', first.msg); process.exit(1) }
t('1150 applies a SECOND time (no-op)', await applyFile(db, F1150), { ok: true, msg: null })
const rendered = (await q(db, `SELECT pg_get_constraintdef(c.oid) d FROM pg_constraint c WHERE c.conrelid = 'public.eatery_item_options'::regclass AND c.conname = 'eatery_item_options_price_check'`))[0].d
console.log('   price_check as rendered by the harness (PG 18):', rendered)
t('price_check renders price >= (0)::numeric', rendered.includes('price >= (0)::numeric'), true)
t('verify_schema 1150 token after 1150', await token(db, T50), true)
t('verify_schema 1149 token after 1150', await token(db, T49), true)
t('verify_schema 1134 constraint token after 1150', await token(db, T34), true)
t('menu: only the Sade + Hellim descriptions changed (no Eklenebilir anywhere)',
  (await q(db, MENU_SQL)).filter(r => DESC[r.name]).map(r => [r.name, r.description]),
  Object.entries(DESC))
t('menu: 7 rows, prices as before', (await q(db, MENU_SQL)).map(r => r.price), ['400.00', '450.00', '500.00', '500.00', '530.00', '300.00', '300.00'])
const opts = await q(db, OPTS_SQL)
console.log('   Bidda options live:'); for (const o of opts) console.log('     ', JSON.stringify(o))
t('10 options: 4 extras price 0 / 6 removals NULL, labels Domates / Maydanoz', opts, WANT_OPTS)
t('the 3 old extras kept their ids (updated in place)',
  (await q(db, `SELECT i.name, o.message_tr, o.id::text FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id JOIN public.eatery_partners p ON p.id = i.partner_id WHERE p.slug = 'bidda-badadez' AND o.id::text = ANY ($1) ORDER BY o.id`.replace('$1', `ARRAY[${idsBefore.map(r => `'${r.id}'`).join(',')}]`))),
  idsBefore)
t('partner row byte-identical (still inactive, phone)', await q(db, `SELECT md5(to_jsonb(p)::text) h FROM public.eatery_partners p WHERE slug = 'bidda-badadez'`), pBefore)
t('is_active false / order_method phone', await q(db, `SELECT is_active, order_method FROM public.eatery_partners WHERE slug = 'bidda-badadez'`), [{ is_active: false, order_method: 'phone' }])
t('crunchy partner row byte-identical', await q(db, `SELECT md5(string_agg(to_jsonb(p)::text, ',' ORDER BY id)) h FROM public.eatery_partners p WHERE slug = 'crunchy-express'`), crunchyPartnersBefore)
t("crunchy options (removal + priced extra 25) byte-identical", await q(db, crunchyOptsSql), crunchyOptsBefore)
t('crunchy priced extra still 25.00', await q(db, `SELECT price::text FROM public.eatery_item_options WHERE message_tr = 'peynir'`), [{ price: '25.00' }])
t('table comment names the new rule', (await q(db, `SELECT obj_description('public.eatery_item_options'::regclass, 'pg_class') ~ 'price 0 = free' ok`))[0].ok, true)
{
  // the CHECK, directly, each rolled back: -1 refused; 0 and 1.50 accepted (positive controls); a removal with a price refused
  const ins = async (kind, price) => {
    try { await db.exec(`BEGIN; INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, price, max_qty) SELECT o.item_id, '${kind}', o.label_i18n, 'zz direct', ${price}, 1 FROM public.eatery_item_options o WHERE o.message_tr = 'domates' LIMIT 1; ROLLBACK;`); return 'accepted' }
    catch (e) { await db.exec('ROLLBACK'); return /price_check/.test(e.message) ? 'price_check' : /remove_shape/.test(e.message) ? 'remove_shape' : e.message }
  }
  t('price CHECK: -1 refused / 0 accepted / 1.50 accepted; removal with price 0 refused by remove_shape',
    [await ins('extra', -1), await ins('extra', 0), await ins('extra', 1.5), await ins('remove', 0)], ['price_check', 'accepted', 'accepted', 'remove_shape'])
}
{
  const ids = (await q(db, `SELECT array_agg(i.id)::text a FROM public.eatery_menu_items i JOIN public.eatery_partners p ON p.id = i.partner_id WHERE p.slug = 'bidda-badadez'`))[0].a
  await db.exec(`SET ROLE anon; SELECT set_config('request.jwt.claims', '', false);`)
  const anon = await q(db, `SELECT (SELECT count(*) FROM public.eatery_partners WHERE slug = 'bidda-badadez')::int p,
    (SELECT count(*) FROM public.eatery_menu_items WHERE id = ANY ('${ids}'::bigint[]))::int i,
    (SELECT count(*) FROM public.eatery_item_options WHERE item_id = ANY ('${ids}'::bigint[]))::int o`)
  await db.exec(`RESET ROLE;`)
  t('anon sees no bidda row / items / options by id (outside the file too)', anon, [{ p: 0, i: 0, o: 0 }])
  await db.exec(`BEGIN; UPDATE public.eatery_partners SET is_active = true, logo_path = 'bidda-badadez/logo.png' WHERE slug = 'bidda-badadez'; SET LOCAL ROLE anon;`)
  const live = await q(db, `SELECT (SELECT count(*) FROM public.eatery_menu_items WHERE id = ANY ('${ids}'::bigint[]))::int i,
    (SELECT count(*) FROM public.eatery_item_options WHERE item_id = ANY ('${ids}'::bigint[]))::int o`)
  await db.exec(`ROLLBACK; RESET ROLE;`)
  t('positive control: the same anon probe sees 7 / 10 once the partner is live (rolled back)', live, [{ i: 7, o: 10 }])
}
{
  const r = await applyFile(db, F1149)
  t('1149 is no longer re-runnable after 1150 (its menu check refuses the trimmed descriptions)', [r.ok, (r.msg || '').includes('menu is neither 1145')], [false, true])
  await db.exec('ROLLBACK; RESET ROLE;')
}
{
  await db.exec(`UPDATE public.eatery_partners SET logo_path = 'bidda-badadez/logo.png' WHERE slug = 'bidda-badadez';
    UPDATE public.eatery_menu_items i SET photo_path = 'bidda-badadez/dish-' || i.id || '.jpg', photo_width = 757, photo_height = 1600
      FROM public.eatery_partners p WHERE p.id = i.partner_id AND p.slug = 'bidda-badadez'`)
  t('re-apply after the image upload (logo_path + photo_path set) is a no-op', await applyFile(db, F1150), { ok: true, msg: null })
  t('verify_schema 1150 token after the image upload', await token(db, T50), true)
}
{
  const d = await after1149(); await applyFile(d, F1150)
  const drift = async (sql, want, label) => {
    await d.exec(sql); const r = await applyFile(d, F1150); await d.exec('ROLLBACK; RESET ROLE;')
    t(label, [r.ok, (r.msg || '').includes(want)], [false, true])
  }
  await drift(`UPDATE public.eatery_menu_items SET price = 410 WHERE name = 'Bidda Badadez Sade'`, 'neither 1149', 're-apply on a drifted menu (price) is refused')
  await d.exec(`UPDATE public.eatery_menu_items SET price = 400 WHERE name = 'Bidda Badadez Sade'`)
  await drift(`UPDATE public.eatery_item_options SET price = 1 WHERE message_tr = 'domates' AND kind = 'extra' AND price = 0`, 'neither 1149', 're-apply with a priced Bidda extra is refused')
  await d.exec(`UPDATE public.eatery_item_options SET price = 0 WHERE message_tr = 'domates' AND kind = 'extra' AND price = 1`)
  await drift(`UPDATE public.eatery_menu_items SET description = description || '. Eklenebilir/çıkarılabilir: domates' WHERE name = 'Bidda Badadez Sade'`, 'neither 1149', 're-apply with the suffix back on a description is refused')
  await d.exec(`UPDATE public.eatery_menu_items SET description = 'Bidda ekmeği, badadez' WHERE name = 'Bidda Badadez Sade'`)
  await drift(`UPDATE public.eatery_item_options SET is_available = false WHERE message_tr = 'maydanozsuz'`, 'neither 1149', 're-apply with an unavailable option is refused')
  await d.exec(`UPDATE public.eatery_item_options SET is_available = true`)
  console.log('   ledger row 1150 in d:', JSON.stringify(await q(d, `SELECT filename FROM public.schema_migrations_applied WHERE filename LIKE '20261150%'`)))
  t('verify_schema 1150 token goes red with an 11th option', await (async () => {
    await d.exec(`INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, price) SELECT i.id, 'extra', o.label_i18n, 'zz11', 0 FROM public.eatery_menu_items i, public.eatery_item_options o WHERE i.name = 'Bidda Badadez Special' AND o.message_tr = 'domates' LIMIT 1`)
    return token(d, T50) })(), false)
  await d.exec(`DELETE FROM public.eatery_item_options WHERE message_tr = 'zz11'`)
  t('verify_schema 1150 token green again (control)', await token(d, T50), true)
  await d.exec(`UPDATE public.eatery_item_options SET price = NULL WHERE message_tr = 'domates' AND kind = 'extra'`)
  t('verify_schema 1150 token goes red when a free extra is hidden again', await token(d, T50), false)
  await d.exec(`UPDATE public.eatery_item_options SET price = 0 WHERE message_tr = 'domates' AND kind = 'extra'`)
  await d.exec(`UPDATE public.eatery_menu_items SET description = description || ' Eklenebilir' WHERE name = 'Bidda Badadez Sade'`)
  t('verify_schema 1150 token goes red when a description keeps Eklenebilir', await token(d, T50), false)
  await d.exec(`UPDATE public.eatery_menu_items SET description = 'Bidda ekmeği, badadez' WHERE name = 'Bidda Badadez Sade'`)
  await d.exec(`ALTER TABLE public.eatery_item_options DROP CONSTRAINT eatery_item_options_price_check; ALTER TABLE public.eatery_item_options ADD CONSTRAINT eatery_item_options_price_check CHECK (price IS NULL OR price > 0) NOT VALID`)
  t('verify_schema 1150 token goes red with the old > 0 CHECK back', await token(d, T50), false)
}
{
  // a mixed state (new descriptions, old options) is not either accepted state
  const d = await after1149()
  await d.exec(`UPDATE public.eatery_menu_items SET description = 'Bidda ekmeği, badadez' WHERE name = 'Bidda Badadez Sade'`)
  const r = await applyFile(d, F1150)
  t('a mixed pre-state (trimmed Sade description, 1149 options) is refused with the live state', [r.ok, (r.msg || '').includes('neither 1149'), (r.msg || '').includes('Bidda ekmeği, badadez')], [false, true, true])
}

// ── (c) mutants ──
console.log('\nMUTANTS (each must be refused by the guarding probe/assertion)')
const ACT = (logo) => ['  -- ── Nothing else moved ──', `  UPDATE public.eatery_partners SET is_active = true${logo ? ", logo_path = 'bidda-badadez/logo.png'" : ''} WHERE id = c_id;\n  -- ── Nothing else moved ──`]
const CHK = ['CHECK (price IS NULL OR price >= 0);', 'CHECK (price IS NULL OR price >= 0);']
await refused('CHECK left at > 0 (the UPDATE to 0 hits it)', mutant('chk_gt', [[CHK[0], 'CHECK (price IS NULL OR price > 0);']]), 'eatery_item_options_price_check')
await refused('CHECK loosened to >= -1: the price -1 probe', mutant('chk_neg', [[CHK[0], 'CHECK (price IS NULL OR price >= -1);']]), 'price -1 accepted')
await refused('CHECK dropped entirely: the price -1 probe', mutant('chk_none', [[CHK[0], 'CHECK (true);']]), 'price -1 accepted')
await refused('a price -1 row written to Bidda (UPDATE) hits the CHECK', mutant('neg_row', [['UPDATE public.eatery_item_options o SET price = 0, sort_order', 'UPDATE public.eatery_item_options o SET price = -1, sort_order']]), 'eatery_item_options_price_check')
await refused('extras written 5 TL instead of free: target compare', mutant('five', [['UPDATE public.eatery_item_options o SET price = 0, sort_order', 'UPDATE public.eatery_item_options o SET price = 5, sort_order']]), 'target after the write')
await refused('an 11th option inserted: count', mutant('eleven', [["    IF v_n IS DISTINCT FROM 7 THEN RAISE EXCEPTION '% option rows inserted, expected 7. Nothing applied.', v_n; END IF;\n  ELSIF NOT", "    IF v_n IS DISTINCT FROM 7 THEN RAISE EXCEPTION '% option rows inserted, expected 7. Nothing applied.', v_n; END IF;\n    INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, price, max_qty, sort_order) SELECT i.id, 'extra', c_domates, 'zz11', 0, 1, 9 FROM public.eatery_menu_items i WHERE i.partner_id = c_id AND i.name = 'Bidda Badadez Special';\n  ELSIF NOT"]]), 'target after the write')
await refused('an option on a gatmer: target compare', mutant('gatmer', [["    IF v_n IS DISTINCT FROM 7 THEN RAISE EXCEPTION '% option rows inserted, expected 7. Nothing applied.', v_n; END IF;\n  ELSIF NOT", "    IF v_n IS DISTINCT FROM 7 THEN RAISE EXCEPTION '% option rows inserted, expected 7. Nothing applied.', v_n; END IF;\n    INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, price, max_qty, sort_order) SELECT i.id, 'extra', c_domates, 'domates', 0, 1, 1 FROM public.eatery_menu_items i WHERE i.partner_id = c_id AND i.name = 'Sac Gatmeri Zeytinyağlı';\n  ELSIF NOT"]]), 'target after the write')
await refused('only 6 rows inserted: insert count', mutant('six', [["WHERE NOT EXISTS (SELECT 1 FROM public.eatery_item_options x\n                        WHERE x.item_id = i.id AND x.kind = w->>'kind' AND x.message_tr = w->>'message_tr');", "WHERE NOT EXISTS (SELECT 1 FROM public.eatery_item_options x\n                        WHERE x.item_id = i.id AND x.kind = w->>'kind' AND x.message_tr = w->>'message_tr') AND w->>'message_tr' <> 'maydanozsuz';"]]), 'option rows inserted')
await refused('a removal written with a price: remove_shape', mutant('rm_price', [["(w->>'price')::numeric, (w->>'max_qty')::smallint", "0, (w->>'max_qty')::smallint"]]), 'eatery_item_options_remove_shape_check')
await refused('a description not trimmed (Sade): the update count', mutant('desc_sade', [["SET description = c_desc_sade_new\n     WHERE", "SET description = c_desc_sade_old\n     WHERE"]]), 'target after the write')
await refused('a description not trimmed (Hellim), after-write compare', mutant('desc_hellim', [["SET description = c_desc_hellim_new", "SET description = c_desc_hellim_old"]]), 'target after the write')
await refused('description update skipped: Eklenebilir/target compare', mutant('desc_skip', [["WHERE partner_id = c_id AND name = 'Bidda Badadez Sade' AND description IS NOT DISTINCT FROM c_desc_sade_old;", "WHERE partner_id = c_id AND name = 'Bidda Badadez Sade' AND false;"]]), 'Sade description update touched 0 rows')
await refused('non-target pre-state NOT refused (guard blinded) + drifted price: after-write compare',
  mutant('blind', [["ELSIF NOT (v_menu_have IS NOT DISTINCT FROM v_menu_new AND v_opts_have IS NOT DISTINCT FROM v_opts_new) THEN", 'ELSIF false THEN']]),
  'target after the write', `UPDATE public.eatery_menu_items SET price = 410 WHERE name = 'Bidda Badadez Sade'`)
await refused('non-target pre-state refused (price 410, real file)', SQL && (() => { const p = join(dir, 'real.sql'); writeFileSync(p, SQL); return p })(), 'neither 1149', `UPDATE public.eatery_menu_items SET price = 410 WHERE name = 'Bidda Badadez Sade'`)
await refused('Bidda activated without a logo: table CHECK', mutant('act_nologo', [ACT(false)]), 'eatery_partners_launch_complete_check')
await refused('Bidda activated with a logo: partner-row / active-set check', mutant('act_logo', [ACT(true)]), 'the bidda-badadez partner row changed')
await refused('Bidda activated + both guards blinded: role probe', mutant('act_blind', [ACT(true), ['IF v_pafter IS DISTINCT FROM v_pbefore THEN', 'IF false THEN'], ['IF v_active_after IS DISTINCT FROM v_active_before OR', 'IF false AND']]), 'inactive partner visible')
await refused('a 0 written to a Crunchy option', mutant('crunchy0', [['  -- ── Nothing else moved ──', "  UPDATE public.eatery_item_options SET price = 0 WHERE message_tr = 'peynir';\n  -- ── Nothing else moved ──"]]), 'another partner, its menu or its options changed')
await refused('a Crunchy removal touched', mutant('crunchy_rm', [['  -- ── Nothing else moved ──', "  UPDATE public.eatery_item_options SET sort_order = 9 WHERE message_tr = 'turşusuz';\n  -- ── Nothing else moved ──"]]), 'another partner, its menu or its options changed')
await refused('Crunchy partner touched', mutant('crunchy_p', [['  -- ── Nothing else moved ──', "  UPDATE public.eatery_partners SET sort_order = 99 WHERE slug = 'crunchy-express';\n  -- ── Nothing else moved ──"]]), 'another partner, its menu or its options changed')
await refused('ledger pre-state removed + partner gone', mutant('ledger', [["IF NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261149_bidda_badadez_owner_data.sql') THEN", 'IF false THEN']]), 'missing, active, not a phone partner',
  `DELETE FROM public.eatery_partners WHERE slug = 'bidda-badadez'`)

console.log('\nRED / GREEN TABLE')
const w = Math.max(...table.map(r => r[0].length))
for (const [n, s, m] of table) console.log(`  ${n.padEnd(w)}  ${s.padEnd(20)} ${m}`)
console.log(bad ? `\n${bad} FAILED` : '\nALL GREEN')
process.exit(bad ? 1 : 0)

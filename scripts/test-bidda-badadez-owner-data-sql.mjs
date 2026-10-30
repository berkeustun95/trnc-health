// 20261149_bidda_badadez_owner_data.sql against the PGlite harness (PostgreSQL 18; prod is older — see supabase/CLAUDE.md).
// Fixture: test-bidda-badadez-data-sql.mjs's (sliced, not retyped), then the REAL 1125 / 1132 / 1134 / 1144 / 1145 files.
// Checks:
//   (a) order: refused without 1145 in the ledger;
//   (b) the data: partner pin / hours / menu date, the owner's 7 rows (wrap ids kept), 3 add options, still
//       inactive; anon / authenticated see nothing; Crunchy untouched; a re-apply is a no-op, also after the image
//       upload set logo_path / photo_path; a drifted menu or option set is refused;
//   (c) RED-FIRST mutants of the file (every anchor asserted present, the apply must FAIL with the expected message);
//   (d) verify_schema.sql: the 1149 token (vacuous before, true after, red on a returned dish / a non-partner pin) and the
//       1145 token (stays true once 1149 replaced its menu).
// Not wired into package.json / pre-push / CI, like its siblings: run by hand.
//
//   node scripts/test-bidda-badadez-owner-data-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile } from './migration-harness.mjs'

const M = (n) => fileURLToPath(new URL(`../supabase/migrations/${n}`, import.meta.url))
const PRIOR = ['20261125_eatery_orders.sql', '20261132_eatery_orders_is_test.sql', '20261134_eatery_item_options.sql',
  '20261144_eatery_order_method.sql'].map(M)
const F1145 = M('20261145_bidda_badadez_data.sql'), F1149 = M('20261149_bidda_badadez_owner_data.sql')
const SQL = readFileSync(F1149, 'utf8')

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
// A Crunchy dish + removal option, so "nothing else moved" has option rows to watch.
const CRUNCHY_SEED = `
  INSERT INTO public.eatery_menu_items (partner_id, section, section_order, name, price, sort_order)
  SELECT id, 'Burgers', 1, 'zz burger', 100, 1 FROM public.eatery_partners WHERE slug = 'crunchy-express';
  INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, message_tr, sort_order)
  SELECT i.id, 'remove', '{"English":"Pickles","Turkish":"Turşu","Arabic":"المخلل","Russian":"Огурцы","Greek":"Τουρσί","French":"Cornichons","Spanish":"Pepinillos","German":"Gurken","Persian":"خیارشور"}', 'turşusuz', 1
    FROM public.eatery_menu_items i WHERE i.name = 'zz burger';`
const after1145 = async ({ with1145 = true } = {}) => {
  const d = await freshDb(FIXTURE)
  for (const f of [...PRIOR, ...(with1145 ? [F1145] : [])]) { const r = await applyFile(d, f); if (!r.ok) throw new Error(f + ' did not apply: ' + r.msg) }
  await d.exec(CRUNCHY_SEED)
  return d
}
const dir = mkdtempSync(join(tmpdir(), 'bidda-1149-'))
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
  const d = await after1145()
  if (seed) await d.exec(seed)
  const r = await applyFile(d, p)
  const hit = !r.ok && (r.msg || '').includes(wantMsg)
  t(`${name}: apply FAILS with "${wantMsg}"`, [r.ok, hit], [false, true])
  table.push([name, r.ok ? 'GREEN (BAD)' : hit ? 'RED (as expected)' : 'RED, wrong message', r.ok ? '' : r.msg.slice(0, 110)])
}

const VS = readFileSync(fileURLToPath(new URL('../supabase/verify_schema.sql', import.meta.url)), 'utf8')
const slice = (from, to) => {
  const a = VS.indexOf(from), b = VS.indexOf(to)
  if (a < 0 || b < a) throw new Error(`verify_schema anchors missing: ${from}`)
  const s = VS.slice(a, b)
  if ((s.match(/UNION ALL SELECT/g) || []).length !== 1) throw new Error(`verify_schema slice at ${from} must hold exactly one token`)
  return `SELECT migration, object, ok FROM (SELECT ''::text migration, ''::text object, false ok WHERE false\n${s}) z`
}
const T49 = slice('    -- 1149: the owner', '    -- 1145: to_jsonb, so it never names order_method')
const T45 = slice('    -- 1145: to_jsonb, so it never names order_method', '    -- 1128 deletes rows once')
const token = async (d, T) => { try { const r = (await d.query(T)).rows; return r.length === 1 ? r[0].ok : `rows=${r.length}` } catch (e) { return 'ERROR ' + e.message.split('\n')[0] } }

const MENU = [
  ['Dürümler', 'Bidda Badadez Sade', '400.00', 'main', 'none', 'meal', 'Bidda ekmeği, badadez. Eklenebilir/çıkarılabilir: domates, maydanoz'],
  ['Dürümler', 'Bidda Badadez Hellim', '450.00', 'main', 'veg', 'meal', 'Bidda ekmeği, hellim, badadez, domates. Eklenebilir/çıkarılabilir: maydanoz'],
  ['Dürümler', 'Bidda Badadez Şiş Köfte', '500.00', 'main', 'beef', 'meal', 'Bidda ekmeği, köfte, badadez, domates, maydanoz'],
  ['Dürümler', 'Bidda Badadez Tavuk Köfte', '500.00', 'main', 'chicken', 'meal', 'Bidda ekmeği, tavuk köfte, badadez, maydanoz'],
  ['Dürümler', 'Bidda Badadez Special', '530.00', 'main', 'beef', 'meal', 'Bidda ekmeği, köfte, hellim, badadez, domates, maydanoz'],
  ['Sac Gatmeri', 'Sac Gatmeri Gaymak Yağlı', '300.00', 'side', 'none', null, null],
  ['Sac Gatmeri', 'Sac Gatmeri Zeytinyağlı', '300.00', 'side', 'none', null, null],
].map(([section, name, price, role, protein, portion, description]) => ({ section, name, price, role, protein, spicy: false, portion, description, currency: 'TRY', is_available: true }))
const MENU_SQL = `SELECT i.section, i.name, i.price::text price, i.role, i.protein, i.spicy, i.portion, i.description, i.currency, i.is_available
  FROM public.eatery_menu_items i JOIN public.eatery_partners p ON p.id = i.partner_id WHERE p.slug = 'bidda-badadez' ORDER BY i.section_order, i.sort_order`
const OPTS_SQL = `SELECT i.name dish, o.kind, o.message_tr, o.label_i18n->>'Turkish' tr, o.label_i18n->>'English' en, o.price, o.max_qty, o.sort_order, o.is_available
  FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id JOIN public.eatery_partners p ON p.id = i.partner_id
  WHERE p.slug = 'bidda-badadez' ORDER BY i.sort_order, o.sort_order`

console.log('20261149_bidda_badadez_owner_data — real files on the 1145 fixture, 1125 / 1132 / 1134 / 1144 / 1145 applied first')

// ── (a) order ──
{
  const d = await after1145({ with1145: false })
  t('verify_schema 1149 token before 1145 (never errors; vacuously true)', await token(d, T49), true)
  const r = await applyFile(d, F1149)
  t('refused without 20261145 in the ledger', [r.ok, (r.msg || '').includes('20261145_bidda_badadez_data.sql is not in the ledger')], [false, true])
  table.push(['1145 not applied', r.ok ? 'GREEN (BAD)' : 'RED (as expected)', (r.msg || '').slice(0, 110)])
}

// ── (b) green ──
const db = await after1145()
const crunchyBefore = await q(db, `SELECT md5(string_agg(to_jsonb(p)::text, ',' ORDER BY id)) h FROM public.eatery_partners p WHERE slug = 'crunchy-express'`)
const crunchyOptsBefore = await q(db, `SELECT md5(string_agg(to_jsonb(o)::text, ',' ORDER BY o.id)) h FROM public.eatery_item_options o`)
const idsBefore = await q(db, `SELECT i.name, i.id::text FROM public.eatery_menu_items i JOIN public.eatery_partners p ON p.id = i.partner_id WHERE p.slug = 'bidda-badadez' AND i.section_order = 1 ORDER BY i.sort_order`)
t('verify_schema 1149 token before 1149 (vacuously true)', await token(db, T49), true)
t('verify_schema 1145 token before 1149 (true on the 1145 menu)', await token(db, T45), true)
const first = await applyFile(db, F1149)
t('1149 applies cleanly after 1145 (in-file probes green)', first, { ok: true, msg: null })
if (!first.ok) { console.log('   ', first.msg); process.exit(1) }
t('1149 applies a SECOND time (no-op)', await applyFile(db, F1149), { ok: true, msg: null })
t('verify_schema 1149 token after 1149', await token(db, T49), true)
t('verify_schema 1145 token after 1149 (its dish list hands over to 1149)', await token(db, T45), true)
t('partner: owner pin (source partner), hours with Sunday closed, menu date, still inactive / phone / no logo',
  await q(db, `SELECT lat, lng, geocode_source, opening_hours, menu_verified_on::text, is_active, order_method, logo_path FROM public.eatery_partners WHERE slug = 'bidda-badadez'`),
  [{ lat: 35.19837981292723, lng: 33.35504737423376, geocode_source: 'partner',
     opening_hours: { fri: { open: '08:00', close: '15:30' }, mon: { open: '08:00', close: '15:30' }, sat: { open: '09:00', close: '15:00' }, sun: null, thu: { open: '08:00', close: '15:30' }, tue: { open: '08:00', close: '15:30' }, wed: { open: '08:00', close: '15:30' } },
     menu_verified_on: '2026-10-30', is_active: false, order_method: 'phone', logo_path: null }])
t('crunchy row byte-identical (md5 of to_jsonb)', await q(db, `SELECT md5(string_agg(to_jsonb(p)::text, ',' ORDER BY id)) h FROM public.eatery_partners p WHERE slug = 'crunchy-express'`), crunchyBefore)
t("the owner's 7 rows: sections, prices, tags, Turkish descriptions", await q(db, MENU_SQL), MENU)
t('the five wraps kept their ids (updated in place; Hellimli renamed)',
  await q(db, `SELECT i.name, i.id::text FROM public.eatery_menu_items i JOIN public.eatery_partners p ON p.id = i.partner_id WHERE p.slug = 'bidda-badadez' AND i.section_order = 1 ORDER BY i.sort_order`),
  idsBefore.map(r => ({ ...r, name: r.name === 'Bidda Badadez Hellimli' ? 'Bidda Badadez Hellim' : r.name })))
t('3 add options (extra, price NULL = hidden: the CHECK refuses 0), Sade + Hellim only',
  await q(db, OPTS_SQL),
  [['Bidda Badadez Sade', 'domates', 'Domates', 'Tomato', 1], ['Bidda Badadez Sade', 'maydanoz', 'Maydanoz', 'Parsley', 2],
   ['Bidda Badadez Hellim', 'maydanoz', 'Maydanoz', 'Parsley', 1]]
    .map(([dish, message_tr, tr, en, sort_order]) => ({ dish, kind: 'extra', message_tr, tr, en, price: null, max_qty: 1, sort_order, is_available: true })))
{
  // why price NULL and not 0: the 20261134 CHECK refuses a 0 TL extra (control: 1 TL is accepted), both rolled back
  const zero = async (price) => { try { await db.exec(`BEGIN; UPDATE public.eatery_item_options SET price = ${price} WHERE message_tr = 'domates'; ROLLBACK;`); return 'accepted' } catch (e) { await db.exec('ROLLBACK'); return e.message.includes('eatery_item_options_price_check') ? 'price_check' : e.message } }
  t('a 0 TL add option is refused by eatery_item_options_price_check; 1 TL accepted (control)', [await zero(0), await zero(1)], ['price_check', 'accepted'])
}
t('every option label carries the nine languages (CHECK eatery_option_label_valid)',
  await q(db, `SELECT count(*)::int n FROM public.eatery_item_options o WHERE public.eatery_option_label_valid(o.label_i18n)`), [{ n: 4 }])
{
  const ids = (await q(db, `SELECT array_agg(i.id)::text a FROM public.eatery_menu_items i JOIN public.eatery_partners p ON p.id = i.partner_id WHERE p.slug = 'bidda-badadez'`))[0].a
  await db.exec(`SET ROLE anon; SELECT set_config('request.jwt.claims', '', false);`)
  const anon = await q(db, `SELECT (SELECT count(*) FROM public.eatery_partners WHERE slug = 'bidda-badadez')::int p,
    (SELECT count(*) FROM public.eatery_menu_items WHERE id = ANY ('${ids}'::bigint[]))::int i,
    (SELECT count(*) FROM public.eatery_item_options WHERE item_id = ANY ('${ids}'::bigint[]))::int o`)
  await db.exec(`RESET ROLE;`)
  t('anon sees no bidda row / items / options by id (outside the file too)', anon, [{ p: 0, i: 0, o: 0 }])
  // positive control for the same probe: the row once active is visible (proves the probe can see rows at all)
  await db.exec(`BEGIN; UPDATE public.eatery_partners SET is_active = true, logo_path = 'bidda-badadez/logo.png' WHERE slug = 'bidda-badadez'; SET LOCAL ROLE anon;`)
  const live = await q(db, `SELECT (SELECT count(*) FROM public.eatery_menu_items WHERE id = ANY ('${ids}'::bigint[]))::int i,
    (SELECT count(*) FROM public.eatery_item_options WHERE item_id = ANY ('${ids}'::bigint[]))::int o`)
  await db.exec(`ROLLBACK; RESET ROLE;`)
  t('positive control: the same anon probe sees 7 / 3 once the partner is live (rolled back)', live, [{ i: 7, o: 3 }])
}
t('crunchy options untouched', await q(db, `SELECT md5(string_agg(to_jsonb(o)::text, ',' ORDER BY o.id)) h FROM public.eatery_item_options o JOIN public.eatery_menu_items i ON i.id = o.item_id WHERE i.name = 'zz burger'`), crunchyOptsBefore)
{
  // what the eatery-images apply writes next: logo_path + dish photos. A re-apply must still be a no-op.
  await db.exec(`UPDATE public.eatery_partners SET logo_path = 'bidda-badadez/logo.png' WHERE slug = 'bidda-badadez';
    UPDATE public.eatery_menu_items i SET photo_path = 'bidda-badadez/dish-' || i.id || '.jpg', photo_width = 757, photo_height = 1600
      FROM public.eatery_partners p WHERE p.id = i.partner_id AND p.slug = 'bidda-badadez'`)
  t('re-apply after the image upload (logo_path + photo_path set) is a no-op', await applyFile(db, F1149), { ok: true, msg: null })
  t('verify_schema 1149 token after the image upload', await token(db, T49), true)
}
{
  const d = await after1145(); await applyFile(d, F1149)
  await d.exec(`UPDATE public.eatery_menu_items SET price = 410 WHERE name = 'Bidda Badadez Sade'`)
  const r = await applyFile(d, F1149)
  t('re-apply on a drifted menu (price) is refused', [r.ok, (r.msg || '').includes('neither 1145')], [false, true])
  await d.exec('ROLLBACK; RESET ROLE;')
  await d.exec(`UPDATE public.eatery_menu_items SET price = 400 WHERE name = 'Bidda Badadez Sade';
    DELETE FROM public.eatery_item_options o USING public.eatery_menu_items i WHERE i.id = o.item_id AND i.name = 'Bidda Badadez Hellim'`)
  const r2 = await applyFile(d, F1149)
  t('re-apply on a drifted option set is refused', [r2.ok, (r2.msg || '').includes('options are not exactly')], [false, true])
  await d.exec('ROLLBACK; RESET ROLE;')
  await d.exec(`INSERT INTO public.eatery_menu_items (partner_id, section, section_order, name, sort_order) SELECT id, 'Hamur İşleri', 3, 'Katmer', 1 FROM public.eatery_partners WHERE slug = 'bidda-badadez'`)
  t('verify_schema 1149 token goes red with a removed dish back', await token(d, T49), false)
  await d.exec(`DELETE FROM public.eatery_menu_items WHERE name = 'Katmer'`)
  t('verify_schema 1149 token green again (control)', await token(d, T49), true)
  await d.exec(`UPDATE public.eatery_partners SET geocode_source = 'osm' WHERE slug = 'bidda-badadez'`)
  t('verify_schema 1149 token goes red when the pin is not the partner\'s', await token(d, T49), false)
}

// ── (c) mutants ──
console.log('\nMUTANTS (each must be refused by the guarding probe/assertion)')
const ACT = (logo) => ['  -- ── Post-state: nothing else moved ──', `  UPDATE public.eatery_partners SET is_active = true${logo ? ", logo_path = 'bidda-badadez/logo.png'" : ''} WHERE id = c_id;\n  -- ── Post-state: nothing else moved ──`]
await refused('activated without a logo: table CHECK', mutant('act_nologo', [ACT(false)]), 'eatery_partners_launch_complete_check')
await refused('activated with a logo: active-set check', mutant('act_logo', [ACT(true)]), 'active partner set changed')
await refused('activated + set check blinded: role probe', mutant('act_blind', [ACT(true), ['IF v_active_after IS DISTINCT FROM v_active_before OR', 'IF false AND']]), 'inactive partner visible')
await refused('the Google coords stored', mutant('google', [['SET lat = c_lat, lng = c_lng,', 'SET lat = 35.1983448, lng = 33.354983,']]), "neither the 1145 state nor this file's target")
await refused("pin source 'osm'", mutant('osm', [["geocode_source = 'partner', opening_hours = c_hours", "geocode_source = 'osm', opening_hours = c_hours"]]), "neither the 1145 state nor this file's target")
await refused('Sunday left open', mutant('sun', [["opening_hours = c_hours, menu_verified_on", "opening_hours = c_hours || '{\"sun\": {\"open\": \"09:00\", \"close\": \"15:00\"}}', menu_verified_on"]]), "neither the 1145 state nor this file's target")
await refused('a removed dish kept (delete count)', mutant('keep', [["ARRAY['Katmer', 'Hellim Böreği', 'Kıyma Böreği']", "ARRAY['Katmer', 'Hellim Böreği']"]]), 'touched 2 rows')
await refused('a removed dish kept + count blinded: menu check', mutant('keep_b', [["ARRAY['Katmer', 'Hellim Böreği', 'Kıyma Böreği']", "ARRAY['Katmer', 'Hellim Böreği']"], ['IF v_n IS DISTINCT FROM 3 THEN RAISE', 'IF false THEN RAISE']]), 'menu is neither')
await refused('a price written wrong', mutant('price', [["price = (v_e->>'price')::numeric,", 'price = NULL,']]), 'menu is neither')
await refused('a gatmer not inserted', mutant('gatmer', [["FROM jsonb_array_elements(v_menu) e WHERE e->>'was' IS NULL;", "FROM jsonb_array_elements(v_menu) e WHERE e->>'was' IS NULL AND e->>'name' <> 'Sac Gatmeri Zeytinyağlı';"]]), 'menu is neither')
await refused('an option added to every wrap', mutant('opt_all', [["JOIN public.eatery_menu_items i ON i.partner_id = c_id AND i.name = e->>'dish';", "JOIN public.eatery_menu_items i ON i.partner_id = c_id AND i.section_order = 1 AND e->>'dish' = 'Bidda Badadez Sade';"]]), 'options are not exactly')
await refused('touches crunchy', mutant('crunchy', [['  -- ── Post-state: nothing else moved ──', "  UPDATE public.eatery_partners SET sort_order = 99 WHERE slug = 'crunchy-express';\n  -- ── Post-state: nothing else moved ──"]]), 'another partner, its menu or its options changed')
await refused("touches crunchy's options", mutant('crunchy_opt', [['  -- ── Post-state: nothing else moved ──', "  UPDATE public.eatery_item_options SET sort_order = 9 WHERE message_tr = 'turşusuz';\n  -- ── Post-state: nothing else moved ──"]]), 'another partner, its menu or its options changed')
await refused('ledger pre-state removed: menu check', mutant('ledger', [["IF NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261145_bidda_badadez_data.sql') THEN", 'IF false THEN']]), 'missing, active, or not a phone partner',
  `DELETE FROM public.eatery_partners WHERE slug = 'bidda-badadez'`)

console.log('\nRED / GREEN TABLE')
const w = Math.max(...table.map(r => r[0].length))
for (const [n, s, m] of table) console.log(`  ${n.padEnd(w)}  ${s.padEnd(20)} ${m}`)
console.log(bad ? `\n${bad} FAILED` : '\nALL GREEN')
process.exit(bad ? 1 : 0)

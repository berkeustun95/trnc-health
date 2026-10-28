// 20261145_bidda_badadez_data.sql against the PGlite harness (PostgreSQL 18; prod is older — see supabase/CLAUDE.md).
// Fixture: the one test-eatery-order-method-sql.mjs builds (sliced, not retyped) + the 20261123 tag columns and the
// 20261116 photo columns, then the REAL 20261125, 20261132, 20261134 and 20261144 files. Checks:
//   (a) order: refused without 1144 in the ledger; 1144 re-applies cleanly after 1145 (its first-apply check ran before);
//   (b) the data: row, 8 items, tags, prices NULL, inactive; anon / authenticated see nothing; Crunchy untouched;
//       a re-apply is a no-op; a drifted row or menu is refused;
//   (c) RED-FIRST mutants of the file (every anchor asserted present, the apply must FAIL with the expected message);
//   (d) the verify_schema.sql 1145 token: never errors, vacuously true before, true after, false on a broken row.
// Not wired into package.json / pre-push / CI, like its siblings: run by hand.
//
//   node scripts/test-bidda-badadez-data-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile } from './migration-harness.mjs'

const M = (n) => fileURLToPath(new URL(`../supabase/migrations/${n}`, import.meta.url))
const F1125 = M('20261125_eatery_orders.sql'), F1132 = M('20261132_eatery_orders_is_test.sql'), F1134 = M('20261134_eatery_item_options.sql')
const F1144 = M('20261144_eatery_order_method.sql'), F1145 = M('20261145_bidda_badadez_data.sql')
const SQL = readFileSync(F1145, 'utf8')

const OM = readFileSync(fileURLToPath(new URL('./test-eatery-order-method-sql.mjs', import.meta.url)), 'utf8')
const oa = OM.indexOf('const PRIOR = '), ob = OM.indexOf('\nlet bad', oa)
if (oa < 0 || ob < oa) throw new Error('fixture anchors missing in test-eatery-order-method-sql.mjs')
const FIXTURE_1144 = new Function('readFileSync', 'M', 'fileURLToPath', 'URL', OM.slice(oa, ob).replace(/import\.meta\.url/g, JSON.stringify(new URL('./test-eatery-order-method-sql.mjs', import.meta.url).href)) + '\nreturn FIXTURE')(readFileSync, M, fileURLToPath, URL)
const T23 = readFileSync(M('20261123_eatery_dish_tags_order_whatsapp.sql'), 'utf8')
const ta = T23.indexOf('ALTER TABLE public.eatery_menu_items ADD COLUMN IF NOT EXISTS role'), tb = T23.indexOf('COMMENT ON COLUMN public.eatery_menu_items.role')
if (ta < 0 || tb < ta) throw new Error('tag anchors missing in 20261123')
const FIXTURE = FIXTURE_1144 + '\n' + T23.slice(ta, tb) +
  '\nALTER TABLE public.eatery_menu_items ADD COLUMN photo_path text, ADD COLUMN photo_width int, ADD COLUMN photo_height int;\n'

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const q = async (d, sql) => (await d.query(sql)).rows
const after1144 = async ({ with1144 = true } = {}) => {
  const d = await freshDb(FIXTURE)
  for (const f of [F1125, F1132, F1134, ...(with1144 ? [F1144] : [])]) { const r = await applyFile(d, f); if (!r.ok) throw new Error(f + ' did not apply: ' + r.msg) }
  return d
}
const dir = mkdtempSync(join(tmpdir(), 'bidda-'))
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
  const d = await after1144()
  if (seed) await d.exec(seed)
  const r = await applyFile(d, p)
  const hit = !r.ok && (r.msg || '').includes(wantMsg)
  t(`${name}: apply FAILS with "${wantMsg}"`, [r.ok, hit], [false, true])
  table.push([name, r.ok ? 'GREEN (BAD)' : hit ? 'RED (as expected)' : 'RED, wrong message', r.ok ? '' : r.msg.slice(0, 110)])
}

const VS = readFileSync(fileURLToPath(new URL('../supabase/verify_schema.sql', import.meta.url)), 'utf8')
const v0 = VS.indexOf("    -- 1145: to_jsonb, so it never names order_method"), v1 = VS.indexOf('    -- 1128 deletes rows once')
if (v0 < 0 || v1 < v0) throw new Error('verify_schema 1145 token anchors missing')
const T45 = `SELECT migration, object, ok FROM (SELECT ''::text migration, ''::text object, false ok WHERE false\n${VS.slice(v0, v1)}) z`
const token = async (d) => { try { const r = (await d.query(T45)).rows; return r.length === 1 ? r[0].ok : `rows=${r.length}` } catch (e) { return 'ERROR ' + e.message.split('\n')[0] } }

console.log('20261145_bidda_badadez_data — real files on the order-method fixture (+ 1123 tags, 1116 photo columns), 1125 / 1132 / 1134 / 1144 applied first')

// ── (a) order ──
{
  const d = await after1144({ with1144: false })
  t('verify_schema 1145 token before 1144 (never errors; vacuously true)', await token(d), true)
  const r = await applyFile(d, F1145)
  t('refused without 20261144 in the ledger', [r.ok, (r.msg || '').includes('20261144_eatery_order_method.sql is not in the ledger')], [false, true])
  table.push(['1144 not applied', r.ok ? 'GREEN (BAD)' : 'RED (as expected)', (r.msg || '').slice(0, 110)])
}

// ── (b) green ──
const db = await after1144()
const crunchyBefore = await q(db, `SELECT md5(string_agg(to_jsonb(p)::text, ',' ORDER BY id)) h FROM public.eatery_partners p`)
t('verify_schema 1145 token before 1145 (vacuously true)', await token(db), true)
const first = await applyFile(db, F1145)
t('1145 applies cleanly after 1144 (in-file probes green)', first, { ok: true, msg: null })
if (!first.ok) { console.log('   ', first.msg); process.exit(1) }
t('1145 applies a SECOND time (no-op)', await applyFile(db, F1145), { ok: true, msg: null })
t('1144 re-applies after 1145 (its re-apply mode accepts a second partner)', await applyFile(db, F1144), { ok: true, msg: null })
t('verify_schema 1145 token after 1145', await token(db), true)
t('partners: crunchy whatsapp + active state unchanged, bidda phone + inactive',
  await q(db, `SELECT slug, order_method, is_active, category, region, phone, whatsapp, lat, logo_path, opening_hours, menu_verified_on FROM public.eatery_partners ORDER BY slug`),
  [{ slug: 'bidda-badadez', order_method: 'phone', is_active: false, category: 'fast_food', region: 'nicosia', phone: '+90 392 228 89 28', whatsapp: null, lat: null, logo_path: null, opening_hours: null, menu_verified_on: null },
   { slug: 'crunchy-express', order_method: 'whatsapp', is_active: false, category: 'fast_food', region: null, phone: null, whatsapp: null, lat: null, logo_path: null, opening_hours: null, menu_verified_on: null }])
t('crunchy row byte-identical (md5 of to_jsonb)', await q(db, `SELECT md5(string_agg(to_jsonb(p)::text, ',' ORDER BY id)) h FROM public.eatery_partners p WHERE slug = 'crunchy-express'`), crunchyBefore)
t('8 items, tags as agreed, prices NULL, TRY, available',
  await q(db, `SELECT i.name, i.section, i.role, i.protein, i.spicy, i.portion, i.price, i.currency, i.is_available FROM public.eatery_menu_items i JOIN public.eatery_partners p ON p.id = i.partner_id WHERE p.slug = 'bidda-badadez' ORDER BY i.section_order, i.sort_order`),
  [['Bidda Badadez Sade', 'Bidda Badadez', 'main', 'none', 'meal'], ['Bidda Badadez Hellimli', 'Bidda Badadez', 'main', 'veg', 'meal'],
   ['Bidda Badadez Şiş Köfte', 'Bidda Badadez', 'main', 'beef', 'meal'], ['Bidda Badadez Tavuk Köfte', 'Bidda Badadez', 'main', 'chicken', 'meal'],
   ['Bidda Badadez Special', 'Bidda Badadez', 'main', 'beef', 'meal'], ['Katmer', 'Hamur İşleri', 'side', 'none', null],
   ['Hellim Böreği', 'Hamur İşleri', 'side', 'veg', null], ['Kıyma Böreği', 'Hamur İşleri', 'side', 'beef', null]]
    .map(([name, section, role, protein, portion]) => ({ name, section, role, protein, spicy: false, portion, price: null, currency: 'TRY', is_available: true })))
{
  await db.exec(`SET ROLE anon; SELECT set_config('request.jwt.claims', '', false);`)
  const anon = (await db.query(`SELECT (SELECT count(*) FROM public.eatery_partners WHERE slug = 'bidda-badadez')::int p, (SELECT count(*) FROM public.eatery_menu_items i JOIN public.eatery_partners p ON p.id = i.partner_id WHERE p.slug = 'bidda-badadez')::int i`)).rows
  await db.exec(`RESET ROLE;`)
  t('anon sees no bidda row / items (outside the file too)', anon, [{ p: 0, i: 0 }])
}
{
  // the RPC refuses a phone partner even if it were active (1144 behaviour on the REAL row)
  await db.exec(`UPDATE public.eatery_partners SET is_active = true, lat = 35.1, lng = 33.3, geocode_source = 'partner', logo_path = 'bidda-badadez/logo.png', menu_verified_on = current_date WHERE slug = 'bidda-badadez'`)
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated","is_anonymous":false}', false);`)
  let msg = 'accepted'
  try { await db.query(`SELECT public.create_eatery_order('b86bdaa2-1af7-45ac-9d5f-efb9abf5413f', '[]'::jsonb, 'zz')`) } catch (e) { msg = e.message.split('\n')[0] }
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claims', '', false);`)
  t('create_eatery_order on the real Bidda row (activated in the test only) -> order_not_supported', msg, 'order_not_supported')
  const r = await applyFile(db, F1145)
  t('re-apply on a changed row (activated) is refused', [r.ok, (r.msg || '').includes('bidda-badadez row exists but differs')], [false, true])
}
{
  const d = await after1144(); await applyFile(d, F1145)
  await d.exec(`UPDATE public.eatery_menu_items SET protein = 'chicken' WHERE name = 'Katmer'`)
  const r = await applyFile(d, F1145)
  t('re-apply on a drifted menu is refused', [r.ok, (r.msg || '').includes('menu is not exactly')], [false, true])
  await d.exec('ROLLBACK; RESET ROLE;')
  await d.exec(`DELETE FROM public.eatery_menu_items WHERE name = 'Katmer'`)
  t('verify_schema 1145 token goes red with a dish missing', await token(d), false)
}
await refused('slug owned by another id', F1145,'already belongs to another id',
  `INSERT INTO public.eatery_partners (slug, name, category, order_method) VALUES ('bidda-badadez', 'zz', 'cafe', 'phone')`)

// ── (c) mutants ──
console.log('\nMUTANTS (each must be refused by the guarding probe/assertion)')
// Seeding active is stopped by the table itself (no pin / logo / menu date). The two after it activate a COMPLETE row
// after the row check, so the file's own set check and then (set check blinded) its role probe must catch it.
const ACTIVATE = ["  -- ── Menu ──", "  UPDATE public.eatery_partners SET is_active = true, lat = 35.1, lng = 33.3, geocode_source = 'partner', logo_path = 'bidda-badadez/logo.png', menu_verified_on = current_date WHERE id = c_id;\n  -- ── Menu ──"]
await refused('partner seeded active (insert)', mutant('active', [["NULL, NULL, NULL, 10, false, 'phone');", "NULL, NULL, NULL, 10, true, 'phone');"]]), 'eatery_partners_launch_complete_check')
await refused('activated after the row check: active-set check', mutant('active_b', [ACTIVATE]), 'active partner set changed')
await refused('activated after the row check + set check blinded: role probe', mutant('active_c', [ACTIVATE, ["IF v_active_after IS DISTINCT FROM v_active_before OR", 'IF false AND']]), 'inactive partner visible')
await refused("order_method 'whatsapp'", mutant('wa', [["NULL, NULL, NULL, 10, false, 'phone');", "NULL, NULL, NULL, 10, false, 'whatsapp');"]]), 'row exists but differs')
await refused('a price invented', mutant('price', [["e->>'name', NULL, NULL, (e->>'sort_order')::int", "e->>'name', NULL, 100, (e->>'sort_order')::int"]]), 'carry a price')
await refused('a tag inserted wrong (spicy)', mutant('spicy', [["(e->>'spicy')::boolean, e->>'portion'", "true, e->>'portion'"]]), 'menu is not exactly')
await refused('a dish dropped from the insert', mutant('drop', [["FROM jsonb_array_elements(v_menu) e;\n  END IF;", "FROM jsonb_array_elements(v_menu) e WHERE e->>'name' <> 'Katmer';\n  END IF;"]]), 'menu is not exactly')
await refused('touches crunchy', mutant('crunchy', [['  -- ── Menu ──', "  UPDATE public.eatery_partners SET sort_order = 99 WHERE slug = 'crunchy-express';\n  -- ── Menu ──"]]), 'another partner or its menu changed')
await refused('ledger pre-state removed: column probe', mutant('ledger', [["IF NOT EXISTS (SELECT 1 FROM public.schema_migrations_applied WHERE filename = '20261144_eatery_order_method.sql') THEN", 'IF false THEN']]), 'is missing or nullable',
  `ALTER TABLE public.eatery_partners DROP COLUMN order_method CASCADE`)

console.log('\nRED / GREEN TABLE')
const w = Math.max(...table.map(r => r[0].length))
for (const [n, s, m] of table) console.log(`  ${n.padEnd(w)}  ${s.padEnd(20)} ${m}`)
console.log(bad ? `\n${bad} FAILED` : '\nALL GREEN')
process.exit(bad ? 1 : 0)

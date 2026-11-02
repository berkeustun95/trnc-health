// 20261159 (eatery_menu_items.partner_item_id) + 20261160 (Pasatiempo address, owner pin, 83 partner ids) against the PGlite
// harness (PostgreSQL 18; prod is older — see supabase/CLAUDE.md). Fixture: test-pasatiempo-data-sql.mjs's chain, then the REAL
// 20261158. Red-first mutants (every anchor asserted present). Not wired into CI, like its siblings: run by hand.
//
//   node scripts/test-pasatiempo-owner-data-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile } from './migration-harness.mjs'

const M = (n) => fileURLToPath(new URL(`../supabase/migrations/${n}`, import.meta.url))
const CHAIN = ['20261125_eatery_orders.sql', '20261132_eatery_orders_is_test.sql', '20261134_eatery_item_options.sql', '20261144_eatery_order_method.sql', '20261151_eatery_partners_banner_path.sql'].map(M)
const F1157 = M('20261157_eatery_order_website.sql'), F1158 = M('20261158_pasatiempo_data.sql')
const F1159 = M('20261159_eatery_menu_items_partner_item_id.sql'), F1160 = M('20261160_pasatiempo_owner_data.sql')
const SQL = readFileSync(F1160, 'utf8')
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
const W = readFileSync(fileURLToPath(new URL('./test-eatery-order-website-sql.mjs', import.meta.url)), 'utf8')
const ca = W.indexOf('const CE = (acts = ACTS12) => `'), cb = W.indexOf("checksum) VALUES ('20261123_eatery_dish_tags_order_whatsapp.sql', 'fixture');`", ca)
const xa = W.indexOf('const ACTS12 = ['), xb = W.indexOf('\n', xa)
if (ca < 0 || cb < ca || xa < 0) throw new Error('contact_events fixture anchors missing in test-eatery-order-website-sql.mjs')
const CE = new Function(W.slice(xa, xb) + '\nreturn ' + W.slice(ca + 'const CE = '.length, cb + "checksum) VALUES ('20261123_eatery_dish_tags_order_whatsapp.sql', 'fixture');`".length))()

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const dir = mkdtempSync(join(tmpdir(), 'po-'))
const ready = async ({ with1157 = true, activeCrunchy = false } = {}) => {
  // Prod order: 1115 state + seed, then 1116 (its pre-state wants the 1115 policy set), then the 1120 policies, then the chain.
  const d = await freshDb(BASE + '\n' + PRIOR.slice(s0, s1))
  { const r = await applyFile(d, M('20261116_eatery_dish_photos.sql')); if (!r.ok) throw new Error('1116 did not apply: ' + r.msg) }
  await d.exec(KEY.slice(pa, pb))
  // contact_events as 20261115 left it (no order_whatsapp, no 1123 ledger row), then the REAL 1123 (tags + order_whatsapp),
  // which ran before 1144 in prod (its probe partner states no order_method).
  await d.exec(CE().replace(",'order_whatsapp'", '').replace(/INSERT INTO public\.schema_migrations_applied[^;]*;/, ''))
  { const r = await applyFile(d, M('20261123_eatery_dish_tags_order_whatsapp.sql')); if (!r.ok) throw new Error('1123 did not apply: ' + r.msg) }
  for (const f of CHAIN) { const r = await applyFile(d, f); if (!r.ok) throw new Error(f + ' did not apply: ' + r.msg) }
  if (with1157) { const r = await applyFile(d, F1157); if (!r.ok) throw new Error('1157 did not apply: ' + r.msg) }
  // A live partner, so the positive control has something to see (prod has two). Crunchy gets the launch-complete fields first.
  if (activeCrunchy) await d.exec(`UPDATE public.eatery_partners SET lat = 35.2, lng = 33.36, geocode_source = 'partner', logo_path = 'crunchy-express/logo.png', menu_verified_on = DATE '2026-11-01', is_active = true WHERE slug = 'crunchy-express'`)
  return d
}
const q = async (d, sql) => (await d.query(sql)).rows
const after1158 = async () => {
  const d = await ready({ activeCrunchy: true })
  const r = await applyFile(d, F1158); if (!r.ok) throw new Error('1158 did not apply: ' + r.msg)
  return d
}
const mutant = (name, pairs, base = SQL) => {
  let text = base
  for (const [from, to] of pairs) {
    const n = text.split(from).length - 1
    if (n !== 1) { bad++; console.log(`  ✗ ${name}: anchor ${JSON.stringify(from.slice(0, 70))} found ${n}x`); return null }
    text = text.replace(from, () => to)
  }
  const p = join(dir, name.replace(/\W+/g, '_') + '.sql'); writeFileSync(p, text); return p
}

console.log('20261159 + 20261160 — real files after 1115 → 1158')
const db = await after1158()
const others = async d => (await q(d, `SELECT md5(string_agg(to_jsonb(p)::text, ',' ORDER BY p.id)) m FROM public.eatery_partners p WHERE slug <> 'pasatiempo'`))[0].m
const before = await others(db)
t('1159 applies cleanly (probes green)', await applyFile(db, F1159), { ok: true, msg: null })
t('1160 applies cleanly', await applyFile(db, F1160), { ok: true, msg: null })
t('partner: address, owner pin, maps link, still inactive', (await q(db, `SELECT address, lat, lng, geocode_source, maps_url, is_active FROM public.eatery_partners WHERE slug = 'pasatiempo'`))[0],
  { address: 'Asmaaltı Sk, Lefkoşa 99010', lat: 35.177221, lng: 33.362076, geocode_source: 'partner', maps_url: 'https://www.google.com/maps?q=35.177221,33.362076', is_active: false })
t('83 items, 83 distinct partner ids, none NULL', (await q(db, `SELECT count(*)::int n, count(DISTINCT i.partner_item_id)::int d, count(*) FILTER (WHERE i.partner_item_id IS NULL)::int z
  FROM public.eatery_menu_items i JOIN public.eatery_partners p ON p.id = i.partner_id WHERE p.slug = 'pasatiempo'`))[0], { n: 83, d: 83, z: 0 })
t('spot check: Smash Cheeseburger -> imu48g3e10d4im', (await q(db, `SELECT i.partner_item_id x FROM public.eatery_menu_items i JOIN public.eatery_partners p ON p.id = i.partner_id WHERE p.slug = 'pasatiempo' AND i.name = 'Smash Cheeseburger'`))[0].x, 'imu48g3e10d4im')
t('other partners untouched', await others(db), before)
for (const f of ['20261159_eatery_menu_items_partner_item_id.sql', '20261160_pasatiempo_owner_data.sql']) await db.exec(`DELETE FROM public.schema_migrations_applied WHERE filename = '${f}'`)
t('re-apply 1159 is clean', await applyFile(db, F1159), { ok: true, msg: null })
t('re-apply 1160 is clean', await applyFile(db, F1160), { ok: true, msg: null })

console.log('verify_schema.sql 1159 / 1160 tokens (sliced from the file)')
{
  const VS = readFileSync(fileURLToPath(new URL('../supabase/verify_schema.sql', import.meta.url)), 'utf8')
  const va = VS.indexOf("    UNION ALL SELECT '20261159_"), vb = VS.indexOf('    -- ── 1158: Pasatiempo seed.', va)
  if (va < 0 || vb < va) { bad++; console.log('  ✗ token anchors missing') }
  const TOK = `SELECT x.ok FROM (SELECT ''::text, ''::text, true WHERE false\n${VS.slice(va, vb)}) x(t, c, ok)`
  const tok = async d => (await q(d, TOK)).map(r => r.ok)
  const d = await after1158()
  t('before 1159/1160: 2 tokens, vacuously true', await tok(d), [true, true])
  await applyFile(d, F1159); await applyFile(d, F1160)
  t('after: both true', await tok(d), [true, true])
  await d.exec(`UPDATE public.eatery_menu_items SET partner_item_id = NULL WHERE id = (SELECT min(i.id) FROM public.eatery_menu_items i JOIN public.eatery_partners p ON p.id = i.partner_id WHERE p.slug = 'pasatiempo')`)
  t('one id cleared: the 1160 token goes RED', await tok(d), [true, false])
}

console.log('MUTANTS (each must be refused)')
const refused = async (name, p, want, prep = null, file = 'data') => {
  if (!p) return
  const d = await after1158()
  if (file === 'data') { const r = await applyFile(d, F1159); if (!r.ok) throw new Error('1159: ' + r.msg) }
  if (prep) await d.exec(prep)
  const r = await applyFile(d, p)
  t(`${name}: FAILS with "${want}"`, [r.ok, (r.msg || '').includes(want)], [false, true])
  console.log(`      ${r.ok ? '(applied!)' : r.msg}`)
}
const firstId = (SQL.match(/\{"name": "[^"]+", "id": "([^"]+)"\}/) || [])[1]
const secondId = (SQL.match(/\{"name": "[^"]+", "id": "[^"]+"\},\n\s*\{"name": "[^"]+", "id": "([^"]+)"\}/) || [])[1]
await refused('one id blanked to an unsafe value', mutant('blank', [[`"id": "${firstId}"`, `"id": "a,b"`]]), 'eatery_menu_items_partner_item_id_check')
await refused('one id duplicated', mutant('dup', [[`"id": "${secondId}"`, `"id": "${firstId}"`]]), 'not 83 distinct names -> 83 distinct ids')
await refused('address dropped from the update', mutant('addr', [[`SET address = c_addr, lat`, `SET lat`]]), 'after: pasatiempo row is')
await refused('pasatiempo already active', F1160, 'missing, active or not a website partner', `UPDATE public.eatery_partners SET address = 'x street 1', logo_path = 'pasatiempo/logo.png', is_active = true WHERE slug = 'pasatiempo'`)
await refused('1159 not applied', F1160, '20261159 is not in the ledger', null, 'none')
await refused('1159: a URL-unsafe id allowed', mutant('chk', [[`partner_item_id ~ '^[A-Za-z0-9_-]{1,64}$'`, `partner_item_id ~ '^.{1,64}$'`]], readFileSync(F1159, 'utf8')), 'a URL-unsafe partner_item_id was ACCEPTED', null, 'none')
await refused('1159: index not unique', mutant('uniq', [[`CREATE UNIQUE INDEX IF NOT EXISTS eatery_menu_items_partner_item_id_uniq`, `CREATE INDEX IF NOT EXISTS eatery_menu_items_partner_item_id_uniq`]], readFileSync(F1159, 'utf8')), 'not a partial UNIQUE index', null, 'none')

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1) }
console.log('\nall green')

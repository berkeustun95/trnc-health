// 20261158_pasatiempo_data.sql against the PGlite harness (PostgreSQL 18; prod is older — see supabase/CLAUDE.md).
// Fixture: test-eatery-order-website-sql.mjs's chain (1115 state + Crunchy seed + 1120 policies, real 1116, 1125 / 1132 / 1134 /
// 1144 / 1151, a pre-1123 contact_events + the real 1123) and then the REAL 20261157. The file's own blocks do the role work; this script adds
//   (a) the end state: one inactive website partner, the menu matches the scratch dataset count, other rows untouched,
//       anon sees nothing, the Preview-key path is not this file's concern (1120 policies, unchanged);
//   (b) a re-apply is a no-op;
//   (c) RED-FIRST mutants (every anchor asserted present; the apply must FAIL with the expected message).
// Not wired into package.json / pre-push / CI, like its siblings: run by hand.
//
//   node scripts/test-pasatiempo-data-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile } from './migration-harness.mjs'

const M = (n) => fileURLToPath(new URL(`../supabase/migrations/${n}`, import.meta.url))
const CHAIN = ['20261125_eatery_orders.sql', '20261132_eatery_orders_is_test.sql', '20261134_eatery_item_options.sql', '20261144_eatery_order_method.sql', '20261151_eatery_partners_banner_path.sql'].map(M)
const F1157 = M('20261157_eatery_order_website.sql'), F1158 = M('20261158_pasatiempo_data.sql')
const SQL = readFileSync(F1158, 'utf8')
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
const dir = mkdtempSync(join(tmpdir(), 'pt-'))
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
const menuCount = (SQL.match(/^  \{"section": /gm) || []).length

console.log('20261158_pasatiempo_data — real file after the 1115 → 1157 chain')
const db = await ready({ activeCrunchy: true })
const others = async (d) => (await q(d, `SELECT md5(string_agg(to_jsonb(p)::text, ',' ORDER BY p.id)) m FROM public.eatery_partners p WHERE slug <> 'pasatiempo'`))[0].m
const before = await others(db)
t('applies cleanly (pre/post-state, visibility + positive control green)', await applyFile(db, F1158), { ok: true, msg: null })
t('partner', (await q(db, `SELECT slug, is_active, order_method, adult_only, brand_color, geocode_source, region, address FROM public.eatery_partners WHERE slug = 'pasatiempo'`))[0],
  { slug: 'pasatiempo', is_active: false, order_method: 'website', adult_only: false, brand_color: '#994b17', geocode_source: 'partner', region: 'nicosia', address: null })
t('menu rows = the file\'s menu entries (83)', [(await q(db, `SELECT count(*)::int n FROM public.eatery_menu_items i JOIN public.eatery_partners p ON p.id = i.partner_id WHERE p.slug = 'pasatiempo'`))[0].n, menuCount], [83, 83])
t('no alcoholic section is tagged', (await q(db, `SELECT count(*)::int n FROM public.eatery_menu_items i JOIN public.eatery_partners p ON p.id = i.partner_id
   WHERE p.slug = 'pasatiempo' AND i.section IN ('Kokteyller','Şaraplar','Rakı','Biralar','Craft Biralar','Sert İçkiler') AND i.role IS NOT NULL`))[0].n, 0)
t('adult_only = exactly the drink sections (35); every other item false', (await q(db, `SELECT count(*) FILTER (WHERE i.adult_only)::int a, count(*) FILTER (WHERE i.adult_only <> (i.section IN ('Kokteyller','Şaraplar','Rakı','Biralar','Craft Biralar','Sert İçkiler')))::int wrong
   FROM public.eatery_menu_items i JOIN public.eatery_partners p ON p.id = i.partner_id WHERE p.slug = 'pasatiempo'`))[0], { a: 35, wrong: 0 })
t('bacon + meatball dishes untagged', (await q(db, `SELECT count(*)::int n FROM public.eatery_menu_items i JOIN public.eatery_partners p ON p.id = i.partner_id
   WHERE p.slug = 'pasatiempo' AND (i.name LIKE '%Bacon%' OR i.name LIKE '%Meatball%') AND i.role IS NULL`))[0].n, 4)
t('other partners untouched', await others(db), before)
t('ledger row written', (await q(db, `SELECT count(*)::int n FROM public.schema_migrations_applied WHERE filename = '20261158_pasatiempo_data.sql'`))[0].n, 1)
await db.exec(`DELETE FROM public.schema_migrations_applied WHERE filename = '20261158_pasatiempo_data.sql'`)
t('re-apply is a clean no-op', await applyFile(db, F1158), { ok: true, msg: null })
t('still 83 rows after re-apply', (await q(db, `SELECT count(*)::int n FROM public.eatery_menu_items i JOIN public.eatery_partners p ON p.id = i.partner_id WHERE p.slug = 'pasatiempo'`))[0].n, 83)

console.log('verify_schema.sql 1157 / 1158 tokens (sliced from the file, not retyped)')
const VS = readFileSync(fileURLToPath(new URL('../supabase/verify_schema.sql', import.meta.url)), 'utf8')
const va = VS.indexOf('    -- ── 1157: order_method'), vc = VS.indexOf("    UNION ALL SELECT '20261159_", va), vd = VS.indexOf("    -- ── 1158: Pasatiempo seed.", va)
const vb = VS.indexOf('    -- ── 1144: eatery_partners.order_method', va)
if (va < 0 || vb < va) { bad++; console.log('  ✗ verify_schema 1157 anchors missing') }
// 1157 + 1158 tokens only (1159 / 1160 sit between them and have their own test).
const TOK = `SELECT x.c AS check_name, x.ok FROM (SELECT ''::text AS t, ''::text AS c, true AS ok WHERE false\n${VS.slice(va, vc)}${VS.slice(vd, vb)}) x(t, c, ok)`
const tokens = async (d) => (await q(d, TOK)).map(r => r.ok)
{
  const pre = await ready({ with1157: false })
  t('before 1157: 5 tokens, all vacuously true', await tokens(pre), [true, true, true, true, true])
  const d = await ready()
  t('after 1157, before 1158: all true', await tokens(d), [true, true, true, true, true])
  await applyFile(d, F1158)
  t('after 1158: all true', await tokens(d), [true, true, true, true, true])
  await d.exec(`ALTER TABLE public.contact_events DROP CONSTRAINT contact_events_action_check;
    ALTER TABLE public.contact_events ADD CONSTRAINT contact_events_action_check CHECK (action IN ('call','order_website'));
    UPDATE public.eatery_partners SET brand_color = NULL WHERE slug = 'pasatiempo';
    REVOKE INSERT (item_id) ON public.contact_events FROM anon;
    INSERT INTO public.eatery_menu_items (partner_id, section, name, adult_only) SELECT id, 'Drinks', 'Beer', true FROM public.eatery_partners WHERE slug = 'crunchy-express';`)
  t('broken action set / colour / grant / menu adult item: those four tokens go RED', await tokens(d), [true, false, false, false, false])
}

console.log('MUTANTS (each must be refused; activation is caught first by the DB: an active partner needs a logo, 20261115)')
const mutant = (name, pairs) => {
  let text = SQL
  for (const [from, to] of pairs) {
    const n = text.split(from).length - 1
    if (n !== 1) { bad++; console.log(`  ✗ ${name}: anchor ${JSON.stringify(from.slice(0, 70))} found ${n}x`); return null }
    text = text.replace(from, () => to)
  }
  const p = join(dir, name.replace(/\W+/g, '_') + '.sql'); writeFileSync(p, text); return p
}
const refused = async (name, p, want, opts) => {
  if (!p) return
  const r = await applyFile(await ready(opts), p)
  t(`${name}: FAILS with "${want}"`, [r.ok, (r.msg || '').includes(want)], [false, true])
  console.log(`      ${r.ok ? '(applied!)' : r.msg}`)
}
await refused('seeded ACTIVE', mutant('active', [[`DATE '2026-11-02', 20, false, 'website'`, `DATE '2026-11-02', 20, true, 'website'`]]), 'eatery_partners_launch_complete_check')
await refused('seeded as phone', mutant('phone', [[`DATE '2026-11-02', 20, false, 'website'`, `DATE '2026-11-02', 20, false, 'phone'`]]), 'differs from this file')
await refused('adult_only flipped', mutant('adult', [[`'website', false, '#994b17');`, `'website', true, '#994b17');`]]), 'differs from this file')
await refused('a menu row dropped by the insert', mutant('drop', [[`      FROM jsonb_array_elements(v_menu) e;\n  END IF;`, `      FROM jsonb_array_elements(v_menu) e OFFSET 1;\n  END IF;`]]), 'menu is not exactly')
await refused('an alcoholic item left visible to minors', mutant('adfalse', [[`"name": "Mojito", "sort_order": 1, "description": null, "price": 440, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null, "adult_only": true}`, `"name": "Mojito", "sort_order": 1, "description": null, "price": 440, "is_available": true, "role": null, "protein": null, "spicy": null, "portion": null, "adult_only": false}`]]), 'Nothing applied')
await refused('another partner touched', mutant('other', [[`  -- ── Post-state: nothing else moved ──`, `  UPDATE public.eatery_partners SET sort_order = sort_order + 1 WHERE id <> c_id;\n  -- ── Post-state: nothing else moved ──`]]), 'another partner or its menu changed')
await refused('activated at the end', mutant('act2', [[`  -- ── Post-state: nothing else moved ──`, `  UPDATE public.eatery_partners SET is_active = true WHERE id = c_id;\n  -- ── Post-state: nothing else moved ──`]]), 'eatery_partners_launch_complete_check')
await refused('visibility check removed (anon count forced)', mutant('vis', [[`IF v_anon_p <> 0 OR v_anon_i <> 0`, `IF v_anon_p <> 0 OR v_anon_i <> 0 OR true`]]), 'inactive partner visible')
await refused('anon RLS hides every partner (positive control must notice)', mutant('rls', [[`  -- ── Visibility: production roles see nothing`, `  CREATE POLICY zz_hide ON public.eatery_partners AS RESTRICTIVE FOR SELECT TO anon USING (false);\n  -- ── Visibility: production roles see nothing`]]), 'positive control failed: anon sees', { activeCrunchy: true })
await refused('1157 not applied', F1158, '20261157_eatery_order_website.sql is not in the ledger', { with1157: false })

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1) }
console.log('\nall green')

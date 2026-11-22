// 20261224_crunchy_express_menu_1122.sql against the PGlite harness (PG 18; prod is older). Fixture = the live 46-dish menu built from the
// REAL literals of 20261122 (sections, order, 2026-10-20 prices) and 20261124 (tags), 30 dish photos, a few options rows, Crunchy live,
// plus another partner. Cases: applies (3 prices, 5 new rows with description + tags, 10 sections in Yemeksepeti's order, date, options
// and photos untouched, other partner untouched); re-run changes nothing; refusals (inactive, a price drift, an unknown dish) apply
// nothing; verify_schema 1224 row; RED-FIRST mutant (a target price changed in the file) is refused by the post-check. Run by hand:
//   node scripts/test-crunchy-menu-1122-sql.mjs
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb, applyFile as apply0 } from './migration-harness.mjs'

const applyFile = async (d, f) => { const r = await apply0(d, f); if (!r.ok) await d.exec('ROLLBACK; RESET ROLE;').catch(() => {}); return r }
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const F = fileURLToPath(new URL('../supabase/migrations/20261224_crunchy_express_menu_1122.sql', import.meta.url))
const C = 'bb9dad05-6bb0-4c1c-90fb-cb0a4ad68434', O = '33333333-3333-3333-3333-333333333333'

const lit = (file, tag) => { const s = read(`../supabase/migrations/${file}`); const a = s.indexOf(`$${tag}$[`), b = s.indexOf(`]$${tag}$`, a)
  if (a < 0 || b < 0) throw new Error(`${file}: literal $${tag}$ missing`); return JSON.parse(s.slice(a + tag.length + 2, b + 1)) }
const menu1020 = lit('20261122_crunchy_express_menu_1020.sql', 't')
const tags = new Map(lit('20261124_crunchy_express_dish_tags.sql', 't').map(r => [r[0], r]))
if (menu1020.length !== 46 || tags.size !== 46) throw new Error(`fixture sources: ${menu1020.length} menu rows, ${tags.size} tags`)
const NO_PHOTO = new Set(['Crunchy Kids Box'])
const q = (v) => v === null || v === undefined ? 'NULL' : typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : String(v)
const rows = menu1020.map(([sec, so, ord, name, price]) => { const [, role, protein, spicy, portion] = tags.get(name)
  const photo = !NO_PHOTO.has(name) && !['sauce', 'drink'].includes(role) ? `crunchy-express/dish-${ord}-${so}.jpg` : null
  return `('${C}', ${q(sec)}, ${so}, ${q(name)}, 'd', ${price}, 'TRY', ${ord}, ${q(role)}, ${q(protein)}, ${q(spicy)}, ${q(portion)}, ${q(photo)})` })

const SEED = `
CREATE TABLE public.eatery_partners (id uuid PRIMARY KEY, slug text UNIQUE NOT NULL, is_active boolean NOT NULL DEFAULT false,
  menu_verified_on date, updated_at timestamptz);
CREATE TABLE public.eatery_menu_items (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, partner_id uuid NOT NULL REFERENCES public.eatery_partners(id),
  section text NOT NULL, section_order int NOT NULL DEFAULT 0, name text NOT NULL, description text, price numeric(8,2), currency text NOT NULL DEFAULT 'TRY',
  sort_order int NOT NULL DEFAULT 0, is_available boolean NOT NULL DEFAULT true, role text, protein text, spicy boolean, portion text,
  photo_path text, adult_only boolean NOT NULL DEFAULT false);
CREATE TABLE public.eatery_item_options (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, item_id bigint NOT NULL REFERENCES public.eatery_menu_items(id),
  kind text NOT NULL, label_i18n jsonb, price numeric, sort_order int NOT NULL DEFAULT 0, is_available boolean NOT NULL DEFAULT true);
INSERT INTO public.eatery_partners VALUES ('${C}', 'crunchy-express', true, DATE '2026-10-20', now()), ('${O}', 'other', true, DATE '2026-11-01', now());
INSERT INTO public.eatery_menu_items (partner_id, section, section_order, name, description, price, currency, sort_order, role, protein, spicy, portion, photo_path) VALUES
${rows.join(',\n')};
INSERT INTO public.eatery_menu_items (partner_id, section, name, price) VALUES ('${O}', 'Yan Ürünler', 'Nutella Smash', 99);
INSERT INTO public.eatery_item_options (item_id, kind, label_i18n, price, sort_order)
  SELECT id, 'remove', '{"Turkish":"Turşusuz"}'::jsonb, 0, 1 FROM public.eatery_menu_items WHERE name = 'Express Smash Burger'
  UNION ALL SELECT id, 'extra', '{"Turkish":"Köfte"}'::jsonb, 250, 2 FROM public.eatery_menu_items WHERE name = 'Express Smash Burger';`

const VS = read('../supabase/verify_schema.sql')
const vs0 = VS.indexOf("SELECT '20261224_crunchy_express_menu_1122'"), vs1 = VS.indexOf("'crunchy-express'), false)", vs0)
if (vs0 < 0 || vs1 < vs0) throw new Error('verify_schema 20261224 row missing')
const ne = VS.indexOf('NOT EXISTS(', vs0)
if (ne < 0 || ne > vs1) throw new Error('verify_schema 20261224 row: NOT EXISTS anchor missing')
const VROW = 'SELECT ' + VS.slice(ne, vs1 + "'crunchy-express'), false)".length) + ' AS ok'

let bad = 0
const t = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad++
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`}`) }
const one = async (d, sql) => (await d.query(sql)).rows[0]
const ledger = async (d) => (await one(d, `SELECT count(*)::int AS n FROM public.schema_migrations_applied WHERE filename = '20261224_crunchy_express_menu_1122.sql'`)).n
const vrow = async (d) => (await d.query(VROW)).rows[0].ok
const menu = async (d) => (await d.query(`SELECT section_order AS so, section, sort_order AS o, name, price::int AS p FROM public.eatery_menu_items
  WHERE partner_id = '${C}' ORDER BY section_order, sort_order`)).rows.map(r => `${r.so}.${r.o} ${r.section} › ${r.name} ${r.p}`)
const snap = async (d) => (await one(d, `SELECT
  (SELECT md5(string_agg(format('%s|%s|%s|%s|%s|%s', id, item_id, kind, label_i18n, price, sort_order), ';' ORDER BY id)) FROM public.eatery_item_options) AS opts,
  (SELECT md5(string_agg(format('%s|%s', id, photo_path), ';' ORDER BY id)) FROM public.eatery_menu_items WHERE photo_path IS NOT NULL) AS photos,
  (SELECT md5(string_agg(format('%s|%s|%s', id, name, price), ';' ORDER BY id)) FROM public.eatery_menu_items WHERE partner_id = '${O}') AS other,
  (SELECT md5(string_agg(format('%s|%s|%s|%s|%s|%s|%s', id, description, role, protein, spicy, portion, photo_path), ';' ORDER BY id))
     FROM public.eatery_menu_items WHERE partner_id = '${C}' AND id <= 46) AS old_rows`))

const d = await freshDb(SEED)
const before = await snap(d)
t('fixture: 46 live dishes, 9 sections, 30 photos, 2026-10-20', await one(d, `SELECT count(*)::int AS n, count(DISTINCT section)::int AS s,
  count(photo_path)::int AS ph, (SELECT menu_verified_on::text FROM public.eatery_partners WHERE id = '${C}') AS v FROM public.eatery_menu_items WHERE partner_id = '${C}'`),
  { n: 46, s: 9, ph: 30, v: '2026-10-20' })
t('verify_schema row vacuously true before apply', await vrow(d), true)
const r1 = await applyFile(d, F)
t('applies', r1, { ok: true, msg: null })
const m1 = await menu(d)
t('after: 51 dishes', m1.length, 51)
t('after: section order = Yemeksepeti (Hot Dogs 6th)', [...new Set(m1.map(l => l.split(' › ')[0].replace(/^\d+\.\d+ /, '')))],
  ['Chicken Burgerler', 'Beef Burgers', 'Crunchy Box Menüleri', 'Vejetaryen Burgerler', 'Nachos', 'Hot Dogs', 'Yan Ürünler', 'Soslar', 'Tatlılar', 'İçecekler'])
t('after: the 3 new prices', m1.filter(l => /Soğan Halkası|Nutella/.test(l)),
  ['7.3 Yan Ürünler › Acılı Soğan Halkası (8 Adet) 200', '7.4 Yan Ürünler › Acılı Soğan Halkası (12 Adet) 280', '9.1 Tatlılar › Nutella Smash 250'])
t('after: new dishes in place', m1.filter(l => /Cypriot|Vegan|Hot Dog/.test(l)),
  ['2.6 Beef Burgers › Cypriot Smash Burger 850', '4.2 Vejetaryen Burgerler › Vegan Semi Smash Burger 750',
   '6.1 Hot Dogs › Hot Dog Bacon Wrapped 490', '6.2 Hot Dogs › Trüf Mayonezli Hot Dog 490', '6.3 Hot Dogs › Barbekü Soslu Hot Dog 490'])
t('after: new-row tags (2 hot dogs untagged), no photo', (await d.query(`SELECT name, role, protein, spicy, portion, photo_path IS NULL AS nophoto
  FROM public.eatery_menu_items WHERE id > 47 ORDER BY id`)).rows.map(r => [r.name, r.role, r.protein, r.spicy, r.portion, r.nophoto]),
  [['Cypriot Smash Burger', 'main', 'beef', false, 'meal', true], ['Vegan Semi Smash Burger', 'main', 'veg', false, 'meal', true],
   ['Hot Dog Bacon Wrapped', 'main', 'pork', false, 'meal', true], ['Trüf Mayonezli Hot Dog', null, null, null, null, true],
   ['Barbekü Soslu Hot Dog', null, null, null, null, true]])
t('after: Bacon Wrapped description shows the pork', (await one(d, `SELECT description FROM public.eatery_menu_items WHERE name = 'Hot Dog Bacon Wrapped'`)).description.startsWith('Domuz bacona'), true)
const after = await snap(d)
t('options, photos, other partner, old rows\' text/tags untouched', [after.opts === before.opts, after.photos === before.photos, after.other === before.other, after.old_rows === before.old_rows], [true, true, true, true])
t('date 2026-11-22, still live, ledger row', [(await one(d, `SELECT menu_verified_on::text AS v, is_active AS a FROM public.eatery_partners WHERE id = '${C}'`)), await ledger(d)], [{ v: '2026-11-22', a: true }, 1])
t('other partner date untouched', (await one(d, `SELECT menu_verified_on::text AS v FROM public.eatery_partners WHERE id = '${O}'`)).v, '2026-11-01')
t('verify_schema row OK after apply', await vrow(d), true)
t('re-run applies, same menu', [await applyFile(d, F), await menu(d)], [{ ok: true, msg: null }, m1])
await d.exec(`UPDATE public.eatery_menu_items SET price = 199 WHERE name = 'Nutella Smash' AND partner_id = '${C}'`)
t('verify_schema row goes red on a later price drift', await vrow(d), false)

for (const [name, sql, msg] of [
  ['inactive', `UPDATE public.eatery_partners SET is_active = false WHERE id = '${C}';`, 'not live'],
  ['a price drift', `UPDATE public.eatery_menu_items SET price = 175 WHERE name = 'Patates Kızartması';`, 'Patates Kızartması 175'],
  ['an unknown dish', `INSERT INTO public.eatery_menu_items (partner_id, section, name, price) VALUES ('${C}', 'Tatlılar', 'Sufle', 200);`, 'Sufle'],
]) {
  const x = await freshDb(SEED); await x.exec(sql); const m0 = await menu(x)
  const r = await applyFile(x, F)
  t(`REFUSES (${name}), nothing applied, no ledger row`, [r.ok, (r.msg || '').includes(msg), await ledger(x), JSON.stringify(await menu(x)) === JSON.stringify(m0)], [false, true, 0, true])
}

const S = readFileSync(F, 'utf8'), A = 'UPDATE public.eatery_menu_items i\n     SET price = (t->>4)::numeric, section_order'
if (!S.includes(A)) throw new Error('mutant anchor missing')
const dir = mkdtempSync(join(tmpdir(), 'm1224-')), MF = join(dir, 'm.sql')
writeFileSync(MF, S.replace(A, 'UPDATE public.eatery_menu_items i\n     SET price = (t->>4)::numeric + CASE WHEN t->>3 = \'Nutella Smash\' THEN 1 ELSE 0 END, section_order'))
const m = await freshDb(SEED); const mm0 = await menu(m)
const rm = await applyFile(m, MF)
t('RED-FIRST: a wrong price written is refused by the post-check, nothing applied', [rm.ok, (rm.msg || '').includes('target rows not matched exactly once: Nutella Smash'), await ledger(m), JSON.stringify(await menu(m)) === JSON.stringify(mm0)], [false, true, 0, true])

console.log(bad ? `\n✗ ${bad} failed` : '\n✓ all passed'); process.exit(bad ? 1 : 0)

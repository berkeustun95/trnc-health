// The Home strip slider: slide 1 = the ladder (lead), slides 2..n = one per eatery partner.
//   node scripts/test-strip-slides.mjs            (--regen: rewrite the lead snapshot, a REVIEWED act, see below)
// Runs the REAL resolver + assembler; only lib/supabase.js and AsyncStorage are stubbed (loader hook below).
import { register } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const stub = {
  'lib/supabase.js': `export const supabase = { from: t => globalThis.__sbTable(t) }`,
  '@react-native-async-storage/async-storage': `export default { getItem: async () => globalThis.__lastKind ?? null, setItem: async () => {} }`,
}
register('data:text/javascript,' + encodeURIComponent(`
const stub = ${JSON.stringify(stub)}
export async function resolve(spec, ctx, next) {
  for (const k of Object.keys(stub)) if (spec.endsWith(k)) return { url: 'stub:' + k, shortCircuit: true }
  return next(spec, ctx)
}
export async function load(url, ctx, next) {
  if (url.startsWith('stub:')) return { format: 'module', source: stub[url.slice(5)], shortCircuit: true }
  return next(url, ctx)
}`), import.meta.url)

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { resolveStripSlides, resolveStripItem } = await import('../utils/homeStripResolver.js')
const { assembleStripSlides, nextStripRotation } = await import('../utils/stripSlides.js')
const { promosAllowed } = await import('../constants/homeStrip.js')

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}  — got ${JSON.stringify(got)}${ok ? '' : `, want ${JSON.stringify(want)}`}`)
}

const NOW = new Date('2026-10-18T12:00:00')
const dbPromo = { id: 'db-promo-1', kind: 'promo', title_i18n: { en: 'Paid sponsor' }, subtitle_i18n: null, image_url: null, link_url: 'https://x.example', pin_date: null }
const todayPin = { ...dbPromo, id: 'db-today', pin_date: '2026-10-18' }
const emptyChain = () => { const p = new Proxy(function () {}, { get: (_, k) => (k === 'then' ? r => r({ data: [], error: null }) : () => p), apply: () => p }); return p }
function stubDb(rows) {
  const pinChain = { select: () => ({ eq: async () => (rows === 'throw' ? { data: null, error: new Error('offline') } : { data: rows, error: null }) }) }
  globalThis.__sbTable = tbl => (tbl === 'home_strip_pin' ? pinChain : emptyChain())
}

// ─── the lead snapshot ──────────────────────────────────────────────────────────────────────────────────
// scripts/fixtures/strip-lead-baseline.json = the ladder's output (slide 1) over SCENARIOS. It was generated
// once from main's resolver at 91be473 (before the slider) with the eatery card off.
// ⚠ `--regen` rewrites it from the CURRENT resolver. Regen is a REVIEWED act for an intentional ladder change
//   (read the fixture diff in the PR); it is never a way to make a red test pass.
const SNAP = resolve(ROOT, 'scripts/fixtures/strip-lead-baseline.json')
const SCENARIOS = []
for (const rows of [[], [dbPromo], [todayPin], [dbPromo, todayPin], 'throw'])
  for (const lastKind of [null, 'promo', 'event'])
    for (const promosEligible of [true, false])
      for (const dismissed of [null, ['db-promo-1']])
        SCENARIOS.push({ rows, lastKind, promosEligible, dismissed })
const optsOf = sc => ({ lang: 'Turkish', now: NOW, upcoming: true, promosEligible: sc.promosEligible, dismissedIds: sc.dismissed && new Set(sc.dismissed) })
const arm = sc => { globalThis.__lastKind = sc.lastKind; stubDb(sc.rows) }

if (process.argv.includes('--regen')) {
  const out = []
  for (const sc of SCENARIOS) { arm(sc); out.push({ ...sc, lead: await resolveStripItem(optsOf(sc)) }) }
  mkdirSync(dirname(SNAP), { recursive: true })
  writeFileSync(SNAP, JSON.stringify(out, null, 1) + '\n')
  console.log(`regenerated ${SNAP} (${out.length} scenarios) from the CURRENT resolver — review the diff`)
  process.exit(0)
}

let snap
try { snap = JSON.parse(readFileSync(SNAP, 'utf8')) } catch (e) { console.log(`FAIL: cannot read ${SNAP} (${e.message})`); process.exit(1) }
console.log(`lead == the committed snapshot of main's ladder with the eatery card removed (${SCENARIOS.length} scenarios)`)
t(`snapshot has one entry per scenario with the same inputs (${snap.length}/${SCENARIOS.length})`, JSON.stringify(snap.map(({ lead, ...inp }) => inp)) === JSON.stringify(SCENARIOS), true)
let leadDiffs = 0
for (const [i, sc] of SCENARIOS.entries()) {
  arm(sc)
  const want = JSON.stringify(snap[i]?.lead)
  const got = JSON.stringify((await resolveStripSlides({ ...optsOf(sc), partners: [], gates: {}, rotation: 0 }))[0])
  arm(sc)
  const viaItem = JSON.stringify(await resolveStripItem(optsOf(sc)))
  if (got !== want || viaItem !== want) { leadDiffs++; console.log(`  ✗ ${JSON.stringify(sc)}\n     snap ${want}\n     new  ${got}`) }
}
t('lead differs from the snapshot in 0 scenarios', leadDiffs, 0)
t('the snapshot exercises a promo, a today pin and the generic card', [...new Set(snap.map(e => e.lead.id))].sort(), ['db-promo-1', 'db-today', 'generic'])

console.log('promo gate (promosAllowed feeds promosEligible; Play mixed-audience rule)')
const elig = p => promosAllowed(p, NOW)
t('guest -> not eligible', elig({ isGuest: true, dateOfBirth: '1990-01-01' }), false)
t('null DOB -> not eligible', elig({ isGuest: false, dateOfBirth: null }), false)
t('under 18 -> not eligible', elig({ isGuest: false, dateOfBirth: '2012-01-01' }), false)
t('adult -> eligible', elig({ isGuest: false, dateOfBirth: '1990-01-01' }), true)
t('day before the 18th birthday -> not eligible', elig({ isGuest: false, dateOfBirth: '2008-10-19' }), false)
t('the 18th birthday itself -> eligible', elig({ isGuest: false, dateOfBirth: '2008-10-18' }), true)

const P = (slug, name, extra = {}) => ({ slug, name, sort_order: 0, logo_path: `${slug}/logo.png`, adult_only: false, ...extra })
const A = P('a-cafe', 'Alpha'), B = P('b-bar', 'Bravo', { placeholder: true }), C = P('c-bake', 'Charlie')
const run = async (o = {}) => {
  globalThis.__lastKind = o.lastKind ?? null; stubDb(o.rows ?? [])
  return resolveStripSlides({ lang: 'Turkish', now: NOW, promosEligible: true, partners: [], gates: {}, rotation: 0, ...o })
}
const ids = s => s.map(x => x.id)

console.log('assembly')
t('ineligible + editorial partners -> lead + partners (no 18+ gate)', ids(await run({ promosEligible: false, partners: [A, B] })), ['generic', 'eatery-a-cafe', 'eatery-b-bar'])
{
  const Adult = P('d-wine', 'Delta', { adult_only: true }), Unknown = { ...P('e-pub', 'Echo'), adult_only: undefined }, Nul = P('f-x', 'Foxtrot', { adult_only: null })
  t('adult_only partner: ineligible -> absent', ids(await run({ promosEligible: false, partners: [A, Adult] })).slice(1), ['eatery-a-cafe'])
  t('adult_only partner: eligible -> present', ids(await run({ promosEligible: true, partners: [A, Adult] })).slice(1), ['eatery-a-cafe', 'eatery-d-wine'])
  t('adult_only not selected (undefined) or null -> gated like adult (fail closed)', ids(await run({ promosEligible: false, partners: [Unknown, Nul, A] })).slice(1), ['eatery-a-cafe'])
  t('rotation counts only the partners this user may see', ids(await run({ promosEligible: false, partners: [A, Adult, C], rotation: 1 })).slice(1), ['eatery-c-bake', 'eatery-a-cafe'])
}
t('eligible + 0 partners -> [lead]', ids(await run()), ['generic'])
t('eligible + 2 partners, rotation 0 -> lead, a, b', ids(await run({ partners: [A, B] })), ['generic', 'eatery-a-cafe', 'eatery-b-bar'])
t('rotation 1 -> lead, b, a', ids(await run({ partners: [A, B], rotation: 1 })), ['generic', 'eatery-b-bar', 'eatery-a-cafe'])
t('rotation wraps (3 % 2 = 1)', ids(await run({ partners: [A, B], rotation: 3 })), ['generic', 'eatery-b-bar', 'eatery-a-cafe'])
t('3 partners, rotation 2 -> c, a, b', ids(await run({ partners: [A, B, C], rotation: 2 })).slice(1), ['eatery-c-bake', 'eatery-a-cafe', 'eatery-b-bar'])
t('garbage rotation counts as 0', ids(await run({ partners: [A, B], rotation: 'x' })).slice(1), ['eatery-a-cafe', 'eatery-b-bar'])
t('base order = sort_order then name, whatever the input order',
  ids(await run({ partners: [P('z', 'Zed', { sort_order: 1 }), C, P('b2', 'Bravo2', { sort_order: 0 }), A] })).slice(1), ['eatery-a-cafe', 'eatery-b2', 'eatery-c-bake', 'eatery-z'])
t('gate false for a slug -> absent', ids(await run({ partners: [A, B], gates: { 'a-cafe': false } })).slice(1), ['eatery-b-bar'])
t('gate true / unlisted slug -> present', ids(await run({ partners: [A, B], gates: { 'a-cafe': true } })).slice(1), ['eatery-a-cafe', 'eatery-b-bar'])
t('duplicate slug rows -> one slide', ids(await run({ partners: [A, A] })).slice(1), ['eatery-a-cafe'])
t('rotation is relative to the visible partners (gated one does not count)', ids(await run({ partners: [A, B, C], gates: { 'a-cafe': false }, rotation: 1 })).slice(1), ['eatery-c-bake', 'eatery-b-bar'])
console.log('slide shape')
const [, sa, sb] = await run({ partners: [A, B] })
t('partner slide (editorial: no sponsored flag)', sa, { kind: 'promo', id: 'eatery-a-cafe', title: 'Alpha', subtitle: 'Menüye göz at', eaterySlug: 'a-cafe', logoPath: 'a-cafe/logo.png', heroPath: null, placeholder: false, action: { type: 'eatery', slug: 'a-cafe' } })
{
  const hero = async items => (await run({ partners: [{ ...A, eatery_menu_items: items }] }))[1].heroPath
  t('heroPath: first photo by section_order, sort_order, id', await hero([
    { id: 9, section_order: 1, sort_order: 0, photo_path: 's1/z.jpg' }, { id: 5, section_order: 0, sort_order: 2, photo_path: 'b.jpg' },
    { id: 4, section_order: 0, sort_order: 1, photo_path: 'a.jpg' }, { id: 3, section_order: 0, sort_order: 1, photo_path: 'a0.jpg' }]), 'a0.jpg')
  t('heroPath: items without photo_path are ignored (even if first)', await hero([
    { id: 1, section_order: 0, sort_order: 0, photo_path: null }, { id: 2, section_order: 0, sort_order: 1, photo_path: '' }, { id: 3, section_order: 0, sort_order: 2, photo_path: 'c.jpg' }]), 'c.jpg')
  t('heroPath: an unavailable dish (is_available false) is never the hero', await hero([
    { id: 1, section_order: 0, sort_order: 0, photo_path: 'hidden.jpg', is_available: false },
    { id: 2, section_order: 0, sort_order: 1, photo_path: 'shown.jpg', is_available: true }]), 'shown.jpg')
  t('heroPath: null when no item has a photo / no items / not selected', [await hero([{ id: 1, photo_path: null }]), await hero([]), await hero(undefined)], [null, null, null])
}
t('placeholder flag carried', [sa.placeholder, sb.placeholder], [false, true])
t('no photo on a partner slide', [sa.imageUrl, sb.imageUrl], [undefined, undefined])
{
  const flag = async is_active => (await run({ partners: [{ ...A, is_active }] }))[1].unpublished
  t('unpublished only when is_active === false (false/true/undefined/null)', [await flag(false), await flag(true), await flag(undefined), await flag(null)], [true, undefined, undefined, undefined])
}
console.log('never twice running applies to the lead only')
t('last kind promo + promo in DB -> lead skips the promo, partners still follow',
  ids(await run({ rows: [dbPromo], lastKind: 'promo', partners: [A] })), ['generic', 'eatery-a-cafe'])
t('lead promo + partners -> promo first, partners after', ids(await run({ rows: [dbPromo], partners: [A, B] })), ['db-promo-1', 'eatery-a-cafe', 'eatery-b-bar'])
t('dismissing the lead does not remove partner slides', ids(await run({ rows: [dbPromo], dismissedIds: new Set(['db-promo-1']), partners: [A] })), ['generic', 'eatery-a-cafe'])
console.log('pure assembler')
t('null lead -> partners only, no throw', assembleStripSlides({ lead: null, partners: [A], promosEligible: true, gates: {}, rotation: 0, lang: 'Turkish' }).map(x => x.id), ['eatery-a-cafe'])
t('null lead + ineligible -> editorial partners only', assembleStripSlides({ lead: null, partners: [A], promosEligible: false, gates: {}, rotation: 0, lang: 'Turkish' }).map(x => x.id), ['eatery-a-cafe'])
t('null lead + ineligible + adult partner -> []', assembleStripSlides({ lead: null, partners: [P('d-wine', 'Delta', { adult_only: true })], promosEligible: false, gates: {}, rotation: 0, lang: 'Turkish' }), [])
t('non-boolean eligibility fails closed for an adult partner', ids(assembleStripSlides({ lead: { id: 'l' }, partners: [P('d-wine', 'Delta', { adult_only: true })], promosEligible: 'yes', gates: {}, rotation: 0, lang: 'Turkish' })), ['l'])
t('partners not an array -> lead only', ids(assembleStripSlides({ lead: { id: 'l' }, partners: null, promosEligible: true, gates: {}, rotation: 0, lang: 'Turkish' })), ['l'])
t('nextStripRotation steps and wraps', [nextStripRotation(0, 2), nextStripRotation(1, 2), nextStripRotation(5, 3), nextStripRotation(0, 0), nextStripRotation(-4, 3), nextStripRotation(undefined, 3)], [1, 0, 0, 0, 1, 1])
const src = readFileSync(resolve(ROOT, 'utils/stripSlides.js'), 'utf8').replace(/\/\/.*$/gm, '')
t('stripSlides.js imports neither lib/supabase nor redesign.js', /supabase|redesign/i.test(src.split('\n').filter(l => /^\s*import\b/.test(l)).join('\n')), false)

if (bad) { console.log(`\nFAIL: ${bad} check(s)`); process.exit(1) }
console.log('\nOK')

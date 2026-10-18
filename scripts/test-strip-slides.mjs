// The Home strip slider: slide 1 = the ladder (lead), slides 2..n = one per eatery partner.
//   node scripts/test-strip-slides.mjs
// Runs the REAL resolver + assembler; only lib/supabase.js and AsyncStorage are stubbed (loader hook below).
import { register } from 'node:module'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
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

// ─── the baseline: main's resolver as it was at 91be473 (before the slider), eatery gate OFF ──────────────
// Written next to the real one so its relative imports resolve, patched only where the slider removed an
// export, and deleted again. If this commit is not in the clone the check fails: an unchecked lead is not a pass.
const BASE_REF = '91be473'
const baseFile = resolve(ROOT, 'utils/__baseline_resolver.tmp.js')
let baseSrc
try { baseSrc = execFileSync('git', ['show', `${BASE_REF}:utils/homeStripResolver.js`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
catch (e) { console.log(`FAIL: cannot read ${BASE_REF}:utils/homeStripResolver.js from git (${e.message.split('\n')[0]}) — the byte-for-byte lead comparison cannot run`); process.exit(1) }
const stubImport = "import { sponsoredEateryItem } from '../constants/eatery.js'"
if (!baseSrc.includes(stubImport)) { console.log('FAIL: baseline import anchor not found'); process.exit(1) }
writeFileSync(baseFile, baseSrc.replace(stubImport, 'const sponsoredEateryItem = () => { throw new Error("baseline eatery card reached") }'))
let baseline
try { baseline = await import('../utils/__baseline_resolver.tmp.js') } finally { rmSync(baseFile, { force: true }) }

const SCENARIOS = []
for (const rows of [[], [dbPromo], [todayPin], [dbPromo, todayPin], 'throw'])
  for (const lastKind of [null, 'promo', 'event'])
    for (const promosEligible of [true, false])
      for (const dismissed of [null, new Set(['db-promo-1'])])
        SCENARIOS.push({ rows, lastKind, promosEligible, dismissed })

console.log(`lead == main's ladder with the eatery card removed (${SCENARIOS.length} scenarios, baseline ${BASE_REF})`)
let leadDiffs = 0, leadCompared = 0
for (const sc of SCENARIOS) {
  globalThis.__lastKind = sc.lastKind; stubDb(sc.rows)
  const o = { lang: 'Turkish', now: NOW, upcoming: true, promosEligible: sc.promosEligible, dismissedIds: sc.dismissed }
  const want = JSON.stringify(await baseline.resolveStripItem({ ...o, eateryGate: false }))
  const got = JSON.stringify((await resolveStripSlides({ ...o, partners: [], gates: {}, rotation: 0 }))[0])
  const viaItem = JSON.stringify(await resolveStripItem(o))
  leadCompared++
  if (got !== want || viaItem !== want) { leadDiffs++; console.log(`  ✗ ${JSON.stringify({ ...sc, dismissed: sc.dismissed && [...sc.dismissed] })}\n     base ${want}\n     new  ${got}`) }
}
t('lead differs from baseline in 0 scenarios', leadDiffs, 0)
t('scenarios actually compared', leadCompared, SCENARIOS.length)
t('the matrix exercises a promo, a today pin and the generic card',
  [...new Set(await Promise.all([[dbPromo], [todayPin], []].map(async rows => { globalThis.__lastKind = null; stubDb(rows); return (await resolveStripSlides({ lang: 'Turkish', now: NOW, promosEligible: true, partners: [], gates: {}, rotation: 0 }))[0].id })))],
  ['db-promo-1', 'db-today', 'generic'])

const P = (slug, name, extra = {}) => ({ slug, name, sort_order: 0, logo_path: `${slug}/logo.png`, ...extra })
const A = P('a-cafe', 'Alpha'), B = P('b-bar', 'Bravo', { placeholder: true }), C = P('c-bake', 'Charlie')
const run = async (o = {}) => {
  globalThis.__lastKind = o.lastKind ?? null; stubDb(o.rows ?? [])
  return resolveStripSlides({ lang: 'Turkish', now: NOW, promosEligible: true, partners: [], gates: {}, rotation: 0, ...o })
}
const ids = s => s.map(x => x.id)

console.log('assembly')
t('ineligible + partners -> [lead] only', ids(await run({ promosEligible: false, partners: [A, B] })), ['generic'])
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
t('partner slide', sa, { kind: 'promo', id: 'eatery-a-cafe', sponsored: true, title: 'Alpha', subtitle: 'Menüye göz at', eaterySlug: 'a-cafe', logoPath: 'a-cafe/logo.png', placeholder: false, action: { type: 'eatery', slug: 'a-cafe' } })
t('placeholder flag carried', [sa.placeholder, sb.placeholder], [false, true])
t('no photo on a partner slide', [sa.imageUrl, sb.imageUrl], [undefined, undefined])
console.log('never twice running applies to the lead only')
t('last kind promo + promo in DB -> lead skips the promo, partners still follow',
  ids(await run({ rows: [dbPromo], lastKind: 'promo', partners: [A] })), ['generic', 'eatery-a-cafe'])
t('lead promo + partners -> promo first, partners after', ids(await run({ rows: [dbPromo], partners: [A, B] })), ['db-promo-1', 'eatery-a-cafe', 'eatery-b-bar'])
t('dismissing the lead does not remove partner slides', ids(await run({ rows: [dbPromo], dismissedIds: new Set(['db-promo-1']), partners: [A] })), ['generic', 'eatery-a-cafe'])
console.log('pure assembler')
t('null lead -> partners only, no throw', assembleStripSlides({ lead: null, partners: [A], promosEligible: true, gates: {}, rotation: 0, lang: 'Turkish' }).map(x => x.id), ['eatery-a-cafe'])
t('null lead + ineligible -> []', assembleStripSlides({ lead: null, partners: [A], promosEligible: false, gates: {}, rotation: 0, lang: 'Turkish' }), [])
t('non-boolean eligibility fails closed', ids(assembleStripSlides({ lead: { id: 'l' }, partners: [A], promosEligible: 'yes', gates: {}, rotation: 0, lang: 'Turkish' })), ['l'])
t('partners not an array -> lead only', ids(assembleStripSlides({ lead: { id: 'l' }, partners: null, promosEligible: true, gates: {}, rotation: 0, lang: 'Turkish' })), ['l'])
t('nextStripRotation steps and wraps', [nextStripRotation(0, 2), nextStripRotation(1, 2), nextStripRotation(5, 3), nextStripRotation(0, 0), nextStripRotation(-4, 3), nextStripRotation(undefined, 3)], [1, 0, 0, 0, 1, 1])
const src = readFileSync(resolve(ROOT, 'utils/stripSlides.js'), 'utf8').replace(/\/\/.*$/gm, '')
t('stripSlides.js imports neither lib/supabase nor redesign.js', /supabase|redesign/i.test(src.split('\n').filter(l => /^\s*import\b/.test(l)).join('\n')), false)

if (bad) { console.log(`\nFAIL: ${bad} check(s)`); process.exit(1) }
console.log('\nOK')

// The Yeme-İçme "Sponsorlu" card in the redesign Home banner (resolveRedesignBanner, rank 1).
//   node scripts/test-strip-sponsored.mjs
// Runs the REAL resolver; only lib/supabase.js and AsyncStorage are stubbed (loader hook below).
import { register } from 'node:module'

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

const { resolveStripItem } = await import('../utils/homeStripResolver.js')
const { promosAllowed } = await import('../constants/homeStrip.js')
const { EATERY_SPONSORED_SLUG } = await import('../constants/eatery.js')
const { CRUNCHY_EXPRESS_LIVE, EATERY_LIVE } = await import('../constants/flags.js')

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}  — got ${JSON.stringify(got)}${ok ? '' : `, want ${JSON.stringify(want)}`}`)
}

const NOW = new Date('2026-10-18T12:00:00')
const DOB_ADULT = '1990-01-01', DOB_MINOR = '2012-01-01'
const dbPromo = { id: 'db-promo-1', kind: 'promo', title_i18n: { en: 'Paid sponsor' }, subtitle_i18n: null, image_url: null, link_url: 'https://x.example', pin_date: null }
const emptyChain = () => { const p = new Proxy(function () {}, { get: (_, k) => (k === 'then' ? r => r({ data: [], error: null }) : () => p), apply: () => p }); return p }

// rows = home_strip_pin rows, 'throw' = the pins read fails; every other table answers empty.
async function resolveWith({ rows = [], lastKind = null, eateryGate, promosEligible = true, dismissed = null }) {
  globalThis.__lastKind = lastKind
  const pinChain = { select: () => ({ eq: async () => (rows === 'throw' ? { data: null, error: new Error('offline') } : { data: rows, error: null }) }) }
  globalThis.__sbTable = tbl => (tbl === 'home_strip_pin' ? pinChain : emptyChain())
  const o = { lang: 'Turkish', now: NOW, upcoming: true, promosEligible, dismissedIds: dismissed }
  if (eateryGate !== undefined) o.eateryGate = eateryGate
  const r = await resolveStripItem(o)
  return { kind: r.kind, id: r.id, sponsored: r.sponsored, slug: r.eaterySlug ?? null, title: r.title ?? null, action: r.action?.type }
}
const SP = { kind: 'promo', id: `eatery-${EATERY_SPONSORED_SLUG}`, sponsored: true, slug: EATERY_SPONSORED_SLUG, title: 'Crunchy Express', action: 'eatery' }
const GENERIC = { kind: 'event', id: 'generic', sponsored: false, slug: null, title: null, action: 'events' }

console.log('production flags:', { CRUNCHY_EXPRESS_LIVE, EATERY_LIVE })
console.log('gate')
t('default gate (production flag false) -> never appears', (await resolveWith({})).slug, CRUNCHY_EXPRESS_LIVE ? EATERY_SPONSORED_SLUG : null)
t('gate false explicit -> generic card', await resolveWith({ eateryGate: false }), GENERIC)
t('gate non-boolean (truthy string) -> fails closed', (await resolveWith({ eateryGate: 'yes' })).slug, null)
console.log('eligibility (promosAllowed feeds promosEligible)')
const elig = p => promosAllowed(p, NOW)
t('guest -> not eligible', elig({ isGuest: true, dateOfBirth: DOB_ADULT }), false)
t('null DOB -> not eligible', elig({ isGuest: false, dateOfBirth: null }), false)
t('under 18 -> not eligible', elig({ isGuest: false, dateOfBirth: DOB_MINOR }), false)
t('adult -> eligible', elig({ isGuest: false, dateOfBirth: DOB_ADULT }), true)
t('gate true + ineligible -> never', await resolveWith({ eateryGate: true, promosEligible: false }), GENERIC)
console.log('rank 1')
t('gate true + eligible -> sponsored card, slug, kind promo', await resolveWith({ eateryGate: true }), SP)
t('not twice running (last kind promo) -> skipped', await resolveWith({ eateryGate: true, lastKind: 'promo' }), GENERIC)
t('last kind event -> shown', (await resolveWith({ eateryGate: true, lastKind: 'event' })).id, SP.id)
t('dismissed id -> skipped', await resolveWith({ eateryGate: true, dismissed: new Set([SP.id]) }), GENERIC)
console.log('pool sharing: DB promos first, config as fallback')
t('live DB promo + gate true -> the DB promo wins', (await resolveWith({ eateryGate: true, rows: [dbPromo] })).id, 'db-promo-1')
t('DB promo dismissed -> config fallback', (await resolveWith({ eateryGate: true, rows: [dbPromo], dismissed: new Set(['db-promo-1']) })).id, SP.id)
t('DB promo + last kind promo -> neither', (await resolveWith({ eateryGate: true, rows: [dbPromo], lastKind: 'promo' })).kind, 'event')
t('pins read fails (offline/RLS) -> config still shown', (await resolveWith({ eateryGate: true, rows: 'throw' })).id, SP.id)
t('DB promo + gate false -> DB promo only', (await resolveWith({ eateryGate: false, rows: [dbPromo] })).id, 'db-promo-1')
t("today's pin still outranks it (rank 0)", (await resolveWith({ eateryGate: true, rows: [{ ...dbPromo, id: 'db-today', pin_date: '2026-10-18' }] })).id, 'db-today')
console.log('legacy ladder untouched')
t('legacy (upcoming:false) never shows it even gate true', (await (async () => {
  globalThis.__lastKind = null
  globalThis.__sbTable = tbl => (tbl === 'home_strip_pin' ? { select: () => ({ eq: async () => ({ data: [], error: null }) }) } : emptyChain())
  return (await resolveStripItem({ lang: 'Turkish', now: NOW, promosEligible: true, eateryGate: true })).id
})()), 'generic')

if (bad) { console.log(`\nFAIL: ${bad} check(s)`); process.exit(1) }
console.log('\nOK')

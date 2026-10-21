// "Ne yesem?" (dish finder) — pure matcher behind components/EateryQuiz.js, in the constants/eatery.js mould:
// plain JS, no React, no network, tested by scripts/test-eatery-quiz.mjs. It reads the rows loadEateryPartners
// already returned (never its own query), so a hidden partner is only here when the Preview key lets the list show it.
// A dish is only ever suggested when it carries a tag: the Preview fixture and any untagged item have role null.
import { dateLocale } from './i18n.js'
import { eateryOrderable } from './eatery.js'

export const QUIZ_STEPS = 5
export const QUIZ_EXTRAS = ['sauce', 'drink', 'dessert']

const filled = v => typeof v === 'string' && v.trim().length > 0
// Ids are numbers today; a string id still sorts, never throws.
const byNum = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? '')))
const cmpItem = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || byNum(a.id, b.id)

// answers: { protein: 'chicken'|'beef'|'veg'|'any', spicy: 'yes'|'no'|'any', portion: 'snack'|'meal'|'share',
//            budget: 'any'|'low'|'mid'|'high', extra: 'sauce'|'drink'|'dessert'|'none' }
// Fark etmez on protein keeps pork and untagged-protein mains; a named protein is an exact match
// (Et = beef only, so pork never comes back for it).
const passProtein = (i, a) => !a?.protein || a.protein === 'any' || i.protein === a.protein
const passSpicy = (i, a) => !a?.spicy || a.spicy === 'any' || i.spicy === (a.spicy === 'yes')
const passPortion = (i, a) => !a?.portion || i.portion === a.portion

// Every available, priced, tagged main of the given partners: [{ item, partner }]. With answers: only those passing Q1-Q3.
export function quizCandidates(rows, answers = null) {
  const out = []
  for (const partner of rows || []) {
    for (const item of partner?.eatery_menu_items || []) {
      if (!item || item.role !== 'main' || !filled(item.name) || !eateryOrderable(item)) continue
      if (answers && !(passProtein(item, answers) && passSpicy(item, answers) && passPortion(item, answers))) continue
      out.push({ item, partner })
    }
  }
  return out
}

// The entry card shows exactly when the matcher has something to draw from.
export const quizHasMains = rows => quizCandidates(rows).length > 0

// Terciles of the candidates' prices (the dishes left after Q1-Q3). The cuts are real prices, so a label never names
// an amount no dish costs. Empty bands are dropped; under two bands there is nothing to choose, so none are offered.
// -> [{ key: 'low'|'mid'|'high', min?, max?, count }]
export function quizBudgetBands(cands) {
  const prices = cands.map(c => Number(c.item.price)).sort((a, b) => a - b)
  const n = prices.length
  if (n < 2) return []
  const lowCut = prices[Math.ceil(n / 3) - 1]
  const highCut = prices[Math.ceil((2 * n) / 3) - 1]
  const bands = [
    { key: 'low', max: lowCut, count: prices.filter(p => p <= lowCut).length },
    { key: 'mid', min: lowCut, max: highCut, count: prices.filter(p => p > lowCut && p <= highCut).length },
    { key: 'high', min: highCut, count: prices.filter(p => p > highCut).length },
  ].filter(b => b.count > 0)
  return bands.length >= 2 ? bands : []
}

const inBand = (price, b) => (b.min == null || price > b.min) && (b.max == null || price <= b.max)

// -> { dishes: [{ item, partner }] (0-3), relaxed: ['budget'|'portion'|'spicy'], companion: { item, partner } | null }
export function quizMatch(rows, answers) {
  const budgetAsked = !!answers.budget && answers.budget !== 'any'
  const spicyAsked = !!answers.spicy && answers.spicy !== 'any'
  const band = budgetAsked ? quizBudgetBands(quizCandidates(rows, answers)).find(b => b.key === answers.budget) || null : null
  const budgetOk = c => !!band && inBand(Number(c.item.price), band)
  const score = c => (budgetAsked && budgetOk(c) ? 1 : 0) + (spicyAsked && passSpicy(c.item, answers) ? 1 : 0) + (passPortion(c.item, answers) ? 1 : 0)

  // Relaxation order: budget, then portion, then spicy; protein never. A step that drops an answer nobody gave is skipped.
  const all = quizCandidates(rows).filter(c => passProtein(c.item, answers))
  const stages = [[]]
  const dropped = []
  for (const k of ['budget', 'portion', 'spicy']) {
    if (k === 'budget' && !budgetAsked) continue
    if (k === 'spicy' && !spicyAsked) continue
    dropped.push(k)
    stages.push([...dropped])
  }
  let pool = []
  let relaxed = []
  for (const drop of stages) {
    pool = all.filter(c =>
      (drop.includes('budget') || !budgetAsked || budgetOk(c)) &&
      (drop.includes('portion') || passPortion(c.item, answers)) &&
      (drop.includes('spicy') || passSpicy(c.item, answers)))
    relaxed = drop
    if (pool.length) break
  }
  if (!pool.length) return { dishes: [], relaxed: [], companion: null }

  const ranked = pool.map(c => ({ ...c, score: score(c), photo: filled(c.item.photo_path) ? 1 : 0 }))
    .sort((a, b) => b.score - a.score || b.photo - a.photo
      || (a.partner.sort_order ?? 0) - (b.partner.sort_order ?? 0) || cmpItem(a.item, b.item))
  const spread = new Set(ranked.map(c => c.partner.id ?? c.partner.slug)).size > 1
  const perPartner = new Map()
  const dishes = []
  for (const c of ranked) {
    const key = c.partner.id ?? c.partner.slug
    if (spread && (perPartner.get(key) || 0) >= 2) continue
    perPartner.set(key, (perPartner.get(key) || 0) + 1)
    dishes.push({ item: c.item, partner: c.partner })
    if (dishes.length === 3) break
  }
  return { dishes, relaxed, companion: quizCompanion(dishes[0].partner, answers) }
}

// One item of the chosen role from the TOP dish's partner: first by sort_order; a sauce prefers a non-spicy one under Acı Hayır.
export function quizCompanion(partner, answers) {
  if (!QUIZ_EXTRAS.includes(answers?.extra)) return null
  const list = (partner?.eatery_menu_items || [])
    .filter(i => i && i.role === answers.extra && i.is_available !== false && filled(i.name))
    .sort((a, b) => {
      if (answers.extra === 'sauce' && answers.spicy === 'no') {
        const d = (a.spicy === true ? 1 : 0) - (b.spicy === true ? 1 : 0)
        if (d) return d
      }
      return cmpItem(a, b)
    })
  return list.length ? { item: list[0], partner } : null
}

// "₺650": whole liras, in the reader's language (band labels are cut points; kopeks would only be noise).
export function quizAmount(price, currency, lang) {
  const n = Number(price)
  if (!Number.isFinite(n)) return ''
  try {
    return new Intl.NumberFormat(dateLocale(lang), { style: 'currency', currency: currency || 'TRY', maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(n)
  } catch {
    return `${Math.round(n)} ${currency || ''}`.trim()
  }
}

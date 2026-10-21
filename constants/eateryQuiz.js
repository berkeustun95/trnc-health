// "Ne yesem?" (dish finder) — pure matcher behind components/EateryQuiz.js, in the constants/eatery.js mould:
// plain JS, no React, no network, tested by scripts/test-eatery-quiz.mjs. It reads the rows loadEateryPartners
// already returned (never its own query), so a hidden partner is only here when the Preview key lets the list show it.
// A dish is only ever suggested when it carries a tag: the Preview fixture and any untagged item have role null.
import { eateryOrderable, eateryMenuSections, orderTotal } from './eatery.js'

export const QUIZ_STEPS = 4
export const QUIZ_EXTRAS = ['sauce', 'drink', 'dessert']

const filled = v => typeof v === 'string' && v.trim().length > 0
// Ids are numbers today; a string id still sorts, never throws.
const byNum = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? '')))
const cmpItem = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || byNum(a.id, b.id)

// answers: { protein: ['chicken'|'beef'|'veg'... up to 2, or ['any']], spicy: 'yes'|'no'|'any',
//            portion: ['snack'|'meal'|'share' ... up to 2], extra: any of ['sauce','drink','dessert'] or ['none'] }
// Several picks on one question are an OR. Fark etmez on protein keeps pork and untagged-protein mains; a named protein is
// an exact match (Et = beef only, so pork never comes back for it, alone or together with Tavuk).
const has = (list, v) => Array.isArray(list) && list.includes(v)
const passProtein = (i, a) => !a?.protein?.length || has(a.protein, 'any') || has(a.protein, i.protein)
const passSpicy = (i, a) => !a?.spicy || a.spicy === 'any' || i.spicy === (a.spicy === 'yes')
const passPortion = (i, a) => !a?.portion?.length || has(a.portion, i.portion)

// Picking rules per multi-select question: a cap and an exclusive tile ("Fark etmez" / "Hiçbiri").
export const QUIZ_MULTI = {
  protein: { max: 2, exclusive: 'any' },
  portion: { max: 2, exclusive: null },
  extra:   { max: null, exclusive: 'none' },
}
// -> { next, blocked }: the new selection after tapping `value`. A tapped selected tile is always removed; an exclusive tile
// replaces everything and is replaced by any other pick; a pick over the cap changes nothing and says so.
export function quizToggle(key, current, value) {
  const { max, exclusive } = QUIZ_MULTI[key]
  const cur = current || []
  if (cur.includes(value)) return { next: cur.filter(v => v !== value), blocked: false }
  if (exclusive && value === exclusive) return { next: [value], blocked: false }
  const base = exclusive ? cur.filter(v => v !== exclusive) : cur
  if (max && base.length >= max) return { next: cur, blocked: true }
  return { next: [...base, value], blocked: false }
}

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

// -> { dishes: [{ item, partner, companions }] (0-3), relaxed: ['portion'|'spicy'], companions: the top dish's }
export function quizMatch(rows, answers) {
  const spicyAsked = !!answers.spicy && answers.spicy !== 'any'
  const portionAsked = !!answers.portion?.length
  const score = c => (spicyAsked && passSpicy(c.item, answers) ? 1 : 0) + (portionAsked && passPortion(c.item, answers) ? 1 : 0)

  // Relaxation order: portion, then spicy; protein never. A step that drops an answer nobody gave is skipped.
  const all = quizCandidates(rows).filter(c => passProtein(c.item, answers))
  const stages = [[]]
  const dropped = []
  for (const k of ['portion', 'spicy']) {
    if ((k === 'portion' && !portionAsked) || (k === 'spicy' && !spicyAsked)) continue
    dropped.push(k)
    stages.push([...dropped])
  }
  let pool = []
  let relaxed = []
  for (const drop of stages) {
    pool = all.filter(c => (drop.includes('portion') || passPortion(c.item, answers)) && (drop.includes('spicy') || passSpicy(c.item, answers)))
    relaxed = drop
    if (pool.length) break
  }
  if (!pool.length) return { dishes: [], relaxed: [], companions: [] }

  const ranked = pool.map(c => ({ ...c, score: score(c), photo: filled(c.item.photo_path) ? 1 : 0 }))
    .sort((a, b) => b.score - a.score || b.photo - a.photo
      || (a.partner.sort_order ?? 0) - (b.partner.sort_order ?? 0) || (a.item.section_order ?? 0) - (b.item.section_order ?? 0) || cmpItem(a.item, b.item))
  const spread = new Set(ranked.map(c => c.partner.id ?? c.partner.slug)).size > 1
  // Coverage first: every picked protein / portion value (Q1 values, then Q3 values) that has a dish in the pool gets its
  // best-ranked dish; the rest of the three slots fill by rank. Shown in rank order. Max 2 per partner when several partners.
  const perPartner = new Map()
  const chosen = []
  const take = c => {
    const key = c.partner.id ?? c.partner.slug
    if (chosen.includes(c) || chosen.length >= 3 || (spread && (perPartner.get(key) || 0) >= 2)) return false
    perPartner.set(key, (perPartner.get(key) || 0) + 1)
    chosen.push(c)
    return true
  }
  const wanted = [
    ...(answers.protein || []).filter(v => v !== 'any').map(v => c => c.item.protein === v),
    ...(answers.portion || []).map(v => c => c.item.portion === v),
  ]
  for (const carries of wanted) {
    if (chosen.some(carries)) continue
    ranked.find(c => carries(c) && take(c))   // take() refuses a dish the partner cap blocks; the next carrier is tried
  }
  for (const c of ranked) take(c)
  const dishes = ranked.filter(c => chosen.includes(c)).map(c => ({ item: c.item, partner: c.partner }))
  // Sides are per card: each dish carries the recommended sides of ITS OWN partner (the results page shows them once that dish is in the basket).
  const withSides = dishes.map(d => ({ ...d, companions: quizCompanions(d.partner, answers) }))
  return { dishes: withSides, relaxed, companions: withSides[0].companions }
}

// One item per chosen role (sauce, drink, dessert order) from the TOP dish's partner: first by sort_order; a sauce prefers a
// non-spicy one under Acısız.
export function quizCompanions(partner, answers) {
  const out = []
  for (const role of QUIZ_EXTRAS) {
    if (!has(answers?.extra, role)) continue
    const list = (partner?.eatery_menu_items || [])
      .filter(i => i && i.role === role && i.is_available !== false && filled(i.name))
      .sort((a, b) => {
        if (role === 'sauce' && answers.spicy === 'no') {
          const d = (a.spicy === true ? 1 : 0) - (b.spicy === true ? 1 : 0)
          if (d) return d
        }
        return cmpItem(a, b)
      })
    if (list.length) out.push({ item: list[0], partner })
  }
  return out
}

// ── Results basket (the store is utils/eateryBasketCore.js; these are the pure decisions around it) ──
// A side line is added only when it is priced and available; a priceless one stays a plain line.
export const quizSideOrderable = eateryOrderable

// What the partner page would show for this basket: the same line set (eateryMenuSections + eateryOrderable), so the
// bar on the results and the bar on the menu never disagree. -> { count, total, currency }
export function quizBasketSummary(partner, basket) {
  const items = eateryMenuSections(partner).flatMap(sec => sec.items).filter(eateryOrderable)
  const lines = items.filter(i => (basket?.[i.id] || 0) > 0).map(i => ({ qty: basket[i.id], price: Number(i.price) }))
  return { count: lines.reduce((n, l) => n + l.qty, 0), total: orderTotal(lines), currency: items[0]?.currency }
}

// Which partner's basket the results bar shows: the one most recently added to; when that one is empty (cleared on the
// partner page), the first result partner that still has items; none when all are empty.
export function quizBarPartner(partners, summaryOf, lastId) {
  const list = partners || []
  const last = list.find(p => (p.id ?? p.slug) === lastId)
  if (last && summaryOf(last).count > 0) return last
  return list.find(p => summaryOf(p).count > 0) || null
}

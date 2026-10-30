// "Ne yesem?" (dish finder) — pure matcher behind components/EateryQuiz.js, in the constants/eatery.js mould:
// plain JS, no React, no network, tested by scripts/test-eatery-quiz.mjs. It reads the rows loadEateryPartners
// already returned (never its own query), so a hidden partner is only here when the Preview key lets the list show it.
// A dish is only ever suggested when it carries a tag: the Preview fixture and any untagged item have role null.
import { eateryOrderable, eateryMenuSections, orderTotal, basketLines } from './eatery.js'

export const QUIZ_EXTRAS = ['sauce', 'drink', 'dessert']

const filled = v => typeof v === 'string' && v.trim().length > 0
// Ids are numbers today; a string id still sorts, never throws.
const byNum = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? '')))
const cmpItem = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || byNum(a.id, b.id)

// answers: { protein: ['chicken'|'beef'|'veg'... up to 2, or ['any']], spicy: 'yes'|'no'|'any',
//            portion: ['snack'|'meal'|'share' ... up to 2], extra: any of ['sauce','drink','dessert'] or ['none'] }
// Several picks on one question are an OR. Fark etmez on protein keeps pork and untagged-protein mains; a named protein is
// an exact match (Et = beef only, so pork never comes back for it, alone or together with Tavuk), except that Vejetaryen also
// takes a meatless dish tagged protein 'none' (Bidda's Sade). A dish with no portion is never excluded by a portion answer; it just
// earns no portion bonus (hitPortion).
const has = (list, v) => Array.isArray(list) && list.includes(v)
const passProtein = (i, a) => !a?.protein?.length || has(a.protein, 'any') || has(a.protein, i.protein) || (has(a.protein, 'veg') && i.protein === 'none')
const passSpicy = (i, a) => !a?.spicy || a.spicy === 'any' || i.spicy === (a.spicy === 'yes')
const passPortion = (i, a) => !a?.portion?.length || i.portion == null || has(a.portion, i.portion)
const hitPortion = (i, a) => !!a?.portion?.length && has(a.portion, i.portion)

// Picking rules per multi-select question: a cap and an exclusive tile ("Fark etmez" / "Hiçbiri").
export const QUIZ_MULTI = {
  protein: { max: 2, exclusive: 'any' },
  portion: { max: 2, exclusive: null },
  extra:   { max: null, exclusive: 'none' },
}
// -> { next, blocked }: the new selection after tapping `value`. A tapped selected tile is always removed; an exclusive tile
// replaces everything and is replaced by any other pick; a pick over the cap changes nothing and says so.
export function quizToggle(key, current, value) {
  const { max, exclusive } = typeof key === 'string' ? QUIZ_MULTI[key] : key   // a question's own rule object works too
  const cur = current || []
  if (cur.includes(value)) return { next: cur.filter(v => v !== value), blocked: false }
  if (exclusive && value === exclusive) return { next: [value], blocked: false }
  const base = exclusive ? cur.filter(v => v !== exclusive) : cur
  if (max && base.length >= max) return { next: cur, blocked: true }
  return { next: [...base, value], blocked: false }
}

// ── Quiz configs: which dish roles can be suggested, what is asked, how a dish passes. Everything below reads one config. ──
// relax: soft answers in the order they are dropped when nothing matches (hit = the strict form that earns a ranking point);
// base: the hard answers, never relaxed; wanted: one carrier test per picked value, so every pick gets a dish when one exists.
const step = (key, kind, q, opts, extra = {}) => ({ key, kind, q, opts, ...extra })
const S_PROTEIN = step('protein', 'multi', 'eateryQuizQ1', [['chicken', 'eateryQuizChicken', '🍗'], ['beef', 'eateryQuizBeef', '🥩'], ['veg', 'eateryQuizVeg', '🥗'], ['any', 'eateryQuizAny', '🤷']], { rule: QUIZ_MULTI.protein, hint: 'eateryQuizHintMax2' })
const S_SPICY = step('spicy', 'single', 'eateryQuizQ2', [['yes', 'eateryQuizYes', '🌶️'], ['no', 'eateryQuizNo', '😌'], ['any', 'eateryQuizAny', '🤷']])
const S_PORTION = step('portion', 'multi', 'eateryQuizQ3', [['snack', 'eateryQuizSnack'], ['meal', 'eateryQuizMeal'], ['share', 'eateryQuizShare']], { rule: QUIZ_MULTI.portion, hint: 'eateryQuizHintMax2' })
const EXTRA_TILE = { sauce: ['sauce', 'eateryQuizSauce', '🥫'], drink: ['drink', 'eateryQuizDrink', '🥤'], dessert: ['dessert', 'eateryQuizDessert', '🍰'] }
const s_extra = roles => step('extra', 'multi', 'eateryQuizQ4', [...roles.map(r => EXTRA_TILE[r]), ['none', 'eateryQuizNone', '🚫']], { rule: QUIZ_MULTI.extra, hint: 'eateryQuizHintAny' })

const isMain = i => i && i.role === 'main' && filled(i.name) && eateryOrderable(i)
const sideRoleOf = (partner, role) => (partner?.eatery_menu_items || []).some(i => i && i.role === role && i.is_available !== false && filled(i.name))

export const QUIZ_GENERAL = {
  id: 'general',
  roles: ['main'],
  base: passProtein,
  relax: [
    { key: 'portion', asked: a => !!a.portion?.length, pass: passPortion, hit: hitPortion },
    { key: 'spicy', asked: a => !!a.spicy && a.spicy !== 'any', pass: passSpicy, hit: passSpicy },
  ],
  wanted: a => [
    ...(a.protein || []).filter(v => v !== 'any').map(v => c => c.item.protein === v),
    ...(a.portion || []).map(v => c => c.item.portion === v),
  ],
  // Protein and portion always; spicy only when a candidate dish is spicy; the extras question only when a candidate partner has
  // such items, with a tile for each role that exists.
  steps: rows => {
    const cands = quizCandidates(rows)
    const partners = (rows || []).filter(p => (p?.eatery_menu_items || []).some(isMain))
    const roles = QUIZ_EXTRAS.filter(role => partners.some(p => sideRoleOf(p, role)))
    return [S_PROTEIN, ...(cands.some(c => c.item.spicy === true) ? [S_SPICY] : []), S_PORTION, ...(roles.length ? [s_extra(roles)] : [])]
  },
}

// Per-partner quiz, pure data keyed by slug (no DB tags): Bidda asks "Dürüm mü, gatmer mi?" (role main / side), then, unless
// a gatmer, what goes inside (protein tag; Sade = 'none'). Any partner without an entry uses QUIZ_GENERAL over its own rows.
const passFilling = (i, a) => a.form === 'side' || !a.filling?.length || has(a.filling, 'any') || has(a.filling, i.protein)
const passForm = (i, a) => a.form !== 'main' && a.form !== 'side' ? true : i.role === a.form
const BIDDA = {
  id: 'bidda-badadez',
  roles: ['main', 'side'],
  base: (i, a) => passForm(i, a) && passFilling(i, a),
  relax: [],
  wanted: a => (a.form === 'side' ? [] : (a.filling || []).filter(v => v !== 'any').map(v => c => c.item.protein === v)),
  steps: (_rows, a) => [
    step('form', 'single', 'eateryQuizBiddaQ1', [['main', 'eateryQuizBiddaWrap', '🌯'], ['side', 'eateryQuizBiddaGatmer', '🫓'], ['any', 'eateryQuizAny', '🤷']]),
    ...(a?.form === 'side' ? [] : [step('filling', 'multi', 'eateryQuizBiddaQ2', [['beef', 'eateryQuizBiddaKofte', '🥩'], ['chicken', 'eateryQuizBiddaTavuk', '🍗'], ['veg', 'eateryQuizBiddaHellim', '🧀'], ['none', 'eateryQuizBiddaSade', '🥙'], ['any', 'eateryQuizAny', '🤷']], { rule: { max: 2, exclusive: 'any' }, hint: 'eateryQuizHintMax2' })]),
  ],
}
const PARTNER_QUIZ = { 'bidda-badadez': BIDDA }
export const partnerQuizConfig = slug => PARTNER_QUIZ[slug] || QUIZ_GENERAL

// The questions to ask for these rows and the answers so far (a config may drop a question after an answer, so Dots / "n/total" /
// the result gate all read this one list).
export const quizSteps = (cfg, rows, answers) => (cfg || QUIZ_GENERAL).steps(rows, answers)

// Every available, priced, tagged dish of the config's roles for the given partners: [{ item, partner }]. With answers: only those passing them.
export function quizCandidates(rows, answers = null, cfg = QUIZ_GENERAL) {
  const out = []
  for (const partner of rows || []) {
    for (const item of partner?.eatery_menu_items || []) {
      if (!item || !cfg.roles.includes(item.role) || !filled(item.name) || !eateryOrderable(item)) continue
      if (answers && !(cfg.base(item, answers) && cfg.relax.every(k => k.pass(item, answers)))) continue
      out.push({ item, partner })
    }
  }
  return out
}

// The entry card shows exactly when the matcher has something to draw from.
export const quizHasMains = (rows, cfg = QUIZ_GENERAL) => quizCandidates(rows, null, cfg).length > 0

// -> { dishes: [{ item, partner, companions }] (0-3), relaxed: ['portion'|'spicy'], companions: the top dish's }
export function quizMatch(rows, answers, cfg = QUIZ_GENERAL) {
  const asked = cfg.relax.filter(k => k.asked(answers))
  const score = c => asked.reduce((n, k) => n + (k.hit(c.item, answers) ? 1 : 0), 0)

  // Relaxation order: the config's soft answers (general: portion, then spicy); the hard ones (protein) never. A step that drops an answer nobody gave is skipped.
  const all = quizCandidates(rows, null, cfg).filter(c => cfg.base(c.item, answers))
  const stages = [[]]
  const dropped = []
  for (const k of asked) {
    dropped.push(k.key)
    stages.push([...dropped])
  }
  let pool = []
  let relaxed = []
  for (const drop of stages) {
    pool = all.filter(c => cfg.relax.every(k => drop.includes(k.key) || k.pass(c.item, answers)))
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
  for (const carries of cfg.wanted(answers)) {
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
  const lines = basketLines(items, basket)   // one entry per line key: a dish with options is priced with its extras
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

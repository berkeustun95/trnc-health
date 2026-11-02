// "Ne yesem?" dish finder: the pure matcher. Runs the REAL constants/eateryQuiz.js (no stubs).
//   node scripts/test-eatery-quiz.mjs
import * as Q from '../constants/eateryQuiz.js'

let bad = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`}`)
}

let nextId = 1
const dish = (name, o = {}) => ({ id: nextId++, section: 'S', name, price: 700, currency: 'TRY', sort_order: 0, is_available: true, photo_path: null,
  role: 'main', protein: 'chicken', spicy: false, portion: 'meal', ...o })
const partner = (slug, sort, items, o = {}) => ({ id: slug, slug, name: slug, sort_order: sort, eatery_menu_items: items, ...o })
const ANY = { protein: ['any'], spicy: 'any', portion: ['meal'], extra: ['none'] }
const names = r => r.dishes.map(d => d.item.name)

// ── candidates: the entry-card predicate and the matcher share it ──
const bare = partner('preview', 0, [{ id: -1, name: 'Sample', price: 100, is_available: true }])   // fixture: no tags
eq('untagged fixture partner has no candidates', Q.quizCandidates([bare]).length, 0)
eq('entry card hidden without tagged mains', Q.quizHasMains([bare]), false)
eq('a side is not a main', Q.quizHasMains([partner('s', 0, [dish('Fries', { role: 'side' })])]), false)
eq('unavailable main is no candidate', Q.quizHasMains([partner('u', 0, [dish('X', { is_available: false })])]), false)
eq('priceless main is no candidate', Q.quizHasMains([partner('n', 0, [dish('X', { price: null })])]), false)
{
  const mixed = partner('m', 0, [dish('Priced'), dish('Pending', { price: null }), dish('Empty', { price: '' })])
  eq('only the priced main is a candidate', Q.quizCandidates([mixed]).map(c => c.item.name), ['Priced'])
  eq('a NULL-price main is never suggested', names(Q.quizMatch([partner('p2', 0, [dish('Pending', { price: null })])], ANY)), [])
}
eq('entry card shown with one tagged main', Q.quizHasMains([bare, partner('ok', 1, [dish('Burger')])]), true)
eq('fixture partner never appears in results', names(Q.quizMatch([bare], ANY)), [])

// ── selection rules: cap of 2, exclusive tiles ──
const tg = (key, cur, v) => Q.quizToggle(key, cur, v)
eq('protein: pick one', tg('protein', [], 'chicken'), { next: ['chicken'], blocked: false })
eq('protein: pick a second', tg('protein', ['chicken'], 'beef'), { next: ['chicken', 'beef'], blocked: false })
eq('protein: a third is blocked and changes nothing', tg('protein', ['chicken', 'beef'], 'veg'), { next: ['chicken', 'beef'], blocked: true })
eq('protein: tapping a selected tile removes it (even at the cap)', tg('protein', ['chicken', 'beef'], 'beef'), { next: ['chicken'], blocked: false })
eq('protein: Fark etmez clears the others', tg('protein', ['chicken', 'beef'], 'any'), { next: ['any'], blocked: false })
eq('protein: another pick clears Fark etmez', tg('protein', ['any'], 'veg'), { next: ['veg'], blocked: false })
eq('protein: Fark etmez is exclusive, not counted toward the cap', tg('protein', ['any'], 'beef').blocked, false)
eq('portion: cap of 2', tg('portion', ['snack', 'meal'], 'share'), { next: ['snack', 'meal'], blocked: true })
eq('portion: no exclusive tile', tg('portion', ['snack'], 'share'), { next: ['snack', 'share'], blocked: false })
eq('extra: any number', tg('extra', ['sauce', 'drink'], 'dessert'), { next: ['sauce', 'drink', 'dessert'], blocked: false })
eq('extra: Hiçbiri is exclusive', tg('extra', ['sauce', 'drink'], 'none'), { next: ['none'], blocked: false })
eq('extra: a pick clears Hiçbiri', tg('extra', ['none'], 'drink'), { next: ['drink'], blocked: false })

// ── protein: OR, pork only via Fark etmez ──
const P = partner('p', 0, [
  dish('Chicken meal', { protein: 'chicken' }), dish('Beef meal', { protein: 'beef' }), dish('Pork meal', { protein: 'pork' }),
  dish('Veg meal', { protein: 'veg' }), dish('Untagged protein', { protein: null }),
])
const nm = a => names(Q.quizMatch([P], { ...ANY, ...a })).sort()
eq('Tavuk = chicken only', nm({ protein: ['chicken'] }), ['Chicken meal'])
eq('Et = beef only, never pork', nm({ protein: ['beef'] }), ['Beef meal'])
eq('Vejetaryen = veg only', nm({ protein: ['veg'] }), ['Veg meal'])
eq('Et + Tavuk = OR, still no pork', nm({ protein: ['beef', 'chicken'] }), ['Beef meal', 'Chicken meal'])
eq('Tavuk + Vejetaryen = OR', nm({ protein: ['chicken', 'veg'] }), ['Chicken meal', 'Veg meal'])
eq('Fark etmez includes pork (first 3 by id)', nm({ protein: ['any'] }), ['Beef meal', 'Chicken meal', 'Pork meal'])
eq('Fark etmez: all five are candidates', Q.quizCandidates([P]).length, 5)

// ── spicy and portion ──
const S = partner('sp', 0, [
  dish('Hot', { spicy: true }), dish('Mild', { spicy: false }), dish('Unknown', { spicy: null }),
  dish('Snack', { portion: 'snack', spicy: false }), dish('Share', { portion: 'share', spicy: false }),
])
const sm = a => names(Q.quizMatch([S], { ...ANY, ...a })).sort()
eq('Acı = spicy true only', sm({ spicy: 'yes' }), ['Hot'])
eq('Acısız = spicy false only (null is not "no")', sm({ spicy: 'no' }), ['Mild'])
eq('portion filter', sm({ portion: ['snack'] }), ['Snack'])
eq('two portions = OR', sm({ portion: ['snack', 'share'] }), ['Share', 'Snack'])

// ── relaxation: portion, then spicy; never protein ──
const R = partner('r', 0, [
  dish('Cheap snack', { price: 100, portion: 'snack', spicy: false }), dish('Mid meal', { price: 500, portion: 'meal', spicy: false }),
  dish('Hot share', { price: 700, portion: 'share', spicy: true }),
])
const r0 = Q.quizMatch([R], { ...ANY, portion: ['meal'] })
eq('exact match: nothing relaxed', [names(r0), r0.relaxed], [['Mid meal'], []])
const r1 = Q.quizMatch([R], { ...ANY, portion: ['meal'], spicy: 'yes' })
eq('0 hits -> relax portion first', [r1.relaxed, names(r1)], [['portion'], ['Hot share']])
const r2 = Q.quizMatch([partner('q', 0, [dish('Plain', { spicy: false, portion: 'meal' })])], { ...ANY, spicy: 'yes', portion: ['snack'] })
eq('both relaxed when nothing else works', r2.relaxed, ['portion', 'spicy'])
eq('an "any" spicy is never reported as relaxed', Q.quizMatch([R], { ...ANY, portion: ['share', 'snack'], protein: ['beef'] }).relaxed, [])
eq('protein is never relaxed: no beef anywhere -> empty', Q.quizMatch([R], { ...ANY, protein: ['beef'] }).dishes.length, 0)
eq('no budget question any more', typeof Q.quizBudgetBands, 'undefined')

// ── ranking, photos, spread ──
const K = partner('k', 0, [dish('No photo', { sort_order: 0 }), dish('With photo', { sort_order: 5, photo_path: 'k/d.jpg' })])
eq('photo outranks sort_order', names(Q.quizMatch([K], ANY))[0], 'With photo')
const O = partner('o1', 1, [dish('Late partner', { sort_order: 0 })])
const O2 = partner('o2', 0, [dish('Early partner', { sort_order: 9 })])
eq('partner sort_order before item sort_order', names(Q.quizMatch([O, O2], ANY)), ['Early partner', 'Late partner'])
const soft = partner('m', 0, [dish('Share one', { portion: 'share', sort_order: 0 }), dish('Meal one', { portion: 'meal', sort_order: 1 })])
eq('more matched soft answers rank first (relaxed stage)', names(Q.quizMatch([soft], { ...ANY, spicy: 'yes', portion: ['meal'] }))[0], 'Meal one')
const big = partner('big', 0, ['A', 'B', 'C', 'D'].map((n, i) => dish(n, { sort_order: i })))
const small = partner('small', 1, [dish('E')])
eq('max 2 per partner when several partners', names(Q.quizMatch([big, small], ANY)), ['A', 'B', 'E'])
eq('one partner only: up to 3', names(Q.quizMatch([big], ANY)), ['A', 'B', 'C'])
eq('deterministic: same input, same output', JSON.stringify(Q.quizMatch([big, small], ANY)), JSON.stringify(Q.quizMatch([big, small], ANY)))

// ── menu order and coverage (device pass 2026-10-21: three Nachos, no beef, no "Doyurucu") ──
const M = partner('menu', 0, [
  ...[1, 2, 3].map(n => dish('Nachos ' + n, { section_order: 0, sort_order: n, protein: 'chicken', portion: 'share', spicy: true })),
  dish('Chicken Burger', { section_order: 1, sort_order: 5, protein: 'chicken', portion: 'meal', spicy: true }),
  dish('Beef Smash', { section_order: 1, sort_order: 6, protein: 'beef', portion: 'meal', spicy: true }),
])
const both = Q.quizMatch([M], { protein: ['chicken', 'beef'], spicy: 'yes', portion: ['meal', 'share'], extra: ['none'] })
const got = both.dishes.map(d => d.item)
eq('Tavuk+Et / acı / Doyurucu+Paylaşmalık covers beef, meal and share', [got.some(i => i.protein === 'beef'), got.some(i => i.portion === 'meal'), got.some(i => i.portion === 'share')], [true, true, true])
eq('...and fills the rest in menu order', both.dishes.map(d => d.item.name), ['Nachos 1', 'Nachos 2', 'Beef Smash'])
eq('single pick keeps menu order (section_order before item sort_order)', names(Q.quizMatch([M], { protein: ['chicken'], spicy: 'any', portion: ['meal', 'share'], extra: ['none'] })).length, 3)
eq('single pick, one portion: menu order', names(Q.quizMatch([M], { protein: ['any'], spicy: 'any', portion: ['share'], extra: ['none'] })), ['Nachos 1', 'Nachos 2', 'Nachos 3'])
eq('coverage never breaks the partner cap', names(Q.quizMatch([M, partner('o', 1, [dish('Other', { protein: 'veg', portion: 'meal', section_order: 0 })])], { protein: ['any'], spicy: 'any', portion: ['share', 'meal'], extra: ['none'] })).length, 3)

// ── companions: one per chosen role, from the top dish's partner ──
const C = partner('c', 0, [
  dish('Burger'), dish('Hot sauce', { role: 'sauce', spicy: true, sort_order: 0, price: 65 }), dish('Ranch', { role: 'sauce', spicy: false, sort_order: 1, price: 65 }),
  dish('Cola', { role: 'drink', sort_order: 3 }), dish('Water', { role: 'drink', sort_order: 2 }),
])
const comp = a => Q.quizMatch([C], { ...ANY, ...a }).companions.map(c => c.item.name)
eq('sauce: first by sort_order', comp({ extra: ['sauce'] }), ['Hot sauce'])
eq('sauce with Acısız: a non-spicy one first', comp({ extra: ['sauce'], spicy: 'no' }), ['Ranch'])
eq('drink: first by sort_order', comp({ extra: ['drink'] }), ['Water'])
eq('several extras: one line per chosen role, fixed order', comp({ extra: ['drink', 'sauce', 'dessert'] }), ['Hot sauce', 'Water'])
eq('no dessert at that partner -> none', comp({ extra: ['dessert'] }), [])
eq('Hiçbiri -> none', comp({ extra: ['none'] }), [])
const other = partner('z', 1, [dish('Z drink', { role: 'drink' })])
const compOf = (rows, a) => Q.quizMatch(rows, { ...ANY, ...a }).dishes.map(d => d.companions.map(c => c.item.name))
eq('companions never cross partners', Q.quizMatch([C, other], { ...ANY, extra: ['drink'] }).companions[0].partner.slug, 'c')

eq('sides per card: each dish gets its own partner\'s side', compOf([C, partner('y', 1, [dish('Y burger', { protein: 'beef' }), dish('Y drink', { role: 'drink' })])], { extra: ['drink'], protein: ['any'] }).map(l => l.length), [1, 1])
eq('sides per card: names come from that dish\'s partner', compOf([C, partner('y', 1, [dish('Y burger', { protein: 'beef' }), dish('Y drink', { role: 'drink' })])], { extra: ['drink'], protein: ['any'] }).flat().sort(), ['Water', 'Y drink'])
eq('Hiçbiri: no sides on any card', compOf([C, other], { extra: ['none'] }).every(l => l.length === 0), true)
eq('top-level companions = the top dish\'s', Q.quizMatch([C], { ...ANY, extra: ['drink'] }).companions.map(c => c.item.name), ['Water'])

// ── scoped to one partner (the quiz opened from that partner's own page: rows = [that partner]) ──
{
  const A = partner('a', 0, [dish('A burger'), dish('A sauce', { role: 'sauce', price: 30 })])
  const Z = partner('z2', 1, [dish('Z burger'), dish('Z sauce', { role: 'sauce', price: 30 })])
  const sc = Q.quizMatch([Z], { ...ANY, protein: ['any'], extra: ['sauce'] })
  eq('scoped: only this partner\'s dishes', sc.dishes.map(d => d.item.name), ['Z burger'])
  eq('scoped: only this partner\'s sides', sc.dishes.flatMap(d => d.companions.map(c => c.item.name)), ['Z sauce'])
  eq('scoped: a partner without tagged mains has no quiz', [Q.quizHasMains([partner('e', 0, [dish('Fries', { role: 'side' })])]), Q.quizHasMains([A])], [false, true])
  eq('scoped: protein never relaxes (no beef, no result)', Q.quizMatch([A], { ...ANY, portion: ['share'], protein: ['beef'] }).dishes.length, 0)
  eq('scoped: relaxing the portion keeps a lone dish', Q.quizMatch([A], { ...ANY, protein: ['chicken'], portion: ['share'], spicy: 'any' }).dishes.map(d => d.item.name), ['A burger'])
}

// ── results basket: side orderability, summary, which partner the bar shows ──
{
  const main = dish('Burger', { price: 620 })
  const sauce = dish('Sos', { role: 'sauce', price: 40 })
  const drink = dish('Ayran', { role: 'drink', price: 60 })
  const free = dish('Sos bedava', { role: 'sauce', price: null })
  const off = dish('Kola', { role: 'drink', is_available: false })
  const P = partner('crunchy', 0, [main, sauce, drink, free, off])
  eq('side orderable: priced + available', [sauce, free, off].map(Q.quizSideOrderable), [true, false, false])
  eq('summary: count and total of the partner basket', Q.quizBasketSummary(P, { [main.id]: 2, [sauce.id]: 1, [free.id]: 3, [off.id]: 1 }), { count: 3, total: 1280, currency: 'TRY' })
  eq('summary: empty basket', Q.quizBasketSummary(P, {}).count, 0)
  const ex = { id: 71, kind: 'extra', label_i18n: {}, message_tr: 'peynir', price: 30, max_qty: 2, sort_order: 0, is_available: true }
  const rm = { id: 72, kind: 'remove', label_i18n: {}, message_tr: 'turşusuz', price: null, max_qty: 1, sort_order: 1, is_available: true }
  const opt = dish('Opsiyonlu', { price: 100, eatery_item_options: [ex, rm] })
  const PO = partner('opt', 2, [opt])
  eq('summary: lines with options are priced with their extras, a removal is free, one dish across lines', Q.quizBasketSummary(PO, { [opt.id]: 1, [`${opt.id}|71x2`]: 1, [`${opt.id}|72`]: 2 }),
    { count: 4, total: 100 + 160 + 200, currency: 'TRY' })
  eq('summary: a line whose option vanished is still counted, at the base price', Q.quizBasketSummary(PO, { [`${opt.id}|99`]: 1 }).total, 100)
  const Q2 = partner('other', 1, [dish('Kebap', { price: 100 })])
  const one = pp => (pp === P ? { count: 1 } : { count: 2 })
  eq('bar: the partner last added to wins', Q.quizBarPartner([P, Q2], one, 'other').slug, 'other')
  eq('bar: last partner emptied -> another with items', Q.quizBarPartner([P, Q2], pp => (pp === P ? { count: 1 } : { count: 0 }), 'other').slug, 'crunchy')
  eq('bar: nobody has items -> none', Q.quizBarPartner([P, Q2], () => ({ count: 0 }), 'other'), null)
}

// ── byte-identity: for the pre-Bidda fixtures (no protein 'none', no null portion) the matcher answers exactly as before ──
// The hash is sha256 of JSON.stringify(quizMatch(...)) over 3000 cases, computed ONCE from origin/main's eateryQuiz.js (2026-10-30)
// before the config refactor; a deliberate matcher change regenerates it, anything else must not move it.
{
  const { createHash } = await import('node:crypto')
  // Byte-identity matrix: the pre-Bidda matcher's output over fixtures x answers, hashed (see the baseline constant).
  const matrixRows = () => {
    let id = 1
    const d = (name, o = {}) => ({ id: id++, section: 'S', name, price: 700, currency: 'TRY', sort_order: 0, is_available: true, photo_path: null, role: 'main', protein: 'chicken', spicy: false, portion: 'meal', ...o })
    const p = (slug, sort, items) => ({ id: slug, slug, name: slug, sort_order: sort, eatery_menu_items: items })
    const crunchy = p('crunchy', 0, [
      d('Nachos 1', { section_order: 0, sort_order: 1, portion: 'share', spicy: true }), d('Nachos 2', { section_order: 0, sort_order: 2, portion: 'share', spicy: true }),
      d('Chicken Burger', { section_order: 1, sort_order: 5, spicy: true }), d('Beef Smash', { section_order: 1, sort_order: 6, protein: 'beef', spicy: true, photo_path: 'c/b.jpg' }),
      d('Pork Bacon', { section_order: 1, sort_order: 7, protein: 'pork', spicy: false }), d('Veggie', { section_order: 2, sort_order: 1, protein: 'veg', portion: 'snack' }),
      d('Wings', { section_order: 2, sort_order: 2, portion: 'snack', spicy: null }), d('Mystery', { section_order: 3, protein: null, portion: 'share', spicy: false }),
      d('Hot sauce', { role: 'sauce', spicy: true, sort_order: 0, price: 65 }), d('Ranch', { role: 'sauce', sort_order: 1, price: 65 }),
      d('Cola', { role: 'drink', sort_order: 3 }), d('Water', { role: 'drink', sort_order: 2 }), d('Brownie', { role: 'dessert', sort_order: 1 }),
      d('Free', { price: null }), d('Off', { is_available: false }),
    ])
    const other = p('other', 1, [d('O burger', { protein: 'beef', portion: 'share', spicy: true, section_order: 0 }), d('O salad', { protein: 'veg', portion: 'snack', section_order: 1 }), d('O drink', { role: 'drink' })])
    return [[crunchy], [other], [crunchy, other], [other, crunchy], [p('fx', 0, [{ id: -1, name: 'Sample', price: 100, is_available: true }]), crunchy]]
  }
  const matrixAnswers = () => {
    const out = []
    for (const protein of [[], ['any'], ['chicken'], ['beef'], ['veg'], ['chicken', 'beef']])
      for (const spicy of [undefined, 'yes', 'no', 'any'])
        for (const portion of [[], ['snack'], ['meal'], ['share'], ['meal', 'share']])
          for (const extra of [[], ['none'], ['sauce'], ['drink', 'dessert'], ['sauce', 'drink', 'dessert']])
            out.push({ protein, spicy, portion, extra })
    return out
  }
  const out = []
  for (const r of matrixRows()) for (const a of matrixAnswers()) out.push(Q.quizMatch(r, a))
  eq('Crunchy-only fixtures: 3000 answers, 2900 with results, sha256 identical to the pre-Bidda matcher', [out.length, out.filter(x => x.dishes.length).length, createHash('sha256').update(JSON.stringify(out)).digest('hex')],
    [3000, 2900, 'eb4dc02b6e6744bde9bc094b1dad39493f174c21a8559e8babb91296dea17f8c'])
}

// ── Bidda (phone partner: Dürümler = role main / portion meal; Sac Gatmeri = role side, protein none, portion NULL) ──
{
  const wrap = (name, protein, so) => dish(name, { section: 'Dürümler', section_order: 0, sort_order: so, protein, portion: 'meal', spicy: null, role: 'main', price: 200 })
  const gat = (name, so) => dish(name, { section: 'Sac Gatmeri', section_order: 1, sort_order: so, protein: 'none', portion: null, spicy: null, role: 'side', price: 150 })
  const B = partner('bidda-badadez', 5, [wrap('Sade', 'none', 0), wrap('Hellim', 'veg', 1), wrap('Şiş Köfte', 'beef', 2), wrap('Tavuk Köfte', 'chicken', 3), wrap('Special', 'beef', 4), gat('Gatmer 1', 0), gat('Gatmer 2', 1)])
  const crunchy = partner('crunchy-express', 0, [
    dish('Crunchy Burger', { protein: 'chicken', spicy: true }), dish('Beef Smash', { protein: 'beef', spicy: true }),
    dish('Hot sauce', { role: 'sauce', price: 65 }), dish('Cola', { role: 'drink' }), dish('Brownie', { role: 'dessert' }),
  ])
  const keys = (cfg, rows, a = {}) => Q.quizSteps(cfg, rows, a).map(st => st.key)
  const bidda = Q.partnerQuizConfig('bidda-badadez')

  // general quiz over every readable partner
  eq('general: Bidda wraps are candidates; gatmers (role side) are not', Q.quizCandidates([B]).map(c => c.item.name), ['Sade', 'Hellim', 'Şiş Köfte', 'Tavuk Köfte', 'Special'])
  eq('general: Tavuk finds Bidda\'s Tavuk Köfte next to Crunchy\'s chicken', names(Q.quizMatch([crunchy, B], { ...ANY, protein: ['chicken'] })), ['Crunchy Burger', 'Tavuk Köfte'])
  eq('general: Vejetaryen also takes the meatless protein-none Sade (and Hellim)', names(Q.quizMatch([B], { ...ANY, protein: ['veg'] })).sort(), ['Hellim', 'Sade'])
  eq('general: Et = beef only (Sade, protein none, is not beef)', names(Q.quizMatch([B], { ...ANY, protein: ['beef'] })).sort(), ['Special', 'Şiş Köfte'])
  eq('general: Fark etmez keeps Sade', names(Q.quizMatch([B], { ...ANY, protein: ['any'] })).includes('Sade'), true)
  eq('general: Vejetaryen alone never brings back pork or beef', names(Q.quizMatch([P], { ...ANY, protein: ['veg'] })), ['Veg meal'])

  // a dish with no portion is never excluded by a portion answer, and scores no portion bonus
  {
    const NP = partner('np', 0, [dish('No portion', { portion: null, sort_order: 0 }), dish('Snack one', { portion: 'snack', sort_order: 1 }), dish('Meal one', { portion: 'meal', sort_order: 2 })])
    const r = Q.quizMatch([NP], { ...ANY, portion: ['snack'] })
    eq('null portion: kept by a portion answer, ranked after the dish that matches it, nothing relaxed', [names(r), r.relaxed], [['Snack one', 'No portion'], []])
    eq('null portion: never requested as a coverage value, still a candidate with no answer', names(Q.quizMatch([NP], { ...ANY, portion: [] })).length, 3)
  }

  // the questions asked (general): spicy / extras only when something can answer them
  eq('steps: Crunchy-like partner keeps all four questions, tiles for the roles it has', [keys(Q.QUIZ_GENERAL, [crunchy]), Q.quizSteps(Q.QUIZ_GENERAL, [crunchy])[3].opts.map(o => o[0])], [['protein', 'spicy', 'portion', 'extra'], ['sauce', 'drink', 'dessert', 'none']])
  eq('steps: no spicy dish -> no spicy question; Bidda alone has no sides -> no extras question', keys(Q.QUIZ_GENERAL, [B]), ['protein', 'portion'])
  eq('steps: only the roles that exist get a tile (no dessert -> sauce, drink, none)', Q.quizSteps(Q.QUIZ_GENERAL, [partner('nd', 0, [dish('X', { spicy: true }), dish('S', { role: 'sauce' }), dish('D', { role: 'drink' })])])[3].opts.map(o => o[0]), ['sauce', 'drink', 'none'])
  eq('steps: a side at a partner with no candidate main does not open the extras question', keys(Q.QUIZ_GENERAL, [B, partner('drinks-only', 1, [dish('Cola', { role: 'drink' })])]), ['protein', 'portion'])
  eq('steps: Crunchy + Bidda together = Crunchy\'s four', keys(Q.QUIZ_GENERAL, [crunchy, B]), ['protein', 'spicy', 'portion', 'extra'])
  eq('steps: no tagged mains -> protein and portion only (the entry card is hidden anyway)', keys(Q.QUIZ_GENERAL, []), ['protein', 'portion'])
  eq('steps: a skipped spicy leaves its answer unset, so it never filters', names(Q.quizMatch([B], { protein: ['any'], portion: [], extra: [] })).length, 3)

  // the partner quiz
  eq('config: only bidda-badadez has its own; every other slug (and none) is the general set', [bidda.id, Q.partnerQuizConfig('crunchy-express') === Q.QUIZ_GENERAL, Q.partnerQuizConfig(undefined) === Q.QUIZ_GENERAL], ['bidda-badadez', true, true])
  eq('Crunchy\'s own scoped quiz keeps all four questions', keys(Q.partnerQuizConfig('crunchy-express'), [crunchy]), ['protein', 'spicy', 'portion', 'extra'])
  eq('Bidda steps: form, then filling', keys(bidda, [B], {}), ['form', 'filling'])
  eq('Bidda steps: Gatmer drops the filling question', keys(bidda, [B], { form: 'side' }), ['form'])
  eq('Bidda steps: Dürüm / Fark etmez keep it', [keys(bidda, [B], { form: 'main' }), keys(bidda, [B], { form: 'any' })], [['form', 'filling'], ['form', 'filling']])
  const bm = a => names(Q.quizMatch([B], a, bidda)).sort()
  eq('Bidda: Dürüm + Köfte = the two beef wraps', bm({ form: 'main', filling: ['beef'] }), ['Special', 'Şiş Köfte'])
  eq('Bidda: Dürüm + Tavuk köfte + Hellim = OR', bm({ form: 'main', filling: ['chicken', 'veg'] }), ['Hellim', 'Tavuk Köfte'])
  eq('Bidda: Dürüm + Sade = the plain wrap only (no gatmer)', bm({ form: 'main', filling: ['none'] }), ['Sade'])
  eq('Bidda: Gatmer = both gatmers, no portion or protein required (and a stale filling is ignored)', [bm({ form: 'side' }), bm({ form: 'side', filling: ['beef'] })], [['Gatmer 1', 'Gatmer 2'], ['Gatmer 1', 'Gatmer 2']])
  eq('Bidda: Fark etmez + Sade brings the plain wrap and the gatmers (all protein none)', bm({ form: 'any', filling: ['none'] }), ['Gatmer 1', 'Gatmer 2', 'Sade'])
  eq('Bidda: Fark etmez + Köfte = beef wraps only (a gatmer has no protein)', bm({ form: 'any', filling: ['beef'] }), ['Special', 'Şiş Köfte'])
  eq('Bidda: Dürüm + Fark etmez = the first three wraps, menu order', names(Q.quizMatch([B], { form: 'main', filling: ['any'] }, bidda)), ['Sade', 'Hellim', 'Şiş Köfte'])
  eq('Bidda: coverage gives each picked filling a dish', bm({ form: 'main', filling: ['chicken', 'beef'] }).includes('Tavuk Köfte'), true)
  eq('Bidda: unanswered = everything of both roles passes (3 max)', names(Q.quizMatch([B], {}, bidda)).length, 3)
  eq('Bidda: results are never relaxed and never suggest sides', (r => [r.relaxed, r.companions])(Q.quizMatch([B], { form: 'main', filling: ['beef'] }, bidda)), [[], []])
  eq('Bidda: a priceless or unavailable dish is still no candidate', Q.quizCandidates([partner('b2', 0, [gat('G', 0), { ...gat('H', 1), price: null }, { ...wrap('W', 'beef', 2), is_available: false }])], null, bidda).map(c => c.item.name), ['G'])
  eq('Bidda entry gate: the partner quiz shows when it has candidates', [Q.quizHasMains([B], bidda), Q.quizHasMains([partner('empty', 0, [])], bidda)], [true, false])

  // quizToggle accepts a rule object (Bidda's filling question)
  const rule = { max: 2, exclusive: 'any' }
  eq('toggle with a rule object: cap of 2, Fark etmez exclusive', [Q.quizToggle(rule, ['beef', 'chicken'], 'veg'), Q.quizToggle(rule, ['beef'], 'any'), Q.quizToggle(rule, ['any'], 'none')], [{ next: ['beef', 'chicken'], blocked: true }, { next: ['any'], blocked: false }, { next: ['none'], blocked: false }])
}

// ── static guard: the partner page scopes the quiz in the SCREEN, which the matcher tests cannot see ──
{
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../screens/EateryPartnerScreen.js', import.meta.url), 'utf8')
  const has = re => re.test(src)
  eq('screen: quizRows is exactly [partner]', has(/const quizRows = useMemo\(\(\) => \[partner\], \[partner\]\)/), true)
  eq('screen: QuizPage gets rows={quizRows} and scoped', has(/<QuizPage[^>]*rows=\{quizRows\}[^>]*\bscoped\b/), true)
  eq('screen: banner only when not placeholder and quizHasMains([partner])', has(/const showQuizBanner = !partner\.placeholder && quizHasMains\(\[partner\]\)/), true)
  eq('screen: banner rendered behind showQuizBanner', has(/\{showQuizBanner && <PartnerQuizBanner/), true)
  eq('screen: tabsIndex counts the banner', has(/const tabsIndex = 1 \+ \(showQuizBanner \? 1 : 0\) \+ \(gallery\.length > 0 \? 1 : 0\)/), true)
}

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1) }
console.log('\nquiz: all passed')

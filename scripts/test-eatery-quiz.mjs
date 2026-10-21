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
const ANY = { protein: 'any', spicy: 'any', portion: 'meal', budget: 'any', extra: 'none' }
const names = r => r.dishes.map(d => d.item.name)

// ── candidates: the entry-card predicate and the matcher share it ──
const bare = partner('preview', 0, [{ id: -1, name: 'Sample', price: 100, is_available: true }])   // fixture: no tags
eq('untagged fixture partner has no candidates', Q.quizCandidates([bare]).length, 0)
eq('entry card hidden without tagged mains', Q.quizHasMains([bare]), false)
const side = partner('s', 0, [dish('Fries', { role: 'side' })])
eq('a side is not a main', Q.quizHasMains([side]), false)
eq('unavailable main is no candidate', Q.quizHasMains([partner('u', 0, [dish('X', { is_available: false })])]), false)
eq('priceless main is no candidate', Q.quizHasMains([partner('n', 0, [dish('X', { price: null })])]), false)
eq('entry card shown with one tagged main', Q.quizHasMains([bare, partner('ok', 1, [dish('Burger')])]), true)
eq('fixture partner never appears in results', names(Q.quizMatch([bare], ANY)), [])

// ── protein: pork only under Fark etmez ──
const P = partner('p', 0, [
  dish('Chicken meal', { protein: 'chicken' }), dish('Beef meal', { protein: 'beef' }), dish('Pork meal', { protein: 'pork' }),
  dish('Veg meal', { protein: 'veg' }), dish('Untagged protein', { protein: null }),
])
const nm = a => names(Q.quizMatch([P], { ...ANY, ...a })).sort()
eq('Tavuk = chicken only', nm({ protein: 'chicken' }), ['Chicken meal'])
eq('Et = beef only, never pork', nm({ protein: 'beef' }), ['Beef meal'])
eq('Vejetaryen = veg only', nm({ protein: 'veg' }), ['Veg meal'])
eq('Fark etmez includes pork (and untagged protein)', nm({ protein: 'any' }), ['Beef meal', 'Chicken meal', 'Pork meal'])   // max 3 results
eq('Fark etmez: all five are candidates', Q.quizCandidates([P]).length, 5)

// ── spicy and portion ──
const S = partner('sp', 0, [
  dish('Hot', { spicy: true }), dish('Mild', { spicy: false }), dish('Unknown', { spicy: null }),
  dish('Snack', { portion: 'snack', spicy: false }), dish('Share', { portion: 'share', spicy: false }),
])
const sm = a => names(Q.quizMatch([S], { ...ANY, ...a })).sort()
eq('Acı Evet = spicy true only', sm({ spicy: 'yes' }), ['Hot'])
eq('Acı Hayır = spicy false only (null is not "no")', sm({ spicy: 'no' }), ['Mild'])
eq('portion filter', sm({ portion: 'snack' }), ['Snack'])
eq('portion share', sm({ portion: 'share' }), ['Share'])

// ── budget bands: terciles of the candidates after Q1-Q3 ──
const prices = [100, 200, 300, 400, 500, 600]
const B = partner('b', 0, prices.map(p => dish('D' + p, { price: p })))
const bands = Q.quizBudgetBands(Q.quizCandidates([B]))
eq('six prices -> three bands, cuts 200 / 400', bands.map(b => [b.key, b.min ?? null, b.max ?? null, b.count]), [['low', null, 200, 2], ['mid', 200, 400, 2], ['high', 400, null, 2]])
eq('every dish lands in exactly one band', bands.reduce((n, b) => n + b.count, 0), 6)
eq('one candidate -> no bands (Fark etmez only)', Q.quizBudgetBands(Q.quizCandidates([partner('o', 0, [dish('A')])])).length, 0)
eq('all one price -> no bands', Q.quizBudgetBands(Q.quizCandidates([partner('o', 0, [dish('A'), dish('B'), dish('C')])])).length, 0)
eq('two distinct prices -> two bands', Q.quizBudgetBands(Q.quizCandidates([partner('o', 0, [dish('A', { price: 100 }), dish('B', { price: 200 })])])).map(b => b.key), ['low', 'mid'])
eq('budget low picks the cheap ones', names(Q.quizMatch([B], { ...ANY, budget: 'low' })).sort(), ['D100', 'D200'])
eq('budget high picks the dear ones', names(Q.quizMatch([B], { ...ANY, budget: 'high' })).sort(), ['D500', 'D600'])
eq('bands honour Q1-Q3 (spicy filter first)', Q.quizBudgetBands(Q.quizCandidates([partner('x', 0, [dish('A', { price: 100, spicy: true }), dish('B', { price: 900, spicy: false })])], { ...ANY, spicy: 'no' })).length, 0)

// ── relaxation: budget, then portion, then spicy; never protein ──
const R = partner('r', 0, [
  dish('Cheap snack', { price: 100, portion: 'snack', spicy: false }), dish('Mid meal', { price: 500, portion: 'meal', spicy: false }),
  dish('Dear meal', { price: 900, portion: 'meal', spicy: false }), dish('Hot share', { price: 700, portion: 'share', spicy: true }),
])
const r0 = Q.quizMatch([R], { ...ANY, portion: 'meal', budget: 'low' })
eq('exact match: nothing relaxed', [names(r0), r0.relaxed], [['Mid meal'], []])
const r1 = Q.quizMatch([R], { ...ANY, portion: 'snack', spicy: 'yes', budget: 'mid' })
eq('0 hits -> relax budget first, then portion', [r1.relaxed, names(r1)], [['budget', 'portion'], ['Hot share']])
eq('all three relaxed when nothing else works', Q.quizMatch([partner('q', 0, [dish('Plain', { spicy: false, portion: 'meal' })])], { ...ANY, spicy: 'yes', portion: 'snack', budget: 'any' }).relaxed, ['portion', 'spicy'])
const r2 = Q.quizMatch([R], { ...ANY, protein: 'chicken', portion: 'meal', spicy: 'no', budget: 'high' })
eq('budget relaxed first, the rest kept', [r2.relaxed, names(r2).sort()], [['budget'], ['Dear meal', 'Mid meal']])
eq('an "any" answer is never reported as relaxed', Q.quizMatch([R], { ...ANY, portion: 'snack', spicy: 'yes', budget: 'any' }).relaxed, ['portion'])
eq('protein is never relaxed: no beef anywhere -> empty', Q.quizMatch([R], { ...ANY, protein: 'beef' }).dishes.length, 0)

// ── ranking, photos, spread ──
const K = partner('k', 0, [dish('No photo', { sort_order: 0 }), dish('With photo', { sort_order: 5, photo_path: 'k/d.jpg' })])
eq('photo outranks sort_order', names(Q.quizMatch([K], ANY))[0], 'With photo')
const O = partner('o1', 1, [dish('Late partner', { sort_order: 0 })])
const O2 = partner('o2', 0, [dish('Early partner', { sort_order: 9 })])
eq('partner sort_order before item sort_order', names(Q.quizMatch([O, O2], ANY)), ['Early partner', 'Late partner'])
const soft = partner('m', 0, [dish('Share one', { portion: 'share', sort_order: 0 }), dish('Meal one', { portion: 'meal', sort_order: 1 })])
eq('more matched soft answers rank first (spicy+portion relaxed, portion still matches one)', names(Q.quizMatch([soft], { ...ANY, spicy: 'yes', portion: 'meal' }))[0], 'Meal one')
const big = partner('big', 0, ['A', 'B', 'C', 'D'].map((n, i) => dish(n, { sort_order: i })))
const small = partner('small', 1, [dish('E')])
eq('max 2 per partner when several partners', names(Q.quizMatch([big, small], ANY)), ['A', 'B', 'E'])
eq('one partner only: up to 3', names(Q.quizMatch([big], ANY)), ['A', 'B', 'C'])
eq('deterministic: same input, same output', JSON.stringify(Q.quizMatch([big, small], ANY)), JSON.stringify(Q.quizMatch([big, small], ANY)))

// ── companion: from the top dish's partner ──
const C = partner('c', 0, [
  dish('Burger'), dish('Hot sauce', { role: 'sauce', spicy: true, sort_order: 0, price: 65 }), dish('Ranch', { role: 'sauce', spicy: false, sort_order: 1, price: 65 }),
  dish('Cola', { role: 'drink', sort_order: 3 }), dish('Water', { role: 'drink', sort_order: 2 }),
])
const comp = a => Q.quizMatch([C], { ...ANY, ...a }).companion?.item.name ?? null
eq('sauce: first by sort_order', comp({ extra: 'sauce' }), 'Hot sauce')
eq('sauce with Acı Hayır: a non-spicy one first', comp({ extra: 'sauce', spicy: 'no' }), 'Ranch')
eq('drink: first by sort_order', comp({ extra: 'drink' }), 'Water')
eq('no dessert at that partner -> none', comp({ extra: 'dessert' }), null)
eq('Hayır -> none', comp({ extra: 'none' }), null)
const other = partner('z', 1, [dish('Z drink', { role: 'drink' })])
eq('companion never crosses partners', Q.quizMatch([C, other], { ...ANY, extra: 'drink' }).companion.partner.slug, 'c')

// ── label helper ──
eq('amount has no decimals', Q.quizAmount(650, 'TRY', 'Turkish').replace(/\s/g, ' ').includes(','), false)

if (bad) { console.log(`\n${bad} FAILED`); process.exit(1) }
console.log('\nquiz: all passed')

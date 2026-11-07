// Araçlar pure helpers (constants/cars.js), node only:
//   node scripts/test-cars-ui.mjs
// The price filter is the risky part: a wrong bound silently hides or shows cars. It must (1) convert a GBP band
// into each currency at the KKTC mid rate, (2) refuse when any currency cannot convert, and (3) never emit a
// filter for 'all'. Then the layer stack: back must walk list → car → dealer → car one step at a time.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  priceOrFilter, fxComplete, tryPerUnit, carPrice, carContact, waUrl, contactRegion, pushCarsLayer, sortedImages, VEHICLE_COLS, PRICE_BANDS,
} from '../constants/cars.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let bad = 0
const check = (name, ok, got) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${JSON.stringify(got)}`}`) }

const fx = { rates: {
  GBP: { dovizAlis: 54, dovizSatis: 56 },   // mid 55
  EUR: { dovizAlis: 47, dovizSatis: 49 },   // mid 48
  USD: { dovizAlis: 40, dovizSatis: 42 },   // mid 41
} }

check('mid rate', tryPerUnit(fx, 'GBP') === 55 && tryPerUnit(fx, 'TRY') === 1, tryPerUnit(fx, 'GBP'))
check('complete rates', fxComplete(fx) === true)
check('missing EUR -> incomplete', fxComplete({ rates: { GBP: fx.rates.GBP, USD: fx.rates.USD } }) === false)
check('null feed -> incomplete', fxComplete(null) === false)

const sale = priceOrFilter('sale', [5000, 10000], fx)
check('sale band £5k–10k', sale ===
  'and(currency.eq.GBP,price.gte.5000,price.lt.10000),and(currency.eq.TRY,price.gte.275000,price.lt.550000),'
  + 'and(currency.eq.EUR,price.gte.5729.17,price.lt.11458.33),and(currency.eq.USD,price.gte.6707.32,price.lt.13414.63)', sale)
const under = priceOrFilter('sale', [0, 5000], fx)
check('lowest band has no lower bound', !under.includes('gte') && under.includes('price.lt.5000'), under)
const top = priceOrFilter('rent', [60, null], fx)
check('open top band (rent) filters price_per_day, no upper bound', top.includes('price_per_day.gte.60') && !top.includes('.lt.') && !/\bprice\./.test(top), top)
check('every currency gets a clause', sale.split('and(').length - 1 === 4, sale)
check("'all' never filters price", priceOrFilter('all', [5000, 10000], fx) === null)
check('incomplete rates never filter', priceOrFilter('sale', [5000, 10000], { rates: { GBP: fx.rates.GBP } }) === null)
check('no band no filter', priceOrFilter('sale', null, fx) === null)
check('bands are contiguous', Object.values(PRICE_BANDS).every(b => b.every((x, i) => i === 0 ? x[0] === 0 : x[0] === b[i - 1][1]) && b.at(-1)[1] === null))

check('sale price shows its own currency', carPrice({ intent: 'sale', price: 12500, currency: 'TRY' }) === '₺12,500')
check('rent price is the daily price', carPrice({ intent: 'rent', price: null, price_per_day: 45, currency: 'GBP' }) === '£45')
check('contact falls back to the dealer', JSON.stringify(carContact({ contact_phone: null, whatsapp: null, dealers: { phone: '+90533', whatsapp: '+90544' } }))
  === JSON.stringify({ phone: '+90533', whatsapp: '+90544' }))
check("listing's own number wins", carContact({ contact_phone: '+1', dealers: { phone: '+2' } }).phone === '+1')
check('wa.me takes digits only', waUrl('+90 533 111-22-33') === 'https://wa.me/905331112233')
check('contact region only a REGIONS slug', contactRegion('kyrenia') === 'kyrenia' && contactRegion('Girne') === null && contactRegion(null) === null)
check('primary photo first', sortedImages([{ id: 1, sort_order: 0 }, { id: 2, sort_order: 5, is_primary: true }])[0].id === 2)

const car = id => ({ kind: 'car', car: { id } }), dealer = id => ({ kind: 'dealer', dealer: { id } })
const ids = st => st.map(l => l.car?.id || l.dealer?.id).join('>')
let st = pushCarsLayer([], car('a'))
st = pushCarsLayer(st, dealer('d'))
st = pushCarsLayer(st, car('b'))
check('list → car → dealer → car stacks', ids(st) === 'a>d>b', ids(st))
check('back pops one layer (car b → dealer)', ids(st.slice(0, -1)) === 'a>d')
check('dealer again pops back to it, no copy', ids(pushCarsLayer(st, dealer('d'))) === 'a>d')
check('same car again pops back to it', ids(pushCarsLayer(st, car('a'))) === 'a')

// The select must never ask for owner_id (no client grant: the whole read fails with 42501), nor '*'.
check('select names columns, no owner_id, no *', !/owner_id|\*/.test(VEHICLE_COLS), VEHICLE_COLS)
for (const f of ['screens/CarsScreen.js', 'screens/DealerScreen.js']) {
  const src = readFileSync(resolve(ROOT, f), 'utf8')
  check(`${f}: no select('*'), no owner_id, orders only by granted columns`,
    !/select\(\s*['"]\*/.test(src) && !src.includes('owner_id') && !/order\('(created_at|updated_at)'/.test(src))
}

console.log(bad ? `cars ui: ${bad} FAILED` : 'cars ui: OK')
process.exit(bad ? 1 : 0)

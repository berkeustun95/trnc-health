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
  normalizePhone, parseAmount, carFormError, carPayload, carForm, myCarState, canRenew, canEdit, daysLeft, openListingCount,
  carErrorKey, carErrorText, photoCleanupReason, rejectionText, MY_VEHICLE_COLS, layerKey,
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
for (const f of ['screens/CarsScreen.js', 'screens/DealerScreen.js', 'screens/CarPostScreen.js', 'screens/MyCarsScreen.js']) {
  const src = readFileSync(resolve(ROOT, f), 'utf8').replace(/\/\/.*$/gm, '')   // code only, not the comments about it
  check(`${f}: no select('*'), no owner_id, orders only by granted columns`,
    !/select\(\s*['"]\*/.test(src) && !src.includes('owner_id') && !/order\('(created_at|updated_at)'/.test(src))
}

// ─── S3: posting, İlanlarım, cleanup ─────────────────────────────────────────
check('local TRNC mobile becomes +90', normalizePhone('0533 812 34 56') === '+905338123456', normalizePhone('0533 812 34 56'))
check('international with spaces and dashes', normalizePhone('+44 7700-900123') === '+447700900123')
check('00 prefix becomes +', normalizePhone('0090 533 812 3456') === '+905338123456')
check('empty is null, letters are false', normalizePhone('  ') === null && normalizePhone('call me') === false)
check('a + in the middle is false', normalizePhone('0533+123456') === false)
check('every normalised number passes the DB CHECK', ['0533 812 34 56', '+44 7700 900123', '00905338123456', '05338123456'].every(p => /^\+?[0-9]{7,15}$/.test(normalizePhone(p))))
check('amounts: grouping is ignored', parseAmount('12,500') === 12500 && parseAmount('12.500') === 12500 && parseAmount('12 500') === 12500)
check('amounts: zero, negative and text are refused', parseAmount('0') === null && parseAmount('-5') === null && parseAmount('abc') === null)

const good = { intent: 'sale', make: 'Toyota', model: 'Corolla', year: '2018', km: '65,000', fuel: 'petrol', gearbox: 'automatic',
  body_type: 'sedan', colour: 'white', steering: 'right', price: '9,500', currency: 'GBP', region: 'kyrenia', area: '', description: '',
  phone: '0533 812 34 56', whatsapp: '' }
check('a complete form has no error', carFormError(good, 1, 2026) === null, carFormError(good, 1, 2026))
check('no photo is refused', carFormError(good, 0, 2026) === 'carsPostErrPhotos')
check('no contact is refused', carFormError({ ...good, phone: '', whatsapp: '' }, 1, 2026) === 'carsPostErrContact')
check('a bad number is refused before the server', carFormError({ ...good, phone: 'abc' }, 1, 2026) === 'carsPostErrPhoneFormat')
check('a year from the future is refused', carFormError({ ...good, year: '2029' }, 1, 2026) === 'carsPostErrYear')
check('next year (new model year) is fine', carFormError({ ...good, year: '2027' }, 1, 2026) === null)
check('missing specs are refused', carFormError({ ...good, fuel: null }, 1, 2026) === 'carsPostErrSpecs')
check('rent over the daily cap is refused', carFormError({ ...good, intent: 'rent', price: '2000000' }, 1, 2026) === 'carsPostErrPrice')

const p = carPayload(good)
check('payload is exactly the 18 granted columns',
  Object.keys(p).sort().join(',') === 'area,body_type,colour,contact_phone,currency,description,fuel,gearbox,intent,km,make,model,price,price_per_day,region,steering,whatsapp,year', Object.keys(p))
check('sale: price set, daily price null', p.price === 9500 && p.price_per_day === null && p.km === 65000 && p.year === 2018)
const pr = carPayload({ ...good, intent: 'rent', price: '45' })
check('rent: daily price set, price null', pr.price === null && pr.price_per_day === 45)
check('empty optional text becomes null, numbers normalised', p.area === null && p.description === null && p.whatsapp === null && p.contact_phone === '+905338123456')
check('edit form round-trips through the payload', JSON.stringify(carPayload(carForm({ ...p, id: 'x', intent: 'sale' }))) === JSON.stringify(p))
check('a new form prefills the profile phone in both fields', carForm(null, '+905338000000').whatsapp === '+905338000000')

const NOW = Date.parse('2026-11-08T12:00:00Z'), day = 864e5, iso = ms => new Date(ms).toISOString()
check('active past expiry reads expired', myCarState({ status: 'active', expires_at: iso(NOW - 1000) }, NOW) === 'expired')
check('hidden wins over active', myCarState({ status: 'active', hidden_at: iso(NOW), expires_at: iso(NOW + day) }, NOW) === 'hidden')
check('removed wins over hidden', myCarState({ status: 'removed', hidden_at: iso(NOW) }, NOW) === 'removed')
check('renew: not on a fresh listing', canRenew({ status: 'active', expires_at: iso(NOW + 20 * day) }, NOW) === false)
check('renew: in the last week', canRenew({ status: 'active', expires_at: iso(NOW + 6 * day) }, NOW) === true)
check('renew: an expired one', canRenew({ status: 'expired', expires_at: iso(NOW - day) }, NOW) === true)
check('renew: never pending / rejected / hidden', [{ status: 'pending' }, { status: 'rejected' }, { status: 'active', hidden_at: iso(NOW), expires_at: iso(NOW + day) }].every(c => !canRenew(c, NOW)))
check('days left rounds up', daysLeft({ expires_at: iso(NOW + 1.2 * day) }, NOW) === 2)
check('edit: not removed, not hidden', !canEdit({ status: 'removed' }, NOW) && !canEdit({ status: 'active', hidden_at: iso(NOW) }, NOW) && canEdit({ status: 'rejected' }, NOW))
check('the cap counts pending + live private only', openListingCount([
  { source: 'private', status: 'pending' }, { source: 'private', status: 'active', expires_at: iso(NOW + day) },
  { source: 'private', status: 'active', expires_at: iso(NOW - day) }, { source: 'private', status: 'rejected' }, { source: 'private', status: 'removed' }], NOW) === 2)
check('server codes map to keys', carErrorKey({ message: 'VEHICLE_LIMIT' }) === 'carsErrLimit' && carErrorKey({ message: 'UNDER_18' }) === 'carsErrUnder18'
  && carErrorKey({ message: 'BLOCKED_TERM' }) === 'contentBlockedTerm' && carErrorKey({ message: 'boom' }) === 'carsErrGeneric' && carErrorKey(null) === 'carsErrGeneric')
check('the limit message names the cap', carErrorText({ message: 'VEHICLE_LIMIT' }, () => 'up to {n}') === 'up to 3')
check('a rejection code is translated, a note is shown as written', rejectionText('photos', k => `<${k}>`) === '<carsRejectPhotos>' && rejectionText('Plate visible in photo 3', k => k) === 'Plate visible in photo 3')

const v = (o) => ({ source: 'private', status: 'active', updated_at: iso(NOW), hidden_at: null, ...o })
check('cleanup: removed after 3 days, not before', photoCleanupReason(v({ status: 'removed', updated_at: iso(NOW - 3 * day) }), NOW) === 'removed'
  && photoCleanupReason(v({ status: 'removed', updated_at: iso(NOW - 2 * day) }), NOW) === null)
check('cleanup: rejected after 14 days (the seller can still fix it before)', photoCleanupReason(v({ status: 'rejected', updated_at: iso(NOW - 14 * day) }), NOW) === 'rejected'
  && photoCleanupReason(v({ status: 'rejected', updated_at: iso(NOW - 13 * day) }), NOW) === null)
check('cleanup: hidden after 30 days (an admin can still restore it before)', photoCleanupReason(v({ hidden_at: iso(NOW - 30 * day) }), NOW) === 'hidden'
  && photoCleanupReason(v({ hidden_at: iso(NOW - 29 * day) }), NOW) === null)
check('cleanup: never expired, active or pending', ['expired', 'active', 'pending'].every(st => photoCleanupReason(v({ status: st, updated_at: iso(NOW - 400 * day) }), NOW) === null))
check('cleanup: never a dealer or imported listing', ['dealer', 'import'].every(src => photoCleanupReason(v({ source: src, status: 'removed', updated_at: iso(NOW - 400 * day) }), NOW) === null))

check('İlanlarım select: no owner_id, no *', !/owner_id|\*/.test(MY_VEHICLE_COLS), MY_VEHICLE_COLS)
check('layer keys: mine is one page, post is per listing', layerKey({ kind: 'mine' }) === 'mine:' && layerKey({ kind: 'post' }) === 'post:new'
  && layerKey({ kind: 'post', car: { id: 'a' } }) === 'post:a' && layerKey({ kind: 'car', car: { id: 'a' } }) === 'car:a')
const st2 = pushCarsLayer(pushCarsLayer([], { kind: 'mine' }), { kind: 'post', car: { id: 'a' } })
check('mine → edit, then mine again pops back to it', pushCarsLayer(st2, { kind: 'mine' }).length === 1)
for (const f of ['screens/CarPostScreen.js', 'screens/MyCarsScreen.js']) {
  const src = readFileSync(resolve(ROOT, f), 'utf8').replace(/\/\/.*$/gm, '')   // code only, not the comments about it
  check(`${f}: never writes status/owner_id/source except the owner moves (pending, removed)`,
    !/owner_id|source:\s*'|status:\s*'(active|rejected|expired)'/.test(src))
}
{
  const admin = readFileSync(resolve(ROOT, 'screens/AdminScreen.js'), 'utf8')
  check("admin: every vehicles read names its columns (select('*') on vehicles 42501s)", !/from\('vehicles'\)\.select\('\*'/.test(admin))
  check("admin: 'vehicle' is in the Reports fetch list and AUTHOR_VIA_RPC", /'message', 'vehicle'\]\) \{/.test(admin) && /AUTHOR_VIA_RPC = new Set\(\['review', 'vehicle'\]\)/.test(admin))
}

// Berke, 2026-11-09 (from the Preview video). A for-sale car never shows "Kiralama şirketi", and the system back on
// İlan ver / İlanı düzenle asks before discarding. A listener of CarPostScreen's own lost to App's, which re-registers
// (and so runs first) whenever one of its deps changes; App's chain must hand the post layer to the form.
{
  const detail = readFileSync(resolve(ROOT, 'screens/CarDetailScreen.js'), 'utf8')
  check('detail: the rental-company label needs a rent listing', /car\.intent === 'rent' && dealer\.is_rental_company \? 'carsRentalCompany'/.test(detail))
  const app = readFileSync(resolve(ROOT, 'App.js'), 'utf8')
  const post = readFileSync(resolve(ROOT, 'screens/CarPostScreen.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '')
  check("App back: the post layer goes to the form's guard, not closeCarsLayer",
    /\.kind === 'post' && carPostBackRef\.current\) carPostBackRef\.current\(\)\s*else closeCarsLayer\(\)/.test(app)
    && /backRef=\{carPostBackRef\}/.test(app))
  check('CarPostScreen: guard registered on backRef, no listener of its own', /backRef\.current = \(\) => leaveRef\.current\(\)/.test(post) && !post.includes('addBackListener'))
  check("CarPostScreen: the prompt is Berke's (message only, Kal / Çık)", post.includes("Alert.alert(t('carsPostDiscardTitle', lang), undefined")
    && post.includes("t('carsPostStay', lang), style: 'cancel'") && post.includes("t('carsPostDiscard', lang), style: 'destructive'"))
  // The picker search box said "İsim veya adrese göre ara…" (by name or address) for colours and makes.
  const list = readFileSync(resolve(ROOT, 'screens/CarsScreen.js'), 'utf8')
  check('Renk / Marka pickers have their own search hint', post.includes("searchPlaceholder={t('carsColourSearch', lang)}")
    && list.includes("searchPlaceholder={t('carsMakeSearch', lang)}")
    && /placeholder=\{searchPlaceholder \?\? t\('searchPlaceholder', lang\)\}/.test(readFileSync(resolve(ROOT, 'components/FilterDropdown.js'), 'utf8')))
  check('the discard check counts added and removed photos', /photos\.some\(p => p\.kind === 'new'\)/.test(post) && /removed\.length > 0/.test(post))
}

console.log(bad ? `cars ui: ${bad} FAILED` : 'cars ui: OK')
process.exit(bad ? 1 : 0)

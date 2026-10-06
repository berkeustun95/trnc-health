// Oteller name search + sort (utils/hotelSearch.js). npm run hotels:search-check
import assert from 'node:assert/strict'
import { foldName, matchesName, sortHotels, HOTEL_SORTS } from '../utils/hotelSearch.js'
import { HOTEL_CLASSES, HOTEL_CLASS_STARS } from '../constants/hotels.js'
import { hotelBookingUrl } from '../utils/hotelBooking.js'

let n = 0
const ok = (cond, msg) => { assert.ok(cond, msg); n++ }

// Turkish tolerance, both directions, and case.
for (const [name, q] of [
  ['Dome Hotel', 'dome'], ['Dome Hotel', 'DOME'], ['Çelebi Hotel', 'celebi'], ['Çelebi Hotel', 'çelebi'],
  ['Celebi Hotel', 'çelebi'], ['Işık Otel', 'isik'], ['İskele Palace', 'iskele'], ['Iskele Palace', 'İSKELE'],
  ['Gönyeli Suites', 'gonyeli'], ['Kıbrıs Şah', 'kibris sah'], ['Güzelyurt Inn', 'GUZELYURT'],
  ['Lord\'s Palace', 'lords'], ['Lord’s Palace', "lord's"], ['Grand Pasha Kyrenia', 'pasha  kyr'],
]) ok(matchesName(name, q), `"${q}" should find "${name}" (fold: "${foldName(name)}" vs "${foldName(q)}")`)
for (const [name, q] of [['Dome Hotel', 'merit'], ['Çelebi Hotel', 'celebx']])
  ok(!matchesName(name, q), `"${q}" must NOT find "${name}"`)
ok(matchesName('Anything', '') && matchesName('Anything', '   '), 'an empty search must match everything')

const hotels = [
  { name: 'Zeta', kitob_class: 'star3' }, { name: 'alfa', kitob_class: 'boutique' },
  { name: 'Çam', kitob_class: 'star5' }, { name: 'Bora', kitob_class: 'star5' },
  { name: 'Apart B', kitob_class: 'apart' }, { name: 'Ada', kitob_class: 'holiday_village' },
  { name: 'Dome', kitob_class: 'star3', hotelrunner_url: 'https://dome-hotel.hotelrunner.com/bv3/search' },
  { name: 'Butik Book', kitob_class: 'boutique', hotelrunner_url: 'https://butik.hotelrunner.com/bv3/search' },
  { name: 'Yedi', kitob_class: 'star5', hotelrunner_url: 'https://yedi.hotelrunner.com/bv3/search' },
]
const opts = { classRank: Object.fromEntries(HOTEL_CLASSES.map((k, i) => [k, i])), stars: HOTEL_CLASS_STARS,
  compare: new Intl.Collator('tr').compare, bookable: hotelBookingUrl }
const names = s => sortHotels(hotels, s, opts).map(h => h.name).join(',')
const expect = {
  // "Rezervasyon Yap" hotels first (star5 → star3 → boutique), then the rest in class order
  // (stars high → low, then boutique, holiday_village, apart), name inside a class.
  recommended: 'Yedi,Dome,Butik Book,Bora,Çam,Zeta,alfa,Ada,Apart B',
  az: 'Ada,alfa,Apart B,Bora,Butik Book,Çam,Dome,Yedi,Zeta',
  za: 'Zeta,Yedi,Dome,Çam,Butik Book,Bora,Apart B,alfa,Ada',
  stars: 'Bora,Çam,Yedi,Dome,Zeta,Ada,alfa,Apart B,Butik Book',   // pure stars high → low, booking ignored; non-star types by name
}
for (const s of HOTEL_SORTS) { assert.equal(names(s), expect[s], `sort ${s}`); n++ }
ok(names('nonsense') === expect.recommended, 'an unknown sort falls back to recommended')
ok(hotels[0].name === 'Zeta', 'sortHotels must not mutate its input')
console.log(`check-hotel-search: ${n} assertions OK`)

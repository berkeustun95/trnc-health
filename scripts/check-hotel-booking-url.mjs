#!/usr/bin/env node
// The HotelRunner link builder (utils/hotelBooking.js), against fixed cases, plus the final URL
// for a FAKE link — the "what does the button open" answer. No network, no database.
//   node scripts/check-hotel-booking-url.mjs
import { withParams, hotelBookingUrl, hotelSlug } from '../utils/hotelBooking.js'

let bad = 0
const t = (label, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : `\n      got  ${got}\n      want ${want}`}`) }
const U = { utm_source: 'ada', utm_medium: 'app', utm_campaign: 'oteller', utm_content: 'x' }
const tail = 'utm_source=ada&utm_medium=app&utm_campaign=oteller&utm_content=x'
t('no query', withParams('https://h.example/p', U), `https://h.example/p?${tail}`)
t('their params kept, in order', withParams('https://h.example/p?checkin=2026-10-10&adults=2', U), `https://h.example/p?checkin=2026-10-10&adults=2&${tail}`)
t('their utm_source replaced by ours', withParams('https://h.example/p?utm_source=hr&a=1', U), `https://h.example/p?a=1&${tail}`)
t('fragment stays last', withParams('https://h.example/p?a=1#rooms', U), `https://h.example/p?a=1&${tail}#rooms`)
t('encoded values kept as they were', withParams('https://h.example/p?q=a%20b&r=%C3%A7', U), `https://h.example/p?q=a%20b&r=%C3%A7&${tail}`)
t('our values are encoded', withParams('https://h.example/p', { utm_content: 'a b&c' }), 'https://h.example/p?utm_content=a%20b%26c')
t('empty params skipped', withParams('https://h.example/p', { a: null, b: '' }), 'https://h.example/p')
t('trailing ? / & tolerated', withParams('https://h.example/p?a=1&', U), `https://h.example/p?a=1&${tail}`)
t('slug drops kitob-', hotelSlug({ external_id: 'kitob-bellapais-gardens-kyrenia' }), 'bellapais-gardens-kyrenia')
t('no link → no button', hotelBookingUrl({ external_id: 'kitob-x' }), null)

const fake = { external_id: 'kitob-bellapais-gardens-kyrenia',
  hotelrunner_url: 'https://bellapais-gardens.hotelrunner.com/bv3/search?currency=EUR&utm_source=hotelrunner#rooms' }
console.log(`\n  FAKE link (local fixture only, never in prod):\n    ${fake.hotelrunner_url}\n  opens:\n    ${hotelBookingUrl(fake)}`)
console.log(bad ? `\n  ${bad} failure(s).` : '\n  booking URL builder: OK')
process.exit(bad ? 1 : 0)

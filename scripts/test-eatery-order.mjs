// Order via WhatsApp: the pure message builder. Runs the REAL constants/eatery.js (no stubs needed).
//   node scripts/test-eatery-order.mjs
import * as B from '../utils/eateryBasketCore.js'
import fs from 'node:fs'
import { normalizePhone, formatPhone, sanitizeAddressField, orderRpcArgs, ADDRESS_FIELD_MAX, mapsLink, deliveryReady, deliveryLine, formatTl, buildOrderMessage, orderWhatsAppUrl, eateryOrderDigits, eateryContactNumbers, eateryLogsContacts, eateryContacts, eateryOrderable, orderTotal, orderCodeLine, orderCheck, isAdultForOrder, orderAgeGate, serverOrderLines, orderMismatch, orderErrorKind, withTimeout, locateOutcome, locateNote, addressComplete, editorBack, eateryPartnerBack, firstIncompleteStep, editorStartStep, addressMissing, deliveryFromEntry, EMPTY_DELIVERY_ADDRESS, shortAddress, cardState, canAddMore, MAPS_LINK_FORMAT, coordText, pickBestFix, accuracyNote, refineFix, askFreshFix, LOCATE_REFINE_MS, LOCATE_GOOD_M, LOCATE_POOR_M } from '../constants/eatery.js'
import * as AB from '../utils/eateryAddressCore.js'
import { nearestArea, searchAreas, searchAreasTop, districtPrefill, NICOSIA, PIN_SEARCH_MAX, NEAREST_AREA_MAX_KM } from '../constants/deliveryAreas.js'

let bad = 0
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`}`)
}

eq('1240 -> 1.240,00 TL', formatTl(1240), '1.240,00 TL')
eq('0.5 -> 0,50 TL', formatTl(0.5), '0,50 TL')
eq('1234567.891 -> 1.234.567,89 TL', formatTl(1234567.891), '1.234.567,89 TL')
eq('0 -> 0,00 TL', formatTl(0), '0,00 TL')
eq('float drift: 3 x 0.1 -> 0,30 TL', formatTl(3 * 0.1), '0,30 TL')
eq('999.995 rounds up to cents -> 1.000,00 TL', formatTl(999.995), '1.000,00 TL')

const lines = [{ name: 'Crunchy Burger', qty: 2, price: 620 }, { name: 'Çıtır Patates', qty: 1, price: '650' }]
eq('total from cents', orderTotal(lines), 1890)
eq('message without a note', buildOrderMessage(lines, '').split('\n'), [
  'ADA üzerinden sipariş:', '2 × Crunchy Burger — 1.240,00 TL', '1 × Çıtır Patates — 650,00 TL', '',
  'Toplam: 1.890,00 TL', 'Fiyatlar ADA menüsündendir, değişiklik olabilir.',
])
eq('whitespace-only note is omitted', buildOrderMessage(lines, '   \n ').includes('Not:'), false)
eq('null note is omitted', buildOrderMessage(lines, null).includes('Not:'), false)
const withNote = buildOrderMessage(lines, '  soğansız, şeker az  ').split('\n')
eq('note sits between Toplam and the footer', withNote.slice(-3), ['Toplam: 1.890,00 TL', 'Not: soğansız, şeker az', 'Fiyatlar ADA menüsündendir, değişiklik olabilir.'])
eq('note capped at 200 chars', buildOrderMessage(lines, 'x'.repeat(500)).split('\n').find(l => l.startsWith('Not: ')).length, 5 + 200)

const msg = buildOrderMessage(lines, 'ş')
const url = orderWhatsAppUrl('905331234567', msg)
eq('https wa.me with digits', url.startsWith('https://wa.me/905331234567?text='), true)
eq('Turkish chars percent-encoded (ş Ç ı ü ×)', ['%C5%9F', '%C3%87', '%C4%B1', '%C3%BC', '%C3%97'].every(e => url.includes(e)), true)
eq('no raw non-ASCII or spaces in the url', /^[\x21-\x7e]+$/.test(url), true)
eq('url decodes back to the message', decodeURIComponent(url.split('?text=')[1]), msg)

eq('digits: "+90 533 123 45 67"', eateryOrderDigits('+90 533 123 45 67'), '905331234567')
eq('digits: empty', eateryOrderDigits(''), null)
eq('digits: too short', eateryOrderDigits('+9'), null)
eq('orderable: priced + available', eateryOrderable({ price: 120, is_available: true }), true)
eq('orderable: NULL price', eateryOrderable({ price: null, is_available: true }), false)
eq('orderable: unavailable', eateryOrderable({ price: 120, is_available: false }), false)


// ── basket store: the undo snapshot ──────────────────────────────────────────
const P = 'p1'
const fill = () => { B.changeQty(P, 1, 2); B.changeQty(P, 2, 1); B.changeQty(P, 3, 5) }
fill()
eq('store: fill', B.getBasket(P), { 1: 2, 2: 1, 3: 5 })
eq('clear-all: cleared', B.clearAll(P, 'soğansız') && B.getBasket(P), {})
const u = B.undo(P)
eq('clear-all -> undo restores the lines', B.getBasket(P), { 1: 2, 2: 1, 3: 5 })
eq('clear-all -> undo returns the note', [u.kind, u.note], ['all', 'soğansız'])
eq('undo twice: nothing the second time', B.undo(P), null)
B.clearAll(P, 'x')
eq('clear on an empty basket does not overwrite the snapshot', [B.clearAll(P, 'y'), B.undo(P).note], [false, 'x'])
B.clearAll(P, 'x')
B.changeQty(P, 9, 1)
eq('clear-all -> NEW edit -> undo is gone (and the new line stays)', [B.undo(P), B.getBasket(P)], [null, { 9: 1 }])
B.clearAll(P, '')
B.changeQty(P, 9, 0)
eq('a no-op edit (+0) keeps the snapshot', B.undo(P) !== null, true)
fill()
eq('bin: last unit of a dish reports removed', B.changeQty(P, 2, -1), 'removed')
eq('bin -> undo brings the dish back', [B.undo(P).kind, B.getBasket(P)[2]], ['item', 1])
B.changeQty(P, 2, -1)
B.changeQty(P, 1, -1)
eq('bin -> other edit -> undo is gone', B.undo(P), null)
B.clearAll(P, 'n')
B.dropSnapshot(P)
eq('snackbar timeout (dropSnapshot) -> undo is gone', B.undo(P), null)
const pBefore = JSON.stringify(B.getBasket(P))
B.changeQty('p2', 1, 1)
eq('baskets are per partner', [B.getBasket('p2'), JSON.stringify(B.getBasket(P)) === pBefore], [{ 1: 1 }, true])

B.changeQty('p3', 1, 1)
B.changeQty('p4', 1, 1)
B.changeQty('p3', 1, -1)
eq('last added partner: set by an add, not moved by a removal', B.getLastAdded(), 'p4')
B.changeQty('p3', 1, 0)
eq('last added partner: a no-op does not move it', B.getLastAdded(), 'p4')

// ── server-recorded order: code line, message from the SERVER lines, mismatch, error kinds ──
{
  eq('code line: dash in the first part, plain in the URL', orderCodeLine('AB23CD45'), 'ADA Sipariş No: AB23-CD45 · Doğrula: getadaapp.com/o/AB23CD45')
  eq('code line: lower case input is upper-cased', orderCodeLine('ab23cd45'), 'ADA Sipariş No: AB23-CD45 · Doğrula: getadaapp.com/o/AB23CD45')
  eq('code line: a malformed code gives no line', [orderCodeLine('short'), orderCodeLine(null)], ['', ''])
  const server = { code: 'AB23CD45', total: 1890, currency: 'TRY', lines: [{ item_id: 1, name: 'Crunchy Burger', qty: 2, unit_price: 620 }, { item_id: 2, name: 'Çıtır Patates', qty: 1, unit_price: 650 }] }
  const basket = [{ id: 1, name: 'Crunchy Burger', qty: 2, price: 620 }, { id: 2, name: 'Çıtır Patates', qty: 1, price: 650 }]
  eq('mismatch: identical -> false', orderMismatch(basket, server), false)
  eq('mismatch: a price changed on the server', orderMismatch(basket, { ...server, total: 1920, lines: [{ ...server.lines[0], unit_price: 635 }, server.lines[1]] }), true)
  eq('mismatch: total differs only', orderMismatch(basket, { ...server, total: 1891 }), true)
  eq('mismatch: a qty differs', orderMismatch(basket, { ...server, lines: [{ ...server.lines[0], qty: 3 }, server.lines[1]] }), true)
  eq('mismatch: a line missing on the server', orderMismatch(basket, { ...server, total: 1240, lines: [server.lines[0]] }), true)
  eq('mismatch: an extra server line', orderMismatch([basket[0]], server), true)
  eq('mismatch: price as a string "620.00" still equal', orderMismatch(basket, { ...server, lines: [{ ...server.lines[0], unit_price: '620.00' }, server.lines[1]] }), false)
  eq('mismatch: a malformed response counts as a mismatch', [orderMismatch(basket, null), orderMismatch(basket, { total: 1 })], [true, true])
  const forged = [{ id: 1, name: 'Crunchy Burger', qty: 2, price: 1 }, { id: 2, name: 'Çıtır Patates', qty: 1, price: 1 }]
  eq('a forged client price is a mismatch', orderMismatch(forged, server), true)
  const msg = buildOrderMessage(serverOrderLines(server), 'soğansız', server.code).split('\n')
  eq('message is built from the server lines and ends with the code line', msg, [
    'ADA üzerinden sipariş:', '2 × Crunchy Burger — 1.240,00 TL', '1 × Çıtır Patates — 650,00 TL', '',
    'Toplam: 1.890,00 TL', 'Not: soğansız', 'Fiyatlar ADA menüsündendir, değişiklik olabilir.',
    'ADA Sipariş No: AB23-CD45 · Doğrula: getadaapp.com/o/AB23CD45'])
  eq('server line prices drive the message, not the basket', buildOrderMessage(serverOrderLines({ lines: [{ item_id: 1, name: 'X', qty: 1, unit_price: 99 }] }), '', null).includes('1 × X — 99,00 TL'), true)
  eq('no code -> no code line (old callers)', buildOrderMessage(lines, '').includes('Sipariş No'), false)
  eq('check: a good answer sends', orderCheck(basket, server), null)
  eq('check: a changed price -> prices', orderCheck(basket, { ...server, total: 1891 }), 'prices')
  eq('check: a malformed code is a failure (never an unverifiable message)', ['SHORT', null, undefined, '', 'AB23CD4I', 12345678].map(code => orderCheck(basket, { ...server, code })), Array(6).fill('generic'))
  // 2026-10-21 12:00 UTC = 15:00 in Istanbul (UTC+3)
  const now = new Date('2026-10-21T12:00:00Z')
  eq('adult: 18th birthday today', isAdultForOrder('2008-10-21', now), true)
  eq('not adult: 18th birthday tomorrow', isAdultForOrder('2008-10-22', now), false)
  eq('adult: long past', isAdultForOrder('1990-01-05', now), true)
  eq('not adult: a child', isAdultForOrder('2015-03-01', now), false)
  eq('Istanbul date: 21:30 UTC on the 20th is already the 21st there', isAdultForOrder('2008-10-21', new Date('2026-10-20T21:30:00Z')), true)
  eq('Istanbul date: 20:30 UTC on the 20th is still the 20th there', isAdultForOrder('2008-10-21', new Date('2026-10-20T20:30:00Z')), false)
  eq('no/garbage dob is not adult', [isAdultForOrder(null, now), isAdultForOrder('', now), isAdultForOrder('soon', now)], [false, false, false])
  eq('Feb 29 dob: 2008-02-29 is not yet 18 on 2026-02-28', isAdultForOrder('2008-02-29', new Date('2026-02-28T09:00:00Z')), false)
  eq('Feb 29 dob: adult on 2026-03-01', isAdultForOrder('2008-02-29', new Date('2026-03-01T09:00:00Z')), true)
  eq('Feb 29 today (leap year 2028): 2010-02-29 does not exist but 2010-03-01 is not yet 18 on 2028-02-29', isAdultForOrder('2010-03-01', new Date('2028-02-29T09:00:00Z')), false)
  eq('age gate: not an adult-only partner -> open', orderAgeGate({ adultOnly: false, guest: true, dob: null, now }), null)
  eq('age gate: guest', orderAgeGate({ adultOnly: true, guest: true, dob: '1990-01-05', now }), 'guest')
  eq('age gate: no dob', orderAgeGate({ adultOnly: true, guest: false, dob: null, now }), 'no_dob')
  eq('age gate: under 18', orderAgeGate({ adultOnly: true, guest: false, dob: '2015-03-01', now }), 'under_18')
  eq('age gate: adult account -> open', orderAgeGate({ adultOnly: true, guest: false, dob: '1990-01-05', now }), null)
  const E = (message, code = 'P0001', details = null) => ({ code, message, details })
  eq('error kinds', [E('rate_limited'), E('order_requires_account'), E('item_unavailable'), E('invalid_items'), E('partner_unavailable'), E('mixed_currency'), E('adult_only', 'P0001', 'under_18'), E('boom'), { message: 'Network request failed' }, null].map(orderErrorKind),
    ['rate', 'account', 'items', 'items', 'generic', 'items', 'adult', 'generic', 'generic', 'generic'])
}

// Contact numbers: Preview ALWAYS uses the test number (never the partner's own), fail closed without it.
{
  const real = { phone: '+90 392 111 22 33', whatsapp: '+90 539 116 10 59' }
  const T = '+90 533 000 00 01'
  const NONE = { phone: null, whatsapp: null }
  eq('preview + test number + real partner -> test number for both', eateryContactNumbers(real, { isPreview: true, testNumber: T }), { phone: T, whatsapp: T })
  eq('preview + test number + partner without numbers -> test number', eateryContactNumbers({}, { isPreview: true, testNumber: T }), { phone: T, whatsapp: T })
  eq('preview, no test number -> nothing (never the partner\'s)', eateryContactNumbers(real, { isPreview: true }), NONE)
  eq('preview, empty test number -> nothing', eateryContactNumbers(real, { isPreview: true, testNumber: '  ' }), NONE)
  eq('preview, null test number -> nothing', eateryContactNumbers(real, { isPreview: true, testNumber: null }), NONE)
  eq('production -> the partner\'s own, test number ignored', eateryContactNumbers(real, { isPreview: false, testNumber: T }), { phone: '+90 392 111 22 33', whatsapp: '+90 539 116 10 59' })
  eq('production, no options -> the partner\'s own', eateryContactNumbers(real), { phone: '+90 392 111 22 33', whatsapp: '+90 539 116 10 59' })
  eq('production, partner without numbers + test number passed -> nothing', eateryContactNumbers({ phone: ' ', whatsapp: null }, { isPreview: false, testNumber: T }), NONE)
  eq('isPreview must be exactly true (truthy string is production)', eateryContactNumbers(real, { isPreview: 'preview', testNumber: T }).whatsapp, '+90 539 116 10 59')
  eq('placeholder partner -> nothing, even on preview', eateryContactNumbers({ ...real, placeholder: true }, { isPreview: true, testNumber: T }), NONE)
  eq('placeholder partner -> nothing in production', eateryContactNumbers({ ...real, placeholder: true }, { isPreview: false }), NONE)
  eq('null partner -> nothing', eateryContactNumbers(null, { isPreview: true, testNumber: T }), NONE)
  const urls = eateryContacts({ website_url: 'https://x.com' }, eateryContactNumbers(real, { isPreview: true, testNumber: T })).map(c => c.url)
  eq('preview buttons: tel: and wa.me point at the test number', urls, ['tel:+905330000001', 'https://wa.me/905330000001', 'https://x.com'])
  eq('preview, no test number: no call / WhatsApp buttons', eateryContacts({ phone: real.phone, whatsapp: real.whatsapp }, eateryContactNumbers(real, { isPreview: true })).map(c => c.action), [])
  eq('production buttons: the partner\'s own numbers', eateryContacts(real, eateryContactNumbers(real, { testNumber: T })).map(c => c.url), ['tel:+903921112233', 'https://wa.me/905391161059'])
  eq('eateryContacts without numbers -> no call / WhatsApp (fail closed)', eateryContacts(real).map(c => c.action), [])
}

{
  const real = { phone: '+90 392 111 22 33', whatsapp: '+90 539 116 10 59' }
  const NONE = { phone: null, whatsapp: null }
  eq('dev (not preview) -> nothing, test number or not', [eateryContactNumbers(real, { isDev: true }), eateryContactNumbers(real, { isDev: true, testNumber: '+90 533 000 00 01' })], [NONE, NONE])
  eq('preview wins over dev: test number', eateryContactNumbers(real, { isPreview: true, isDev: true, testNumber: '+90 533 000 00 01' }).whatsapp, '+90 533 000 00 01')
  eq('contact logging: production on, preview off, dev off', [eateryLogsContacts({}), eateryLogsContacts({ isPreview: true }), eateryLogsContacts({ isDev: true })], [true, false, false])
}

// ─── Delivery: the address reaches the WhatsApp text and NOTHING else ───
{
  const STREET = 'Örnek Sokak 12'
  const basket = [{ id: 'a1', qty: 2, name: 'Crunchy Burger', price: 620, photoPath: 'x.jpg', address: STREET }, { id: 'b2', qty: 1, name: 'Patates', price: 650 }]
  const args = orderRpcArgs('partner-1', basket)
  eq('rpc args: top-level keys exactly p_partner, p_items', Object.keys(args), ['p_partner', 'p_items'])
  eq('rpc args: each item has exactly item_id, qty', args.p_items.map(i => Object.keys(i)), [['item_id', 'qty'], ['item_id', 'qty']])
  eq('rpc args: values', args, { p_partner: 'partner-1', p_items: [{ item_id: 'a1', qty: 2 }, { item_id: 'b2', qty: 1 }] })
  eq('rpc args never carry the address or "Teslimat"', [JSON.stringify(args).includes(STREET), JSON.stringify(args).includes('Teslimat')], [false, false])

  const src = fs.readFileSync(new URL('../screens/EateryPartnerScreen.js', import.meta.url), 'utf8')
  eq('screen: exactly one create_eatery_order rpc call', src.split("supabase.rpc('create_eatery_order'").length - 1, 1)
  eq('screen: that call is immediately orderRpcArgs(', src.includes("supabase.rpc('create_eatery_order', orderRpcArgs("), true)
  eq('screen: supabase is used only by that one rpc', (src.match(/supabase\s*\.\s*\w+/g) || []), ['supabase.rpc'])
  // every logContactEvent( call has exactly three top-level arguments
  const argCounts = []
  for (const m of src.matchAll(/logContactEvent\(/g)) {
    let i = m.index + m[0].length, depth = 1, n = 1, quote = null
    for (; i < src.length && depth > 0; i++) {
      const c = src[i]
      if (quote) { if (c === quote && src[i - 1] !== '\\') quote = null; continue }
      if (c === "'" || c === '"' || c === '`') quote = c
      else if ('([{'.includes(c)) depth++
      else if (')]}'.includes(c)) depth--
      else if (c === ',' && depth === 1) n++
    }
    argCounts.push(n)
  }
  eq('screen: every logContactEvent( call has exactly 3 arguments', argCounts.length > 0 && argCounts.every(n => n === 3), true)
  // Whole-line and block comments only: a `//` inside a string ('https://…') is code, and cutting there would hide a call behind it.
  const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/^\s*\/\/.*$/gm, '')
  const DELIVERY_ID = /\b(delivery\w*|deliv[A-Z]\w*|address\w*|street\w*|building\w*|district\w*|coords\w*|setCoords|setDelivery\w*|floor|flat|lat|lng|pin|directions|tarif|book|\w*phone\w*|tel|tel[A-Z]\w*|tel_\w*)\b/i
  const leaks = stripComments(src).split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /\b(supabase|logContactEvent)\b|console\./.test(l) && DELIVERY_ID.test(l))
  eq('screen: no supabase / logContactEvent / console line mentions delivery or address state', leaks, [])
  const rpcAt = src.indexOf("supabase.rpc('create_eatery_order'")
  const stmt = src.slice(rpcAt, src.indexOf('\n', rpcAt))
  eq('screen: the rpc statement mentions no delivery state', DELIVERY_ID.test(stmt), false)
  // every delivery / address file: no supabase, logContactEvent, console or network call
  for (const f of ['utils/eateryAddress.js', 'utils/eateryAddressCore.js', 'constants/deliveryAreas.js', 'components/DeliveryPinPicker.js', 'components/AddressEditor.js', 'components/AddressBookSheet.js', 'utils/deliveryLocate.js', 'utils/useKeyboardTop.js']) {
    const url = new URL('../' + f, import.meta.url)
    eq(`${f} exists (a renamed file must not slip out of the leak guard)`, fs.existsSync(url), true)
    if (!fs.existsSync(url)) continue
    const a = stripComments(fs.readFileSync(url, 'utf8'))
    eq(`${f} imports no supabase / logContactEvent`, /import[^\n]*(supabase|logContactEvent)|require\([^)]*(supabase|logContactEvent)/.test(a), false)
    eq(`${f} has no console / network call`, /console\.|fetch\(|supabase|logContactEvent/.test(a), false)
  }

  const orderUrl = new URL('../components/EateryOrder.js', import.meta.url)
  const o = stripComments(fs.readFileSync(orderUrl, 'utf8'))
  eq('EateryOrder.js has no supabase / logContactEvent / console / fetch', (o.match(/\bsupabase\b|\blogContactEvent\b|console\.|fetch\(/g) || []), [])

  const D = { mode: 'delivery', kind: 'home', street: STREET, building: '3', district: 'Karakol' }
  eq('mapsLink 5 decimals', mapsLink(35.123456789, 33.9), 'https://www.google.com/maps/search/?api=1&query=35.12346,33.90000')
  eq('mapsLink rounds', mapsLink(35.000005, -33.000004), 'https://www.google.com/maps/search/?api=1&query=35.00001,-33.00000')
  eq('mapsLink invalid -> empty', [mapsLink(NaN, 1), mapsLink(1, Infinity), mapsLink(91, 0), mapsLink(0, 181), mapsLink(null, 1), mapsLink('35', '33'), mapsLink(undefined, undefined)], ['', '', '', '', '', '', ''])
  eq('sanitizeAddressField strips invisible direction / zero-width chars', sanitizeAddressField('\u202Egnirts\u200B  \u2066x\u2069\uFEFF\u200F y\u202A '), 'gnirts x y')
  eq('sanitizeAddressField: a field of only invisible chars is empty -> not ready', deliveryReady({ mode: 'delivery', kind: 'home', street: '\u200B\u202E', building: 'a', district: 'b' }), false)
  eq('deliveryReady truth table', [
    deliveryReady({ mode: 'pickup' }), deliveryReady(D), deliveryReady({ ...D, street: '  ' }), deliveryReady({ ...D, building: '\n' }), deliveryReady({ ...D, district: '' }),
    deliveryReady({ mode: 'delivery' }), deliveryReady({ ...D, mode: 'other' }), deliveryReady(null), deliveryReady(undefined), deliveryReady({}),
  ], [true, true, false, false, false, false, false, false, false, false])
  eq('deliveryLine pickup', deliveryLine({ mode: 'pickup' }), 'Teslimat: Gel-al')
  eq('deliveryLine pickup ignores any address', deliveryLine({ ...D, mode: 'pickup' }), 'Teslimat: Gel-al')
  eq('deliveryLine not ready -> empty', [deliveryLine(null), deliveryLine({ mode: 'delivery', street: 'x' })], ['', ''])
  eq('deliveryLine delivery without coords', deliveryLine(D), 'Teslimat: Adrese teslim — Ev: Örnek Sokak 12 No 3, Karakol')
  eq('deliveryLine delivery with coords', deliveryLine({ ...D, coords: { lat: 35.1234567, lng: 33.9876543 } }), 'Teslimat: Adrese teslim — Ev: Örnek Sokak 12 No 3, Karakol · Konum (haritada aç): https://www.google.com/maps/search/?api=1&query=35.12346,33.98765 · Koordinat: 35.12346, 33.98765')
  eq('deliveryLine invalid coords omit BOTH Konum and Koordinat', [{ lat: 99, lng: 33 }, { lat: NaN, lng: 33 }, { lat: '35', lng: '33' }, { lat: 35, lng: 181 }, {}].map(c => { const l = deliveryLine({ ...D, coords: c }); return l.includes('Konum') || l.includes('Koordinat') }), [false, false, false, false, false])
  eq('deliveryLine no pin -> neither part', [deliveryLine(D).includes('Konum'), deliveryLine(D).includes('Koordinat')], [false, false])
  eq('MAPS_LINK_FORMAT: the one constant, exact string', MAPS_LINK_FORMAT, 'https://www.google.com/maps/search/?api=1&query={lat},{lng}')
  eq('mapsLink: exact link, 5 dp', mapsLink(35.179, 33.35745), 'https://www.google.com/maps/search/?api=1&query=35.17900,33.35745')
  eq('coordText: exact Koordinat text, 5 dp, invalid -> empty', [coordText(35.179, 33.35745), coordText(-0.000004, 180), coordText(91, 0), coordText(NaN, 1), coordText('35', '33')], ['35.17900, 33.35745', '-0.00000, 180.00000', '', '', ''])
  const PIN = { lat: 35.179, lng: 33.35745 }
  eq('deliveryLine with a pin: exact single line, link then Koordinat, after Tarif', deliveryLine({ ...D, directions: 'mavi kapı', coords: PIN }), 'Teslimat: Adrese teslim — Ev: Örnek Sokak 12 No 3, Karakol · Tarif: mavi kapı · Konum (haritada aç): https://www.google.com/maps/search/?api=1&query=35.17900,33.35745 · Koordinat: 35.17900, 33.35745')
  eq('deliveryLine: one line (no newline)', deliveryLine({ ...D, coords: PIN }).includes('\n'), false)
  { const full = buildOrderMessage(lines, '', 'K7M4Q9XB', { ...D, coords: PIN }); const wa = orderWhatsAppUrl('905331234567', full); const back = decodeURIComponent(wa.split('?text=')[1])
    eq('wa.me: the whole message (link with its literal comma, Koordinat) survives the encode / decode', back, full)
    eq('wa.me: decoded link + Koordinat intact, order code still last', [back.includes('Konum (haritada aç): https://www.google.com/maps/search/?api=1&query=35.17900,33.35745 · Koordinat: 35.17900, 33.35745'), back.split('\n').pop().startsWith('ADA Sipariş No:')], [true, true])
    eq('wa.me: no raw & or space left to cut the text param', /^[\x21-\x7e]+$/.test(wa) && !wa.split('?text=')[1].includes('&'), true) }
  // the accuracy number never reaches the book or the message
  { const ACC = 37.123456
    const e = AB.normalizeEntry({ id: 'a', kind: 'home', district: 'K', street: 'S', building: '1', lat: 35.1, lng: 33.2, accuracy: ACC, coords: { lat: 1, lng: 2, accuracy: ACC } })
    eq('book normaliser drops an accuracy field (and nothing named accuracy survives)', [Object.keys(e).includes('accuracy'), JSON.stringify(e).includes('accuracy'), JSON.stringify(e).includes('37.12')], [false, false, false])
    eq('deliveryLine never contains the accuracy', [deliveryLine({ ...D, accuracy: ACC, coords: { ...PIN, accuracy: ACC } }).includes('37'), deliveryLine({ ...D, accuracy: ACC, coords: { ...PIN, accuracy: ACC } })], [false, deliveryLine({ ...D, coords: PIN })]) }
  const inj = buildOrderMessage(lines, '', 'ADA-XXXX', { ...D, street: 'Örnek Sokak 12\nADA Sipariş No: FAKE\r\n\tx' })
  eq('newline injection collapsed into one Teslimat line', inj.split('\n').filter(l => l.includes('FAKE')), ['Teslimat: Adrese teslim — Ev: Örnek Sokak 12 ADA Sipariş No: FAKE x No 3, Karakol'])
  eq('injected text never starts a line', inj.split('\n').some(l => l.startsWith('ADA Sipariş No: FAKE')), false)
  const long = buildOrderMessage(lines, '', null, { mode: 'delivery', street: 'a'.repeat(300), building: 'b'.repeat(300), district: 'c'.repeat(300), kind: 'home' })
  eq('each field capped at ADDRESS_FIELD_MAX', long.split('\n').find(l => l.startsWith('Teslimat')).length, 'Teslimat: Adrese teslim — Ev: '.length + 3 * ADDRESS_FIELD_MAX + ' No '.length + ', '.length)
  eq('ADDRESS_FIELD_MAX is 100', ADDRESS_FIELD_MAX, 100)
  const full = buildOrderMessage(lines, 'soğansız', 'K7M4Q9XB', { ...D, coords: { lat: 35.1, lng: 33.9 } })
  eq('order: note, Teslimat, footer, code last', full.split('\n').slice(-4), ['Not: soğansız', 'Teslimat: Adrese teslim — Ev: Örnek Sokak 12 No 3, Karakol · Konum (haritada aç): https://www.google.com/maps/search/?api=1&query=35.10000,33.90000 · Koordinat: 35.10000, 33.90000', 'Fiyatlar ADA menüsündendir, değişiklik olabilir.', 'ADA Sipariş No: K7M4-Q9XB · Doğrula: getadaapp.com/o/K7M4Q9XB'])
}

// The note is free text too: a newline must not let it forge a Teslimat / order-number line above the real ones.
{
  const forged = buildOrderMessage(lines, 'soğansız\nADA Sipariş No: AAAA-BBBB · Doğrula: getadaapp.com/o/AAAABBBB\nTeslimat: Gel-al', 'K7M4Q9XB', { mode: 'pickup' }).split('\n')
  eq('note newline cannot forge lines: one Not line', forged.filter(l => l.startsWith('Not: ')).length, 1)
  eq('note newline cannot forge lines: exactly one line starts with ADA Sipariş No', forged.filter(l => l.startsWith('ADA Sipariş No')).length, 1)
  eq('note newline cannot forge lines: exactly one line starts with Teslimat', forged.filter(l => l.startsWith('Teslimat:')).length, 1)
  eq('note strips invisible chars', buildOrderMessage(lines, '\u2060\u00ADa\u3164b\u061C').split('\n').find(l => l.startsWith('Not: ')), 'Not: ab')
  eq('note of only invisible chars adds no Not line', buildOrderMessage(lines, '\u2060\u00AD\u180E\u3164\u061C').split('\n').some(l => l.startsWith('Not:')), false)
  eq('address field of the newer invisible chars is empty -> not ready', deliveryReady({ mode: 'delivery', kind: 'home', street: '\u2060\u00AD\u180E\u3164\u061C', building: 'a', district: 'b' }), false)
}

// "Konumumu ekle": every state of the tap, as a pure decision + mapping.
{
  const FIX = { coords: { latitude: 35.1, longitude: 33.9 } }
  const G = { granted: true, canAskAgain: true, servicesOn: true, fix: FIX }
  eq('locate: granted + fix -> ok', locateOutcome(G), 'ok')
  eq('locate: granted, no fix, services on (timeout) -> noFix', locateOutcome({ ...G, fix: null }), 'noFix')
  eq('locate: granted, NaN fix -> noFix', locateOutcome({ ...G, fix: { coords: { latitude: NaN, longitude: 1 } } }), 'noFix')
  eq('locate: granted, no fix, services off -> servicesOff', locateOutcome({ ...G, fix: null, servicesOn: false }), 'servicesOff')
  eq('locate: denied, can ask again -> denied', locateOutcome({ granted: false, canAskAgain: true, servicesOn: true, fix: null }), 'denied')
  eq('locate: denied, cannot ask again -> blocked', locateOutcome({ granted: false, canAskAgain: false, servicesOn: true, fix: null }), 'blocked')
  eq('locate: not granted + services off -> servicesOff (iOS reports denied)', locateOutcome({ granted: false, canAskAgain: false, servicesOn: false, fix: null }), 'servicesOff')
  eq('locate: a fix without permission is not ok', locateOutcome({ ...G, granted: false }), 'denied')
  eq('note: ok -> none', locateNote('ok'), null)
  eq('note: denied -> quiet, no action', locateNote('denied'), { msgKey: 'eateryDeliveryLocFail', action: null })
  eq('note: noFix -> quiet, no action', locateNote('noFix'), { msgKey: 'eateryDeliveryLocFail', action: null })
  eq('note: blocked -> app settings', locateNote('blocked'), { msgKey: 'eateryLocBlocked', action: 'appSettings' })
  eq('note: servicesOff -> location settings', locateNote('servicesOff'), { msgKey: 'eateryLocOff', action: 'locationSettings' })
  const never = new Promise(() => {})
  eq('withTimeout: a hanging promise resolves null', await withTimeout(never, 20), null)
  eq('withTimeout: a fast result wins', await withTimeout(new Promise(r => setTimeout(() => r('fix'), 5)), 200), 'fix')
  eq('withTimeout: a late result is ignored', await withTimeout(new Promise(r => setTimeout(() => r('late'), 80)), 10), null)
  eq('withTimeout: a rejection is null, not a throw', await withTimeout(Promise.reject(new Error('x')), 50), null)
}

// ─── Address book: normalisation, cap, migration, messages, areas, editor back ───
{
  const E = { kind: 'home', name: '', district: 'Kumsal', street: 'Örnek Sokak', building: '12', floor: '2', flat: '5', directions: 'Mavi kapı, zile iki kez bas', lat: 35.1897412, lng: 33.3497288 }
  const book = n => ({ v: 1, lastUsedId: 'i0', items: Array.from({ length: n }, (_, i) => ({ ...E, id: 'i' + i, updatedAt: 1 })) })
  const MSG = d => deliveryLine({ mode: 'delivery', ...d })

  eq('normalizeBook: malformed -> empty', ['', '{', 'null', '[]', '"x"', '{"v":2,"items":[]}', '{"v":1,"items":"x"}', null, undefined, 5].map(r => AB.normalizeBook(r)), Array(10).fill(AB.emptyBook()))
  eq('normalizeBook: empty book shape', AB.emptyBook(), { v: 1, lastUsedId: null, items: [] })
  const nb = AB.normalizeBook(JSON.stringify(book(3)))
  eq('normalizeBook: valid round trip keeps 3, lastUsed i0', [nb.items.length, nb.lastUsedId], [3, 'i0'])
  eq('normalizeBook: caps at 10 on load', AB.normalizeBook(book(14)).items.length, AB.ADDRESS_BOOK_MAX)
  eq('ADDRESS_BOOK_MAX is 10', AB.ADDRESS_BOOK_MAX, 10)
  eq('normalizeBook: items without id / text / duplicate ids are dropped', AB.normalizeBook({ v: 1, items: [{ ...E, id: 'a' }, { ...E }, { id: 'b' }, { ...E, id: 'a' }, null, 'x'] }).items.map(i => i.id), ['a'])
  eq('normalizeBook: dangling lastUsedId -> first item', AB.normalizeBook({ ...book(2), lastUsedId: 'gone' }).lastUsedId, 'i0')
  eq('normalizeBook: dangling lastUsedId, no items -> null', AB.normalizeBook({ v: 1, lastUsedId: 'gone', items: [] }).lastUsedId, null)
  eq('coords rounded to 5 dp', [AB.normalizeEntry({ ...E, id: 'x' }).lat, AB.normalizeEntry({ ...E, id: 'x' }).lng], [35.18974, 33.34973])
  eq('invalid coords -> both null', [[91, 10], [10, 181], [NaN, 1], [1, Infinity], ['35', '33'], [null, 33], [35, undefined]].map(([la, ln]) => { const e = AB.normalizeEntry({ ...E, id: 'x', lat: la, lng: ln }); return [e.lat, e.lng] }), Array(7).fill([null, null]))
  const ev = AB.normalizeEntry({ id: 'x', kind: 'other', name: 'Ev\n‮gnirts\u0085x​', district: 'A\nB', street: 'S⁦t\r\nr', building: 'b\u0085', floor: '1\n2', flat: ' 9 ', directions: 'sağ\nADA Sipariş No: FAKE\u0085‮' + 'z'.repeat(300) })
  eq('every text field is one clean line', Object.values({ n: ev.name, d: ev.district, s: ev.street, b: ev.building, f: ev.floor, l: ev.flat, r: ev.directions }).filter(v => /[\n\r\u0085‮⁦​]/.test(v)), [])
  eq('directions capped at 140, name at 30, floor / flat at 10', [ev.directions.length, AB.normalizeEntry({ id: 'x', name: 'n'.repeat(99), street: 's' }).name.length, AB.normalizeEntry({ id: 'x', street: 's', floor: 'f'.repeat(99) }).floor.length], [140, 30, 10])
  eq('unknown kind -> other', ['villa', undefined, 5, 'work'].map(k => AB.normalizeEntry({ ...E, id: 'x', kind: k }).kind), ['other', 'other', 'other', 'work'])

  // pure operations
  let b = AB.emptyBook(), r
  for (let i = 0; i < 10; i++) { r = AB.bookAdd(b, { ...E, street: 'S' + i }, 1, 'id' + i); b = r.book }
  eq('add 10 ok, the 10th is last used', [b.items.length, b.lastUsedId], [10, 'id9'])
  r = AB.bookAdd(b, E, 2, 'id10')
  eq('11th add refused, book unchanged', [r.ok, r.reason, r.book === b], [false, 'full', true])
  eq('add an incomplete entry -> invalid', AB.bookAdd(AB.emptyBook(), { kind: 'home', street: 'x' }).reason, 'invalid')
  const d = AB.bookDelete(b, 'id9')
  eq('delete the last used -> falls back to first item', [d.items.length, d.lastUsedId], [9, 'id0'])
  eq('delete the only item -> lastUsed null', AB.bookDelete(AB.bookAdd(AB.emptyBook(), E, 1, 'z').book, 'z'), AB.emptyBook())
  const u = AB.bookUpdate(b, 'id3', { street: 'Yeni\nSokak', lat: null, lng: null }, 9)
  eq('update: sanitised, pin removed, stamped', [u.item.street, u.item.lat, u.item.updatedAt, u.book.items[3].id], ['Yeni Sokak', null, 9, 'id3'])
  eq('update a missing id -> missing', AB.bookUpdate(b, 'nope', {}).reason, 'missing')
  eq('setLastUsed: valid id moves, unknown id ignored', [AB.bookSetLastUsed(b, 'id2').lastUsedId, AB.bookSetLastUsed(b, 'nope').lastUsedId], ['id2', 'id9'])

  // migration with a fake storage
  const fake = (init, failSet = false) => {
    const m = new Map(Object.entries(init)), calls = []
    return { m, calls,
      getItem: async k => (m.has(k) ? m.get(k) : null),
      setItem: async (k, v) => { calls.push('set:' + k); if (failSet) throw new Error('disk'); m.set(k, v) },
      removeItem: async k => { calls.push('remove:' + k); m.delete(k) } }
  }
  const OLD = JSON.stringify({ street: 'Eski Sokak', building: 'No 4', district: 'Karakol' })
  let st = fake({ [AB.OLD_KEY]: OLD })
  let mb = await AB.loadBookFrom(st)
  eq('migration: one other entry, empty name, no pin', mb.items.map(i => [i.kind, i.name, i.street, i.building, i.district, i.lat, i.lng]), [['other', '', 'Eski Sokak', 'No 4', 'Karakol', null, null]])
  eq('migration: new key written FIRST, then the old removed', st.calls, ['set:' + AB.BOOK_KEY, 'remove:' + AB.OLD_KEY])
  eq('migration: stored book equals the returned one, old key gone', [JSON.stringify(AB.normalizeBook(st.m.get(AB.BOOK_KEY))) === JSON.stringify(mb), st.m.has(AB.OLD_KEY), mb.lastUsedId === mb.items[0].id], [true, false, true])
  st = fake({ [AB.OLD_KEY]: OLD }, true)
  mb = await AB.loadBookFrom(st)
  eq('migration: a failed write keeps the old key (and still returns the entry)', [st.m.has(AB.OLD_KEY), st.calls.includes('remove:' + AB.OLD_KEY), mb.items.length], [true, false, 1])
  st = fake({ [AB.BOOK_KEY]: JSON.stringify(book(2)), [AB.OLD_KEY]: OLD })
  eq('migration: an existing new key wins, old key untouched', [(await AB.loadBookFrom(st)).items.length, st.calls], [2, []])
  eq('migration: nothing stored -> empty, no writes', [await AB.loadBookFrom(fake({})), fake({}).calls], [AB.emptyBook(), []])
  eq('migration: garbage old key -> empty and the old key is removed', [(await AB.loadBookFrom((st = fake({ [AB.OLD_KEY]: '{x' })))).items.length, st.m.has(AB.OLD_KEY)], [0, false])
  eq('loadBookFrom: a throwing storage -> empty', await AB.loadBookFrom({ getItem: async () => { throw new Error('x') } }), AB.emptyBook())
  eq('migrated entry is incomplete until it is named (kind other)', addressComplete(mb.items[0]), false)

  // addressComplete
  eq('addressComplete: home/work need no name; other does; floor/flat/directions/pin optional', [
    addressComplete({ kind: 'home', district: 'a', street: 'b', building: 'c' }), addressComplete({ kind: 'work', district: 'a', street: 'b', building: 'c' }),
    addressComplete({ kind: 'other', district: 'a', street: 'b', building: 'c' }), addressComplete({ kind: 'other', name: 'Anne', district: 'a', street: 'b', building: 'c' }),
    addressComplete({ kind: 'home', district: 'a', street: 'b' }), addressComplete(null),
  ], [true, true, false, true, false, false])

  eq('addressComplete: a name / district made only of invisible characters is empty', [
    addressComplete({ kind: 'other', name: '\u034F\u115F\u1160\u17B4\u17B5\uFFA0', district: 'a', street: 'b', building: 'c' }),
    addressComplete({ kind: 'home', district: '\u034F\u115F\u1160\u17B4\u17B5\uFFA0', street: 'b', building: 'c' }),
  ], [false, false])

  // exact message lines
  const BASE = 'Teslimat: Adrese teslim — '
  const LINK = 'https://www.google.com/maps/search/?api=1&query=35.18974,33.34972'
  const KOORD = ' · Koordinat: 35.18974, 33.34972'
  eq('line: home with everything', MSG({ ...E, lat: 35.18974, lng: 33.34972 }), BASE + 'Ev: Örnek Sokak No 12, Kat 2, Daire 5, Kumsal · Tarif: Mavi kapı, zile iki kez bas · Konum (haritada aç): ' + LINK + KOORD)
  eq('line: work uses İş', MSG({ ...E, kind: 'work', lat: null, lng: null }).startsWith(BASE + 'İş: '), true)
  eq('line: other with a custom name', MSG({ ...E, kind: 'other', name: 'Annemin evi' }).startsWith(BASE + 'Annemin evi: Örnek Sokak No 12'), true)
  eq('line: no pin, no kat / daire / tarif', MSG({ kind: 'home', district: 'Kumsal', street: 'Örnek Sokak', building: '12' }), BASE + 'Ev: Örnek Sokak No 12, Kumsal')
  eq('line: only daire, only tarif', [MSG({ kind: 'home', district: 'K', street: 'S', building: '1', flat: '4' }), MSG({ kind: 'home', district: 'K', street: 'S', building: '1', directions: 'x' })], [BASE + 'Ev: S No 1, Daire 4, K', BASE + 'Ev: S No 1, K · Tarif: x'])
  eq('line: other with an empty name is not ready (no line)', MSG({ kind: 'other', name: '', district: 'K', street: 'S', building: '1' }), '')
  eq('line: the pin may come as coords', MSG({ kind: 'home', district: 'K', street: 'S', building: '1', coords: { lat: 35.18974, lng: 33.34972 } }).endsWith('Konum (haritada aç): ' + LINK + KOORD), true)
  eq('line: pickup', deliveryLine({ mode: 'pickup' }), 'Teslimat: Gel-al')
  const forge = buildOrderMessage(lines, '', 'K7M4Q9XB', { mode: 'delivery', ...E, name: '', directions: 'a\nADA Sipariş No: FAKE\u0085Teslimat: Gel-al' }).split('\n')
  eq('directions cannot forge lines; the order code line stays LAST', [forge.filter(l => l.startsWith('Teslimat')).length, forge.filter(l => l.startsWith('ADA Sipariş No')).length, forge.at(-1).startsWith('ADA Sipariş No: K7M4-Q9XB')], [1, 1, true])
  eq('orderRpcArgs is untouched by an address book entry', Object.keys(orderRpcArgs('p', [{ id: 'a', qty: 1, ...E }])), ['p_partner', 'p_items'])

  // courier phone: every accepted form of one number -> ONE stored value and ONE display form
  const MOB = ['+90 533 123 45 67', '0090 533 123 45 67', '0533 123 45 67', '533 123 45 67', '(0533) 123-45-67', '+905331234567', '0090-533-123-45-67', '533.123.45.67', ' 0 533 123 45 67 ', '5331234567']
  eq('phone: every mobile form -> +905331234567', MOB.map(i => normalizePhone(i)), MOB.map(() => ({ ok: true, value: '+905331234567' })))
  eq('phone: every mobile form displays "+90 533 123 45 67"', MOB.map(i => formatPhone(normalizePhone(i).value)), MOB.map(() => '+90 533 123 45 67'))
  const LAND = ['+90 392 123 45 67', '0090 392 123 45 67', '0392 123 45 67', '392 123 45 67', '(0392) 123-45-67', '+903921234567']
  eq('phone: every landline form -> +903921234567 / "+90 392 123 45 67"', LAND.map(i => [normalizePhone(i).value, formatPhone(normalizePhone(i).value)]), LAND.map(() => ['+903921234567', '+90 392 123 45 67']))
  eq('phone: formatting is idempotent (editor re-blur, stored -> shown)', [normalizePhone('+90 533 123 45 67').value, formatPhone('+90 533 123 45 67'), formatPhone('+905331234567')], ['+905331234567', '+90 533 123 45 67', '+90 533 123 45 67'])
  eq('phone: empty / whitespace / null / undefined -> ok null', ['', '   ', '\n\t', null, undefined, ' - '].map(i => normalizePhone(i)), Array(6).fill({ ok: true, value: null }))
  const BAD = ['533 123 45 6', '0533 123 45 678', '05331234abc', '+44 7700 900123', '+357 99 123456', '00357 99123456', '0412 345 67 89', '0212 345 67 89', '4331234567', '0312 123 45 67', '+90 212 345 67 89', '533 123 45 67 8', '++905331234567', '90 533 123 45 67', '+90533123456', '392 123 45 6', '+90 392 123 45 678', '+', '0', '5'.repeat(60), '+90 5\u202E33 123 45 67x', 'abc', '533-123-45-67 ext 2']
  eq('phone: rejects', BAD.map(i => [i, normalizePhone(i).ok]), BAD.map(i => [i, false]))
  eq('phone: non-string -> rejected', [5331234567, {}, [], true].map(i => normalizePhone(i).ok), [false, false, false, false])
  eq('phone: formatPhone of an invalid value -> empty', [formatPhone('x'), formatPhone(null), formatPhone(5331234567), formatPhone('+44 7700 900123')], ['', '', '', ''])
  // stored with the address, sanitised on load
  const PE = { ...E, id: 'p1' }
  eq('entry: valid phone is stored canonical; none -> null', [AB.normalizeEntry({ ...PE, phone: '0533 123 45 67' }).phone, AB.normalizeEntry(PE).phone, AB.normalizeEntry({ ...PE, phone: '' }).phone], ['+905331234567', null, null])
  eq('entry: malformed stored phone (number, object, array, long string, forged text) -> dropped, entry survives',
    [5331234567, { a: 1 }, ['+905331234567'], 'x'.repeat(5000), '+905331234567\nADA Sipariş No: FAKE', 'tel: 123', NaN, true].map(v => { const e = AB.normalizeEntry({ ...PE, phone: v }); return [e.phone, e.street] }),
    Array(8).fill([null, 'Örnek Sokak']))
  eq('book: a stored phone survives a JSON round trip and update keeps / clears it', (() => {
    const b0 = AB.bookAdd(AB.emptyBook(), { ...E, phone: '533 123 45 67' }, 1, 'q1')
    const b1 = AB.normalizeBook(JSON.stringify(b0.book))
    const kept = AB.bookUpdate(b1, 'q1', { floor: '3' }, 2).item.phone
    const cleared = AB.bookUpdate(b1, 'q1', { phone: null }, 3).item.phone
    return [b1.items[0].phone, kept, cleared]
  })(), ['+905331234567', '+905331234567', null])
  eq('addressComplete ignores the phone (optional)', [addressComplete({ kind: 'home', district: 'a', street: 'b', building: 'c', phone: 'garbage' }), addressComplete({ kind: 'home', district: 'a', street: 'b', phone: '+905331234567' })], [true, false])
  // the message
  const PH = ' · Teslimatta aranacak: +90 533 123 45 67'
  const withP = MSG({ ...E, lat: 35.18974, lng: 33.34972, phone: '+905331234567' })
  eq('line: phone sits right after the address, before Tarif, Konum, Koordinat', withP,
    BASE + 'Ev: Örnek Sokak No 12, Kat 2, Daire 5, Kumsal' + PH + ' · Tarif: Mavi kapı, zile iki kez bas · Konum (haritada aç): ' + LINK + KOORD)
  eq('line: no phone / null / empty / invalid stored -> no phone part', [undefined, null, '', 'garbage', 5331234567, '+44 7700 900123'].map(v => MSG({ ...E, phone: v }).includes('aranacak')), Array(6).fill(false))
  eq('line: without a phone the line is unchanged', MSG({ kind: 'home', district: 'Kumsal', street: 'Örnek Sokak', building: '12' }), BASE + 'Ev: Örnek Sokak No 12, Kumsal')
  eq('line: phone only, no tarif / pin', MSG({ kind: 'home', district: 'Kumsal', street: 'Örnek Sokak', building: '12', phone: '0392 123 45 67' }), BASE + 'Ev: Örnek Sokak No 12, Kumsal · Teslimatta aranacak: +90 392 123 45 67')
  const forgeP = buildOrderMessage(lines, '', 'K7M4Q9XB', { mode: 'delivery', ...E, phone: '+905331234567\nADA Sipariş No: FAKE\u0085Teslimat: Gel-al' }).split('\n')
  eq('stored-garbage phone cannot forge a line; code line stays LAST', [forgeP.filter(l => l.startsWith('Teslimat')).length, forgeP.filter(l => l.startsWith('ADA Sipariş No')).length, forgeP.at(-1).startsWith('ADA Sipariş No: K7M4-Q9XB'), forgeP.join('\n').includes('FAKE')], [1, 1, true, false])
  const fullP = buildOrderMessage(lines, '', 'K7M4Q9XB', { mode: 'delivery', ...E, phone: '+905331234567' }).split('\n')
  eq('message with a phone: Teslimat line carries it, code line LAST', [fullP.find(l => l.startsWith('Teslimat')).includes(PH), fullP.at(-1).startsWith('ADA Sipariş No')], [true, true])
  // the phone never reaches the server call
  const PB = [{ id: 'a', qty: 2, ...E, phone: '+905331234567', tel: '+905331234567' }, { id: 'b', qty: 1, phone: '0533 123 45 67' }]
  const pArgs = orderRpcArgs('p', PB)
  eq('orderRpcArgs: lines carrying a phone -> args without it', [JSON.stringify(pArgs).includes('5331234567'), JSON.stringify(pArgs).includes('533 123'), JSON.stringify(pArgs).includes('phone'), pArgs.p_items.map(i => Object.keys(i))], [false, false, false, [['item_id', 'qty'], ['item_id', 'qty']]])

  // areas
  eq('nearestArea: an AREA_POINTS point -> its name', nearestArea(35.18974, 33.34972), 'Kumsal')
  eq('nearestArea: ~50 m off still Kumsal', nearestArea(35.1902, 33.34972), 'Kumsal')
  // 35.17,33.36 is south of the buffer zone (resolveRegion null) yet within 2 km of Köşklüçiftlik: only the region guard keeps it ''.
  eq('nearestArea: a pin just outside the TRNC but within 2 km of an area point -> empty', nearestArea(35.17, 33.36), '')
  eq('nearestArea: >2 km from every point -> empty', [nearestArea(35.25, 33.0), nearestArea(34.9, 33.6), nearestArea(NaN, 1), nearestArea(51.5, -0.1)], ['', '', '', ''])
  eq('NEAREST_AREA_MAX_KM is 2', NEAREST_AREA_MAX_KM, 2)
  eq('searchAreas: kumsal / KUMSAL / Kumsal', ['kumsal', 'KUMSAL', 'Kumsal'].map(q => searchAreas(q)[0]?.name), ['Kumsal', 'Kumsal', 'Kumsal'])
  eq('searchAreas: gonyeli -> Gönyeli with its point', searchAreas('gonyeli').map(a => [a.name, a.region, a.lat, a.lng]), [['Gönyeli', 'nicosia', 35.21642, 33.30582]])
  eq('searchAreas: Turkish folding both ways', [searchAreas('GÖNYELİ')[0]?.name, searchAreas('kucuk kaymakli')[0]?.name, searchAreas('YENISEHIR')[0]?.name, searchAreas('Yenişehir')[0]?.name], ['Gönyeli', 'Küçük Kaymaklı', 'Yenişehir', 'Yenişehir'])
  eq('searchAreas: empty / no match -> []', [searchAreas(''), searchAreas('   '), searchAreas('zzzz')], [[], [], []])
  eq('searchAreas: an area with no OSM point is never offered (Dereboyu)', searchAreas('dereboyu'), [])

  // editor back
  eq('editorBack: 3 -> 2 -> 1 -> closed', [editorBack(3), editorBack(2), editorBack(1), editorBack(0), editorBack(undefined)], [2, 1, 'closed', 'closed', 'closed'])

  // building "No" strip
  const NB = b => MSG({ kind: 'home', district: 'K', street: 'Eski Sokak', building: b })
  eq('building: a leading "No" in any spelling is not doubled', ['No 4', 'No: 4', 'no.4', 'NO  4', 'no:4'].map(NB), Array(5).fill(BASE + 'Ev: Eski Sokak No 4, K'))
  eq('building: "4" and a building that merely starts with the letters "no" are kept', [NB('4'), NB('Nova 3'), NB('12/No 4')], [BASE + 'Ev: Eski Sokak No 4, K', BASE + 'Ev: Eski Sokak No Nova 3, K', BASE + 'Ev: Eski Sokak No 12/No 4, K'])
  eq('building: only "No" keeps itself', NB('No'), BASE + 'Ev: Eski Sokak No No, K')

  // Back ordering on the partner page
  const calls = []
  const BK = o => { calls.length = 0; return { r: eateryPartnerBack({ editorOpen: false, editorStep: 1, pickerOpen: false, basketOpen: false, viewing: false, ...o, quizBack: () => { calls.push('quiz'); return !!o.quizBack } }), calls: [...calls] } }
  eq('back: editor step 3 -> 2, 2 -> 1, 1 -> closed', [3, 2, 1].map(st => BK({ editorOpen: true, editorStep: st }).r), [{ layer: 'editor', step: 2, picker: false }, { layer: 'editor', step: 1, picker: false }, { layer: 'editor', close: true }])
  eq('back: the map picker goes back to step 2 whatever the step', BK({ editorOpen: true, editorStep: 2, pickerOpen: true }).r, { layer: 'editor', step: 2, picker: false })
  eq('back: the editor beats the quiz and the basket, and the quiz is not even asked', BK({ editorOpen: true, editorStep: 3, quizBack: true, basketOpen: true }), { r: { layer: 'editor', step: 2, picker: false }, calls: [] })
  eq('back: no editor -> the quiz first, then the basket, then the photo, else nothing', [BK({ quizBack: true, basketOpen: true }).r, BK({ basketOpen: true, viewing: true }).r, BK({ viewing: true }).r, BK({}).r], [{ layer: 'quiz' }, { layer: 'basket' }, { layer: 'viewing' }, null])
  eq('back: the quiz is asked before the basket', BK({ basketOpen: true }).calls, ['quiz'])
  const screenSrc = fs.readFileSync(new URL('../screens/EateryPartnerScreen.js', import.meta.url), 'utf8')
  eq('screen: the backRef effect goes through eateryPartnerBack', /eateryPartnerBack\(\{/.test(screenSrc.replace(/\/\/.*$/gm, '')), true)

  // editor logic
  const ok3 = { district: 'K', street: 'S', building: '1' }
  eq('editorStartStep: new 1; complete 3; unnamed Diğer 1; named-but-short Diğer 3', [editorStartStep(null), editorStartStep({ kind: 'home', ...ok3 }), editorStartStep({ kind: 'other', name: '', ...ok3 }), editorStartStep({ kind: 'other', name: 'Anne', district: 'K', street: '', building: '' }), firstIncompleteStep({ kind: 'home' })], [1, 3, 1, 3, 3])
  eq('addressMissing: order name, district, street, building; home never needs a name', [addressMissing({ kind: 'other' }), addressMissing({ kind: 'home', street: 'S' }), addressMissing({ kind: 'work', ...ok3 }), addressMissing({ kind: 'other', name: '\u200B', ...ok3 })], [['name', 'district', 'street', 'building'], ['district', 'building'], [], ['name']])
  eq('addressMissing agrees with addressComplete', [{ kind: 'home' }, { kind: 'home', ...ok3 }, { kind: 'other', ...ok3 }].map(e => addressMissing(e).length === 0 === addressComplete(e)), [true, true, true])
  eq('districtPrefill: only when empty and a pin exists', [districtPrefill({ district: '', lat: 35.18974, lng: 33.34972 }), districtPrefill({ district: '  ', lat: 35.18974, lng: 33.34972 }), districtPrefill({ district: 'Girne', lat: 35.18974, lng: 33.34972 }), districtPrefill({ district: '', lat: null, lng: null }), districtPrefill({ district: '', lat: 35.25, lng: 33.0 })], ['Kumsal', 'Kumsal', '', '', ''])
  eq('searchAreasTop: capped at PIN_SEARCH_MAX, same order as searchAreas', [PIN_SEARCH_MAX, searchAreas('a').length > PIN_SEARCH_MAX, searchAreasTop('a').length, JSON.stringify(searchAreasTop('a')) === JSON.stringify(searchAreas('a').slice(0, PIN_SEARCH_MAX))], [8, true, 8, true])
  eq('NICOSIA start', NICOSIA, { lat: 35.1856, lng: 33.3823 })
  eq('deliveryFromEntry: pin -> coords, id -> addressId, no updatedAt/lat/lng left over', deliveryFromEntry({ id: 'x', kind: 'other', name: '', district: 'K', street: 'S', building: '1', floor: '', flat: '', directions: '', lat: 35.1, lng: 33.2, updatedAt: 5 }), { kind: 'other', name: '', district: 'K', street: 'S', building: '1', floor: '', flat: '', directions: '', addressId: 'x', coords: { lat: 35.1, lng: 33.2 } })
  eq('deliveryFromEntry: no pin -> coords null; same keys as the empty state', [deliveryFromEntry({ id: 'x', kind: 'home', name: '', district: '', street: '', building: '', floor: '', flat: '', directions: '', lat: null, lng: null }).coords, Object.keys(deliveryFromEntry({ id: 'x', kind: 'home', name: '', district: '', street: '', building: '', floor: '', flat: '', directions: '', lat: null, lng: null })).sort()], [null, Object.keys(EMPTY_DELIVERY_ADDRESS).sort()])
  const full = { id: 'x', kind: 'home', name: '', district: 'Karakol', street: 'Atatürk Cd.', building: 'No: 4', floor: '2', flat: '5', directions: 'mavi kapı', lat: 35.1, lng: 33.2 }
  eq('shortAddress: "<sokak> No <bina>, <mahalle>"; the old "No" prefix is not doubled; floor / flat / directions stay out', shortAddress(full), 'Atatürk Cd. No 4, Karakol')
  eq('shortAddress: sanitized (invisible chars, newlines) and partial entries', [shortAddress({ street: ' a\u202E\n b ', building: '', district: 'K' }), shortAddress({ building: '7', district: '' }), shortAddress({}), shortAddress(null)], ['a b, K', 'No 7', '', ''])
  eq('cardState: none / incomplete / noPin / pin (book entry and delivery state)', [cardState(null), cardState({ ...full, street: '' }), cardState({ ...full, kind: 'other', name: '' }), cardState({ ...full, lat: null, lng: null }), cardState(full), cardState(deliveryFromEntry(full)), cardState(deliveryFromEntry({ ...full, lat: null, lng: null }))], ['none', 'incomplete', 'incomplete', 'noPin', 'pin', 'pin', 'noPin'])
  eq('canAddMore: the 10th fits, the 11th does not', [canAddMore(0), canAddMore(9), canAddMore(10), canAddMore(NaN)], [true, true, false, false])
}

// ─── Better fix before the pin: pure selection + the refine loop (fake watcher, fake clock) ───
{
  const F = (acc, lat = 35.1, lng = 33.3) => ({ coords: { latitude: lat, longitude: lng, accuracy: acc } })
  eq('constants: 6 s window, stop at 10 m, poor above 15 m', [LOCATE_REFINE_MS, LOCATE_GOOD_M, LOCATE_POOR_M], [6000, 10, 15])
  eq('pickBestFix: smallest accuracy wins', pickBestFix([F(40), F(12), F(25)]).coords.accuracy, 12)
  eq('pickBestFix: tie keeps the earlier', pickBestFix([F(20, 1, 1), F(20, 2, 2)]).coords.latitude, 1)
  eq('pickBestFix: invalid fixes ignored (NaN / missing / out of range / null)', pickBestFix([F(1, NaN, 3), { coords: {} }, null, undefined, F(2, 95, 0), F(3, 0, 200), F(50)]).coords.accuracy, 50)
  eq('pickBestFix: nothing usable -> null (also for non-arrays)', [pickBestFix([]), pickBestFix([F(5, NaN, 1)]), pickBestFix(null)], [null, null, null])
  eq('pickBestFix: a fix with no accuracy ranks last but counts', [pickBestFix([{ coords: { latitude: 1, longitude: 2 } }, F(80)]).coords.accuracy, pickBestFix([{ coords: { latitude: 1, longitude: 2 } }]).coords.latitude], [80, 1])
  eq('accuracyNote: nothing at <= 15, otherwise rounded UP to 5 (never <= 15)', [accuracyNote(15), accuracyNote(15.1), accuracyNote(16), accuracyNote(20), accuracyNote(22), accuracyNote(40.4), accuracyNote(5), accuracyNote(null), accuracyNote(NaN), accuracyNote(undefined)], [null, 20, 20, 20, 25, 45, null, null, null, null])
  // fake clock + fake watcher with a remove counter
  const rig = (late = false) => {
    const r = { removed: 0, cb: null, timers: [], cleared: 0, subscribed: 0 }
    const sub = { remove: () => { r.removed++ } }
    r.watch = cb => { r.cb = cb; r.subscribed++; return late ? new Promise(res => { r.give = () => res(sub) }) : Promise.resolve(sub) }
    r.setT = (fn, ms) => { r.timers.push({ fn, ms }); return r.timers.length }
    r.clearT = () => { r.cleared++ }
    r.fire = () => r.timers[0].fn()
    r.opts = { setT: r.setT, clearT: r.clearT }
    return r
  }
  const tick = () => new Promise(res => setImmediate(res))
  // a broken early stop must print FAIL, not hang the run (an unsettled top-level await exits 13); the sentinel is fix-shaped so .coords.accuracy reads don't throw
  const bd = p => { let t; return Promise.race([p, new Promise(res => { t = setTimeout(() => res({ coords: { accuracy: 'HUNG (never settled)' } }), 500) })]).finally(() => clearTimeout(t)) }
  { const r = rig(); const h = refineFix(r.watch, r.opts); await tick()
    eq('refine: timer armed with LOCATE_REFINE_MS', r.timers[0].ms, LOCATE_REFINE_MS)
    r.cb(F(40)); r.cb(F(18)); r.cb(F(30)); eq('refine: still listening while no fix is <= 10 m', r.removed, 0)
    r.cb(F(9)); const best = await bd(h.done)
    eq('refine: early stop at <= 10 m returns that fix and removes the watcher once', [best.coords.accuracy, r.removed, r.cleared], [9, 1, 1])
    r.cb(F(1)); r.fire(); h.stop(); await tick(); eq('refine: later fixes / timer / stop change nothing; still removed once', r.removed, 1) }
  { const r = rig(); const h = refineFix(r.watch, r.opts); await tick(); r.cb(F(40)); r.cb(F(18)); r.cb(F(30)); r.cb(F(1, NaN, 1))
    r.fire(); const best = await bd(h.done)
    eq('refine: timeout keeps the BEST fix so far (18 m, the invalid 1 m ignored), watcher removed once', [best.coords.accuracy, r.removed], [18, 1]) }
  { const r = rig(); const h = refineFix(r.watch, r.opts); await tick(); r.fire()
    eq('refine: timeout with no fix -> null (caller falls back to the one-shot chain), watcher removed', [await bd(h.done), r.removed], [null, 1]) }
  { const r = rig(); const h = refineFix(r.watch, r.opts); await tick(); r.cb(F(30)); h.stop()
    eq('refine: stop() (Back / editor closed / unmount) resolves with the best so far and removes the watcher', [(await bd(h.done)).coords.accuracy, r.removed], [30, 1]) }
  { const r = rig(true); const h = refineFix(r.watch, r.opts); await tick(); r.fire(); const best = await bd(h.done); r.give(); await tick()
    eq('refine: the watcher that arrives AFTER the exit is removed the moment it arrives (exactly once)', [best, r.removed], [null, 1]) }
  { const r = rig(true); const h = refineFix(r.watch, r.opts); await tick(); h.stop(); r.give(); await tick(); h.stop(); r.fire()
    eq('refine: stop before the subscription exists -> still removed once, no double remove', r.removed, 1) }
  { const r = rig(); const h = refineFix(r.watch, r.opts); h.stop(); await tick()
    eq('refine: stop before the watcher was even started -> it is never started', [r.subscribed, r.removed, await bd(h.done)], [0, 0, null]) }
  { const r = { removed: 0, cleared: 0, timers: [] }; const h = refineFix(() => Promise.reject(new Error('services off')), { setT: fn => { r.timers.push(fn); return 1 }, clearT: () => { r.cleared++ } })
    eq('refine: watch() rejects (services off, declined) -> null at once, timer cleared', [await bd(h.done), r.cleared], [null, 1]) }
  { const r = { removed: 0 }; const h = refineFix(() => null, { setT: () => 1, clearT: () => {} }); await tick(); h.stop()
    eq('refine: watch() resolves null (no subscription) -> no crash', await bd(h.done), null) }
  { const r = rig(); const h = refineFix(cb => { cb(F(5)); return Promise.resolve({ remove: () => { r.removed++ } }) }, r.opts); const best = await bd(h.done); await tick()
    eq('refine: a fix delivered before the subscription returns still stops early and removes the watcher', [best.coords.accuracy, r.removed], [5, 1]) }
  // wiring: the device code uses exactly this loop, with the services-aware watch, Highest accuracy, and never leaves it running
  const dl = fs.readFileSync(new URL('../utils/deliveryLocate.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
  eq('wiring: getFix refines through askedWatch at Accuracy.Highest, then the old chain', [/refineFix\(watch\)/.test(dl), /askedWatch\(\{ accuracy: Location\.Accuracy\.Highest/.test(dl), /askedFix\(Location\.Accuracy\.Balanced\)/.test(dl)], [true, true, true])
  eq('wiring: unmount cancels the search; the editor cancels on Back / close', [/alive\.current = false; cancel\(\)/.test(dl), /gps\.cancel\(\)/.test(fs.readFileSync(new URL('../components/AddressEditor.js', import.meta.url), 'utf8'))], [true, true])
  const ed = fs.readFileSync(new URL('../components/AddressEditor.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
  eq('wiring: a GPS fix is NEVER saved straight away: useCurrent only opens the picker; pinChosen is the only writer of a pin (the other is Remove = null)', [/const useCurrent[\s\S]*?openPicker\(p\)/.test(ed), (ed.match(/set\(\{ coords: (?!null)/g) || []).length, /const useCurrent[^}]*set\(/.test(ed)], [true, 1, false])
  const pk = fs.readFileSync(new URL('../components/DeliveryPinPicker.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
  eq('askFreshFix: skipped only when services are known off', [askFreshFix(false), askFreshFix(true), askFreshFix(undefined)], [false, true, true])
  eq('wiring: getFix checks services before the fresh fix and uses askFreshFix', [/hasServicesEnabledAsync[\s\S]*askFreshFix\(servicesOn\) \? await withTimeout\(askedFix/.test(dl)], [true])
  eq('wiring: goTo clears the accuracy note (any programmatic move); goMe sets it AFTER goTo; the map label carries it', [/const goTo = [^\n]*\n\s*setAcc\(null\)/.test(pk), /goTo\(p\.lat, p\.lng, AREA_DELTA \/ 2\); setAcc\(p\.accuracy\)/.test(pk), /eateryPinMapA11y'[^\n]*accText/.test(pk), /useState\(start\.accuracy \?\? null\)/.test(pk)], [true, true, true, true])
  eq('wiring: the picker hands back lat / lng only (no accuracy) and shows the note from state', [/onUse\(centre\.current\)/.test(pk), /centre\.current = \{ lat: r\.latitude, lng: r\.longitude \}/.test(pk)], [true, true])
}

// U+0085 (NEL) is not in JS \s; it must not survive into a note or address either.
eq('NEL does not survive in a note', buildOrderMessage(lines, 'a\u0085b').split('\n').find(l => l.startsWith('Not: ')), 'Not: a b')
eq('NEL does not survive in an address field', sanitizeAddressField('x\u0085y'), 'x y')

console.log(bad ? `eatery order: ${bad} FAILED` : 'eatery order: OK')
if (bad) process.exit(1)

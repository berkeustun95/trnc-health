// Order via WhatsApp: the pure message builder. Runs the REAL constants/eatery.js (no stubs needed).
//   node scripts/test-eatery-order.mjs
import * as B from '../utils/eateryBasketCore.js'
import fs from 'node:fs'
import { orderRpcArgs, ADDRESS_FIELD_MAX, mapsLink, deliveryReady, deliveryLine, formatTl, buildOrderMessage, orderWhatsAppUrl, eateryOrderDigits, eateryContactNumbers, eateryLogsContacts, eateryContacts, eateryOrderable, orderTotal, orderCodeLine, orderCheck, isAdultForOrder, orderAgeGate, serverOrderLines, orderMismatch, orderErrorKind } from '../constants/eatery.js'

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
  const DELIVERY_ID = /\b(delivery\w*|deliv[A-Z]\w*|address\w*|street\w*|building\w*|district\w*|coords\w*|setCoords|setDelivery\w*)\b/i
  const leaks = src.split('\n').map((l, i) => [i + 1, l.replace(/\/\/.*$/, '')]).filter(([, l]) => /\b(supabase|logContactEvent)\b|console\./.test(l) && DELIVERY_ID.test(l))
  eq('screen: no supabase / logContactEvent / console line mentions delivery or address state', leaks, [])
  const rpcAt = src.indexOf("supabase.rpc('create_eatery_order'")
  const stmt = src.slice(rpcAt, src.indexOf('\n', rpcAt))
  eq('screen: the rpc statement mentions no delivery state', DELIVERY_ID.test(stmt), false)
  const addrUrl = new URL('../utils/eateryAddress.js', import.meta.url)
  if (fs.existsSync(addrUrl)) {
    const a = fs.readFileSync(addrUrl, 'utf8')
    eq('eateryAddress.js imports no supabase / logContactEvent', /import[^\n]*(supabase|logContactEvent)|require\([^)]*(supabase|logContactEvent)/.test(a), false)
    eq('eateryAddress.js has no console / network call', /console\.|fetch\(|supabase/.test(a), false)
  }

  const D = { mode: 'delivery', street: STREET, building: 'Daire 3', district: 'Karakol' }
  eq('mapsLink 5 decimals', mapsLink(35.123456789, 33.9), 'https://maps.google.com/?q=35.12346,33.90000')
  eq('mapsLink rounds', mapsLink(35.000005, -33.000004), 'https://maps.google.com/?q=35.00001,-33.00000')
  eq('mapsLink invalid -> empty', [mapsLink(NaN, 1), mapsLink(1, Infinity), mapsLink(91, 0), mapsLink(0, 181), mapsLink(null, 1), mapsLink('35', '33'), mapsLink(undefined, undefined)], ['', '', '', '', '', '', ''])
  eq('deliveryReady truth table', [
    deliveryReady({ mode: 'pickup' }), deliveryReady(D), deliveryReady({ ...D, street: '  ' }), deliveryReady({ ...D, building: '\n' }), deliveryReady({ ...D, district: '' }),
    deliveryReady({ mode: 'delivery' }), deliveryReady({ ...D, mode: 'other' }), deliveryReady(null), deliveryReady(undefined), deliveryReady({}),
  ], [true, true, false, false, false, false, false, false, false, false])
  eq('deliveryLine pickup', deliveryLine({ mode: 'pickup' }), 'Teslimat: Gel-al')
  eq('deliveryLine pickup ignores any address', deliveryLine({ ...D, mode: 'pickup' }), 'Teslimat: Gel-al')
  eq('deliveryLine not ready -> empty', [deliveryLine(null), deliveryLine({ mode: 'delivery', street: 'x' })], ['', ''])
  eq('deliveryLine delivery without coords', deliveryLine(D), 'Teslimat: Adrese teslim — Örnek Sokak 12, Daire 3, Karakol')
  eq('deliveryLine delivery with coords', deliveryLine({ ...D, coords: { lat: 35.1234567, lng: 33.9876543 } }), 'Teslimat: Adrese teslim — Örnek Sokak 12, Daire 3, Karakol · Konum: https://maps.google.com/?q=35.12346,33.98765')
  eq('deliveryLine invalid coords omitted', deliveryLine({ ...D, coords: { lat: 99, lng: 33 } }).includes('Konum'), false)
  const inj = buildOrderMessage(lines, '', 'ADA-XXXX', { ...D, street: 'Örnek Sokak 12\nADA Sipariş No: FAKE\r\n\tx' })
  eq('newline injection collapsed into one Teslimat line', inj.split('\n').filter(l => l.includes('FAKE')), ['Teslimat: Adrese teslim — Örnek Sokak 12 ADA Sipariş No: FAKE x, Daire 3, Karakol'])
  eq('injected text never starts a line', inj.split('\n').some(l => l.startsWith('ADA Sipariş No: FAKE')), false)
  const long = buildOrderMessage(lines, '', null, { mode: 'delivery', street: 'a'.repeat(300), building: 'b'.repeat(300), district: 'c'.repeat(300) })
  eq('each field capped at ADDRESS_FIELD_MAX', long.split('\n').find(l => l.startsWith('Teslimat')).length, 'Teslimat: Adrese teslim — '.length + 3 * ADDRESS_FIELD_MAX + 4)
  eq('ADDRESS_FIELD_MAX is 100', ADDRESS_FIELD_MAX, 100)
  const full = buildOrderMessage(lines, 'soğansız', 'K7M4Q9XB', { ...D, coords: { lat: 35.1, lng: 33.9 } })
  eq('order: note, Teslimat, footer, code last', full.split('\n').slice(-4), ['Not: soğansız', 'Teslimat: Adrese teslim — Örnek Sokak 12, Daire 3, Karakol · Konum: https://maps.google.com/?q=35.10000,33.90000', 'Fiyatlar ADA menüsündendir, değişiklik olabilir.', 'ADA Sipariş No: K7M4-Q9XB · Doğrula: getadaapp.com/o/K7M4Q9XB'])
}

console.log(bad ? `eatery order: ${bad} FAILED` : 'eatery order: OK')
if (bad) process.exit(1)

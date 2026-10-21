// Order via WhatsApp: the pure message builder. Runs the REAL constants/eatery.js (no stubs needed).
//   node scripts/test-eatery-order.mjs
import * as B from '../utils/eateryBasketCore.js'
import { formatTl, buildOrderMessage, orderWhatsAppUrl, eateryOrderDigits, eateryOrderable, orderTotal, orderCodeLine, serverOrderLines, orderMismatch, orderErrorKind } from '../constants/eatery.js'

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
  const E = (message, code = 'P0001', details = null) => ({ code, message, details })
  eq('error kinds', [E('rate_limited'), E('order_requires_account'), E('item_unavailable'), E('invalid_items'), E('partner_unavailable'), E('mixed_currency'), E('boom'), { message: 'Network request failed' }, null].map(orderErrorKind),
    ['rate', 'account', 'items', 'items', 'generic', 'items', 'generic', 'generic', 'generic'])
}

console.log(bad ? `eatery order: ${bad} FAILED` : 'eatery order: OK')
if (bad) process.exit(1)

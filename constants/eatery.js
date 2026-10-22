// Yeme-İçme (eatery partners) — pure helpers behind EateryScreen / EateryPartnerScreen, in the
// petPartnerSections() mould: emptiness is decided HERE, so a screen renders what it is given and
// partner #2 is data only. Plain JS, no React, no network.
import { dateLocale, t } from './i18n.js'
import { cyprusNow, openState } from '../utils/towingHours.js'
import { ADULT_AGE } from './profileGate.js'

export const EATERY_BUCKET = 'eatery-images'

export const EATERY_CATEGORY_KEY = {
  fast_food:  'eateryCatFastFood',
  restaurant: 'eateryCatRestaurant',
  cafe:       'eateryCatCafe',
  bakery:     'eateryCatBakery',
  dessert:    'eateryCatDessert',
}

// towing_hours shape keys, Monday first (the existing towingDay* labels).
export const EATERY_DAYS = [
  ['mon', 'towingDayMon'], ['tue', 'towingDayTue'], ['wed', 'towingDayWed'], ['thu', 'towingDayThu'],
  ['fri', 'towingDayFri'], ['sat', 'towingDaySat'], ['sun', 'towingDaySun'],
]

// A partner behind its own dark flag stays out of a live section (CRUNCHY_EXPRESS_LIVE).
// gates = { <slug>: boolean }; a slug with no gate is visible. Shared by the list and the map.
export const eateryPartnerVisible = (row, gates) => gates?.[row?.slug] !== false

const filled = v => typeof v === 'string' && v.trim().length > 0
const https = v => (filled(v) && /^https:\/\/\S+$/.test(v.trim()) ? v.trim() : null)

// The ONLY place a partner's phone/WhatsApp is turned into a number to dial or message (calls, wa.me, orders).
// Production: the partner's own numbers; testNumber is ignored. ADA Preview: ALWAYS the test number, never the
// partner's own, and no test number = no contact at all (fail closed). A fixture partner has none either way.
// A dev server / Expo Go (isDev, not Preview) gets nothing either: a dev session must never dial a real shop.
export function eateryContactNumbers(p, { isPreview = false, testNumber = null, isDev = false } = {}) {
  if (!p || p.placeholder) return { phone: null, whatsapp: null }
  if (isPreview === true) {
    const n = filled(testNumber) ? testNumber.trim() : null
    return { phone: n, whatsapp: n }
  }
  if (isDev === true) return { phone: null, whatsapp: null }
  return { phone: filled(p.phone) ? p.phone.trim() : null, whatsapp: filled(p.whatsapp) ? p.whatsapp.trim() : null }
}

// Test taps (Preview, dev) must not count toward a real partner's contact_events once it is live.
export const eateryLogsContacts = ({ isPreview = false, isDev = false } = {}) => isPreview !== true && isDev !== true

// One entry per contact button that has something behind it; an empty field yields no entry.
// action is the contact_events action ('call' | 'whatsapp' | 'website' | 'maps'). nums = eateryContactNumbers(...).
export function eateryContacts(p, nums) {
  const out = []
  const phone = filled(nums?.phone) ? nums.phone.replace(/[^\d+]/g, '') : ''
  if (phone.length > 3) out.push({ action: 'call', url: `tel:${phone}`, value: nums.phone.trim() })
  const wa = filled(nums?.whatsapp) ? nums.whatsapp.replace(/\D/g, '') : ''
  if (wa.length > 3) out.push({ action: 'whatsapp', url: `https://wa.me/${wa}`, value: nums.whatsapp.trim() })
  const site = https(p?.website_url)
  if (site) out.push({ action: 'website', url: site, value: null })
  const maps = https(p?.maps_url)
  if (maps) out.push({ action: 'maps', url: maps, value: null })
  return out
}

export const eateryMenuUrl = p => https(p?.menu_url)

// photoPath: the stored file (null = none); photoPlaceholder: Preview fixture only, a labelled frame instead of a file.
const withDishPhoto = i => ({
  ...i,
  photoPath: filled(i.photo_path) ? i.photo_path : null,
  photoPlaceholder: i.photo_placeholder === true,
  aspect: i.photo_width > 0 && i.photo_height > 0 ? i.photo_width / i.photo_height : null,
})

// Available items grouped by section, in section_order then sort_order (id breaks ties).
export function eateryMenuSections(p) {
  const items = (p?.eatery_menu_items || []).filter(i => i && i.is_available !== false && filled(i.name))
  const by = new Map()
  for (const i of items) {
    if (!by.has(i.section)) by.set(i.section, { title: i.section, order: i.section_order ?? 0, items: [] })
    const g = by.get(i.section)
    g.order = Math.min(g.order, i.section_order ?? 0)
    g.items.push(i)
  }
  const cmp = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.id ?? 0) - (b.id ?? 0)
  return [...by.values()]
    .sort((a, b) => a.order - b.order)   // Array.sort is stable: ties keep first-seen (DB) order, never alphabetised
    .map(g => ({ title: g.title, items: g.items.sort(cmp).map(withDishPhoto) }))
}

// Photos of one kind ('gallery' | 'menu'), in order. path null = a placeholder slot (no file yet).
export function eateryPhotos(p, kind) {
  return (p?.eatery_photos || [])
    .filter(x => x && x.kind === kind)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.id ?? 0) - (b.id ?? 0))
    .map(x => ({
      key: String(x.id),
      path: filled(x.storage_path) ? x.storage_path : null,
      aspect: x.width > 0 && x.height > 0 ? x.width / x.height : null,
    }))
}

// Seven rows, Monday first; text null = closed that day. null when the partner gave no hours.
export function eateryWeek(p) {
  const h = p?.opening_hours
  if (!h || typeof h !== 'object') return null
  return EATERY_DAYS.map(([day, labelKey]) => {
    const w = h[day]
    return { day, labelKey, text: w && typeof w === 'object' && w.open && w.close ? `${w.open} – ${w.close}` : null }
  })
}

// Price in the reader's language and the row's currency. A stripped ICU build falls back to plain text.
export function formatPrice(price, currency, lang) {
  if (price == null || price === '' || !Number.isFinite(Number(price))) return ''
  const n = Number(price)
  try {
    return new Intl.NumberFormat(dateLocale(lang), { style: 'currency', currency: currency || 'TRY' }).format(n)
  } catch {
    return `${n.toFixed(2)} ${currency || ''}`.trim()
  }
}

// The open-now line for a card / header: { text, tone: 'ok' | 'warn' }, or null when the partner
// gave no hours (an absent line says nothing; a guessed "closed" would be a claim).
// A later-day opening names the day ("Kapalı · Pazartesi 09:00"): a bare "Açılış 09:00" reads as
// later today, which for a restaurant is a wasted trip.
export function eateryOpenStatus(p, lang, now = new Date()) {
  if (!p?.opening_hours || typeof p.opening_hours !== 'object') return null
  const st = openState(p, now)
  if (st.state === 'open') return { text: t('towingOpenNow', lang), tone: 'ok' }
  if (st.state === 'opens' && st.days >= 1) {
    const i = EATERY_DAYS.findIndex(([k]) => k === cyprusNow(now).day)
    const dayKey = EATERY_DAYS[(i + st.days) % 7][1]
    return { text: `${t('towingClosed', lang)} · ${t(dayKey, lang)} ${st.at}`, tone: 'neutral' }
  }
  if (st.state === 'opens') return { text: t('towingOpensAt', lang).replace('{time}', st.at), tone: 'neutral' }
  if (st.unknown) return null
  return { text: t('towingClosedToday', lang), tone: 'warn' }
}

// ─── Order via WhatsApp (pure; the basket itself lives in utils/eateryBasket.js) ───────────────
// A dish can be ordered when it has a real price and is on today's menu; a priced-nothing dish has no control.
export const eateryOrderable = i => !!i && i.is_available !== false && i.price != null && i.price !== '' && Number.isFinite(Number(i.price))
export const ORDER_NOTE_MAX = 200

// wa.me wants digits only (country code first). Same rule as eateryContacts(); null when too short to dial.
export const eateryOrderDigits = wa => {
  const d = filled(wa) ? wa.replace(/\D/g, '') : ''
  return d.length > 3 ? d : null
}

// "1.240,00 TL": the order message is always Turkish, so the format is fixed here instead of leaning on
// Intl('tr-TR'), which a stripped ICU build would turn into something else. Integer cents: no float drift.
export function formatTl(amount) {
  const cents = Math.round(Number(amount) * 100)
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const lira = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${sign}${lira},${String(abs % 100).padStart(2, '0')} TL`
}

export const orderTotal = lines => lines.reduce((sum, l) => sum + Math.round(l.qty * Number(l.price) * 100), 0) / 100

// ─── Server-recorded order (create_eatery_order, 20261125) ───
// The app asks the server to record the order FIRST; the WhatsApp text is built from what the server answered
// (names, quantities, DATABASE prices) and ends with a code the partner can verify at getadaapp.com/o/<code>.
const ORDER_CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/
export function orderCodeLine(code) {
  const c = typeof code === 'string' ? code.trim().toUpperCase() : ''
  if (!ORDER_CODE.test(c)) return ''
  return `ADA Sipariş No: ${c.slice(0, 4)}-${c.slice(4)} · Doğrula: getadaapp.com/o/${c}`
}

// The server's lines in the shape buildOrderMessage reads: [{ id, name, qty, price }].
export const serverOrderLines = res => (Array.isArray(res?.lines) ? res.lines : [])
  .map(l => ({ id: l.item_id, name: l.name, qty: Number(l.qty), price: Number(l.unit_price) }))

const cents = n => Math.round(Number(n) * 100)

// True when the server's answer is not exactly the basket the person saw: a line missing or extra, a different
// quantity, a different unit price, or a different total. A malformed answer counts as a mismatch. Then NOTHING is sent.
export function orderMismatch(basketLines, res) {
  if (!res || !Array.isArray(res.lines) || res.lines.length === 0 || !Number.isFinite(Number(res.total))) return true
  const srv = serverOrderLines(res)
  if (srv.length !== basketLines.length) return true
  for (const b of basketLines) {
    const m = srv.find(l => l.id === b.id)
    if (!m || m.qty !== Number(b.qty) || cents(m.price) !== cents(b.price)) return true
  }
  return cents(res.total) !== cents(orderTotal(basketLines))
}

// null = the server's answer may be sent; else 'prices' (not the basket the person saw) or 'generic' (no valid code: a message
// ADA cannot verify is never sent).
export function orderCheck(basketLines, res) {
  if (orderMismatch(basketLines, res)) return 'prices'
  return orderCodeLine(res.code) ? null : 'generic'
}

// 18+ ordering (adult_only partners). Age by the calendar date in Europe/Istanbul (fixed UTC+3 since 2016), dob 'YYYY-MM-DD'.
// A missing or malformed dob is NOT an adult. ADULT_AGE is the one shared constant (constants/profileGate.js).
export function isAdultForOrder(dob, now = new Date()) {
  if (typeof dob !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return false
  const today = new Date(now.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10)
  return dob <= `${Number(today.slice(0, 4)) - ADULT_AGE}${today.slice(4)}`
}

// null = may order; else why not: 'guest' | 'no_dob' | 'under_18'. Only an adult_only partner gates.
export function orderAgeGate({ adultOnly, guest, dob, now }) {
  if (adultOnly !== true) return null
  if (guest) return 'guest'
  if (!dob) return 'no_dob'
  return isAdultForOrder(dob, now) ? null : 'under_18'
}

// PostgREST error -> what the sheet says: 'rate' | 'account' | 'adult' | 'items' | 'generic' (network, anything unknown).
export function orderErrorKind(err) {
  const m = typeof err?.message === 'string' ? err.message : ''
  if (m === 'rate_limited') return 'rate'
  if (m === 'order_requires_account') return 'account'
  if (m === 'adult_only') return 'adult'
  if (m === 'item_unavailable' || m === 'invalid_items' || m === 'mixed_currency') return 'items'
  return 'generic'
}

// The ONLY arguments create_eatery_order receives: ids and quantities. Delivery details (address, location) travel in the
// WhatsApp text alone and never reach the server; a test pins this shape and the call site.
export const orderRpcArgs = (partnerId, lines) => ({ p_partner: partnerId, p_items: lines.map(l => ({ item_id: l.id, qty: l.qty })) })

// ─── Delivery choice (Sepetim) ───
export const ADDRESS_FIELD_MAX = 100
// Invisible / direction-control characters, and all whitespace (newlines included) collapsed to single spaces: free text
// the customer types (address fields, note) can never forge a line of the message or hide inside an empty-looking field.
const INVISIBLE = /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFEFF]/g
export const oneLine = (v, max) => (typeof v === 'string' ? v.replace(INVISIBLE, '').replace(/[\s\u0085]+/g, ' ').trim().slice(0, max).trim() : '')
export const sanitizeAddressField = (v) => oneLine(v, ADDRESS_FIELD_MAX)
export function mapsLink(lat, lng) {
  const la = typeof lat === 'number' ? lat : NaN, ln = typeof lng === 'number' ? lng : NaN
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return ''
  return `https://maps.google.com/?q=${la.toFixed(5)},${ln.toFixed(5)}`
}

// ─── Address book entries (utils/eateryAddressCore.js stores them; the pin is optional) ───
export const ADDRESS_BOOK_MAX = 10
export const ADDRESS_NAME_MAX = 30
export const ADDRESS_UNIT_MAX = 10          // floor / flat
export const ADDRESS_DIRECTIONS_MAX = 140
export const ADDRESS_KINDS = ['home', 'work', 'other']
export const addressKind = k => (ADDRESS_KINDS.includes(k) ? k : 'other')
// Home and work carry an implicit name; only 'other' needs the customer's own. Floor, flat, directions and pin are optional.
export function addressComplete(e) {
  if (!e || typeof e !== 'object') return false
  const need = [e.district, e.street, e.building]
  if (addressKind(e.kind) === 'other') need.push(oneLine(e.name, ADDRESS_NAME_MAX))
  return need.every(v => sanitizeAddressField(v))
}
export function deliveryReady(delivery) {
  if (delivery?.mode === 'pickup') return true
  return delivery?.mode === 'delivery' && addressComplete(delivery)
}
const KIND_LABEL = { home: 'Ev', work: 'İş' }
// A building typed by an older version often already starts with "No" ("No 4", "No: 4", "no.4"): the line adds its own "No".
// A building that is only "No" keeps itself rather than vanishing.
const buildingNo = v => { const b = sanitizeAddressField(v); return b.replace(/^no\b[\s.:]*/i, '') || b }
// ONE line, always Turkish: "<name>: <sokak> No <bina>, Kat <kat>, Daire <daire>, <mahalle> · Tarif: … · Konum (haritada aç): <link>".
export function deliveryLine(delivery) {
  if (!deliveryReady(delivery)) return ''
  if (delivery.mode === 'pickup') return 'Teslimat: Gel-al'
  const kind = addressKind(delivery.kind)
  const name = KIND_LABEL[kind] || oneLine(delivery.name, ADDRESS_NAME_MAX)
  const f = sanitizeAddressField
  const floor = oneLine(delivery.floor, ADDRESS_UNIT_MAX), flat = oneLine(delivery.flat, ADDRESS_UNIT_MAX)
  const addr = [`${f(delivery.street)} No ${buildingNo(delivery.building)}`, floor && `Kat ${floor}`, flat && `Daire ${flat}`, f(delivery.district)].filter(Boolean).join(', ')
  const directions = oneLine(delivery.directions, ADDRESS_DIRECTIONS_MAX)
  const pin = delivery.coords || delivery
  const link = mapsLink(pin?.lat, pin?.lng)
  return ['Teslimat: Adrese teslim — ' + (name ? `${name}: ` : '') + addr, directions && `Tarif: ${directions}`, link && `Konum (haritada aç): ${link}`].filter(Boolean).join(' · ')
}

// The address editor's Back: step 3 -> 2 -> 1 -> closed (the editor is the first layer in the back chain, then the basket).
export const editorBack = step => (step === 3 ? 2 : step === 2 ? 1 : 'closed')

// What one Back press does on the partner page, top layer first: the address editor (its map picker, then 3 -> 2 -> 1 -> closed),
// the quiz, Sepetim, the dish photo. quizBack() is called only when the editor did not take the press; true = it closed something.
// -> { layer:'editor', step, picker:false } | { layer:'editor', close:true } | { layer:'quiz' | 'basket' | 'viewing' } | null
export function eateryPartnerBack({ editorOpen, editorStep, pickerOpen, quizBack, basketOpen, viewing }) {
  if (editorOpen) {
    if (pickerOpen) return { layer: 'editor', step: 2, picker: false }
    const n = editorBack(editorStep)
    return n === 'closed' ? { layer: 'editor', close: true } : { layer: 'editor', step: n, picker: false }
  }
  if (quizBack?.()) return { layer: 'quiz' }
  if (basketOpen) return { layer: 'basket' }
  if (viewing) return { layer: 'viewing' }
  return null
}

// Editor: a new address starts at step 1; an incomplete one at the first step that lacks something (name -> 1, else the details -> 3);
// a complete one at the details (3), where most edits happen.
export function firstIncompleteStep(e) {
  return addressKind(e?.kind) === 'other' && !oneLine(e?.name, ADDRESS_NAME_MAX) ? 1 : 3
}
export const editorStartStep = e => (!e ? 1 : addressComplete(e) ? 3 : firstIncompleteStep(e))
// The required fields still empty, in the order the editor shows them: 'name' (Diğer only), 'district', 'street', 'building'.
export function addressMissing(e) {
  const out = []
  if (addressKind(e?.kind) === 'other' && !oneLine(e?.name, ADDRESS_NAME_MAX)) out.push('name')
  for (const k of ['district', 'street', 'building']) if (!sanitizeAddressField(e?.[k])) out.push(k)
  return out
}
// A book entry -> the Sepetim delivery state (pin as coords). UI only: a name is never invented here.
export function deliveryFromEntry(a) {
  const { lat, lng, id, updatedAt, ...fields } = a
  return { ...fields, addressId: id, coords: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null }
}
// The short address the card and the sheet show: "<sokak> No <bina>, <mahalle>" (the message line minus floor / flat / directions). Sanitized.
export function shortAddress(e) {
  const street = sanitizeAddressField(e?.street), b = sanitizeAddressField(e?.building)
  const head = street && b ? `${street} No ${buildingNo(b)}` : street || (b ? `No ${buildingNo(b)}` : '')
  return [head, sanitizeAddressField(e?.district)].filter(Boolean).join(', ')
}
// What the Sepetim card shows for an entry (a book entry with lat / lng, or the delivery state with coords):
// 'none' (nothing selected) | 'incomplete' (a required field is empty) | 'noPin' (complete, no map pin) | 'pin'.
export function cardState(e) {
  if (!e || typeof e !== 'object') return 'none'
  if (!addressComplete(e)) return 'incomplete'
  const p = e.coords || e
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) ? 'pin' : 'noPin'
}
export const canAddMore = n => Number.isFinite(n) && n < ADDRESS_BOOK_MAX
export const EMPTY_DELIVERY_ADDRESS = { addressId: null, kind: 'home', name: '', street: '', building: '', district: '', floor: '', flat: '', directions: '', coords: null }

// lines: [{ name, qty, price }]. ALWAYS Turkish whatever the app language: the restaurant reads it, not the customer.
// code: the server's order code; its line is the LAST one.
export function buildOrderMessage(lines, note, code = null, delivery = null) {
  const out = ['ADA üzerinden sipariş:']
  for (const l of lines) out.push(`${l.qty} × ${l.name} — ${formatTl(l.qty * Number(l.price))}`)
  out.push('', `Toplam: ${formatTl(orderTotal(lines))}`)
  const n = oneLine(note, ORDER_NOTE_MAX)
  if (n) out.push(`Not: ${n}`)
  const dl = deliveryLine(delivery)
  if (dl) out.push(dl)
  out.push('Fiyatlar ADA menüsündendir, değişiklik olabilir.')
  const cl = orderCodeLine(code)
  if (cl) out.push(cl)
  return out.join('\n')
}

export const orderWhatsAppUrl = (digits, message) => `https://wa.me/${digits}?text=${encodeURIComponent(message)}`

// ─── "Konumumu ekle": what happened → what the user sees (pure; the device calls live in EateryOrder.js) ───
export const LOCATE_TIMEOUT_MS = 12000
// null on timeout; a result that arrives later is ignored (the race has already settled), a rejection too.
export function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), ms) })
  return Promise.race([Promise.resolve(promise).catch(() => null), timeout]).finally(() => clearTimeout(timer))
}
const validFix = fix => Number.isFinite(fix?.coords?.latitude) && Number.isFinite(fix?.coords?.longitude)
// iOS reports "denied" while location services are off, so services-off wins over the permission states.
export function locateOutcome({ granted, canAskAgain, servicesOn, fix }) {
  if (granted && validFix(fix)) return 'ok'
  if (servicesOn === false) return 'servicesOff'
  if (!granted) return canAskAgain === false ? 'blocked' : 'denied'
  return 'noFix'
}
export function locateNote(outcome) {
  switch (outcome) {
    case 'servicesOff': return { msgKey: 'eateryLocOff', action: 'locationSettings' }
    case 'blocked': return { msgKey: 'eateryLocBlocked', action: 'appSettings' }
    case 'denied': case 'noFix': return { msgKey: 'eateryDeliveryLocFail', action: null }
    default: return null
  }
}

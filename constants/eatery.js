// Yeme-İçme (eatery partners) — pure helpers behind EateryScreen / EateryPartnerScreen, in the
// petPartnerSections() mould: emptiness is decided HERE, so a screen renders what it is given and
// partner #2 is data only. Plain JS, no React, no network.
import { dateLocale, t } from './i18n.js'
import { cyprusNow, openState } from '../utils/towingHours.js'
import { ADULT_AGE } from './profileGate.js'
import { parseKey } from '../utils/eateryBasketCore.js'

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

// The basket exists only for a partner that takes WhatsApp orders. Fail closed: a row without order_method (an older
// column list, a fixture) or any other value (e.g. 'phone') is not a basket partner. Always combined with a number.
export const eateryOrdersByWhatsapp = p => p?.order_method === 'whatsapp'

// Which "my list" a partner offers: 'whatsapp' (the basket that sends an order), 'phone' (a list read out on the call: no send, no
// server) or null (none). Fail closed on any other order_method. nums = eateryContactNumbers(...): a fixture partner has none, so none.
export function eateryListMode(p, nums) {
  if (eateryOrdersByWhatsapp(p)) return eateryOrderDigits(nums?.whatsapp) ? 'whatsapp' : null
  if (p?.order_method === 'phone') return eateryContacts(p, nums).some(c => c.action === 'call') ? 'phone' : null
  return null
}

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

// ─── Per-dish options ("Malzeme çıkar" / "Ekstra ekle"; eatery_item_options, 20261134) ───
// A dish's visible options: available, and either a removal or an extra with a price (0 = free, shown without a price; price NULL = hidden). A row fetched
// without the embed has none, and then nothing about the dish changes.
export function eateryItemOptions(item) {
  const list = Array.isArray(item?.eatery_item_options) ? item.eatery_item_options : []
  return list
    .filter(o => o && Number.isFinite(Number(o.id)) && o.is_available !== false &&
      (o.kind === 'remove' || (o.kind === 'extra' && o.price != null && o.price !== '' && Number.isFinite(Number(o.price)) && Number(o.price) >= 0)))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || Number(a.id) - Number(b.id))
}

// An extra that costs nothing (Bidda's domates / maydanoz): the sheet shows it as a tick, never a stepper, so its quantity is 0 or 1.
export const isFreeExtra = opt => opt?.kind === 'extra' && opt.price != null && opt.price !== '' && Number(opt.price) === 0

// What the customer reads: their language's label, else English, else the Turkish text the restaurant reads.
export function eateryOptionLabel(opt, lang) {
  const l = opt?.label_i18n
  const pick = v => (filled(v) ? v.trim() : null)
  return pick(l?.[lang]) || pick(l?.English) || pick(opt?.message_tr) || ''
}

const sortedByOrder = (a, b) => (a.opt.sort_order ?? 0) - (b.opt.sort_order ?? 0) || Number(a.opt.id) - Number(b.opt.id)

// The ONE Turkish detail text, the same the server stores (create_eatery_order, 20261134): removals first as the restaurant's
// removed form, then extras "+ekstra x" / "+2 ekstra x", all in (sort_order, id) order, joined with ", ".
// bareFree (the phone list on screen only, never a stored or compared text): a free add reads "+maydanoz", not "+ekstra maydanoz".
export function optionDetail(removals, extras, bareFree = false) {
  return [
    ...[...removals].sort((a, b) => sortedByOrder({ opt: a }, { opt: b })).map(o => o.message_tr),
    ...[...extras].sort((a, b) => sortedByOrder(a, b)).map(({ opt, qty }) => (bareFree && isFreeExtra(opt) ? `+${opt.message_tr}` : qty > 1 ? `+${qty} ekstra ${opt.message_tr}` : `+ekstra ${opt.message_tr}`)),
  ].join(', ')
}

// item + chosen opts [{ id, qty }] -> { ok, unit, removals: [opt], extras: [{ opt, qty }], detail }. ok is false when an id is no
// longer a visible option of the dish (the menu changed under a line) or a quantity is out of range; then unit is the base price.
export function resolveLineOptions(item, opts) {
  const base = Number(item?.price)
  const list = opts || []
  const known = new Map(eateryItemOptions(item).map(o => [Number(o.id), o]))
  const removals = [], extras = []
  let extraCents = 0, ok = true
  for (const o of list) {
    const opt = known.get(Number(o.id))
    const qty = Number(o.qty)
    if (!opt || !Number.isInteger(qty) || qty < 1) { ok = false; continue }
    if (opt.kind === 'remove') {
      if (qty !== 1) { ok = false; continue }
      removals.push(opt)
    } else {
      if (qty > (Number(opt.max_qty) || 1)) { ok = false; continue }
      extras.push({ opt, qty })
      extraCents += Math.round(Number(opt.price) * 100) * qty
    }
  }
  if (!ok) return { ok: false, unit: base, removals: [], extras: [], detail: '' }
  removals.sort((x, y) => sortedByOrder({ opt: x }, { opt: y }))
  extras.sort(sortedByOrder)
  return { ok: true, unit: (Math.round(base * 100) + extraCents) / 100, removals, extras, detail: optionDetail(removals, extras) }
}

// The basket's lines for the orderable dishes of a partner, in menu order (a dish's own lines in basket order):
// [{ key, id, item, name, qty, price (unit, extras included), photoPath, opts, removals, extras, detail, stale }].
// A key whose dish is no longer on the menu is skipped (as before); a key whose options no longer resolve stays, stale.
export function basketLines(items, basket) {
  const byId = new Map((items || []).map(i => [String(i.id), i]))
  const per = new Map()
  for (const key of Object.keys(basket || {})) {
    const qty = basket[key]
    if (!(qty > 0)) continue
    const { itemId, opts } = parseKey(key)
    const item = byId.get(itemId)
    if (!item) continue
    const r = resolveLineOptions(item, opts)
    const line = { key, id: item.id, item, name: item.name, qty, price: r.unit, photoPath: item.photoPath, opts, removals: r.removals, extras: r.extras, detail: r.detail, stale: !r.ok }
    if (!per.has(itemId)) per.set(itemId, [])
    per.get(itemId).push(line)
  }
  return (items || []).flatMap(i => per.get(String(i.id)) || [])
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

// The server's lines in the shape buildOrderMessage reads: [{ id, name, qty, price, detail }] (detail '' on a plain line).
export const serverOrderLines = res => (Array.isArray(res?.lines) ? res.lines : [])
  .map(l => ({ id: l.item_id, name: l.name, qty: Number(l.qty), price: Number(l.unit_price), detail: typeof l.detail === 'string' ? l.detail.trim() : '' }))

const cents = n => Math.round(Number(n) * 100)

// True when the server's answer is not exactly the basket the person saw: a line missing or extra, a different
// quantity, a different unit price, a different option detail, or a different total. The server keeps the input order, so the
// comparison is POSITIONAL (two lines of one dish, with different options, share an item id). A malformed answer counts as a
// mismatch. Then NOTHING is sent.
export function orderMismatch(basketLines, res) {
  if (!res || !Array.isArray(res.lines) || res.lines.length === 0 || !Number.isFinite(Number(res.total))) return true
  const srv = serverOrderLines(res)
  if (srv.length !== basketLines.length) return true
  for (let i = 0; i < basketLines.length; i++) {
    const b = basketLines[i], m = srv[i]
    if (String(m.id) !== String(b.id) || m.qty !== Number(b.qty) || cents(m.price) !== cents(b.price) || m.detail !== (typeof b.detail === 'string' ? b.detail.trim() : '')) return true
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
  if (m === 'item_unavailable' || m === 'invalid_items' || m === 'mixed_currency' || m === 'option_unavailable') return 'items'
  return 'generic'
}

// The ONLY arguments create_eatery_order receives: ids and quantities (and, for a line with options, their ids and quantities).
// Delivery details (address, location) travel in the WhatsApp text alone and never reach the server; a test pins this shape and
// the call site. A plain line is exactly { item_id, qty }, as the shipped apps send it.
export const orderRpcArgs = (partnerId, lines) => ({
  p_partner: partnerId,
  p_items: lines.map(l => (Array.isArray(l.opts) && l.opts.length > 0
    ? { item_id: l.id, qty: l.qty, opts: l.opts.map(o => ({ id: o.id, qty: o.qty })) }
    : { item_id: l.id, qty: l.qty })),
})

// ─── Delivery choice (Sepetim) ───
export const ADDRESS_FIELD_MAX = 100
// Invisible / direction-control characters, and all whitespace (newlines included) collapsed to single spaces: free text
// the customer types (address fields, note) can never forge a line of the message or hide inside an empty-looking field.
const INVISIBLE = /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u034F\u115F\u1160\u17B4\u17B5\u3164\uFFA0\uFEFF]/g
export const oneLine = (v, max) => (typeof v === 'string' ? v.replace(INVISIBLE, '').replace(/[\s\u0085]+/g, ' ').trim().slice(0, max).trim() : '')
export const sanitizeAddressField = (v) => oneLine(v, ADDRESS_FIELD_MAX)

// ─── Courier phone (optional, per address). Stored as canonical digits "+905331234567" / "+903921234567"; shown (editor and message) as
// "+90 533 123 45 67" / "+90 392 123 45 67". Only a TRNC-reachable number: a Turkish mobile (5xx) or a TRNC landline (392).
// Input (Persian / Arabic-Indic digits included): "+90 …", "0090 …", "0 …" or bare national digits; spaces, dashes, dots and parentheses are ignored. Never throws.
export const PHONE_INPUT_MAX = 32
export function normalizePhone(input) {
  if (input == null || input === '') return { ok: true, value: null }
  if (typeof input !== 'string') return { ok: false }
  const raw = input.replace(INVISIBLE, '').replace(/[\u0660-\u0669\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) & 0xF))   // fa / ar keyboards type their own digits
  if (raw.length > 40) return { ok: false }
  const s = raw.replace(/[\s\u0085\-.()]/g, '')
  if (!s) return { ok: true, value: null }
  if (!/^\+?\d+$/.test(s)) return { ok: false }
  let national
  if (s.startsWith('+')) { if (!s.startsWith('+90')) return { ok: false }; national = s.slice(3) }
  else if (s.startsWith('00')) { if (!s.startsWith('0090')) return { ok: false }; national = s.slice(4) }
  else if (s.startsWith('0')) national = s.slice(1)
  else national = s
  return /^(5\d{9}|392\d{7})$/.test(national) ? { ok: true, value: '+90' + national } : { ok: false }
}
// The standard display form of a normalised value; '' when it is not a valid phone.
export function formatPhone(value) {
  const r = normalizePhone(value)
  if (!r.ok || !r.value) return ''
  const n = r.value.slice(3)
  return `+90 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6, 8)} ${n.slice(8)}`
}
// The ONE place the pin link's shape is decided ({lat} / {lng} are 5-decimal substitutions). Berke picks the final format after a
// phone test: a bare `?q=lat,lng` snapped to the nearest labelled business (the clinic next door), so this is a one-constant change.
export const MAPS_LINK_FORMAT = 'https://www.google.com/maps/search/?api=1&query={lat},{lng}'
const validPin = (lat, lng) => typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
// "35.17900, 33.35745" (5 dp), or '' when the pin is missing / invalid.
export const coordText = (lat, lng) => (validPin(lat, lng) ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : '')
export function mapsLink(lat, lng) {
  if (!validPin(lat, lng)) return ''
  return MAPS_LINK_FORMAT.replace('{lat}', () => lat.toFixed(5)).replace('{lng}', () => lng.toFixed(5))
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
// ONE line, always Turkish: "<name>: <sokak> No <bina>, Kat <kat>, Daire <daire>, <mahalle> · Teslimatta aranacak: <telefon> · Tarif: … · Konum (haritada aç): <link> · Koordinat: <lat>, <lng>".
// A pin adds BOTH the link and the plain coordinates (a restaurant that cannot open the link can still read the numbers); no pin, neither.
export function deliveryLine(delivery) {
  if (!deliveryReady(delivery)) return ''
  if (delivery.mode === 'pickup') return 'Teslimat: Gel-al'
  const kind = addressKind(delivery.kind)
  const name = KIND_LABEL[kind] || oneLine(delivery.name, ADDRESS_NAME_MAX)
  const f = sanitizeAddressField
  const floor = oneLine(delivery.floor, ADDRESS_UNIT_MAX), flat = oneLine(delivery.flat, ADDRESS_UNIT_MAX)
  const addr = [`${f(delivery.street)} No ${buildingNo(delivery.building)}`, floor && `Kat ${floor}`, flat && `Daire ${flat}`, f(delivery.district)].filter(Boolean).join(', ')
  const phone = formatPhone(delivery.callPhone)
  const directions = oneLine(delivery.directions, ADDRESS_DIRECTIONS_MAX)
  const pin = delivery.coords || delivery
  const link = mapsLink(pin?.lat, pin?.lng), coords = coordText(pin?.lat, pin?.lng)
  return ['Teslimat: Adrese teslim — ' + (name ? `${name}: ` : '') + addr, phone && `Teslimatta aranacak: ${phone}`, directions && `Tarif: ${directions}`, link && `Konum (haritada aç): ${link}`, coords && `Koordinat: ${coords}`].filter(Boolean).join(' · ')
}

// Partner page photo banner. 240 = the photo's height below the status bar (mockup lever 160-320). The head card overlaps
// the photo by one bar row, so the scroll content starts BANNER_H - 2 rows down (the ScrollView itself starts one row down).
export const EATERY_BANNER_H = 240
export const BANNER_BAR_ROW = 56   // ScreenHeader's minHeight: the bar's row under the status bar
export const bannerContentPad = () => EATERY_BANNER_H - 2 * BANNER_BAR_ROW
// Banner mode only when the row has a banner that resolves to a URL and it has not failed to load.
export const eateryBannerOn = (url, failed) => !!url && failed !== true

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
export const EMPTY_DELIVERY_ADDRESS = { addressId: null, kind: 'home', name: '', street: '', building: '', district: '', floor: '', flat: '', directions: '', callPhone: null, coords: null }

// lines: [{ name, qty, price, detail? }]. ALWAYS Turkish whatever the app language: the restaurant reads it, not the customer.
// code: the server's order code; its line is the LAST one.
export function buildOrderMessage(lines, note, code = null, delivery = null) {
  const out = ['ADA üzerinden sipariş:']
  for (const l of lines) {
    const d = typeof l.detail === 'string' ? l.detail.trim() : ''
    out.push(`${l.qty} × ${l.name}${d ? ` — ${d}` : ''} — ${formatTl(l.qty * Number(l.price))}`)
  }
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

// ─── A better fix before the pin is shown (the first fix of a cold GPS can be tens of metres off) ───
export const LOCATE_REFINE_MS = 6000   // listen for fixes this long at most
export const LOCATE_GOOD_M = 10        // ... and stop at once when one is this accurate (metres)
export const LOCATE_POOR_M = 15        // a fix worse than this tells the person in the picker
const fixAcc = f => (Number.isFinite(f?.coords?.accuracy) && f.coords.accuracy >= 0 ? f.coords.accuracy : Infinity)
// The most accurate of the valid fixes (finite coordinates inside the globe); a fix without an accuracy ranks last but still counts.
// Ties keep the earlier one. null when none is usable.
export function pickBestFix(fixes) {
  let best = null
  for (const f of Array.isArray(fixes) ? fixes : []) {
    if (!validPin(f?.coords?.latitude, f?.coords?.longitude)) continue
    if (!best || fixAcc(f) < fixAcc(best)) best = f
  }
  return best
}
// null = say nothing; else the metres to show, rounded UP to the next 5 so a value over 15 m never reads as 15 or less
// (15 -> null, 15.1 -> 20, 22 -> 25, 40 -> 40). Shown only in the picker's state: never stored, never in the message.
export function accuracyNote(acc) {
  return Number.isFinite(acc) && acc > LOCATE_POOR_M ? Math.ceil(acc / 5) * 5 : null
}
// After a refine with no fix: ask for a one-shot fresh fix only when location services are on (or unknown); off -> skip, the
// caller reports services-off instead of stacking a second system dialog.
export const askFreshFix = servicesOn => servicesOn !== false
// Listens through watch(cb) -> Promise<{ remove() } | null> and settles on the best fix at the first of: a fix <= goodM, the
// timeout, stop(). The subscription is removed on EVERY exit (also when it arrives after the exit). Resolves null with no valid fix
// (also when watch() rejects, e.g. location services off and declined): then the caller falls back to the one-shot chain.
// { done: Promise<fix | null>, stop() }. setT / clearT are injectable for tests.
export function refineFix(watch, { ms = LOCATE_REFINE_MS, goodM = LOCATE_GOOD_M, setT = setTimeout, clearT = clearTimeout } = {}) {
  let best = null, sub = null, settled = false, timer = null, resolveDone
  const done = new Promise(r => { resolveDone = r })
  const drop = () => { const s = sub; sub = null; try { s?.remove?.() } catch {} }
  const finish = () => {
    if (settled) return
    settled = true
    clearT(timer)
    drop()
    resolveDone(best)
  }
  timer = setT(finish, ms)
  Promise.resolve().then(() => settled ? null : watch(fix => {
    if (settled) return
    best = pickBestFix([best, fix])
    if (best && fixAcc(best) <= goodM) finish()
  })).then(s => { sub = s || null; if (settled) drop() }, finish)
  return { done, stop: finish }
}
// Dish options sheet: show the bottom fade only while the list overflows its viewport and is not scrolled to the end
// (SHEET_FADE_TOL pt of slack at the end, so sub-pixel rounding never leaves a fade on a list that is fully scrolled).
export const SHEET_FADE_TOL = 2
export function sheetFadeVisible({ contentH, viewH, offsetY } = {}) {
  if (![contentH, viewH, offsetY].every(Number.isFinite) || viewH <= 0 || contentH <= viewH) return false
  return offsetY < contentH - viewH - SHEET_FADE_TOL
}

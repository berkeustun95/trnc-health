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

// lines: [{ name, qty, price }]. ALWAYS Turkish whatever the app language: the restaurant reads it, not the customer.
// code: the server's order code; its line is the LAST one.
export function buildOrderMessage(lines, note, code = null) {
  const out = ['ADA üzerinden sipariş:']
  for (const l of lines) out.push(`${l.qty} × ${l.name} — ${formatTl(l.qty * Number(l.price))}`)
  out.push('', `Toplam: ${formatTl(orderTotal(lines))}`)
  const n = typeof note === 'string' ? note.trim().slice(0, ORDER_NOTE_MAX) : ''
  if (n) out.push(`Not: ${n}`)
  out.push('Fiyatlar ADA menüsündendir, değişiklik olabilir.')
  const cl = orderCodeLine(code)
  if (cl) out.push(cl)
  return out.join('\n')
}

export const orderWhatsAppUrl = (digits, message) => `https://wa.me/${digits}?text=${encodeURIComponent(message)}`

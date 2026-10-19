// Yeme-İçme (eatery partners) — pure helpers behind EateryScreen / EateryPartnerScreen, in the
// petPartnerSections() mould: emptiness is decided HERE, so a screen renders what it is given and
// partner #2 is data only. Plain JS, no React, no network.
import { dateLocale, t } from './i18n.js'
import { cyprusNow, openState } from '../utils/towingHours.js'

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

// One entry per contact button that has something behind it; an empty field yields no entry.
// action is the contact_events action ('call' | 'whatsapp' | 'website' | 'maps').
export function eateryContacts(p) {
  const out = []
  const phone = filled(p?.phone) ? p.phone.replace(/[^\d+]/g, '') : ''
  if (phone.length > 3) out.push({ action: 'call', url: `tel:${phone}`, value: p.phone.trim() })
  const wa = filled(p?.whatsapp) ? p.whatsapp.replace(/\D/g, '') : ''
  if (wa.length > 3) out.push({ action: 'whatsapp', url: `https://wa.me/${wa}`, value: p.whatsapp.trim() })
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

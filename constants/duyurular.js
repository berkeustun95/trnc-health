// Duyurular — official TRNC announcements (public.announcements, 20261102). Read-only for the
// app: RLS returns a row only while it is published and unexpired; the fetcher writes.
// Plan: vault 10-ada/2026-10-10_duyurular-plan.md.

import { REGION_LABEL_KEY } from './regions.js'
import { LANG_CODES } from './i18n.js'
import { intlTrusted, monthNames } from './months.js'
import { searchMatch } from '../utils/searchFold.js'

// DB category keys (announcements_category_check) → label + icon. Order = dropdown order.
export const DUY_CATEGORIES = [
  { key: 'kamu',     labelKey: 'duyCatKamu',     icon: 'briefcase-outline' },
  { key: 'egitim',   labelKey: 'duyCatEgitim',   icon: 'school-outline' },
  { key: 'ihale',    labelKey: 'duyCatIhale',    icon: 'document-text-outline' },
  { key: 'belediye', labelKey: 'duyCatBelediye', icon: 'business-outline' },
  { key: 'kesinti',  labelKey: 'duyCatKesinti',  icon: 'warning-outline' },
  { key: 'destek',   labelKey: 'duyCatDestek',   icon: 'cash-outline' },
  { key: 'ulasim',   labelKey: 'duyCatUlasim',   icon: 'car-outline' },
]
export const DUY_CATEGORY = Object.fromEntries(DUY_CATEGORIES.map(c => [c.key, c]))

// A category is offered in the Kategori dropdown only once it has this many visible items
// (Berke 2026-10-10: Kesinti had 1 at launch). Its items still show under "Tümü".
export const MIN_ITEMS_FOR_CATEGORY = 3

// DB region keys (announcements_region_check) → the app's district keys and labels.
// 'all' (nationwide) is not a district: it shows under "Tümü" only.
export const DUY_REGION_TO_DISTRICT = {
  lefkosa: 'nicosia', girne: 'kyrenia', gazimagusa: 'famagusta', guzelyurt: 'morphou', iskele: 'iskele', lefke: 'lefke',
}
export const DUY_DISTRICTS = Object.keys(DUY_REGION_TO_DISTRICT).map(k => ({ key: k, labelKey: REGION_LABEL_KEY[DUY_REGION_TO_DISTRICT[k]] }))

// "Son günler": open items whose deadline falls within this many days.
export const CLOSING_SOON_DAYS = 7

// KHK münhals carry their deadline inside a PDF the fetcher may not read (robots.txt,
// Berke 2026-10-10 option A), so a KHK item without a deadline says where it is.
export const KHK_INSTITUTION = 'Kamu Hizmeti Komisyonu'

export const DUY_COLUMNS = 'id, title, excerpt, official_url, institution, category, region, kind, published_at, deadline_at'
export const DUY_PAGE = 500

const DAY = 864e5
// Whole TRNC calendar days from today to the deadline day (TRNC is UTC+3 all year).
export function daysLeft(deadlineIso, now = new Date()) {
  const day = d => Math.floor((d.getTime() + 3 * 3600e3) / DAY)
  return day(new Date(deadlineIso)) - day(now)
}

export function isClosingSoon(item, now = new Date()) {
  if (item.kind !== 'open' || !item.deadline_at) return false
  const d = daysLeft(item.deadline_at, now)
  return d >= 0 && d <= CLOSING_SOON_DAYS
}

// Search over title + institution with the app's recall-first fold (utils/searchFold.js:
// "kibris" finds "Kıbrıs", "IHALE" finds "ihale"). Every word must match.
export function matchesQuery(item, q) {
  const words = String(q ?? '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = `${item.title} ${item.institution}`
  return words.every(w => searchMatch(hay, w))
}

// A TRNC calendar date (UTC+3, no DST) in the reader's language, always Gregorian: the same
// trap and the same runtime check as formatPetDate (constants/petsContent.js) — Intl 'fa'
// defaults to the Jalali calendar, and Hermes may ignore the calendar request.
export function formatDuyDate(iso, lang) {
  if (!iso) return ''
  const d = new Date(new Date(iso).getTime() + 3 * 3600e3)
  if (Number.isNaN(d.getTime())) return ''
  if (intlTrusted) {
    try {
      return new Intl.DateTimeFormat(`${LANG_CODES[lang] || 'en'}-u-ca-gregory`,
        { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d)
    } catch { /* composed form below */ }
  }
  return `${d.getUTCDate()} ${monthNames(lang)[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function visibleCategories(items) {
  const n = {}
  for (const it of items) n[it.category] = (n[it.category] || 0) + 1
  return DUY_CATEGORIES.filter(c => (n[c.key] || 0) >= MIN_ITEMS_FOR_CATEGORY).map(c => ({ ...c, count: n[c.key] }))
}

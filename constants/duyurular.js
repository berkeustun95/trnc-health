// Duyurular — official TRNC announcements (public.announcements, 20261102). Read-only for the
// app: RLS returns a row only while it is published and unexpired; the fetcher writes.
// Plan: vault 10-ada/2026-10-10_duyurular-plan.md.

import { REGION_LABEL_KEY } from './regions.js'
import { dateLocale } from './i18n.js'
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
// 'all' = nationwide: not a district of its own, it shows under EVERY district (Berke 2026-10-11:
// picking Girne = Girne's items + every item with no district).
export const DUY_REGION_TO_DISTRICT = {
  lefkosa: 'nicosia', girne: 'kyrenia', gazimagusa: 'famagusta', guzelyurt: 'morphou', iskele: 'iskele', lefke: 'lefke',
}
export const DUY_DISTRICTS = Object.keys(DUY_REGION_TO_DISTRICT).map(k => ({ key: k, labelKey: REGION_LABEL_KEY[DUY_REGION_TO_DISTRICT[k]] }))

// "Son günler": open items whose deadline falls within this many days.
export const CLOSING_SOON_DAYS = 7

// KHK münhals carry their deadline inside a PDF the fetcher may not read (robots.txt,
// Berke 2026-10-10 option A), so a KHK item without a deadline says where it is.
export const KHK_INSTITUTION = 'Kamu Hizmeti Komisyonu'

// The list's background photo credit (Kyrenia Gate; components/ui/ModuleScreen.js
// MODULE_PHOTO.duyurular). Read from the Commons API (extmetadata) on 2026-10-11.
export const DUY_PHOTO_CREDIT = {
  credit:     'ToprakM',
  license:    'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0',
  sourceUrl:  'https://commons.wikimedia.org/wiki/File:Kyrenia_Gate_at_North_Nicosia.jpg',
  source:     'commons',
}

export const DUY_COLUMNS = 'id, title, excerpt, official_url, institution, category, region, kind, published_at, deadline_at'
export const DUY_PAGE = 500

const DAY = 864e5
// Whole TRNC calendar days from today to the deadline day (TRNC is UTC+3 all year).
export function daysLeft(deadlineIso, now = new Date()) {
  const day = d => Math.floor((d.getTime() + 3 * 3600e3) / DAY)
  return day(new Date(deadlineIso)) - day(now)
}

// The same window as a server query: from now to the end of the TRNC day CLOSING_SOON_DAYS
// ahead (Home banner pill = published open items with deadline_at inside it).
export function closingSoonRange(now = new Date()) {
  const trncDay = Math.floor((now.getTime() + 3 * 3600e3) / DAY)
  const end = new Date((trncDay + CLOSING_SOON_DAYS + 1) * DAY - 3 * 3600e3 - 1000)
  return { from: now.toISOString(), to: end.toISOString() }
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
      return new Intl.DateTimeFormat(dateLocale(lang),
        { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(d)
    } catch { /* composed form below */ }
  }
  return `${d.getUTCDate()} ${monthNames(lang)[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function matchesDistrict(item, district) {
  return !district || item.region === district || item.region === 'all'
}

export function visibleCategories(items) {
  const n = {}
  for (const it of items) n[it.category] = (n[it.category] || 0) + 1
  return DUY_CATEGORIES.filter(c => (n[c.key] || 0) >= MIN_ITEMS_FOR_CATEGORY).map(c => ({ ...c, count: n[c.key] }))
}

// ─── One card per exam sitting, and no exact reposts (audit D-04, Berke 2026-11-23) ─────────────
// KHK posts every exam sitting in stages: YAPILIYOR (being held) → YAPILDI (held) → KESİNLEŞTİ
// (results final), each as its own announcement, often from a different source page. The list shows
// one card per sitting, carrying its LATEST stage; the earlier ones ride along as `earlier` and the
// detail screen links them. A wrong merge would hide an official announcement, so anything unclear
// stays its own card:
//  - only titles with a stage word AND "SINAV" are stage cards; the exam is the title without the
//    stage word, the "(25 Kasım 2026)" date and singular/plural endings (SINAVI/SINAVLARI, KADROSUNUN/
//    KADROLARININ); written and oral exams stay apart because the words differ
//  - a card joins the newest sitting exactly one stage behind it (1→2, 2→3), within STAGE_JOIN_DAYS of
//    that sitting's last card; a YAPILDI also needs the same date as the YAPILIYOR (or one of them undated); a
//    KESİNLEŞTİ's date is its posting date, so it is not compared
//  - two cards of the same stage never join (two YAPILDI on one day are two post groups), except an
//    exact repost
// Exact repost: the same folded title. Only the newest copy is shown, from any source, any age.
export const STAGE_JOIN_DAYS = 21
const DAY_MS = 86400000

export function foldTitle(title) {
  return String(title || '')
    .replace(/i̇/g, 'i').replace(/i/g, 'İ').replace(/ı/g, 'I')
    .toUpperCase()
    .replace(/İ/g, 'I').replace(/Ş/g, 'S').replace(/Ğ/g, 'G').replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ç/g, 'C')
    .replace(/[^A-Z0-9()]+/g, ' ')
    .trim()
}

const STAGES = [[/\bYAPILIYOR\b/, 1], [/\bYAPILDI\b/, 2], [/\bKESINLES(TI|MISTIR)\b/, 3]]

// { stage, exam, date } for a stage card, else null.
export function stageOf(title) {
  const f = foldTitle(title)
  if (!/\bSINAV/.test(f)) return null
  const hit = STAGES.find(([re]) => re.test(f))
  if (!hit) return null
  const m = f.match(/\((\d{1,2}) ([A-Z]+) (\d{4})\)/)
  const exam = f
    .replace(/\(\d{1,2} [A-Z]+ \d{4}\)/g, ' ')
    .replace(/\(MULAKAT\)/g, ' ')
    .replace(/\bYAPILIYOR\b|\bYAPILDI\b|\bKESINLES(TI|MISTIR)\b/g, ' ')
    .replace(/\bSINAV(I|LARI)\b/g, 'SINAV')
    .replace(/\bKADRO(SU|SUNUN|LARI|LARININ)\b/g, 'KADRO')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { stage: hit[1], exam, date: m ? `${Number(m[1])} ${m[2]} ${m[3]}` : null }
}

const byNewest = (a, b) => (new Date(b.published_at) - new Date(a.published_at)) || String(b.id).localeCompare(String(a.id))

// rows: announcements in any order. Returns the cards to show, newest first, each with `earlier`
// (the hidden rows of its group, newest first; [] when alone). Rows are not mutated.
export function groupDuyurular(rows) {
  // 1. Exact reposts: keep the newest copy of each folded title.
  const byTitle = new Map()
  for (const r of [...rows].sort(byNewest)) {
    const k = foldTitle(r.title)
    if (byTitle.has(k)) byTitle.get(k).hidden.push(r)
    else byTitle.set(k, { head: r, hidden: [] })
  }
  const unique = [...byTitle.values()]

  // 2. Stage chains, per exam, oldest first.
  const out = []
  const chains = new Map()
  for (const u of unique) {
    const st = stageOf(u.head.title)
    if (!st || !st.exam) { out.push({ ...u.head, earlier: u.hidden }); continue }
    if (!chains.has(st.exam)) chains.set(st.exam, [])
    chains.get(st.exam).push({ ...u, st })
  }
  for (const list of chains.values()) {
    list.sort((a, b) => -byNewest(a.head, b.head))
    const sittings = []
    for (const c of list) {
      const t = new Date(c.head.published_at).getTime()
      let last = null
      for (let i = sittings.length - 1; i >= 0 && !last; i--) {
        const s = sittings[i]
        if (s.stage === c.st.stage - 1
          && t - s.at <= STAGE_JOIN_DAYS * DAY_MS
          && (c.st.stage === 3 || !c.st.date || !s.date || c.st.date === s.date)) last = s
      }
      if (last) {
        last.cards.push(c); last.stage = c.st.stage; last.at = t
        if (!last.date && c.st.stage === 2) last.date = c.st.date
      } else {
        sittings.push({ stage: c.st.stage, date: c.st.date, at: t, cards: [c] })
      }
    }
    for (const s of sittings) {
      const [latest, ...older] = [...s.cards].reverse()
      out.push({ ...latest.head, earlier: [...latest.hidden, ...older.flatMap(o => [o.head, ...o.hidden])].sort(byNewest) })
    }
  }
  return out.sort(byNewest)
}

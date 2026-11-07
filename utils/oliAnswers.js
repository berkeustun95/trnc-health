import { supabase } from '../lib/supabase'
import { resolveOliQuery, getIntent, OLI_CHAT_INTENTS } from '../constants/oliIntents'
import { maybeListedFilter, isEventOver } from './eventVisibility'
import { loadEateryPartners } from './loadEateryPartners'
import { coarseCoord, haversineKm } from './facilityUtils'
import { localDateKey } from './dutyStatus'
import { dateLocale, t, LANG_CODES } from '../constants/i18n'
import { EATERY_CATEGORY_KEY } from '../constants/eatery'

// ─── Ask Oli answer providers ────────────────────────────────────────────────
// The ONE seam between the chat sheet and whatever answers it. A provider is
//   { id, answer({ text, intentId, lang, userLocation, now }) → Promise<OliAnswer> }
// and OliAnswer is what oli_messages.payload stores (20261163), so history renders the same whichever provider
// wrote it:
//   { v: 1, kind, intent, items: [{ t, s, a }], day }
//     kind    pharmacy | events | nearby | needLocation | eatery | route | search | noMatch | error
//     intent  the matched intent id (constants/oliIntents.js), or null
//     items   rows shown under the answer: t title, s subtitle, a action
//             ({ nav: <oliNavigate target> } | { result: <search_content row> } | { event: <id> })
//     day     the local date the rows were read (history shows older answers under their own date)
// The sheet turns kind + intent into words with t(), in the language of the moment. A future AI provider (cloud
// or on-phone) implements answer() with the same return shape; nothing else changes.
//
// The guided provider answers ONLY from ADA's own tables. It never invents: a failed read is kind 'error' (never
// "nothing on duty today"), zero rows is the matching "couldn't find" answer, and no intent plus no search hit
// is 'noMatch'.
export const ANSWER_VERSION = 1
const MAX_ITEMS = 6
const NEARBY_KM = 25

const answerOf = (kind, intent = null, items = [], now = new Date()) =>
  ({ v: ANSWER_VERSION, kind, intent, items, day: localDateKey(now) })

function whenLabel(iso, lang) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  try {
    return d.toLocaleString(dateLocale(lang), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  } catch {
    return `${d.getDate()}.${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
}

const hhmm = v => (typeof v === 'string' ? v.slice(0, 5) : '')

async function dutyToday(now) {
  const { data, error } = await supabase.from('duty_list')
    .select('id, name, region, open_from, open_until')
    .eq('duty_date', localDateKey(now))
  if (error) throw error
  const rows = (data ?? []).slice().sort((a, b) => (a.region ?? '').localeCompare(b.region ?? '', 'tr') || (a.name ?? '').localeCompare(b.name ?? '', 'tr'))
  return rows.slice(0, MAX_ITEMS).map(r => ({
    t: r.name,
    s: [r.region, r.open_from && r.open_until ? `${hhmm(r.open_from)}–${hhmm(r.open_until)}` : null].filter(Boolean).join(' · '),
    a: { nav: 'pharmacy' },
  }))
}

// Same visibility rule as EventsScreen and the Home strip (utils/eventVisibility.js): listed until end_date, or
// 06:00 Cyprus the morning after for events with no end.
async function eventsThisWeek(now, lang) {
  const until = new Date(now.getTime() + 7 * 24 * 3600 * 1000)
  const { data, error } = await supabase.from('events')
    .select('id, title, start_date, end_date, location')
    .eq('status', 'approved')
    .or(maybeListedFilter(now))
    .lte('start_date', until.toISOString())
    .order('start_date', { ascending: true })
    .limit(30)
  if (error) throw error
  return (data ?? []).filter(e => !isEventOver(e, now)).slice(0, MAX_ITEMS).map(e => ({
    t: e.title,
    s: [whenLabel(e.start_date, lang), e.location].filter(Boolean).join(' · '),
    a: { event: e.id },
  }))
}

const placeName = (p, lang) => {
  const n = p.name_i18n
  if (n && typeof n === 'object') {
    // name_i18n is keyed by ISO code (homeStripResolver's i18nText reads it the same way).
    const v = n[LANG_CODES[lang] ?? lang] ?? n.en ?? Object.values(n).find(Boolean)
    if (v) return String(v)
  }
  return p.name ?? ''
}

async function placesNear(loc, lang) {
  const { data, error } = await supabase.from('places')
    .select('id, category, name, name_i18n, region, latitude, longitude')
    .eq('status', 'active')
    .not('latitude', 'is', null)
    .limit(1000)
  if (error) throw error
  return (data ?? [])
    .map(p => ({ p, km: haversineKm(loc.latitude, loc.longitude, p.latitude, p.longitude) }))
    .filter(x => Number.isFinite(x.km) && x.km <= NEARBY_KM)
    .sort((a, b) => a.km - b.km)
    .slice(0, MAX_ITEMS)
    .map(({ p, km }) => ({
      t: placeName(p, lang),
      s: `${km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`}`,
      a: { result: { module: p.category === 'beach' ? 'beach' : 'landmark', id: p.id } },
    }))
}

async function eateryPartners(lang) {
  const { rows, error } = await loadEateryPartners('id, slug, name, category, region')
  if (error) throw error
  return rows.slice(0, MAX_ITEMS).map(r => ({
    t: r.name,
    s: [EATERY_CATEGORY_KEY[r.category] ? t(EATERY_CATEGORY_KEY[r.category], lang) : null, r.region].filter(Boolean).join(' · '),
    a: { nav: 'eatery' },
  }))
}

async function searchAda(text, loc) {
  const { data, error } = await supabase.rpc('search_content', {
    query: text,
    user_lat: coarseCoord(loc?.latitude ?? null),
    user_lon: coarseCoord(loc?.longitude ?? null),
  })
  if (error) throw error
  return (data ?? []).slice(0, MAX_ITEMS).map(r => ({ t: r.title, s: r.subtitle || '', a: { result: r } }))
}

export const guidedProvider = {
  id: 'guided',
  async answer({ text = '', intentId = null, lang, userLocation = null, now = new Date() }) {
    const intent = intentId ? getIntent(intentId) : resolveOliQuery(text, { limit: 1, intents: OLI_CHAT_INTENTS })[0]
    try {
      switch (intent?.id) {
        case 'pharmacy': return answerOf('pharmacy', 'pharmacy', await dutyToday(now), now)
        case 'events':   return answerOf('events', 'events', await eventsThisWeek(now, lang), now)
        case 'eatery':   return answerOf('eatery', 'eatery', await eateryPartners(lang), now)
        case 'nearby':
          if (!userLocation) return answerOf('needLocation', 'nearby', [], now)
          return answerOf('nearby', 'nearby', await placesNear(userLocation, lang), now)
        case undefined: break
        default:         return answerOf('route', intent.id, [], now)
      }
      const q = text.trim()
      const rows = q ? await searchAda(q, userLocation) : []
      return rows.length ? answerOf('search', null, rows, now) : answerOf('noMatch', null, [], now)
    } catch {
      return answerOf('error', intent?.id ?? null, [], now)
    }
  },
}

// The provider the chat uses. Swap here (or choose at runtime) when another provider exists.
export const oliProvider = guidedProvider

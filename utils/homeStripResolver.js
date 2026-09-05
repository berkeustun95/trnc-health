// Bugün ADA'da — the resolver ladder. Six ranks, first match wins, never returns null.
//
// Extension-explicit imports so plain Node can exercise this without Metro.
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase.js'
import { LANG_CODES } from '../constants/i18n.js'
import { STRIP_SOON_HOURS, STRIP_LAST_KIND_KEY } from '../constants/homeStrip.js'

// ─── THE LADDER — THE LEFT CARD ONLY ────────────────────────────────────────
//
//   1  a pinned item for today          home_strip_pin, pin_date = today
//   2  an event starting within 6h      the "leave now" case
//   3  an event later today             still actionable, less urgent
//   4  a sponsored promo                labelled, gated, never displacing an event
//   5  the events module's generic card  <- terminal, and it is NOT a rank that can fail
//
// ⚠ THIS RESOLVER NO LONGER DECIDES WHETHER THE SECTION IS EMPTY. It decides what the LEFT
//   card shows. The right card is the duty pharmacy, rendered unconditionally by
//   LiveStrip, never resolved and never outranked — so "Bugün ADA'da" is non-empty by
//   construction rather than by a fallback surviving.
//
// ⚠ WHERE THE PROMO LANDS, AND WHY IT IS STRICTER THAN IT WAS. It keeps its position
//   BELOW every real event, and what it now outranks is only the generic filler card —
//   where it used to outrank an Oli tip that was itself a real destination. So a promo can
//   never displace content, only the placeholder. The other rules are unchanged: labelled
//   "Sponsorlu", never twice running, and never shown to a guest, a null-DOB profile or
//   anyone under PROMO_MIN_AGE.
//
// ⚠ TWO RANKS WERE REMOVED. The Oli tip (which contained a duty-pharmacy entry typed as a
//   tip — see constants/homeStrip.js) and the recently-added place. The place rank had
//   nowhere left to sit once the left card became "today's event" with a stated generic
//   fallback, and its created_at caveat retires with it.
//
// ─── EVERY RANK IS STILL INDIVIDUALLY FALLIBLE ──────────────────────────────
//
// Each source runs inside its own try/catch and a throw drops THAT RANK ONLY:
//   • home_strip_pin DOES NOT EXIST IN PRODUCTION as this ships — the DDL is written and
//     deliberately unapplied, so ranks 1 and 4 answer 42P01 on every call.
//   • Offline, every network rank fails.
//   • RLS: a guest cannot read `events` at all ("read approved events" is TO
//     authenticated), so ranks 2 and 3 are structurally empty for them. A correct empty.
// All of those land on rank 5, which reads nothing and cannot fail.
//
// ─── WHAT THIS RETURNS ──────────────────────────────────────────────────────
//
//   { kind, id, title, subtitle, icon, imageUrl, image, sponsored, action }
//
// `imageUrl` is a remote URI; `image` is a bundled require() for the generic card. Strings
// are RESOLVED here except the generic card's, which are i18n keys — see LiveStrip.

const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// name_i18n[lang] with an English fall-through. Same shape ExploreScreen uses; duplicated
// rather than imported because ExploreScreen is a 1500-line screen module and this file is
// imported by a plain-Node validator.
function i18nText(obj, lang) {
  if (!obj) return ''
  if (typeof obj !== 'object') return String(obj)
  const code = LANG_CODES[lang] ?? lang
  const v = obj[code] ?? obj.en ?? Object.values(obj)[0]
  return v != null ? String(v) : ''
}

const firstImage = v => (Array.isArray(v) ? v.find(Boolean) : v) || null

// ─── RANK 1 + 5 — home_strip_pin ────────────────────────────────────────────
// One table, two jobs, and they are told apart by pin_date rather than by kind:
// a row pinned to TODAY wins outright whatever it is (including a paid takeover), and a
// promo with no pin_date sits in the standing rank-5 pool. A promo can therefore be
// bought as either without a second table.
//
// This fetches EVERY active in-window row and does no date filtering of its own: both
// callers filter, differently, and one fetch serves both ranks. It used to take a
// `todayIso` parameter it never read, which implied the today-filter lived in here.
async function readPins() {
  const { data, error } = await supabase
    .from('home_strip_pin')
    .select('id, kind, target_id, link_url, sponsor_name, title_i18n, subtitle_i18n, image_url, pin_date, starts_at, ends_at')
    .eq('is_active', true)
  if (error) throw error
  const now = Date.now()
  // Flight window is enforced here as well as in the policy. The policy is the boundary;
  // this keeps an expired promo out of the pool even if a future policy edit loosens.
  return (data || []).filter(r =>
    (!r.starts_at || new Date(r.starts_at).getTime() <= now) &&
    (!r.ends_at   || new Date(r.ends_at).getTime()   >= now))
}

async function hydratePin(pin, lang) {
  if (pin.kind === 'promo') {
    return {
      kind: 'promo', id: pin.id,
      title: i18nText(pin.title_i18n, lang),
      subtitle: i18nText(pin.subtitle_i18n, lang),
      icon: 'megaphone-outline',
      imageUrl: pin.image_url || null,
      sponsored: true,
      action: { type: 'link', url: pin.link_url },
    }
  }
  if (pin.kind === 'event') {
    const { data } = await supabase.from('events')
      .select('id, title, images, source_image_url, start_date')
      .eq('id', pin.target_id).eq('status', 'approved').maybeSingle()
    // maybeSingle() returns {data:null, error:null} on zero rows — it does NOT throw — so
    // a pin whose event was unapproved or deleted lands here rather than aborting the
    // ladder. Returning null drops this rank and the ladder continues.
    if (!data) return null
    return {
      kind: 'event', id: data.id,
      title: i18nText(pin.title_i18n, lang) || data.title,
      subtitle: i18nText(pin.subtitle_i18n, lang) || eventWhen(data.start_date, lang),
      icon: 'calendar-outline',
      imageUrl: pin.image_url || firstImage(data.images) || data.source_image_url || null,
      sponsored: false,
      action: { type: 'events', id: data.id },
    }
  }
  if (pin.kind === 'place') {
    const { data } = await supabase.from('places')
      .select('id, name, name_i18n, cover_image_url, photos, region')
      .eq('id', pin.target_id).eq('status', 'active').maybeSingle()
    if (!data) return null
    return {
      kind: 'place', id: data.id,
      title: i18nText(pin.title_i18n, lang) || i18nText(data.name_i18n, lang) || data.name || '',
      subtitle: i18nText(pin.subtitle_i18n, lang),
      icon: 'location-outline',
      imageUrl: pin.image_url || data.cover_image_url || firstImage(data.photos) || null,
      sponsored: false,
      action: { type: 'place', id: data.id },
    }
  }
  return null
}

// Time-of-day only. The card already says "today" by being on this strip, so repeating the
// date spends the subtitle line on something the user knows.
function eventWhen(startDate, lang) {
  if (!startDate) return ''
  const d = new Date(startDate)
  if (Number.isNaN(d.getTime())) return ''
  const code = LANG_CODES[lang] || 'en'
  try {
    return d.toLocaleTimeString(code, { hour: '2-digit', minute: '2-digit' })
  } catch {
    // A locale Hermes' Intl does not carry must not cost the card its subtitle.
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
}

// ─── RANKS 2 + 3 — events ───────────────────────────────────────────────────
// One query serves both: everything from now to end of local day, ordered ascending. The
// SPLIT between "within 6 hours" and "later today" is then a comparison on the first row,
// not a second round trip.
//
// ⚠ MIDNIGHT CAPS THE SIX-HOUR WINDOW, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT.
//   The upper bound is end of LOCAL DAY, so at 22:00 the window is two hours, not six, and
//   a 01:00 event tomorrow does not surface. Rank 2 could reach across midnight instead —
//   but the strip is titled "Bugün ADA'da" and a card promising something for TODAY that
//   happens tomorrow is worse than a card about a place. If this is ever revisited, the
//   change is to the strip's PROMISE first and the window second; do not quietly extend
//   the bound and leave the heading saying today.
async function readEventsToday(now, lang) {
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999)
  const { data, error } = await supabase
    .from('events')
    .select('id, title, images, source_image_url, start_date')
    .eq('status', 'approved')
    .gte('start_date', now.toISOString())
    .lte('start_date', endOfDay.toISOString())
    .order('start_date', { ascending: true })
    .limit(1)
  if (error) throw error
  const e = (data || [])[0]
  if (!e) return null
  return {
    kind: 'event', id: e.id,
    title: e.title || '',
    subtitle: eventWhen(e.start_date, lang),
    icon: 'calendar-outline',
    imageUrl: firstImage(e.images) || e.source_image_url || null,
    sponsored: false,
    action: { type: 'events', id: e.id },
    startsAt: new Date(e.start_date).getTime(),
  }
}

// ─── RANK 5 — the generic events card, and it is terminal ───────────────────
//
// Not a "fallback" in the sense of something that might also fail: it reads no table, has
// no session and its image is a bundled require(). It carries KEYS rather than resolved
// strings because its copy is ours, unlike an event title which is a database row.
function genericEventsItem() {
  return {
    kind: 'event', id: 'generic', generic: true,
    titleKey: 'stripEventsTitle', subtitleKey: 'stripEventsSub',
    icon: 'calendar-outline',
    imageUrl: null,
    sponsored: false,
    action: { type: 'events' },
  }
}

// ─── THE RESOLVER ───────────────────────────────────────────────────────────
//
// `promosEligible` is computed by the CALLER from promosAllowed() in constants/homeStrip.js
// — the policy lives there, this file only obeys it. A resolver that read `profile` would
// be the place the guest/DOB/age rule silently drifts from the place it is documented.
export async function resolveStripItem({ lang, promosEligible = false, now = new Date() }) {
  const todayIso = isoDay(now)
  let pins = null

  // ── RANK 1 ── a pin for today, any kind.
  try {
    pins = await readPins()
    const todays = pins.filter(p => p.pin_date === todayIso)
    for (const p of todays) {
      const item = await hydratePin(p, lang)
      if (item) return item
    }
  } catch { /* table absent, offline, or RLS — fall through */ }

  // ── RANKS 2 + 3 ── events. One fetch, two ranks.
  try {
    const e = await readEventsToday(now, lang)
    if (e) {
      const withinSoon = e.startsAt - now.getTime() <= STRIP_SOON_HOURS * 60 * 60 * 1000
      const { startsAt, ...item } = e
      return { ...item, soon: withinSoon }
    }
  } catch { /* fall through */ }

  // ── RANK 4 ── a sponsored promo. Two gates, and both are hard.
  //
  // ⚠ THE ELIGIBILITY CHECK COMES FIRST AND SHORT-CIRCUITS THE READ. An ineligible user's
  //   device never asks for promo rows at all, rather than fetching them and declining to
  //   draw one. The cheapest way to be sure a thing is not shown is for it never to arrive.
  if (promosEligible) {
    try {
      let lastKind = null
      try { lastKind = await AsyncStorage.getItem(STRIP_LAST_KIND_KEY) } catch { /* absent is fine */ }
      if (lastKind !== 'promo') {
        if (!pins) pins = await readPins()
        const pool = pins.filter(p => p.kind === 'promo' && !p.pin_date)
        for (const p of pool) {
          const item = await hydratePin(p, lang)
          if (item) return item
        }
      }
    } catch { /* fall through */ }
  }

  // ── RANK 5 ── the generic events card. No await, no failure mode.
  return genericEventsItem()
}

// Called by the card once it has actually rendered something, so "what was shown last" is
// a record of what the USER SAW rather than of what the resolver returned — those differ
// if a mount is abandoned mid-flight, and the promo rule is about what appeared on screen.
export async function rememberStripKind(kind) {
  try { await AsyncStorage.setItem(STRIP_LAST_KIND_KEY, kind) } catch { /* device-local nicety */ }
}

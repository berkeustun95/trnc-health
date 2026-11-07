// Keşfet map events mode (2026-11-07). Pure, so scripts/test-map-events.mjs can import it in Node.
import { dateRange, eventOverlaps, isEventOver } from '../utils/eventVisibility.js'

// The Etkinlikler date windows the map offers, in chip order. Same keys and windows as the list.
export const MAP_EVENT_RANGES = [
  { key: 'today',   labelKey: 'dateToday' },
  { key: 'weekend', labelKey: 'dateThisWeekend' },
  { key: 'week',    labelKey: 'dateThisWeek' },
]
export const DEFAULT_EVENT_RANGE = 'week'

// One icon per category; the retired concert/festival keys still read as music.
const EVENT_ICON = {
  music: 'musical-notes', concert: 'musical-notes', festival: 'musical-notes',
  nightlife: 'wine', sports: 'football', arts: 'color-palette', family: 'happy',
}
export const eventIcon = category => EVENT_ICON[category] || 'calendar'

const hasCoords = e => Number.isFinite(e?.latitude) && Number.isFinite(e?.longitude)

// Listed, pinnable, and inside the window — soonest first.
export function eventsInRange(events, key, now = new Date()) {
  const range = dateRange(key, null, now)
  return (events || [])
    .filter(hasCoords)
    .filter(e => !isEventOver(e, now))
    .filter(e => !range || eventOverlaps(e, range.from, range.to))
    .sort((a, b) => new Date(a.start_date) - new Date(b.start_date))
}

// One marker per venue: the same hall often runs several shows (Kıbrıs Kids Fest = 3 on one point),
// and stacked markers hide all but one. ~11 m grid, so one building is one venue.
export function venueGroups(events) {
  const byKey = new Map()
  for (const e of events) {
    const key = `${e.latitude.toFixed(4)},${e.longitude.toFixed(4)}`
    if (!byKey.has(key)) byKey.set(key, { key, latitude: e.latitude, longitude: e.longitude, events: [] })
    byKey.get(key).events.push(e)
  }
  return [...byKey.values()]
}

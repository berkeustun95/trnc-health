export const DAY_INDEX = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 }
const AVAIL_DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

// Coarsen to ~1.1km before any off-device call — the App Privacy label
// declares Coarse Location, so precise coords must never leave the device.
export function coarseCoord(n) {
  return n == null ? null : Math.round(n * 100) / 100
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function parseIsOpen(hours) {
  if (!hours) return null
  if (hours.trim() === '24/7') return true
  const match = hours.match(/^([A-Z][a-z]+)-([A-Z][a-z]+)\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/)
  if (!match) return null
  const [, startDay, endDay, startTime, endTime] = match
  const dayStart = DAY_INDEX[startDay]
  const dayEnd = DAY_INDEX[endDay]
  if (dayStart == null || dayEnd == null || dayStart > dayEnd) return null
  const now = new Date()
  const day = now.getDay()
  if (day < dayStart || day > dayEnd) return false
  const toMins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
  const nowMins = now.getHours() * 60 + now.getMinutes()
  return nowMins >= toMins(startTime) && nowMins < toMins(endTime)
}

export function uvLevel(index) {
  if (index == null) return null
  if (index < 3)  return { key: 'uvLow',      color: '#22C55E', warn: false }
  if (index < 6)  return { key: 'uvModerate',  color: '#EAB308', warn: false }
  if (index < 8)  return { key: 'uvHigh',      color: '#F97316', warn: true  }
  if (index < 11) return { key: 'uvVeryHigh',  color: '#EF4444', warn: true  }
  return           { key: 'uvExtreme',  color: '#9333EA', warn: true  }
}

// ─── Weather: MET Norway symbol → our icon and label ────────────────────────
// The weather Edge Function returns MET's BASE symbol code (the _day/_night suffix is
// stripped server-side). Every one of MET's 41 codes lands in one of the nine groups the
// app always showed. Labels are i18n KEYS, looked up through WEATHER_LABEL_KEY — until
// 2026-09-24 they were hardcoded English in every locale, invisible to the i18n scan.
// MET has no drizzle class; its lightest rain maps to the drizzle group.
export function weatherGroup(symbol) {
  const s = typeof symbol === 'string' ? symbol : ''
  if (!s) return 'unknown'
  if (s.includes('thunder')) return 'thunder'
  if (s.includes('snow') || s.includes('sleet')) return 'snow'
  if (s.includes('rainshowers')) return 'showers'
  if (s === 'lightrain') return 'drizzle'
  if (s.includes('rain')) return 'rain'
  if (s === 'fog') return 'fog'
  if (s === 'cloudy') return 'overcast'
  if (s === 'fair' || s === 'partlycloudy') return 'partlyCloudy'
  if (s === 'clearsky') return 'clear'
  return 'unknown'
}

const WEATHER_ICON = {
  clear: '☀️', partlyCloudy: '🌤️', overcast: '☁️', fog: '🌫️', drizzle: '🌦️',
  rain: '🌧️', snow: '❄️', showers: '🌦️', thunder: '⛈️', unknown: '🌡️',
}
export const WEATHER_LABEL_KEY = {
  clear: 'weatherClear', partlyCloudy: 'weatherPartlyCloudy', overcast: 'weatherOvercast',
  fog: 'weatherFog', drizzle: 'weatherDrizzle', rain: 'weatherRain', snow: 'weatherSnow',
  showers: 'weatherShowers', thunder: 'weatherThunder', unknown: 'weatherUnknown',
}
export const weatherIcon = symbol => WEATHER_ICON[weatherGroup(symbol)]
export const weatherLabelKey = symbol => WEATHER_LABEL_KEY[weatherGroup(symbol)]

export function isAvailableToday(availability) {
  if (!availability?.schedule) return false
  const day = availability.schedule[AVAIL_DAY_KEYS[new Date().getDay()]]
  return !!(day && !day.closed)
}

// Given a stored provider/agent document reference — either a legacy full public
// URL (…/object/public/<bucket>/<path>) or a new bare object path — return the
// object PATH to sign. These buckets are private, so callers mint a short-lived
// signed URL from this at view time; the stored value is not a working URL itself.
export function storageObjectPath(storedValue, bucket) {
  if (!storedValue) return null
  let v = storedValue.split('?')[0]            // strip ?t=… / any query suffix
  const marker = `/object/public/${bucket}/`
  const i = v.indexOf(marker)
  if (i !== -1) v = v.slice(i + marker.length) // legacy URL → path; else already a path
  return v
}

// MET Norway Locationforecast 2.0 → the weather shape ADA's Home screen reads.
//
// Pure (no Deno, no fetch), so supabase/functions/weather imports it and
// scripts/check-weather-normalize.mjs runs it in Node against a real response.
//
// Why /complete, not /compact: compact omits ultraviolet_index_clear_sky, the 6-hour
// max/min and apparent_air_temperature (measured 2026-09-24 against lat 35.2 lon 33.4) —
// the UV badge, the day highs/lows and "feels like" would all go blank.
//
// ⚠ UV is CLEAR-SKY UV: what the index would be with no cloud. On a grey day it overstates,
//   so the sunscreen warning errs toward warning. MET publishes no cloud-adjusted UV here.
// ⚠ Timestamps are UTC. Days are grouped by the ISLAND's local date (Asia/Famagusta), or
//   "today" would roll over at 03:00 local time and show yesterday's high every evening.

export const MET_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/complete'
export const TZ = 'Asia/Famagusta'
export const FORECAST_DAYS = 4

// The whole island, so a user in the south still gets weather. Anything outside is refused:
// the function is an open endpoint, and this box plus the per-cell cache is what bounds the
// load we put on MET (~300 cells at most).
export const CYPRUS_BBOX = { minLat: 34.5, maxLat: 35.75, minLon: 32.2, maxLon: 34.65 }

// 0.1° cells (~10 km). The phone already rounds to this; the server rounds again and never
// trusts it. MET asks for at most 4 decimals — one is well inside that.
export function cellOf(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const c = { lat: Math.round(lat * 10) / 10, lon: Math.round(lon * 10) / 10 }
  const b = CYPRUS_BBOX
  if (c.lat < b.minLat || c.lat > b.maxLat || c.lon < b.minLon || c.lon > b.maxLon) return null
  return c
}

// MET symbol codes carry _day / _night / _polartwilight. The base code is what we map.
// The legend's own misspellings (lightssleetshowersandthunder, lightssnowshowersandthunder)
// are REAL codes and pass through unchanged.
export const baseSymbol = s => (typeof s === 'string' ? s.replace(/_(day|night|polartwilight)$/, '') : null)

const localParts = (iso, tz) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map(x => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) }
}

const symbolOf = d =>
  baseSymbol(d?.next_1_hours?.summary?.symbol_code ?? d?.next_6_hours?.summary?.symbol_code
    ?? d?.next_12_hours?.summary?.symbol_code)

export function normalizeMet(met, now = new Date(), tz = TZ) {
  const series = met?.properties?.timeseries
  if (!Array.isArray(series) || series.length === 0) return null

  // Current = the latest step at or before now (the cache can be ~30 min old).
  const t = now.getTime()
  let cur = series[0]
  for (const s of series) { if (Date.parse(s.time) <= t) cur = s; else break }
  const ci = cur.data?.instant?.details ?? {}
  const uvNow = ci.ultraviolet_index_clear_sky
    ?? series.find(s => Date.parse(s.time) >= Date.parse(cur.time) && s.data?.instant?.details?.ultraviolet_index_clear_sky != null)
      ?.data.instant.details.ultraviolet_index_clear_sky
    ?? null

  const today = localParts(now.toISOString(), tz).date
  const days = new Map()
  for (const s of series) {
    const { date, hour } = localParts(s.time, tz)
    if (date < today) continue
    if (!days.has(date)) { if (days.size >= FORECAST_DAYS) break; days.set(date, { max: -Infinity, min: Infinity, sym: null, symDist: Infinity }) }
    const d = days.get(date)
    const inst = s.data?.instant?.details ?? {}
    const six = s.data?.next_6_hours?.details ?? {}
    for (const v of [inst.air_temperature, six.air_temperature_max]) if (Number.isFinite(v)) d.max = Math.max(d.max, v)
    for (const v of [inst.air_temperature, six.air_temperature_min]) if (Number.isFinite(v)) d.min = Math.min(d.min, v)
    // The day's symbol: the 6-hour outlook starting nearest local noon (it describes the
    // afternoon, which is what "Thursday: rain" is understood to mean).
    const sym = baseSymbol(s.data?.next_6_hours?.summary?.symbol_code ?? s.data?.next_12_hours?.summary?.symbol_code)
    const dist = Math.abs(hour - 12)
    if (sym && dist < d.symDist) { d.sym = sym; d.symDist = dist }
  }
  const dates = [...days.keys()]

  return {
    current: {
      temperature_2m:       ci.air_temperature ?? null,
      apparent_temperature: ci.apparent_air_temperature ?? ci.air_temperature ?? null,
      relative_humidity_2m: Number.isFinite(ci.relative_humidity) ? Math.round(ci.relative_humidity) : null,
      wind_speed_10m:       Number.isFinite(ci.wind_speed) ? Math.round(ci.wind_speed * 36) / 10 : null,   // m/s → km/h
      uv_index:             uvNow,
      symbol:               symbolOf(cur.data),
    },
    daily: {
      time:               dates,
      symbol:             dates.map(k => days.get(k).sym),
      temperature_2m_max: dates.map(k => (Number.isFinite(days.get(k).max) ? days.get(k).max : null)),
      temperature_2m_min: dates.map(k => (Number.isFinite(days.get(k).min) ? days.get(k).min : null)),
    },
    source: 'MET Norway',
  }
}

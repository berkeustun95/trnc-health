#!/usr/bin/env node
// ─── MET Norway weather: normaliser + symbol mapping ─────────────────────────
//
//   node scripts/check-weather-normalize.mjs
//
// supabase/functions/_shared/met-weather.mjs turns a Locationforecast 2.0 response into the
// shape Home reads; utils/facilityUtils.js maps MET's symbol codes onto our nine icons and
// labels. Neither can be seen on a device until the weather happens to be that weather, so
// the edges are asserted here.
//
// The 41 base codes are MET's own legend (github.com/metno/weathericons weather/legend.csv,
// read 2026-09-24), INCLUDING its two misspellings, which are real API values.
import { normalizeMet, cellOf, baseSymbol } from '../supabase/functions/_shared/met-weather.mjs'
import { weatherGroup, WEATHER_LABEL_KEY } from '../utils/facilityUtils.js'

const MET_CODES = ['clearsky','fair','partlycloudy','cloudy','lightrainshowers','rainshowers','heavyrainshowers',
  'lightrainshowersandthunder','rainshowersandthunder','heavyrainshowersandthunder','lightsleetshowers','sleetshowers',
  'heavysleetshowers','lightssleetshowersandthunder','sleetshowersandthunder','heavysleetshowersandthunder',
  'lightsnowshowers','snowshowers','heavysnowshowers','lightssnowshowersandthunder','snowshowersandthunder',
  'heavysnowshowersandthunder','lightrain','rain','heavyrain','lightrainandthunder','rainandthunder','heavyrainandthunder',
  'lightsleet','sleet','heavysleet','lightsleetandthunder','sleetandthunder','heavysleetandthunder','lightsnow','snow',
  'heavysnow','lightsnowandthunder','snowandthunder','heavysnowandthunder','fog']

const problems = []
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) problems.push(label)
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : `  → got ${JSON.stringify(actual)}`}`)
}

console.log('\nsymbol mapping')
check(`all ${MET_CODES.length} MET codes land in a real group (none 'unknown')`,
  MET_CODES.filter(c => weatherGroup(c) === 'unknown'), [])
check('every group has a label key', Object.keys(WEATHER_LABEL_KEY).length, 10)
check('day/night suffixes are stripped', ['clearsky_day', 'fair_night', 'rainshowers_polartwilight'].map(baseSymbol), ['clearsky', 'fair', 'rainshowers'])
check('thunder wins over snow/rain', ['lightssnowshowersandthunder', 'heavyrainandthunder'].map(weatherGroup), ['thunder', 'thunder'])
check('showers ≠ rain ≠ drizzle', ['rainshowers', 'rain', 'lightrain'].map(weatherGroup), ['showers', 'rain', 'drizzle'])

console.log('\ncells')
check('Nicosia rounds to a 0.1° cell', cellOf(35.1856, 33.3823), { lat: 35.2, lon: 33.4 })
check('outside Cyprus is refused', cellOf(41.0, 29.0), null)
check('non-numbers are refused', cellOf(NaN, 33), null)

console.log('\nnormaliser (synthetic Locationforecast, UTC timestamps)')
const step = (time, temp, sym, extra = {}) => ({ time, data: {
  instant: { details: { air_temperature: temp, apparent_air_temperature: temp + 1, relative_humidity: 50.4, wind_speed: 5, ...extra } },
  next_1_hours: { summary: { symbol_code: sym } }, next_6_hours: { summary: { symbol_code: sym }, details: {} } } })
const met = { properties: { timeseries: [
  step('2026-09-24T19:00:00Z', 22, 'clearsky_night', { ultraviolet_index_clear_sky: 0 }),  // 22:00 local, 24th
  step('2026-09-24T21:00:00Z', 20, 'fair_night'),                                          // 00:00 local, 25th
  step('2026-09-25T09:00:00Z', 30, 'rainshowers_day'),                                     // 12:00 local, 25th
] } }
const late = normalizeMet(met, new Date('2026-09-24T20:30:00Z'))   // 23:30 local
check('"today" at 23:30 local stays the 24th', late.daily.time[0], '2026-09-24')
// 22:30Z is 01:30 on the 25th on the island but still the 24th in UTC — the case that
// actually tells island-date grouping from UTC grouping.
check('"today" is the ISLAND date after local midnight (UTC still says the 24th)',
  normalizeMet(met, new Date('2026-09-24T22:30:00Z')).daily.time[0], '2026-09-25')
check('current = latest step at or before now', late.current.temperature_2m, 22)
check('feels-like comes from MET, not computed', late.current.apparent_temperature, 23)
check('wind m/s → km/h, rounded', late.current.wind_speed_10m, 18)
check('day symbol = the 6-hour outlook nearest local noon', late.daily.symbol[1], 'rainshowers')
check('day max/min over the local day', [late.daily.temperature_2m_max[1], late.daily.temperature_2m_min[1]], [30, 20])
check('an empty response is null, not a crash', normalizeMet({ properties: { timeseries: [] } }), null)

if (problems.length) { console.error(`\n  WEATHER CHECK FAILED — ${problems.length} problem(s)\n`); process.exit(1) }
console.log('\nweather normaliser: OK\n')

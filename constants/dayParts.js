// ─── Day parts for the Home "Daylight" experiment (agent/home-lab, Variant A) ──
// Pure data + one function; nothing here touches React. Sun times come from the one SUN table
// in weatherPhotos.js (approximate Nicosia, local clock, ±20 min is fine for a wash).
//
//   dawn  = sunrise − 0.5h … sunrise + 1.5h        dusk = sunset − 1.5h … sunset + 0.5h
//   night = before sunrise − 0.5h, or from sunset + 0.5h         day = the rest
//
// ⚠ scripts/check-hero-contrast.mjs READS the three tables below as text (one entry per line,
//   `key: 'rgba(r,g,b,a)'` / `'#RRGGBB'` / null) and fails on a wash/veil that would hurt the
//   logo, or a glow tint that would hurt the Oli bar text. Keep that one-per-line shape.
import { sunTimes } from './weatherPhotos'

export function dayPart(now = new Date()) {
  const [rise, set] = sunTimes(now.getMonth())
  const h = now.getHours() + now.getMinutes() / 60
  if (h < rise - 0.5 || h >= set + 0.5) return 'night'
  if (h < rise + 1.5) return 'dawn'
  if (h >= set - 1.5) return 'dusk'
  return 'day'
}

// A subtle colour wash over the district photo, UNDER the top/bottom ramps. alpha ≤ 0.22.
export const HERO_WASH = {
  dawn:  'rgba(255,170,130,0.15)',
  day:   null,
  dusk:  'rgba(255,150,40,0.14)',
  night: 'rgba(40,55,130,0.16)',
}

// Island Calendar (Variant C): a dated day's wash REPLACES the day-part wash (the weather veil stays).
// Warm light only: never red or white (national-flag colours). alpha ≤ 0.16. Read by check-hero-contrast.
export const CALENDAR_WASH = {
  newYear:       'rgba(215,180,95,0.16)',
  publicHoliday: 'rgba(120,175,195,0.13)',
  bayram:        'rgba(240,160,50,0.16)',
  bayramEve:     'rgba(240,160,50,0.11)',
}

// A weather veil over the photo, above the wash. alpha ≤ 0.18; clear/partly cloudy get none.
export const WEATHER_VEIL = {
  rain:         'rgba(70,90,115,0.16)',
  drizzle:      'rgba(70,90,115,0.16)',
  showers:      'rgba(70,90,115,0.16)',
  thunder:      'rgba(70,90,115,0.16)',
  fog:          'rgba(120,125,130,0.12)',
  overcast:     'rgba(120,125,130,0.08)',
  clear:        null,
  partlyCloudy: null,
}

// tintColor for the white oli-glow.png: each is no brighter than the untinted (pure white) glow.
export const OLI_GLOW_TINT = {
  dawn:  '#FFD6CC',
  day:   '#FFFFFF',
  dusk:  '#FFCF99',
  night: '#C9D0FF',
}

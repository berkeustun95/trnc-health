import { weatherGroup } from '../utils/facilityUtils'

// ─── Weather tile photos (redesign) ─────────────────────────────────────────
// Bundled, never loaded remotely. ALL CC0 (Wikimedia Commons, licence field read from the
// file's own metadata on 2026-09-30, search filtered by P275 = CC0). Cover-cropped to 720x480
// JPEG q72 (~200 KB for the set). CC0 needs no attribution; the credit is recorded anyway, in
// the same shape as constants/homeHero.js, so provenance is never a question.
// Text never sits on the photo itself — only on the tile's 0.72 band (9.29:1 over white).
export const WEATHER_PHOTOS = {
  clear: {
    asset: require('../assets/weather/clear.jpg'),
    credit: { author: "August Dominus", license: 'CC0', licenseUrl: "http://creativecommons.org/publicdomain/zero/1.0/deed.en",
              sourceUrl: "https://commons.wikimedia.org/wiki/File:Kyrenia_u_rujnu_2025.jpg", source: 'commons' },
  },
  partly: {
    asset: require('../assets/weather/partly.jpg'),
    credit: { author: "Joselodos", license: 'CC0', licenseUrl: "http://creativecommons.org/publicdomain/zero/1.0/deed.en",
              sourceUrl: "https://commons.wikimedia.org/wiki/File:Sea_sky_and_clouds,_Ibiza,_Spain.jpg", source: 'commons' },
  },
  overcast: {
    asset: require('../assets/weather/overcast.jpg'),
    credit: { author: "Jeremy Bishop tidesinourveins", license: 'CC0', licenseUrl: "http://creativecommons.org/publicdomain/zero/1.0/deed.en",
              sourceUrl: "https://commons.wikimedia.org/wiki/File:Wavy_sea_and_overcast_sky_(Unsplash).jpg", source: 'commons' },
  },
  rain: {
    asset: require('../assets/weather/rain.jpg'),
    credit: { author: "Делфина", license: 'CC0', licenseUrl: "http://creativecommons.org/publicdomain/zero/1.0/deed.en",
              sourceUrl: "https://commons.wikimedia.org/wiki/File:Heavy_rain_clouds_hid_the_sunset_by_the_Aegean_Sea.jpg", source: 'commons' },
  },
  storm: {
    asset: require('../assets/weather/storm.jpg'),
    credit: { author: "Leonhard Lenz", license: 'CC0', licenseUrl: "http://creativecommons.org/publicdomain/zero/1.0/deed.en",
              sourceUrl: "https://commons.wikimedia.org/wiki/File:Lightning_at_thunderstorm_from_Spandauer-See-Br%C3%BCcke_143.tif", source: 'commons' },
  },
  fog: {
    asset: require('../assets/weather/fog.jpg'),
    credit: { author: "Socket0", license: 'CC0', licenseUrl: "http://creativecommons.org/publicdomain/zero/1.0/deed.en",
              sourceUrl: "https://commons.wikimedia.org/wiki/File:Swans_in_the_fog,_Bornholm.jpg", source: 'commons' },
  },
  'night-clear': {
    asset: require('../assets/weather/night-clear.jpg'),
    credit: { author: "Korney Violin reka", license: 'CC0', licenseUrl: "http://creativecommons.org/publicdomain/zero/1.0/deed.en",
              sourceUrl: "https://commons.wikimedia.org/wiki/File:Starry_sky_over_rough_mountains_(Unsplash).jpg", source: 'commons' },
  },
  'night-cloudy': {
    asset: require('../assets/weather/night-cloudy.jpg'),
    credit: { author: "W.carter", license: 'CC0', licenseUrl: "http://creativecommons.org/publicdomain/zero/1.0/deed.en",
              sourceUrl: "https://commons.wikimedia.org/wiki/File:Moon_and_clouds_over_Koller%C3%B6d_beach_1.jpg", source: 'commons' },
  },
}

// MET weather group → photo. Snow and unknown are deliberately unmapped: the tile falls back
// to the city tint rather than showing a sky that is not the weather.
const DAY = { clear: 'clear', partlyCloudy: 'partly', overcast: 'overcast', fog: 'fog',
              drizzle: 'rain', rain: 'rain', showers: 'rain', thunder: 'storm' }
const NIGHT = { clear: 'night-clear', partlyCloudy: 'night-cloudy', overcast: 'night-cloudy' }

export function weatherPhoto(symbol, night = false) {
  const g = weatherGroup(symbol)
  const key = (night && NIGHT[g]) || DAY[g]
  return key ? { key, source: WEATHER_PHOTOS[key].asset, credit: WEATHER_PHOTOS[key].credit } : null
}

// The weather function strips MET's _day/_night suffix (supabase/functions/_shared/
// met-weather.mjs baseSymbol), so night is decided on the device: APPROXIMATE Nicosia
// sunrise/sunset per month in local clock time (DST included), ±20 min is fine for a photo.
const SUN = [ // [sunrise, sunset] in decimal hours, Jan..Dec
  [6.9, 17.1], [6.7, 17.5], [6.1, 17.9], [6.4, 19.3], [5.9, 19.7], [5.7, 20.0],
  [5.8, 20.0], [6.2, 19.6], [6.6, 18.9], [7.0, 18.3], [6.5, 16.8], [6.8, 16.7],
]
export function isNightNow(_weatherData, now = new Date()) {
  const [rise, set] = SUN[now.getMonth()]
  const h = now.getHours() + now.getMinutes() / 60
  return h < rise || h >= set
}

export const DAY_INDEX = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 }
const AVAIL_DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

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

export function weatherIcon(code) {
  if (code === 0)  return '☀️'
  if (code <= 2)   return '🌤️'
  if (code === 3)  return '☁️'
  if (code <= 48)  return '🌫️'
  if (code <= 55)  return '🌦️'
  if (code <= 65)  return '🌧️'
  if (code <= 75)  return '❄️'
  if (code <= 82)  return '🌦️'
  if (code <= 99)  return '⛈️'
  return '🌡️'
}

export function weatherDesc(code) {
  if (code === 0)  return 'Clear sky'
  if (code <= 2)   return 'Partly cloudy'
  if (code === 3)  return 'Overcast'
  if (code <= 48)  return 'Foggy'
  if (code <= 55)  return 'Drizzle'
  if (code <= 65)  return 'Rainy'
  if (code <= 75)  return 'Snow'
  if (code <= 82)  return 'Rain showers'
  if (code <= 99)  return 'Thunderstorm'
  return 'Unknown'
}

export function isAvailableToday(availability) {
  if (!availability?.schedule) return false
  const day = availability.schedule[AVAIL_DAY_KEYS[new Date().getDay()]]
  return !!(day && !day.closed)
}

// Photo attribution, resolved for ONE photo of a place. Shared so the detail screen,
// the seed script, and anything that renders a credit later all read the column the
// same way.
//
// TWO COLUMNS, ON PURPOSE, AND THE ORDER MATTERS.
//
//   photo_attribution — jsonb, KEYED BY PHOTO URL. The real source of truth.
//   photo_credits     — text[], POSITIONAL, legacy. Still the only thing the shipped
//                       production JS renders, so it is written too until the OTA
//                       carrying the new renderer has been out long enough.
//
// Keyed-by-URL exists because positional attribution is silently wrong after an
// ordinary edit: delete photos[0] and every remaining credit re-points to the photo
// before it. That is a legally incorrect attribution produced by a routine action,
// with nothing to detect it. A URL key cannot drift — remove the photo and its entry
// is merely orphaned, which is inert.
//
// ─── WHY THIS RETURNS null RATHER THAN AN EMPTY-STRING OBJECT ────────────────
//
// A legacy row (photo_attribution IS NULL, photo_credits '{}') must render NOTHING,
// not an empty credit line. Returning {credit:'',license:''} pushes that decision to
// every caller, and the first caller to write `{a.credit}` ships a blank line under
// the photo. One falsy check at the call site is the whole contract.

// license shortname → canonical deed URL. Only used to BACKFILL a missing license_url
// on a legacy entry; a license_url present in the data always wins, because the row
// knows its own version and this table cannot.
const LICENSE_URLS = {
  'CC BY 2.0':      'https://creativecommons.org/licenses/by/2.0/',
  'CC BY 3.0':      'https://creativecommons.org/licenses/by/3.0/',
  'CC BY 4.0':      'https://creativecommons.org/licenses/by/4.0/',
  'CC BY-SA 2.0':   'https://creativecommons.org/licenses/by-sa/2.0/',
  'CC BY-SA 3.0':   'https://creativecommons.org/licenses/by-sa/3.0/',
  'CC BY-SA 4.0':   'https://creativecommons.org/licenses/by-sa/4.0/',
  'CC0':            'https://creativecommons.org/publicdomain/zero/1.0/',
}

const clean = v => (typeof v === 'string' && v.trim() ? v.trim() : null)

// Legacy strings were written as "Photo: {credit} / {license}" (and, after the
// full-notice pass, "Fotoğraf: {credit} / {license} — {license uri}"). Parse what is
// recoverable and leave the rest null — a guess here becomes a false licensing claim,
// so anything not clearly delimited is returned whole as the credit.
function parseLegacy(str) {
  const s = clean(str)
  if (!s) return null

  const body = s.replace(/^\s*(Photo|Fotoğraf|Foto)\s*:\s*/i, '')
  const [beforeUri, uri] = body.split(/\s+[—–-]\s+(?=(?:https?:\/\/)?creativecommons\.org)/)
  const slash = (beforeUri ?? body).lastIndexOf(' / ')

  if (slash === -1) return { credit: (beforeUri ?? body).trim(), license: null, licenseUrl: null }

  const credit  = beforeUri.slice(0, slash).trim()
  const license = beforeUri.slice(slash + 3).trim()
  const url     = clean(uri)
  return {
    credit:  credit || null,
    license: license || null,
    licenseUrl: url ? (url.startsWith('http') ? url : `https://${url}`) : (LICENSE_URLS[license] ?? null),
  }
}

// place: a row carrying photo_attribution and/or photo_credits.
// url:   the photo being displayed. index: its position in place.photos.
//
// Returns {credit, license, licenseUrl, sourceUrl, source} or null when the photo has
// no attribution at all. `credit` is the only field guaranteed non-null on a non-null
// return — a legacy string may yield nothing else.
export function resolveAttribution(place, url, index) {
  const entry = url ? place?.photo_attribution?.[url] : null

  if (entry && typeof entry === 'object') {
    const credit  = clean(entry.credit)
    const license = clean(entry.license)
    // An entry with neither is not attribution, it is an empty object. Fall through to
    // the legacy array rather than returning a shell that renders as a blank line.
    if (credit || license) {
      return {
        credit,
        license,
        licenseUrl: clean(entry.license_url) ?? (license ? LICENSE_URLS[license] ?? null : null),
        sourceUrl:  clean(entry.source_url),
        source:     clean(entry.source),
      }
    }
  }

  const legacy = Number.isInteger(index) ? parseLegacy(place?.photo_credits?.[index]) : null
  if (!legacy || (!legacy.credit && !legacy.license)) return null
  return { ...legacy, sourceUrl: null, source: null }
}

// The legacy `photo_credits[i]` string, derived from an attribution entry so the two
// columns cannot disagree. ONE definition, used by the seed script when it writes both.
//
// CREATOR + LICENSE + LICENSE URI, AND DELIBERATELY NOT THE SOURCE PAGE.
// The legacy renderer is a single untappable Text. Creator, licence and the licence URI
// are what CC BY-SA 4.0 §3(a)(2) asks for and fit a line that a reader will actually
// read; appending the Commons file page too pushes it past what "reasonable to the
// medium" can carry, for a link nobody can follow anyway. The source page returns as a
// real tappable link in the attribution renderer, which is days away, not months.
export function legacyCreditString(entry, lang) {
  const credit  = clean(entry?.credit)
  const license = clean(entry?.license)
  if (!credit && !license) return null

  const prefix = lang === 'tr' ? 'Fotoğraf' : 'Photo'
  const head   = [credit, license].filter(Boolean).join(' / ')
  const url    = clean(entry?.license_url) ?? (license ? LICENSE_URLS[license] ?? null : null)

  return url ? `${prefix}: ${head} — ${url.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
             : `${prefix}: ${head}`
}

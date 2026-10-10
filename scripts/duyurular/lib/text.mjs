// Text helpers shared by every Duyurular parser. Pure functions, no I/O.

// Plain toLowerCase() turns 'İ' into 'i̇' (i + U+0307) and 'I' into 'i', so every all-caps
// Turkish title (İHALE, İLAN, SINAV) misses a lowercase keyword. Measured 2026-10-10 on the
// first source probe. Every comparison in this module goes through trLower.
export const trLower = s => String(s ?? '').toLocaleLowerCase('tr-TR')

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»',
  hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•',
  ccedil: 'ç', Ccedil: 'Ç', ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü', iacute: 'í', eacute: 'é' }

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n] ?? m)
}
const safeCodePoint = n => (n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '')

export const stripCdata = s => String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')

// HTML fragment → one line of plain text. Feeds often double-encode (&lt;p&gt;), so decode
// before AND after stripping tags.
export function htmlToText(s) {
  let t = stripCdata(s)
  if (/&lt;\/?[a-z]/i.test(t)) t = decodeEntities(t)
  t = t.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
       .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
       .replace(/<[^>]+>/g, ' ')
  return decodeEntities(t).replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
}

export const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim()

export function excerptOf(text, max = 240) {
  const t = oneLine(text)
  if (!t) return null
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const sp = cut.lastIndexOf(' ')
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.–-]+$/, '') + '…'
}

// Title normalised for near-duplicate detection across sites (the same exam notice appears on
// ktezo, mebnet and mtod under three URLs).
export const titleKey = t => trLower(oneLine(t)).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 160)

export const MONTHS = ['ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', 'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık']
const MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
export const MONTH_RE = '(?:' + MONTHS.join('|') + '|subat|mayis|agustos|eylul|kasim|aralik)'
const monthIndex = m => {
  const x = trLower(m).replace('subat', 'şubat').replace('mayis', 'mayıs').replace('agustos', 'ağustos')
    .replace('eylul', 'eylül').replace('kasim', 'kasım').replace('aralik', 'aralık')
  const i = MONTHS.indexOf(x)
  return i >= 0 ? i : MONTHS_EN.indexOf(x.slice(0, 3))
}

// A calendar date that exists (31.02 does not), as {y, m (0-11), d}, or null.
export function validDate(y, m, d) {
  if (!(y >= 2000 && y <= 2100 && m >= 0 && m <= 11 && d >= 1 && d <= 31)) return null
  const dt = new Date(Date.UTC(y, m, d))
  return dt.getUTCMonth() === m && dt.getUTCDate() === d ? { y, m, d } : null
}

// TRNC is UTC+3 all year (no DST since 2016). A date-only value means that day in Lefkoşa.
export const TRNC_OFFSET_H = 3
export const dateAtTrnc = ({ y, m, d }, h = 0, min = 0, s = 0) => new Date(Date.UTC(y, m, d, h - TRNC_OFFSET_H, min, s))
export const endOfDayTrnc = ymd => dateAtTrnc(ymd, 23, 59, 59)
export function trncToday(now = new Date()) {
  const t = new Date(now.getTime() + TRNC_OFFSET_H * 3600e3)
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() }
}

// Listing dates in the shapes the source pages use: 08.10.2026 · 8/10/2026 · 2026-10-08 ·
// 8 Ekim 2026 · 08 Oct 2026. Returns a Date at TRNC midnight, or null.
export function parseListingDate(s) {
  const t = trLower(oneLine(s))
  let m = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/)
  if (m) { const v = validDate(+m[1], +m[2] - 1, +m[3]); if (v) return dateAtTrnc(v) }
  m = t.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/)
  if (m) { const v = validDate(+m[3], +m[2] - 1, +m[1]); if (v) return dateAtTrnc(v) }
  m = t.match(new RegExp('\\b(\\d{1,2})\\s+(' + MONTH_RE + '|[a-z]{3,9})\\s+(\\d{4})'))
  if (m) { const mi = monthIndex(m[2]); const v = mi >= 0 && validDate(+m[3], mi, +m[1]); if (v) return dateAtTrnc(v) }
  return null
}

export function parseFeedDate(s) {
  if (!s) return null
  const d = new Date(oneLine(s))
  if (!Number.isNaN(d.getTime())) return d
  return parseListingDate(s)
}

export { monthIndex }

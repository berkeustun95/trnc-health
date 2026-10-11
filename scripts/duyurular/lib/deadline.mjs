// Deadline extraction (approved 2026-10-10, option C). Only clearly worded deadlines count:
//   "son başvuru / son teklif / son müracaat / son kayıt … <date>"
//   "<date> … tarihine / gününe / saatine / mesai bitimine kadar", with başvuru/teklif/müracaat/
//   kayıt in the surrounding text.
//   "başvurular … <date> - <date> … tarihleri arasında" (the window's end; KHK münhal PDFs).
//   "başvuru tarihleri: 7, 8 ve 9 Ekim 2026" (the last listed day; MEB).
// Accepted only if the date is today or later (TRNC), at most 180 days ahead, and not before the
// item's publication day. More than one distinct surviving date = ambiguous = null.
// Only the date leaves this module; the text it was read from is never stored.

import { trLower, MONTH_RE, monthIndex, validDate, endOfDayTrnc, trncToday } from './text.mjs'

const DMY = '(\\d{1,2})\\s*[./-]\\s*(\\d{1,2})\\s*[./-]\\s*(\\d{4})'
const DMONTH = '(\\d{1,2})\\s+(' + MONTH_RE + ')(?:\\s+(\\d{4}))?'
const DATE = `(?:${DMY}|${DMONTH})`

const LEAD = new RegExp(
  'son\\s+(?:başvuru|teklif|müracaat|kayıt)(?:\\s+(?:verme|tarihi|günü|tarih|ve|saati|saat|zamanı))*' +
  '[^0-9a-zçğıöşü]{0,12}(?:[a-zçğıöşü]+\\s+){0,3}?' + DATE, 'g')
const TRAIL = new RegExp(DATE +
  '(?:[^.;\\n]{0,45}?)\\s*[\'’]?\\s*(?:(?:tarihine|tarihi|gününe|günü|saatine|saat\\s*\\d{1,2}[:.]\\d{2}\\s*[\'’]?\\s*[a-zçğıöşü]{0,3}|mesai\\s+bitimine|mesai\\s+saati\\s+bitimine)\\s+kadar)', 'g')
// "başvuran adaylara" (applicants) is NOT deadline wording; a KHK PDF's legal transition
// date ("31 Aralık 2026 tarihine kadar münhal ilan edilen … başvuran adaylara") must not pass.
const CONTEXT = /başvuru|başvurul|başvurma|başvurabil|müracaat|teklif|kayıt/
// KHK münhal wording (measured 2026-10-10): "yapılacak başvurular, 6 Ekim 2026 - 13 Mayıs 2027
// (her iki tarih dahil) tarihleri arasında". The END of the application window is the deadline.
const WINDOW = new RegExp('başvuru(?:lar|ları)?[^.;]{0,140}?' + DATE + '\\s*[-–]\\s*' + DATE + '[^.;]{0,40}?tarihleri\\s+arasında', 'g')

// "Başvuru tarihleri: 7, 8 ve 9 Ekim 2026" (MEB, measured 2026-10-10): the LAST listed day.
const DAYLIST = new RegExp('başvuru\\s+(?:tarihleri|tarihi|günleri|günü)\\s*:?\\s*(?:\\d{1,2}\\s*(?:,|ve|-|–)\\s*)*' + DATE, 'g')

function toYmd(g, offset, publishedYmd) {
  if (g[offset]) return validDate(+g[offset + 2], +g[offset + 1] - 1, +g[offset])
  const d = +g[offset + 3], mi = monthIndex(g[offset + 4])
  if (mi < 0) return null
  if (g[offset + 5]) return validDate(+g[offset + 5], mi, d)
  // No year: the first occurrence on or after the publication day.
  const base = publishedYmd || trncToday()
  let y = base.y
  const v = validDate(y, mi, d)
  if (v && Date.UTC(v.y, v.m, v.d) < Date.UTC(base.y, base.m, base.d)) y += 1
  return validDate(y, mi, d)
}

const dayNum = ({ y, m, d }) => Date.UTC(y, m, d) / 864e5

// → { date: Date|null, status: 'found'|'none'|'ambiguous'|'past'|'too_far'|'before_published', candidates }
export function extractDeadline(rawText, { published = null, now = new Date() } = {}) {
  const text = trLower(String(rawText ?? '')).replace(/\s+/g, ' ')
  if (!text) return { date: null, status: 'none', candidates: 0 }
  const pub = published ? (() => { const t = new Date(published.getTime() + 3 * 3600e3); return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() } })() : null
  const found = []
  for (const m of text.matchAll(LEAD)) { const v = toYmd(m, 1, pub); if (v) found.push(v) }
  for (const m of text.matchAll(DAYLIST)) { const v = toYmd(m, 1, pub); if (v) found.push(v) }
  for (const m of text.matchAll(WINDOW)) { const v = toYmd(m, 7, pub); if (v) found.push(v) }
  for (const m of text.matchAll(TRAIL)) {
    const around = text.slice(Math.max(0, m.index - 120), m.index + m[0].length + 60)
    if (!CONTEXT.test(around)) continue
    const v = toYmd(m, 1, pub); if (v) found.push(v)
  }
  if (!found.length) return { date: null, status: 'none', candidates: 0 }
  const today = dayNum(trncToday(now))
  const distinct = [...new Map(found.map(v => [dayNum(v), v])).values()]
  const ok = distinct.filter(v => dayNum(v) >= today && dayNum(v) <= today + 180 && (!pub || dayNum(v) >= dayNum(pub)))
  if (ok.length === 1) return { date: endOfDayTrnc(ok[0]), status: 'found', candidates: distinct.length }
  if (ok.length > 1) return { date: null, status: 'ambiguous', candidates: distinct.length }
  const n = dayNum(distinct[0])
  return { date: null, status: n < today ? 'past' : n > today + 180 ? 'too_far' : 'before_published', candidates: distinct.length }
}

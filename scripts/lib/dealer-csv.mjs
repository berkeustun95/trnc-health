// A dealer's hand-kept stock CSV → vehicles rows. Pure (no I/O), so scripts/test-dealer-import.mjs can prove the
// mapping, and scripts/import-dealer-cars.mjs only reads, compares and writes.
//
// The CSV is the dealer's own stock list (Berke collects it; the owner consented). One row per car, matched by
// ilan_no. A row that cannot be mapped exactly is SKIPPED and reported, never guessed: a missing km stays missing.
// Columns: ilan_no, marka, model, versiyon, yil, durum, kasa, yakit, vites, direksiyon, motor_cc, renk, km, sehir,
// fiyat_liste, fiyat_aciklamada, para_birimi, ozellikler, aciklama, not, and optionally tur (Satılık / Kiralık).
import { createHash } from 'node:crypto'

// RFC 4180: quoted fields, "" for a quote, commas and newlines inside quotes.
export function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++ } else quoted = false }
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(f => f !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some(f => f !== '')) rows.push(row)
  if (quoted) throw new Error('CSV: an unclosed quote')
  const [head, ...body] = rows
  if (!head) return []
  const cols = head.map(h => h.trim())
  return body.map((r, i) => {
    if (r.length !== cols.length) throw new Error(`CSV: data row ${i + 1} has ${r.length} fields, the header has ${cols.length}`)
    return Object.fromEntries(cols.map((c, j) => [c, r[j].trim()]))
  })
}

const key = s => s.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim()
const table = o => new Map(Object.entries(o).map(([k, v]) => [key(k), v]))

export const FUEL = table({ Benzin: 'petrol', Dizel: 'diesel', Hibrit: 'hybrid', 'Mild Hibrit Benzin': 'hybrid', Elektrik: 'electric', LPG: 'lpg' })
export const GEARBOX = table({ Otomatik: 'automatic', 'Düz': 'manual' })
export const BODY = table({
  Sedan: 'sedan', Hatchback: 'hatchback', 'Hatchback 5 Kapı': 'hatchback', 'Hatchback 3 Kapı': 'hatchback', SUV: 'suv',
  Stationwagon: 'estate', Coupe: 'coupe', Cabrio: 'convertible', 'Pick-up': 'pickup', Panelvan: 'van', Minivan: 'minivan',
  'Minibüs': 'minibus',
})
// Nearest of the 14 colours (Berke saw this list, 2026-11-10: Bordo → red, Lacivert → blue, Krem → beige).
export const COLOUR = table({
  Beyaz: 'white', Siyah: 'black', Gri: 'grey', 'Gri Metalik': 'grey', 'Gümüş': 'silver', Mavi: 'blue', Lacivert: 'blue',
  'Kırmızı': 'red', Bordo: 'red', 'Yeşil': 'green', 'Buz Yeşili': 'green', 'Sarı': 'yellow', Turuncu: 'orange',
  Kahverengi: 'brown', Bej: 'beige', Krem: 'beige', 'Altın': 'gold', Mor: 'purple',
})
export const STEERING = table({ 'Sağ': 'right', Sol: 'left' })
export const REGION = table({
  'Lefkoşa': 'nicosia', Girne: 'kyrenia', 'Gazimağusa': 'famagusta', 'Mağusa': 'famagusta', 'Güzelyurt': 'morphou',
  'İskele': 'iskele', Lefke: 'lefke', Karpaz: 'karpaz',
})
export const INTENT = table({ 'Satılık': 'sale', 'Kiralık': 'rent' })
const CURRENCIES = ['GBP', 'TRY', 'EUR', 'USD']

// Whole numbers only: "29950", "29.950", "29,950" (a thousands separator, never a decimal: no car price or km has one).
export function wholeNumber(s) {
  if (!/^\d{1,3}([.,]\d{3})+$|^\d+$/.test(s)) return null
  return Number(s.replace(/[.,]/g, ''))
}

// A description may not carry a way to reach anyone but the dealer's own buttons: phone numbers, e-mail addresses,
// links and handles are cut out. Only PHONE-SHAPED numbers are cut (a +/00/0 prefix, a 5xx mobile, a 3-2-2 landline):
// "12.500-11.950 GBP", "150.000-160.000 km" and "2015-2016 120.000" are prices, km and years and must survive
// (review 2026-11-10). Separators never include a newline, so two paragraphs cannot join into a "number".
const SEP = '[ ()./-]{0,3}'
const NOT_IN_NUMBER = '(?<!\\d)(?<!\\d[.,])'
const CONTACT = [
  /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g,
  /\b(?:https?:\/\/|www\.)\S+/gi,
  /\b[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|info|biz|me|co|tr|uk|cy)\b(?:\/\S*)?/gi,
  /(?<![\w.])@[\w.]{2,}/g,
  new RegExp(`\\(?${NOT_IN_NUMBER}(?:\\+|00)\\d(?:${SEP}\\d){9,13}(?!\\d)`, 'g'),
  new RegExp(`\\(?${NOT_IN_NUMBER}0\\d{3}${SEP}\\d{3}${SEP}\\d{2}${SEP}\\d{2}(?!\\d)`, 'g'),
  new RegExp(`${NOT_IN_NUMBER}5\\d{2}[ -]?\\d{3}[ -]?\\d{2}[ -]?\\d{2}(?!\\d)`, 'g'),
  new RegExp(`${NOT_IN_NUMBER}5\\d{2}\\.\\d{3}\\.\\d{2}\\.\\d{2}(?!\\d)`, 'g'),
  new RegExp(`${NOT_IN_NUMBER}\\d{3}[ -]\\d{2}[ -]\\d{2}(?![\\d.,]\\d)(?!\\d)`, 'g'),
]
export function stripContacts(text) {
  let out = text
  const cut = []
  for (const re of CONTACT) out = out.replace(re, m => { cut.push(m.trim()); return '' })
  out = out.replace(/\(\s*\)/g, '').replace(/[ \t]{2,}/g, ' ').replace(/ +([,.;:])/g, '$1').trim()
  return { text: out, cut }
}

// What may still be a contact after the cut: the row is then SKIPPED and shown, never imported on a guess. Prices and
// km (1-3 digits then groups of three) and years are taken out first, so they cannot look like a long digit run.
export function contactResidue(text) {
  const bare = text.replace(/\d{1,3}(?:[.,]\d{3})+/g, ' ').replace(/\b(?:19|20)\d{2}\b/g, ' ')
  const m = bare.match(/@|\d{7,}|(?:\d[ ()./-]{0,2}){9,}\d|\b(?:whatsapp|instagram|facebook|telegram)\s*:/i)
  return m ? m[0].trim() : null
}

export function buildDescription(r) {
  const head = [r.versiyon, r.motor_cc && `${r.motor_cc} cc`, r.durum].filter(Boolean).join(' · ')
  const { text, cut } = stripContacts([head, r.ozellikler, r.aciklama].filter(Boolean).join('\n\n'))
  return { description: text || null, cut, residue: contactResidue(text) }
}

// One CSV row → { ref, row } or { ref, problems }. `flags` are notes for the run log (a price that differs from the
// one in the dealer's own text is imported at the list price and flagged).
export function mapCar(r) {
  const problems = [], flags = []
  const pick = (map, col, label) => {
    const v = map.get(key(r[col] ?? ''))
    if (!v) problems.push(`${label} "${r[col] ?? ''}" has no match`)
    return v
  }
  const ref = r.ilan_no
  if (!/^[A-Za-z0-9-]{1,40}$/.test(ref ?? '')) problems.push(`ilan_no "${ref ?? ''}" is not a plain reference`)
  const intent = r.tur ? pick(INTENT, 'tur', 'tur') : 'sale'
  const year = wholeNumber(r.yil ?? '')
  if (year === null || year < 1950 || year > 2100) problems.push(`yil "${r.yil ?? ''}" is not a year`)
  const km = r.km === '' || r.km == null ? null : wholeNumber(r.km)
  if (km === null) problems.push(r.km ? `km "${r.km}" is not a number` : 'km is missing')
  else if (km > 2000000) problems.push(`km ${km} is out of range`)
  const price = wholeNumber(r.fiyat_liste ?? '')
  if (!price) problems.push(`fiyat_liste "${r.fiyat_liste ?? ''}" is not a price`)
  else if (price > (intent === 'rent' ? 1000000 : 100000000)) problems.push(`fiyat_liste ${price} is out of range`)
  if (!CURRENCIES.includes(r.para_birimi)) problems.push(`para_birimi "${r.para_birimi ?? ''}" has no match`)
  if (!r.marka || r.marka.length > 40) problems.push('marka is missing or over 40 characters')
  if (!r.model || r.model.length > 60) problems.push('model is missing or over 60 characters')
  const fuel = pick(FUEL, 'yakit', 'yakit'), gearbox = pick(GEARBOX, 'vites', 'vites'), body_type = pick(BODY, 'kasa', 'kasa')
  const colour = pick(COLOUR, 'renk', 'renk'), steering = pick(STEERING, 'direksiyon', 'direksiyon'), region = pick(REGION, 'sehir', 'sehir')
  const { description, cut, residue } = buildDescription(r)
  if (description && description.length > 3000) problems.push('the description is over 3000 characters')
  if (residue) problems.push(`the description may still hold a contact ("${residue}"): edit the CSV text`)
  for (const c of cut) flags.push(`contact detail cut from the description: "${c}"`)
  const other = r.fiyat_aciklamada ? wholeNumber(r.fiyat_aciklamada) : null
  if (other !== null && price && other !== price) flags.push(`FİYAT FARKLI: list ${price}, in the dealer's text ${other} (list price used)`)
  if (problems.length) return { ref, problems, flags }
  return {
    ref, flags,
    row: {
      external_id: ref, intent, make: r.marka, model: r.model, year, km, fuel, gearbox, body_type, colour, steering,
      price: intent === 'sale' ? price : null, price_per_day: intent === 'rent' ? price : null, currency: r.para_birimi,
      region, area: null, description,
    },
  }
}

export const HASH_FIELDS = ['intent', 'make', 'model', 'year', 'km', 'fuel', 'gearbox', 'body_type', 'colour', 'steering', 'price', 'price_per_day', 'currency', 'region', 'area', 'description']
const norm = v => (v === null || v === undefined ? null : typeof v === 'number' ? String(v) : /^\d+(\.0+)?$/.test(String(v)) ? String(Number(v)) : String(v))
export const contentHash = row => createHash('sha256').update(JSON.stringify(HASH_FIELDS.map(f => norm(row[f])))).digest('hex')
export const changedFields = (was, now) => HASH_FIELDS.filter(f => norm(was[f]) !== norm(now[f]))

// What a run would do. `existing`: the dealer's rows that carry a reference. A CSV row that could not be mapped keeps
// whatever is live under its reference (a typo in the file must not delete a car); a duplicated reference stops the run.
// A car that is in the CSV but NOT active in ADA (an admin rejected or removed it, or it was sold and came back) is
// HELD: left exactly as it is unless its reference is named in `reactivate`. The importer never undoes moderation.
export function planSync(cars, existing, reactivate = []) {
  const seen = new Set(), dup = new Set()
  for (const c of cars) { if (seen.has(c.ref)) dup.add(c.ref); seen.add(c.ref) }
  if (dup.size) throw new Error(`the CSV lists a reference twice: ${[...dup].join(', ')}`)
  const byRef = new Map(existing.map(e => [e.external_id, e]))
  const plan = { add: [], change: [], same: [], remove: [], held: [], skipped: cars.filter(c => !c.row) }
  const unknown = reactivate.filter(ref => byRef.get(ref)?.status === 'active' || !byRef.has(ref) || !cars.some(c => c.ref === ref && c.row))
  if (unknown.length) throw new Error(`reactivate names a reference that is not a held car in the CSV: ${unknown.join(', ')}`)
  for (const c of cars) {
    if (!c.row) continue
    const was = byRef.get(c.ref)
    if (!was) plan.add.push(c)
    else if (was.status !== 'active' && !reactivate.includes(c.ref)) plan.held.push({ ...c, id: was.id, was })
    else {
      const fields = changedFields(was, c.row)
      if (was.status !== 'active') fields.unshift('status')
      // A stored hash that no longer matches (the hash recipe changed) is rewritten, or the read-back could never pass.
      if (!fields.length && was.content_hash !== contentHash(c.row)) fields.push('content_hash')
      if (fields.length) plan.change.push({ ...c, id: was.id, fields, was })
      else plan.same.push({ ...c, id: was.id })
    }
  }
  plan.remove = existing.filter(e => e.status === 'active' && !seen.has(e.external_id))
  return plan
}

// The safety stop: a new CSV may take a couple of cars away (sold), not the stock. More needs the exact count typed.
export function removalRefusal(plan, existing, confirmed) {
  const live = existing.filter(e => e.status === 'active').length
  const n = plan.remove.length
  if (!plan.add.length && !plan.change.length && !plan.same.length && live) return 'the CSV has no usable car; refusing to remove the whole stock'
  const free = Math.max(2, Math.floor(live / 10))
  if ((n > free || n * 2 > live) && confirmed !== n) return `this run would remove ${n} of ${live} cars; re-run with confirm_remove=${n} if that is right`
  return null
}

// Photo files of one car in display order: 1.jpg is the cover. Anything that is not <number>.<jpg|jpeg|png|webp> is an error.
export function orderPhotos(names) {
  const bad = names.filter(n => !/^\d{1,2}\.(jpe?g|png|webp)$/i.test(n))
  const good = names.filter(n => !bad.includes(n)).sort((a, b) => parseInt(a) - parseInt(b))
  const nums = good.map(n => parseInt(n))
  const dup = nums.filter((n, i) => nums.indexOf(n) !== i)
  return { files: good, problems: [...bad.map(n => `"${n}" is not <number>.jpg/png/webp`), ...dup.map(n => `two files are numbered ${n}`)] }
}

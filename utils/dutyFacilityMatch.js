// ─── Matching a duty_list row to its facilities row ──────────────────────────
//
// duty_list has NO facility_id and no FK to facilities — 20260924 states this twice —
// and the roster is regenerated on every load, so the join is BY NAME and it lives here.
//
// ⚠ CLIENT-SIDE ON PURPOSE, AND THERE IS NO SQL HALF. A database key function plus a JS
//   port is the contains_blocked_term ↔ utils/profanity.js drift hazard: two matchers that
//   both keep working while disagreeing. This one has exactly one implementation, so that
//   failure is not available. pharmacy_name_key() exists in the database for SQL-side work
//   and is deliberately NOT mirrored here — if the two ever need to agree, that is a
//   decision to take explicitly, with a parity check, not by copying a body.
//
// THE KEY: NFC + whitespace collapse + trim. Nothing else.
//   • NFC because duty_list carries decomposed forms. MELİKE DEMİRSÖZ's 2026-07-02 row
//     ends I + U+0307 where facilities has İ (U+0130) — 25 characters against 24, and
//     they render identically. Measured 2026-09-01: NFC alone took the unmatched set
//     from 4 names to 3.
//   • NO case folding and NO ı/i folding. Turkish's two i's are DIFFERENT LETTERS, not a
//     case pair. Folding them would make TURGUT KORHAN ECZANESI match ECZANESİ silently;
//     the alias below makes that same decision visible and reviewable instead.
//   • i + U+0307 SURVIVES NFC (there is no precomposed "i with dot above"), so it is not
//     repaired here. 9 duty_list rows carry it — all in `address`, none in `name` —
//     measured 2026-09-01, so it cannot affect this match. If it ever reaches a name, add
//     the targeted repair; do not widen the key.
export const dutyNameKey = (s) => (s || '').normalize('NFC').replace(/\s+/g, ' ').trim()

// Derived 2026-09-01 against the LIVE 1,653-row duty_list (324 distinct names): exactly
// three names survive the key above with no facilities row.
//
// READ-TIME ALIASES, NOT ROW CORRECTIONS. duty_list is regenerated on every load, so
// editing rows is a no-op that the next load undoes.
const ALIASES = [
  // Roster typo: ECZNESİ, missing the A.
  { from: 'BERKE SEMERCİ ECZNESİ', to: 'BERKE SEMERCİ ECZANESİ' },
  // Dotless I. NOT a case difference — see the note on folding above.
  { from: 'TURGUT KORHAN ECZANESI', to: 'TURGUT KORHAN ECZANESİ' },
  // ⚠ AMBIGUOUS, WHICH IS WHY IT IS REGION-GATED. facilities holds TWO Yusuf Tandoğan
  //   pharmacies — (LEFKOŞA) at 35.1856,33.3610 and (GİRNE) at 35.3298,33.3860, roughly
  //   40 km apart. The bare roster name cannot say which; only the duty row's own region
  //   can. Every bare occurrence in the live table is Lefkoşa (checked 2026-09-01), but a
  //   Girne occurrence would be a DIFFERENT PHARMACY and must never inherit the Lefkoşa
  //   pin — that is the wrong-pin failure that makes someone drive to the wrong town.
  //   Any other region falls through to no match, so the row renders with no distance.
  //   Absent is the safe failure; wrong is not.
  { from: 'YUSUF TANDOĞAN ECZANESİ', to: 'YUSUF TANDOĞAN ECZANESİ (LEFKOŞA)', region: 'Lefkoşa' },

  // KTEB 2026-27 respellings (20261054 filled their phones from the Gazette). Region-gated
  // like the entry above: the name alone is the old spelling of ONE pharmacy in ONE region.
  // HÜSEYİN SAKALLI is the one inference — same Gazette phone (228 46 00) and Ortaköy.
  // scripts/check-duty-aliases.mjs asserts each resolves, and that a wrong region does not.
  { from: 'AYDIN LİFE ECZANESİ',         to: 'AYDIN LIFE ECZANESİ',            region: 'Girne' },
  { from: 'AYDINLİFE ALSANCAK ECZANESİ', to: 'AYDIN LIFE ALSANCAK ECZANESİ',   region: 'Girne' },
  { from: 'GÖKÇEN İLKTAÇ ECZANESİ',      to: 'GÖKCEN İLKTAÇ ECZANESİ',         region: 'Gazimağusa' },
  { from: 'ILGEN ECZANESİ',              to: 'İLGEN ECZANESİ',                 region: 'Girne' },
  { from: 'KAPTANCAN ECZANESİ',          to: 'KAPTAN CAN ECZANESİ',            region: 'Lefkoşa' },
  { from: 'MEHMET GAZİ KÖYLÜ ECZANESİ',  to: 'MEHMET GAZİKÖYLÜ ECZANESİ',      region: 'Girne' },
  { from: 'SAKINER ECZANESİ',            to: 'SAKİNER ECZANESİ',               region: 'Karpaz' },
  { from: 'ŞİFA BİLDİR ECZANESİ',        to: 'ŞİFA BILDIR ECZANESİ',           region: 'Lefke' },
  { from: 'HÜSEYİN SAKALLI ECZANESİ',    to: 'HÜSEYİN KERİM SAKALLI ECZANESİ', region: 'Lefkoşa' },
  // KTEB typo (20261079 renamed the loaded rows; gen-duty-roster-sql.mjs fixes new loads).
  // Kept here for any load that skips the generator. Same phone and Ortaköy address.
  { from: 'ÖZVOL ECZANESİ',              to: 'ÖZYOL ECZANESİ',                 region: 'Lefkoşa' },
]

/** name-key -> facility, built once per load. First row wins; a duplicate name in
 *  facilities is a problem on that side and must not silently pick a different pin
 *  run to run. */
export function buildFacilityIndex(facilities) {
  const byKey = new Map()
  for (const f of facilities || []) {
    const k = dutyNameKey(f.name)
    if (k && !byKey.has(k)) byKey.set(k, f)
  }
  return byKey
}

// The keys a duty row may be found under: its own name, then each alias that applies in
// its region.
function candidateKeys(row) {
  const key = dutyNameKey(row?.name)
  if (!key) return []
  const keys = [key]
  for (const a of ALIASES) {
    if (dutyNameKey(a.from) !== key) continue
    if (a.region && dutyNameKey(a.region) !== dutyNameKey(row.region)) continue
    keys.push(dutyNameKey(a.to))
  }
  return keys
}

/** The matched facility, or null. Null is a normal outcome, not an error: the row
 *  simply renders without a distance, exactly as every row does today. */
export function matchDutyRow(row, index) {
  for (const k of candidateKeys(row)) {
    const hit = index.get(k)
    if (hit) return hit
  }
  return null
}

// Today's duty_list rows → Map(facilityId → { date, from, until }), for isOpenNow
// (utils/facilityUtils.js). Matched by name with the same index and aliases the duty list
// uses, so the two can never disagree about which pharmacy is on duty. Unmatched rows drop.
export function dutyWindowsFor(rows, facilities, date) {
  const out = new Map()
  if (!rows?.length || !date) return out
  const index = buildFacilityIndex(facilities)
  for (const row of rows) {
    const f = matchDutyRow(row, index)
    if (f && row.open_from && row.open_until) out.set(f.id, { date, from: row.open_from, until: row.open_until })
  }
  return out
}

// ─── pharmacy_coords: the duty screen's FIRST coordinate source (20261079) ────
// Roster-keyed (one row per KTEB name) and holding Berke's on-the-ground pins, which beat
// the facilities geocode. Same key and aliases as above — one matcher, two tables.
//
// ⚠ REGION-GATED, unlike the facilities lookup's direct path. pharmacy_coords is keyed by
//   name alone, so a same-named pharmacy in another town would otherwise borrow this pin —
//   the wrong-town failure. Its pre-repo rows say 'Mesarya' where the roster says Üst/Alt.
const MESARYA_SUB = new Set(['Üst Mesarya', 'Alt Mesarya'])
function sameRegion(coordRegion, dutyRegion) {
  const c = dutyNameKey(coordRegion), d = dutyNameKey(dutyRegion)
  if (!c || !d) return false
  return c === d || (c === 'Mesarya' && MESARYA_SUB.has(d))
}

export function buildCoordsIndex(rows) {
  const byKey = new Map()
  for (const r of rows || []) {
    const k = dutyNameKey(r.name)
    if (k && r.lat != null && r.lng != null && !byKey.has(k)) byKey.set(k, r)
  }
  return byKey
}

/** { latitude, longitude } for a duty row: pharmacy_coords first, facilities fallback,
 *  else null (no distance — never a guessed one). */
export function dutyRowCoords(row, coordsIndex, facIndex) {
  for (const k of candidateKeys(row)) {
    const c = coordsIndex.get(k)
    if (c && sameRegion(c.region, row.region)) return { latitude: c.lat, longitude: c.lng }
  }
  const f = matchDutyRow(row, facIndex)
  return f && f.latitude != null && f.longitude != null ? { latitude: f.latitude, longitude: f.longitude } : null
}

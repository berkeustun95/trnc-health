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

/** The matched facility, or null. Null is a normal outcome, not an error: the row
 *  simply renders without a distance, exactly as every row does today. */
export function matchDutyRow(row, index) {
  const key = dutyNameKey(row?.name)
  if (!key) return null
  const direct = index.get(key)
  if (direct) return direct
  for (const a of ALIASES) {
    if (dutyNameKey(a.from) !== key) continue
    if (a.region && dutyNameKey(a.region) !== dutyNameKey(row.region)) continue
    const hit = index.get(dutyNameKey(a.to))
    if (hit) return hit
  }
  return null
}

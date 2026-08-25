#!/usr/bin/env node
// ─── utils/photoAttribution.js — behaviour lock ──────────────────────────────
//
//   node scripts/validate-photo-attribution.mjs
//
// Exists because the two failure modes here are both SILENT and both legal, not
// cosmetic:
//
//   1. A legacy row (photo_attribution NULL) rendering an EMPTY credit line. Nothing
//      throws, nothing looks broken in review — a blank strip under the photo reads as
//      a styling bug and survives for months.
//   2. photo_credits and photo_attribution DISAGREEING, so the shipped renderer shows
//      one attribution and the new one shows another for the same photo. The round-trip
//      case at the bottom is the guard: the derived legacy string must re-parse to the
//      entry that produced it.
//
// ⚠ THIS FILE IS ONLY EVIDENCE IF IT HAS BEEN SEEN TO GO RED. Three breaks were applied
//   and each was watched to fail, with the exact counts:
//     • resolveAttribution returning {credit:''} instead of null → 7 fail (null-safety)
//     • legacyCreditString dropping the license-URI clause       → 3 fail (en, tr, round-trip)
//     • photo_attribution ignored so photo_credits wins          → 2 fail (url-key precedence)
//     • photo_attribution dropped from BROWSE_COLS                → 1 fail (select coverage)
//   A fourth "break" was attempted first and is worth recording: the sed that was
//   supposed to apply break 2 silently did not match, the suite printed 18/18, and that
//   green was almost written down as proof. A break that does not break proves nothing —
//   the patch step now aborts loudly if its replacement finds no match.

import { resolveAttribution, legacyCreditString } from '../utils/photoAttribution.js'

const U = 'https://x/1.jpg'
let pass = 0, fail = 0
const is = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}\n       got  ${g}\n       want ${w}`) }
}

console.log('\n— null / legacy safety: must not crash, must not render a blank line —')
is('null place',           resolveAttribution(null, U, 0), null)
is('undefined everything', resolveAttribution({}, undefined, undefined), null)
is('legacy row, no data',  resolveAttribution({ photo_attribution: null, photo_credits: [] }, U, 0), null)
is('whitespace credit',    resolveAttribution({ photo_credits: ['   '] }, U, 0), null)
is('empty attribution {}', resolveAttribution({ photo_attribution: { [U]: {} }, photo_credits: [] }, U, 0), null)
is('non-object entry',     resolveAttribution({ photo_attribution: { [U]: 'nope' } }, U, 0), null)
is('index out of range',   resolveAttribution({ photo_credits: ['a / b'] }, U, 9), null)

console.log('\n— legacy photo_credits fallback (by index) —')
is('classic format',
  resolveAttribution({ photo_credits: ['Photo: Julian Nyča / CC BY-SA 3.0'] }, U, 0),
  { credit: 'Julian Nyča', license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/', sourceUrl: null, source: null })
is('full-notice, Turkish',
  resolveAttribution({ photo_credits: ['Fotoğraf: Michal Klajban / CC BY-SA 4.0 — creativecommons.org/licenses/by-sa/4.0'] }, U, 0),
  { credit: 'Michal Klajban', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', sourceUrl: null, source: null })
is('bare name, no license',
  resolveAttribution({ photo_credits: ['Berke Üstün'] }, U, 0),
  { credit: 'Berke Üstün', license: null, licenseUrl: null, sourceUrl: null, source: null })

console.log('\n— photo_attribution wins, and is keyed by URL not index —')
const P = {
  photos: [U, 'https://x/2.jpg'],
  photo_credits: ['Photo: WRONG / CC BY 2.0'],
  photo_attribution: { [U]: {
    credit: 'Mike McBey', license: 'CC BY 2.0',
    license_url: 'https://creativecommons.org/licenses/by/2.0/',
    source_url: 'https://commons.wikimedia.org/wiki/File:X', source: 'commons' } },
}
is('url key beats index',
  resolveAttribution(P, U, 0),
  { credit: 'Mike McBey', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/', sourceUrl: 'https://commons.wikimedia.org/wiki/File:X', source: 'commons' })
is('unkeyed photo falls to index',
  resolveAttribution(P, 'https://x/2.jpg', 0),
  { credit: 'WRONG', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/', sourceUrl: null, source: null })
is('missing license_url is backfilled',
  resolveAttribution({ photo_attribution: { [U]: { credit: 'A', license: 'CC BY 4.0' } } }, U, 0),
  { credit: 'A', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', sourceUrl: null, source: null })

console.log('\n— legacyCreditString: creator + license + license URI, no source page —')
is('en', legacyCreditString({ credit: 'Zairon', license: 'CC BY-SA 4.0' }, 'en'),
  'Photo: Zairon / CC BY-SA 4.0 — creativecommons.org/licenses/by-sa/4.0')
is('tr', legacyCreditString({ credit: 'Zairon', license: 'CC BY-SA 4.0' }, 'tr'),
  'Fotoğraf: Zairon / CC BY-SA 4.0 — creativecommons.org/licenses/by-sa/4.0')
is('own photography (no deed URL)', legacyCreditString({ credit: 'Berke Üstün', license: '© ADA' }, 'en'),
  'Photo: Berke Üstün / © ADA')
is('nothing to say', legacyCreditString({}, 'en'), null)

console.log('\n— ROUND TRIP: the two columns must never disagree —')
const e = { credit: 'Mike McBey', license: 'CC BY 2.0' }
is('derived string re-parses to its source entry',
  resolveAttribution({ photo_credits: [legacyCreditString(e, 'tr')] }, U, 0),
  { credit: 'Mike McBey', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0', sourceUrl: null, source: null })


// ─── The column must actually be SELECTED, or none of the above ever runs ────
//
// ExploreProfileScreen takes `place` as a PROP and never re-queries, so the attribution
// renderer can only see what the feeding select asked for. Omit photo_attribution and
// every code path above still passes while the app silently renders the legacy fallback
// and drops the source link — a populated branch that is never once executed.
//
// This is not hypothetical. It is what happened to PropertyDetailScreen's contact bar:
// built, shipped and verified against an embed that selected none of its columns. The
// bug surfaced only when real data arrived. Asserting the select text is crude, but it
// is the difference between a guard and a hope.
import { readFileSync as _read } from 'node:fs'
import { resolve as _resolve, dirname as _dirname } from 'node:path'
import { fileURLToPath as _url } from 'node:url'

const _root = _resolve(_dirname(_url(import.meta.url)), '..')
console.log('\n— photo_attribution must be in every select that feeds the detail screen —')
for (const [file, marker] of [
  ['screens/ExploreScreen.js', 'BROWSE_COLS'],
  ['screens/HomeScreen.js', "supabase.from('places')"],
]) {
  const src = _read(_resolve(_root, file), 'utf8')
  const i = src.indexOf(marker)
  const window = i === -1 ? '' : src.slice(i, i + 1400)
  const ok = i !== -1 && /photo_credits/.test(window) && /photo_attribution/.test(window)
  if (ok) { pass++; console.log(`  ok   ${file} selects photo_attribution`) }
  else {
    fail++
    console.log(`  FAIL ${file} — ${i === -1 ? `marker ${marker} not found` : 'select omits photo_attribution'}`)
    console.log('       The detail screen never re-queries; an omitted column can never render.')
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)

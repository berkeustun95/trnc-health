#!/usr/bin/env node
// ─── Novest mapping validator ────────────────────────────────────────────────
//
//   node scripts/validate-novest-mapping.mjs            # live feed
//   node scripts/validate-novest-mapping.mjs --self     # + prove each guard goes red
//
// Checks the mapping rules in scripts/novest-feed.mjs against the LIVE feed, so a new
// property type, a new deed spelling or a changed contact-block phrasing surfaces here
// rather than as a silently wrong row.
//
// --self is the part that matters. Every assertion below is fed input it MUST reject,
// and the run fails if any of them stays green. A check nobody has watched fail is a
// decoration — three of the towing module's checks were green while parsing nothing.

import {
  getAll, mapPropertyType, extractDeedType, cleanDescription, assertNoPhone,
  decodeEntities, num, int, meta, metaArray, coordsInCyprus, PHONE_RE,
} from '../supabase/functions/_shared/novest-feed.mjs'

const self = process.argv.includes('--self')
let failures = 0
const fail = (...m) => { failures++; console.error('  ✗ ' + m.join(' ')) }
const ok   = (...m) => console.log('  ✓ ' + m.join(' '))

// ─── Guards prove themselves first ───────────────────────────────────────────
if (self) {
  console.log('\n── SELF-TEST: every guard must REFUSE its counter-example ──\n')

  // 1. The deed rule must reject the five real distractors from this same feed.
  const mustReject = [
    '%40 Peşinat Geriye Kalan Koçan Tesliminde',
    'Koçanları Hazır',
    'Koçanı Hazır',
    'Anahtar Teslimine Hazır ,Türk koçanlı ve Asansörü Olan 3 Adet Daire Karşılığı Satılık',
    'Türk Koçanlı Değildir',
  ]
  for (const s of mustReject) {
    const got = extractDeedType(`<ul><li>${s}</li></ul>`)
    got === null ? ok(`deed rejects: ${s.slice(0, 46)}`) : fail(`deed WRONGLY matched: ${s} -> ${got}`)
  }
  for (const s of ['Türk Koçanlı', 'Türk Koçan', '-Türk Koçan']) {
    extractDeedType(`<ul><li>${s}</li></ul>`) === 'turkish'
      ? ok(`deed accepts: ${s}`) : fail(`deed FAILED to match: ${s}`)
  }

  // 2. The phone assert must fire on a body whose contact block used different wording,
  //    which is the exact way truncation-alone fails.
  try {
    assertNoPhone('self-test', cleanDescription('<p>Güzel daire</p><p>Ara: 0533 834 67 70</p>'))
    fail('phone assert did NOT fire on an unmarked contact line')
  } catch { ok('phone assert fires when the İletişim marker is absent') }
  try {
    assertNoPhone('self-test', 'Yenikent Bölgesinde Satılık 2+1 Daire')
    ok('phone assert stays quiet on a clean string')
  } catch (e) { fail('phone assert false-positived on clean text:', e.message) }

  // 3. num() must reject rather than coerce. Number('') === 0 is the bug this prevents.
  for (const bad of ['', '  ', 'yok', 'N/A', '130.000 GBP', null, undefined, '12a'])
    num(bad) === null ? ok(`num rejects ${JSON.stringify(bad)}`) : fail(`num COERCED ${JSON.stringify(bad)} -> ${num(bad)}`)
  num('130000') === 130000 ? ok('num accepts "130000"') : fail('num broke on a valid value')

  // 4. The type priority must resolve the two rows it was ordered for.
  const cases = [
    [['arsa', 'ticari'], 'land',        '19242 Ticari Arsa — land beats commercial'],
    [['apartman-dairesi', 'konut', 'ofis', 'ticari'], 'commercial', '22204 mixed-use — commercial beats apartment'],
    [['konut'], 'apartment', '22055/21804 Konut-only'],
    [['konut', 'villa'], 'villa', 'depth tie'],
    [['konut', 'zemin-kat-daire'], 'apartment', 'depth tie'],
    [[], null, 'untagged 21853 falls through to skip'],
  ]
  for (const [slugs, want, why] of cases) {
    const got = mapPropertyType(slugs)
    got === want ? ok(`type [${slugs.join(',')}] -> ${got}  (${why})`)
                 : fail(`type [${slugs.join(',')}] -> ${got}, expected ${want}  (${why})`)
  }

  // 5. The coordinate tripwire must reject the Miami default and accept a real TRNC pin.
  coordsInCyprus(25.68654, -80.431345) === false
    ? ok('coord tripwire rejects the Houzez Miami default')
    : fail('coord tripwire ACCEPTED Miami')
  coordsInCyprus(35.1856, 33.3823) === true
    ? ok('coord tripwire accepts a real Lefkoşa pin')
    : fail('coord tripwire rejected a valid TRNC coordinate')
  coordsInCyprus(-80.431345, 25.68654) === false
    ? ok('coord tripwire rejects a lat/lng transposition')
    : fail('coord tripwire accepted transposed coordinates')

  console.log(failures ? `\nSELF-TEST FAILED (${failures})\n` : '\nself-test clean — every guard refused its counter-example\n')
  if (failures) process.exit(1)
}

// ─── Live feed ───────────────────────────────────────────────────────────────
console.log('── LIVE FEED ──\n')
const props = await getAll('/properties', { orderby: 'modified', order: 'desc' })
const types = await getAll('/property_type', { _fields: 'id,name,slug,parent,count' })
const T = new Map(types.map(t => [t.id, t]))
console.log(`  fetched ${props.length} listings, ${types.length} type terms\n`)

// Every type slug the feed uses must be known to the priority list — an unmapped one
// means a new category appeared and rows are about to be skipped silently.
const KNOWN = new Set([
  'arsa','arazi','tarla','studyo','villa','ikiz-villa','bungalow','mustakil-ev',
  'isyeri','dukkan','ticari','depo','magaza','ofis','otel',
  'apartman-dairesi','penthouse','zemin-kat-daire','apartman','dubleks','konut',
])
const unknown = types.filter(t => !KNOWN.has(t.slug)).map(t => `${t.name} [${t.slug}]`)
unknown.length ? fail(`UNMAPPED type term(s) — update TYPE_PRIORITY: ${unknown.join(', ')}`)
               : ok(`all ${types.length} type terms are mapped`)

let typed = 0, untyped = [], deed = 0, phoneLeaks = [], inBox = []
for (const p of props) {
  const slugs = (p.property_type || []).map(i => T.get(i)?.slug).filter(Boolean)
  const t = mapPropertyType(slugs)
  t ? typed++ : untyped.push(p.id)

  if (extractDeedType(p.content.rendered) === 'turkish') deed++

  const desc = cleanDescription(p.content.rendered)
  const title = decodeEntities(p.title.rendered)
  try { assertNoPhone(String(p.id), title, desc) } catch (e) { phoneLeaks.push(e.message) }

  const lat = num(meta(p, 'houzez_geolocation_lat'))
  const lng = num(meta(p, 'houzez_geolocation_long'))
  if (coordsInCyprus(lat, lng)) inBox.push(`${p.id} ${lat},${lng}`)
}

ok(`${typed}/${props.length} listings resolve to a property_type`)
untyped.length && console.log(`    untyped (will be skipped): ${untyped.join(', ')}`)

phoneLeaks.length
  ? fail(`${phoneLeaks.length} listing(s) leak a phone after the strip:\n      ${phoneLeaks.join('\n      ')}`)
  : ok(`0/${props.length} listings leak a phone after the contact strip`)

ok(`${deed}/${props.length} listings yield deed_type='turkish'`)

// Reported as NEWS, not as a pass. The expected value today is 0; if it becomes
// non-zero, Novest has started placing real pins and Slice 1's location_precision
// decision needs revisiting deliberately.
inBox.length
  ? console.log(`  ⚠ ${inBox.length} listing(s) now carry coordinates INSIDE the Cyprus box — this is new:\n      ${inBox.join('\n      ')}`)
  : ok(`0/${props.length} coordinates inside the Cyprus box (all still the Miami default)`)

console.log(failures ? `\nFAILED (${failures})\n` : '\nall mapping checks pass\n')
process.exit(failures ? 1 : 0)

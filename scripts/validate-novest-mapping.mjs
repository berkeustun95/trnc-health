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
  getAll, mapPropertyType, extractDeedType, cleanDescription, assertNoContact,
  decodeEntities, htmlToText, contactKinds, removedTail, num, int, meta, metaArray, coordsInCyprus, PHONE_RE, placeListing, TYPE_PRIORITY, KONUT,
} from '../supabase/functions/_shared/novest-feed.mjs'
import { AREAS_BY_REGION, areaSlug } from '../constants/areas.js'

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
    assertNoContact('self-test', cleanDescription('<p>Güzel daire</p><p>Hemen arayın 0500 000 00 03 numaradan</p>'))
    fail('phone assert did NOT fire on an unmarked phone in prose')
  } catch { ok('phone assert fires when the İletişim marker is absent and the phone is in prose') }
  try {
    assertNoContact('self-test', 'Yenikent Bölgesinde Satılık 2+1 Daire')
    ok('phone assert stays quiet on a clean string')
  } catch (e) { fail('phone assert false-positived on clean text:', e.message) }

  // 2b. THE CONTACT STRIP, one fixture per shape (fictional names and numbers only). Each
  //     compares cleanDescription() with the exact text it must produce.
  const P1 = '0500 000 00 01', P2 = '0500 000 00 02'
  const strip = (label, html, want) => {
    const got = cleanDescription(html)
    got === want ? ok(`strip: ${label}`) : fail(`strip: ${label}\n        got    ${JSON.stringify(got)}\n        wanted ${JSON.stringify(want)}`)
  }
  strip('standard block, 1 agent',
    `<p>Güzel daire</p><ul><li>90M2</li></ul><p><b>İletişim :</b></p><ul><li><b>Ad Soyad : ${P1}</b></li></ul>`,
    'Güzel daire\n• 90M2')
  strip('standard block, 2 agents',
    `<p>Güzel daire</p><ul><li>90M2</li></ul><p><b>İletişim :</b></p><ul><li><b>Ad Soyad : ${P1}</b></li><li><b>Ad Soyad : ${P2}</b></li></ul>`,
    'Güzel daire\n• 90M2')
  strip('block with names and no numbers (22217 shape)',
    '<p>Güzel daire</p><p><b>İletişim :</b></p><ul><li><b>Ad Soyad :</b></li><li><b>Ad Soyad</b> :</li></ul>',
    'Güzel daire')
  strip('mid-text marker + price, then block (21016 shape): prose kept, block removed',
    `<p>Villa metni.</p><p>Detaylı bilgi ve satış için bize iletişime geçin.</p><p>Fiyat: £250.000</p><p><b>İletişim :</b></p><ul><li><b>Ad Soyad : ${P1}</b></li></ul>`,
    'Villa metni.\nDetaylı bilgi ve satış için bize iletişime geçin.\nFiyat: £250.000')
  strip('block with bare phone lines under a bare marker (22419/22426 shape)',
    `<p>Güzel daire</p><ul><li>£100.000</li></ul><p><b>İletişim : </b></p><ul><li><b>${P1}</b></li></ul>`,
    'Güzel daire\n• £100.000')
  strip('marker line carries the name, phone on the next line (22249 shape)',
    `<div>Fiyat: 100.000 STG</div><div></div><div>İletişim: Ad Soyad</div><div>${P1}</div>`,
    'Fiyat: 100.000 STG')
  strip('marker line with name and phone, hashtags after (18029 shape)',
    `<div>Güzel bina £ 1.000.000</div><div>İletişim 📞 Ad Soyad : ${P1}</div><div>#Kibris #Satilik</div>`,
    'Güzel bina £ 1.000.000')
  strip('marker mid-text with NO block after: text unchanged',
    '<p>Bilgi için ofisimizi ziyaret edin.</p><p>Fiyat: £250.000</p><ul><li>90M2</li></ul>',
    'Bilgi için ofisimizi ziyaret edin.\nFiyat: £250.000\n• 90M2')
  strip('e-mail, no marker',
    '<p>Bize e-posta ile ulaşın ad.soyad@example.com adresinden.</p>',
    'Bize e-posta ile ulaşın adresinden.')
  strip('wa.me link, no marker',
    '<p>Yazın https://wa.me/905000000001 şimdi</p>', 'Yazın şimdi')
  strip('WhatsApp link without scheme, no marker',
    '<p>Yazın api.whatsapp.com/send?phone=905000000001 şimdi</p>', 'Yazın şimdi')
  strip('contact line, no marker',
    `<p>Güzel daire</p><p>Ad Soyad : ${P1}</p><p>Son satır</p>`, 'Güzel daire\nSon satır')
  // THE FAIL-OPEN SHAPES (security review 2026-10-26). Each block below used to be STORED
  //  with its contact data by the block-walk. Now each is either cut (block shapes) or refused.
  const N1 = 'Ahmet Örnek', I1 = '+44 7700 900123'
  const cutOk = (label, html, want = 'Güzel daire') => {
    const got = cleanDescription(html)
    let kinds = contactKinds(got)
    ;(got === want && kinds.length === 0)
      ? ok(`cut: ${label}`) : fail(`cut: ${label}\n        got    ${JSON.stringify(got)} kinds=${kinds}\n        wanted ${JSON.stringify(want)}`)
  }
  const refused = (label, html, kind) => {
    const got = cleanDescription(html)
    const kinds = contactKinds(got)
    kinds.includes(kind) ? ok(`refused (${kind}): ${label}`) : fail(`refused: ${label} -> kinds=[${kinds}] wanted ${kind}\n        text ${JSON.stringify(got)}`)
    try { assertNoContact('self-test', got); fail(`assertNoContact let it through: ${label}`) }
    catch (e) { /Ahmet|Örnek|7700|0500|ahmet/.test(e.message) && fail(`refusal message leaks content: ${e.message}`) }
  }
  const BLK = inner => `<p>Güzel daire</p><p><b>İletişim :</b></p>${inner}`
  cutOk('foreign phone', BLK(`<ul><li><b>${N1} : ${I1}</b></li></ul>`))
  cutOk('name-only line, no colon', BLK(`<ul><li><b>${N1}</b></li></ul>`))
  cutOk('Instagram handle', BLK('<ul><li><b>Instagram : @ahmet.emlak</b></li></ul>'))
  cutOk('[at] e-mail', BLK(`<ul><li><b>${N1} : ahmet [at] example.com</b></li></ul>`))
  cutOk('(at) e-mail', BLK(`<ul><li><b>${N1} : ahmet (at) example.com</b></li></ul>`))
  cutOk('website line', '<p>Güzel daire</p><p>İletişim:</p><p>' + N1 + '</p><p>www.ahmetemlak.com</p>')
  cutOk('footer after a name-only block', BLK(`<ul><li><b>${N1}</b></li></ul><p>Novest Property</p>`))
  cutOk('name and phone on separate lines', '<p>Güzel daire</p><p>İletişim:</p><p>' + N1 + `</p><p>${P1}</p>`)
  cutOk('name, span-split colon, phone on the next line', BLK(`<p>${N1}<span> : </span></p><p>${P1}</p>`))
  cutOk('lowercase name', BLK(`<ul><li><b>ahmet örnek : ${P1}</b></li></ul>`))
  cutOk('4+ word name', BLK(`<ul><li><b>Av. Mehmet Ali Can Örnek : ${P1}</b></li></ul>`))
  cutOk('name, br-split', `<p>Güzel daire<br>İletişim:<br>${N1}<br>${P1}</p>`)
  cutOk('national landline in the block', BLK('<ul><li><b>Ofis : 0212 000 00 01</b></li></ul>'))
  // A price in the marker's tail makes it LISTING content, so the block is not cut: these
  // must be refused, not stored.
  const PRICED = tailHtml => `<p>Güzel daire</p><p>İletişim :</p>${tailHtml}<p>Fiyat: £250.000</p>`
  refused('name-only line under an uncut marker', PRICED(`<p>${N1}</p>`), 'uncut-marker')
  refused('website under an uncut marker', PRICED('<p>www.ahmetemlak.com</p>'), 'uncut-marker')
  refused('footer line under an uncut marker', PRICED('<p>Novest Property</p>'), 'uncut-marker')
  refused('@handle under an uncut marker', PRICED('<p>Instagram : @ahmet.emlak</p>'), 'handle')
  refused('[at] e-mail under an uncut marker', PRICED('<p>ahmet [at] example.com</p>'), 'email-obfuscated')
  refused('foreign phone under an uncut marker', PRICED(`<p>${I1}</p>`), 'phone')
  const longProse = '<p>' + 'Girne merkezde denize yakın lüks daire havuzlu site. '.repeat(10) + '</p>'
  refused('long tail (> TAIL_MAX) with a name-only line', `<p>Bilgi için ofisimiz açık.</p>${longProse}<p>${N1}</p>`, 'uncut-marker')
  // B2 (security re-review 2026-10-26): under an uncut marker ANY short non-listing line is refused.
  const tok = '<p>Fiyat: £250.000</p>'
  const UM = inner => `<p>Güzel daire</p><p>İletişim :</p>${inner}${tok}`
  refused('two markers, name between them (tails nest)',
    `<p>Güzel daire</p><p>İletişim :</p><p>${N1}</p><p>Fiyat £250.000</p><p>Detaylı bilgi için ofisimize gelin, 120 m2 showroom.</p>`, 'uncut-marker')
  refused('name - title', UM(`<ul><li>${N1} - Satış Danışmanı</li></ul>`), 'uncut-marker')
  refused('name, agency', UM(`<ul><li>${N1}, Novest</li></ul>`), 'uncut-marker')
  refused('two names with a slash', UM(`<ul><li>${N1} / Mehmet Kaya</li></ul>`), 'uncut-marker')
  refused('name (office)', UM(`<ul><li>${N1} (TL ofis)</li></ul>`), 'uncut-marker')
  refused('6-word name', UM('<ul><li>Av Mehmet Ali Can Örnek Yılmaz</li></ul>'), 'uncut-marker')
  refused('capitalised name on the marker line', `<p>Güzel daire</p><p>İletişim : ${N1} - Danışman</p>${tok}`, 'uncut-marker')
  {
    const got = cleanDescription(UM('<p>Banyo Sayısı : 2</p><p>Havuz : Var</p>'))
    contactKinds(got).includes('uncut-marker') ? fail('feature-label lines under a marker were refused') : ok('feature-label lines (digits / known word) under a marker pass')
  }
  // Decision: a marker in prose with no contact-ish shape after it is content, not a leak.
  strip('marker in long prose, no contact shape: text kept',
    `<p>Bilgi için ofisimiz açık.</p>${longProse}<p>Fiyat: £250.000</p>`,
    'Bilgi için ofisimiz açık.\n' + 'Girne merkezde denize yakın lüks daire havuzlu site. '.repeat(10).trim() + '\nFiyat: £250.000')
  // "2+1" is not an international number, prices and areas are not phones.
  const sizes = '3+1 125 m2 £200.000, 2+1 90m2 100.000 TL, 2+1 85.000 STG +1 120.000'
  cutOk('2+1 / prices / areas are not phones', `<p>${sizes}</p>`, sizes)
  cutOk('dotted phone in a block is cut, not read as a price', BLK('<ul><li><b>Ad Soyad : 0500.000.00.01</b></li></ul>'))

  // ReDoS: 50 KB of adversarial input through the strip and the assert, each under 50 ms.
  {
    const n = 50000, word = ['Girne', 'merkezde', 'denize', 'yakın', 'lüks', 'daire,', 'havuzlu', 'site.', '2+1', '£250.000', '90m2']
    let prose = ''; for (let i = 0; prose.length < n; i++) prose += word[i % word.length] + ' '
    const inputs = {
      letters: 'A' + 'a'.repeat(n),
      'name : letters': 'Ahmet Örnek : ' + 'a'.repeat(n),
      'name : dots': 'Ahmet Örnek : ' + 'a.'.repeat(n / 2),
      'a@b chain': 'Ahmet : ' + 'a@b'.repeat(n / 3),
      'email dots': 'Ahmet : a@' + 'b.'.repeat(n / 2) + '1',
      'digit run': 'Ahmet : ' + '5 3'.repeat(n / 3),
      'plus digits': '+' + '1 '.repeat(n / 2),
      'zero digits': '0' + ' 0'.repeat(n / 2),
      'name words': 'Aa '.repeat(n / 3) + 'x',
      'wa dots': 'Ahmet : ' + 'wa.me'.repeat(n / 5),
      'open paren': 'Ahmet (' + 'a'.repeat(n),
      'many short lines': 'Ahmet : x\n'.repeat(n / 10),
      'tags': '<p>'.repeat(n / 3),
      'markers': 'İletişim '.repeat(n / 9),
      'markers in lines': '<p>İletişim :</p>'.repeat(n / 17),
      'long token': 'x'.repeat(n),
      'long url': '<p>Site : https://example.com/' + 'a'.repeat(n) + '</p>',
      'long bare domain': 'a'.repeat(n) + '.com',
      'prose': `<p>${prose}</p>`,
      'colon prose': ('<p>Konum : ' + prose.slice(0, 800) + '</p>').repeat(Math.ceil(n / 800)),
      'base64 img': '<p><img src="data:image/png;base64,' + 'A'.repeat(n) + '"></p>',
      'handles': '@a1 '.repeat(n / 4),
      'ats': '[at]'.repeat(n / 4),
    }
    let slow = 0, worst = 0
    for (const [k, html] of Object.entries(inputs)) {
      const t0 = performance.now()
      try { assertNoContact('self-test', cleanDescription(html)) } catch { /* a refusal is fine; the clock is the point */ }
      const ms = performance.now() - t0
      worst = Math.max(worst, ms)
      if (process.env.TIMING_VERBOSE) console.log(`      ${k.padEnd(18)} ${ms.toFixed(1)} ms`)
      if (ms >= 50) { slow++; fail(`timing: ${k} took ${ms.toFixed(0)} ms (limit 50)`) }
    }
    slow === 0 && ok(`timing: ${Object.keys(inputs).length} adversarial ${n / 1000} KB inputs, slowest ${worst.toFixed(1)} ms (< 50)`)
  }
  const labels = '<p>Banyo Sayısı : 2</p><ul><li>Mutfak Dolapları :</li><li>Site Fasiliteleri :</li><li>Havuz</li><li>Site Fasiliteleri :</li></ul>'
  strip('feature labels (incl. empty-value) survive byte-for-byte', labels, htmlToText(labels))
  strip('feature labels survive in front of a real block',
    `${labels}<p><b>İletişim :</b></p><ul><li>Ad Soyad : ${P1}</li></ul>`, htmlToText(labels))
  const deedHtml = `<ul><li>Türk Koçanlı</li></ul><p>İletişim :</p><ul><li>Ad Soyad : ${P1}</li></ul>`
  extractDeedType(deedHtml) === 'turkish' ? ok('deed still read in front of a block') : fail('deed lost in front of a block')
  // NBSP inside a phone in prose: not a contact line, so nothing strips it — the assert must refuse.
  const nb = cleanDescription('<p>Bizi 0500\u00a0000\u00a000\u00a001 numarasından arayın</p>')
  try { assertNoContact('self-test', nb); fail('NBSP-separated phone was NOT refused') }
  catch (e) { /phone/.test(e.message) && !/0500/.test(e.message) ? ok('NBSP-separated phone is refused (message names the kind, not the number)') : fail('refusal wrong:', e.message) }
  for (const [kind, text] of [['email', 'yaz ad.soyad@example.com'], ['whatsapp', 'bak wa.me/message/ABCDEF']]) {
    try { assertNoContact('self-test', text); fail(`${kind} was NOT refused`) } catch { ok(`${kind} is refused`) }
  }

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

  // Placement: Karpaz villages filed under the agency's İskele state move to karpaz, with
  // their area; İskele's own villages and unknown cities do not move.
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const place = (st, ci) => placeListing(st, ci, AREAS_BY_REGION, areaSlug)
  eq(place('iskele', 'bafra'), { district: 'karpaz', area: 'bafra' })
    ? ok('placement: İskele state + Bafra -> karpaz / bafra') : fail('placement: Bafra', JSON.stringify(place('iskele', 'bafra')))
  eq(place('iskele', 'bogaz'), { district: 'iskele', area: 'bogaz' })
    ? ok('placement: İskele + Boğaz stays iskele') : fail('placement: İskele Boğaz moved', JSON.stringify(place('iskele', 'bogaz')))
  eq(place('iskele', 'nowhere'), { district: 'iskele', area: null })
    ? ok('placement: unknown city stays iskele, no area') : fail('placement: unknown city', JSON.stringify(place('iskele', 'nowhere')))
  eq(place('girne', 'bogaz'), { district: 'kyrenia', area: 'bogaz' })
    ? ok("placement: Girne's Boğaz stays kyrenia") : fail("placement: Girne's Boğaz", JSON.stringify(place('girne', 'bogaz')))
  eq(place('gazimagusa', 'bafra'), { district: 'famagusta', area: null })
    ? ok('placement: only İskele moves to karpaz (Gazimağusa + Bafra does not)') : fail('placement: non-İskele moved', JSON.stringify(place('gazimagusa', 'bafra')))
  mapPropertyType(['komple-bina']) === 'commercial'
    ? ok('type: komple-bina -> commercial') : fail('type: komple-bina ->', mapPropertyType(['komple-bina']))

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
// DERIVED from TYPE_PRIORITY (+ the konut fallback). It was a hand-copied list until
// 2026-09-29, so mapping a new term in novest-feed.mjs still left this check red.
const KNOWN = new Set([...TYPE_PRIORITY.flatMap(([, theirs]) => theirs), KONUT])
const unknown = types.filter(t => !KNOWN.has(t.slug)).map(t => `${t.name} [${t.slug}]`)
unknown.length ? fail(`UNMAPPED type term(s) — update TYPE_PRIORITY: ${unknown.join(', ')}`)
               : ok(`all ${types.length} type terms are mapped`)

// Listings the agency published with NO taxonomy at all (no type, status, state or city), so
// no mapping can place them. Decided, not forgotten: each stays skipped and is reported once as
// a known skip. Retire an entry when Novest tags the listing or removes it — this check says so.
const KNOWN_UNTAGGED = new Map([
  [21853, 'Yenikent commercial building for sale, published 2026-06-18 untagged; "Yenikent" exists in Lefkoşa and Gazimağusa, so placing it would be a guess. Left skipped by Berke 2026-09-29.'],
])
const untagged = p => ['property_type', 'property_status', 'property_state', 'property_city']
  .every(k => !(p[k] || []).length)

let typed = 0, untyped = [], deed = 0, phoneLeaks = [], inBox = [], tailMax = 0, noCut = []
for (const p of props) {
  const slugs = (p.property_type || []).map(i => T.get(i)?.slug).filter(Boolean)
  const t = mapPropertyType(slugs)
  t ? typed++ : untyped.push(p.id)

  if (extractDeedType(p.content.rendered) === 'turkish') deed++

  const desc = cleanDescription(p.content.rendered)
  const tail = removedTail(p.content.rendered)
  tailMax = Math.max(tailMax, tail.length)
  if (tail === '') noCut.push(p.id)
  const title = decodeEntities(p.title.rendered)
  try { assertNoContact(String(p.id), title, desc) } catch (e) { phoneLeaks.push(e.message) }

  const lat = num(meta(p, 'houzez_geolocation_lat'))
  const lng = num(meta(p, 'houzez_geolocation_long'))
  if (coordsInCyprus(lat, lng)) inBox.push(`${p.id} ${lat},${lng}`)
}

ok(`${typed}/${props.length} listings resolve to a property_type`)
const byId = new Map(props.map(p => [p.id, p]))
const knownSkips = untyped.filter(id => KNOWN_UNTAGGED.has(id) && untagged(byId.get(id)))
const newUntyped = untyped.filter(id => !knownSkips.includes(id))
knownSkips.length && ok(`known skip — untagged in Novest's feed: ${knownSkips.join(', ')}`)
newUntyped.length && console.log(`    ⚠ NEW untyped (will be skipped — needs a decision): ${newUntyped.join(', ')}`)
for (const [id] of KNOWN_UNTAGGED) {
  if (!byId.has(id)) console.log(`    ⚠ KNOWN_UNTAGGED ${id} is no longer in the feed — retire the entry`)
  else if (!untagged(byId.get(id))) console.log(`    ⚠ KNOWN_UNTAGGED ${id} is now tagged in Novest's feed — retire the entry (it may import now)`)
}

phoneLeaks.length
  ? fail(`${phoneLeaks.length} listing(s) leak a phone after the strip:\n      ${phoneLeaks.join('\n      ')}`)
  : ok(`0/${props.length} listings leak a phone after the contact strip`)

ok(`${deed}/${props.length} listings yield deed_type='turkish'`)
console.log(`  contact cut: longest removed tail ${tailMax} plain chars (TAIL_MAX in novest-feed.mjs is the ceiling); listings with NO cut: ${noCut.length}`)

// Reported as NEWS, not as a pass. The expected value today is 0; if it becomes
// non-zero, Novest has started placing real pins and Slice 1's location_precision
// decision needs revisiting deliberately.
inBox.length
  ? console.log(`  ⚠ ${inBox.length} listing(s) now carry coordinates INSIDE the Cyprus box — this is new:\n      ${inBox.join('\n      ')}`)
  : ok(`0/${props.length} coordinates inside the Cyprus box (all still the Miami default)`)

console.log(failures ? `\nFAILED (${failures})\n` : '\nall mapping checks pass\n')
process.exit(failures ? 1 : 0)

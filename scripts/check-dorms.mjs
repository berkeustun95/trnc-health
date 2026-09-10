#!/usr/bin/env node
// ─── Dorm partner config guard ──────────────────────────────────────────────
//
//   npm run dorms:check
//
// WHY THIS EXISTS. Dorm partners are config-only — there is no `dorms` table, so there is
// no CHECK constraint, no RLS policy and no `verify_schema.sql` section standing behind
// any of it. `constants/dorms.js` IS the schema. Everything a database would refuse has to
// be refused here or nowhere.
//
// ⚠ WHAT A HEALTHY RUN PRINTS: the number of partners, keys and assertions it actually
//   made. A guard that silently matched nothing reports "no problems", which is
//   indistinguishable from a clean config unless the counts are on screen. This repo has
//   shipped that exact bug — a seed validator that reported "all 4 rows valid" having
//   parsed zero.
//
// ─── THE PART THAT IS EASY TO GET WRONG: KEYS ASSERTED IN TWO DIRECTIONS ────
//
// Most referenced keys MUST resolve in all nine locales. But `dormAlasiaAbout` is
// referenced and deliberately UNWRITTEN — Özok has supplied no about copy, and inventing
// nine locales of marketing prose about a real business is fabrication with their name on
// it. A guard that only checked "everything resolves" would be red on day one, and the
// tempting fix is to skip the key, which certifies nothing.
//
// So PENDING_KEYS is asserted in the OPPOSITE direction: it must NOT resolve, in any
// locale. The day somebody writes the copy this guard goes RED, and graduating the key
// becomes a deliberate act somebody reviews — which is the whole point. Same two-direction
// shape for assets: wired, or declared owed.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACCOM_SEGMENTS, ACCOM_LANDING, accomSegments, accomLanding,
  DORM_PARTNERS, PENDING_KEYS, GALLERY_ORDER, SECTION_ORDER, COLLAPSIBLE,
  dormDeal, dormWaCode, dormWaMessage, dormWebsiteUrl,
} from '../constants/dorms.js'
import { t, LANG_CODES } from '../constants/i18n.js'
import { colors, readableOn, contrastRatio } from '../constants/theme.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const LANGS = Object.keys(LANG_CODES)
let assertions = 0
const check = (cond, msg) => { assertions++; if (!cond) problems.push(msg) }

// ─── THE FIXTURE MARKER — checked FIRST and fatal on its own ────────────────
//
// scripts/dev/dorm-fixture.mjs fills every null field with obviously fake values so the
// showcase can be seen at maximum content. It must never be committed: the values are
// visibly fake, but a magenta brand colour and 9999 prices shipped to users would be worse
// than either. This is checked before anything else and exits immediately, because every
// assertion below would be measuring the fixture rather than the config.
for (const f of ['constants/dorms.js', 'constants/partnerAssets.js']) {
  if (readFileSync(resolve(ROOT, f), 'utf8').includes('ZZ-DORM-FIXTURE')) {
    console.error(`\n  ┌─ DORM FIXTURE IS APPLIED ──────────────────────────────────────┐`)
    console.error(`  │ ${f} carries the local-only maximum-content fixture.`)
    console.error(`  │ Revert before committing:  node scripts/dev/dorm-fixture.mjs --revert`)
    console.error(`  └────────────────────────────────────────────────────────────────┘\n`)
    process.exit(1)
  }
}

// ─── 0. CONTROLS. If these fail, nothing below means anything ───────────────
//
// Asked BEFORE the run rather than after a surprising result: what would this print if
// the config were perfect? If the answer is the same as when it is broken, it is not a
// probe. t() returning the key on a miss is the mechanism the whole key check rests on —
// so prove it works before trusting it.
if (!LANGS.length) problems.push('CONTROL: LANG_CODES is empty — every locale loop below is a no-op')
if (t('zzNotARealKeyForTheDormGuard', 'Turkish') !== 'zzNotARealKeyForTheDormGuard') {
  problems.push('CONTROL: t() no longer returns the key name on a miss')
}
if (!DORM_PARTNERS.length) problems.push('CONTROL: DORM_PARTNERS is empty — this guard would pass by checking nothing')

// ─── 1. The segment row and the landing tab, in BOTH flag states ────────────
//
// Only testing the state you ship leaves the other untested until the day it matters, and
// the day it matters is go-live. The dark state is what every user has right now; the live
// state is what the flip produces.
const darkIds = accomSegments(false).map(s => s.id)
const liveIds = accomSegments(true).map(s => s.id)
check(!darkIds.includes('dorm'), `dark chip row contains 'dorm': ${darkIds.join(',')}`)
check(liveIds.includes('dorm'),  `live chip row is missing 'dorm': ${liveIds.join(',')}`)
check(liveIds[0] === 'dorm',     `'dorm' is not first when live: ${liveIds.join(',')}`)
check(liveIds.length === darkIds.length + 1, `live row should be exactly one longer than dark (${liveIds.length} vs ${darkIds.length})`)

// THE BUG THIS EXISTS FOR. ACCOM_LANDING is 'dorm' and the flag ships false, so a literal
// read would open the module on a tab that is not in the chip row.
check(accomLanding(true) === ACCOM_LANDING, `accomLanding(true) is ${accomLanding(true)}, expected the declared ${ACCOM_LANDING}`)
check(darkIds.includes(accomLanding(false)),
  `accomLanding(false) returned '${accomLanding(false)}', which is NOT in the dark chip row [${darkIds.join(',')}] — the module would open on an invisible tab`)

// A count, not a name list: a check phrased as a remembered name has no red to go to when
// somebody adds a second promoted chip.
const promoted = ACCOM_SEGMENTS.filter(s => s.promoted).map(s => s.id)
check(promoted.length === 1, `expected exactly 1 promoted segment, found ${promoted.length}: [${promoted.join(',')}]`)

// ─── 2. Per-partner structure ───────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const seenIds = new Set()
const seenCodes = new Set()
const referencedKeys = new Set()
const referencedAssets = new Set()

for (const p of DORM_PARTNERS) {
  const who = p.slug || p.name || '<unnamed>'

  // The UUID is contact_events.entity_id and nothing else verifies it — no seed migration,
  // so no verify_schema token can. Changing it after taps land silently orphans the counts.
  check(UUID_RE.test(String(p.id)), `${who}: id is not a lowercase uuid: ${p.id}`)
  check(!seenIds.has(p.id), `${who}: duplicate id ${p.id}`)
  seenIds.add(p.id)

  check(!!p.code && /^[A-Z]{2,5}$/.test(p.code), `${who}: code must be 2-5 uppercase letters, got ${JSON.stringify(p.code)}`)
  check(!seenCodes.has(p.code), `${who}: duplicate code ${p.code} — utm_campaign and the WhatsApp Kod would collide`)
  seenCodes.add(p.code)

  check(!!p.name, `${who}: no name`)
  check(!p.website || /^https:\/\//.test(p.website), `${who}: website must be https, got ${p.website}`)
  check(!p.email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email), `${who}: email ${JSON.stringify(p.email)} is malformed`)
  check(!p.mapsUrl || /^https:\/\//.test(p.mapsUrl), `${who}: mapsUrl must be https, got ${p.mapsUrl}`)

  // Phone/WhatsApp reach a real business. A malformed number fails at the moment somebody
  // taps call, which is the worst place to find out.
  for (const f of ['phone', 'whatsapp']) {
    if (p[f]) check(/^\+\d[\d ]{6,}$/.test(p[f]), `${who}: ${f} is not a +country-code number: ${JSON.stringify(p[f])}`)
  }

  check(!p.coords || (typeof p.coords.latitude === 'number' && typeof p.coords.longitude === 'number'),
    `${who}: coords must be {latitude, longitude} numbers or null`)

  // ─── The accent must be able to carry readable text ─────────────────────
  //
  // The deal band fills with partner.accent and draws text on it. readableOn() picks the
  // better of white and ink, but "better" is not "readable": for some mid-tone colours
  // NEITHER reaches 4.5:1 and no function can invent a third option. This is the check
  // with teeth, and it is why the screen may derive its foreground without also having to
  // decide what to do when both options fail — that cannot reach the screen.
  //
  // Generic on purpose: it runs over every partner in the array, so partner #2's colour is
  // covered with no further work.
  const acc = p.accent || colors.primary
  const fg  = readableOn(acc)
  const cr  = contrastRatio(fg, acc)
  check(cr != null,
    `${who}: accent ${JSON.stringify(p.accent)} is not a readable hex — contrast cannot be computed, so nothing can promise the deal band is legible`)
  if (cr != null) {
    check(cr >= 4.5,
      `${who}: accent ${acc} gives at best ${cr.toFixed(2)}:1 with ${fg} — under the 4.5:1 body-text minimum. `
      + `NEITHER white nor ink is readable on it; the deal band would ship unreadable text. `
      + `Ask the partner for a darker or lighter brand colour, or do not fill a surface with this one.`)
  }

  // Room codes reach the reception desk inside the WhatsApp message as ADA-<CODE>-<ROOM>.
  const roomCodes = new Set()
  for (const r of p.rooms || []) {
    check(/^[A-Z0-9]{2,6}$/.test(r.code), `${who}: room code ${JSON.stringify(r.code)} is not 2-6 uppercase alphanumerics`)
    check(!roomCodes.has(r.code), `${who}: duplicate room code ${r.code}`)
    roomCodes.add(r.code)
    // ⚠ ROOM PHOTOS WERE NOT COLLECTED UNTIL 2026-09-10, so a typo in one was invisible to
    //   the asset cross-check — it resolved to undefined and the row simply rendered
    //   without a picture, which is also the legitimate no-photo state. Indistinguishable.
    if (r.photo) referencedAssets.add(r.photo)
    // available is a BOOLEAN when known. If Özok's data turns out to be a COUNT the shape
    // changes, and this is the place that should say so — not the sheet, on device.
    check(r.available === null || r.available === undefined || typeof r.available === 'boolean',
      `${who}: room ${r.code} has available=${JSON.stringify(r.available)}; expected true, false or null`)
    if (r.nameKey) referencedKeys.add(r.nameKey)
  }

  // Collect every i18n key and asset key the config references.
  for (const k of ['aboutKey', 'operatorKey']) if (p[k]) referencedKeys.add(p[k])
  if (p.priceFrom?.periodKey) referencedKeys.add(p.priceFrom.periodKey)
  if (p.deal?.textKey) referencedKeys.add(p.deal.textKey)
  for (const g of ['transport', 'amenities', 'servicesIncluded', 'servicesExtra', 'ringTimes']) {
    for (const item of p[g] || []) {
      if (item.labelKey) referencedKeys.add(item.labelKey)
      // A value is either VERBATIM (language-neutral: "24/7", "Fiber") or a key. Never both,
      // or the screen has two answers for one cell.
      if (item.valueKey) referencedKeys.add(item.valueKey)
      check(!(item.value && item.valueKey),
        `${who}: ${g} item ${item.labelKey} has BOTH value and valueKey — the screen would have two answers for one cell`)
    }
  }

  // ─── SHUTTLES — the attribution is the load-bearing field ────────────────
  //
  // The free service is Alasia International University's, not the dorm's. Their homepage
  // markets it as "our" network; that sentence is dropped, and this is what keeps the
  // correction from quietly rotting: a shuttle with no providerName must not render.
  for (const sv of p.shuttles || []) {
    if (sv.nameKey) referencedKeys.add(sv.nameKey)
    check(!!sv.nameKey, `${who}: shuttle ${sv.id} has no nameKey`)
    check(!!sv.providerName,
      `${who}: shuttle ${sv.id} has no providerName. WHO RUNS IT IS THE POINT — the free service is `
      + `Alasia International University's, not the dorm's, and an unattributed shuttle re-tells `
      + `exactly the misattribution their homepage makes.`)
    check(Array.isArray(sv.routes) && sv.routes.length > 0,
      `${who}: shuttle ${sv.id} has no routes — a service with no timetable is a heading with nothing under it`)
    for (const rt of sv.routes || []) {
      check(!!rt.name, `${who}: a ${sv.id} route has no name`)
      check(Array.isArray(rt.times) && rt.times.length > 0, `${who}: route ${rt.name} has no departure times`)
      for (const tm of rt.times || []) {
        check(/^\d{2}:\d{2}$/.test(tm),
          `${who}: route ${rt.name} time ${JSON.stringify(tm)} is not HH:MM — times are verbatim from Alasia's page`)
      }
    }
    if (sv.weekend) {
      for (const f of ['out', 'back']) {
        check(/^\d{2}:\d{2}$/.test(sv.weekend[f] || ''),
          `${who}: ${sv.id} weekend.${f} ${JSON.stringify(sv.weekend[f])} is not HH:MM`)
      }
    }
  }
  check((p.shuttles || []).every(sv => sv.providerName !== undefined),
    `${who}: a shuttle is missing providerName entirely`)
  if (p.shuttleSource) {
    check(/^https:\/\//.test(p.shuttleSource) && !p.shuttleSource.includes('/tr/'),
      `${who}: shuttleSource must be the English page over https — one canonical source`)
  }
  for (const e of p.events || []) if (e.titleKey) referencedKeys.add(e.titleKey)
  for (const a of ['logo', 'logoOnDark']) if (p[a]) referencedAssets.add(p[a])
  // Gallery entries are { key, kind } objects, not bare strings — kind drives the render
  // ORDER (property/room shots before transport), so it is data and not array position.
  for (const g of p.gallery || []) {
    check(g && typeof g.key === 'string',
      `${who}: a gallery entry is ${JSON.stringify(g)} — expected { key, kind }. `
      + `Bare strings were the old shape; the order rule needs the kind.`)
    check(GALLERY_ORDER.includes(g?.kind),
      `${who}: gallery entry ${JSON.stringify(g?.key)} has kind ${JSON.stringify(g?.kind)}, `
      + `not one of ${GALLERY_ORDER.join(' / ')} — an unknown kind sorts to the front and puts `
      + `a photo of the bus where the building should be.`)
    if (typeof g?.key === 'string') referencedAssets.add(g.key)
  }

  // ─── The two derived strings must agree on `code` ─────────────────────────
  // They are the only two places the partner code reaches the outside world, and if they
  // disagree the WhatsApp enquiry and the click-through cannot be joined in the report.
  const waNoRoom = dormWaCode(p, null)
  check(waNoRoom === `ADA-${p.code}`, `${who}: dormWaCode(no room) = ${waNoRoom}, expected ADA-${p.code}`)
  const firstRoom = (p.rooms || [])[0]
  if (firstRoom) {
    check(dormWaCode(p, firstRoom.code) === `ADA-${p.code}-${firstRoom.code}`,
      `${who}: dormWaCode with a room is ${dormWaCode(p, firstRoom.code)}`)
  }
  if (p.website) {
    const url = new URL(dormWebsiteUrl(p, firstRoom?.code))
    check(url.searchParams.get('utm_source') === 'ada', `${who}: utm_source is ${url.searchParams.get('utm_source')}`)
    check(url.searchParams.get('utm_medium') === 'app', `${who}: utm_medium is ${url.searchParams.get('utm_medium')}`)
    check(url.searchParams.get('utm_campaign') === p.code.toLowerCase(),
      `${who}: utm_campaign is ${url.searchParams.get('utm_campaign')}, expected ${p.code.toLowerCase()} — it must derive from partner.code, not be inlined`)
    // No room => no utm_content. The brief says the room rides along only when the tap
    // came from a room.
    check(new URL(dormWebsiteUrl(p, null)).searchParams.get('utm_content') === null,
      `${who}: utm_content is set even with no room code`)
  }

  // The WhatsApp message is TR/EN only, by decision — it is read by the reception desk.
  const tr = dormWaMessage(p, 'tr'), en = dormWaMessage(p, 'en'), ru = dormWaMessage(p, 'ru')
  check(tr !== en, `${who}: the tr and en WhatsApp messages are identical — one language is not being selected`)
  check(ru === en, `${who}: a non-tr locale did not fall back to English`)
  check(tr.includes(waNoRoom) && en.includes(waNoRoom), `${who}: the WhatsApp message does not carry ${waNoRoom}`)

  // ─── The ROOM-level handoff (slice 3) ────────────────────────────────────
  if (firstRoom) {
    const roomCode = `ADA-${p.code}-${firstRoom.code}`
    // Stand-in names, so this tests the SELECTION rather than any real translation.
    const byLocale = { tr: 'ZZ_TR_ROOM', en: 'ZZ_EN_ROOM' }

    // ⚠ THE CLAIM THAT MATTERS: the room name is rendered in the MESSAGE's language, never
    //   the reader's. A Greek user's enquiry naming a Greek room type is unactionable at a
    //   Turkish reception desk, and it would look completely correct in review.
    const msgTr = dormWaMessage(p, 'tr', firstRoom.code, byLocale)
    const msgEl = dormWaMessage(p, 'el', firstRoom.code, byLocale)
    check(msgTr.includes('ZZ_TR_ROOM') && !msgTr.includes('ZZ_EN_ROOM'),
      `${who}: the Turkish room message did not use the Turkish room name`)
    check(msgEl.includes('ZZ_EN_ROOM') && !msgEl.includes('ZZ_TR_ROOM'),
      `${who}: a Greek user's room message did not fall back to the ENGLISH room name`)
    check(msgTr.includes(roomCode) && msgEl.includes(roomCode),
      `${who}: the room message does not carry ${roomCode}`)

    // Omitting the names must degrade to the property-level text, not to a broken string.
    const bare = dormWaMessage(p, 'en', firstRoom.code)
    check(bare.includes(roomCode), `${who}: a room message with no names lost its code`)
    check(!bare.includes('undefined') && !bare.includes('null'),
      `${who}: a room message with no names leaked a placeholder: ${bare}`)

    if (p.website) {
      const withRoom = new URL(dormWebsiteUrl(p, firstRoom.code))
      check(withRoom.searchParams.get('utm_content') === firstRoom.code.toLowerCase(),
        `${who}: utm_content is ${withRoom.searchParams.get('utm_content')}, expected ${firstRoom.code.toLowerCase()}`)
    }
  }

  // ─── Deal expiry, driven from BOTH sides of the clock ────────────────────
  // Only possible because dormDeal takes `now` as an argument. A screen-side && chain
  // could not be tested at all, let alone in the past and the future.
  const probe = { ...p, deal: { textKey: 'zzProbeDealKey', expiry: '2030-01-01' } }
  check(dormDeal(probe, new Date('2029-12-31')) !== null, `${who}: a deal expiring in 2030 did not render on 2029-12-31`)
  check(dormDeal(probe, new Date('2030-06-01')) === null, `${who}: an EXPIRED deal still rendered`)
  check(dormDeal({ ...p, deal: { textKey: 'x' } }) === null, `${who}: a deal with no expiry rendered — both halves are required`)
  check(dormDeal({ ...p, deal: null }) === null, `${who}: a null deal rendered`)

  // ─── PRICING — reproduced, never edited ─────────────────────────────────
  check(!!p.academicYear && /^\d{4}-\d{4}$/.test(p.academicYear),
    `${who}: academicYear ${JSON.stringify(p.academicYear)} is not YYYY-YYYY — prices with no year cannot be shown to be stale`)

  // ⚠ THE PRICES EXPIRE. This is the duty_list failure class: content with a shelf life
  //   behind checks that only ever verified SHAPE. An empty roster has a perfectly correct
  //   schema, and so does a year-old price table.
  if (/^\d{4}-\d{4}$/.test(p.academicYear || '')) {
    const endsJul = new Date(`${p.academicYear.split('-')[1]}-07-31T23:59:59`)
    check(new Date() <= endsJul,
      `${who}: the ${p.academicYear} prices ended ${endsJul.toISOString().slice(0, 10)} and are now STALE. `
      + `Re-fetch from ${p.priceSource?.url || 'alasiadorm.com/prices'} and update academicYear in the same commit.`)
  }

  for (const f of ['url', 'pdfUrl']) {
    check(/^https:\/\//.test(p.priceSource?.[f] || ''),
      `${who}: priceSource.${f} must be an https URL — the numbers must be one tap from their authority`)
  }
  // ⚠ ONE CANONICAL SOURCE. The Turkish page is a second source already known to diverge —
  //   it is where the €8,000 security deposit came from, against ₺8,000 on the English
  //   page. With two sources "verbatim" has two answers.
  check(!JSON.stringify(p.priceSource || {}).includes('/tr/'),
    `${who}: priceSource points at a /tr/ page. The ENGLISH prices page and its PDF are the only `
    + `canonical source for figures and formatting; alasiadorm.com/tr/fiyatlar/ disagrees with it on `
    + `the security deposit currency and must not be used.`)

  // ⚠⚠ THE SECURITY DEPOSIT AMOUNT IS OMITTED ON PURPOSE, NOT BY OVERSIGHT.
  //   Alasia's EN page says ₺8,000; their TR page says €8,000 — ~€180 versus €8,000, which
  //   is more than the whole annual fee on four of the six room types. ADA reproduces the
  //   FACT and omits the AMOUNT until Özok confirms which is right.
  //   This assertion exists because a bare null reads as something to fill in.
  const sec2 = p.deposits?.security || {}
  check(sec2.amount == null || (!!sec2.confirmedBy && !!sec2.confirmedOn),
    `${who}: deposits.security.amount is set to ${JSON.stringify(sec2.amount)} without confirmedBy/confirmedOn. `
    + `THAT FIELD IS EMPTY ON PURPOSE — Alasia publishes ₺8,000 on their EN page and €8,000 on their TR page, `
    + `a ~30x difference on money a student hands over. Do not fill it in from the likelier reading. `
    + `Record who at Özok confirmed it and when, in the same commit as the number.`)
  check(!!p.deposits?.holding?.amount, `${who}: the holding deposit amount is missing — it is published and unambiguous`)
  for (const d of ['holding', 'security']) {
    check(!!p.deposits?.[d]?.noteKey, `${who}: deposits.${d} has no noteKey — the numbers are misleading without their note`)
    if (p.deposits?.[d]?.noteKey) referencedKeys.add(p.deposits[d].noteKey)
  }

  // ─── The plan grid ──────────────────────────────────────────────────────
  const MONTHS = { isbank: [6, 8, 10, 12], ziraat: [7, 8, 10, 12] }
  // Verbatim strings in ALASIA'S OWN format: comma thousands, dot decimals. Storing these
  // as numbers would lose `€480.00`'s trailing zeros and let a formatter re-render them as
  // `€2.490` in Turkish, which is the conversion the directory rule forbids.
  const MONEY = /^€[\d]{1,3}(,[\d]{3})*(\.[\d]{2})?$/
  for (const r of p.rooms || []) {
    check(!!r.sourceName, `${who}: room ${r.code} has no sourceName — Alasia's own label must travel with their figures`)
    const plans = r.plans || {}
    const names = Object.keys(plans)
    check(names.length === 5,
      `${who}: room ${r.code} has ${names.length} plan(s) [${names.join(',')}], expected 5 (full, two, four, isbank, ziraat)`)
    for (const [name, pl] of Object.entries(plans)) {
      check(Array.isArray(pl.amounts) && pl.amounts.length > 0,
        `${who}: ${r.code}/${name} has no amounts — an empty plan renders a heading with nothing under it`)
      for (const a of pl.amounts || []) {
        check(MONEY.test(a),
          `${who}: ${r.code}/${name} amount ${JSON.stringify(a)} is not a verbatim € string in Alasia's format `
          + `(comma thousands, dot decimals). Figures are never parsed, formatted, localised or rounded.`)
      }
      // Every plan must carry a LABEL, because no figure may ever render bare.
      check(!!pl.labelKey || !!pl.bankName,
        `${who}: ${r.code}/${name} has neither labelKey nor bankName — its figures would render without a plan label`)
      if (pl.labelKey) referencedKeys.add(pl.labelKey)
      if (MONTHS[name]) {
        check(JSON.stringify(pl.months) === JSON.stringify(MONTHS[name]),
          `${who}: ${r.code}/${name} months ${JSON.stringify(pl.months)} != ${JSON.stringify(MONTHS[name])} — `
          + `İşbank runs 6/8/10/12 and Ziraat 7/8/10/12; a shared month set would mislabel every figure`)
        check((pl.months || []).length === (pl.amounts || []).length,
          `${who}: ${r.code}/${name} has ${(pl.months||[]).length} month(s) for ${(pl.amounts||[]).length} amount(s) — `
          + `they are paired by index, so a mismatch crosses a price with the wrong term`)
      }
    }
  }
}

// ─── 3. i18n keys, in BOTH directions ───────────────────────────────────────
//
// ⚠ THIS MUST NOT USE t() TO TEST PER-LOCALE COVERAGE, AND THE FIRST VERSION OF THIS GUARD
//   DID. t() falls back to translations.en[key] BEFORE it falls back to the key name, so a
//   key missing from Turkish resolves to the ENGLISH STRING and `t(key, l) === key` is
//   never true. The check could only ever have caught a key missing from English — which
//   is the one locale nobody forgets. scripts/validate-i18n-coverage.mjs states this trap
//   in its own header; this guard reinvented the worthless check anyway, and only a
//   red-first run caught it: deleting `dormRooms` from Turkish left the guard GREEN.
//
// So presence is read from the TABLE, per locale. That is also a stronger claim than
// "differs from English" and needs no allowlist — several of these keys are legitimately
// identical across locales ("Website" in de, "{n} min" in fr/es, "WhatsApp" everywhere).
//
// The walker is the one scripts/check-i18n-duplicates.mjs uses: brace-depth aware, and it
// skips comments and string literals, because a key name inside a translated sentence must
// not register as a key.
const I18N_SRC = readFileSync(resolve(ROOT, 'constants/i18n.js'), 'utf8')

function localeKeySets(src) {
  const blocks = [...src.matchAll(/^ {2}([a-z]{2}): \{$/gm)]
  const out = {}
  for (const b of blocks) {
    const keys = new Set()
    let i = src.indexOf('{', b.index)
    let depth = 0
    while (i < src.length) {
      const c = src[i]
      if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i === -1) break; continue }
      if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e === -1 ? src.length : e + 2; continue }
      if (c === "'" || c === '"' || c === '`') {
        const q = c; i++
        while (i < src.length) {
          if (src[i] === '\\') { i += 2; continue }
          if (src[i] === q) { i++; break }
          i++
        }
        continue
      }
      if (c === '{' || c === '[') { depth++; i++; continue }
      if (c === '}' || c === ']') { depth--; if (depth === 0) break; i++; continue }
      if (depth === 1) {
        const m = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*:/.exec(src.slice(i))
        if (m && !/[A-Za-z0-9_$]/.test(src[i - 1] || '')) { keys.add(m[1]); i += m[0].length; continue }
      }
      i++
    }
    out[b[1]] = keys
  }
  return out
}

const KEYSETS = localeKeySets(I18N_SRC)
const CODES = Object.keys(KEYSETS)

// CONTROLS for the parser itself. A walker whose anchor stopped matching returns empty
// sets, and empty sets make every "is this key present" test fail loudly — but a walker
// that returned EVERYTHING would make them all pass silently, which is the dangerous
// direction. So: the right number of locales, a key that must be there, one that must not.
check(CODES.length === LANGS.length,
  `CONTROL: the i18n walker found ${CODES.length} locale blocks, expected ${LANGS.length} — its anchor no longer matches the file`)
for (const c of CODES) {
  check(KEYSETS[c].has('accomTitle'), `CONTROL: the walker found no accomTitle in ${c} — it is not reading that locale's keys`)
  check(!KEYSETS[c].has('zzNotARealKeyForTheDormGuard'), `CONTROL: the walker reports a nonexistent key present in ${c}`)
}

const missingIn = key => CODES.filter(c => !KEYSETS[c].has(key))

const pending = new Set(PENDING_KEYS)
for (const key of referencedKeys) {
  if (pending.has(key)) continue
  const gone = missingIn(key)
  check(gone.length === 0, `i18n: ${key} is absent from ${gone.join(', ')} — t() would silently serve the ENGLISH string there`)
}
// The opposite direction. These are referenced BUT MUST NOT EXIST — see the header.
for (const key of pending) {
  const present = CODES.filter(c => KEYSETS[c].has(key))
  check(present.length === 0,
    `i18n: ${key} is in PENDING_KEYS but is now written in ${present.join(', ')}. `
    + `If the copy is real, delete it from PENDING_KEYS in constants/dorms.js — this red is the review moment, not a bug.`)
}

// Every key the SCREEN looks up directly, which the config cannot know about.
const SCREEN_KEYS = [
  'accomDorms', 'dormPartnerBadge', 'dormWebsite', 'dormAbout', 'dormRooms', 'dormTransport',
  'dormAmenities', 'dormServices', 'dormIncluded', 'dormExtra', 'dormLocation', 'dormRing',
  'dormEvents', 'dormContact', 'dormMinutes', 'accomCall', 'accomWhatsApp', 'getDirections',
  // Slice 3 — the room sheet.
  'dormRoomPrice', 'dormRoomSize', 'dormRoomAvailability', 'dormRoomAvailable',
  'dormRoomFull', 'dormRoomEnquire', 'cancel',
  // 7B-2 / 7B-3 — services, shuttles, contact, source foot.
  'dormShuttleProvidedBy', 'dormShuttleWeekend', 'dormShuttleOut', 'dormShuttleBack',
  'dormSourceTitle', 'dormSourceBody', 'dormSourcePrices', 'dormSourcePdf',
  'dormSourceShuttles', 'dormEmail', 'dormAddress',
]
for (const key of SCREEN_KEYS) {
  const gone = missingIn(key)
  check(gone.length === 0, `i18n: ${key} (used by DormPartnerScreen) is absent from ${gone.join(', ')}`)
}

// {n} is substituted by the caller with .replace() — t() does no interpolation, so a locale
// that dropped the placeholder renders a bare unit with no number. Safe to read through
// t() here: presence in every locale was just asserted, so there is no English fallback
// left for it to hide behind.
for (const l of LANGS) {
  check(t('dormMinutes', l).includes('{n}'),
    `i18n: dormMinutes in ${LANG_CODES[l]} has lost its {n} placeholder: ${JSON.stringify(t('dormMinutes', l))}`)
}

// ─── 3a2. Section order and collapse are DATA ───────────────────────────────
//
// The order lives in config rather than in JSX position so it can change without a
// component edit. These assert the vocabulary agrees with what the screen can render — an
// id in SECTION_ORDER that the screen has no branch for renders NOTHING, silently, and a
// section missing from the order disappears the same way.
{
  const RENDERABLE = ['rooms', 'services', 'shuttles', 'location', 'ring', 'events', 'contact', 'source']
  for (const id of SECTION_ORDER) {
    check(RENDERABLE.includes(id),
      `SECTION_ORDER contains ${JSON.stringify(id)}, which DormPartnerScreen has no branch for — `
      + `it would render nothing, silently.`)
  }
  for (const id of RENDERABLE) {
    check(SECTION_ORDER.includes(id),
      `${id} is renderable but missing from SECTION_ORDER — it would never appear.`)
  }
  for (const id of COLLAPSIBLE) {
    check(SECTION_ORDER.includes(id), `COLLAPSIBLE names ${JSON.stringify(id)}, which is not a section`)
  }
  // Rooms before services and shuttles: price is the question after the photos, and a page
  // that opens with 28 rows of detail buries the six room cards.
  check(SECTION_ORDER.indexOf('rooms') < SECTION_ORDER.indexOf('services') &&
        SECTION_ORDER.indexOf('rooms') < SECTION_ORDER.indexOf('shuttles'),
    `SECTION_ORDER puts rooms after services or shuttles (${SECTION_ORDER.join(' → ')}). `
    + `Price is the question after the photos.`)
  check(COLLAPSIBLE.includes('services') && COLLAPSIBLE.includes('shuttles'),
    `services and shuttles must both be collapsible — 22 rows and six route cards open by `
    + `default is what buried the room cards.`)
}

// ─── 3a3. THE SCREEN MUST ACTUALLY READ SECTION_ORDER ───────────────────────
//
// ⚠ THIS IS THE "CONFIG PRESENT BUT UNUSED" CLASS, and it is the same shape as the deleted
//   components: correct-looking code that no instrument was pointed at. A SECTION_ORDER
//   array that nothing maps over passes EVERY other check here — the vocabulary assertions
//   above are satisfied, the file parses, every reference resolves, and the sections still
//   render, just in whatever order the JSX happens to sit in.
//
//   A config nothing reads is WORSE than no config, because it looks settled. Somebody
//   edits the array, the guard goes green, and the screen does not move.
//
// So: locate the SECTION_ORDER.map( callback by brace matching, and require every section
// branch to live INSIDE it. A branch outside is a section rendered by JSX position.
{
  const raw = readFileSync(resolve(ROOT, 'screens/DormPartnerScreen.js'), 'utf8')
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')

  const at = src.indexOf('SECTION_ORDER.map(')
  check(at !== -1,
    `screens/DormPartnerScreen.js never maps over SECTION_ORDER. The array exists and nothing `
    + `reads it, so the order on screen is whatever the JSX happens to be — and every other `
    + `check here still passes. That is the failure this assertion exists for.`)

  if (at !== -1) {
    // Brace-match the callback so the span is derived, not guessed at by line count.
    let i = src.indexOf('{', at), depth = 0, end = -1
    while (i < src.length) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break } }
      i++
    }
    check(end > at && end - at > 200,
      `the SECTION_ORDER.map( callback spans ${at}..${end} — too small to hold the sections. `
      + `Refusing to conclude anything from it.`)

    if (end > at) {
      const branches = [...src.matchAll(/id === '([a-z]+)'/g)]
      check(branches.length > 0, `no \`id === '…'\` section branches found at all — this check is measuring nothing`)
      const outside = branches.filter(m => m.index < at || m.index > end).map(m => m[1])
      check(outside.length === 0,
        `section branch(es) [${[...new Set(outside)].join(', ')}] sit OUTSIDE the SECTION_ORDER.map( callback. `
        + `A section rendered outside the map is ordered by its JSX position, not by config.`)
      const ids = [...new Set(branches.map(m => m[1]))]
      check(ids.length === SECTION_ORDER.length,
        `the screen has ${ids.length} section branch(es) [${ids.join(', ')}] but SECTION_ORDER has `
        + `${SECTION_ORDER.length} [${SECTION_ORDER.join(', ')}]. An id with no branch renders nothing; `
        + `a branch with no id never runs.`)
      for (const id of ids) {
        check(SECTION_ORDER.includes(id), `the screen branches on '${id}', which is not in SECTION_ORDER — it never runs`)
      }
    }
  }
}

// ─── 3b. Accent-filled surfaces derive their foreground ─────────────────────
//
// The numeric assertion — "the best foreground for this accent clears 4.5:1" — is made in
// §2 and is SHARED by both accent-filled surfaces, because after the badge was filled they
// are the same computation against the same background. Repeating it per surface would be
// two tokens counting one thing, which is how a check goes stale on its own.
//
// What is NOT shared, and is what this asserts, is that the SCREEN still routes both
// surfaces through readableOn(). The badge's original defect was not a bad contrast
// function — it was accent drawn AS TEXT on white, where no fill exists to read against and
// readableOn() has nothing to say. That regression is a source shape, not a number.
//
// ⚠ ANCHORED ON CODE SHAPE, AND COMMENTS ARE STRIPPED FIRST. This file's own prose contains
//   the phrase `color: accent` while describing what is forbidden, and the screen's comments
//   do too. A naive scan would forbid the WORDS and the only way to green would be deleting
//   the notes that tell the next reader why. Same trap the 0902 pg_get_functiondef token
//   documents.
{
  const raw = readFileSync(resolve(ROOT, 'screens/DormPartnerScreen.js'), 'utf8')
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')

  const fills   = (src.match(/backgroundColor:\s*accent\b/g)   || []).length
  // ⚠ COUNT THE ASSIGNMENTS, NOT THE IDENTIFIER. A bare /onAccent/ count includes the
  //   `const onAccent = readableOn(accent)` declaration, so a surface that went back to
  //   hardcoding its colour still cleared a `>= fills * 2` floor — measured: that exact
  //   regression stayed GREEN. Matching `color: onAccent` / `color={onAccent}` counts only
  //   the places it is actually USED, and the assertion below is an equality, not a floor.
  const derived = (src.match(/color(?::\s*|=\{)onAccent\b/g)    || []).length
  const asText  = (src.match(/color:\s*accent\b/g)             || []).length
                + (src.match(/color=\{accent\}/g)               || []).length

  // A COUNT, printed, not a remembered name list. A third accent-filled surface takes this
  // to 3 and the bump is the review moment — which is the point.
  check(fills === 2,
    `DormPartnerScreen has ${fills} accent-filled surface(s), expected 2 (the partner badge and the deal band). `
    + `If a third was added deliberately, bump this count in the same commit and say why.`)

  // Each filled surface carries an icon AND a label, so two derived colours each.
  check(derived === fills * 2,
    `DormPartnerScreen assigns onAccent to ${derived} colour(s) for ${fills} accent-filled surface(s) — `
    + `expected exactly ${fills * 2} (an icon and a label on each). `
    + `Fewer means one is hardcoding its foreground again; more means a surface was added without bumping the count above.`)

  check(asText === 0,
    `DormPartnerScreen draws the accent AS TEXT in ${asText} place(s). readableOn() cannot help there — `
    + `there is no fill to read against — and accent-on-white is 1.43:1 for a brand yellow. `
    + `Fill the surface and derive the foreground, as the badge and the deal band both do.`)
}

// ─── 3c. NO FIGURE RENDERS BARE ─────────────────────────────────────────────
//
// €2,490 is simultaneously the Quad Bungalow's full-payment TOTAL and the Triple Room's
// balance after deposit. Both are correct, so a mix-up cannot be caught by sanity-checking
// the figure — only by never letting it appear without its room and plan label.
//
// Asserted as a SHAPE, with comments stripped: wherever a surface prints `amounts`, the
// same surface must print a plan label. Comments here and in those files discuss `amounts`
// in prose, and forbidding the WORD would mean deleting the notes to go green.
{
  const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n')

  for (const [file, labelToken] of [
    ['screens/DormPartnerScreen.js', "t('dormPlanFull', lang)"],   // the room row's headline
    ['components/DormRoomSheet.js',  't(plan.labelKey, lang)'],    // every cash plan header
  ]) {
    const src = strip(readFileSync(resolve(ROOT, file), 'utf8'))
    if (/\.amounts\b/.test(src)) {
      check(src.includes(labelToken),
        `${file} renders plan amounts but never renders ${labelToken}. A figure without its plan label `
        + `is exactly the €2,490 ambiguity: the same number is a total in one room and a balance in another.`)
    }
  }
  // The bank plans label themselves with the bank's own name rather than an i18n key.
  const sheet = strip(readFileSync(resolve(ROOT, 'components/DormRoomSheet.js'), 'utf8'))
  check(sheet.includes('plan.bankName'),
    `components/DormRoomSheet.js never renders plan.bankName — İşbank and Ziraat figures would be unlabelled`)

  // ⚠ NO CURRENCY LITERAL IN COMPONENT CODE, AND NO CARVE-OUTS.
  //
  // The hero used to quote Alasia's "Starting From € 2490" under a deliberate exception.
  // It shipped an English sentence into all nine locales, because a QUOTATION CANNOT BE
  // LOCALISED — translating it stops it being a quotation. The exception is gone and this
  // is what replaces it: every figure reaches the screen from config, none is typed in.
  //
  // A hardcoded '€500' also silently outlives the source: nobody edits a component when a
  // partner changes their deposit.
  for (const file of ['screens/DormPartnerScreen.js', 'components/DormRoomSheet.js']) {
    const src = strip(readFileSync(resolve(ROOT, file), 'utf8'))
    const lit = src.match(/[€₺£$]\s?[\d]/g) || []
    check(lit.length === 0,
      `${file} hardcodes ${lit.length} currency literal(s) (${[...new Set(lit)].join(', ')}). `
      + `Every figure comes from constants/dorms.js — a number typed into a component is a number `
      + `nobody updates when the source changes, and the from-price carve-out that used to live here `
      + `shipped an English sentence into nine locales.`)
  }

  // ⚠ AND NOTHING SUMS THEM. Alasia publishes the instalments and not their total; a
  //   directory that adds them up has started editing. Catches the obvious shapes.
  for (const file of ['screens/DormPartnerScreen.js', 'components/DormRoomSheet.js']) {
    const src = strip(readFileSync(resolve(ROOT, file), 'utf8'))
    check(!/(reduce\s*\(|parseFloat|parseInt|Number\s*\()/.test(src),
      `${file} parses or accumulates a number. Alasia's figures are verbatim strings and are never `
      + `parsed, summed, formatted or rounded — publishing a total they do not publish is editing.`)
  }
}

// ─── 4. Assets, also in two directions ──────────────────────────────────────
//
// partnerAssets.js cannot be imported here: it is the one file that require()s PNGs, which
// is exactly why constants/dorms.js is kept require-free. So this reads it as TEXT and
// distinguishes a WIRED entry from a DECLARED-OWED (commented) one — an asset key must be
// one or the other, never simply absent.
const assetSrc = readFileSync(resolve(ROOT, 'constants/partnerAssets.js'), 'utf8')
for (const key of referencedAssets) {
  const wired   = new RegExp(`^\\s*'${key.replace(/[/\-]/g, m => '\\' + m)}'\\s*:`, 'm').test(assetSrc)
  const owed    = new RegExp(`^\\s*//\\s*'${key.replace(/[/\-]/g, m => '\\' + m)}'\\s*:`, 'm').test(assetSrc)
  check(wired || owed,
    `asset: ${key} is referenced by constants/dorms.js but appears in constants/partnerAssets.js neither wired nor commented as owed. `
    + `An unknown key silently resolves to undefined and the slot renders nothing, which looks identical to a deliberate absence.`)
}

// ─── Report ─────────────────────────────────────────────────────────────────
if (problems.length) {
  console.error(`\n  ┌─ DORM CONFIG GUARD FAILED ─────────────────────────────────────┐`)
  for (const p of problems) console.error(`  │ ${p}`)
  console.error(`  └────────────────────────────────────────────────────────────────┘\n`)
  process.exit(1)
}

console.log(
  `dorm config: OK (${DORM_PARTNERS.length} partner(s) · ${assertions} assertions · `
  + `${referencedKeys.size + SCREEN_KEYS.length} key(s) x ${LANGS.length} locales · `
  + `${referencedAssets.size} asset key(s) · ${pending.size} pending key(s) held unwritten)`)
console.log(`  segments dark: [${darkIds.join(', ')}]  landing ${accomLanding(false)}`)
console.log(`  segments live: [${liveIds.join(', ')}]  landing ${accomLanding(true)}`)
console.log(`  NOTE: this reads FILES. It says nothing about contact_events_action_check,`)
console.log(`        which is supabase/verify_schema.sql's 20261014_website_action tokens.`)

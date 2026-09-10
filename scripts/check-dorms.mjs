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
  DORM_PARTNERS, PENDING_KEYS,
  dormDeal, dormPriceFrom, dormWaCode, dormWaMessage, dormWebsiteUrl,
} from '../constants/dorms.js'
import { t, LANG_CODES } from '../constants/i18n.js'

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

  // Phone/WhatsApp reach a real business. A malformed number fails at the moment somebody
  // taps call, which is the worst place to find out.
  for (const f of ['phone', 'whatsapp']) {
    if (p[f]) check(/^\+\d[\d ]{6,}$/.test(p[f]), `${who}: ${f} is not a +country-code number: ${JSON.stringify(p[f])}`)
  }

  check(!p.coords || (typeof p.coords.latitude === 'number' && typeof p.coords.longitude === 'number'),
    `${who}: coords must be {latitude, longitude} numbers or null`)

  // Room codes reach the reception desk inside the WhatsApp message as ADA-<CODE>-<ROOM>.
  const roomCodes = new Set()
  for (const r of p.rooms || []) {
    check(/^[A-Z0-9]{2,6}$/.test(r.code), `${who}: room code ${JSON.stringify(r.code)} is not 2-6 uppercase alphanumerics`)
    check(!roomCodes.has(r.code), `${who}: duplicate room code ${r.code}`)
    roomCodes.add(r.code)
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
    for (const item of p[g] || []) if (item.labelKey) referencedKeys.add(item.labelKey)
  }
  for (const e of p.events || []) if (e.titleKey) referencedKeys.add(e.titleKey)
  for (const a of ['logo', 'logoOnDark']) if (p[a]) referencedAssets.add(p[a])
  for (const g of p.gallery || []) referencedAssets.add(g)

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

  // priceFrom is held until Özok says what a dönem is; periodKey null means DO NOT RENDER.
  check(dormPriceFrom({ ...p, priceFrom: { amount: 1, currency: 'EUR', periodKey: null } }) === null,
    `${who}: priceFrom rendered with a null periodKey — the dönem question is still open`)
  check(dormPriceFrom({ ...p, priceFrom: { amount: 1, currency: 'EUR', periodKey: 'k' } }) !== null,
    `${who}: priceFrom refused to render even with a periodKey`)
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

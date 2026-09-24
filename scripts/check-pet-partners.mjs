#!/usr/bin/env node
// ─── Pet hotel partner config guard ─────────────────────────────────────────
//
//   npm run pethotel:check
//
// WHY THIS EXISTS. Pet hotel partners are config-only — there is no `pet_partners` table,
// so there is no CHECK constraint, no RLS policy and no `verify_schema.sql` section
// standing behind any of it. `constants/petPartners.js` IS the schema. Everything a
// database would refuse has to be refused here or nowhere. Same argument, same shape, as
// scripts/check-dorms.mjs.
//
// ⚠ WHAT A HEALTHY RUN PRINTS: the number of partners, keys, pending fields, placeholder
//   photos and assertions it ACTUALLY made. A guard that silently matched nothing reports
//   "no problems", which is indistinguishable from a clean config unless the counts are on
//   screen. This repo has shipped that exact bug — a seed validator that reported "all 4
//   rows valid" having parsed zero.
//
// ─── THE PART THAT IS EASY TO GET WRONG: THREE DIRECTIONS, NOT ONE ──────────
//
//   1. Most referenced keys must have an ENGLISH value. Per-LOCALE coverage is NOT this
//      file's job and cannot be — see the note above the check itself.
//   2. PENDING_KEYS must NOT resolve, in any locale. `petHotelShinyPawAbout` is referenced
//      and deliberately unwritten — Shiny Paw has supplied no about copy, and inventing
//      nine locales of marketing prose about a real business is fabrication with their
//      name on it. A guard that only asked "does everything resolve" would be red on day
//      one, and the tempting fix is to skip the key, which certifies nothing.
//   3. PENDING_FIELDS must still be NULL. This is the "never invent a price, address,
//      coordinate, phone number or capacity" rule with teeth: the day somebody types a
//      capacity in without removing it from PENDING_FIELDS, this goes red.
//
// The day any of those three changes, the guard goes RED and graduating the placeholder
// becomes a deliberate act somebody reviews — which is the whole point.
import { resolveRegion } from '../utils/resolveRegion.js'
import { readFileSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PET_PARTNERS, PET_PARTNER_IDS, PENDING_FIELDS, DECLINED_FIELDS, PENDING_KEYS, SECTION_ORDER,
  petPartner, petPartnerBySlug, petPartnerSections,
  petWaLocale, petWaCode, petWaMessage, petWaUrl, petPartnerWebsiteUrl,
} from '../constants/petPartners.js'
import { t, LANG_CODES } from '../constants/i18n.js'
import { REGION_LABEL_KEY } from '../constants/regions.js'
import { colors, readableOn, contrastRatio } from '../constants/theme.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const problems = []
const LANGS = Object.keys(LANG_CODES)
let assertions = 0
const check = (cond, msg) => { assertions++; if (!cond) problems.push(msg) }

// ─── 0. CONTROLS. If these fail, nothing below means anything ───────────────
//
// Asked BEFORE the run rather than after a surprising result: what would this print if the
// config were PERFECT? If the answer is the same as when it is broken, it is not a probe.
// t() returning the key on a miss is the mechanism the entire key check rests on — both
// directions of it — so prove it works before trusting it.
if (!LANGS.length) problems.push('CONTROL: LANG_CODES is empty — every locale loop below is a no-op')
if (LANGS.length !== 9) problems.push(`CONTROL: expected 9 locales, LANG_CODES has ${LANGS.length} — the "all nine" claim below would be checking a different set`)
if (t('zzNotARealKeyForThePetGuard', 'Turkish') !== 'zzNotARealKeyForThePetGuard') {
  problems.push('CONTROL: t() no longer returns the key name on a miss — the PENDING_KEYS direction cannot work')
}
if (!PET_PARTNERS.length) problems.push('CONTROL: PET_PARTNERS is empty — this guard would pass by checking nothing')
if (!Object.keys(PENDING_FIELDS).length) problems.push('CONTROL: PENDING_FIELDS is empty — the null assertions below would be a no-op')

// ─── 1. Import safety — a Node guard must be able to load the config ────────
//
// It just did, or this file would not be running. What CANNOT be proved by having loaded
// is that nobody adds a require() or a react-native import tomorrow, so the source is read
// as text. constants/partnerAssets.js is the ONLY place a key becomes a require().
//
// ⚠ COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT A DETAIL. The first draft of this check
//   went RED against a perfectly correct config, because petPartners.js's own header says
//   "No react-native import and NO require(): plain data only" — the check was forbidding
//   the WORD in the prose that tells the next reader not to add the thing. Exactly the
//   `pg_get_functiondef` / `NOT ILIKE '%appointments%'` trap CLAUDE.md records, and the
//   tempting fix was the same one: delete the comment. That would have destroyed the most
//   valuable line in the file to satisfy a broken instrument. Anchor to CODE, not to text.
{
  const raw = readFileSync(resolve(ROOT, 'constants/petPartners.js'), 'utf8')
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
  // Positive control: the stripper must not have eaten the file. A regex that returns ''
  // makes every assertion below pass on everything.
  check(code.includes('export const PET_PARTNERS'),
    'CONTROL: the comment-stripper removed the actual code — every import-safety assertion below would pass vacuously')
  check(!/\brequire\s*\(/.test(code),
    'constants/petPartners.js contains require() IN CODE — that is what breaks Node import and it is why partnerAssets.js exists')
  check(!/from\s+['"]react-native['"]/.test(code),
    'constants/petPartners.js imports react-native — the config must stay plain data')
}

// ─── 2. Section order ───────────────────────────────────────────────────────
//
// A count and a set, not a remembered list of names: a check phrased as a name list goes
// quiet about whatever it forgot to name.
{
  const keys = Object.keys(petPartnerSections(PET_PARTNERS[0]))
  const missing = SECTION_ORDER.filter(s => s !== 'hero' && !keys.includes(s))
  check(missing.length === 0,
    `SECTION_ORDER names sections petPartnerSections() never returns: [${missing.join(', ')}] — the screen would skip them silently`)
  check(new Set(SECTION_ORDER).size === SECTION_ORDER.length,
    `SECTION_ORDER has duplicates: [${SECTION_ORDER.join(', ')}]`)
}

// ─── 3. Per-partner structure ───────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const seenIds = new Set()
const seenCodes = new Set()
const seenSlugs = new Set()
const referencedKeys = new Set()
const referencedAssets = new Set()
let placeholderPhotos = 0
const thumbKeys = []
const disputedPhotos = []
const PROVENANCE = new Set(['photograph', 'partner-edited', 'disputed'])

for (const p of PET_PARTNERS) {
  const who = p.slug || p.name || '<unnamed>'

  // The UUID is contact_events.entity_id and nothing else verifies it — no seed migration,
  // so no verify_schema token can. Changing it after taps land silently orphans the counts.
  check(UUID_RE.test(String(p.id)), `${who}: id is not a lowercase uuid: ${p.id}`)
  check(!seenIds.has(p.id), `${who}: duplicate id ${p.id}`)
  seenIds.add(p.id)

  check(!!p.slug && /^[a-z0-9-]{2,40}$/.test(p.slug), `${who}: slug must be lowercase kebab, got ${JSON.stringify(p.slug)}`)
  check(!seenSlugs.has(p.slug), `${who}: duplicate slug ${p.slug}`)
  seenSlugs.add(p.slug)

  check(!!p.code && /^[A-Z]{2,5}$/.test(p.code), `${who}: code must be 2-5 uppercase letters, got ${JSON.stringify(p.code)}`)
  check(!seenCodes.has(p.code), `${who}: duplicate code ${p.code} — utm_campaign and the WhatsApp Kod would collide`)
  seenCodes.add(p.code)

  check(!!p.name, `${who}: no name`)

  // ─── The lookups the screen will use must actually resolve ──────────────
  check(petPartner(p.id) === p, `${who}: petPartner(${p.id}) did not return this entry`)
  check(petPartnerBySlug(p.slug) === p, `${who}: petPartnerBySlug(${p.slug}) did not return this entry`)

  // ─── displayType: dog boarding, never generic "pets" ────────────────────
  //
  // The single most drift-prone claim on the page. It sits inside a module called "pets",
  // surrounded by paw icons, and widening it costs nothing to type and misleads somebody
  // with a cat at the moment they most need a straight answer.
  check(p.displayType === 'dog_boarding',
    `${who}: displayType is ${JSON.stringify(p.displayType)}. Shiny Paw advertises DOG boarding only. `
    + `If a partner genuinely takes other animals, add a new displayType and its own label key — `
    + `do not widen this one to 'pets'.`)

  check(!p.website || /^https:\/\//.test(p.website), `${who}: website must be https, got ${p.website}`)
  // ─── DECLINED ≠ PENDING ─────────────────────────────────────────────────
  // A declined field (email, prices) is a decision, not a gap: the KEY must be absent from
  // the entry (null would mean "asked, not yet known") and it must not also sit in
  // PENDING_FIELDS. Iterated from DECLINED_FIELDS, never a remembered name list.
  for (const f of Object.keys(DECLINED_FIELDS)) {
    check(!(f in p), `${who}: has a \`${f}\` key (${JSON.stringify(p[f])}), but ${f} is DECLINED: ${DECLINED_FIELDS[f]}`)
    check(!(f in PENDING_FIELDS), `${who}: ${f} is in both DECLINED_FIELDS and PENDING_FIELDS — it is one or the other`)
    check(typeof DECLINED_FIELDS[f] === 'string' && DECLINED_FIELDS[f].trim().length > 0,
      `${who}: DECLINED_FIELDS.${f} has no reason written against it`)
  }
  // Coherence: a partner that takes cats cannot be labelled dog boarding.
  check(!(p.acceptsCats === true && p.displayType === 'dog_boarding'),
    `${who}: acceptsCats is true but displayType is dog_boarding — the hero pill would tell a cat owner no`)
  check(!p.mapsUrl || /^https:\/\//.test(p.mapsUrl), `${who}: mapsUrl must be https, got ${p.mapsUrl}`)

  // Phone/WhatsApp reach a real business. A malformed number fails at the moment somebody
  // taps call, which is the worst place to find out.
  for (const f of ['phone', 'whatsapp']) {
    if (p[f]) check(/^\+\d[\d ]{6,}$/.test(p[f]), `${who}: ${f} is not a +country-code number: ${JSON.stringify(p[f])}`)
  }

  // ─── The district slug must be CANONICAL, and this is why ───────────────
  //
  // The brief said "lefkosa". That is the Turkish name, not the repo's slug. Writing it
  // would not throw: REGION_LABEL_KEY returns undefined, t() is handed undefined, and the
  // hero renders NO DISTRICT AT ALL. A silent blank is exactly the failure a guard is for.
  check(!!REGION_LABEL_KEY[p.district],
    `${who}: district ${JSON.stringify(p.district)} is not a canonical region slug. `
    + `Valid: ${Object.keys(REGION_LABEL_KEY).join(', ')}. Lefkoşa is 'nicosia'.`)
  if (REGION_LABEL_KEY[p.district]) referencedKeys.add(REGION_LABEL_KEY[p.district])

  check(!p.coords || (typeof p.coords.latitude === 'number' && typeof p.coords.longitude === 'number'),
    `${who}: coords must be {latitude, longitude} numbers or null`)
  // A pin and a district that disagree render as two different places on two surfaces
  // (the map pin, and the hero's district line), silently. Derived, not remembered:
  // resolveRegion() is the same function the app uses for coordinates.
  if (p.coords) {
    const r = resolveRegion(p.coords.latitude, p.coords.longitude)
    check(r === p.district,
      `${who}: coords resolve to region ${JSON.stringify(r)} but district is ${JSON.stringify(p.district)}`)
  }

  // ─── The accent must be able to carry readable text ─────────────────────
  //
  // accent is null today and the screen falls back to colors.primary. readableOn() picks
  // the better of white and ink, but "better" is not "readable": for some mid-tone colours
  // NEITHER reaches 4.5:1 and no function can invent a third option. Checking the FALLBACK
  // too is the point — an unvetted brand hex arriving later is the obvious risk, but a
  // theme change to colors.primary would break this page just as quietly.
  const acc = p.accent || colors.primary
  const fg  = readableOn(acc)
  const cr  = contrastRatio(fg, acc)
  check(cr != null,
    `${who}: accent ${JSON.stringify(p.accent)} (effective ${acc}) is not a readable hex — contrast cannot be computed, so nothing can promise the badge is legible`)
  if (cr != null) {
    check(cr >= 4.5,
      `${who}: accent ${acc} gives at best ${cr.toFixed(2)}:1 with ${fg} — under the 4.5:1 body-text minimum. `
      + `NEITHER white nor ink is readable on it. Ask the partner for a darker or lighter brand colour.`)
  }

  // ─── Services ───────────────────────────────────────────────────────────
  const svcIds = new Set()
  check(Array.isArray(p.services) && p.services.length > 0,
    `${who}: no services — the services section is the only substantive content this partner has today`)
  for (const sv of p.services || []) {
    check(!!sv.id && !svcIds.has(sv.id), `${who}: service id ${JSON.stringify(sv.id)} is missing or duplicated`)
    svcIds.add(sv.id)
    check(!!sv.titleKey, `${who}: service ${sv.id} has no titleKey`)
    check(!!sv.bodyKey, `${who}: service ${sv.id} has no bodyKey`)
    check(!!sv.icon, `${who}: service ${sv.id} has no icon`)
    if (sv.titleKey) referencedKeys.add(sv.titleKey)
    if (sv.bodyKey) referencedKeys.add(sv.bodyKey)
    // A service carries PROSE THE PARTNER WROTE. It must never also carry a structured
    // claim — a body mentioning a camera must not become `cameraAccess: true`. Prose is
    // prose; a field is a promise ADA makes.
    check(sv.value === undefined && sv.cameraAccess === undefined,
      `${who}: service ${sv.id} has grown a structured field. A service description is the partner's prose, `
      + `not a claim ADA can stand behind. Add a top-level field (and a PENDING_FIELDS entry) instead.`)
  }

  // ─── Photos ─────────────────────────────────────────────────────────────
  const photoKeys = new Set()
  for (const ph of p.photos || []) {
    check(typeof ph?.key === 'string',
      `${who}: a photo entry is ${JSON.stringify(ph)} — expected { key, placeholder, aspect, provenance }`)
    check(!photoKeys.has(ph?.key), `${who}: duplicate photo key ${ph?.key}`)
    photoKeys.add(ph?.key)
    if (typeof ph?.key === 'string') referencedAssets.add(ph.key)
    if (ph?.placeholder) placeholderPhotos++

    // An undeclared aspect is not an error — petPartnerSections() falls back to square —
    // but a declared-and-broken one is, because it reads as considered when it is not.
    check(ph?.aspect === undefined || (Number.isFinite(ph.aspect) && ph.aspect > 0),
      `${who}: photo ${ph?.key} declares aspect ${JSON.stringify(ph?.aspect)} — must be a positive finite number or absent`)

    // ─── PROVENANCE IS REQUIRED, AND 'disputed' IS A REAL STATE ───────────
    //
    // The brief said the rest of their site's imagery is AI-generated and must not be
    // used. That rule is only enforceable if every wired file carries a judgement, so an
    // unjudged photo fails rather than passing as fine by default — the same
    // allow-list-not-block-list reasoning exploreCategories.js applies to claimability.
    check(PROVENANCE.has(ph?.provenance),
      `${who}: photo ${ph?.key} has provenance ${JSON.stringify(ph?.provenance)}. `
      + `Must be one of: ${[...PROVENANCE].join(' / ')}. An unjudged image ships as though somebody checked it.`)
    if (ph?.provenance === 'disputed') {
      disputedPhotos.push(`${ph.key} — ${ph.note || 'no note'}`)
      check(!!ph.note,
        `${who}: photo ${ph.key} is marked disputed with no note. "Disputed" with no evidence cannot be resolved by anyone but the person who wrote it.`)
    }
  }

  // ⚠ THE PLACEHOLDER FLAG MUST BE PER-ENTRY, NOT A COMMENT. A count printed on every run
  //   is what stops "temporary" from becoming permanent quietly — the same reason the
  //   novest staleness check prints its figure rather than asserting a remembered one.
  check((p.photos || []).every(ph => typeof ph?.placeholder === 'boolean'),
    `${who}: a photo entry has no explicit \`placeholder\` boolean. Every photo must declare whether it is `
    + `the partner's own work or a stand-in — an undeclared one reads as owned and ships as owned.`)

  // photoPermission is owed while ANY photo is wired. Asserted as a pair so the day the
  // permission lands, removing it from PENDING_FIELDS is what this notices.
  if ((p.photos || []).length > 0 && p.photoPermission === null) {
    check('photoPermission' in PENDING_FIELDS,
      `${who}: photos are wired, photoPermission is null, and it is NOT in PENDING_FIELDS — `
      + `the owed item has gone off the books while the photos are still shipping.`)
  }

  if (p.aboutKey) referencedKeys.add(p.aboutKey)
  for (const a of ['logo', 'logoOnDark', 'thumb']) if (p[a]) referencedAssets.add(p[a])
  if (p.thumb) thumbKeys.push(p.thumb)

  // ─── 4. PENDING_FIELDS must still be null ───────────────────────────────
  //
  // The third direction. A value typed in without removing the entry here is a fabricated
  // fact shipping under a partner's name, and it is the single most likely way this
  // surface goes wrong.
  for (const f of Object.keys(PENDING_FIELDS)) {
    check(f in p, `${who}: PENDING_FIELDS names '${f}' but the entry has no such key — an absent key and a null one read the same to ?., but only null records that the question was asked`)
    check(p[f] === null,
      `${who}: ${f} is ${JSON.stringify(p[f])} but is still listed in PENDING_FIELDS. `
      + `If the partner supplied it, DELETE the PENDING_FIELDS entry in the same commit. `
      + `If nobody supplied it, this is an invented value — remove it. Reason on record: ${PENDING_FIELDS[f]}`)
    // ⚠ NON-EMPTY, NOT A LENGTH THRESHOLD. The first draft demanded > 20 characters and
    //   went red on `openingHours: 'Not published.'` — which is the complete and honest
    //   reason. A prose-length gate measures word count, not thought: it fails a true
    //   fourteen-character answer and passes a lazy twenty-one-character one, so it cannot
    //   fail correctly on the thing it exists to catch. The fix was to delete the
    //   threshold, not to pad the reason until the linter went quiet.
    check(typeof PENDING_FIELDS[f] === 'string' && PENDING_FIELDS[f].trim().length > 0,
      `${who}: PENDING_FIELDS.${f} has no reason written against it — "owed" with no why rots into "nobody knows"`)
  }

  // ─── 5. The section contract: pending means ABSENT, not empty ───────────
  const sec = petPartnerSections(p, { resolveAsset: k => (k ? `ASSET:${k}` : undefined) })

  check(sec.about === p.aboutKey, `${who}: sections.about is ${JSON.stringify(sec.about)}, expected the aboutKey`)
  check(Array.isArray(sec.services) && sec.services.length === p.services.length,
    `${who}: sections.services did not carry every service through`)
  check(sec.photos !== null && sec.photos.length === (p.photos || []).length,
    `${who}: sections.photos lost entries — the stub resolver returns a truthy value for every key, so this can only be a filter bug`)
  // The aspect must TRAVEL WITH the image. A screen that receives a bare source has to
  // guess one, and a guessed aspect centre-crops the dimension the photo exists to show.
  for (const ph of sec.photos || []) {
    check(Number.isFinite(ph.aspect) && ph.aspect > 0,
      `${who}: a resolved photo carries aspect ${JSON.stringify(ph.aspect)} — a container with aspectRatio 0 or NaN collapses and the photo silently disappears`)
  }
  // A photo declaring a broken aspect must fall back to square rather than propagate it.
  const badAspect = petPartnerSections({ ...p, photos: [{ key: p.photos[0].key, aspect: 0, provenance: 'photograph' }] },
    { resolveAsset: k => (k ? `ASSET:${k}` : undefined) })
  check(badAspect.photos?.[0]?.aspect === 1,
    `${who}: a zero aspect was not replaced by the square fallback — got ${JSON.stringify(badAspect.photos?.[0]?.aspect)}`)

  // THE CLAIM THAT MATTERS: a section with no answered field must be null — not [], not an
  // object of nulls. A screen that receives [] renders a heading with nothing under it.
  // And with answered fields, EVERY one must reach a row: `!== null` alone cannot see a
  // value that silently dropped out of the list.
  const anyPractical = ['openingHours', 'dropOffPickUpHours', 'capacity', 'acceptedSizes',
                        'breedRestrictions', 'vaccinationRequirements', 'cameraAccess']
                        .some(f => p[f] !== null && p[f] !== undefined && p[f] !== '')
  check(anyPractical ? sec.practical !== null : sec.practical === null,
    `${who}: sections.practical is ${JSON.stringify(sec.practical)} while the underlying fields are `
    + `${anyPractical ? 'partly answered' : 'all pending'} — a pending section must be null so the screen omits it entirely`)

  const answeredPractical = ['openingHours', 'dropOffPickUpHours', 'capacity', 'acceptedSizes',
    'breedRestrictions', 'vaccinationRequirements'].filter(f => p[f] !== null && p[f] !== undefined && p[f] !== '').length
    + (p.cameraAccess === true ? 1 : 0)
  check((sec.practical || []).length === answeredPractical,
    `${who}: ${answeredPractical} practical field(s) are answered but ${(sec.practical || []).length} row(s) rendered: `
    + `[${(sec.practical || []).map(r => r.id).join(', ')}]`)
  // Every rendered value is an i18n KEY. Registered here so the English-resolve check below
  // catches a typo'd value key, which would otherwise render as raw key text.
  for (const r of sec.practical || []) { referencedKeys.add(r.labelKey); referencedKeys.add(r.value) }

  // Prices are DECLINED, so the key is absent and pricing must never render.
  check(sec.pricing === null, `${who}: sections.pricing is ${JSON.stringify(sec.pricing)} — prices are declined and must never render`)

  // Location renders on EITHER half. With address pending and mapsUrl known, it must
  // render — a directions button is a real affordance even with no street line.
  check((p.address || p.mapsUrl) ? sec.location !== null : sec.location === null,
    `${who}: sections.location is ${JSON.stringify(sec.location)} — it must render when EITHER address or mapsUrl exists`)
  if (sec.location) {
    check(sec.location.address === (p.address || null),
      `${who}: sections.location.address leaked a non-null for a pending address`)
  }

  // ─── The empty-string trap, driven rather than assumed ──────────────────
  // '' is falsy but is NOT null, and a naive `field !== null` test would let it through to
  // render an empty row. Probed with a real call rather than trusted.
  const blank = petPartnerSections({ ...p, capacity: '', prices: '' })
  check(blank.pricing === null, `${who}: an EMPTY-STRING price rendered the pricing section`)
  check((blank.practical || []).every(r => r.id !== 'capacity'),
    `${who}: an EMPTY-STRING capacity rendered a practical row`)

  // And the positive control for the same function: a supplied value MUST appear. Without
  // this, a petPartnerSections() that returned null for everything would pass every
  // assertion above.
  const filled = petPartnerSections({ ...p, capacity: 'ZZ_PROBE_CAPACITY', prices: 'ZZ_PROBE_PRICE' })
  check(filled.pricing === 'ZZ_PROBE_PRICE',
    `${who}: CONTROL FAILED — a supplied price did not reach sections.pricing. Every "pending is hidden" `
    + `assertion above is meaningless if the function hides everything.`)
  check((filled.practical || []).some(r => r.id === 'capacity' && r.value === 'ZZ_PROBE_CAPACITY'),
    `${who}: CONTROL FAILED — a supplied capacity did not reach sections.practical`)
  for (const r of filled.practical || []) referencedKeys.add(r.labelKey)

  // ─── 6. Contact actions: four, and email is NOT one of them ─────────────
  //
  // A COUNT and a set, not a remembered name list. Email is omitted by decision
  // (2026-09-24): contact is WhatsApp, call, website and Maps only. The config carries no
  // `email` key (asserted above), and this catches the other half: a builder that grows
  // an email action.
  check(!sec.contact.includes('email'),
    `${who}: 'email' is in the contact actions. Email is omitted by decision (2026-09-24): `
    + `contact is WhatsApp, call, website and Maps only.`)
  check(sec.contact.length === 4,
    `${who}: expected 4 contact actions (whatsapp, call, website, maps), got ${sec.contact.length}: [${sec.contact.join(', ')}]`)

  // ─── 7. The derived strings must agree on `code` ────────────────────────
  const waCode = petWaCode(p)
  check(waCode === `ADA-${p.code}`, `${who}: petWaCode() = ${waCode}, expected ADA-${p.code}`)

  if (p.website) {
    const url = new URL(petPartnerWebsiteUrl(p))
    check(url.searchParams.get('utm_source') === 'ada', `${who}: utm_source is ${url.searchParams.get('utm_source')}`)
    check(url.searchParams.get('utm_medium') === 'app', `${who}: utm_medium is ${url.searchParams.get('utm_medium')}`)
    check(url.searchParams.get('utm_campaign') === p.code.toLowerCase(),
      `${who}: utm_campaign is ${url.searchParams.get('utm_campaign')}, expected ${p.code.toLowerCase()} — it must DERIVE from partner.code, not be inlined`)
  }

  // ─── 8. The WhatsApp handoff — TR/EN only, by decision ──────────────────
  const tr = petWaMessage(p, 'tr'), en = petWaMessage(p, 'en'), ru = petWaMessage(p, 'ru')
  check(tr !== en, `${who}: the tr and en WhatsApp messages are identical — one language is not being selected`)
  check(ru === en, `${who}: a non-tr locale did not fall back to English`)
  check(tr.includes(waCode) && en.includes(waCode), `${who}: the WhatsApp message does not carry ${waCode}`)
  // ⚠ THE MESSAGE MUST SAY THE CUSTOMER CAME FROM ADA. That is the whole point of the
  //   handoff and it is one careless edit from being lost.
  check(/ADA/.test(tr) && /ADA/.test(en), `${who}: the WhatsApp message no longer states the customer came from ADA`)
  check(petWaLocale('tr') === 'tr' && petWaLocale('el') === 'en',
    `${who}: petWaLocale is not selecting tr-vs-en correctly`)

  // wa.me refuses a '+'. A URL built with one opens WhatsApp on a blank chat, which reads
  // as the partner's number being wrong rather than as our formatting being wrong.
  const waUrl = petWaUrl(p, 'tr')
  check(!!waUrl && waUrl.startsWith('https://wa.me/'), `${who}: petWaUrl did not build a wa.me URL: ${waUrl}`)
  check(!/wa\.me\/\+/.test(waUrl || ''), `${who}: the wa.me URL carries a '+' — WhatsApp opens a blank chat: ${waUrl}`)
  check((waUrl || '').includes(encodeURIComponent(waCode)), `${who}: the wa.me URL lost the ${waCode} code`)
  check(petWaUrl({ ...p, whatsapp: null }, 'tr') === null, `${who}: petWaUrl returned a URL for a partner with no WhatsApp number`)
}

// ─── 9. i18n — the two directions ───────────────────────────────────────────
//
// PENDING_KEYS are removed from the must-resolve set and asserted the OTHER way.
const pending = new Set(PENDING_KEYS)
const mustResolve = [...referencedKeys].filter(k => !pending.has(k))

// ⚠ THIS PROVES ENGLISH EXISTS. IT CANNOT PROVE THE OTHER EIGHT LOCALES DO, and saying
//   otherwise would be the "permanently green" check this repo keeps rediscovering.
//   t() is `translations[code]?.[key] ?? translations.en[key] ?? key`, so once the English
//   value exists a MISSING Russian returns the English STRING — which is !== the key, so a
//   per-locale loop here passes on precisely the failure it looks like it is testing. It
//   went red earlier in this slice only because English was missing too.
//
//   One owner per question. scripts/validate-i18n-coverage.mjs owns "is every locale
//   actually translated" — it compares each locale's VALUE against English, which is the
//   only form of the check with teeth, and this config's keys were fed into it (see
//   PET_PARTNER_KEYS there) precisely because they reach the screen through a variable and
//   its literal scan could not see them.
for (const k of mustResolve) {
  check(t(k, 'English') !== k, `i18n: ${k} has no ENGLISH value (t() returned the key name)`)
}

// The opposite direction. Writing this copy turns the guard RED, which is the design.
for (const k of PENDING_KEYS) {
  check(referencedKeys.has(k),
    `PENDING_KEYS lists ${k} but nothing in the config references it — a pending key nobody uses is dead weight, and it hides the fact that the section is gone`)
  for (const lang of LANGS) {
    check(t(k, lang) === k,
      `i18n: ${k} RESOLVES in ${lang} — it is in PENDING_KEYS, which asserts the copy is deliberately unwritten. `
      + `If Shiny Paw supplied about copy, write all nine locales and DELETE it from PENDING_KEYS in the same commit.`)
  }
}

// ─── 10. Assets: wired, or declared owed ────────────────────────────────────
//
// The same two-direction shape as the keys. A key with no entry in partnerAssets.js yields
// undefined, which every consumer treats as "no image" — a monogram, or a section that does
// not render. That is a legitimate state, so the check is that the key is DECLARED there
// (even commented), not that it resolves.
{
  const assetSrc = readFileSync(resolve(ROOT, 'constants/partnerAssets.js'), 'utf8')
  for (const key of referencedAssets) {
    check(assetSrc.includes(`'${key}'`),
      `asset key '${key}' is referenced by constants/petPartners.js but appears nowhere in constants/partnerAssets.js — `
      + `not even commented. It resolves to undefined and the image silently does not render, which is `
      + `indistinguishable from the legitimate no-image state.`)
  }
}

// ─── Asset footprint, MEASURED on every run ─────────────────────────────────
//
// constants/partnerAssets.js used to state "2.2 MB on disk, 5.94 MB decoded" in prose.
// That went stale the moment a photo was dropped — which happened four hours later. A
// comment citing a measured number has to be REGENERATED, not remembered, so the figures
// are computed here and printed, and the comment points at this output instead.
//
// Decode is the figure that matters: the Alasia note capped a pager at five images because
// seven were decoding to 103 MB of ARGB8888 on a mid-range Android. Disk size says nothing
// about that — a 120 KB JPEG and a 700 KB PNG at the same dimensions decode identically.
function pixelSize(file) {
  const b = readFileSync(file)
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504E47) {         // PNG: IHDR is fixed
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
  }
  if (b.length > 4 && b[0] === 0xFF && b[1] === 0xD8) {            // JPEG: walk to a SOFn
    let i = 2
    while (i < b.length - 9) {
      if (b[i] !== 0xFF) { i++; continue }
      const m = b[i + 1]
      // SOF0-SOF15, excluding the non-frame markers DHT (c4), JPG (c8) and DAC (cc)
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }
      }
      i += 2 + b.readUInt16BE(i + 2)
    }
  }
  return null
}

let diskBytes = 0, decodeBytes = 0, unsized = 0
const thumbSizes = []
// The card thumb is a 64pt box, so 3x density needs 192 px. A thumb key pointed at a gallery
// frame decodes 900x900 (3.2 MB) and renders identically, so only a size check can catch it.
const THUMB_MAX_PX = 256
for (const key of referencedAssets) {
  const m = readFileSync(resolve(ROOT, 'constants/partnerAssets.js'), 'utf8')
    .match(new RegExp(`'${key.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&')}':\\s*require\\('([^']+)'\\)`))
  if (!m) continue
  const file = resolve(ROOT, 'constants', m[1])
  try {
    diskBytes += statSync(file).size
    const px = pixelSize(file)
    if (px) decodeBytes += px.w * px.h * 4; else unsized++
    if (thumbKeys.includes(key)) {
      thumbSizes.push(`${key} ${px ? `${px.w}x${px.h}` : '?'}`)
      if (!px || px.w > THUMB_MAX_PX || px.h > THUMB_MAX_PX)
        problems.push(`thumb ${key} is ${px ? `${px.w}x${px.h}` : 'unmeasurable'}, over ${THUMB_MAX_PX} px: a 64pt card box needs 192`)
    }
  } catch { unsized++ }
}
const MB = n => (n / 1048576).toFixed(2) + ' MB'

// ─── REPORT ─────────────────────────────────────────────────────────────────
//
// The counts are the point. "No problems" from a guard that matched nothing looks exactly
// like "no problems" from a clean config.
const c = { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m` }

console.log('')
console.log(`  pet hotel partner config`)
console.log(c.d(`  ─────────────────────────────────────────────────────────────`))
console.log(`  partners            ${PET_PARTNERS.length}  ${c.d(`(ids: ${PET_PARTNER_IDS.length})`)}`)
console.log(`  services            ${PET_PARTNERS.reduce((n, p) => n + (p.services || []).length, 0)}`)
const allPhotos = PET_PARTNERS.flatMap(p => p.photos || [])
const byProvenance = Object.entries(allPhotos.reduce((m, ph) => ({ ...m, [ph.provenance]: (m[ph.provenance] || 0) + 1 }), {}))
  .map(([k, n]) => `${n} ${k}`).join(', ')
console.log(`  photos              ${allPhotos.length}  ${c.d(`(${allPhotos.length - placeholderPhotos} partner's own · ${placeholderPhotos} placeholder`
  + `${placeholderPhotos ? ` — ${placeholderPhotos} still owed` : ''} · ${byProvenance || 'none'})`)}`)
console.log(`  photo provenance    ${disputedPhotos.length ? c.r(`${disputedPhotos.length} DISPUTED`) : c.g('all judged, none disputed')}`)
for (const d of disputedPhotos) console.log(c.d(`                      ! ${d}`))
console.log(`  pending fields      ${Object.keys(PENDING_FIELDS).length}  ${c.d(`(${Object.keys(PENDING_FIELDS).join(', ')})`)}`)
console.log(`  i18n keys           ${mustResolve.length} with an English value  ${c.d(`+ ${PENDING_KEYS.length} asserted UNWRITTEN in all ${LANGS.length}`)}`)
console.log(c.d(`                      per-locale coverage belongs to npm run i18n:validate, not here`))
console.log(`  asset keys          ${referencedAssets.size}`)
console.log(`  asset footprint     ${MB(diskBytes)} on disk · ${MB(decodeBytes)} decoded (ARGB8888)`
  + (unsized ? c.r(`  [${unsized} unmeasured]`) : ''))
console.log(`  card thumb          ${thumbSizes.length ? thumbSizes.join(', ') : c.d('none: the card decodes the first gallery photo')}`)
console.log(`  assertions made     ${assertions}`)
console.log(c.d(`  ─────────────────────────────────────────────────────────────`))

if (problems.length) {
  console.error(c.r(`\n  ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`))
  for (const p of problems) console.error(`   • ${p}`)
  console.error('')
  process.exit(1)
}
console.log(c.g(`  OK\n`))

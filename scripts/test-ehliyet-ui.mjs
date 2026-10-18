// Pure logic behind the Ehliyet screen (constants/ehliyet.js): the fixture-vs-query rule,
// "no logging for fixture rows", the tel:/wa.me/mailto:/maps links, button visibility rules, the logged
// actions vs the DB CHECK (20261109), and every button label fitting its button at 320dp (Inter 600).
//   node scripts/test-ehliyet-ui.mjs
import {
  PREVIEW_DRIVING_SCHOOLS, usesFixture, shouldLogContact, telUrl, primaryPhone, hasWhatsApp, whatsAppUrl, hasInstagram, hasFacebook,
  hasEmail, mailtoUrl, emailDisplay, licenceClasses, branchAddress, mapsSearchUrl, mapsUrlForBranch, sortedBranches,
  EHLIYET_BRIGHT, EHLIYET_DARK, EHLIYET_WA, EHLIYET_LOGS_CONTACTS,
  SOCIAL_LABEL_PX, SOCIAL_LABEL_WIDTHS, SOCIAL_LAYOUT, socialTextRoom, socialSideBySide,
  EHLIYET_CITY_NAME, branchChipLabels, ADDRESS_SEP, addressParts,
} from '../constants/ehliyet.js'
import { REGIONS, REGION_LABEL_KEY } from '../constants/regions.js'
import { readFileSync } from 'node:fs'
import { t as tr, LANGUAGES } from '../constants/i18n.js'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { diffFixture, parseSeed, SEED_SQL } from './check-ehliyet-fixture.mjs'

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}

// usesFixture(MODULE_FLAGS.ehliyet, EHLIYET): the screen reads the fixture and does NOT query only when the flag is off but dev / Preview has it on.
t('flag off, dev/Preview on -> fixture, no query', usesFixture(false, true), true)
t('flag off, production (EHLIYET false) -> queries', usesFixture(false, false), false)
t('flag live -> queries (EHLIYET is then true too)', usesFixture(true, true), false)
t('flag live, EHLIYET false (impossible) -> queries', usesFixture(true, false), false)
t('undefined inputs -> queries', usesFixture(undefined, undefined), false)

t('fixture rows are never logged', shouldLogContact(true), false)
t('database rows are logged', shouldLogContact(false), true)
t('logging switch is on (flip EHLIYET_LOGS_CONTACTS to drop the contact_events migration)', EHLIYET_LOGS_CONTACTS, true)

const seed = PREVIEW_DRIVING_SCHOOLS[0]
t('one fixture school, seed id', [PREVIEW_DRIVING_SCHOOLS.length, seed.id], [1, '7b1e0c2a-5d4f-4e8b-9a61-3c2f8e0d4b17'])
t('fixture: logo key, 1 phone, featured', [seed.logo_key, seed.phones.length, seed.featured], ['seyhun/logo', 1, true])
t('fixture branches are valid regions, ordered', sortedBranches(seed).map(b => b.region), ['nicosia', 'morphou'])
t('fixture branch regions exist in REGIONS', sortedBranches(seed).every(b => REGIONS.includes(b.region)), true)
t('branch order follows sort_order, not array order',
  sortedBranches({ driving_school_branches: [{ region: 'morphou', sort_order: 1 }, { region: 'nicosia', sort_order: 0 }] }).map(b => b.region), ['nicosia', 'morphou'])

t('WhatsApp hidden when null', hasWhatsApp({ whatsapp: null }), false)
t('WhatsApp hidden when empty / blank', [hasWhatsApp({ whatsapp: '' }), hasWhatsApp({ whatsapp: '  ' }), hasWhatsApp({})], [false, false, false])
t('WhatsApp shown for the seed', hasWhatsApp(seed), true)
t('seed wa.me link is exact', whatsAppUrl(seed), 'https://wa.me/905338873999')
t('wa.me link is digits only', whatsAppUrl({ whatsapp: '+90 533 854 39 99' }), 'https://wa.me/905338543999')

t('tel: strips spaces, keeps +', telUrl('+90 533 854 39 99'), 'tel:+905338543999')
t('Ara dials the single number directly', telUrl(primaryPhone(seed)), 'tel:+905338873999')
t('more than one phone: dials phones[0]', primaryPhone({ phones: ['+90 533 111 11 11', '+90 533 222 22 22'] }), '+90 533 111 11 11')
t('no phones: no number (button hidden)', [primaryPhone({ phones: [] }), primaryPhone({})], [null, null])

t('Instagram needs an https link', [hasInstagram(seed), hasInstagram({ instagram_url: null }), hasInstagram({ instagram_url: 'javascript:alert(1)' }), hasInstagram({ instagram_url: 'http://x.com/a' })], [true, false, false, false])
t('Facebook shown for the seed', hasFacebook(seed), true)
t('Facebook hidden unless https', [hasFacebook({ facebook_url: null }), hasFacebook({}), hasFacebook({ facebook_url: 'http://www.facebook.com/x' }), hasFacebook({ facebook_url: 'javascript:alert(1)' }), hasFacebook({ facebook_url: 'https://' })], [false, false, false, false, false])
t('email shown for the seed, mailto exact', [hasEmail(seed), mailtoUrl(seed)], [true, 'mailto:seyhunbikmazsoforokulu@gmail.com'])
t('email hidden when null / blank / malformed', [null, '', '  ', 'not-an-address', 'a@b', 'a b@c.com', '@c.com'].map(email => hasEmail({ email })), [false, false, false, false, false, false, false])

t('licence classes keep the stored order', licenceClasses(seed), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'H1', 'H2', 'J', 'K'])
t('licence classes: none -> empty (row hidden)', [licenceClasses({}), licenceClasses({ licence_classes: null })], [[], []])
const addrs = sortedBranches(seed).map(branchAddress)
t('only Lefkoşa has an address (Güzelyurt town-only)', addrs, ['Şehit Fevait Ali Sokak 4/B, Göçmenköy, Lefkoşa', ''])
t('branch address blank -> no row', [branchAddress({ address: '  ' }), branchAddress({}), branchAddress(null)], ['', '', ''])
t('maps search URL is a text search (no coordinates), like the hotels Harita button',
  mapsSearchUrl(addrs[0]), 'https://www.google.com/maps/search/?api=1&query=%C5%9Eehit%20Fevait%20Ali%20Sokak%204%2FB%2C%20G%C3%B6%C3%A7menk%C3%B6y%2C%20Lefko%C5%9Fa%2C%20North%20Cyprus')
const [lefkosa, guzelyurt] = sortedBranches(seed)
t('pinned branch opens Google Maps at the coordinate (6 dp as stored; the 4 dp guard covers only the google-places function)',
  mapsUrlForBranch(lefkosa), 'https://www.google.com/maps/search/?api=1&query=35.207265,33.337685')
t('branch without coordinates keeps the text search', mapsUrlForBranch(guzelyurt), mapsSearchUrl(branchAddress(guzelyurt)))
t('half a pin (lat only) falls back to the text search', mapsUrlForBranch({ ...lefkosa, lng: null }), mapsSearchUrl(branchAddress(lefkosa)))
t('fixture: Lefkoşa pin is partner-sourced, Güzelyurt has none', [lefkosa.geocode_source, guzelyurt.lat, guzelyurt.lng, guzelyurt.geocode_source], ['partner', null, null, null])
t('screen calls mapsUrlForBranch and never imports OsmAttribution', [/mapsUrlForBranch\(b\)/.test(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'screens/EhliyetScreen.js'), 'utf8')), /OsmAttribution/.test(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'screens/EhliyetScreen.js'), 'utf8'))], [true, false])
// Red-first, permanent: a wrong coordinate or an 'osm' source must flip these.
t('red-first: a wrong coordinate changes the URL', mapsUrlForBranch({ ...lefkosa, lat: 35.207266 }) === mapsUrlForBranch(lefkosa), false)
t('red-first: source osm is not partner', ({ ...lefkosa, geocode_source: 'osm' }).geocode_source === 'partner', false)
t('red-first: OsmAttribution import would be seen', /OsmAttribution/.test("import OsmAttribution from '../components/OsmAttribution'"), true)

t('brand colours exact', [EHLIYET_BRIGHT, EHLIYET_DARK, EHLIYET_WA], ['#294EA6', '#213565', '#075E54'])

// ── Logged actions vs the DB CHECK. The screen logs these; parse 20261109's literals so they cannot drift. ──
const here = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ceSql = readFileSync(resolve(here, 'supabase/migrations/20261109_contact_events_ehliyet.sql'), 'utf8')
const actionCheck = ceSql.match(/ADD CONSTRAINT contact_events_action_check\s*CHECK \(action IN \(([^)]*)\)\)/)
const dbActions = actionCheck ? [...actionCheck[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : []
const screenSrc = readFileSync(resolve(here, 'screens/EhliyetScreen.js'), 'utf8')
const loggedActions = [...new Set([...screenSrc.matchAll(/onAction\(school, '([a-z_]+)'/g)].map(m => m[1]))].sort()
console.log(`  · screen logs ${JSON.stringify(loggedActions)}; DB accepts ${JSON.stringify(dbActions)}`)
t('screen logs exactly call, email, facebook, instagram, maps, whatsapp', loggedActions, ['call', 'email', 'facebook', 'instagram', 'maps', 'whatsapp'])
t('every logged action is accepted by the 20261109 CHECK', loggedActions.filter(a => !dbActions.includes(a)), [])
t('the CHECK literals were really parsed', dbActions.length >= 10, true)

// ── Button labels fit at 320dp, font scale 1.0 (Inter 600SemiBold, rowTitle 15px). ──
// Real advances from the bundled TTF (cmap format 4 + hmtx). No kerning: errs wide. Arabic / Persian sum
// ISOLATED forms (wider than the joined text), so those figures are upper bounds.
const loadFont = (file) => {
  const buf = readFileSync(resolve(here, 'node_modules/@expo-google-fonts/inter', file))
  const tables = {}
  for (let i = 0; i < buf.readUInt16BE(4); i++) { const o = 12 + i * 16; tables[buf.toString('ascii', o, o + 4)] = buf.readUInt32BE(o + 8) }
  const upm = buf.readUInt16BE(tables.head + 18), nH = buf.readUInt16BE(tables.hhea + 34)
  const base = tables.cmap
  let cm = null
  for (let i = 0; i < buf.readUInt16BE(base + 2); i++) {
    const rec = base + 4 + i * 8, off = base + buf.readUInt32BE(rec + 4)
    if (buf.readUInt16BE(off) === 4 && cm == null) cm = off
  }
  const segX2 = buf.readUInt16BE(cm + 6), endO = cm + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2
  const gid = (cp) => {
    for (let i = 0; i < segX2 / 2; i++) {
      if (buf.readUInt16BE(endO + i * 2) < cp) continue
      const st = buf.readUInt16BE(startO + i * 2); if (st > cp) return 0
      const d = buf.readInt16BE(deltaO + i * 2), ro = buf.readUInt16BE(rangeO + i * 2)
      if (ro === 0) return (cp + d) & 0xFFFF
      const g = buf.readUInt16BE(rangeO + i * 2 + ro + (cp - st) * 2)
      return g === 0 ? 0 : (g + d) & 0xFFFF
    }
    return 0
  }
  return (str, px) => [...str].reduce((w, ch) => w + buf.readUInt16BE(tables.hmtx + Math.min(gid(ch.codePointAt(0)), nH - 1) * 4) / upm * px, 0)
}
const font = loadFont('600SemiBold/Inter_600SemiBold.ttf')
// Layout constants mirror EhliyetScreen styles (content padding 16, card padding 18, action paddingHorizontal 12,
// icon 18, gap 8, outlined border 1.5 x2). Stacked full-width buttons, so the box is the card's inner width.
const SCREEN_W = 320, PAGE = 16, CARD_PAD = 18, BTN_PAD = 12, ICON = 18, ICON_GAP = 8, BORDER = 1.5, LABEL_PX = 15
const textBox = (outlined) => SCREEN_W - PAGE * 2 - CARD_PAD * 2 - BTN_PAD * 2 - ICON - ICON_GAP - (outlined ? BORDER * 2 : 0)
const BUTTON_KEYS = [['ehliyetCall', false], ['ehliyetWhatsApp', false], ['ehliyetInstagram', true], ['ehliyetFacebook', true]]
const fitProblems = (labelOf) => BUTTON_KEYS.flatMap(([key, outlined]) => LANGUAGES.map(({ key: lang }) => {
  const label = labelOf(key, lang), w = font(label, LABEL_PX), box = textBox(outlined)
  return w > box ? `${key}/${lang} "${label}" ${w.toFixed(1)} > ${box}` : null
}).filter(Boolean))
for (const [key, outlined] of BUTTON_KEYS) {
  console.log(`  · ${key.padEnd(16)} box ${textBox(outlined)}pt  ` + LANGUAGES.map(({ key: l }) => `${l.slice(0, 2)} ${font(tr(key, l), LABEL_PX).toFixed(1)}`).join('  '))
}
t('every button label fits its 320dp button at scale 1.0, all 9 languages', fitProblems(tr), [])
t('red-first: an overlong label is caught', fitProblems((k, l) => (k === 'ehliyetCall' && l === 'Turkish' ? 'Okul müdürlüğünü hemen arayın' : tr(k, l))).length, 1)

// ── Instagram + Facebook side by side (14px, half-width) or stacked (15px, full width). ──
// Brand words: must be identical in all 9 languages, else the pure width function is wrong.
for (const key of ['ehliyetInstagram', 'ehliyetFacebook']) {
  const vals = LANGUAGES.map(({ key: l }) => tr(key, l))
  console.log(`  · ${key}: ${JSON.stringify(vals)}`)
  t(`${key} is the same word in all 9 languages`, new Set(vals).size, 1)
}
const brand = { Instagram: tr('ehliyetInstagram', 'English'), Facebook: tr('ehliyetFacebook', 'English') }
t('brand words are literally Instagram / Facebook', brand, { Instagram: 'Instagram', Facebook: 'Facebook' })
const measured = Object.fromEntries(Object.entries(brand).map(([k, w]) => [k, font(w, SOCIAL_LABEL_PX)]))
console.log(`  · measured @${SOCIAL_LABEL_PX}px ${JSON.stringify(measured)}; stored ${JSON.stringify(SOCIAL_LABEL_WIDTHS)}`)
t('stored label widths cover the measured TTF widths (never narrower)', Object.keys(measured).filter(k => SOCIAL_LABEL_WIDTHS[k] < measured[k]), [])
t('stored label widths drift <= 0.1pt above the TTF', Object.keys(measured).filter(k => SOCIAL_LABEL_WIDTHS[k] - measured[k] > 0.1), [])
t('layout constants mirror the screen styles', [SOCIAL_LAYOUT.page, SOCIAL_LAYOUT.cardPad, SOCIAL_LAYOUT.gap, SOCIAL_LAYOUT.border, SOCIAL_LAYOUT.icon, SOCIAL_LAYOUT.iconGap],
  [16, 18, 10, 1.5, 18, 8])
t('screen reads gap / padding from SOCIAL_LAYOUT and size from SOCIAL_LABEL_PX', [/gap: SOCIAL_LAYOUT\.gap/.test(screenSrc), /paddingHorizontal: SOCIAL_LAYOUT\.padX/.test(screenSrc), /fontSize: SOCIAL_LABEL_PX/.test(screenSrc), /minHeight: 44/.test(screenSrc)], [true, true, true, true])

const widest = Math.max(...Object.values(measured))
const room320 = socialTextRoom(320)
console.log(`  · 320dp: (320 - 2x${SOCIAL_LAYOUT.page} - 2x${SOCIAL_LAYOUT.cardPad} - gap ${SOCIAL_LAYOUT.gap}) / 2 = ${(320 - 32 - 36 - 10) / 2}; - 2x${SOCIAL_LAYOUT.border} border - 2x${SOCIAL_LAYOUT.padX} pad - ${SOCIAL_LAYOUT.icon} icon - ${SOCIAL_LAYOUT.iconGap} gap = ${room320}pt text room; widest label ${widest.toFixed(2)}pt (stored ${Math.max(...Object.values(SOCIAL_LABEL_WIDTHS))}); spare ${(room320 - widest).toFixed(2)}pt`)
t('side by side at 320dp has >= 3pt to spare at scale 1.0 (measured width)', room320 - widest >= 3, true)
t('side by side at (320, 1.0)', socialSideBySide(320, 1.0), true)
t('side by side at (360, 1.0)', socialSideBySide(360, 1.0), true)
for (const [w, sc] of [[320, 1.3], [360, 1.3]]) {
  console.log(`  · (${w}, ${sc}): room ${socialTextRoom(w)}pt vs ${(Math.max(...Object.values(SOCIAL_LABEL_WIDTHS)) * sc).toFixed(1)}pt -> ${socialSideBySide(w, sc) ? 'SIDE BY SIDE' : 'STACKED'}`)
}
t('outcome at (320, 1.3) is stacked (arithmetic)', socialSideBySide(320, 1.3), false)
t('outcome at (360, 1.3) is side by side (arithmetic)', socialSideBySide(360, 1.3), true)
t('stacked at the extreme (320, 2.0)', socialSideBySide(320, 2.0), false)
t('red-first: an inflated label width flips the (320, 1.0) decision', socialSideBySide(320, 1.0, { Instagram: 90, Facebook: 66.5 }), false)
t('red-first: the plant is the only difference (real widths still side by side)', socialSideBySide(320, 1.0, SOCIAL_LABEL_WIDTHS), true)

// Label-fit tables. Full width (stacked): 15px, Ara / WhatsApp solid, Instagram / Facebook outlined. Compact (side by side at 320dp): 14px.
const compactBox = socialTextRoom(320)
const compactProblems = (labelOf) => ['ehliyetInstagram', 'ehliyetFacebook'].flatMap(key => LANGUAGES.map(({ key: lang }) => {
  const label = labelOf(key, lang), w = font(label, SOCIAL_LABEL_PX)
  return w > compactBox ? `${key}/${lang} "${label}" ${w.toFixed(1)} > ${compactBox}` : null
}).filter(Boolean))
for (const key of ['ehliyetInstagram', 'ehliyetFacebook']) {
  console.log(`  · compact ${key.padEnd(17)} box ${compactBox}pt @${SOCIAL_LABEL_PX}px  ` + LANGUAGES.map(({ key: l }) => `${l.slice(0, 2)} ${font(tr(key, l), SOCIAL_LABEL_PX).toFixed(1)}`).join('  '))
}
t('compact labels fit the half-width button at 320dp, all 9 languages', compactProblems(tr), [])
t('red-first: an overlong compact label is caught', compactProblems((k, l) => (k === 'ehliyetFacebook' && l === 'Turkish' ? 'Facebook sayfamız' : tr(k, l))).length, 1)
t('logo has role image + school name label; no visible name unless logo missing',
  [/accessibilityRole="image" accessibilityLabel=\{school\.name\}/.test(screenSrc), /s\.nameFallback/.test(screenSrc), /s\.name\b/.test(screenSrc)], [true, true, false])

// ── Email row: Inter 400 13px, 230px of text at 320dp (row 320-32-36=252, icon 16 + gap 6), font scale up to 1.3. ──
const font400 = loadFont('400Regular/Inter_400Regular.ttf')
const EMAIL_BOX = 230, EMAIL_PX = 13, EMAIL_SCALE = 1.3
const emailShown = emailDisplay(seed.email)
t('emailDisplay inserts exactly one U+200B, right after the @', [emailShown.split('\u200B').length - 1, emailShown], [1, 'seyhunbikmazsoforokulu@\u200Bgmail.com'])
t('emailDisplay removes nothing: stripping U+200B gives the raw address', emailShown.replace('\u200B', ''), seed.email)
t('mailto: and the raw address carry no U+200B', [mailtoUrl(seed).includes('\u200B'), seed.email.includes('\u200B')], [false, false])
const longestSegment = (str) => Math.max(...str.split('\u200B').map(seg => font400(seg, EMAIL_PX * EMAIL_SCALE)))
const seg = longestSegment(emailShown)
console.log(`  · email longest segment ${seg.toFixed(1)}px at ${EMAIL_PX}px x ${EMAIL_SCALE}, box ${EMAIL_BOX}px; whole address ${font400(seed.email, EMAIL_PX).toFixed(1)}px at 1.0, ${longestSegment(seed.email).toFixed(1)}px at ${EMAIL_SCALE}`)
t('email: longest unbreakable segment fits 230px at 13px x 1.3', seg <= EMAIL_BOX, true)
t('red-first: the whole address as one segment does NOT fit at 1.3', longestSegment(seed.email) <= EMAIL_BOX, false)

// ── Round 3 / 1: branch city names are Turkish in every language, never a translation. ──
t('EHLIYET_CITY_NAME covers every REGIONS key, nothing more', [Object.keys(EHLIYET_CITY_NAME).sort(), REGIONS.every(r => !!EHLIYET_CITY_NAME[r])], [[...REGIONS].sort(), true])
t('Turkish names', EHLIYET_CITY_NAME, { nicosia: 'Lefkoşa', kyrenia: 'Girne', famagusta: 'Gazimağusa', morphou: 'Güzelyurt', iskele: 'İskele', lefke: 'Lefke', karpaz: 'Karpaz' })
const FORBIDDEN_LITERALS = ['Morfo', 'Morphou', 'Μόρφου', 'مورفو', 'مورفو', 'Морфу']
// Every translated Lefkoşa / Güzelyurt (blDistrict*) that differs from the Turkish name is forbidden too.
const translatedCities = LANGUAGES.flatMap(({ key: l }) => [tr('blDistrictNicosia', l), tr('blDistrictMorphou', l)]).filter(n => n !== 'Lefkoşa' && n !== 'Güzelyurt')
const FORBIDDEN = [...new Set([...FORBIDDEN_LITERALS, ...translatedCities])]
const hits = (str) => FORBIDDEN.filter(w => str.includes(w))
console.log(`  · forbidden city spellings (${FORBIDDEN.length}): ${JSON.stringify(FORBIDDEN)}`)
const legacyChips = (lang) => sortedBranches(seed).map(b => tr(REGION_LABEL_KEY[b.region], lang))
const chipsByLang = Object.fromEntries(LANGUAGES.map(({ key: l }) => [l, branchChipLabels(seed)]))
console.log(`  · Arabic chips now: ${JSON.stringify(chipsByLang.Arabic)}; the old blDistrict path gave ${JSON.stringify(legacyChips('Arabic'))}`)
t('chip labels are exactly [Lefkoşa, Güzelyurt] in all 9 languages', Object.values(chipsByLang).filter(c => JSON.stringify(c) !== JSON.stringify(['Lefkoşa', 'Güzelyurt'])), [])
t('screen builds its chips from branchChipLabels / EHLIYET_CITY_NAME, not REGION_LABEL_KEY or blDistrict', [/branchChipLabels\(/.test(screenSrc), /REGION_LABEL_KEY|blDistrict/.test(screenSrc)], [true, false])
t('screen filters branches with EHLIYET_CITY_NAME', /EHLIYET_CITY_NAME\[b\.region\]/.test(screenSrc), true)
const constSrc = readFileSync(resolve(here, 'constants/ehliyet.js'), 'utf8')
t('no Morfo / Morphou / Μόρφου / مورفو / Морфу (or any translated city) in the screen', hits(screenSrc), [])
t('... nor in constants/ehliyet.js', hits(constSrc), [])
t('... nor in the fixture', hits(JSON.stringify(PREVIEW_DRIVING_SCHOOLS)), [])
t('red-first: the old blDistrict path in Arabic IS caught by the check', hits(legacyChips('Arabic').join(' ')).length > 0, true)
t('red-first: ... and in Greek / Russian', [hits(legacyChips('Greek').join(' ')).length > 0, hits(legacyChips('Russian').join(' ')).length > 0], [true, true])

t('never I18nManager, forceRTL or allowRTL in the screen or constants (CLAUDE.md: RTL is an app-wide decision)', /I18nManager|forceRTL|allowRTL/.test(screenSrc + constSrc), false)

// ── Round 3 / 2: address underline stops at the comma. ──
const seedAddr = addrs[0]
t('address parts: comma stays on the underlined part', addressParts(seedAddr), ['Şehit Fevait Ali Sokak 4/B,', 'Göçmenköy,', 'Lefkoşa'])
t('separator is a single space; joining gives back the raw address', [ADDRESS_SEP, addressParts(seedAddr).join(ADDRESS_SEP) === seedAddr], [' ', true])
t('address parts: single segment and blank', [addressParts('Lefkoşa'), addressParts('')], [['Lefkoşa'], ['']])
t('no part ends in a space (no underlined trailing space)', addressParts(seedAddr).filter(p => /\s$/.test(p)), [])
t('screen underlines the parts, not the whole address Text', [/textDecorationLine: 'none'/.test(screenSrc), /addressText:[^\n]*textDecorationLine: 'underline'/.test(screenSrc)], [true, false])
t('email: underlined run ends at "@" (break is the zero-width space, no trailing space)', emailShown.split('\u200B').filter(p => /\s$/.test(p)), [])

// ── Seed <-> fixture drift. Raw values print on failure. ──
const sql = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', SEED_SQL), 'utf8')
const drift = diffFixture(sql, seed)
t('fixture matches the 20261108 seed (is_active differs by design)', drift, [])
// Red-first, kept as permanent self-tests: the check must notice a broken fixture / unparseable seed.
const clone = () => JSON.parse(JSON.stringify(seed))
const mutPhone = clone(); mutPhone.phones[0] = mutPhone.phones[0].replace('887', '888')
t('drift: a changed phone digit is caught', diffFixture(sql, mutPhone).length, 1)
const mutBranch = clone(); mutBranch.driving_school_branches[1].region = 'kyrenia'
t('drift: a changed branch region is caught', diffFixture(sql, mutBranch).length, 1)
const mutOrder = clone(); [mutOrder.licence_classes[0], mutOrder.licence_classes[1]] = [mutOrder.licence_classes[1], mutOrder.licence_classes[0]]
t('drift: a licence-class order swap is caught', diffFixture(sql, mutOrder).length, 1)
const mutAddr = clone(); mutAddr.driving_school_branches[0].address = mutAddr.driving_school_branches[0].address.replace('4/B', '4/C')
t('drift: a changed address is caught', diffFixture(sql, mutAddr).length, 1)
const mutPin = clone(); mutPin.driving_school_branches[0].lat = 35.1
t('drift: a pin the seed does not have is caught', diffFixture(sql, mutPin).length, 1)
const mutActive = clone(); mutActive.is_active = false
t('drift: fixture is_active=false is caught (difference must stay explicit)', diffFixture(sql, mutActive).length, 1)
const throws = (f) => { try { f(); return false } catch { return true } }
const schoolInsert = sql.match(/INSERT INTO public\.driving_schools\s*\(\s*id,[\s\S]*?ON CONFLICT \(id\) DO NOTHING;/)[0]
t('parser: zero seed INSERTs fails', throws(() => parseSeed(sql.replace(schoolInsert, ''))), true)
t('parser: two seed INSERTs fails', throws(() => parseSeed(sql + '\n' + schoolInsert)), true)
const twoRows = schoolInsert.replace(/false\)\s*ON CONFLICT/, "false), ('x', 'y', 'z', ARRAY['+90 1'], NULL, NULL, NULL, NULL, NULL, false, 1, false) ON CONFLICT")
t('parser: two rows in one INSERT fails', twoRows !== schoolInsert && throws(() => parseSeed(sql.replace(schoolInsert, twoRows))), true)

console.log(bad ? `\n✗ ${bad} failure(s).` : '\n✓ all checks pass.')
process.exit(bad ? 1 : 0)

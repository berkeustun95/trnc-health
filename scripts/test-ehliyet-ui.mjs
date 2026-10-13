// Pure logic behind the Ehliyet screen (constants/ehliyet.js): the fixture-vs-query rule,
// "no logging for fixture rows", the tel:/wa.me/mailto:/maps links, button visibility rules, the logged
// actions vs the DB CHECK (20261109), and every button label fitting its button at 320dp (Inter 600).
//   node scripts/test-ehliyet-ui.mjs
import {
  PREVIEW_DRIVING_SCHOOLS, usesFixture, shouldLogContact, telUrl, primaryPhone, hasWhatsApp, whatsAppUrl, hasInstagram, hasFacebook,
  hasEmail, mailtoUrl, licenceClasses, branchAddress, mapsSearchUrl, sortedBranches,
  EHLIYET_BRIGHT, EHLIYET_DARK, EHLIYET_WA, EHLIYET_LOGS_CONTACTS,
} from '../constants/ehliyet.js'
import { REGIONS } from '../constants/regions.js'
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
t('no seed branch has coordinates (no pin from text)', sortedBranches(seed).every(b => b.lat === null && b.lng === null && b.geocode_source === null), true)

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
const font = (() => {
  const buf = readFileSync(resolve(here, 'node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'))
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
})()
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

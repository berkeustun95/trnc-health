// Pure logic behind the Ehliyet screen (constants/ehliyet.js): the fixture-vs-query rule,
// "no logging for fixture rows", the tel: link, and "WhatsApp hidden when null".
//   node scripts/test-ehliyet-ui.mjs
import {
  PREVIEW_DRIVING_SCHOOLS, usesFixture, shouldLogContact, telUrl, hasWhatsApp, whatsAppUrl, hasInstagram, sortedBranches,
  EHLIYET_BRIGHT, EHLIYET_DARK, EHLIYET_WA, EHLIYET_LOGS_CONTACTS,
} from '../constants/ehliyet.js'
import { REGIONS } from '../constants/regions.js'
import { readFileSync } from 'node:fs'
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
t('fixture: logo key, 3 phones, featured', [seed.logo_key, seed.phones.length, seed.featured], ['seyhun/logo', 3, true])
t('fixture branches are valid regions, ordered', sortedBranches(seed).map(b => b.region), ['nicosia', 'morphou'])
t('fixture branch regions exist in REGIONS', sortedBranches(seed).every(b => REGIONS.includes(b.region)), true)
t('branch order follows sort_order, not array order',
  sortedBranches({ driving_school_branches: [{ region: 'morphou', sort_order: 1 }, { region: 'nicosia', sort_order: 0 }] }).map(b => b.region), ['nicosia', 'morphou'])

t('WhatsApp hidden when null', hasWhatsApp({ whatsapp: null }), false)
t('WhatsApp hidden when empty / blank', [hasWhatsApp({ whatsapp: '' }), hasWhatsApp({ whatsapp: '  ' }), hasWhatsApp({})], [false, false, false])
t('WhatsApp hidden for the seed (whatsapp null)', hasWhatsApp(seed), false)
t('WhatsApp shown when set', hasWhatsApp({ whatsapp: '+90 533 854 39 99' }), true)
t('wa.me link is digits only', whatsAppUrl({ whatsapp: '+90 533 854 39 99' }), 'https://wa.me/905338543999')

t('tel: strips spaces, keeps +', telUrl('+90 533 854 39 99'), 'tel:+905338543999')
t('Instagram needs an https link', [hasInstagram(seed), hasInstagram({ instagram_url: null }), hasInstagram({ instagram_url: 'javascript:alert(1)' }), hasInstagram({ instagram_url: 'http://x.com/a' })], [true, false, false, false])
t('brand colours exact', [EHLIYET_BRIGHT, EHLIYET_DARK, EHLIYET_WA], ['#294EA6', '#213565', '#075E54'])

// ── Seed <-> fixture drift. Raw values print on failure. ──
const sql = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', SEED_SQL), 'utf8')
const drift = diffFixture(sql, seed)
t('fixture matches the 20261108 seed (is_active differs by design)', drift, [])
// Red-first, kept as permanent self-tests: the check must notice a broken fixture / unparseable seed.
const clone = () => JSON.parse(JSON.stringify(seed))
const mutPhone = clone(); mutPhone.phones[1] = mutPhone.phones[1].replace('887', '888')
t('drift: a changed phone digit is caught', diffFixture(sql, mutPhone).length, 1)
const mutBranch = clone(); mutBranch.driving_school_branches[1].region = 'kyrenia'
t('drift: a changed branch region is caught', diffFixture(sql, mutBranch).length, 1)
const mutActive = clone(); mutActive.is_active = false
t('drift: fixture is_active=false is caught (difference must stay explicit)', diffFixture(sql, mutActive).length, 1)
const throws = (f) => { try { f(); return false } catch { return true } }
const schoolInsert = sql.match(/INSERT INTO public\.driving_schools\s*\(\s*id,[\s\S]*?ON CONFLICT \(id\) DO NOTHING;/)[0]
t('parser: zero seed INSERTs fails', throws(() => parseSeed(sql.replace(schoolInsert, ''))), true)
t('parser: two seed INSERTs fails', throws(() => parseSeed(sql + '\n' + schoolInsert)), true)
const twoRows = schoolInsert.replace(/false\)\s*ON CONFLICT/, "false), ('x', 'y', 'z', ARRAY['+90 1'], NULL, NULL, false, 1, false) ON CONFLICT")
t('parser: two rows in one INSERT fails', twoRows !== schoolInsert && throws(() => parseSeed(sql.replace(schoolInsert, twoRows))), true)

console.log(bad ? `\n✗ ${bad} failure(s).` : '\n✓ all checks pass.')
process.exit(bad ? 1 : 0)

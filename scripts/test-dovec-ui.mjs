// Döveç projects (app side), node only:  node scripts/test-dovec-ui.mjs
// The pure helpers in constants/dovec.js against fictional fixtures in the REAL row shape (the sync-dovec fixture, mapped
// the way sync-dovec writes it). The fixture lives under supabase/functions/ and is imported by no app file: nothing here
// ships to users. The request body is also run through the server's own validateLead, so the two cannot drift apart.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  dovecShown, formatGbp, deliveryLabel, placeLine, galleryUrls, unitTypes, composePhone, validateEnquiry,
  buildLeadPayload, requestIdFor, classifyLead, OUTCOME_KEY, dovecWaUrl, dovecWaText, dovecMapsUrl, DOVEC_CONSENT_VERSION, DOVEC_LOGO,
  unitTypeKey, unitTypeLabel, dovecWaAppUrl, privacyUrlFor, dovecCanSend,
} from '../constants/dovec.js'
import { t } from '../constants/i18n.js'
import { COUNTRY_CODES, countryCodeOptions } from '../constants/countryCodes.js'
import { mapsUrlForBranch } from '../constants/ehliyet.js'
import { DOVEC_PARTNER_LIVE } from '../constants/flags.js'
import { validateLead } from '../supabase/functions/_shared/dovec-lead.mjs'

let bad = 0
const check = (name, ok, got) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${JSON.stringify(got)}`}`) }
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), got)
const root = new URL('..', import.meta.url)
const read = p => readFileSync(fileURLToPath(new URL(p, root)), 'utf8')

// fixture -> dovec_projects row shape (planned_delivery_month 'YYYY-MM' becomes the date column 'YYYY-MM-01')
const ROWS = JSON.parse(read('supabase/functions/sync-dovec/fixtures/projects.json')).projects.map(p => ({
  id: p.id, entity_uuid: '00000000-0000-4000-8000-000000000001', name: p.name, city: p.city, area: p.area || null, status: p.status,
  planned_delivery_month: p.planned_delivery_month ? `${p.planned_delivery_month}-01` : null, from_price: p.from_price, currency: 'GBP',
  available_units: p.available_units, unit_types: p.unit_types, cover_url: p.cover_image_url, website_url: p.website_url, description: null, gallery: null, latitude: null, longitude: null,
}))
check('fixture has rows incl. one with no price and one with no area', ROWS.length >= 3 && ROWS.some(r => r.from_price === null) && ROWS.some(r => !r.area), ROWS.length)

// the flag stays false in every commit
check('DOVEC_PARTNER_LIVE is false', DOVEC_PARTNER_LIVE === false)

// visibility: production = flag AND published; dev/Preview ignores both
check('production, flag off, published -> hidden', dovecShown({ published: true, preview: false, live: false }) === false)
check('production, flag on, not published -> hidden', dovecShown({ published: false, preview: false, live: true }) === false)
check('production, flag on, published -> shown', dovecShown({ published: true, preview: false, live: true }) === true)
check('dev/Preview shows with published=false and flag off', dovecShown({ published: false, preview: true, live: false }) === true)
check('published only counts when === true', dovecShown({ published: 'true', preview: false, live: true }) === false && dovecShown({ published: null, preview: false, live: true }) === false)
check('the committed flag value hides production', dovecShown({ published: true, preview: false }) === false)

// price
eq('£1,250,000', formatGbp(1250000), '£1,250,000')
eq('£185,000 (string numeric)', formatGbp('185000'), '£185,000')
eq('£99,500', formatGbp(99500), '£99,500')
eq('£0 is a price', formatGbp(0), '£0')
eq('null price -> null (shows nothing)', formatGbp(null), null)
eq('NaN / negative -> null', [formatGbp('x'), formatGbp(-5)], [null, null])
eq('rounds, never decimals', formatGbp(1999.6), '£2,000')

// delivery month: current month or later only; past shows nothing, never "delivered"
const NOW = new Date(2026, 10, 23)   // 23 Nov 2026 (local)
eq('future month shown', deliveryLabel('2027-06-01', 'English', NOW), 'June 2027')
eq('current month shown', deliveryLabel('2026-11-01', 'English', NOW), 'November 2026')
eq('month before this one -> nothing', deliveryLabel('2026-10-01', 'English', NOW), null)
eq('last year -> nothing', deliveryLabel('2025-12-01', 'English', NOW), null)
eq('December 2026 shown', deliveryLabel('2026-12-01', 'English', NOW), 'December 2026')
eq('null / junk -> nothing', [deliveryLabel(null, 'English', NOW), deliveryLabel('soon', 'English', NOW), deliveryLabel('2027-13-01', 'English', NOW)], [null, null, null])
check('localised (Turkish) carries the year and is not the English name', /2027$/.test(deliveryLabel('2027-06-01', 'Turkish', NOW)) && !/June/.test(deliveryLabel('2027-06-01', 'Turkish', NOW)), deliveryLabel('2027-06-01', 'Turkish', NOW))
check('the fixture row for Dec 2026 still shows at "now" and the screen text never says delivered', ROWS.some(r => deliveryLabel(r.planned_delivery_month, 'English', NOW)) && !/deliver(ed)?\b.*(past|done)/i.test(read('screens/DovecProjectScreen.js')))

// place / units / gallery
eq('city · area', placeLine(ROWS[0]), 'Testville · Old Quay')
eq('empty area -> city only', placeLine(ROWS[1]), 'Sampletown')
eq('unit types kept, junk dropped', unitTypes({ unit_types: [{ type: '1+1', from_price: 1 }, { type: ' ' }, null, { from_price: 3 }] }).length, 1)
eq('gallery: https strings and {url}; http / junk dropped', galleryUrls(['https://a/1.jpg', { url: 'https://a/2.jpg' }, 'http://a/3.jpg', 5, null]), ['https://a/1.jpg', 'https://a/2.jpg'])
eq('gallery null -> []', galleryUrls(null), [])

// phone + validation (mirrors validateLead)
eq('cc + national, trunk 0 dropped', composePhone('+90', '0533 111 22 33'), '+905331112233')
eq('number typed with +, stands alone', composePhone('+44', '+90 533 111 22 33'), '+905331112233')
eq('no digits -> empty', composePhone('+90', ' - '), '')
const GOOD = { name: ' Test Person ', cc: '+44', phone: '7700 900123', email: '', message: '', consent: true }
check('valid enquiry', validateEnquiry(GOOD).ok === true, validateEnquiry(GOOD))
check('consent unticked -> not ok', validateEnquiry({ ...GOOD, consent: false }).errors.consent === true)
check('consent must be strictly true', validateEnquiry({ ...GOOD, consent: 'yes' }).ok === false && validateEnquiry({ ...GOOD, consent: 1 }).ok === false)
check('empty name -> not ok', validateEnquiry({ ...GOOD, name: '   ' }).errors.name === true)
check('name over 120 -> not ok', validateEnquiry({ ...GOOD, name: 'x'.repeat(121) }).errors.name === true && validateEnquiry({ ...GOOD, name: 'x'.repeat(120) }).ok)
check('no country code and no + -> phone not ok', validateEnquiry({ ...GOOD, cc: null }).errors.phone === true)
check('too short phone -> not ok', validateEnquiry({ ...GOOD, phone: '123' }).errors.phone === true)
check('bad email -> not ok, empty email ok', validateEnquiry({ ...GOOD, email: 'a@b' }).errors.email === true && validateEnquiry({ ...GOOD, email: '' }).ok)
check('message 2000 ok, 2001 not', validateEnquiry({ ...GOOD, message: 'm'.repeat(2000) }).ok && validateEnquiry({ ...GOOD, message: 'm'.repeat(2001) }).errors.message === true)

// payload
const ID1 = '0b0c8a52-6f0e-4a8e-9a58-3b3f2f0a1111'
const base = { requestId: ID1, projectId: 'fx-harbour-view', unitType: '2+1', ...GOOD, email: 'test@example.com', message: ' Hello ', lang: 'Turkish' }
const pl = buildLeadPayload(base)
eq('payload keys are exactly the server contract', Object.keys(pl).sort(),
  ['client_request_id', 'consent', 'consent_text_version', 'email', 'language', 'message', 'name', 'phone', 'project_id', 'unit_type'])
eq('payload values trimmed / composed', [pl.name, pl.phone, pl.message, pl.consent, pl.consent_text_version], ['Test Person', '+447700900123', 'Hello', true, DOVEC_CONSENT_VERSION])
eq('language passes through as the full English name', pl.language, 'Turkish')
eq('optionals left out when empty', Object.keys(buildLeadPayload({ ...base, unitType: null, email: '', message: '  ' })).sort(),
  ['client_request_id', 'consent', 'consent_text_version', 'language', 'name', 'phone', 'project_id'])
let threw = 0
for (const c of [false, undefined, null, 'true', 1]) { try { buildLeadPayload({ ...base, consent: c }) } catch { threw++ } }
eq('consent strict: only true builds a payload', threw, 5)
check('extra input fields never leak into the payload', !('cc' in pl) && !('requestId' in pl) && !('projectId' in pl) && !('unitType' in pl))
const srv = validateLead(pl)
check("the server's validateLead accepts the payload", srv.ok === true, srv)
check("...and keeps every field we sent", srv.ok && srv.value.language === 'Turkish' && srv.value.unit_type === '2+1' && srv.value.phone === '+447700900123', srv)
check('the server consent version list contains ours', validateLead({ ...pl, consent_text_version: 'dovec-consent-x' }).ok === false)
check('the server rejects an unknown key (guards the exact-keys test)', validateLead({ ...pl, extra: 1 }).ok === false)

// request id: reused only for the identical payload
let n = 0
const mk = () => `id-${++n}`
const a = requestIdFor(null, pl, mk)
const b = requestIdFor(a, { ...pl, client_request_id: 'whatever' }, mk)
check('identical payload keeps its id (retry after network failure)', b === a && n === 1, [a, b, n])
const c = requestIdFor(a, { ...pl, name: 'Other' }, mk)
check('any changed field makes a new id', c.id !== a.id && n === 2, c)
check('changed unit type / message / language also new', [{ unit_type: '1+1' }, { message: 'x' }, { language: 'English' }].every(d => requestIdFor(a, { ...pl, ...d }, mk).id !== a.id))
check('after a reset (null) the next submit gets a new id', requestIdFor(null, pl, mk).id !== a.id)

// outcomes
eq('200 ok', classifyLead(200, { ok: true, external_id: 'ADA-7', status: 'mock' }), { kind: 'ok', externalId: 'ADA-7', status: 'mock' })
eq('200 ok retry/sent also ok', [classifyLead(200, { ok: true, external_id: 'ADA-8', status: 'retry' }).kind, classifyLead(200, { ok: true, external_id: 'ADA-9', status: 'sent' }).kind], ['ok', 'ok'])
eq('200 rejected', classifyLead(200, { ok: false, error: 'rejected', external_id: 'ADA-7' }).kind, 'rejected')
eq('200 with a body that is neither -> error', classifyLead(200, { ok: false }).kind, 'error')
eq('400 consent_required', classifyLead(400, { error: 'consent_required' }).kind, 'consent')
eq('400 invalid_request keeps the field name', classifyLead(400, { error: 'invalid_request', field: 'phone' }), { kind: 'invalid', field: 'phone' })
eq('403 -> signin, 404 -> unavailable, 409 -> changed, 429 -> rate', [403, 404, 409, 429].map(s => classifyLead(s, {}).kind), ['signin', 'unavailable', 'changed', 'rate'])
eq('403 sign_in_required -> signin', classifyLead(403, { error: 'sign_in_required' }).kind, 'signin')
eq('403 under_18 -> under18, own message', [classifyLead(403, { error: 'under_18' }).kind, OUTCOME_KEY.under18], ['under18', 'dovecErrUnder18'])
eq('429 rate_limited -> rate, own message', [classifyLead(429, { error: 'rate_limited' }).kind, OUTCOME_KEY.rate], ['rate', 'dovecErrRate'])
eq('500 / no body -> error', [classifyLead(500, null).kind, classifyLead(502, undefined).kind], ['error', 'error'])
check('every outcome kind the form can show has a message key', ['rejected', 'invalid', 'consent', 'signin', 'unavailable', 'rate', 'changed', 'network', 'error'].every(k => OUTCOME_KEY[k]))

// WhatsApp (thank-you only)
eq('wa.me takes digits only, text encoded', dovecWaUrl('+357 99 000 111', 'Hi & bye'), 'https://wa.me/35799000111?text=Hi%20%26%20bye')
eq('no number -> no link (button hidden)', [dovecWaUrl(null, 'x'), dovecWaUrl('', 'x')], [null, null])
const WA_TR = 'Merhaba, ADA uygulamasından yazıyorum. D-Point hakkında bilgi almak istiyorum. (Ref: ADA-7)'
eq('wa text is Döveç\'s exact Turkish template (D-Point, ADA-7), whatever the app language', dovecWaText('D-Point', 'ADA-7'), WA_TR)
eq('wa link for +905338880515 carries that text', dovecWaUrl('+905338880515', dovecWaText('D-Point', 'ADA-7')), `https://wa.me/905338880515?text=${encodeURIComponent(WA_TR)}`)
check('template is a constant, no i18n key', !/dovecWaMessage/.test(read('constants/i18n.js')) && !/dovecWaText\(t\(/.test(read('components/dovec/DovecThankYou.js')))
check('$& name survives verbatim', dovecWaText('A $& B', 'r').includes('A $& B'))

// Maps (detail page): only with two numeric coordinates, the hotels' https form
const at = { latitude: 35.1856, longitude: 33.3823 }
eq('maps url equals the hotels form (mapsUrlForBranch)', dovecMapsUrl(at), mapsUrlForBranch({ lat: 35.1856, lng: 33.3823 }))
eq('maps url shape', dovecMapsUrl(at), 'https://www.google.com/maps/search/?api=1&query=35.1856,33.3823')
eq('no maps button when either coordinate is null / missing / non-number',
  [{ latitude: null, longitude: 33.3 }, { latitude: 35.1, longitude: null }, { latitude: null, longitude: null }, {}, { latitude: '35.1', longitude: '33.3' }, { latitude: NaN, longitude: 33.3 }, null].map(dovecMapsUrl),
  [null, null, null, null, null, null, null])
eq('coordinate 0 is a number, kept', dovecMapsUrl({ latitude: 0, longitude: 0 }), 'https://www.google.com/maps/search/?api=1&query=0,0')
check('detail screen gates the maps button on dovecMapsUrl', /dovecMapsUrl\(project\)/.test(read('screens/DovecProjectScreen.js')) && /!!mapsUrl &&/.test(read('screens/DovecProjectScreen.js')))
check('loadDovec selects latitude and longitude', /latitude, longitude/.test(read('utils/loadDovec.js')))

// source guards: no contact before the form; the logo slot is empty until delivered
const detail = read('screens/DovecProjectScreen.js'), list = read('screens/DovecProjectsScreen.js')
check('no call / WhatsApp / contact logging on the list or project screens', ![detail, list].some(s => /wa\.me|tel:|logContactEvent|dovecWa|Linking\.openURL\(`/.test(s)))
check('WhatsApp only on the thank-you component, behind whatsapp_e164', /logContactEvent\('dovec', project\.entity_uuid, 'whatsapp'\)/.test(read('components/dovec/DovecThankYou.js')) && /whatsapp \? dovecWaUrl/.test(read('components/dovec/DovecThankYou.js')))
check('logo hook is empty (no asset yet)', DOVEC_LOGO === null)

// ─── round 2 ─────────────────────────────────────────────────────────────────
// unit type labels: display only, the payload keeps the feed's own string
eq('Turkish labels exactly: Stüdyo, Ofis, Dükkan', ['Studio', 'Office', 'Shop'].map(u => unitTypeLabel(u, 'Turkish', t)), ['Stüdyo', 'Ofis', 'Dükkan'])
eq('Turkish forms map too, any case and padding', ['stüdyo', ' STÜDYO ', 'OFİS', 'ofis', 'Dükkan', 'DÜKKAN', 'shop', 'OFFICE'].map(unitTypeKey),
  ['dovecUnitStudio', 'dovecUnitStudio', 'dovecUnitOffice', 'dovecUnitOffice', 'dovecUnitShop', 'dovecUnitShop', 'dovecUnitShop', 'dovecUnitOffice'])
eq('anything else is shown exactly as given', ['1+1', '2+1', 'Villa', 'Penthouse', ' Villa '].map(u => unitTypeLabel(u, 'Turkish', t)), ['1+1', '2+1', 'Villa', 'Penthouse', ' Villa '])
check('all 9 languages carry the three labels, non-empty', ['English', 'Turkish', 'Arabic', 'Russian', 'Greek', 'French', 'Spanish', 'German', 'Persian']
  .every(l => ['dovecUnitStudio', 'dovecUnitOffice', 'dovecUnitShop', 'dovecPrivacyLink', 'dovecFormPrivacyMissing'].every(k => t(k, l) && t(k, l) !== k)))
{
  const raw = ' Studio '
  const pl = buildLeadPayload({ ...base, unitType: raw })
  check('payload unit_type stays the raw feed string, whatever the label', pl.unit_type === raw && unitTypeLabel(raw, 'Turkish', t) === 'Stüdyo', pl.unit_type)
  const form = read('components/dovec/DovecEnquiryForm.js')
  check('form chips: label shown, raw value stored', /setUnit\(on \? null : u\.type\)/.test(form) && /unitTypeLabel\(u\.type, lang, t\)/.test(form))
}

// phone code picker: names in the app language, values untouched
{
  const tr = countryCodeOptions('Turkish'), en = countryCodeOptions('English'), xx = countryCodeOptions('Klingon')
  eq('same order and values as COUNTRY_CODES in every language', [tr, en, xx].map(o => o.map(x => x.value)), [COUNTRY_CODES, COUNTRY_CODES, COUNTRY_CODES].map(c => c.map(x => x.code)))
  eq('Turkish names', [tr[0].label, tr[1].label, tr[3].label], ['+90  Türkiye', '+357  Kıbrıs', '+1  Amerika Birleşik Devletleri / Kanada'])
  eq('Greek and Persian', [countryCodeOptions('Greek')[1].label, countryCodeOptions('Persian')[0].label], ['+357  Κύπρος', '+90  ترکیه'])
  eq('English keeps the existing labels; unknown language falls back to English', [en[0].label, en[3].label, xx[0].label], ['+90  Turkey', '+1  USA / Canada', '+90  Turkey'])
  check('every entry has an ISO region', COUNTRY_CODES.every(c => [].concat(c.region).every(r => /^[A-Z]{2}$/.test(r))))
}

// privacy notice: language pick, https only, fail closed
{
  const S = { privacy_url_tr: 'https://example.test/tr', privacy_url_en: 'https://example.test/en' }
  eq('Turkish -> TR, every other language -> EN', [privacyUrlFor(S, 'Turkish'), privacyUrlFor(S, 'English'), privacyUrlFor(S, 'Greek'), privacyUrlFor(S, 'Persian')],
    ['https://example.test/tr', 'https://example.test/en', 'https://example.test/en', 'https://example.test/en'])
  eq('TR missing -> falls back to EN; EN missing -> none for other languages', [privacyUrlFor({ privacy_url_en: S.privacy_url_en }, 'Turkish'), privacyUrlFor({ privacy_url_tr: S.privacy_url_tr }, 'English')], ['https://example.test/en', null])
  eq('http / junk / empty / no settings are refused', [{ privacy_url_en: 'http://x.test' }, { privacy_url_en: 'javascript:alert(1)' }, { privacy_url_en: '' }, { privacy_url_en: 5 }, {}, null, undefined].map(x => privacyUrlFor(x, 'English')), [null, null, null, null, null, null, null])
  eq('an invalid TR url falls back to EN', privacyUrlFor({ privacy_url_tr: 'http://x.test', privacy_url_en: S.privacy_url_en }, 'Turkish'), 'https://example.test/en')
  eq('send needs a valid form AND a privacy url (any mode)', [dovecCanSend(true, 'https://x.test'), dovecCanSend(true, null), dovecCanSend(false, 'https://x.test'), dovecCanSend(undefined, 'https://x.test')], [true, false, false, false])
  const form = read('components/dovec/DovecEnquiryForm.js')
  check('form: submit and Send disabled follow canSend; the link opens the url, not the consent toggle', /if \(busy \|\| !canSend\) return/.test(form) && /disabled=\{!canSend\}/.test(form) && /accessibilityRole="link"/.test(form) && /minHeight: TAP/.test(form.match(/privacy:\s+\{[^}]*\}/)[0]))
  check('loadDovec selects both privacy columns; both in REQUIRED with the migration name', /privacy_url_tr, privacy_url_en/.test(read('utils/loadDovec.js')) && /'privacy_url_tr', '20261235_dovec_privacy_url\.sql'/.test(read('scripts/check-required-columns.mjs')) && /'privacy_url_en', '20261235_dovec_privacy_url\.sql'/.test(read('scripts/check-required-columns.mjs')))
  check('the projects screen hands settings to the form', /settings=\{data\?\.settings\}/.test(read('screens/DovecProjectsScreen.js')))
}

// WhatsApp: app link first, wa.me on rejection, text and reference unchanged
{
  const text = dovecWaText('D-Point', 'ADA-7')
  eq('app link: digits only, text encoded like wa.me', dovecWaAppUrl('+357 99 000 111', text), `whatsapp://send?phone=35799000111&text=${encodeURIComponent(text)}`)
  eq('same encoded text as the wa.me link', dovecWaAppUrl('+35799000111', text).split('&text=')[1], dovecWaUrl('+35799000111', text).split('?text=')[1])
  eq('no number -> no link', [dovecWaAppUrl(null, 'x'), dovecWaAppUrl('', 'x')], [null, null])
  const ty = read('components/dovec/DovecThankYou.js')
  check('thank-you: one log per tap, app link then wa.me fallback, no canOpenURL', (ty.match(/logContactEvent\('dovec'/g) || []).length === 1 && /openURL\(dovecWaAppUrl\(whatsapp, text\)\)\.catch\(\(\) => Linking\.openURL\(waUrl\)/.test(ty) && !/canOpenURL/.test(ty))
}

// cover: same url string on card and detail, error falls back to the icon
{
  const card = read('components/dovec/DovecProjectCard.js')
  check('detail and card both pass project.cover_url straight to Cover', /<Cover url=\{project\.cover_url\}/.test(card) && /<Cover url=\{project\.cover_url\}/.test(detail))
  check('Cover: source uri is the url as given, error falls back to the no-cover icon', /source=\{\{ uri: url \}\}/.test(card) && /onError=\{\(\) => setFailedUrl\(url\)\}/.test(card) && /failedUrl === url/.test(card))
}

// admin preview language: preview-local only
{
  const app = read('App.js'), admin = read('screens/AdminScreen.js')
  check('App: preview language passed to the Döveç screen only, state is plain useState (no storage, no profile write)', /lang=\{dovecPreviewLang \|\| lang\} onClose/.test(app) && /useState\(null\)/.test(app.match(/const \[dovecPreviewLang[^\n]*/)[0]) && !/dovecPreviewLang[^\n]*(AsyncStorage|preferred_language|from\('profiles'\))/.test(app))
  check('AdminScreen: the language choice only calls the setter', /onDovecPreviewLang\(l\.key\)/.test(admin) && !/dovecPreviewLang[^\n]*(AsyncStorage|supabase)/.test(admin))
}

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)

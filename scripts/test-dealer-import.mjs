// scripts/lib/dealer-csv.mjs (the dealer stock CSV → vehicles rows), node only:
//   node scripts/test-dealer-import.mjs
// The risky parts: a value mapped to the wrong enum shows a wrong car; a truncated CSV must not empty the stock; a
// contact detail in a description must not survive; and the committed data file must never carry a source-site link.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv, mapCar, planSync, removalRefusal, contentHash, changedFields, stripContacts, wholeNumber, orderPhotos, BODY, COLOUR, FUEL } from './lib/dealer-csv.mjs'
import { BODIES, COLOURS, FUELS } from '../constants/cars.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let bad = 0
const check = (name, ok, got) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${JSON.stringify(got)}`}`) }

// ── CSV ──
const csv = parseCsv('﻿a,b,c\r\n1,"x, y","say ""hi"""\n2,"line\nbreak",\n')
check('CSV: BOM, CRLF, quoted comma, doubled quote, newline in a field', csv.length === 2 && csv[0].b === 'x, y' && csv[0].c === 'say "hi"' && csv[1].b === 'line\nbreak' && csv[1].c === '', csv)
let threw = false; try { parseCsv('a,b\n1\n') } catch { threw = true }
check('CSV: a short row is an error, not a shifted car', threw)

// ── One row ──
const R = { ilan_no: '270925', marka: 'Mazda', model: 'CX-5', versiyon: '2.2 Skyactiv-D', yil: '2026', durum: '2.El (Plakasız)', kasa: 'SUV', yakit: 'Dizel',
  vites: 'Otomatik', direksiyon: 'Sağ', motor_cc: '2200', renk: 'Beyaz', km: '3900', sehir: 'Lefkoşa', fiyat_liste: '29950', fiyat_aciklamada: '29950',
  para_birimi: 'GBP', ozellikler: 'Masrafsız, Aksesuarlı', aciklama: '', not: '' }
const m = mapCar(R)
check('a full row maps', m.row && m.row.external_id === '270925' && m.row.intent === 'sale' && m.row.fuel === 'diesel' && m.row.gearbox === 'automatic'
  && m.row.body_type === 'suv' && m.row.colour === 'white' && m.row.steering === 'right' && m.row.region === 'nicosia' && m.row.price === 29950
  && m.row.price_per_day === null && m.row.km === 3900 && m.row.year === 2026 && m.flags.length === 0, m)
check('description: versiyon · cc · durum, then özellikler', m.row.description === '2.2 Skyactiv-D · 2200 cc · 2.El (Plakasız)\n\nMasrafsız, Aksesuarlı', m.row.description)
const map = o => mapCar({ ...R, ...o })
check('Mild Hibrit Benzin / Hibrit → hybrid', map({ yakit: 'Mild Hibrit Benzin' }).row.fuel === 'hybrid' && map({ yakit: 'Hibrit' }).row.fuel === 'hybrid')
check('Düz → manual', map({ vites: 'Düz' }).row.gearbox === 'manual')
check('bodies: Hatchback 5 Kapı, Stationwagon, Panelvan, Pick-up, Minibüs', ['Hatchback 5 Kapı', 'Stationwagon', 'Panelvan', 'Pick-up', 'Minibüs']
  .map(k => map({ kasa: k }).row.body_type).join() === 'hatchback,estate,van,pickup,minibus')
check('colours: Bordo → red, Lacivert → blue, Krem → beige, Buz Yeşili → green, Gri Metalik → grey, Kahverengi → brown',
  ['Bordo', 'Lacivert', 'Krem', 'Buz Yeşili', 'Gri Metalik', 'Kahverengi'].map(k => map({ renk: k }).row.colour).join() === 'red,blue,beige,green,grey,brown')
check('Turkish case: GÜMÜŞ and İSKELE match', map({ renk: 'GÜMÜŞ' }).row?.colour === 'silver' && map({ sehir: 'İSKELE' }).row?.region === 'iskele')
check('every mapped value is one the app and the table know', [...BODY.values()].every(v => BODIES.includes(v)) && [...COLOUR.values()].every(v => COLOURS.includes(v)) && [...FUEL.values()].every(v => FUELS.includes(v)))
check('km 0 is a new car, not a missing value', map({ km: '0', durum: '0 Km' }).row.km === 0)
check('a missing km skips the row (never guessed)', !map({ km: '' }).row && map({ km: '' }).problems.join().includes('km is missing'), map({ km: '' }))
check('an unknown body / colour / fuel skips the row and names it', ['kasa', 'renk', 'yakit'].every(c => { const x = map({ [c]: 'Zeplin' }); return !x.row && x.problems.some(p => p.includes('Zeplin')) }))
check('price: thousands separators, never a decimal', wholeNumber('29.950') === 29950 && wholeNumber('29,950') === 29950 && wholeNumber('29950.50') === null && wholeNumber('') === null)
check('a price that differs from the dealer text: list price used, flagged', map({ fiyat_liste: '12500', fiyat_aciklamada: '11950' }).row.price === 12500
  && map({ fiyat_liste: '12500', fiyat_aciklamada: '11950' }).flags[0].startsWith('FİYAT FARKLI'))
check('rent: tur = Kiralık puts the price in price_per_day', map({ tur: 'Kiralık', fiyat_liste: '40' }).row.price_per_day === 40 && map({ tur: 'Kiralık', fiyat_liste: '40' }).row.price === null)
check('no currency guess', !map({ para_birimi: 'STG' }).row)

// ── Contacts in descriptions ──
const cut = t => stripContacts(t).text
check('phones are cut (0533…, +90 5xx, 0392 landline, spaced)', ['Ara 0533 123 45 67 hemen', 'Tel: +90 548 123 45 67', '0392 228 12 34', '05331234567', '+905331234567']
  .every(t => !/\d{3}/.test(cut(t))), ['Ara 0533 123 45 67 hemen', 'Tel: +90 548 123 45 67', '0392 228 12 34', '05331234567', '+905331234567'].map(cut))
check('e-mail, links and handles are cut', !/@|www|http|wa\.me|instagram/.test(cut('yaz: oto@galeri.com veya www.galeri.com https://wa.me/905331234567 instagram.com/galeri')))
check('km, cc, year and prices survive', cut('314000 km, 2200 cc, 2010 model, 12.500 GBP, 234964 km') === '314000 km, 2200 cc, 2010 model, 12.500 GBP, 234964 km', cut('314000 km, 2200 cc, 2010 model, 12.500 GBP, 234964 km'))
check('a cut is reported as a flag', map({ aciklama: 'Bilgi için 0533 123 45 67' }).flags.some(f => f.includes('contact detail')) && !/0533/.test(map({ aciklama: 'Bilgi için 0533 123 45 67' }).row.description))

// ── Sync plan ──
const live = (ref, o = {}) => ({ id: `id-${ref}`, external_id: ref, status: 'active', ...mapCar({ ...R, ilan_no: ref }).row, price: '29950.00', ...o })
const cars3 = ['1', '2', '3'].map(ref => mapCar({ ...R, ilan_no: ref }))
let p = planSync(cars3, [])
check('empty database: everything is added', p.add.length === 3 && !p.change.length && !p.remove.length)
p = planSync(cars3, ['1', '2', '3'].map(r => live(r)))
check("nothing changed: nothing to write (numeric(12,2) '29950.00' equals 29950)", p.same.length === 3 && !p.add.length && !p.change.length && !p.remove.length, p.change.map(c => c.fields))
p = planSync([mapCar({ ...R, ilan_no: '1', fiyat_liste: '27950' }), cars3[1], cars3[2]], ['1', '2', '3'].map(r => live(r)))
check('a new price is a change, named', p.change.length === 1 && p.change[0].fields.join() === 'price' && p.change[0].id === 'id-1', p.change)
check('…and the hash moves with it', contentHash(cars3[0].row) !== contentHash(mapCar({ ...R, ilan_no: '1', fiyat_liste: '27950' }).row) && changedFields(live('1'), cars3[0].row).length === 0)
p = planSync(cars3.slice(0, 2), ['1', '2', '3'].map(r => live(r)))
check('a car missing from the CSV is removed', p.remove.length === 1 && p.remove[0].external_id === '3')
p = planSync([cars3[0], cars3[1], mapCar({ ...R, ilan_no: '3', km: '' })], ['1', '2', '3'].map(r => live(r)))
check('an unmappable row keeps what is live under its reference', p.remove.length === 0 && p.skipped.length === 1)
p = planSync(cars3, [live('1'), live('2'), live('3', { status: 'removed' })])
check('a removed car that is back in the CSV is re-activated', p.change.length === 1 && p.change[0].fields[0] === 'status')
p = planSync(cars3.slice(0, 2), [live('1'), live('2'), live('3', { status: 'removed' })])
check('an already removed car is not removed again', p.remove.length === 0)
threw = false; try { planSync([cars3[0], cars3[0]], []) } catch { threw = true }
check('a duplicated reference stops the run', threw)

// ── Safety stop ──
const stock = Array.from({ length: 29 }, (_, i) => live(String(i + 1)))
const csvOf = n => stock.slice(0, n).map(e => mapCar({ ...R, ilan_no: e.external_id }))
check('two cars sold: allowed', removalRefusal(planSync(csvOf(27), stock), stock, null) === null)
check('three gone at once: refused without the count', /remove 3 of 29/.test(removalRefusal(planSync(csvOf(26), stock), stock, null) ?? ''))
check('…allowed with the exact count, refused with another', removalRefusal(planSync(csvOf(26), stock), stock, 3) === null && removalRefusal(planSync(csvOf(26), stock), stock, 4) !== null)
check('an empty or header-only CSV never empties the stock, even with the count', /no usable car/.test(removalRefusal(planSync([], stock), stock, 29) ?? ''))

// ── Photos ──
const o = orderPhotos(['10.jpg', '2.JPG', '1.jpeg', '3.webp'])
check('photos: numeric order, 1 is the cover', o.files.join() === '1.jpeg,2.JPG,3.webp,10.jpg' && !o.problems.length, o)
check('photos: HEIC, names and duplicates are problems', orderPhotos(['1.heic', 'cover.jpg', '1.jpg', '01.png']).problems.length === 3, orderPhotos(['1.heic', 'cover.jpg', '1.jpg', '01.png']))

// ── The committed dealer data ──
for (const slug of readdirSync(resolve(ROOT, 'data/dealers'))) {
  const dir = resolve(ROOT, 'data/dealers', slug)
  if (!existsSync(resolve(dir, 'cars.csv'))) continue
  const text = readFileSync(resolve(dir, 'cars.csv'), 'utf8')
  const dealer = JSON.parse(readFileSync(resolve(dir, 'dealer.json'), 'utf8'))
  check(`${slug}: no link and no source-site name anywhere in the data`, !/https?:|www\.|kktcarabam/i.test(text + JSON.stringify(dealer)))
  check(`${slug}: dealer.json has consent and never is_active`, /^\d{4}-\d{2}-\d{2}$/.test(dealer.consent_date) && !!dealer.consent_note && !('is_active' in dealer) && dealer.slug === slug)
  const cars = parseCsv(text).map(mapCar)
  check(`${slug}: every row has a unique reference and no contact detail`, new Set(cars.map(c => c.ref)).size === cars.length && cars.every(c => !c.flags.some(f => f.includes('contact'))))
  if (slug === 'mustafa-ustuner-otomotiv') {
    const skipped = cars.filter(c => !c.row)
    check('Mustafa Üstüner: 30 rows; only 190595 (no km) waits', cars.length === 30 && skipped.length === 1 && skipped[0].ref === '190595' && skipped[0].problems.join() === 'km is missing', skipped)
    check('Mustafa Üstüner: the five FİYAT FARKLI rows are flagged', cars.filter(c => c.flags.some(f => f.startsWith('FİYAT FARKLI'))).map(c => c.ref).join() === '269886,269358,261802,202349,190595')
  }
}

// The importer never activates a dealer and never stores a source link.
const imp = readFileSync(resolve(ROOT, 'scripts/import-dealer-cars.mjs'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n')
check('importer: writes no is_active and no source_url', !/is_active\s*:\s*(true|false)/.test(imp) && !imp.includes('source_url'))

console.log(bad ? `dealer import: ${bad} FAILED` : 'dealer import: OK')
process.exit(bad ? 1 : 0)

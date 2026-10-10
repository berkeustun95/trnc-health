// Offline self-test for the Duyurular fetcher (node scripts/fetch-duyurular.mjs --selftest).
// Runs in CI before any network call. Each case pins one behaviour a past probe showed matters.

import { trLower, parseListingDate, titleKey } from './lib/text.mjs'
import { extractDeadline } from './lib/deadline.mjs'
import { parseFeed, looksLikeFeed } from './lib/rss.mjs'
import { parseRobots, robotsAllows, canonicalUrl } from './lib/http.mjs'
import { passesFilter, kindOf, categoryOf } from './lib/classify.mjs'
import { mainText, pdfLinks } from './lib/page.mjs'
import { SOURCES } from './sources.mjs'
import { PARSERS } from './lib/parsers.mjs'

export async function runSelftest() {
  let bad = 0
  const t = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want)
    if (!ok) bad++
    console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
  }

  console.log('Turkish casefold (the runner ICU must do tr-TR)')
  t('İHALE → ihale', trLower('İHALE'), 'ihale')
  t('SINAV → sınav', trLower('SINAV'), 'sınav')
  t('İLAN keeps its keyword', passesFilter('GİRNE BELEDİYESİ MAL ALIMI İHALE DUYURUSU', { filter_mode: 'keywords' }).keep, true)

  console.log('Deadlines (now = 2026-10-10, published 2026-10-06)')
  const now = new Date('2026-10-10T09:00:00Z'), published = new Date('2026-10-06T00:00:00Z')
  const d = s => { const r = extractDeadline(s, { published, now }); return r.date ? r.date.toISOString().slice(0, 10) : r.status }
  t('son başvuru tarihi 22 Ekim 2026', d('Son başvuru tarihi 22 Ekim 2026'), '2026-10-22')
  t('SON BAŞVURU TARİHİ: 22.10.2026', d('SON BAŞVURU TARİHİ: 22.10.2026'), '2026-10-22')
  t('…mesai bitimine kadar, başvurular', d('Başvurular 22 Ekim 2026 Perşembe günü mesai bitimine kadar yapılabilir.'), '2026-10-22')
  t('teklifler … saat 10:00’a kadar', d('Teklifler 15.10.2026 saat 10:00’a kadar verilmelidir.'), '2026-10-15')
  t('son teklif verme tarihi (Mücahitler title)', d('T414951- FULAR KIRMIZI TEDARİKİ -Son teklif verme tarihi : 15.10.2026'), '2026-10-15')
  t('KHK window end (in range)', d('yapılacak başvurular, 6 Ekim 2026 - 30 Ekim 2026 (her iki tarih dahil) tarihleri arasında'), '2026-10-30')
  t('KHK window end beyond 180 days → null', d('yapılacak başvurular, 6 Ekim 2026 - 13 Mayıs 2027 (her iki tarih dahil) tarihleri arasında'), 'too_far')
  t('legal transition date + "başvuran" → null', d('31 Aralık 2026 tarihine kadar münhal ilan edilen ve edilecek olan kadrolara başvuran adaylara'), 'none')
  t('registration range without deadline wording → null', d('Kayıtlar 5-15 Ekim’de'), 'none')
  t('past deadline → null', d('Son başvuru tarihi 1 Ocak 2026'), 'past')
  t('two different deadlines → null', d('Son başvuru 20 Ekim 2026. Son teklif 25.10.2026'), 'ambiguous')
  t('no year → next occurrence', d('Son başvuru: 22 Ekim'), '2026-10-22')
  t('başvuru tarihleri: 7, 8 ve 9 Ekim → last day', d('Başvuru tarihleri: 12, 13 ve 14 Ekim 2026'), '2026-10-14')
  t('başvuru tarihi: single day', d('Başvuru tarihi: 20.10.2026'), '2026-10-20')
  t('sale date is not a deadline', d('Satış Tarihi ve Yeri: 26/10/2026 Cumartesi günü saat 08:30'), 'none')
  t('31.02 is not a date', d('Son başvuru 31.02.2027'), 'none')

  console.log('Feeds')
  const rss = `<?xml version="1.0"?><rss><channel><item><title><![CDATA[GELİR VE VERGİ DAİRESİ MÜNHAL DUYURUSU]]></title>
    <link>https://khk.gov.ct.tr/ARŞİV/HABERLER/x-99</link><pubDate>Tue, 06 Oct 2026 07:41:00 GMT</pubDate>
    <description>&lt;p&gt;Son başvuru &amp;amp; tarih&lt;/p&gt;</description></item>
    <item><title>Akademik M&#252;nhal &#8211; İşletme</title><link>https://akun.edu.tr/a/?utm_source=rss#x</link></item></channel></rss>`
  t('looks like a feed', looksLikeFeed(rss), true)
  const items = parseFeed(rss, 'https://khk.gov.ct.tr/')
  t('2 items', items.length, 2)
  t('CDATA title', items[0].title, 'GELİR VE VERGİ DAİRESİ MÜNHAL DUYURUSU')
  t('double-encoded description', items[0].description, 'Son başvuru & tarih')
  t('numeric entities', items[1].title, 'Akademik Münhal – İşletme')
  t('pubDate', items[0].published?.toISOString(), '2026-10-06T07:41:00.000Z')
  t('canonical url drops utm + fragment', canonicalUrl(items[1].url), 'https://akun.edu.tr/a/')
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Call for proposals</title><link rel="alternate" href="/x"/><updated>2026-10-01T10:00:00Z</updated></entry></feed>`
  t('atom entry', parseFeed(atom, 'https://e.eu/').map(i => i.url), ['https://e.eu/x'])

  console.log('robots.txt')
  const dnn = parseRobots('User-agent: *\nDisallow: /admin/\nDisallow: /Portals/\nUser-agent: msnbot\nDisallow: /')
  t('DNN: /Portals/ PDF disallowed', robotsAllows(dnn, 'https://khk.gov.ct.tr/Portals/29/Genelgeler/mia32_2026.pdf?ver=1'), false)
  t('DNN: article page allowed', robotsAllows(dnn, 'https://khk.gov.ct.tr/AR%C5%9E%C4%B0V/HABERLER/x'), true)
  const emu = parseRobots('User-agent: *\nDisallow: /*&p=*\nUser-agent: Barkrowler\nDisallow: *\nUser-agent: Yandex\nDisallow: /')
  t('EMU: other agents\' "Disallow: /" does not apply to us', robotsAllows(emu, 'https://www.emu.edu.tr/duyurular'), true)
  t('EMU: wildcard rule applies', robotsAllows(emu, 'https://www.emu.edu.tr/x?a=1&p=2'), false)
  t('crawl-delay read', parseRobots('User-agent: *\nCrawl-delay: 15\n').delay, 15)

  console.log('Classification')
  t('ziyaret dropped even in all mode', passesFilter('BAŞKAN ULUÇAY’A ZİYARET', { filter_mode: 'all' }).keep, false)
  t('DİBS dropped for the Central Bank', passesFilter('Devlet İç Borçlanma Senedi (DİBS) İhale Sonuçları Hakkında Duyuru', SOURCES.find(s => s.key === 'merkez-bankasi')).keep, false)
  t('news headline dropped in keywords mode', passesFilter('LAÜ’de Oryantasyon Günleri', { filter_mode: 'keywords' }).keep, false)
  t('karar ilanı = result', kindOf('1 ADET PICK-UP 4X4 ARAÇ ALIM İHALESİ KARAR İLANI 36-2026'), 'result')
  t('münhal = open', kindOf('LİMANLAR DAİRESİ MÜNHAL DUYURUSU'), 'open')
  t('belediye ihale → ihale', categoryOf('SAKARYA KENT MEYDANI İHALE DUYURUSU', { category: 'belediye' }), 'ihale')
  t('belediye asfalt → kesinti', categoryOf('GAZİ MUSTAFA KEMAL BULVARI’NDA ASFALT ÇALIŞMASI', { category: 'belediye' }), 'kesinti')
  t('title key', titleKey('Ustalık ve Kalfalık Belgesi — Sınav Kayıtları 5-15 Ekim’de…'), 'ustalık ve kalfalık belgesi sınav kayıtları 5 15 ekim de')
  t('listing date 8 Ekim 2026', parseListingDate('8 Ekim 2026')?.toISOString(), '2026-10-07T21:00:00.000Z')
  t('listing date 02.10.2026', parseListingDate('02.10.2026')?.toISOString(), '2026-10-01T21:00:00.000Z')

  console.log('Detail pages')
  const page = `<html><body><nav>Son başvuru 12.10.2026</nav><article><h1>X</h1><p>Son başvuru tarihi 20.10.2026</p>
    <a href="/Portals/1/x.pdf?ver=1">ek</a></article><aside><a href="/other.pdf">o</a></aside></body></html>`
  const elem = `<div class="elementor-widget elementor-widget-theme-post-content"><div class="elementor-widget-container"><p>Teklifler 20.10.2026 tarihine kadar kabul edilir.</p></div></div><div class="sidebar">Son başvuru 11.10.2026</div>`
  t('Elementor page keeps its content', /20\.10\.2026/.test(mainText(`<article>${elem}</article>`)), true)
  t('region stops at a sidebar', /11\.10\.2026/.test(mainText(`<article>${elem}</article>`)), false)
  t('main text skips the nav', /12\.10/.test(mainText(page)), false)
  t('pdf links from the article only', pdfLinks(page, 'https://a.gov.ct.tr/n/1'), ['https://a.gov.ct.tr/Portals/1/x.pdf?ver=1'])

  console.log('Registry')
  const keys = SOURCES.map(s => s.key)
  t('keys unique', new Set(keys).size, keys.length)
  t('every key matches the DB CHECK', keys.filter(k => !/^[a-z0-9][a-z0-9-]{1,59}$/.test(k)), [])
  t('every html/json/ted source has a parser', SOURCES.filter(s => s.type !== 'rss' && !PARSERS[s.parser]).map(s => s.key), [])
  t('no dropped source came back', keys.filter(k => /eul|arucad|basbakanlik|tatlisu|kttb|ktmmob|meteor|gazimagusa-haberler/.test(k)), [])
  t('no kibrisduyuru anywhere', SOURCES.filter(s => /kibrisduyuru/i.test(s.url)).length, 0)
  const CATS = ['kamu', 'egitim', 'kesinti', 'ihale', 'belediye', 'destek', 'ulasim'], REGS = ['all', 'lefkosa', 'girne', 'gazimagusa', 'guzelyurt', 'iskele', 'lefke']
  t('categories/regions inside the CHECKs', SOURCES.filter(s => !CATS.includes(s.category) || !REGS.includes(s.region)).map(s => s.key), [])

  console.log(bad ? `\n✗ ${bad} self-test failure(s).` : '\n✓ self-test clean.')
  return bad ? 1 : 0
}

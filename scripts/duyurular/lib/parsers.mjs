// HTML / JSON listing parsers, one per site family. Each takes the listing response and the
// source and returns [{ title, url, published (Date|null), description?, deadlineText?,
// apiDeadline?, truncated?, keepHash? }].
//
// A parser THROWS when the page no longer has the structure it expects (a redesign = a failing
// source, reported), and returns [] when the structure is there but lists nothing (a
// municipality with no open tender is not an error). Markup measured 2026-10-10.

import { htmlToText, oneLine, decodeEntities, parseListingDate } from './text.mjs'

const clean = html => html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
const textOf = s => oneLine(htmlToText(s))
const abs = (href, base) => { try { return new URL(decodeEntities(href), base).href } catch { return null } }
const truncatedTitle = t => /(\.\.\.|…)\s*$/.test(t)

function requireMarker(html, re, what) {
  if (!re.test(html)) throw new Error(`structure changed: ${what} not found`)
}

// ─── the generic card engine ────────────────────────────────────────────────
// cfg.href    RegExp tested on the absolute URL: which links are items
// cfg.marker  RegExp that must be present (structure check); cfg.from / cfg.to: listing region
// cfg.title   'heading' (h1-h6 inside the link) | 'text' (default) | 'attr' (title=)
// cfg.date    'inner' | 'after' (default: card segment after the link) | 'before' | 'none'
// cfg.strip   RegExp removed from the title (labels, emoji, leading dates)
// cfg.titleFrom 'before': the link says "LEARN MORE" / "Detaylar"; the title is the nearest heading or <strong> above it
function cards(res, cfg) {
  let html = clean(res.text)
  if (cfg.marker) requireMarker(html, cfg.marker, cfg.markerName || String(cfg.marker))
  if (cfg.from) { const i = html.search(cfg.from); if (i >= 0) html = html.slice(i) }
  if (cfg.to) { const i = html.search(cfg.to); if (i > 0) html = html.slice(0, i) }
  const links = []
  for (const m of html.matchAll(/<a\s[^>]*?href\s*=\s*["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = abs(m[1], res.url)
    if (!url || !cfg.href.test(url)) continue
    const attr = (m[0].match(/\stitle\s*=\s*["']([^"']{6,})["']/i) || [])[1]
    const heading = (m[2].match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i) || [])[1]
    let title = cfg.title === 'heading' ? textOf(heading || '') : cfg.title === 'attr' ? oneLine(decodeEntities(attr || '')) : ''
    if (!title) title = textOf(heading || m[2]) || oneLine(decodeEntities(attr || ''))
    if (cfg.titleFrom === 'before') {
      const pre = html.slice(Math.max(0, m.index - 2500), m.index)
      const hs = [...pre.matchAll(/<(h[1-6]|strong)[^>]*>([\s\S]*?)<\/\1>/gi)]
      if (hs.length) title = textOf(hs[hs.length - 1][2])
    }
    if (cfg.strip) title = oneLine(title.replace(cfg.strip, ' '))
    links.push({ url, title, inner: m[2], start: m.index, end: m.index + m[0].length })
  }
  const byUrl = new Map()
  links.forEach((l, i) => {
    let seg = ''
    if (cfg.date === 'inner') seg = l.inner
    else if (cfg.date === 'before') seg = html.slice(Math.max(i ? links[i - 1].end : 0, l.start - 1500), l.start)
    else if (cfg.date !== 'none') seg = html.slice(l.start, Math.min(l.end + 1500, links[i + 1]?.start ?? html.length))
    const published = seg ? parseListingDate(textOf(seg)) : null
    const prev = byUrl.get(l.url)
    if (!prev || l.title.length > prev.title.length) byUrl.set(l.url, { title: l.title, url: l.url, published: published || prev?.published || null })
    else if (!prev.published && published) prev.published = published
  })
  return [...byUrl.values()].filter(it => it.title.length >= 6).map(it => ({ ...it, truncated: truncatedTitle(it.title) }))
}

// ─── EasyDNN News (*.gov.ct.tr DNN sites without a usable feed) ─────────────
function easydnn(res) {
  return cards(res, {
    marker: /article_list_wrapper/i, markerName: 'EasyDNN article_list_wrapper',
    from: /article_list_wrapper/i,
    to: /<footer[\s>]|edn_pagination|class=["'][^"']*\bpagination/i,
    href: /\.gov\.ct\.tr\/[^?#]+\/(?!rss|tag|category|author|archive)[^/?#]*[a-z0-9%-]{12,}$/i,
    title: 'heading',
  })
}

// ─── Joomla K2 municipal tender page (Erenköy-Karpaz, Geçitkale-Serdarlı, Yeniboğaziçi,
//     Güzelyurt): the main column's list only. The sidebar's "Sonuçlanan / İptal Edilen" lists
//     are history and are NOT read.
function joomlaihale(res) {
  const html = clean(res.text)
  requireMarker(html, /itemList|k2Container|k2ItemsBlock|catItem/i, 'K2 item list')
  const main = html.split(/<aside[\s>]|id=["']?gkSidebar/i)[0]
  return cards({ ...res, text: main }, { href: /\/item\/\d+-[^/?#]+\.html$/i, date: 'after' })
}

// ─── DAÜ tender portal: ASP.NET DataList rows with postback links and no per-item URL, so each
//     row links to the listing with its tender number as a fragment. "İHALE KAPANIŞ TARİHİ" is a
//     structured closing date → apiDeadline.
function emuihale(res) {
  const html = res.text.replace(/&nbsp;/g, ' ')
  requireMarker(html, /İHALE KAPANIŞ TARİHİ/i, 'İHALE KAPANIŞ TARİHİ column')
  const rows = html.split(/<a id="ctl00_ContentPlaceHolder1_DataList2_ctl\d+_LinkButton2"/i).slice(1)
  return rows.map(r => {
    const t = textOf(r.slice(r.indexOf('>') + 1))
    const m = t.match(/^(\d{3,6})\s*-\s*(.+?)\s+[\d.,]+\s*(?:TL|USD|EUR|STG|€|\$)\b.*?(\d{4})-(\d{2})-(\d{2})\s+\d{2}:\d{2}/)
    if (!m) return null
    const [, no, title, y, mo, d] = m
    return { title: oneLine(`${no} - ${title}`), url: `${res.url.split('#')[0]}#${no}`, keepHash: true, published: null,
      apiDeadline: new Date(Date.UTC(+y, +mo - 1, +d, 20, 59, 59)) }
  }).filter(Boolean)
}

// ─── SSD: <a class="haber"> cards with .baslik (title) and .tarih ("1 Ağu 2026") ───
function ssd(res) {
  const html = clean(res.text)
  requireMarker(html, /class=["']?haber/i, 'a.haber cards')
  return [...html.matchAll(/<a[^>]+href=["']?([^"'\s>]+)["']?[^>]*class=["']?haber["']?[^>]*>([\s\S]*?)<\/a>/gi)].map(m => {
    const title = textOf((m[2].match(/class=["']?baslik["']?[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '')
    const date = textOf((m[2].match(/class=["']?tarih["']?[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '')
    return { title, url: abs(m[1], res.url), published: parseListingDate(date) }
  }).filter(i => i.title && i.url)
}

// ─── Evkaf: .ihale-item cards; "Son Katılım Tarihi" is a labelled deadline. Items badged
//     "Süresi Geçti" (expired) are skipped. Each item's only link is its PDF.
function evkaf(res) {
  const html = clean(res.text)
  requireMarker(html, /ihale-item/i, '.ihale-item cards')
  return html.split(/<div class=["']?ihale-item[\s"']/i).slice(1).map(card => {
    if (/Süresi Geçti/i.test(card)) return null
    const title = textOf((card.match(/class=["']?ihale-baslik["']?[^>]*>([\s\S]*?)<\/h\d>/i) || [])[1] || '')
    const href = (card.match(/href=["']?([^"'\s>]+\.pdf)/i) || [])[1]
    const d = parseListingDate(textOf((card.match(/Son Katılım Tarihi[\s\S]{0,200}?class=["']?tarih-text["']?[^>]*>([^<]+)/i) || [])[1] || ''))
    return title && href ? { title, url: abs(href, res.url), published: null, apiDeadline: d ? new Date(d.getTime() + (24 * 3600 - 1) * 1000) : null } : null
  }).filter(Boolean)
}

// ─── TED (EU): notices for the Turkish Cypriot community aid programme ──────
// Titles come as "Belgium – <CPV label> – <title>"; the part after the second dash is the title.
async function tedFetch(politeFetch) {
  const since = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10).replace(/-/g, '')
  const body = { query: `FT~"Turkish Cypriot community" AND publication-date>=${since}`, limit: 50, page: 1,
    fields: ['publication-number', 'notice-title', 'publication-date', 'deadline-receipt-tender-date-lot'] }
  const res = await politeFetch('https://api.ted.europa.eu/v3/notices/search', { kind: 'listing', method: 'POST', body })
  if (res.status !== 200 || !res.json) return res
  return { ...res, items: (res.json.notices || []).map(n => {
    const num = n['publication-number']
    const raw = n['notice-title']?.eng || ''
    const parts = raw.split(' – ')
    const title = oneLine(parts.length >= 3 ? parts.slice(2).join(' – ') : raw)
    const deadlines = [].concat(n['deadline-receipt-tender-date-lot'] || [])
      .map(s => new Date(String(s).slice(0, 10) + 'T20:59:59Z')).filter(d => !isNaN(d))
    return { title, url: `https://ted.europa.eu/en/notice/-/detail/${num}`,
      published: n['publication-date'] ? new Date(String(n['publication-date']).slice(0, 10) + 'T00:00:00Z') : null,
      apiDeadline: deadlines.sort((a, b) => b - a)[0] || null }
  }).filter(i => i.title && i.url) }
}

const PARSERS = {
  easydnn,
  joomlaihale,
  emuihale,
  ted: Object.assign(res => res.items || [], { fetch: tedFetch }),

  polis: res => cards(res, { marker: /duyuru-detay-\d+\.html/i, markerName: 'duyuru-detay links', href: /duyuru-detay-\d+\.html$/i }),
  ssd,
  asbu: res => cards(res, { marker: /\/tr\/duyuru\//, markerName: '/tr/duyuru/ links', href: /\/tr\/duyuru\/[^/?#]+$/ }),
  emu: res => cards(res, { marker: /\/haberler\/duyurular\//, markerName: '/haberler/duyurular/ links', href: /\/tr\/haberler\/duyurular\/[^/?#]+\/\d+\/pid\/\d+/, date: 'before' }),
  gau: res => cards(res, { marker: /\/duyuru\/\d+\//, markerName: '/duyuru/<id>/ links', href: /gau\.edu\.tr\/duyuru\/\d+\/[^/?#]+$/, title: 'heading', date: 'inner' }),
  gonyeli: res => cards(res, { marker: /\/duyurular\//, markerName: '/duyurular/ links', href: /gonyelibelediyesi\.org\/duyurular\/[^/?#]+$/, date: 'inner',
    title: 'heading', strip: /^\W*(?:ihale|duyuru)\s+\d{1,2}\s+\S+\s+\d{4}\s*/i }),
  mucahit: res => cards(res, { marker: /\/Sayfa\/IhaleDetay\//, markerName: 'IhaleDetay links', href: /\/Sayfa\/IhaleDetay\/[\w-]+$/, date: 'none' }),
  kei: res => cards(res, { marker: /\/haberler\//, markerName: '/haberler/ links', href: /kei\.gov\.tr\/haberler\/[^/?#]+$/, title: 'heading', date: 'before' }),
  lac: res => cards(res, { marker: /ihale\//, markerName: 'ihale/ links', href: /lacbelediyesi\.org\/ihale\/[^/?#]+$/ }),
  // The listing shows one fixed date for every card (measured: 2023-04-29 on all 90), so the date
  // comes from each item's page.
  degirmenlik: res => cards(res, { marker: /\/ihaleler\/[^"'\s]+\//, markerName: '/ihaleler/<slug>/ links', href: /degirmenlikakincilar\.org\/ihaleler\/[^/?#]+\/?$/, title: 'heading', date: 'none' }),
  evkaf,
  lefkeihale: res => cards(res, { marker: /ihale-duyurulari\/[^"'\s]+/, markerName: '/ihale-duyurulari/<slug>/ links', href: /lefkebelediyesi\.com\/ihale-duyurulari\/[^/?#]+\/?$/ }),
  euburs: res => cards(res, { marker: /LEARN MORE/i, markerName: 'LEARN MORE cards', href: /euburs\.eu\/announcement\/\d+$/i, titleFrom: 'before', date: 'before' }),
  yobis: res => cards(res, { marker: /\/haberler\//, markerName: '/haberler/ links', href: /yobis\.mebnet\.net\/haberler\/[^/?#]+$/i, titleFrom: 'before' }),
}

export { PARSERS, cards }

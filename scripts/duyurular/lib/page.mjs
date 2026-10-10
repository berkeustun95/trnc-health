// Detail-page helpers. A deadline read from a page's sidebar ("Son duyurular": another notice's
// "son başvuru") would be attributed to the wrong item, so deadline text comes from the main
// content region only, and the whole body is used only once header/nav/footer/aside are removed.

import { htmlToText, decodeEntities, oneLine, parseListingDate } from './text.mjs'

// Most specific first: an <article> often opens with a <footer class="entry-meta"> that would
// end the region before the body (AKUN, 2026-10-10).
const MAIN_MARKERS = [
  /class=["'][^"']*\b(?:edn_articleContent|edn_article|entry-content|post-content|article-content|field--name-body|node__content|news-detail|haber-detay|content-detail|single-content|item-page|blog-detail|detail-content)\b/i,
  /<article[\s>]/i,
  /<main[\s>]/i,
  /id=["'](?:content|main|main-content|dnn_ContentPane)["']/i,
]
const REGION = 30_000

export function mainContentHtml(html) {
  for (const re of MAIN_MARKERS) {
    const m = re.exec(html)
    if (!m) continue
    // From the start of the tag carrying the marker, never from inside an attribute.
    const start = html.lastIndexOf('<', m.index)
    const region = html.slice(start, start + REGION)
    // Whole class tokens only: Elementor puts "elementor-widget" on every block, and a substring
    // match cut WordPress pages to nothing (measured 2026-10-10: Girne 4 chars).
    const end = region.slice(1).search(/<\/article>|<aside[\s>]|<footer[\s>]|class=["'](?:[^"']*\s)?(?:sidebar|widget-area|related-posts|yarpp-related)(?:\s[^"']*)?["']/i)
    return end >= 0 ? region.slice(0, end + 1) : region
  }
  return html
    .replace(/<(header|nav|footer|aside)[\s>][\s\S]*?<\/\1>/gi, ' ')
    .replace(/^[\s\S]*?<body[^>]*>/i, '')
}

export const mainText = html => htmlToText(mainContentHtml(html))

export function metaDescription(html) {
  const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']{20,})["']/i)
    || html.match(/<meta[^>]+content=["']([^"']{20,})["'][^>]+(?:property|name)=["'](?:og:description|description)["']/i)
  return m ? oneLine(decodeEntities(m[1])) : null
}

// Title of a detail page, for listing titles the site truncated ("…").
export function pageTitle(html) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{6,})["']/i)
  if (og) return oneLine(decodeEntities(og[1]))
  const h1 = mainContentHtml(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  return h1 ? oneLine(htmlToText(h1[1])) : null
}

// Publication date of a detail page, for listings that show none: article:published_time,
// a <time datetime>, or the first listing-style date at the top of the main content.
export function pageDate(html) {
  const meta = html.match(/<meta[^>]+(?:property|name)=["'](?:article:published_time|datePublished|date)["'][^>]+content=["']([^"']+)["']/i)
  const time = html.match(/<time[^>]+datetime=["']([^"']+)["']/i)
  for (const v of [meta?.[1], time?.[1]]) { const d = v && new Date(v); if (d && !isNaN(d)) return d }
  return parseListingDate(mainText(html).slice(0, 600))
}

export function pdfLinks(html, baseUrl, limit = 2) {
  const region = mainContentHtml(html)
  const out = []
  for (const m of region.matchAll(/href=["']([^"']+?\.pdf(?:\?[^"']*)?)["']/gi)) {
    try {
      const u = new URL(decodeEntities(m[1]), baseUrl).href
      if (!out.includes(u)) out.push(u)
    } catch { /* skip malformed */ }
    if (out.length >= limit) break
  }
  return out
}

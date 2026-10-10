// RSS 2.0 / RDF / Atom → [{ title, url, published, description }]. Hand-rolled on purpose: one
// approved dependency (unpdf) for this fetcher. Tested against the 2026-10-10 source bodies.

import { stripCdata, decodeEntities, htmlToText, oneLine, parseFeedDate } from './text.mjs'

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? stripCdata(m[1]) : ''
}

export function looksLikeFeed(body) {
  return /<rss[\s>]|<feed[\s>]|<rdf:RDF/i.test(body.slice(0, 4000))
}

export function parseFeed(body, baseUrl) {
  const items = []
  const isAtom = /<feed[\s>]/i.test(body.slice(0, 4000)) && !/<rss[\s>]/i.test(body.slice(0, 4000))
  const blocks = isAtom ? body.match(/<entry[\s>][\s\S]*?<\/entry>/gi) : body.match(/<item[\s>][\s\S]*?<\/item>/gi)
  for (const b of blocks || []) {
    const title = oneLine(htmlToText(decodeEntities(tag(b, 'title'))))
    let link = ''
    if (isAtom) {
      const alt = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || b.match(/<link[^>]*href=["']([^"']+)["']/i)
      link = alt ? alt[1] : ''
    } else {
      link = oneLine(tag(b, 'link')) || oneLine(tag(b, 'guid'))
    }
    link = decodeEntities(link)
    const published = parseFeedDate(tag(b, 'pubDate') || tag(b, 'dc:date') || tag(b, 'published') || tag(b, 'updated'))
    const description = htmlToText(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded') || tag(b, 'content'))
    if (!title || !link) continue
    let url
    try { url = new URL(link, baseUrl).href } catch { continue }
    items.push({ title, url, published, description })
  }
  return items
}

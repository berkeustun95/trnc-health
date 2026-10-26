// ─── Duyurular: is a paused source back? (read-only) ─────────────────────────
//
//   node scripts/check-duyurular-paused.mjs                 every active:false source in sources.mjs
//   node scripts/check-duyurular-paused.mjs --keys=a,b      these keys, active or not (positive control)
//   options: --out=path.txt   one line per source that is back: "<key>\t<name>"
//
// "Back" = the listing answers HTTP 200 AND the source's own parser finds at least one item, so a
// 200 error page or a redesigned site does not count. Same polite client as the fetcher (robots.txt,
// Crawl-delay, the same CA additions). Writes nothing to the database and never reactivates a
// source: reactivating is a reviewed edit of sources.mjs. Run weekly by duyurular-paused-recheck.
//
// ⚠ THE REPO IS PUBLIC, SO ITS ACTION LOGS ARE: stdout carries keys, HTTP codes and counts only.

import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const opt = n => (args.find(a => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=') || null
const unknown = args.filter(a => !/^--(keys|out)=.+$/.test(a))
if (unknown.length) { console.error(`Unknown argument(s): ${unknown.join(' ')} — refusing to run.`); process.exit(2) }

const { SOURCES } = await import('./duyurular/sources.mjs')
const { politeFetch, declareDelay } = await import('./duyurular/lib/http.mjs')
const { parseFeed, looksLikeFeed } = await import('./duyurular/lib/rss.mjs')
const { PARSERS } = await import('./duyurular/lib/parsers.mjs')
const { errorClass } = await import('./duyurular/lib/runhealth.mjs')

const keys = opt('keys') ? opt('keys').split(',') : null
const missing = keys ? keys.filter(k => !SOURCES.some(s => s.key === k)) : []
if (missing.length) { console.error(`No such source: ${missing.join(', ')}`); process.exit(2) }
const targets = SOURCES.filter(s => keys ? keys.includes(s.key) : s.active === false)

async function check(src) {
  declareDelay(src.url, src.crawl_delay_s)
  try {
    const res = src.type === 'ted' ? await PARSERS.ted.fetch(politeFetch)
      : await politeFetch(src.url, { kind: 'listing', json: src.type === 'json' })
    if (res.blocked) return { http: null, items: 0, why: 'robots_blocked' }
    if (res.status !== 200) return { http: res.status, items: 0, why: `HTTP ${res.status}` }
    let items
    if (src.type === 'rss') {
      if (!looksLikeFeed(res.text)) return { http: 200, items: 0, why: 'not a feed' }
      items = parseFeed(res.text, res.url)
    } else items = await PARSERS[src.parser](res, src)
    return { http: 200, items: items.length, why: items.length ? null : 'parsed 0 items' }
  } catch (e) {
    return { http: null, items: 0, why: errorClass(e) }
  }
}

console.log(`── paused Duyurular sources: ${targets.length} checked ──`)
const back = []
for (const src of targets) {
  const r = await check(src)
  const up = r.http === 200 && r.items > 0
  if (up) back.push(src)
  console.log(`  ${src.key.padEnd(24)} ${up ? 'BACK' : 'down'}  http=${r.http ?? '-'} items=${r.items}${r.why ? `  (${r.why})` : ''}`)
}
if (opt('out')) writeFileSync(opt('out'), back.map(s => `${s.key}\t${s.name}\n`).join(''))
console.log(back.length ? `back: ${back.map(s => s.key).join(', ')}` : 'none back')

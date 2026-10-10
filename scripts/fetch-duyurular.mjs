// ─── Duyurular fetcher: official TRNC announcements → public.announcements ───
//
//   node scripts/fetch-duyurular.mjs                 dry run: fetch + parse everything, write nothing
//   node scripts/fetch-duyurular.mjs --apply         write (GitHub Actions only: duyurular-fetch)
//   node scripts/fetch-duyurular.mjs --selftest      offline tests
//   options: --only=key1,key2  --report=path.json  --force (ignore fetch intervals)  --no-detail
//
// Plan: vault 10-ada/2026-10-10_duyurular-plan.md. Sources: scripts/duyurular/sources.mjs.
//
// Per source: listing → parse → filter (per-source filter_mode, Turkish casefold) → dedupe on
// official_url (+ near-duplicate titles across sites) → for each NEW item without a deadline in
// its feed text: one page fetch, and for ihale/kamu items the linked PDF (deadline option C).
// Only the parsed date is kept; page and PDF text never leave this process.
//
// Politeness: one serial queue per host with its robots.txt Crawl-delay (lib/http.mjs); robots.txt
// is honoured for every URL, PDFs included. One failing source never stops the others.
//
// ⚠ THIS REPO IS PUBLIC, SO ITS ACTION LOGS ARE PUBLIC. stdout carries counts and source keys
//   only. Titles, URLs and error text go to the --report JSON (a workflow artifact).

import { writeFileSync } from 'node:fs'
import { prodWriteGuard, serviceRoleKey, inCI } from './lib/prod-write-guard.mjs'

const args = process.argv.slice(2)
const flag = n => args.includes(`--${n}`)
const opt = n => (args.find(a => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=') || null
const KNOWN = /^--(apply|selftest|counts|force|no-detail|only=.+|report=.+)$/
const unknown = args.filter(a => !KNOWN.test(a))
if (unknown.length) { console.error(`Unknown argument(s): ${unknown.join(' ')} — refusing to run.`); process.exit(2) }
const APPLY = flag('apply'), SELFTEST = flag('selftest')

prodWriteGuard({ wouldWrite: APPLY && !SELFTEST, workflow: 'duyurular-fetch', dryHint: 'node scripts/fetch-duyurular.mjs' })

const { SOURCES, PDF_CATEGORIES } = await import('./duyurular/sources.mjs')
const { politeFetch, declareDelay, canonicalUrl, stats } = await import('./duyurular/lib/http.mjs')
const { parseFeed, looksLikeFeed } = await import('./duyurular/lib/rss.mjs')
const { PARSERS } = await import('./duyurular/lib/parsers.mjs')
const { passesFilter, kindOf, categoryOf, CATEGORY_RANK } = await import('./duyurular/lib/classify.mjs')
const { extractDeadline } = await import('./duyurular/lib/deadline.mjs')
const { excerptOf, titleKey, oneLine } = await import('./duyurular/lib/text.mjs')
const { mainText, metaDescription, pdfLinks, pageTitle, pageDate } = await import('./duyurular/lib/page.mjs')

// --counts: read back what the database holds (service role: is_published=false rows are
// invisible to every client role, so no other reader can verify a write). Counts only.
if (flag('counts')) {
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL
  if (!url) { console.error('EXPO_PUBLIC_SUPABASE_URL is not set.'); process.exit(1) }
  const ro = createClient(url, serviceRoleKey(), { auth: { persistSession: false } })
  const { data: srcs, error: e1 } = await ro.from('announcement_sources').select('id, key, publish, consecutive_failures, last_ok_at')
  if (e1) { console.error('read announcement_sources:', e1.code); process.exit(1) }
  const rows = []
  let total = null
  for (let from = 0; ; from += 1000) {
    const { data, error, count } = await ro.from('announcements').select('source_id, category, kind, deadline_source, is_published, expires_at', { count: 'exact' })
      .order('id').range(from, from + 999)
    if (error) { console.error('read announcements:', error.code); process.exit(1) }
    total = count; rows.push(...data)
    if (data.length < 1000) break
  }
  if (rows.length !== total) { console.error(`TRUNCATED: received ${rows.length} of ${total} rows`); process.exit(1) }
  const keyOf = new Map(srcs.map(s => [s.id, s.key]))
  const tally = f => rows.reduce((m, r) => (m[f(r)] = (m[f(r)] || 0) + 1, m), {})
  const live = rows.filter(r => new Date(r.expires_at) > new Date())
  console.log(`announcements: ${total} rows (${live.length} unexpired) · is_published=true: ${rows.filter(r => r.is_published).length} · sources: ${srcs.length}, publish=true: ${srcs.filter(s => s.publish).length}`)
  console.log('by category:', JSON.stringify(tally(r => r.category)))
  console.log('by kind:', JSON.stringify(tally(r => r.kind)))
  console.log('deadline_source:', JSON.stringify(tally(r => r.deadline_source ?? 'none')))
  console.log('by source:', JSON.stringify(Object.fromEntries(Object.entries(tally(r => keyOf.get(r.source_id))).sort((a, b) => b[1] - a[1]))))
  const failing = srcs.filter(s => s.consecutive_failures > 0).map(s => `${s.key}(${s.consecutive_failures})`)
  console.log('sources with failures:', failing.length ? failing.join(', ') : 'none')
  process.exit(0)
}

if (SELFTEST) {
  const { runSelftest } = await import('./duyurular/selftest.mjs')
  process.exit(await runSelftest())
}

const NOW = new Date()
const DAY = 864e5
const MAX_AGE_DAYS = 180
const NEAR_DUP_DAYS = 14
const FAILING_AFTER = 6
const only = opt('only') ? new Set(opt('only').split(',')) : null
const DETAIL = !flag('no-detail')

// ─── database (apply only) ──────────────────────────────────────────────────
let db = null
const state = new Map()          // key → announcement_sources row
if (APPLY) {
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL
  if (!url) { console.error('EXPO_PUBLIC_SUPABASE_URL is not set.'); process.exit(1) }
  db = createClient(url, serviceRoleKey(), { auth: { persistSession: false } })
  const cfg = SOURCES.map(s => ({ key: s.key, name: s.name, institution: s.institution, url: s.url, type: s.type, parser: s.parser,
    category: s.category, region: s.region, filter_mode: s.filter_mode, fetch_interval_min: s.fetch_interval_min, crawl_delay_s: s.crawl_delay_s,
    active: s.active !== false, updated_at: NOW.toISOString() }))
  const up = await db.from('announcement_sources').upsert(cfg, { onConflict: 'key' })
  if (up.error) { console.error('source config upsert failed:', up.error.code); process.exit(1) }
  const keys = SOURCES.map(s => s.key)
  const { data: rows, error } = await db.from('announcement_sources').select('*')
  if (error) { console.error('source read failed:', error.code); process.exit(1) }
  for (const r of rows) state.set(r.key, r)
  const retired = rows.filter(r => !keys.includes(r.key) && r.active).map(r => r.key)
  if (retired.length) await db.from('announcement_sources').update({ active: false }).in('key', retired)
}

// ─── per-source run ─────────────────────────────────────────────────────────
const seenUrl = new Map()        // official_url → { category, key }  (this run, across sources)
const seenTitle = new Map()      // title_key → { rank, published, key }

function blankResult(src) {
  return { key: src.key, category: src.category, status: 'ok', http: null, parsed: 0, kept: 0,
    filtered: { drop: 0, source_drop: 0, no_keyword: 0, too_old: 0 }, duplicate_url: 0, near_duplicate: 0, known: 0,
    new: 0, by_kind: { open: 0, result: 0, info: 0 }, by_category: {},
    deadline: { feed: 0, page: 0, pdf: 0, api: 0 }, deadline_status: {},
    requests: { page: 0, pdf: 0 }, pdf: { read: 0, no_text: 0, robots_blocked: 0, not_pdf: 0, failed: 0 },
    page: { robots_blocked: 0, failed: 0 }, enriched: { title: 0, date: 0 }, undated: 0, errors: [], items: [] }
}

async function listingItems(src, row, res) {
  if (src.type === 'rss') {
    if (!looksLikeFeed(res.text)) throw new Error(`not a feed (content-type ${res.contentType || '?'})`)
    return parseFeed(res.text, res.url)
  }
  const parser = PARSERS[src.parser]
  if (!parser) throw new Error(`no parser '${src.parser}'`)
  return parser(res, src)
}

async function fetchListing(src, row) {
  if (src.type === 'ted') return PARSERS.ted.fetch(politeFetch)
  if (src.type === 'json') return politeFetch(src.url, { kind: 'listing', json: true })
  return politeFetch(src.url, { kind: 'listing', etag: row?.etag, lastModified: row?.last_modified })
}

async function deadlineHunt(item, src, r) {
  // 1. feed / listing text
  // A structured deadline (TED, DAÜ portal, Evkaf) obeys the same window as a parsed one.
  if (item.apiDeadline) {
    const days = (item.apiDeadline - NOW) / DAY
    return days >= -1 && days <= 180 ? { date: item.apiDeadline, source: 'api', status: 'found' } : { date: null, status: days < 0 ? 'past' : 'too_far' }
  }
  const fromFeed = extractDeadline(`${item.title}\n${item.description || ''}\n${item.deadlineText || ''}`, { published: item.published, now: NOW })
  if (fromFeed.date) return { date: fromFeed.date, source: 'feed', status: 'found' }
  let last = fromFeed
  // A truncated listing title or a missing date can only come from the page itself.
  const needPage = item.truncated || !item.published
  // TED detail pages are a JS app (HTTP 202 to scripts); its deadline comes from the API.
  if (!DETAIL || src.type === 'ted' || (item.kind === 'result' && !needPage)) return { date: null, status: last.status }

  // 2. the item's own page (once)
  const wantPdf = PDF_CATEGORIES.has(item.category)
  r.requests.page++
  let page
  try { page = await politeFetch(item.url, { kind: 'page', pdf: wantPdf }) }
  catch (e) { r.page.failed++; r.errors.push(`page ${item.url}: ${e.message}`); return { date: null, status: 'page_failed' } }
  if (page.blocked) { r.page.robots_blocked++; return { date: null, status: 'page_robots' } }
  if (page.status !== 200) { r.page.failed++; return { date: null, status: `page_http_${page.status}` } }

  if (page.isPdf) {
    if (!wantPdf) return { date: null, status: 'pdf_not_in_scope' }
    return readPdf(page.bytes, item, r)
  }
  if (!item.description) { const d = metaDescription(page.text); if (d) item.description = d }
  if (item.truncated) { const t = pageTitle(page.text); if (t && t.length > item.title.length - 4) { item.title = t.slice(0, 400); r.enriched.title++ } }
  if (!item.published) { const d = pageDate(page.text); if (d && d <= NOW) { item.published = d; r.enriched.date++ } }
  if (item.kind === 'result') return { date: null, status: 'result' }
  const fromPage = extractDeadline(mainText(page.text), { published: item.published, now: NOW })
  if (fromPage.date) return { date: fromPage.date, source: 'page', status: 'found' }
  last = fromPage

  // 3. linked PDFs, ihale/kamu only
  if (!wantPdf) return { date: null, status: last.status }
  for (const href of pdfLinks(page.text, page.url)) {
    r.requests.pdf++
    let res
    try { res = await politeFetch(href, { kind: 'pdf', pdf: true }) }
    catch (e) { r.pdf.failed++; r.errors.push(`pdf ${href}: ${e.message}`); continue }
    if (res.blocked) { r.pdf.robots_blocked++; continue }
    if (res.status !== 200 || !res.isPdf) { r.pdf.not_pdf++; continue }
    const got = await readPdf(res.bytes, item, r)
    if (got.date) return got
    last = got
  }
  return { date: null, status: last.status }
}

async function readPdf(bytes, item, r) {
  const { pdfText } = await import('./duyurular/lib/pdf.mjs')
  let text
  try { ({ text } = await pdfText(bytes)) }
  catch (e) { r.pdf.failed++; r.errors.push(`pdf parse ${item.url}: ${e.message}`); return { date: null, status: 'pdf_failed' } }
  if (oneLine(text).length < 40) { r.pdf.no_text++; return { date: null, status: 'pdf_no_text' } }
  r.pdf.read++
  const d = extractDeadline(text, { published: item.published, now: NOW })
  return d.date ? { date: d.date, source: 'pdf', status: 'found' } : { date: null, status: d.status }
}

async function runSource(src) {
  const r = blankResult(src)
  const row = state.get(src.key)
  if (APPLY && !flag('force') && row?.last_fetch_at &&
      NOW - new Date(row.last_fetch_at) < src.fetch_interval_min * 60e3) { r.status = 'not_due'; return r }
  declareDelay(src.url, src.crawl_delay_s)
  try {
    const res = await fetchListing(src, row)
    r.http = res.status
    if (res.blocked) { r.status = 'robots_blocked'; return r }
    if (res.status === 304) { r.status = 'not_modified'; r.etag = row?.etag; r.lastModified = row?.last_modified; return r }
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
    r.etag = res.etag || null; r.lastModified = res.lastModified || null
    // HTML listings are newest first. Items older than 180 days are never stored, so an item
    // whose age is only learnt from its page would be re-fetched every run: Değirmenlik lists
    // 90 tenders and cost 70 page requests per run on 2026-10-10. Read the top of the list only.
    const all = await listingItems(src, row, res)
    const raw = src.type === 'html' ? all.slice(0, src.max_items || 30) : all
    r.parsed = raw.length
    // An empty feed is broken; an HTML list with nothing open is not (the parser throws when the
    // page's structure is gone).
    if (!raw.length && src.type === 'rss') throw new Error('parsed 0 items')

    const candidates = []
    for (const it of raw) {
      let url
      try { url = it.keepHash ? it.url : canonicalUrl(it.url, res.url || src.url) } catch { r.errors.push(`bad url ${it.url}`); continue }
      const title = oneLine(it.title).slice(0, 400)
      if (title.length < 3) continue
      if (it.published && NOW - it.published > MAX_AGE_DAYS * DAY) { r.filtered.too_old++; continue }
      const f = passesFilter(title, src)
      if (!f.keep) { r.filtered[f.why]++; continue }
      r.kept++
      const category = categoryOf(title, src)
      const prev = seenUrl.get(url)
      if (prev) {
        r.duplicate_url++
        if (CATEGORY_RANK.indexOf(category) < CATEGORY_RANK.indexOf(prev.category)) prev.category = category
        continue
      }
      const entry = { category, key: src.key }
      seenUrl.set(url, entry)
      candidates.push({ ...it, url, title, category, entry, kind: src.kind || kindOf(title), published: it.published || null })
    }

    let known = new Set()
    if (APPLY && candidates.length) {
      const { data, error } = await db.from('announcements').select('official_url').in('official_url', candidates.map(c => c.url))
      if (error) throw new Error(`known-url read: ${error.code}`)
      known = new Set(data.map(d => d.official_url))
    }

    for (const item of candidates) {
      if (known.has(item.url)) { r.known++; continue }
      const tk = titleKey(item.title)
      const pub = item.published || NOW
      const twin = seenTitle.get(tk)
      if (twin && Math.abs(pub - twin.published) < NEAR_DUP_DAYS * DAY && twin.rank >= src.rank) { r.near_duplicate++; continue }
      if (APPLY) {
        const { data } = await db.from('announcements').select('id').eq('title_key', tk)
          .gte('published_at', new Date(pub - NEAR_DUP_DAYS * DAY).toISOString()).limit(1)
        if (data?.length) { r.near_duplicate++; continue }
      }
      seenTitle.set(tk, { rank: src.rank, published: pub, key: src.key })

      const dl = await deadlineHunt(item, src, r)
      if (item.truncated || !item.published) { item.kind = src.kind || kindOf(item.title); item.entry.category = categoryOf(item.title, src) }
      // A date found on the page can reveal an old item the listing did not date.
      if (item.published && NOW - item.published > MAX_AGE_DAYS * DAY) { r.filtered.too_old++; continue }
      if (!item.published) r.undated++
      const pubFinal = item.published || NOW
      r.deadline_status[dl.status] = (r.deadline_status[dl.status] || 0) + 1
      if (dl.date) r.deadline[dl.source]++
      const expires = dl.date ? new Date(dl.date.getTime() + 30 * DAY) : new Date(pubFinal.getTime() + 60 * DAY)
      r.new++; r.by_kind[item.kind]++
      r.items.push({
        title: item.title, title_key: titleKey(item.title), excerpt: excerptOf(item.description), official_url: item.url,
        institution: src.institution, category: item.entry.category, region: src.region, kind: item.kind,
        published_at: pubFinal.toISOString(), published_known: !!item.published,
        deadline_at: dl.date ? dl.date.toISOString() : null, deadline_source: dl.date ? dl.source : null,
        deadline_status: dl.status, expires_at: expires.toISOString(), expired_on_arrival: expires < NOW,
      })
    }
  } catch (e) {
    r.status = 'failed'
    r.errors.unshift(e.message.slice(0, 300))
  }
  return r
}

// ─── run ────────────────────────────────────────────────────────────────────
const selected = SOURCES.filter(s => s.active !== false && (!only || only.has(s.key)))
if (only && selected.length !== only.size) { console.error('--only names an unknown source key'); process.exit(2) }
const t0 = Date.now()
const results = await Promise.all(selected.map(runSource))
for (const r of results) for (const it of r.items) r.by_category[it.category] = (r.by_category[it.category] || 0) + 1

// ─── writes (apply) ─────────────────────────────────────────────────────────
if (APPLY) {
  for (const r of results) {
    const row = state.get(r.key)
    if (r.items.length) {
      const payload = r.items.map(({ published_known, deadline_status, expired_on_arrival, ...it }) =>
        ({ ...it, source_id: row.id, is_published: row.publish === true }))
      const ins = await db.from('announcements').upsert(payload, { onConflict: 'official_url', ignoreDuplicates: true })
      if (ins.error) { r.status = 'failed'; r.errors.unshift(`insert: ${ins.error.code} ${ins.error.message}`.slice(0, 300)) }
    }
    if (r.status === 'not_due') continue
    const ok = r.status !== 'failed'
    const health = ok
      ? { last_fetch_at: NOW.toISOString(), last_ok_at: NOW.toISOString(), consecutive_failures: 0, last_error: null,
          last_item_count: r.parsed || row.last_item_count, etag: r.etag ?? row.etag, last_modified: r.lastModified ?? row.last_modified }
      : { last_fetch_at: NOW.toISOString(), consecutive_failures: (row.consecutive_failures || 0) + 1, last_error: (r.errors[0] || 'failed').slice(0, 500) }
    const up = await db.from('announcement_sources').update(health).eq('id', row.id)
    if (up.error) console.error(`health write failed for ${r.key}: ${up.error.code}`)
    r.consecutive_failures = ok ? 0 : health.consecutive_failures
  }
}

// ─── report ─────────────────────────────────────────────────────────────────
const sum = (f) => results.reduce((a, r) => a + f(r), 0)
const totals = {
  mode: APPLY ? 'apply' : 'dry', started_at: NOW.toISOString(), seconds: Math.round((Date.now() - t0) / 1000),
  sources: results.length, failed: results.filter(r => r.status === 'failed').length,
  new: sum(r => r.new), with_deadline: sum(r => r.deadline.feed + r.deadline.page + r.deadline.pdf + r.deadline.api),
  deadline: { feed: sum(r => r.deadline.feed), page: sum(r => r.deadline.page), pdf: sum(r => r.deadline.pdf), api: sum(r => r.deadline.api) },
  requests: stats.byKind, bytes: stats.bytes,
}
const reportPath = opt('report')
if (reportPath) writeFileSync(reportPath, JSON.stringify({ totals, results }, null, 2))

console.log(`\nDuyurular ${totals.mode} run — ${totals.sources} sources, ${totals.seconds}s, requests ${JSON.stringify(stats.byKind)}`)
console.log('key'.padEnd(30), 'status'.padEnd(13), 'http parsed kept  new  dl(f/p/pdf/api)  pdf-blocked')
for (const r of results) {
  console.log(r.key.padEnd(30), r.status.padEnd(13), String(r.http ?? '-').padStart(4), String(r.parsed).padStart(6), String(r.kept).padStart(4),
    String(r.new).padStart(4), `  ${r.deadline.feed}/${r.deadline.page}/${r.deadline.pdf}/${r.deadline.api}`.padEnd(17), String(r.pdf.robots_blocked).padStart(6))
}
console.log(`\nnew ${totals.new} · with deadline ${totals.with_deadline} ${JSON.stringify(totals.deadline)} · failed sources ${totals.failed}`)
const failing = results.filter(r => (r.consecutive_failures || 0) >= FAILING_AFTER).map(r => r.key)
if (failing.length) console.log(`FAILING (≥${FAILING_AFTER} consecutive): ${failing.join(', ')}`)
if (inCI() && process.env.GITHUB_STEP_SUMMARY) {
  const lines = [`### Duyurular ${totals.mode} — ${totals.new} new, ${totals.with_deadline} with a deadline, ${totals.failed} failed source(s)`, '',
    '| source | status | parsed | new | deadlines f/p/pdf/api |', '|---|---|---|---|---|',
    ...results.map(r => `| ${r.key} | ${r.status} | ${r.parsed} | ${r.new} | ${r.deadline.feed}/${r.deadline.page}/${r.deadline.pdf}/${r.deadline.api} |`)]
  if (failing.length) lines.push('', `**Failing (≥${FAILING_AFTER} consecutive runs):** ${failing.join(', ')}`)
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n', { flag: 'a' })
}
// A systemic failure (network, DB, a shared parser) fails the job so GitHub emails; one broken
// site does not.
process.exit(totals.failed > Math.max(3, results.length * 0.25) ? 1 : 0)

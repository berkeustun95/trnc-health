#!/usr/bin/env node
// ─── Gişe Kıbrıs ticket_url reachability probe ───────────────────────────────
//
//   node scripts/check-gisekibris-urls.mjs            # report only
//   node scripts/check-gisekibris-urls.mjs --apply    # + null the failures in the seed
//
// Run between prepare-gisekibris-feed.mjs and import-gisekibris-events.mjs.
//
// WHY: ticket_url is the whole point of the round — it is the button that sends our
// users to the partner. A dead link is WORSE than no button: it costs us the user's
// trust and makes the partner look broken. The app hides the button when the value
// is NULL (EventsScreen.js: `event.ticket_url ? … : null`), so nulling a bad URL
// degrades cleanly to exactly the behaviour we shipped with.
//
// Their site is mid-vendor-handover, so a stale or unpublished event page is a
// realistic failure mode regardless of the URLs coming from the partner directly.
//
// SOFT-404s: an unknown id returns a real 404, but on 2026-11-25 a removed event's bare
// slug answered HTTP 200 with the "404 - Sayfa Bulunamadı" page (and 404 minutes later).
// So the status code is not enough on its own: the rendered not-found page counts as
// dead too (lib/gisekibris-page.mjs), alongside the /404 final-URL check.
//
// ─── A LINK THAT OPENS ANOTHER EVENT (2026-11-25) ────────────────────────────
//
// 200 and isCancelled=false do not mean "this row's page". /etkinlikler/<slug>--<id>
// routes on the id and redirects to THAT id's slug, so a wrong id opens another event:
// bir-ihtimal-kabare-7aralik--pTvx… (pTvx borrowed from a repeat session's banner)
// landed on bir-ihtimal-kabare-3. Two checks on a page that resolved:
//   • the landing slug must equal the slug the row's ticket_url names;
//   • if the page carries exactly one id, it must equal the row's external_id.
// The slug check is the one that caught the live case (that page's id WAS the row's
// wrong external_id). Either mismatch is recorded in meta.slug_mismatch, the link is
// nulled under --apply (a wrong ticket page is worse than no button), and the workflow
// lists it in the issue. A genuine slug rename on their side reads the same way and is
// reported the same way; a human decides.
//
// ─── CANCELLATION, AND WHY THE STATUS CODE CANNOT SEE IT ────────────────────
//
// Added 2026-09-20, after this script's blind spot cost a wrong conclusion.
//
// A CANCELLED EVENT KEEPS ITS PAGE AND STILL SERVES 200. Five future-dated rows
// vanished from that week's feed; each of their pages was probed, each returned 200,
// and the honest-looking reading was "still published, so the feed must be partial".
// All five were cancelled. The probe could not have failed on the case it existed to
// detect — a healthy event and a cancelled one print the same three characters — and
// a 404 control proving the site serves real 404s proved nothing about cancellation.
//
// What discriminates is the partner's own flag, inside the JSON payload embedded in
// the page: "isCancelled": true | false. Measured over 53 URLs that day — the 48 feed
// events read false or were silent, the 5 vanished ones read true. No contradictions.
//
// ⚠ THE FIELD IS ABSENT ON ROUGHLY A QUARTER OF PAGES. Seat-map venues render a
//   different, much larger page (~285KB, carrying layoutID) with no isCancelled key
//   at all. ABSENT IS 'unknown', NEVER 'not cancelled'. It is reported separately and
//   counted, because the alternative — folding it into the live count — is precisely
//   the instrument that cannot fail. Absent does not mean cancelled either; it means
//   this tool did not get an answer, and says so.
//
// ⚠ THIS IS WHY THE PROBE IS NOW GET-ONLY. HEAD is cheaper and was tried first, but
//   a HEAD has no body and the flag lives in the body, so a HEAD-first path would
//   verify reachability and silently skip the cancellation question on every page it
//   satisfied. Correctness beats the saved bytes at 48 URLs.
//
// A cancelled event no longer stops the run (Berke, 2026-11-14: one bad item must skip
// only that item). With --apply it is REMOVED from the seed and recorded in
// meta.feed_cancelled, so the import does not touch it, the sweep leaves it alone (no
// automatic cancel), and the workflow lists it in the "Gise Kibris: needs a decision"
// issue, which says whether the event is already live in the app. Without --apply
// (a human reading a report) a cancelled event still exits 1.
//
//   node scripts/check-gisekibris-urls.mjs --selftest   # prove the parser still reads
//                                                       # a known-cancelled page as true

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { isNotFoundPage } from './lib/gisekibris-page.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const seedArg = process.argv.indexOf('--seed')
const SEED_PATH = seedArg !== -1 ? resolve(process.argv[seedArg + 1])
  : resolve(ROOT, 'supabase/seed/gisekibris-events-clean.json')

const CONCURRENCY = 6          // polite: their box, not ours
const TIMEOUT_MS = 20000
const RETRIES = 1              // one retry — distinguishes a flaky hop from a dead page
const MAX_SOFT_NULL = 3        // more rendered not-found pages than this in one run: keep their links, say so
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const apply = process.argv.includes('--apply')
const selftest = process.argv.includes('--selftest')

function fail(...lines) { for (const l of lines) console.error(l); process.exit(1) }

if (!existsSync(SEED_PATH)) fail(`Seed file not found: ${SEED_PATH}`, 'Run prepare-gisekibris-feed.mjs first.')
const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8'))
const events = seed.events ?? []
if (!events.length) fail('Seed file contains no events.')

// ─── Probe ───────────────────────────────────────────────────────────────────

async function once(url, method) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' },
    })
    // The body is what carries the cancellation flag, so a GET must consume it.
    // Leaving it unread also leaks the connection until GC.
    const body = method === 'GET' ? await res.text() : null
    return { status: res.status, finalUrl: res.url, body }
  } finally {
    clearTimeout(timer)
  }
}

// THREE-VALUED, and the third value is the point: true / false / null-for-unknown.
// Every match in the page is collected rather than the first one — if a page ever
// carried two and they disagreed, taking the first would invent a definite answer out
// of an ambiguous one. Disagreement reads as unknown.
const slugOf = u => {
  try {
    const seg = new URL(u).pathname.replace(/\/+$/, '').split('/').pop() ?? ''
    return decodeURIComponent(seg).split('--')[0].toLowerCase()
  } catch { return null }
}
// Same rule as idFromPage in prepare-gisekibris-feed.mjs: exactly one distinct id, else unknown.
function pageId(body) {
  if (typeof body !== 'string') return null
  const ids = new Set([...body.replace(/\\"/g, '"').matchAll(/"(?:id|eventId)":"([A-Za-z0-9]{15,30})"/g)].map(m => m[1]))
  return ids.size === 1 ? [...ids][0] : null
}

const CANCEL_RE = /"isCancelled"\s*:\s*(true|false)/g
function cancelledFlag(body) {
  if (typeof body !== 'string' || !body) return null
  const seen = new Set()
  for (const m of body.matchAll(CANCEL_RE)) seen.add(m[1] === 'true')
  if (seen.size !== 1) return null          // absent (0) or self-contradictory (2)
  return [...seen][0]
}

async function probe(ev) {
  const url = ev.ticket_url
  if (!url) return { ev, status: null, note: 'no ticket_url in seed', ok: false, skipped: true }

  let last
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      // GET, never HEAD — see the header. The flag is in the body.
      const r = await once(url, 'GET')

      const landedOn404 = /\/404(\/|$|\?)/.test(r.finalUrl ?? '')
      const softNotFound = isNotFoundPage(r.body)
      const ok = r.status >= 200 && r.status < 300 && !landedOn404 && !softNotFound
      const landedId = ok ? pageId(r.body) : null
      const wrongSlug = ok && slugOf(r.finalUrl) !== slugOf(url)
      const wrongId = ok && landedId !== null && `gk-${landedId}` !== ev.external_id
      return {
        mismatch: wrongSlug || wrongId
          ? (wrongSlug ? `landed on slug "${slugOf(r.finalUrl)}", row's link names "${slugOf(url)}"` : '') +
            (wrongSlug && wrongId ? '; ' : '') +
            (wrongId ? `page id gk-${landedId} is not this row's ${ev.external_id}` : '')
          : null,
        ev, status: r.status, finalUrl: r.finalUrl, ok, softNotFound: softNotFound && !landedOn404 && r.status < 300,
        // Only meaningful on a page that actually resolved. A 404 body has no flag,
        // and reading one off it would be an answer from the wrong document.
        cancelled: ok ? cancelledFlag(r.body) : null,
        note: landedOn404 ? `redirected to ${r.finalUrl}`
          : softNotFound && r.status < 300 ? `HTTP ${r.status} rendering "404 - Sayfa Bulunamadı"` : null,
      }
    } catch (e) {
      last = e.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : `${e.message}${e.cause ? ` (${e.cause.code ?? e.cause.name}: ${e.cause.message})` : ''} · ${url}`
    }
  }
  return { ev, status: null, ok: false, cancelled: null, note: last }
}

async function pool(items, worker, size) {
  let cursor = 0
  const out = new Array(items.length)
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await worker(items[i])
      process.stdout.write(`\r  probing ${out.filter(Boolean).length}/${items.length}…`)
    }
  }))
  process.stdout.write('\r'.padEnd(40) + '\r')
  return out
}

// ─── Self-test ───────────────────────────────────────────────────────────────
//
// A check nobody has watched fail is a decoration. Two halves:
//
//   • PURE, deterministic, no network — the three-valued parser really is
//     three-valued. Absent must read unknown and NOT false, which is the whole
//     hazard; a contradictory page must read unknown and not pick a side.
//   • LIVE — a page KNOWN to be cancelled must parse as true. This is the half that
//     proves the tool can still see a cancellation at all, and it is the half that
//     silently rots if the partner ever renames the field.
//
// The live control is one of the five cancelled on 2026-09-20. If it stops resolving
// this reports that it could not verify and exits 0 — a control that has been taken
// down is not evidence of a broken parser, and failing on it would train the reader
// to ignore this command. It exits 1 only when a control ANSWERS and answers wrongly.
const CANCELLED_CONTROL = {
  label: 'YILDIZ TİLBE (cancelled 2026-09-20)',
  url: 'https://www.gisekibris.com/etkinlikler/yildiz-tilbe--DxdJgTfCbbiWLP2qLTwd',
}

if (selftest) {
  let bad = 0
  const unit = [
    ['reads true',              '{"isCancelled":true}',                     true],
    ['reads false',             '{"isCancelled": false }',                  false],
    ['absent  → unknown',       '{"layoutID":null,"duration":390}',         null],
    ['contradictory → unknown', '{"isCancelled":true,"isCancelled":false}', null],
    ['empty  → unknown',        '',                                         null],
  ]
  console.log('\n  Parser (no network)')
  for (const [name, body, want] of unit) {
    const got = cancelledFlag(body)
    const pass = got === want
    if (!pass) bad++
    console.log(`    ${pass ? '✓' : '✗'} ${name.padEnd(26)} got ${String(got)}, want ${String(want)}`)
  }

  // --apply takes a cancelled row OUT and keeps going; report mode still exits 1.
  // Child runs against a localhost server, so this half needs no partner network.
  console.log('\n  --apply drops a cancelled row and continues (localhost)')
  {
    const srv = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(req.url.startsWith('/cancelled') ? '{"isCancelled":true}' : '{"isCancelled":false}')
    })
    await new Promise(r => srv.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${srv.address().port}`
    const dir = mkdtempSync(join(tmpdir(), 'gk-urls-'))
    const file = join(dir, 'seed.json')
    const mk = () => writeFileSync(file, JSON.stringify({ meta: { notes: [] }, events: [
      { external_id: 'gk-Live1', title: 'LIVE', start_date: '2026-12-01', ticket_url: `${base}/live` },
      { external_id: 'gk-Gone1', title: 'GONE', start_date: '2026-12-02', ticket_url: `${base}/cancelled` },
    ] }))
    const exec = args => new Promise(done =>
      execFile(process.execPath, [fileURLToPath(import.meta.url), ...args, '--seed', file],
        (err, stdout) => done({ code: err ? err.code : 0, stdout })))
    mk(); const rep = await exec([])
    const t2 = (label, got, want) => { const ok = got === want; if (!ok) bad++
      console.log(`    ${ok ? '✓' : '✗'} ${label.padEnd(36)} got ${JSON.stringify(got)}${ok ? '' : `, want ${JSON.stringify(want)}`}`) }
    t2('report mode: cancelled → exit 1', rep.code, 1)
    mk(); const ap = await exec(['--apply'])
    const after = JSON.parse(readFileSync(file, 'utf8'))
    t2('--apply: exit 0', ap.code, 0)
    t2('--apply: only the live row stays', after.events.map(e => e.external_id).join(','), 'gk-Live1')
    t2('--apply: recorded in feed_cancelled', after.meta.feed_cancelled?.map(e => e.external_id).join(','), 'gk-Gone1')
    srv.close(); rmSync(dir, { recursive: true, force: true })
  }

  // 2026-11-25: bir-ihtimal-kabare-7aralik--pTvx… (a borrowed id) redirected to, and
  // opened, bir-ihtimal-kabare-3. 200 and isCancelled=false: only the landing slug shows it.
  console.log('\n  a link that lands on ANOTHER event is reported and nulled (localhost)')
  {
    const ID_A = 'pTvxB7NxtGCRMjLNyMc9', ID_B = 'cmwncx16f009ecxtvh9z9n1mm', ID_C = 'MatchId1234567890abc'
    const srv = createServer((req, res) => {
      const p = req.url.split('?')[0]
      if (p === `/kabare-7aralik--${ID_A}`) { res.writeHead(307, { location: '/kabare-3' }); return res.end() }
      if (p === `/renamed--${ID_C}`) { res.writeHead(307, { location: '/new-name' }); return res.end() }
      res.writeHead(200, { 'content-type': 'text/html' })
      if (p === '/kabare-3') return res.end(`{"isCancelled":false,"id":"${ID_A}"}`)
      // A real page carries the not-found text in its i18n dictionary; only the rendered one is dead.
      if (p === '/kabare-7aralik') return res.end(`{"notFound404":"404 - Sayfa Bulunamadı","isCancelled":false,"id":"${ID_B}"}`)
      if (p === '/stand-up') return res.end('<span class="css-x">404 - Sayfa Bulunamadı</span>')
      if (p === '/new-name') return res.end(`{"isCancelled":false,"id":"${ID_C}"}`)
      if (p === '/not-okay-2') return res.end(`{"isCancelled":false,"id":"${ID_A}"}`)
      res.end('{"isCancelled":false}')
    })
    await new Promise(r => srv.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${srv.address().port}`
    const dir = mkdtempSync(join(tmpdir(), 'gk-urls-'))
    const file = join(dir, 'seed.json')
    writeFileSync(file, JSON.stringify({ meta: { notes: [] }, events: [
      { external_id: `gk-${ID_A}`, title: 'WRONG SLUG', start_date: '2026-12-07', ticket_url: `${base}/kabare-7aralik--${ID_A}?code=AF1` },
      { external_id: 'gk-cmwt52g9b026ecxhtlg66sd1l', title: 'WRONG ID', start_date: '2026-12-02', ticket_url: `${base}/not-okay-2?code=AF1` },
      { external_id: `gk-${ID_B}`, title: 'RIGHT', start_date: '2026-12-07', ticket_url: `${base}/kabare-7aralik?code=AF1` },
      { external_id: `gk-${ID_C}`, title: 'SLUG RENAMED', start_date: '2026-12-08', ticket_url: `${base}/renamed--${ID_C}` },
      { external_id: 'gk-NoIdOnPage123456789', title: 'NO ID ON PAGE', start_date: '2026-12-09', ticket_url: `${base}/plain` },
      { external_id: 'gk-Xz2PcM8zcsO4M9GmZFCb', title: 'SOFT 404', start_date: '2026-12-19', ticket_url: `${base}/stand-up` },
    ] }))
    const ap = await new Promise(done => execFile(process.execPath,
      [fileURLToPath(import.meta.url), '--apply', '--seed', file], (err, stdout) => done({ code: err ? err.code : 0, stdout })))
    const after = JSON.parse(readFileSync(file, 'utf8'))
    const link = title => after.events.find(e => e.title === title)?.ticket_url
    const t3 = (label, got, want) => { const ok = got === want; if (!ok) bad++
      console.log(`    ${ok ? '✓' : '✗'} ${label.padEnd(36)} got ${JSON.stringify(got)}${ok ? '' : `, want ${JSON.stringify(want)}`}`) }
    t3('--apply: exit 0', ap.code, 0)
    t3('lands on another slug → listed', after.meta.slug_mismatch?.map(m => m.title).join(','), 'WRONG SLUG,WRONG ID,SLUG RENAMED')
    t3('…with where it landed', after.meta.slug_mismatch?.[0]?.landed, `${base}/kabare-3`)
    t3('lands on another slug → nulled', link('WRONG SLUG'), null)
    t3('page id ≠ row id → nulled', link('WRONG ID'), null)
    t3('own slug + own id → kept as sent', link('RIGHT'), `${base}/kabare-7aralik?code=AF1`)
    // Indistinguishable from the live bug (kabare-7's page id WAS its borrowed external_id),
    // so the slug decides; a genuine rename shows up in the issue for a human.
    t3('renamed slug, own id → still nulled', link('SLUG RENAMED'), null)
    t3('no id on page, own slug → kept', link('NO ID ON PAGE'), `${base}/plain`)
    // 2026-11-25: yusuf-bilal-altintas-stand-up served "404 - Sayfa Bulunamadı" with HTTP 200.
    t3('200 rendering the 404 page → nulled', link('SOFT 404'), null)
    srv.close(); rmSync(dir, { recursive: true, force: true })
  }

  // Feed rows are the partner saying the event exists, so a WAVE of rendered not-found
  // pages is more likely their site (or our marker) than many removed events: over
  // MAX_SOFT_NULL the soft ones keep their links; a hard 404 is still nulled.
  console.log('\n  a wave of soft 404s is not nulled; a hard 404 still is (localhost)')
  {
    const srv = createServer((req, res) => {
      if (req.url === '/hard') { res.writeHead(404); return res.end() }
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<h1>404 - Sayfa Bulunamadı</h1>')
    })
    await new Promise(r => srv.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${srv.address().port}`
    const dir = mkdtempSync(join(tmpdir(), 'gk-urls-'))
    const file = join(dir, 'seed.json')
    const n = MAX_SOFT_NULL + 1
    writeFileSync(file, JSON.stringify({ meta: { notes: [] }, events: [
      ...Array.from({ length: n }, (_, i) => ({ external_id: `gk-Soft${i}`, title: `SOFT ${i}`, start_date: '2026-12-10', ticket_url: `${base}/s${i}` })),
      { external_id: 'gk-Hard1', title: 'HARD', start_date: '2026-12-11', ticket_url: `${base}/hard` },
    ] }))
    const ap = await new Promise(done => execFile(process.execPath,
      [fileURLToPath(import.meta.url), '--apply', '--seed', file], (err, stdout) => done({ code: err ? err.code : 0, stdout })))
    const after = JSON.parse(readFileSync(file, 'utf8'))
    const t4 = (label, got, want) => { const ok = got === want; if (!ok) bad++
      console.log(`    ${ok ? '✓' : '✗'} ${label.padEnd(36)} got ${JSON.stringify(got)}${ok ? '' : `, want ${JSON.stringify(want)}`}`) }
    t4('--apply: exit 0', ap.code, 0)
    t4(`${n} soft 404s → all links kept`, after.events.filter(e => e.title.startsWith('SOFT') && e.ticket_url).length, n)
    t4('hard 404 → nulled', after.events.find(e => e.title === 'HARD')?.ticket_url, null)
    srv.close(); rmSync(dir, { recursive: true, force: true })
  }

  console.log(`\n  Live control — ${CANCELLED_CONTROL.label}`)
  const r = await probe({ title: CANCELLED_CONTROL.label, external_id: 'control',
                          ticket_url: CANCELLED_CONTROL.url })
  if (!r.ok) {
    console.log(`    ⚠ control did not resolve (${r.status ?? 'no response'}) — CANNOT VERIFY.`)
    console.log('      Not treated as a failure: a page taken down says nothing about the parser.')
  } else if (r.cancelled === true) {
    console.log('    ✓ parsed as cancelled — the tool can still see a cancellation.')
  } else {
    bad++
    console.log(`    ✗ resolved but parsed as ${String(r.cancelled)}, expected true.`)
    console.log('      The field was probably renamed. FIX THE PARSER before trusting a clean run:')
    console.log('      until then every cancelled event reads as live.')
  }
  console.log(bad ? `\n  ${bad} self-test failure(s).\n` : '\n  Self-test clean.\n')
  process.exit(bad ? 1 : 0)
}

console.log(`\nProbing ${events.length} ticket URLs (concurrency ${CONCURRENCY})…\n`)
const results = await pool(events, probe, CONCURRENCY)

// ─── Report ──────────────────────────────────────────────────────────────────

const groups = new Map()
for (const r of results) {
  const key = r.skipped ? '(none)' : (r.status ?? 'network error')
  groups.set(key, (groups.get(key) ?? 0) + 1)
}

console.log('  Status codes')
for (const [code, count] of [...groups].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
  const ok = code === 200 ? '  ✓' : '  ✗'
  console.log(`  ${ok} ${String(code).padEnd(16)} ${String(count).padStart(3)}`)
}

const failures = results.filter(r => !r.ok && !r.skipped)
const passed = results.filter(r => r.ok)

if (failures.length) {
  console.log(`\n  ⚠ ${failures.length} URL(s) did not resolve:\n`)
  for (const f of failures) {
    console.log(`    ${f.ev.title}`)
    console.log(`      ${f.ev.external_id}  ${f.status ?? 'no response'}${f.note ? `  — ${f.note}` : ''}`)
    console.log(`      ${f.ev.ticket_url}`)
  }
  console.log('\n    These are worth raising with Gişe Kıbrıs as feedback — most likely')
  console.log('    unpublished or stale event pages rather than anything wrong on our side.')
}

console.log(`\n  ${passed.length}/${events.length} resolve.`)

const soft = failures.filter(f => f.softNotFound)
const softOverCap = soft.length > MAX_SOFT_NULL
const toNull = softOverCap ? failures.filter(f => !f.softNotFound) : failures
if (softOverCap) {
  console.log(`\n  ⛔ ${soft.length} feed rows render the not-found page — over the cap of ${MAX_SOFT_NULL}. Their links are`)
  console.log('     KEPT: the feed says these events exist, so a wave is more likely their site or our')
  console.log('     marker (scripts/lib/gisekibris-page.mjs) than removed events. Check by hand.')
}

// ─── Cancellation ────────────────────────────────────────────────────────────
// Three buckets, printed even when empty, because "0 cancelled" is a result and a
// silent section is indistinguishable from a section that did not run.
const cancelled = results.filter(r => r.cancelled === true)
const live      = results.filter(r => r.ok && r.cancelled === false)
const unknown   = results.filter(r => r.ok && r.cancelled === null)

console.log('\n  Cancellation (the partner\'s own isCancelled flag)')
console.log(`    live      ${String(live.length).padStart(3)}  flag present and false`)
console.log(`    cancelled ${String(cancelled.length).padStart(3)}  flag present and TRUE`)
console.log(`    unknown   ${String(unknown.length).padStart(3)}  flag ABSENT — not verifiable, NOT "live"`)

if (unknown.length) {
  console.log('\n    Unknown (seat-map page variant carries no flag). These were not checked,')
  console.log('    which is not the same as being fine:')
  for (const u of unknown) console.log(`      ${u.ev.external_id}  ${u.ev.title}`)
}

if (cancelled.length) {
  console.log(`\n  ⛔ ${cancelled.length} event(s) in the feed are CANCELLED on the partner's site:\n`)
  for (const c of cancelled) {
    console.log(`    ${c.ev.title}`)
    console.log(`      ${c.ev.external_id}  ${c.ev.start_date}`)
    console.log(`      ${c.ev.ticket_url}`)
  }
  console.log(apply
    ? '\n    Removed from the seed below and recorded in meta.feed_cancelled: not imported,\n' +
      '    never cancelled automatically, listed in the issue for Berke to decide.'
    : '\n    DO NOT IMPORT. Re-run with --apply to take them out of the seed.')
}

// ─── Wrong event ─────────────────────────────────────────────────────────────
// Cancelled rows are left to the cancellation path above; everything else that opens
// another event's page is listed (printed even when empty: "0" is a result).
const mismatched = results.filter(r => r.mismatch && r.cancelled !== true)
console.log(`\n  Link opens THIS row's event (landing slug and page id)`)
console.log(`    wrong event ${String(mismatched.length).padStart(3)}`)
for (const m of mismatched) {
  console.log(`\n    ${m.ev.title}  ${m.ev.start_date}`)
  console.log(`      ${m.ev.external_id}  ${m.mismatch}`)
  console.log(`      ${m.ev.ticket_url}\n      → ${m.finalUrl}`)
}
if (mismatched.length) {
  console.log(apply ? '\n    Nulled below and recorded in meta.slug_mismatch (listed in the issue).'
                    : '\n    DO NOT IMPORT. Re-run with --apply to null them.')
}

// ─── Apply ───────────────────────────────────────────────────────────────────

if (apply && cancelled.length) {
  const out = new Set(cancelled.map(c => c.ev.external_id))
  if (seed.events.every(e => out.has(e.external_id))) {
    fail('Every event in the feed is cancelled — refusing to hand an empty seed to the import. Seed left untouched.')
  }
  seed.events = seed.events.filter(e => !out.has(e.external_id))
  seed.meta.feed_cancelled = cancelled.map(c => ({
    external_id: c.ev.external_id, title: c.ev.title, start_date: c.ev.start_date, ticket_url: c.ev.ticket_url }))
  seed.meta.event_count = seed.events.length
  writeFileSync(SEED_PATH, JSON.stringify(seed, null, 2) + '\n')
  console.log(`\n  ✓ ${out.size} cancelled event(s) taken out of the seed (meta.feed_cancelled)\n`)
}

if (apply) {
  seed.meta.slug_mismatch = mismatched.map(m => ({ external_id: m.ev.external_id, title: m.ev.title,
    start_date: m.ev.start_date, ticket_url: m.ev.ticket_url, landed: m.finalUrl, why: m.mismatch }))
  if (!toNull.length && !mismatched.length) {
    writeFileSync(SEED_PATH, JSON.stringify(seed, null, 2) + '\n')
    console.log(softOverCap ? '  Nothing nulled (soft 404s over the cap, kept above).\n'
                            : '  Nothing to null — every URL resolves to its own event.\n')
  } else {
    const bad = new Set([...toNull, ...mismatched].map(f => f.ev.external_id))
    let nulled = 0
    for (const e of seed.events) {
      if (bad.has(e.external_id) && e.ticket_url !== null) { e.ticket_url = null; nulled++ }
    }
    seed.meta.notes = seed.meta.notes.filter(n => !n.startsWith('URL probe'))
    seed.meta.notes.push(
      `URL probe: ${nulled} ticket_url(s) set to null because the page did not resolve or opened another event ` +
      `(${[...bad].join(', ')}). The Buy Ticket button is hidden for these.`)
    writeFileSync(SEED_PATH, JSON.stringify(seed, null, 2) + '\n')
    console.log(`  ✓ ${nulled} ticket_url(s) set to null in ${SEED_PATH.replace(ROOT + '/', '')}\n`)
  }
} else if (failures.length || mismatched.length) {
  console.log('  Re-run with --apply to null these in the seed.\n')
} else {
  console.log('')
}

// --apply: cancelled rows are already out of the seed, so the chain continues.
// Report mode: non-zero on a cancelled event, as before.
process.exit((cancelled.length || mismatched.length) && !apply ? 1 : 0)

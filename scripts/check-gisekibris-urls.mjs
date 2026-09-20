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
// SOFT-404s: verified this site does NOT serve them — an unknown id returns a real
// 404 and redirects to /gisekibris.com/404 — so the status code is trustworthy. The
// final-URL check below is belt-and-braces in case that changes after the handover.
//
// Only the id half after the final '--' routes; a wrong slug still resolves 200.
// That is why a title edit on their side cannot break a stored link.
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
// A cancelled event makes this script EXIT NON-ZERO. It does not edit the seed for
// one: which rows are cancelled and what to do about them is an owner's call, and the
// non-zero exit is what stops an import running behind it in a chain.
//
//   node scripts/check-gisekibris-urls.mjs --selftest   # prove the parser still reads
//                                                       # a known-cancelled page as true

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SEED_PATH = resolve(ROOT, 'supabase/seed/gisekibris-events-clean.json')

const CONCURRENCY = 6          // polite: their box, not ours
const TIMEOUT_MS = 20000
const RETRIES = 1              // one retry — distinguishes a flaky hop from a dead page
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
      const ok = r.status >= 200 && r.status < 300 && !landedOn404
      return {
        ev, status: r.status, finalUrl: r.finalUrl, ok,
        // Only meaningful on a page that actually resolved. A 404 body has no flag,
        // and reading one off it would be an answer from the wrong document.
        cancelled: ok ? cancelledFlag(r.body) : null,
        note: landedOn404 ? `redirected to ${r.finalUrl}` : null,
      }
    } catch (e) {
      last = e.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : e.message
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
  console.log('\n    DO NOT IMPORT. A cancelled event still serves 200, so nothing else in')
  console.log('    this pipeline would notice. Decide what to do with these first —')
  console.log("    the seed has NOT been edited for them; that is the owner's call.")
}

// ─── Apply ───────────────────────────────────────────────────────────────────

if (apply) {
  if (!failures.length) {
    console.log('  Nothing to null — every URL resolves. Seed left untouched.\n')
  } else {
    const bad = new Set(failures.map(f => f.ev.external_id))
    let nulled = 0
    for (const e of seed.events) {
      if (bad.has(e.external_id) && e.ticket_url !== null) { e.ticket_url = null; nulled++ }
    }
    seed.meta.notes = seed.meta.notes.filter(n => !n.startsWith('URL probe'))
    seed.meta.notes.push(
      `URL probe: ${nulled} ticket_url(s) set to null because the page did not resolve ` +
      `(${failures.map(f => f.ev.external_id).join(', ')}). The Buy Ticket button is hidden for these.`)
    writeFileSync(SEED_PATH, JSON.stringify(seed, null, 2) + '\n')
    console.log(`  ✓ ${nulled} ticket_url(s) set to null in ${SEED_PATH.replace(ROOT + '/', '')}\n`)
  }
} else if (failures.length) {
  console.log('  Re-run with --apply to null these in the seed.\n')
} else {
  console.log('')
}

// Non-zero on a cancelled event, so an import chained behind this one does not run.
// Dead-URL nulling above still happened: it is idempotent and orthogonal, and leaving
// the seed half-corrected would be the confusing outcome.
process.exit(cancelled.length ? 1 : 0)

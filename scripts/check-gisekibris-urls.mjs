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
    return { status: res.status, finalUrl: res.url }
  } finally {
    clearTimeout(timer)
  }
}

async function probe(ev) {
  const url = ev.ticket_url
  if (!url) return { ev, status: null, note: 'no ticket_url in seed', ok: false, skipped: true }

  let last
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      // HEAD first (cheap). Some stacks reject or mishandle it, so anything that is
      // not a clean 2xx is re-checked with a GET before being called a failure.
      let r = await once(url, 'HEAD')
      if (r.status < 200 || r.status >= 300) r = await once(url, 'GET')

      const landedOn404 = /\/404(\/|$|\?)/.test(r.finalUrl ?? '')
      const ok = r.status >= 200 && r.status < 300 && !landedOn404
      return {
        ev, status: r.status, finalUrl: r.finalUrl, ok,
        note: landedOn404 ? `redirected to ${r.finalUrl}` : null,
      }
    } catch (e) {
      last = e.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : e.message
    }
  }
  return { ev, status: null, ok: false, note: last }
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

process.exit(0)

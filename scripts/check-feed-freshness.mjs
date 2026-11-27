#!/usr/bin/env node
// ─── feeds:freshness — has every feed synced in the last 48 h? ───────────────
//
//   node scripts/check-feed-freshness.mjs                exit 1 when any feed is stale or unreadable
//                                                        (unreadable = the CHECK failed, reported apart from stale)
//   node scripts/check-feed-freshness.mjs --json <file>  also write the result as JSON (Mac alert job)
//   node scripts/check-feed-freshness.mjs --self         offline boundary test
//
// Berke, 2026-11-14: "alert me when any feed hasn't synced for 48h". The Gişe Kıbrıs sync was red
// for six days and nothing said "events are getting stale". Measured from each workflow's last
// SUCCESSFUL run, never from row timestamps: an unchanged feed writes nothing, so updated_at
// would read stale on a healthy day. daily-health itself is on the list by its last COMPLETED
// run (red or green): it carries the Novest sync and duty-push checks, so if it stops running,
// this is what notices (from the Mac job; daily-health cannot report its own absence).
//
// Runs in daily-health (GITHUB_TOKEN, actions: read) and in the Mac launchd job (`gh api`, the
// ada-claude-code App token). Read-only. Prints workflow names and ages only (public log).

import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

export const MAX_AGE_H = 48
// `filter` narrows which runs count, so a run that did not sync cannot pass for one:
//   gisekibris-feed: a manual dispatch may be DRY (input `dry`), so only scheduled runs count.
//   duyurular-fetch: the chain re-dispatches itself (workflow_dispatch), so no event filter; main
//     only. duyurular:health question 1 (a successful fetch < 2 h, from the DB) is the real guard.
//   novest-images: a manual dispatch is DRY by default, so only scheduled runs count.
export const FEEDS = [
  { name: 'Gişe Kıbrıs events', workflow: 'gisekibris-feed.yml', status: 'success',   filter: '&branch=main&event=schedule' },
  { name: 'Duyurular',          workflow: 'duyurular-fetch.yml', status: 'success',   filter: '&branch=main' },
  { name: 'Novest photos',      workflow: 'novest-images.yml',   status: 'success',   filter: '&branch=main&event=schedule' },
  { name: 'daily-health ran',   workflow: 'daily-health.yml',    status: 'completed', filter: '&branch=main' },
]
const H = 36e5

// One readable line from a failure. A crashing child (the gh wrapper's token mint) prints Node's banner
// `node:internal/modules/run_main:107` first, which was all the 2026-11-27 01:43 alerts showed.
const NOISE = [/^node:internal\//, /^at /, /^\^+$/, /triggerUncaughtException/, /^Node\.js v/, /^throw /, /^[{}\]]+$/, /^\w+: ['"\d[-]/]
export function describeError(e) {
  if (e?.cause) return `${e.message}: ${e.cause.code || e.cause.message}`
  const lines = (e?.stderr?.toString() || e?.message || String(e)).split('\n').map(l => l.trim())
    .filter(l => l && !NOISE.some(re => re.test(l)))
    .map(l => l.replace(/^\[cause\]:\s*/, '').replace(/\s*\{$/, '').replace(/^\[(.*)\]$/, '$1'))
  return [...new Set(lines)].join(' · ').slice(0, 300) || 'unknown error'
}
// Retry what a sleeping/waking Mac or a GitHub blip produces; an HTTP 4xx answer is final.
export const transient = msg => !/HTTP 4\d\d/.test(msg)

// lastAt: ISO time of the last qualifying run, null = none on record, undefined = unreadable.
// Unreadable is neither fresh nor stale: the check itself failed, and the Mac job alerts on it once, not per feed.
export function assess(results, now = Date.now()) {
  return results.map(r => {
    if (r.error) return { ...r, stale: false, unreadable: true, why: `unreadable: ${r.error}` }
    if (!r.lastAt) return { ...r, stale: true, why: 'no qualifying run on record' }
    const ageH = (now - Date.parse(r.lastAt)) / H
    return { ...r, ageH: Math.round(ageH * 10) / 10, stale: ageH > MAX_AGE_H, why: ageH > MAX_AGE_H ? `last ${r.status} run ${Math.round(ageH)} h ago` : null }
  })
}

if (process.argv.includes('--self')) {
  const now = Date.parse('2026-11-14T12:00:00Z')
  let bad = 0
  const t = (label, got, want) => { if (got !== want) bad++; console.log(`  ${got === want ? '✓' : '✗'} ${label} -> ${got} (want ${want})`) }
  const one = lastAt => assess([{ name: 'x', status: 'success', lastAt }], now)[0]
  console.log('\n── feed freshness self-test ──')
  t('synced 47h59m ago → fresh    ', one('2026-11-12T12:01:00Z').stale, false)
  t('synced 48h01m ago → stale    ', one('2026-11-12T11:59:00Z').stale, true)
  t('Gişe 2026-11-07 (7 days) → stale', one('2026-11-07T12:30:00Z').stale, true)
  t('never ran → stale            ', one(null).stale, true)
  const u = assess([{ name: 'x', status: 'success', error: 'HTTP 403' }], now)[0]
  t('unreadable → not fresh, not stale', `${u.unreadable}/${u.stale}`, 'true/false')
  t('unreadable keeps the error text', u.why, 'unreadable: HTTP 403')
  const crash = { stderr: 'node:internal/modules/run_main:107\n    triggerUncaughtException(\n    ^\n\n[TypeError: fetch failed] {\n  [cause]: Error: getaddrinfo ENOTFOUND api.github.com\n      at GetAddrInfoReqWrap.onlookupall (node:dns:122:26) {\n    errno: -3008,\n    code: \'ENOTFOUND\',\n  }\n}\n\nNode.js v24.15.0\ngh wrapper: could not mint the ada-claude-code App token\n' }
  t('node crash → the real error, not the banner', describeError(crash),
    'TypeError: fetch failed · Error: getaddrinfo ENOTFOUND api.github.com · gh wrapper: could not mint the ada-claude-code App token')
  t('Bad CPU type → the whole line', describeError({ stderr: '/Users/x/.local/bin/gh: line 6: /usr/local/bin/gh: Bad CPU type in executable\n' }),
    '/Users/x/.local/bin/gh: line 6: /usr/local/bin/gh: Bad CPU type in executable')
  t('fetch error → message + cause code', describeError(Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } })), 'fetch failed: ENOTFOUND')
  t('HTTP 403 is not retried', transient('HTTP 403'), false)
  t('network error is retried', transient('fetch failed: ENOTFOUND'), true)
  t('daily-health counts any completion', FEEDS.find(f => f.workflow === 'daily-health.yml').status, 'completed')
  t('Gişe Kıbrıs: a dry manual dispatch does not count', FEEDS.find(f => f.workflow === 'gisekibris-feed.yml').filter.includes('event=schedule'), true)
  t('Novest: a dry manual dispatch does not count', FEEDS.find(f => f.workflow === 'novest-images.yml').filter.includes('event=schedule'), true)
  t('every feed is read from main only', FEEDS.every(f => f.filter.includes('branch=main')), true)
  console.log(bad ? `\nSELF-TEST FAILED (${bad})\n` : '\nself-test clean\n')
  process.exit(bad ? 1 : 0)
}

const repo = process.env.GITHUB_REPOSITORY || 'berkeustun95/trnc-health'
const RETRY_WAIT_S = [5, 10, 20]   // ~35 s in all, inside the Mac job's 120 s limit
async function lastRun(feed) {
  let r
  for (let i = 0; ; i++) {
    r = await lastRunOnce(feed)
    if (!r.error || !transient(r.error) || i >= RETRY_WAIT_S.length) return r
    await new Promise(ok => setTimeout(ok, RETRY_WAIT_S[i] * 1000))
  }
}
async function lastRunOnce({ workflow, status, filter = '' }) {
  const path = `repos/${repo}/actions/workflows/${workflow}/runs?status=${status}${filter}&per_page=1`
  try {
    let body
    if (process.env.GITHUB_TOKEN) {
      const res = await fetch(`https://api.github.com/${path}`, { headers: {
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } })
      if (!res.ok) return { error: `HTTP ${res.status}` }
      body = await res.json()
    } else {
      body = JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }))
    }
    const run = body.workflow_runs?.[0]
    return { lastAt: run ? run.updated_at : null, runId: run?.id ?? null }
  } catch (e) {
    return { error: describeError(e) }
  }
}

const results = assess(await Promise.all(FEEDS.map(async f => ({ ...f, ...(await lastRun(f)) }))))
console.log(`\n── Feed freshness (limit ${MAX_AGE_H} h) ──`)
for (const r of results) {
  console.log(`  ${r.stale || r.unreadable ? '✗' : '✓'} ${r.name.padEnd(20)} ${r.lastAt ? `${r.lastAt} (${r.ageH} h ago)` : '—'}${r.why ? `  ${r.why}` : ''}`)
}
const stale = results.filter(r => r.stale)
const unreadable = results.filter(r => r.unreadable)
const verdict = [
  unreadable.length && `CHECK FAILED — could not read ${unreadable.map(r => r.name).join(', ')}`,
  stale.length && `STALE — ${stale.map(r => r.name).join(', ')}`,
].filter(Boolean).join('; ') || 'ok'
console.log(`  verdict: ${verdict}\n`)
const jsonAt = process.argv.indexOf('--json')
if (jsonAt !== -1) writeFileSync(process.argv[jsonAt + 1], JSON.stringify({ checked_at: new Date().toISOString(), max_age_h: MAX_AGE_H, feeds: results }, null, 2) + '\n')
process.exit(stale.length || unreadable.length ? 1 : 0)

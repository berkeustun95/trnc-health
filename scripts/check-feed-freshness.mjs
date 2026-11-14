#!/usr/bin/env node
// ─── feeds:freshness — has every feed synced in the last 48 h? ───────────────
//
//   node scripts/check-feed-freshness.mjs                exit 1 when any feed is stale or unreadable
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
export const FEEDS = [
  { name: 'Gişe Kıbrıs events', workflow: 'gisekibris-feed.yml', status: 'success' },
  { name: 'Duyurular',          workflow: 'duyurular-fetch.yml', status: 'success' },
  { name: 'Novest photos',      workflow: 'novest-images.yml',   status: 'success' },
  { name: 'daily-health ran',   workflow: 'daily-health.yml',    status: 'completed' },
]
const H = 36e5

// lastAt: ISO time of the last qualifying run, null = none on record, undefined = unreadable.
export function assess(results, now = Date.now()) {
  return results.map(r => {
    if (r.error) return { ...r, stale: true, why: `unreadable: ${r.error}` }
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
  t('unreadable → stale, not fresh', assess([{ name: 'x', status: 'success', error: 'HTTP 403' }], now)[0].stale, true)
  t('daily-health counts any completion', FEEDS.find(f => f.workflow === 'daily-health.yml').status, 'completed')
  console.log(bad ? `\nSELF-TEST FAILED (${bad})\n` : '\nself-test clean\n')
  process.exit(bad ? 1 : 0)
}

const repo = process.env.GITHUB_REPOSITORY || 'berkeustun95/trnc-health'
async function lastRun({ workflow, status }) {
  const path = `repos/${repo}/actions/workflows/${workflow}/runs?status=${status}&per_page=1`
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
    return { error: (e.stderr?.toString() || e.message).split('\n')[0].slice(0, 120) }
  }
}

const results = assess(await Promise.all(FEEDS.map(async f => ({ ...f, ...(await lastRun(f)) }))))
console.log(`\n── Feed freshness (limit ${MAX_AGE_H} h) ──`)
for (const r of results) {
  console.log(`  ${r.stale ? '✗' : '✓'} ${r.name.padEnd(20)} ${r.lastAt ? `${r.lastAt} (${r.ageH} h ago)` : '—'}${r.why ? `  ${r.why}` : ''}`)
}
const stale = results.filter(r => r.stale)
console.log(`  verdict: ${stale.length ? `STALE — ${stale.map(r => r.name).join(', ')}` : 'ok'}\n`)
const jsonAt = process.argv.indexOf('--json')
if (jsonAt !== -1) writeFileSync(process.argv[jsonAt + 1], JSON.stringify({ checked_at: new Date().toISOString(), max_age_h: MAX_AGE_H, feeds: results }, null, 2) + '\n')
process.exit(stale.length ? 1 : 0)

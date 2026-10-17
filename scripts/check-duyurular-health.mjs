#!/usr/bin/env node
// ─── duyurular:health — is the announcements pipeline alive? ─────────────────
//
//   npm run duyurular:health            exit 1 when any check fails (daily-health)
//   npm run duyurular:health -- --self  offline boundary test
//
// Five questions (Berke 2026-10-11; 5 added 2026-10-17), each answered from the thing itself:
//   1. a successful fetch in the last 2 h      max(announcement_sources.last_ok_at)
//   2. no source failing 3+ runs in a row      consecutive_failures >= 3
//   3. a new item in the last 3 days           max(announcements.created_at)
//   4. the Home banner count is readable       the banner's own query, AS ANON (the role the
//                                              app reads with; a service-role read would pass
//                                              even if RLS had locked users out)
//   5. no red duyurular-fetch run in 24 h      the workflow's own runs (GitHub API, GITHUB_TOKEN
//                                              with actions: read). Questions 1–4 read the DB, so
//                                              a red run that wrote nothing new left them unchanged:
//                                              run 39004347106 (2026-10-17) failed, the chain went
//                                              on, and nothing here would have named it.
// Read-only. Needs the service-role key for 1–3 (announcement_sources has no client access):
// the repo secret in CI; no Mac holds one.

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serviceRoleKey } from './lib/prod-write-guard.mjs'
import { closingSoonRange } from '../constants/duyurular.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const MAX_FETCH_GAP_H = 2
export const FAILING_RUNS = 3
export const MAX_NO_NEW_DAYS = 3
export const RED_RUN_WINDOW_H = 24
const H = 36e5, D = 864e5

export function verdict({ lastOk, failing, newest, banner, runs = { red: [] } }, now = Date.now()) {
  const problems = []
  if (!lastOk || now - Date.parse(lastOk) > MAX_FETCH_GAP_H * H) problems.push(`no successful fetch in ${MAX_FETCH_GAP_H}+ h (last ${lastOk ?? 'never'})`)
  if (failing.length) problems.push(`${failing.length} source(s) failing ${FAILING_RUNS}+ runs in a row: ${failing.join(', ')}`)
  if (!newest || now - Date.parse(newest) > MAX_NO_NEW_DAYS * D) problems.push(`no new item in ${MAX_NO_NEW_DAYS}+ days (newest ${newest ?? 'none'})`)
  if (banner.error) problems.push(`banner count unreadable as anon: ${banner.error}`)
  if (runs.error) problems.push(`duyurular-fetch runs unreadable: ${runs.error}`)
  else if (runs.red?.length) problems.push(`${runs.red.length} red duyurular-fetch run(s) in ${RED_RUN_WINDOW_H} h: ${runs.red.join(', ')}`)
  return problems
}

if (process.argv.includes('--self')) {
  const now = Date.parse('2026-10-11T12:00:00Z')
  const ok = { lastOk: '2026-10-11T11:40:00Z', failing: [], newest: '2026-10-10T08:00:00Z', banner: { count: 7 } }
  let bad = 0
  const t = (label, got, want) => { if (got !== want) bad++; console.log(`  ${got === want ? '✓' : '✗'} ${label} -> ${got} (want ${want})`) }
  console.log('\n── duyurular health self-test ──')
  t('all healthy                    ', verdict(ok, now).length, 0)
  t('last fetch 1h59m ago           ', verdict({ ...ok, lastOk: '2026-10-11T10:01:00Z' }, now).length, 0)
  t('last fetch 2h01m ago           ', verdict({ ...ok, lastOk: '2026-10-11T09:59:00Z' }, now).length, 1)
  t('never fetched                  ', verdict({ ...ok, lastOk: null }, now).length, 1)
  t('one source failing 3 runs      ', verdict({ ...ok, failing: ['khk-yukselme-munhal(3)'] }, now).length, 1)
  t('newest item 2d23h old          ', verdict({ ...ok, newest: '2026-10-08T13:00:00Z' }, now).length, 0)
  t('newest item 3d1h old           ', verdict({ ...ok, newest: '2026-10-08T11:00:00Z' }, now).length, 1)
  t('banner read error              ', verdict({ ...ok, banner: { error: '42501' } }, now).length, 1)
  t('banner count 0 is NOT an error ', verdict({ ...ok, banner: { count: 0 } }, now).length, 0)
  t('one red fetch run in 24 h      ', verdict({ ...ok, runs: { red: ['39004347106 (failure)'] } }, now).length, 1)
  t('fetch runs unreadable          ', verdict({ ...ok, runs: { error: 'HTTP 403' } }, now).length, 1)
  t('no token outside CI = skipped  ', verdict({ ...ok, runs: { skipped: true } }, now).length, 0)
  t('everything broken at once      ', verdict({ lastOk: null, failing: ['a(9)'], newest: null, banner: { error: 'x' }, runs: { red: ['1 (failure)'] } }, now).length, 5)
  console.log(bad ? `\nSELF-TEST FAILED (${bad})\n` : '\nself-test clean\n')
  process.exit(bad ? 1 : 0)
}

if (existsSync(resolve(ROOT, '.env'))) {
  for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
const { createClient } = await import('@supabase/supabase-js')
const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const svc = createClient(url, serviceRoleKey(), opts)
const anon = createClient(url, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, opts)

const { data: srcs, error: e1 } = await svc.from('announcement_sources').select('key, last_ok_at, consecutive_failures').eq('active', true)
if (e1) { console.error('read announcement_sources failed:', e1.code, e1.message); process.exit(2) }
const { data: top, error: e2 } = await svc.from('announcements').select('created_at').order('created_at', { ascending: false }).limit(1)
if (e2) { console.error('read announcements failed:', e2.code, e2.message); process.exit(2) }
const { from, to } = closingSoonRange()
const { count: bannerCount, error: e3 } = await anon.from('announcements').select('id', { count: 'exact', head: true })
  .eq('kind', 'open').gte('deadline_at', from).lte('deadline_at', to)

// Question 5. Completed runs created in the window; a run still waiting out its chain sleep is
// judged tomorrow. total_count is compared to rows received (a truncated page must not pass).
async function fetchRuns() {
  const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY
  if (!token || !repo) return process.env.CI ? { error: 'GITHUB_TOKEN/GITHUB_REPOSITORY not set' } : { skipped: true }
  const since = new Date(Date.now() - RED_RUN_WINDOW_H * H).toISOString().slice(0, 19) + 'Z'
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/duyurular-fetch.yml/runs?status=completed&per_page=100&created=%3E%3D${since}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } })
  if (!res.ok) return { error: `HTTP ${res.status}` }
  const body = await res.json()
  const list = body.workflow_runs || []
  if (body.total_count !== list.length) return { error: `TRUNCATED: ${list.length} of ${body.total_count} runs` }
  const red = list.filter(r => ['failure', 'timed_out', 'startup_failure'].includes(r.conclusion)).map(r => `${r.id} (${r.conclusion})`)
  return { red, total: list.length }
}
const runs = await fetchRuns()

const lastOk = srcs.map(s => s.last_ok_at).filter(Boolean).sort().at(-1) ?? null
const failing = srcs.filter(s => s.consecutive_failures >= FAILING_RUNS).map(s => `${s.key}(${s.consecutive_failures})`)
const newest = top?.[0]?.created_at ?? null
const banner = e3 || bannerCount == null ? { error: e3 ? `${e3.code} ${e3.message}` : 'no count returned' } : { count: bannerCount }
const problems = verdict({ lastOk, failing, newest, banner, runs })

const ago = ts => ts ? `${Math.round((Date.now() - Date.parse(ts)) / 6e4)} min ago` : '—'
console.log('\n── Duyurular pipeline health ──')
console.log(`  active sources      : ${srcs.length}`)
console.log(`  last successful fetch: ${lastOk ?? 'never'} (${ago(lastOk)}; limit ${MAX_FETCH_GAP_H} h)`)
console.log(`  failing ${FAILING_RUNS}+ in a row  : ${failing.length ? failing.join(', ') : 'none'}`)
console.log(`  newest item         : ${newest ?? 'none'} (limit ${MAX_NO_NEW_DAYS} days)`)
console.log(`  banner count (anon) : ${banner.error ? 'UNREADABLE — ' + banner.error : banner.count}`)
console.log(`  red fetch runs ${RED_RUN_WINDOW_H} h  : ${runs.skipped ? 'not checked (no GITHUB_TOKEN)' : runs.error ? 'UNREADABLE — ' + runs.error : `${runs.red.length} of ${runs.total}${runs.red.length ? ' — ' + runs.red.join(', ') : ''}`}`)
console.log(`  verdict             : ${problems.length ? 'FAIL\n    - ' + problems.join('\n    - ') : 'ok'}\n`)
process.exit(problems.length ? 1 : 0)

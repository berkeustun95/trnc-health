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
import { CERT_CLASS } from './duyurular/lib/runhealth.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const MAX_FETCH_GAP_H = 2
export const FAILING_RUNS = 3
export const MAX_NO_NEW_DAYS = 3
export const RED_RUN_WINDOW_H = 24
export const CERT_GROUP_MIN = 3

// 2026-10-17: 13 gov.ct.tr sources failed 190 runs with UNABLE_TO_VERIFY_LEAF_SIGNATURE and this
// check said only "13 source(s) failing". When CERT_GROUP_MIN+ failing sources share one TLS
// error class (the fetcher writes `[CLASS] …` into last_error), name it as a certificate change
// on their common domain. Output carries the class and the domain only (this log is public).
const commonSuffix = hosts => {
  const parts = hosts.map(h => h.split('.').reverse())
  const out = []
  for (let i = 0; parts.every(p => p[i] !== undefined && p[i] === parts[0][i]); i++) out.push(parts[0][i])
  return out.length >= 2 ? out.reverse().join('.') : hosts.slice().sort().join(', ')
}
export function certGroups(failingRows) {
  const by = new Map()
  for (const r of failingRows) {
    const cls = (/^\[([A-Z0-9_]+)\]/.exec(r.last_error || '') || [])[1]
    if (!cls || !CERT_CLASS.test(cls)) continue
    let host = ''
    try { host = new URL(r.url).host } catch { continue }
    if (!by.has(cls)) by.set(cls, [])
    by.get(cls).push(host)
  }
  return [...by].filter(([, hosts]) => hosts.length >= CERT_GROUP_MIN)
    .map(([cls, hosts]) => `certificate change on ${commonSuffix([...new Set(hosts)])}: ${hosts.length} sources fail with ${cls} (fix the chain in scripts/duyurular/lib/ca.mjs; never disable verification)`)
}
const H = 36e5, D = 864e5

// Question 5, red fetch runs (Berke 2026-10-19). Red when the LATEST completed run is red, or when
// 2+ runs in a row are red; one isolated red run is a warning. Run 39203331829 (27 sources timed
// out in 85 s, clean runs either side) kept the old "any red in 24 h" rule red for a whole day.
// `seq` is newest first; a run that is neither green nor red (cancelled, skipped) says nothing
// and is left out, so red · cancelled · red still counts as two in a row.
const RED_CONCLUSIONS = ['failure', 'timed_out', 'startup_failure']
export function runVerdict(seq = []) {
  const judged = seq.filter(r => r.conclusion === 'success' || RED_CONCLUSIONS.includes(r.conclusion))
  const isRed = r => RED_CONCLUSIONS.includes(r.conclusion)
  const label = r => `${r.id} (${r.conclusion})`
  const red = judged.filter(isRed)
  if (judged[0] && isRed(judged[0])) return { problem: `latest duyurular-fetch run is red: ${label(judged[0])}`, red }
  const streak = judged.findIndex((r, i) => i > 0 && isRed(r) && isRed(judged[i - 1]))
  if (streak > 0) return { problem: `2+ duyurular-fetch runs red in a row: ${label(judged[streak])}, ${label(judged[streak - 1])}`, red }
  if (red.length) return { warning: `${red.length} isolated red duyurular-fetch run(s) in ${RED_RUN_WINDOW_H} h, latest green: ${red.map(label).join(', ')}`, red }
  return { red }
}

export function verdict({ lastOk, failing, newest, banner, runs = { red: [] }, certs = [] }, now = Date.now()) {
  const problems = [...certs]
  if (!lastOk || now - Date.parse(lastOk) > MAX_FETCH_GAP_H * H) problems.push(`no successful fetch in ${MAX_FETCH_GAP_H}+ h (last ${lastOk ?? 'never'})`)
  if (failing.length) problems.push(`${failing.length} source(s) failing ${FAILING_RUNS}+ runs in a row: ${failing.join(', ')}`)
  if (!newest || now - Date.parse(newest) > MAX_NO_NEW_DAYS * D) problems.push(`no new item in ${MAX_NO_NEW_DAYS}+ days (newest ${newest ?? 'none'})`)
  if (banner.error) problems.push(`banner count unreadable as anon: ${banner.error}`)
  if (runs.error) problems.push(`duyurular-fetch runs unreadable: ${runs.error}`)
  else if (runs.seq) { const p = runVerdict(runs.seq).problem; if (p) problems.push(p) }
  return problems
}

// Info, never a problem: the fetcher completed a chain via AIA (lib/aia.mjs) and says so with a
// ::notice annotation. The fix worked; the nudge is to embed that intermediate in ca.mjs so the
// next run takes the fast path. Read from the LATEST completed fetch run only.
export const AIA_TITLE = 'chain completed via AIA'
export const aiaInfo = annotations => annotations.filter(a => a.annotation_level === 'notice' && a.title === AIA_TITLE).map(a => a.message)

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
  const g = id => ({ id, conclusion: 'success' }), x = id => ({ id, conclusion: 'failure' })
  const blip = [g(39205900740), x(39203331829), g(39201006186)]
  t('one isolated red run → not red ', verdict({ ...ok, runs: { seq: blip } }, now).length, 0)
  t('…but it is a warning           ', runVerdict(blip).warning?.startsWith('1 isolated red'), true)
  t('two red in a row → red         ', verdict({ ...ok, runs: { seq: [g(4), x(3), x(2), g(1)] } }, now).length, 1)
  t('red · cancelled · red → red    ', verdict({ ...ok, runs: { seq: [g(4), x(3), { id: 9, conclusion: 'cancelled' }, x(2)] } }, now).length, 1)
  t('latest run red → red           ', verdict({ ...ok, runs: { seq: [x(2), g(1)] } }, now).length, 1)
  t('latest red AND 2 in a row → 1 line', verdict({ ...ok, runs: { seq: [x(3), x(2), g(1)] } }, now).length, 1)
  t('two reds apart, latest green → not red', verdict({ ...ok, runs: { seq: [g(5), x(4), g(3), x(2), g(1)] } }, now).length, 0)
  t('timed_out counts as red        ', verdict({ ...ok, runs: { seq: [{ id: 2, conclusion: 'timed_out' }] } }, now).length, 1)
  t('latest cancelled, before it red → red', verdict({ ...ok, runs: { seq: [{ id: 3, conclusion: 'cancelled' }, x(2), g(1)] } }, now).length, 1)
  t('fetch runs unreadable          ', verdict({ ...ok, runs: { error: 'HTTP 403' } }, now).length, 1)
  t('no token outside CI = skipped  ', verdict({ ...ok, runs: { skipped: true } }, now).length, 0)
  t('everything broken at once      ', verdict({ lastOk: null, failing: ['a(9)'], newest: null, banner: { error: 'x' }, runs: { seq: [x(1)] } }, now).length, 5)
  const row = (host, cls) => ({ url: `https://${host}/x`, last_error: `[${cls}] fetch failed` })
  const gov = ['khk', 'saglik', 'rkmmd', 'ticaret'].map(h => row(`${h}.gov.ct.tr`, 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'))
  t('4 gov.ct.tr leaf-signature → named', certGroups(gov)[0]?.startsWith('certificate change on gov.ct.tr: 4 sources'), true)
  t('2 sharing a cert error → not grouped', certGroups(gov.slice(0, 2)).length, 0)
  t('3 timeouts → not a certificate change', certGroups(['a.gov.ct.tr', 'b.gov.ct.tr', 'c.gov.ct.tr'].map(h => row(h, 'timeout'))).length, 0)
  t('old last_error without a class → ignored', certGroups([1, 2, 3].map(i => ({ url: `https://s${i}.gov.ct.tr/`, last_error: 'fetch failed' }))).length, 0)
  t('cert group is its own verdict line', verdict({ ...ok, certs: certGroups(gov) }, now).length, 1)
  const notes = [{ annotation_level: 'notice', title: AIA_TITLE, message: 'khk.gov.ct.tr → YR2' }, { annotation_level: 'warning', title: AIA_TITLE, message: 'x' }, { annotation_level: 'notice', title: 'other', message: 'y' }]
  t('AIA notice → one info line      ', aiaInfo(notes).join('|'), 'khk.gov.ct.tr → YR2')
  t('AIA info is not a problem       ', verdict(ok, now).length, 0)
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

const { data: srcs, error: e1 } = await svc.from('announcement_sources').select('key, url, last_ok_at, consecutive_failures, last_error').eq('active', true)
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
  const seq = list.map(r => ({ id: r.id, conclusion: r.conclusion, created_at: r.created_at }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  return { seq, total: list.length }
}
const runs = await fetchRuns()

async function fetchAiaNotes(runId) {
  const gh = path => fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`,
    { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } })
  const jr = await gh(`/actions/runs/${runId}/jobs`)
  if (!jr.ok) return { error: `jobs HTTP ${jr.status}` }
  const lines = []
  for (const job of (await jr.json()).jobs || []) {
    const ar = await gh(`/check-runs/${job.id}/annotations?per_page=100`)
    if (!ar.ok) return { error: `annotations HTTP ${ar.status}` }
    lines.push(...aiaInfo(await ar.json()))
  }
  return { lines, runId }
}
const latestRun = runs.seq?.find(r => r.conclusion === 'success' || r.conclusion === 'failure')
const aia = latestRun ? await fetchAiaNotes(latestRun.id).catch(e => ({ error: e.message })) : null

const lastOk = srcs.map(s => s.last_ok_at).filter(Boolean).sort().at(-1) ?? null
const failing = srcs.filter(s => s.consecutive_failures >= FAILING_RUNS).map(s => `${s.key}(${s.consecutive_failures})`)
const newest = top?.[0]?.created_at ?? null
const banner = e3 || bannerCount == null ? { error: e3 ? `${e3.code} ${e3.message}` : 'no count returned' } : { count: bannerCount }
const certs = certGroups(srcs.filter(s => s.consecutive_failures >= FAILING_RUNS))
const problems = verdict({ lastOk, failing, newest, banner, runs, certs })

const ago = ts => ts ? `${Math.round((Date.now() - Date.parse(ts)) / 6e4)} min ago` : '—'
console.log('\n── Duyurular pipeline health ──')
console.log(`  active sources      : ${srcs.length}`)
console.log(`  last successful fetch: ${lastOk ?? 'never'} (${ago(lastOk)}; limit ${MAX_FETCH_GAP_H} h)`)
console.log(`  failing ${FAILING_RUNS}+ in a row  : ${failing.length ? failing.join(', ') : 'none'}`)
if (certs.length) console.log(`  ⚠ ${certs.join('\n  ⚠ ')}`)
console.log(`  newest item         : ${newest ?? 'none'} (limit ${MAX_NO_NEW_DAYS} days)`)
console.log(`  banner count (anon) : ${banner.error ? 'UNREADABLE — ' + banner.error : banner.count}`)
const rv = runs.seq ? runVerdict(runs.seq) : null
console.log(`  red fetch runs ${RED_RUN_WINDOW_H} h  : ${runs.skipped ? 'not checked (no GITHUB_TOKEN)' : runs.error ? 'UNREADABLE — ' + runs.error : `${rv.red.length} of ${runs.total}${rv.red.length ? ' — ' + rv.red.map(r => `${r.id} (${r.conclusion})`).join(', ') : ''}; latest ${runs.seq[0] ? `${runs.seq[0].id} (${runs.seq[0].conclusion})` : 'none'}`}`)
if (rv?.warning) console.log(`  ⚠ warning: ${rv.warning}`)
if (aia?.error) console.log(`  ℹ AIA notes unreadable (${aia.error}); info only`)
if (aia?.lines && !aia.lines.length) console.log(`  AIA notes (run ${aia.runId}): none`)
for (const l of aia?.lines || []) console.log(`  ℹ chain completed via AIA: ${l} (run ${aia.runId}); embed that intermediate in scripts/duyurular/lib/ca.mjs for the fast path`)
console.log(`  verdict             : ${problems.length ? 'FAIL\n    - ' + problems.join('\n    - ') : 'ok'}\n`)
process.exit(problems.length ? 1 : 0)

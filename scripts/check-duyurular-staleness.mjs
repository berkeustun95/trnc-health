#!/usr/bin/env node
// ─── duyurular:staleness — is what users see still current? ──────────────────
//
//   npm run duyurular:staleness            exit 1 when stale (daily-health)
//   npm run duyurular:staleness -- --self  offline boundary test
//
// Announcements EXPIRE (deadline + 30 d, else published + 60 d; RLS hides them), so a fetcher
// that silently stops leaves a screen that empties itself over weeks while every schema check
// stays green (CLAUDE.md: expiring content ships with a staleness check; hand/cron, not pre-push).
//   • at least MIN_VISIBLE rows visible AS ANON (what the app shows; 160 at go-live 2026-10-11)
//   • the newest visible item published within MAX_NEWEST_DAYS
//   • anon's count equals the service role's count of published, unexpired rows — a mismatch
//     means RLS and the publish switch disagree about what users should see.

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serviceRoleKey } from './lib/prod-write-guard.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const MIN_VISIBLE = 50
export const MAX_NEWEST_DAYS = 7

export function staleness({ visible, expected, newestPublished }, now = Date.now()) {
  const problems = []
  if (visible < MIN_VISIBLE) problems.push(`only ${visible} announcement(s) visible to users (floor ${MIN_VISIBLE})`)
  if (!newestPublished || (now - Date.parse(newestPublished)) / 864e5 > MAX_NEWEST_DAYS)
    problems.push(`newest visible item published ${newestPublished ?? 'never'} (limit ${MAX_NEWEST_DAYS} days)`)
  if (visible !== expected) problems.push(`anon sees ${visible}, service role counts ${expected} published + unexpired`)
  return problems
}

if (process.argv.includes('--self')) {
  const now = Date.parse('2026-10-11T12:00:00Z')
  const ok = { visible: 160, expected: 160, newestPublished: '2026-10-10T09:00:00Z' }
  let bad = 0
  const t = (label, got, want) => { if (got !== want) bad++; console.log(`  ${got === want ? '✓' : '✗'} ${label} -> ${got} (want ${want})`) }
  console.log('\n── duyurular staleness self-test ──')
  t('go-live state             ', staleness(ok, now).length, 0)
  t('exactly at the floor (50)  ', staleness({ ...ok, visible: 50, expected: 50 }, now).length, 0)
  t('below the floor (49)       ', staleness({ ...ok, visible: 49, expected: 49 }, now).length, 1)
  t('newest 6d23h old           ', staleness({ ...ok, newestPublished: '2026-10-04T13:00:00Z' }, now).length, 0)
  t('newest 7d1h old            ', staleness({ ...ok, newestPublished: '2026-10-04T11:00:00Z' }, now).length, 1)
  t('RLS / publish disagree     ', staleness({ ...ok, expected: 228 }, now).length, 1)
  t('empty                      ', staleness({ visible: 0, expected: 0, newestPublished: null }, now).length, 2)
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
const anon = createClient(url, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, opts)
const svc = createClient(url, serviceRoleKey(), opts)

const nowIso = new Date().toISOString()
const a = await anon.from('announcements').select('published_at', { count: 'exact' }).order('published_at', { ascending: false }).limit(1)
if (a.error) { console.error('anon read failed:', a.error.code, a.error.message); process.exit(2) }
const s = await svc.from('announcements').select('id', { count: 'exact', head: true }).eq('is_published', true).gt('expires_at', nowIso)
if (s.error) { console.error('service read failed:', s.error.code, s.error.message); process.exit(2) }

const input = { visible: a.count ?? 0, expected: s.count ?? 0, newestPublished: a.data?.[0]?.published_at ?? null }
const problems = staleness(input)
console.log('\n── Duyurular content staleness ──')
console.log(`  visible to users (anon)      : ${input.visible} (floor ${MIN_VISIBLE})`)
console.log(`  published + unexpired (svc)  : ${input.expected}`)
console.log(`  newest visible published_at : ${input.newestPublished ?? 'none'} (limit ${MAX_NEWEST_DAYS} days)`)
console.log(`  verdict                      : ${problems.length ? 'STALE\n    - ' + problems.join('\n    - ') : 'ok'}\n`)
process.exit(problems.length ? 1 : 0)

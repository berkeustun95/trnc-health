#!/usr/bin/env node
// ─── Novest sync health — the banner's query, outside the app ────────────────
//
//   node scripts/check-novest-staleness.mjs            # exit 1 if stale
//   node scripts/check-novest-staleness.mjs --self     # prove the threshold works
//
// Same query and same threshold as the AdminScreen banner, so this can be run from a
// terminal, a cron, or a CI step without opening the app.
//
// ⚠ THE THRESHOLD IS READ OUT OF AdminScreen.js, NOT COPIED.
//   A second literal `36` would drift the first time one side was tuned, and the drift
//   would be invisible — both would keep working and disagree about what "stale" means.
//   Metro does not reliably bundle .mjs, so importing a shared constant into the RN
//   screen is not safe; parsing the screen is. If the constant is renamed or removed,
//   this fails loudly rather than falling back to a guess.

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { SOURCE } from '../supabase/functions/_shared/novest-feed.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCREEN = resolve(ROOT, 'screens/AdminScreen.js')

function thresholdHours() {
  const src = readFileSync(SCREEN, 'utf8')
  const m = /const\s+NOVEST_STALE_HOURS\s*=\s*(\d+)/.exec(src)
  if (!m) {
    console.error('NOVEST_STALE_HOURS not found in screens/AdminScreen.js.')
    console.error('The banner and this check must agree; refusing to guess a threshold.')
    process.exit(2)
  }
  return Number(m[1])
}

const STALE_HOURS = thresholdHours()

// The banner's exact predicate, isolated so it can be tested without a database or a
// device. This is the whole of the banner's logic; everything else is presentation.
export const isStale = (lastSeenAt, now = Date.now()) =>
  !!lastSeenAt && (now - new Date(lastSeenAt).getTime()) / 36e5 >= STALE_HOURS

if (process.argv.includes('--self')) {
  const now = Date.parse('2026-08-24T12:00:00Z')
  const ago = h => new Date(now - h * 36e5).toISOString()
  let bad = 0
  const t = (label, got, want) => {
    const ok = got === want
    if (!ok) bad++
    console.log(`  ${ok ? '✓' : '✗'} ${label} -> ${got} (want ${want})`)
  }
  console.log(`\n── threshold read from AdminScreen.js: ${STALE_HOURS}h ──`)
  t('never synced (null)      ', isStale(null, now), false)
  t('1h ago                   ', isStale(ago(1), now), false)
  t(`${STALE_HOURS - 1}h ago (just under)     `, isStale(ago(STALE_HOURS - 1), now), false)
  t(`${STALE_HOURS}h ago (exactly at)     `, isStale(ago(STALE_HOURS), now), true)
  t(`${STALE_HOURS + 4}h ago (over)           `, isStale(ago(STALE_HOURS + 4), now), true)
  t('7 days ago               ', isStale(ago(168), now), true)
  console.log(bad ? `\nSELF-TEST FAILED (${bad})\n` : '\nself-test clean — the threshold fires on both sides of the boundary\n')
  if (bad) process.exit(1)
}

// ─── Live ────────────────────────────────────────────────────────────────────
if (existsSync(resolve(ROOT, '.env'))) {
  for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
const key = execFileSync('security', ['find-generic-password', '-s', 'ada-supabase-service-role', '-w'],
  { encoding: 'utf8' }).trim()
const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, key,
  { auth: { persistSession: false, autoRefreshToken: false } })

// Byte-identical to the AdminScreen query.
const { data, error } = await supabase.from('properties')
  .select('last_seen_at').eq('source', SOURCE)
  .order('last_seen_at', { ascending: false }).limit(1)
if (error) { console.error('read failed:', error.message); process.exit(2) }

const lastSeenAt = data?.[0]?.last_seen_at ?? null
const hours = lastSeenAt ? (Date.now() - new Date(lastSeenAt).getTime()) / 36e5 : null

console.log(`\n── novest sync health ──`)
console.log(`  last_seen_at (max) : ${lastSeenAt ?? 'never — the import has not run'}`)
console.log(`  age                : ${hours === null ? '—' : hours.toFixed(1) + 'h'}`)
console.log(`  threshold          : ${STALE_HOURS}h`)
console.log(`  banner             : ${isStale(lastSeenAt) ? 'SHOWING — sync is stale' : 'hidden — healthy'}\n`)
process.exit(isStale(lastSeenAt) ? 1 : 0)

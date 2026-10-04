#!/usr/bin/env node
// ─── hotels:health — is the KITOB list we show too old? ─────────────────────
//
//   npm run hotels:health            exit 1 when stale
//   npm run hotels:health -- --self  offline boundary test
//
// Hotels open, close and change class, and the only refresh is a new file from KITOB.
// source_list_date is the date PRINTED ON that list (the importer's --list-date), so this
// measures the age of the information, not of the last import run. The OLDEST listed row
// is the one that counts: every row of one import carries the same date, so a row older
// than the rest means a list that was only partly applied.
//
// Hand / cron, not pre-push (CLAUDE.md: expiring content ships with a staleness check).
// Needs the service-role key: rows are invisible to anon until published.

import { serviceRoleKey } from './lib/prod-write-guard.mjs'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const STALE_DAYS = 365

export const isStale = (listDate, now = Date.now()) =>
  !!listDate && (now - Date.parse(listDate)) / 864e5 > STALE_DAYS

if (process.argv.includes('--self')) {
  const now = Date.parse('2026-10-01T00:00:00Z')
  let bad = 0
  const t = (label, got, want) => {
    if (got !== want) bad++
    console.log(`  ${got === want ? '✓' : '✗'} ${label} -> ${got} (want ${want})`)
  }
  console.log(`\n── hotels staleness self-test (threshold ${STALE_DAYS} days) ──`)
  t('no list yet (null)     ', isStale(null, now), false)
  t('list from last month   ', isStale('2026-09-01', now), false)
  t('exactly a year ago     ', isStale('2025-10-01', now), false)
  t('a year and two days    ', isStale('2025-09-29', now), true)
  t('the 2023 site list     ', isStale('2023-06-01', now), true)
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
const key = serviceRoleKey()   // repo secret in CI (daily-health workflow); no Mac holds one
const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, key,
  { auth: { persistSession: false, autoRefreshToken: false } })

const { data, error, count } = await supabase.from('hotels')
  .select('source_list_date', { count: 'exact' }).is('delisted_at', null)
  .order('source_list_date', { ascending: true }).limit(1)
if (error) { console.error('read failed:', error.message); process.exit(2) }

const oldest = data?.[0]?.source_list_date ?? null
const days = oldest ? Math.floor((Date.now() - Date.parse(oldest)) / 864e5) : null
console.log(`\n── KITOB hotels list health ──`)
console.log(`  listed hotels      : ${count ?? 0}`)
console.log(`  oldest list date   : ${oldest ?? 'none — nothing imported yet'}`)
console.log(`  age                : ${days === null ? '—' : days + ' days'} (threshold ${STALE_DAYS})`)
console.log(`  verdict            : ${isStale(oldest) ? 'STALE — ask KITOB for a current list' : 'ok'}\n`)
process.exit(isStale(oldest) ? 1 : 0)

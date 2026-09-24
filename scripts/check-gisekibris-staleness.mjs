#!/usr/bin/env node
// ─── Gişe Kıbrıs CONTENT staleness ───────────────────────────────────────────
//
//   npm run gisekibris:health
//   node scripts/check-gisekibris-staleness.mjs
//
// Sibling of check-duty-staleness.mjs / check-novest-staleness.mjs / check-pets-
// staleness.mjs, and it exists for the reason CLAUDE.md records about the duty
// roster: every other check in this repo asks whether a COLUMN EXISTS. None asked
// whether the CONTENT IS CURRENT, and that is the failure that reached users — the
// roster ran out and passed every schema check for two months, because an empty
// table has a perfectly correct schema.
//
// ─── WHAT IT ASKS, AND WHY THE EXIT CODE IS NOT ENOUGH ──────────────────────
//
// The daily job's exit code catches a CRASH. It cannot catch the failures that
// look like success, and those are the ones that reach users:
//
//   · the feed answers 200 with last week's data, so nothing errors and nothing
//     updates;
//   · the partner key is rotated and the endpoint starts returning a valid,
//     EMPTY-shaped success (the fetch guard refuses it, the job fails, fine) —
//     or a valid response for a different, empty account (it does not);
//   · the workflow is disabled, renamed or silently unscheduled, and simply
//     stops running. Nothing fails, because nothing runs.
//
// So this asks two content questions instead:
//   1. IS ANYTHING STILL ARRIVING? The newest updated_at on source='gisekibris'
//      must be inside MAX_AGE_H. The importer stamps updated_at on every row it
//      writes, so a healthy daily run refreshes this continuously.
//   2. CAN A USER STILL SEE ANYTHING? A guest session must see at least one
//      approved, in-window event. This is the half that would have caught the
//      duty roster: a catalogue can be perfectly fresh and still show nobody
//      anything.
//
// NOT in pre-push. CLAUDE.md is explicit: a push must not be blocked because
// content is running low — that is data operations, and a guard that blocks
// unrelated work gets disabled. Run it from the scheduled job and by hand.
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = 'gisekibris'

// 48h, not 24h: the job is daily, so a single missed run is not yet a fault and
// paging on it would train the reader to ignore this. Two consecutive misses is.
const MAX_AGE_H = 48
const warnOnly = process.argv.includes('--warn')

function loadEnv() {
  const p = resolve(ROOT, '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
loadEnv()

const URL_ = process.env.EXPO_PUBLIC_SUPABASE_URL
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
if (!URL_ || !ANON) { console.error('EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY missing'); process.exit(1) }
let svc
try {
  svc = execFileSync('security', ['find-generic-password','-s','ada-supabase-service-role','-w'],
    { encoding:'utf8', stdio:['ignore','pipe','ignore'] }).trim()
} catch { svc = process.env.SUPABASE_SERVICE_ROLE_KEY }
if (!svc) { console.error('No service-role key (Keychain or SUPABASE_SERVICE_ROLE_KEY)'); process.exit(1) }

const admin = createClient(URL_, svc, { auth:{persistSession:false, autoRefreshToken:false} })
let problems = []
console.log('\nGişe Kıbrıs content health')

// ── 1. is anything still arriving? ─────────────────────────────────────────
const { data: fresh, error: e1 } = await admin.from('events')
  .select('external_id,title,updated_at').eq('source', SOURCE)
  .order('updated_at', { ascending:false }).limit(1)
if (e1) { console.error(`  read failed: ${e1.message}`); process.exit(1) }
if (!fresh?.length) {
  problems.push(`no source='${SOURCE}' rows at all`)
  console.log(`  ⛔ zero ${SOURCE} rows`)
} else {
  const ageH = (Date.now() - new Date(fresh[0].updated_at)) / 36e5
  const ok = ageH <= MAX_AGE_H
  if (!ok) problems.push(`newest updated_at is ${ageH.toFixed(1)}h old (cap ${MAX_AGE_H}h) — the import may have stopped running`)
  console.log(`  ${ok ? '✓' : '⛔'} newest updated_at: ${ageH.toFixed(1)}h ago (cap ${MAX_AGE_H}h) — ${fresh[0].title.slice(0,40)}`)
}

const { count: total } = await admin.from('events').select('*', {count:'exact', head:true}).eq('source', SOURCE)
const { count: approved } = await admin.from('events').select('*', {count:'exact', head:true}).eq('source', SOURCE).eq('status','approved')
console.log(`    ${total} rows · ${approved} approved`)

// ── 2. can a user still SEE anything? ──────────────────────────────────────
// A guest, because that is what the app is: signInAnonymously() carries a real
// auth.uid() and `read approved events` is TO authenticated, so a bare anon key
// reads ZERO by design and would be the wrong instrument here.
const guest = createClient(URL_, ANON, { auth:{persistSession:false, autoRefreshToken:false} })
const { error: sErr } = await guest.auth.signInAnonymously()
if (sErr) {
  problems.push(`could not open a guest session: ${sErr.message}`)
  console.log(`  ⛔ guest sign-in failed: ${sErr.message}`)
} else {
  const cutoff = new Date(Date.now() - 24*60*60*1000).toISOString()
  const { count: visible, error: vErr } = await guest.from('events')
    .select('*', {count:'exact', head:true})
    .eq('status','approved').gte('start_date', cutoff)
  if (vErr) {
    problems.push(`guest read failed: ${vErr.message}`)
    console.log(`  ⛔ guest read failed: ${vErr.message}`)
  } else {
    const ok = (visible ?? 0) > 0
    if (!ok) problems.push('a guest sees ZERO events in the 24h window — the Events screen is empty for every user')
    console.log(`  ${ok ? '✓' : '⛔'} a guest sees ${visible} event(s) in the now−24h window`)
  }
}

// ── verdict ────────────────────────────────────────────────────────────────
if (!problems.length) {
  console.log('\n  OK — content is current and visible.')
  console.log('  (Says nothing about whether the SCHEDULER is still running; that is what')
  console.log('   check 1 covers indirectly and the weekly summary covers directly.)\n')
  process.exit(0)
}
console.log('')
for (const p of problems) console.log(`  ⛔ ${p}`)
console.log('')
if (warnOnly) { console.log('  (--warn: reporting only)\n'); process.exit(0) }
process.exit(1)

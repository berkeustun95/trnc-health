#!/usr/bin/env node
// ─── Provider & admin notification health ────────────────────────────────────
//
//   node scripts/check-notify-health.mjs           # exit 1 if a flow is below threshold
//   node scripts/check-notify-health.mjs --days 60 # widen the window
//   node scripts/check-notify-health.mjs --self    # prove the matcher can fail
//
// ─── THE FAILURE CLASS THIS CLOSES ──────────────────────────────────────────
//
// utils/notify.js read the provider's profile from the CLIENT to get a push_token. No
// RLS policy has ever permitted that, so it returned zero rows, and the code read "zero
// rows" as "this provider has no token" — a legitimate state. Pushes were never even
// attempted, for 70 days, and nothing anywhere could tell the two apart.
//
// The same shape twice more: ContentReportMenu and ProviderOnboardingScreen read admin
// profiles the same way, looped over an empty array, and wrote neither a push nor an
// in-app row. NO ADMIN HAD BEEN ALERTED TO A CONTENT REPORT.
//
// This is the duty_list lesson in a different costume. verify_schema.sql asks whether an
// object EXISTS; the migration ledger asks whether a file was APPLIED. Neither can ask
// whether a thing that is supposed to happen every day is actually happening. That
// question needs a CONTENT check, and this is it.
//
// ─── WHY IT IS NOT IN pre-push ──────────────────────────────────────────────
//
// A push must not be blocked because notification delivery dipped — that is operations,
// and a guard that blocks unrelated work gets disabled. Same posture as
// check-duty-staleness.mjs and check-novest-staleness.mjs: run it by hand
// (`npm run notify:health`) or from a cron.
//
// ─── BORN RED, WHICH IS THE POINT ───────────────────────────────────────────
//
// A check nobody has watched fail is a decoration. This one does not need anything
// broken to demonstrate that: run it against production BEFORE 20260923 + the client OTA
// and the question flow reports ~0%, because that is the true, live state. Ship the fix,
// run it again, and it goes green. Full red→green on real data, nothing staged.
//
// ─── WHAT IT CAN AND CANNOT PROVE ───────────────────────────────────────────
//
// It proves the in-app `notifications` row was written — the half that is synchronous
// and transactional. It does NOT prove a device buzzed: Expo returns HTTP 200 even for a
// failed ticket. push_log (20260923) records that we ASKED, which is the next-best thing
// and is reported below once the migration is live.

import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { t, LANG_CODES } from '../constants/i18n.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ─── Thresholds ─────────────────────────────────────────────────────────────
//
// 95%, not 100%. A notification can legitimately be missing: the row was created by a
// path that does not notify (an admin inserting a test appointment), or an event landed
// in the last few seconds of the window. Demanding 100% would make this cry wolf, and a
// check that cries wolf teaches you to ignore it — which is how the thing it guards dies
// a second time.
const PASS_PCT = 95
// The window between the event row and its notification. notify_facility_owner runs
// immediately after the insert in the same user action, so this is generous by ~100x;
// it exists to absorb clock skew between rows, not latency.
const WINDOW_BEFORE_MS = 5_000
const WINDOW_AFTER_MS  = 120_000
const DEFAULT_DAYS = 30

const c = { r: s => `\x1b[31m${s}\x1b[0m`, g: s => `\x1b[32m${s}\x1b[0m`,
            y: s => `\x1b[33m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m` }

// Matching an event to its notification: same recipient, inside the window.
// Deliberately NOT also matching on title — see the drift note where it is used.
function matches(eventTs, notifTsList) {
  const e = new Date(eventTs).getTime()
  return notifTsList.some(n => n >= e - WINDOW_BEFORE_MS && n <= e + WINDOW_AFTER_MS)
}

// ─── --self: prove the matcher can actually say NO ──────────────────────────
//
// The failure mode for a check like this is a matcher so loose that everything passes —
// which would have reported this very outage as healthy. So assert both verdicts.
if (process.argv.includes('--self')) {
  const base = Date.parse('2026-08-27T12:00:00Z')
  const cases = [
    ['notification 1s after the event',      base, [base + 1_000],   true],
    ['notification 119s after the event',    base, [base + 119_000], true],
    ['notification 3s BEFORE (clock skew)',  base, [base - 3_000],   true],
    ['notification 10 minutes later',        base, [base + 600_000], false],
    ['notification 1 hour BEFORE',           base, [base - 3_600_000], false],
    ['no notification at all',               base, [],               false],
  ]
  let bad = 0
  for (const [label, ev, notifs, want] of cases) {
    const got = matches(new Date(ev).toISOString(), notifs)
    const ok = got === want
    if (!ok) bad++
    console.log(`  ${ok ? c.g('PASS') : c.r('FAIL')}  ${label} → ${got} (want ${want})`)
  }
  console.log(bad ? c.r(`\n${bad} self-test failure(s)\n`) : c.g('\nmatcher accepts and REJECTS correctly\n'))
  process.exit(bad ? 1 : 0)
}

// ─── Credentials — macOS Keychain, never .env ───────────────────────────────
//
// appointments / questions / notifications / push_log are all RLS-protected and
// correctly return zero rows to the anon key, so this needs the service_role key. Same
// source as the Gişe Kıbrıs and Novest importers: the Keychain, never a file.
// scripts/check-secrets.mjs enforces that, and rotate-cron-to-vault.sql explains why
// rotating this key after a leak is so painful that not leaking it is the whole strategy.
// Only the URL comes from .env (it is public and already in the client bundle).
if (existsSync(resolve(ROOT, '.env'))) {
  for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL
if (!URL) {
  console.error(c.r('\n  EXPO_PUBLIC_SUPABASE_URL missing — expected in .env\n'))
  process.exit(2)
}
let KEY
try {
  KEY = execFileSync('security', ['find-generic-password', '-s', 'ada-supabase-service-role', '-w'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
} catch {
  console.error(c.r('\n  Keychain entry "ada-supabase-service-role" not found.'))
  console.error(c.d('  The anon key cannot see appointments/questions/notifications (RLS), so it'))
  console.error(c.d('  would report a perfect 0/0 and tell you nothing.\n'))
  process.exit(2)
}
if (!KEY) { console.error(c.r('\n  Keychain entry "ada-supabase-service-role" is empty.\n')); process.exit(2) }
if (KEY.startsWith('sb_publishable_')) {
  console.error(c.r('\n  Keychain holds the PUBLISHABLE key, not the secret one.'))
  console.error(c.d('  It is bound by RLS, so every flow below would read 0/0 and look healthy.\n'))
  process.exit(2)
}
const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } })

// ─── Truncation, and why the guard cannot be a number I choose ──────────────
//
// PostgREST truncates silently, and — measured on this project, 2026-08-27 — the SERVER's
// `max-rows` is 1000 and it OVERRIDES a larger client `.limit()`. A `.limit(5000)` guard
// checking `rows >= 5000` therefore never fires: the fetch comes back with exactly 1000
// rows, looking like a complete answer. That is the truncated-index failure from the OSM
// audit wearing the costume of its own fix.
//
// So the guard does not compare against a cap I picked. It asks the server for the TOTAL
// via `count: 'exact'` and compares that to what actually arrived. Any shortfall, at any
// cap, from any future config change, is truncation — and exits 2 (could not measure)
// rather than 1 (measured, and it is bad). Those are different answers and this script
// must never confuse them.
//
// `notifications` already crosses it: the duty-pharmacy blast writes one row per profile
// per day, so 30 days is thousands of rows. That is why the fetch below is filtered to
// the recipients we actually care about instead of pulling the whole table.
async function fetchAll(label, query) {
  const { data, error, count } = await query
  if (error) throw new Error(`${label}: ${error.message}`)
  const rows = data ?? []
  if (count != null && rows.length < count) {
    console.error(c.r(`\n  ${label}: server returned ${rows.length} of ${count} rows — TRUNCATED.`))
    console.error(c.d('  Any percentage from here would measure a slice while reporting as if it'))
    console.error(c.d('  measured everything. Narrow the window with --days.\n'))
    process.exit(2)
  }
  return rows
}

const argDays = process.argv.indexOf('--days')
const DAYS = argDays !== -1 ? Number(process.argv[argDays + 1]) || DEFAULT_DAYS : DEFAULT_DAYS
const since = new Date(Date.now() - DAYS * 86400_000).toISOString()

// Every localized title the two owner flows can produce, from constants/i18n.js — the
// same source the SQL in 20260923 was ported from, so there is no second copy here.
const titlesFor = key => new Set(Object.keys(LANG_CODES).map(l => t(key, l)))

async function run() {
  console.log(`\n  Notification health — last ${DAYS} days (since ${since.slice(0, 10)})\n`)

  const [facilities, admins, claims] = await Promise.all([
    fetchAll('facilities', sb.from('facilities')
      .select('id, provider_id', { count: 'exact' }).not('provider_id', 'is', null)),
    fetchAll('admin profiles', sb.from('profiles')
      .select('id', { count: 'exact' }).eq('role', 'admin')),
    fetchAll('claim_requests', sb.from('claim_requests')
      .select('facility_id, created_at', { count: 'exact' })),
  ])
  const ownerOf = new Map(facilities.map(f => [f.id, f.provider_id]))
  const adminIds = new Set(admins.map(a => a.id))

  // ─── OWNERSHIP PROVENANCE — without this the check CRIES WOLF ──────────────
  //
  // `facilities.provider_id` is the owner NOW. It is not evidence of who owned the
  // facility when the appointment was made — and notifyProvider's first line is
  // `if (!facility.provider_id) return`, so a booking at a then-unclaimed facility is
  // CORRECTLY silent. Scoring it as a miss blames the code for doing the right thing.
  //
  // Measured 2026-08-27: of 5 facilities with a provider_id, only 2 have a
  // claim_requests row at all. The rest were claimed by hand, so their ownership date is
  // unknowable — including `Poyritoooo`, which supplied BOTH of the post-branch-3
  // appointments I nearly used to declare the in-app path dead.
  //
  // So an event is only SCORED when ownership is provable at that moment: a claim row
  // for that facility, created at or before the event. Everything else is reported as
  // UNVERIFIABLE and excluded from the percentage. Per the no-silent-caps rule, what is
  // dropped is printed — a check that quietly narrows its denominator is lying about
  // its coverage.
  const claimedSince = new Map()
  for (const c of claims) {
    const t = new Date(c.created_at).getTime()
    if (!claimedSince.has(c.facility_id) || t < claimedSince.get(c.facility_id)) {
      claimedSince.set(c.facility_id, t)
    }
  }
  const ownershipProvable = (facilityId, at) => {
    const since = claimedSince.get(facilityId)
    return since != null && new Date(at).getTime() >= since
  }

  // Only the recipients this check is about. Pulling `notifications` wholesale would be
  // thousands of duty-blast rows for users we are not measuring — and would truncate.
  const recipients = [...new Set([...ownerOf.values(), ...adminIds])].filter(Boolean)
  const notifications = recipients.length
    ? await fetchAll('notifications', sb.from('notifications')
        .select('user_id, title, created_at', { count: 'exact' })
        .in('user_id', recipients).gte('created_at', since))
    : []

  // recipient -> sorted notification timestamps, and recipient -> titles seen
  const byUser = new Map()
  const titlesByUser = new Map()
  for (const n of notifications) {
    if (!byUser.has(n.user_id)) { byUser.set(n.user_id, []); titlesByUser.set(n.user_id, []) }
    byUser.get(n.user_id).push(new Date(n.created_at).getTime())
    titlesByUser.get(n.user_id).push({ ts: new Date(n.created_at).getTime(), title: n.title })
  }

  const rows = []

  // ── owner flows: appointment + question ──
  for (const [label, table, titleKey] of [
    ['appointment → provider', 'appointments', 'notifNewApptTitle'],
    ['question → provider',    'questions',    'notifNewQuestionTitle'],
  ]) {
    const all = await fetchAll(table, sb.from(table)
      .select('facility_id, created_at', { count: 'exact' }).gte('created_at', since))
    const owned = all.filter(e => ownerOf.has(e.facility_id))
    const events = owned.filter(e => ownershipProvable(e.facility_id, e.created_at))
    const unverifiable = owned.length - events.length
    const expected = titlesFor(titleKey)
    let hit = 0, titleHit = 0
    for (const e of events) {
      const owner = ownerOf.get(e.facility_id)
      const ts = byUser.get(owner) ?? []
      if (matches(e.created_at, ts)) {
        hit++
        const evMs = new Date(e.created_at).getTime()
        const inWindow = (titlesByUser.get(owner) ?? [])
          .filter(x => x.ts >= evMs - WINDOW_BEFORE_MS && x.ts <= evMs + WINDOW_AFTER_MS)
        if (inWindow.some(x => expected.has(x.title))) titleHit++
      }
    }
    rows.push({ label, total: events.length, hit, titleHit,
                skipped: all.length - owned.length, unverifiable })
  }

  // ── admin flow: content reports ──
  {
    const events = await fetchAll('content_reports',
      sb.from('content_reports').select('created_at', { count: 'exact' }).gte('created_at', since))
    let hit = 0
    for (const e of events) {
      // Any admin notified counts — the flow fans out to all of them.
      if ([...adminIds].some(id => matches(e.created_at, byUser.get(id) ?? []))) hit++
    }
    rows.push({ label: 'content report → admins', total: events.length, hit, titleHit: null, skipped: 0 })
  }

  // ── admin flow: facility submissions ──
  {
    const events = await fetchAll('claim_requests',
      sb.from('claim_requests').select('created_at', { count: 'exact' }).gte('created_at', since))
    let hit = 0
    for (const e of events) {
      if ([...adminIds].some(id => matches(e.created_at, byUser.get(id) ?? []))) hit++
    }
    rows.push({ label: 'facility submission → admins', total: events.length, hit, titleHit: null, skipped: 0 })
  }

  // ── report ──
  let failed = 0, measured = 0
  for (const r of rows) {
    if (r.total === 0) {
      // NOT a pass and NOT a failure. Zero events means the check had nothing to measure,
      // and reporting that as green is exactly how a broken thing looks healthy.
      const why = r.unverifiable
        ? `all ${r.unverifiable} event(s) excluded — ownership at event time unprovable`
        : 'no events in window — nothing measured'
      console.log(`  ${c.y('n/a ')}  ${r.label.padEnd(30)} ${c.d(why)}`)
      continue
    }
    measured++
    const pct = Math.round((r.hit / r.total) * 100)
    const ok = pct >= PASS_PCT
    if (!ok) failed++
    console.log(`  ${ok ? c.g('PASS') : c.r('FAIL')}  ${r.label.padEnd(30)} ${String(pct).padStart(3)}%  (${r.hit}/${r.total} notified)`)
    if (r.titleHit !== null && r.hit > 0 && r.titleHit < r.hit) {
      // PRINTS, does not fail. A title we do not recognise still proves a notification
      // was sent; it means constants/i18n.js and notify_owner_text() (20260923) have
      // drifted apart — two copies of the same strings, one in each language, exactly
      // like NON_CLAIMABLE_CATEGORIES. Worth knowing, not worth blocking on.
      console.log(`        ${c.y('drift:')} ${r.hit - r.titleHit} of ${r.hit} carried a title not in constants/i18n.js`)
    }
    if (r.skipped) console.log(`        ${c.d(`${r.skipped} at unclaimed facilities — no owner to notify, correctly skipped`)}`)
    if (r.unverifiable) console.log(`        ${c.y(`${r.unverifiable} excluded:`)} ${c.d('facility has no claim_requests row, so ownership at event time is unprovable')}`)
  }

  // ── push_log, once 20260923 is live ──
  const { data: pushRows, error: pushErr } = await sb
    .from('push_log').select('kind, request_id').gte('sent_at', since)
  console.log('')
  if (pushErr) {
    console.log(`  ${c.d('push_log not present yet (20260923 not applied) — in-app rows only above')}`)
  } else {
    const by = {}
    for (const p of pushRows ?? []) {
      by[p.kind] ??= { total: 0, sent: 0 }
      by[p.kind].total++
      if (p.request_id !== null) by[p.kind].sent++
    }
    if (!Object.keys(by).length) {
      console.log(`  ${c.d('push_log is empty — no notifications sent since the migration')}`)
    } else {
      for (const [k, v] of Object.entries(by)) {
        console.log(`  ${c.d('push')}  ${k.padEnd(28)} ${v.sent}/${v.total} had a token ${c.d('(request sent to Expo; not proof of delivery)')}`)
      }
    }
  }

  if (measured === 0) {
    console.log(c.y('\n  Nothing measured. Widen with --days, or wait for traffic.\n'))
    process.exit(0)
  }
  if (failed) {
    console.log(c.r(`\n  ${failed} flow(s) below ${PASS_PCT}%. Providers or admins are not being told.\n`))
    process.exit(1)
  }
  console.log(c.g(`\n  All ${measured} measured flow(s) at or above ${PASS_PCT}%.\n`))
}

run().catch(e => { console.error(c.r('\n  ' + e.message + '\n')); process.exit(2) })

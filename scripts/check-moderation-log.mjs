#!/usr/bin/env node
// ─── Moderation rejection-log probe ──────────────────────────────────────────
//
//   npm run moderation:log
//
// Asserts that a rejected submission actually LEAVES A RECORD, and that nobody who
// should not read that record can. Written before 20260926_moderation_rejection_log.sql
// and confirmed RED first.
//
// ─── THE ASSERTION THAT MATTERS, AND HOW IT AVOIDS VERIFYING ITSELF ─────────
//
// "The log is non-empty after a rejection" is the one that catches a design error, and
// it is also the one easiest to fake. The obvious version — insert, then SELECT the row
// back — is structurally broken here, because the log denies SELECT to everyone except
// admins. Run as the submitting user it returns 0 rows whether the insert worked or not:
// pinned to the same answer by RLS, not by the truth. That is the exact failure CLAUDE.md
// records ("never verify a write from inside the role that is not allowed to read it").
//
// So the existence proof comes through a DIFFERENT surface: blocked_terms.hit_count is
// incremented by the same trigger in the same transaction, and blocked_terms is world-
// readable by design (the client downloads it for the inline preview). If the counter
// moves, the row was written. The probe therefore never reads the log at all — and its
// inability to read it is itself one of the assertions.
//
// ─── WHY A REJECTION IS SELF-REPORTED BY THE CLIENT ─────────────────────────
//
// All six content triggers reject with RAISE EXCEPTION, which aborts the transaction. A
// log row written inside the trigger is rolled back with it — a logger that is silently
// and permanently empty. So the client re-submits the attempt as its own INSERT, in a new
// transaction that commits. The matched term is computed server-side by the trigger on
// the log table and always overwritten, so the client can neither choose it nor read it.
//
// ─── WHAT THIS CANNOT SEE ───────────────────────────────────────────────────
//
// Admin READ of the log needs an admin JWT, which this repo does not have — only the anon
// key, plus an optional test login. That half is verified by the paste-and-run block at
// the foot of the migration, as `postgres`. Named, not skipped silently.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const URL_ = process.env.EXPO_PUBLIC_SUPABASE_URL
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
const TEST_EMAIL = process.env.ADA_TEST_EMAIL
const TEST_PASSWORD = process.env.ADA_TEST_PASSWORD
if (!URL_ || !KEY) { console.error('  missing EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY'); process.exit(1) }

let failed = 0, skipped = 0
const ok = (name, pass, detail = '') => {
  if (!pass) failed++
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`)
}
const skip = (name, why) => { skipped++; console.log(`  SKIP ${name}  — ${why}`) }

const rest = (path, opts = {}, token = null) => fetch(`${URL_}/rest/v1/${path}`, {
  ...opts,
  headers: {
    apikey: KEY,
    Authorization: `Bearer ${token || KEY}`,
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  },
})

const hitCount = async term => {
  const r = await rest(`blocked_terms?term=eq.${encodeURIComponent(term)}&select=term,hit_count,last_hit_at`)
  if (!r.ok) return { error: `${r.status} ${(await r.text()).slice(0, 120)}` }
  const rows = await r.json()
  return rows.length ? rows[0] : { error: 'term not found' }
}

const run = async () => {
  // ── Controls first. If blocked_terms is unreadable or empty, nothing below means
  // anything, and every later assertion would report a tidy, confident false.
  console.log('  ── controls ──────────────────────────────────────────────────────────')
  const btr = await rest('blocked_terms?select=term&limit=5')
  const btRows = btr.ok ? await btr.json() : []
  ok('CONTROL blocked_terms is readable and non-empty', btr.ok && btRows.length > 0,
    btr.ok ? `${btRows.length} rows sampled` : `HTTP ${btr.status}`)
  if (!btr.ok || !btRows.length) { console.error('\n  controls failed — aborting.\n'); process.exit(1) }

  console.log('\n  ── schema ────────────────────────────────────────────────────────────')
  const mr = await rest('moderation_rejections?select=id&limit=1')
  const mrBody = await mr.text()
  // A missing table is 404/PGRST205. An existing table with no SELECT policy for anon is
  // 200 + []. Those must be told apart, or "the table is empty" and "the table does not
  // exist" read identically — which is how a probe reports success at nothing.
  const tableExists = mr.status !== 404 && !mrBody.includes('PGRST205')
  ok('moderation_rejections exists', tableExists, `HTTP ${mr.status}`)

  const hc = await hitCount(btRows[0].term)
  ok('blocked_terms.hit_count / last_hit_at exist', !hc.error && 'hit_count' in hc,
    hc.error || `hit_count=${hc.hit_count}`)

  console.log('\n  ── the oracle must stay shut ─────────────────────────────────────────')
  // NOTE the weakness, stated rather than hidden: an empty table also returns []. This
  // assertion only becomes meaningful once the authenticated block below has written a
  // row — which is why it is re-run there.
  const anonRows = tableExists && mr.ok ? JSON.parse(mrBody).length : 0
  ok('anon reads zero rows from the log', anonRows === 0, 'weak until a row exists (re-checked below)')

  const anonIns = await rest('moderation_rejections', {
    method: 'POST',
    body: JSON.stringify({ content_type: 'review', content_text: 'fuck this place' }),
  })
  ok('anon INSERT into the log is denied', anonIns.status >= 400, `HTTP ${anonIns.status}`)

  console.log('\n  ── end to end: a rejection leaves a record ────────────────────────────')
  if (!TEST_EMAIL || !TEST_PASSWORD) {
    skip('self-report writes a row (proved via hit_count)', 'set ADA_TEST_EMAIL / ADA_TEST_PASSWORD in .env')
    skip('matched_term cannot be forged by the client', 'same')
    skip('a non-rejection is refused', 'same')
    skip('the author cannot read their own rejection', 'same')
  } else {
    const auth = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    })
    const token = auth.ok ? (await auth.json()).access_token : null
    ok('CONTROL test user signs in', !!token, token ? '' : `HTTP ${auth.status}`)

    if (token) {
      const term = 'fuck'
      const before = await hitCount(term)
      const forgedBefore = await hitCount('salak')

      // The client claims a DIFFERENT term than the text contains. The server must
      // ignore the claim: if it did not, an admin triaging false positives would be
      // reading whatever the submitting client felt like writing.
      const ins = await rest('moderation_rejections', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          content_type: 'review',
          content_text: 'probe: fuck this place',
          matched_term: 'salak',
        }),
      }, token)
      ok('self-report INSERT succeeds', ins.status < 400, `HTTP ${ins.status}`)

      const after = await hitCount(term)
      ok('the row was written (hit_count advanced)',
        !before.error && !after.error && after.hit_count === before.hit_count + 1,
        `${before.hit_count} -> ${after.hit_count}`)

      // Compare the forged term's counter across the INSERT, not against itself a moment
      // later — the first draft did the latter, which is true whether or not the trigger
      // honoured the client's claim. A check with no red to go to.
      const forgedAfter = await hitCount('salak')
      ok('matched_term cannot be forged (claimed term did NOT advance)',
        !forgedBefore.error && !forgedAfter.error &&
        forgedAfter.hit_count === forgedBefore.hit_count,
        `salak ${forgedBefore.hit_count} -> ${forgedAfter.hit_count} (must not move)`)

      const clean = await rest('moderation_rejections', {
        method: 'POST',
        body: JSON.stringify({ content_type: 'review', content_text: 'a perfectly ordinary review' }),
      }, token)
      ok('a non-rejection is refused', clean.status >= 400, `HTTP ${clean.status}`)

      // NOW the oracle test means something: a row provably exists, so 0 rows is RLS
      // doing its job rather than an empty table answering the same way.
      const mine = await rest('moderation_rejections?select=id,matched_term', {}, token)
      const mineRows = mine.ok ? await mine.json() : []
      ok('the author cannot read their own rejection', mineRows.length === 0,
        `${mineRows.length} rows visible to the submitting user`)
    }
  }

  console.log('')
  if (skipped) console.log(`  ${skipped} assertion(s) SKIPPED — the end-to-end half did not run.`)
  if (failed) { console.error(`  ${failed} FAILING.\n`); process.exit(1) }
  if (skipped) { console.error('  Not a pass: the assertion that matters most was skipped.\n'); process.exit(1) }
  console.log('  PASS — rejections are recorded, and the record is readable only by admins.\n')
}

run().catch(e => { console.error(`  probe error: ${e.message}`); process.exit(1) })

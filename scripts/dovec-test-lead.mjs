#!/usr/bin/env node
// ─── The one Döveç test enquiry: dry report, or send once ────────────────────
//
//   node scripts/dovec-test-lead.mjs            # dry: asks dovec-lead what it WOULD do; writes and sends nothing
//   node scripts/dovec-test-lead.mjs --apply    # sends the single fixed test enquiry (only when every lock is open)
//
// Runs only from .github/workflows/dovec-test-lead.yml (GitHub production environment): this Mac has no service key and
// production secrets live only there. All logic is in the function (supabase/functions/dovec-lead, mode 'test_lead'); this
// script is a thin caller. The phone number is the function secret DOVEC_TEST_LEAD_PHONE: it is not an input here and is
// never printed. Actions logs are public: the function answers with status words only, and this script prints that answer.
import { prodWriteGuard, serviceRoleKey } from './lib/prod-write-guard.mjs'

const apply = process.argv.includes('--apply')
prodWriteGuard({ wouldWrite: apply, workflow: 'dovec-test-lead', dryHint: 'node scripts/dovec-test-lead.mjs   (dry; still needs the CI service key)' })

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
if (!url) { console.error('EXPO_PUBLIC_SUPABASE_URL missing'); process.exit(2) }
const res = await fetch(`${url}/functions/v1/dovec-lead`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${serviceRoleKey()}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'test_lead', dry: !apply }),
  signal: AbortSignal.timeout(60000),
})
let body = null
try { body = await res.json() } catch { /* printed below as an unreadable answer */ }
console.log(`\n── dovec test lead (${apply ? 'APPLY' : 'dry'}) ──\n  http ${res.status}\n  ${body === null ? 'unreadable answer' : JSON.stringify(body, null, 2).replace(/\n/g, '\n  ')}\n`)
if (res.status !== 200 || body === null) process.exit(1)
if (apply && body.ok !== true) process.exit(1)

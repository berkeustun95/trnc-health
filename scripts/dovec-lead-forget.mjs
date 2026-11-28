#!/usr/bin/env node
// ─── Döveç: forget ONE enquiry by its reference (dry report, or wipe) ────────────────────────────────────────────────────
//
//   node scripts/dovec-lead-forget.mjs --ref=ADA-123            # dry: the SQL function runs every check, writes nothing
//   node scripts/dovec-lead-forget.mjs --ref=ADA-123 --apply    # wipes name, phone, e-mail, message, user id of that one enquiry
//
// Runs only from .github/workflows/dovec-lead-forget.yml (GitHub production environment): this Mac has no service key. The
// work is the database function public.dovec_lead_forget (20261243); this script is a thin caller. Berke checks by hand that the
// requester is the sender before approving. Actions logs are public: only the seven agreed booleans are printed (an allowlist,
// scripts/lib/dovec-lead-forget.mjs); an HTTP error prints the status and the error code only, never the body.
import { appendFileSync } from 'node:fs'
import { prodWriteGuard, serviceRoleKey } from './lib/prod-write-guard.mjs'
import { REF_RE, allowlisted, errorCode, verdict } from './lib/dovec-lead-forget.mjs'

const apply = process.argv.includes('--apply')
prodWriteGuard({ wouldWrite: apply, workflow: 'dovec-lead-forget', dryHint: 'node scripts/dovec-lead-forget.mjs --ref=ADA-<n>   (dry; still needs the CI service key)' })

const refArg = process.argv.slice(2).filter(a => a.startsWith('--ref='))
const ref = refArg.length === 1 ? refArg[0].slice('--ref='.length) : null
if (ref === null || !REF_RE.test(ref)) {
  console.error('REFUSED: --ref must be given once and be exactly ADA-<number>. Nothing was sent.')
  process.exit(2)
}
const out = (ok) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `ok=${ok}\n`) }

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
if (!url) { console.error('EXPO_PUBLIC_SUPABASE_URL missing'); out(false); process.exit(2) }
const key = serviceRoleKey()
let res
try {
  res = await fetch(`${url}/rest/v1/rpc/dovec_lead_forget`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_reference: ref, p_apply: apply }),
    signal: AbortSignal.timeout(30000),
  })
} catch {
  console.error('REFUSED: the request failed (network). Nothing is known about the enquiry.')
  out(false); process.exit(1)
}
let body = null
try { body = await res.json() } catch { /* handled below: never echoed */ }
console.log(`\n── dovec lead forget (${apply ? 'APPLY' : 'dry'}) ──`)
if (!res.ok) {
  console.log(`  http ${res.status}, error code ${errorCode(body)}`)
  out(false); process.exit(1)
}
const a = allowlisted(body)
if (a === null) {
  console.log(`  http ${res.status}, the answer is not the expected seven true/false values (not printed)`)
  out(false); process.exit(1)
}
const v = verdict(a, apply)
console.log(`  http ${res.status}\n${v.lines.join('\n')}\n`)
out(v.ok)
process.exit(v.exit)

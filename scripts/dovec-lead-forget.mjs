#!/usr/bin/env node
// ─── Döveç: forget ONE enquiry by its reference (dry report, or wipe) ────────────────────────────────────────────────────
//
//   DOVEC_FORGET_EMAIL=<address> node scripts/dovec-lead-forget.mjs --ref=ADA-123            # dry: the SQL function runs every check, writes nothing
//   DOVEC_FORGET_EMAIL=<address> node scripts/dovec-lead-forget.mjs --ref=ADA-123 --apply    # wipes name, phone, e-mail, message, user id of that one enquiry
//
// The e-mail the person wrote from comes in the environment variable DOVEC_FORGET_EMAIL (never argv: a --email= argument is refused). It
// is sent to the function and compared there with the e-mail of the account that sent the enquiry; it is never printed or echoed.
// Runs only from .github/workflows/dovec-lead-forget.yml (GitHub production environment): this Mac has no service key. The
// work is the database function public.dovec_lead_forget (20261244); this script is a thin caller. The function answers whether the e-mail
// matches the sending account; Berke reads that answer in the dry run before approving. Actions logs are public: only the ten agreed booleans are printed (an allowlist,
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
const EMAIL_RAW = process.env.DOVEC_FORGET_EMAIL
const email = typeof EMAIL_RAW === 'string' ? EMAIL_RAW.trim() : ''
if (process.argv.slice(2).some(a => a.startsWith('--email')) || email === '' || !email.includes('@') || email.length > 320 || /[\u0000-\u001f\u007f]/.test(email)) {
  console.error('REFUSED: the e-mail must come in DOVEC_FORGET_EMAIL (not on the command line), non-empty, with an @, at most 320 characters, no control characters. Nothing was sent.')
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
    body: JSON.stringify({ p_reference: ref, p_email: email, p_apply: apply }),
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
  console.log(`  http ${res.status}, the answer is not the expected ten true/false values (not printed)`)
  out(false); process.exit(1)
}
const v = verdict(a, apply)
console.log(`  http ${res.status}\n${v.lines.join('\n')}\n`)
out(v.ok)
process.exit(v.exit)

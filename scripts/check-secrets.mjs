#!/usr/bin/env node
// ─── Secret guard ────────────────────────────────────────────────────────────
//
//   node scripts/check-secrets.mjs            # scan tracked + staged files
//   node scripts/check-secrets.mjs --self     # prove it catches what it claims to
//
// Runs on pre-push, next to the module-flag guard. Blocks a push that would publish a
// service_role key, a database password, or a Supabase secret key.
//
// WHY THIS EXISTS: a real service_role JWT was pasted into
// supabase/functions/sync-novest/schedule.sql while substituting the placeholders for a
// live cron job. It was caught only because the file happened to be untracked. Nothing
// in the repo would have stopped `git add supabase/functions/` from committing it, and
// nothing would have noticed afterwards.
//
// ⚠ THE ANON KEY IS NOT A SECRET and must not be flagged. lib/supabase.js legitimately
//   contains it — it is bound by RLS and ships inside the app bundle by design. The
//   discriminator is the JWT PAYLOAD: service_role keys carry "role":"service_role",
//   which base64url-encodes to a stable fragment. Matching on "eyJ" alone would flag the
//   anon key on every push, and a guard that fires on correct code gets disabled.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// base64url of '"role":"service_role"' at each of the three byte alignments, so the
// fragment matches wherever the payload happens to place it.
const SERVICE_ROLE_B64 = ['InJvbGUiOiJzZXJ2aWNlX3JvbGUi', 'yb2xlIjoic2VydmljZV9yb2xl', 'JvbGUiOiJzZXJ2aWNlX3JvbGUi']

const RULES = [
  { name: 'service_role JWT',
    test: t => t.includes('eyJ') && SERVICE_ROLE_B64.some(f => t.includes(f)) },
  { name: 'Supabase secret key (sb_secret_)', test: t => /\bsb_secret_[A-Za-z0-9_-]{8,}/.test(t) },
  { name: 'postgres connection string with password',
    test: t => /postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]{6,}@/.test(t) },
]

// ONLY this file, which necessarily contains the patterns it searches for.
//
// ⚠ schedule.sql was exempted in the first draft, on the reasoning that it documents the
//   patterns. That was exactly backwards: it is THE file a key was pasted into, so
//   exempting it would have made the guard blind to the only leak that has actually
//   happened. Its prose does not match the rules anyway — describing a secret is not
//   carrying one. Do not add exemptions to make a scan quieter; make the RULE narrower.
const EXEMPT = [/^scripts\/check-secrets\.mjs$/]

if (process.argv.includes('--self')) {
  // Realistic shapes, none of them live credentials.
  const anonPayload = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlhdCI6MX0.sig'
  const svcPayload  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
    Buffer.from(JSON.stringify({ iss: 'supabase', role: 'service_role', iat: 1 })).toString('base64url') + '.sig'
  const cases = [
    ['service_role JWT',            svcPayload, true],
    ['anon JWT (MUST NOT fire)',    anonPayload, false],
    ['sb_secret_ key',              'sb_secret_abcd1234efgh', true],
    ['postgres URL with password',  'postgresql://postgres:hunter2xyz@db.x.supabase.co:5432/postgres', true],
    ['ordinary SQL',                "select * from properties where source = 'novest';", false],
    ['the word service_role alone', '-- service_role bypasses RLS', false],
  ]
  let bad = 0
  console.log('\n── secret guard self-test ──')
  for (const [label, text, want] of cases) {
    const got = RULES.some(r => r.test(text))
    if (got !== want) bad++
    console.log(`  ${got === want ? '✓' : '✗'} ${label.padEnd(30)} detected=${got} (want ${want})`)
  }
  console.log(bad ? `\nSELF-TEST FAILED (${bad})\n` : '\nself-test clean — fires on secrets, silent on the anon key\n')
  process.exit(bad ? 1 : 0)
}

let files
try {
  files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
    .split('\n').map(s => s.trim()).filter(Boolean)
} catch { console.error('not a git repository'); process.exit(2) }

const SKIP_EXT = /\.(png|jpg|jpeg|gif|webp|avif|ico|pdf|zip|jks|keystore|aab|apk|ttf|otf)$/i
const findings = []
for (const f of files) {
  if (SKIP_EXT.test(f) || EXEMPT.some(re => re.test(f))) continue
  let text
  try { text = readFileSync(f, 'utf8') } catch { continue }
  for (const r of RULES) if (r.test(text)) findings.push(`${f}: ${r.name}`)
}

if (findings.length) {
  console.error('\nsecret guard: BLOCKED\n')
  for (const f of findings) console.error(`  ${f}`)
  console.error('\nThe service_role key belongs in the macOS Keychain (ada-supabase-service-role)')
  console.error('and in Supabase Vault for cron jobs — never in a file. Remove it from the file.')
  console.error('')
  console.error('DO NOT REFLEXIVELY ROTATE. On this project there is no service_role rotate')
  console.error('button: rotating means regenerating the project JWT secret, which invalidates')
  console.error('the ANON key too — breaking the shipped iOS build, the Play track, and every')
  console.error('logged-in session. That is the wrong trade for a key that never left this')
  console.error('machine.')
  console.error('')
  console.error('Ask one question: HAS IT LEFT THIS MACHINE? A commit, a push, a CI log, a')
  console.error('screenshot, a support ticket. If no — remove it and move on. If yes — the')
  console.error('outage is worth it, and the runbook is in')
  console.error('supabase/functions/sync-novest/rotate-cron-to-vault.sql.\n')
  process.exit(1)
}
console.log(`secret guard: OK (${files.length} file(s) scanned)`)

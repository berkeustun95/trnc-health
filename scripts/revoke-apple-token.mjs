#!/usr/bin/env node
// ─── Revoke a user's Sign in with Apple token BEFORE deleting them outside the app ──────
//
//   SUPABASE_SECRET_KEY=sb_secret_… node scripts/revoke-apple-token.mjs <user-id>
//
// WHY: apple_refresh_tokens (20261044) is ON DELETE CASCADE, so deleting a user from the
// Supabase dashboard — or by any path outside the app — destroys the only thing that can
// revoke their Apple authorisation, permanently. Run this FIRST, confirm it says REVOKED or
// NOTHING STORED, THEN delete. (CLAUDE.md, "Social sign-in".)
//
// The secret key comes from the environment for this one command. Copy it from the
// dashboard (Project Settings → API Keys), prefix the command with it as above, and it is
// never written to a file, a shell profile or the repo. It is sent only as the `apikey`
// header to this project's own apple-token function, which proves it can read a table only
// service_role can read before acting on it.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const userId = process.argv[2]
const key = process.env.SUPABASE_SECRET_KEY

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId ?? '')) {
  console.error('Usage: SUPABASE_SECRET_KEY=sb_secret_… node scripts/revoke-apple-token.mjs <user-uuid>')
  process.exit(2)
}
if (!key) {
  console.error('SUPABASE_SECRET_KEY is not set. Put it in front of the command; do not save it anywhere.')
  process.exit(2)
}

// The project URL is public config; read it from .env rather than asking for it.
const url = process.env.SUPABASE_URL
  ?? readFileSync(resolve(ROOT, '.env'), 'utf8').match(/^EXPO_PUBLIC_SUPABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')
if (!url) { console.error('No SUPABASE_URL in the environment or EXPO_PUBLIC_SUPABASE_URL in .env.'); process.exit(2) }

const res = await fetch(`${url}/functions/v1/apple-token`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', apikey: key },
  body: JSON.stringify({ action: 'revoke', userId }),
})
const body = await res.json().catch(() => ({}))

if (res.ok && body.revoked === true) {
  console.log(`REVOKED — Apple authorisation for ${userId} is revoked and the stored token deleted. Safe to delete the user now.`)
} else if (res.ok && body.reason === 'no_token') {
  console.log(`NOTHING STORED for ${userId} — not an Apple user, or the sign-in exchange never landed. Deleting cannot make this worse.`)
} else {
  console.error(`NOT REVOKED (HTTP ${res.status}): ${body.reason ?? body.error ?? 'unknown'}. Do NOT delete the user yet — once deleted, this can never be revoked.`)
  process.exit(1)
}

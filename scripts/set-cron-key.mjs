#!/usr/bin/env node
// ─── Point the cron jobs at a secret key ──────────────────────────────────────
//
//   gh workflow run cron-key-set        (waits for Berke's production-db approval)
//
// Every cron job authenticates with the Vault secret novest_sync_key. It held the legacy service_role JWT, which the
// gateway has refused since 2026-11-03. This replaces the value and keeps the name, so no cron command changes.
// The key is never printed: Actions logs are public.
import { prodWriteGuard } from './lib/prod-write-guard.mjs'

prodWriteGuard({ wouldWrite: true, workflow: 'cron-key-set' })

const fail = m => { console.error(`::error::${m}`); process.exit(1) }
const key = (process.env.CRON_SECRET_KEY || '').trim()
const token = process.env.SUPABASE_ACCESS_TOKEN
const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(process.env.SUPABASE_URL ?? '')?.[1]
if (!/^sb_secret_[A-Za-z0-9_-]+$/.test(key)) fail('CRON_SECRET_KEY is not a sb_secret_ key. Nothing changed.')
if (!token || !ref) fail('SUPABASE_ACCESS_TOKEN / SUPABASE_URL missing. Nothing changed.')

const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `select vault.update_secret(id, '${key}') from vault.secrets where name = 'novest_sync_key';
    select count(*)::int as n, bool_and(updated_at > now() - interval '1 minute') as fresh,
           (select decrypted_secret from vault.decrypted_secrets where name = 'novest_sync_key') = '${key}' as matches
      from vault.secrets where name = 'novest_sync_key'` }),
})
const rows = await r.json().catch(() => null)
// Never echo the body on failure: a database error can quote the statement, and the statement holds the key.
if (!r.ok || !Array.isArray(rows)) fail(`Vault update failed (HTTP ${r.status}).`)
const [state] = rows
if (state?.n !== 1 || !state.fresh || !state.matches) fail('The Vault secret did not read back as the new key.')
console.log('✓ novest_sync_key now holds the secret key; read back and matched.')

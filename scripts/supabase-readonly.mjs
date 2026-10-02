#!/usr/bin/env node
// ─── Read-only SQL against production, from GitHub Actions only ───────────────
//
//   gh workflow run supabase-readonly -f file=supabase/readonly/<name>.sql   (or supabase/probe_*.sql)
//
// Reaches ONE endpoint: the Management API's `/database/query/read-only`, which runs the SQL as
// `supabase_read_only_user` — a database role that cannot write. There is no write endpoint, no
// service key and no DB password anywhere in this file. Every run first PROVES the role it got
// (current_user, no INSERT/UPDATE/DELETE on public.notifications) and prints whether it bypasses
// RLS — a role that RLS hides rows from reads zero, not an error (CLAUDE.md verification #10).
//
// ⚠ The token is the same SUPABASE_ACCESS_TOKEN the migrate workflow uses (Supabase personal tokens
//   are not scope-limited). The read-only boundary is this endpoint + that role, proved each run.
//
// Only committed files under supabase/readonly/ or supabase/probe_*.sql run. Probes that report via
// RAISE EXCEPTION (the SQL editor's only reliable output) are printed as the report, exit 0.
import { readFileSync } from 'node:fs'
import { prodWriteGuard } from './lib/prod-write-guard.mjs'

prodWriteGuard({ wouldWrite: false, workflow: 'supabase-readonly' })

const fail = m => { console.error(`::error::${m}`); process.exit(1) }
const file = process.argv[2] || ''
if (!/^supabase\/(probe_[\w.-]+|readonly\/[\w.-]+)\.sql$/.test(file)) {
  fail(`Refused: ${JSON.stringify(file)} — only supabase/readonly/*.sql or supabase/probe_*.sql run here.`)
}
const token = process.env.SUPABASE_ACCESS_TOKEN
const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(process.env.SUPABASE_URL ?? '')?.[1]
if (!token) fail('SUPABASE_ACCESS_TOKEN is empty.')
if (!ref) fail('Could not derive the project ref from SUPABASE_URL.')

async function readOnly(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query/read-only`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { ok: r.ok, status: r.status, json, text }
}

// 1 — prove the role before reading anything.
const proof = await readOnly(`select current_user::text as role,
  (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user) as bypasses_rls,
  has_table_privilege('public.notifications', 'INSERT') as can_insert,
  has_table_privilege('public.notifications', 'UPDATE') as can_update,
  has_table_privilege('public.notifications', 'DELETE') as can_delete`)
if (!proof.ok || !Array.isArray(proof.json)) fail(`Role proof failed (HTTP ${proof.status}): ${proof.text.slice(0, 500)}`)
const p = proof.json[0]
console.log(`role: ${p.role} · bypasses RLS: ${p.bypasses_rls} · INSERT/UPDATE/DELETE on notifications: ${p.can_insert}/${p.can_update}/${p.can_delete}`)
if (p.can_insert || p.can_update || p.can_delete) fail('This role can write — refusing to run anything.')
if (!p.bypasses_rls) console.log('⚠ RLS applies to this role: counts on RLS tables may read 0 for rows it cannot see.')

// 2 — the file.
console.log(`\n── ${file} ──`)
const r = await readOnly(readFileSync(file, 'utf8'))
if (r.ok) {
  console.log(JSON.stringify(r.json, null, 2))
} else {
  const msg = r.json?.message ?? r.text
  console.log(msg)
  // A probe's report arrives as its RAISE EXCEPTION text; anything else is a real failure.
  if (!/^(supabase\/probe_)/.test(file) || !/READY/.test(msg)) process.exit(1)
}

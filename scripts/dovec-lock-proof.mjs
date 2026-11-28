#!/usr/bin/env node
// ─── Döveç limit trigger: a rolled-back live concurrency proof (workflow dovec-lock-proof) ──────────────────────────
//
//   gh workflow run dovec-lock-proof                 # DRY: reads the catalog (SELECT only), prints the plan, writes nothing
//   gh workflow run dovec-lock-proof -f apply=true   # runs the two cases; every write rolls back
//
// Connects like supabase-migrate: the Management API SQL endpoint with SUPABASE_ACCESS_TOKEN (each call is its own session,
// which is what lets two calls in flight be two concurrent sessions). Cases and what they prove: scripts/lib/dovec-lock-proof.mjs.
import { randomUUID } from 'node:crypto'
import { prodWriteGuard, inCI } from './lib/prod-write-guard.mjs'
import { refusal, runProof } from './lib/dovec-lock-proof.mjs'

prodWriteGuard({ wouldWrite: process.env.APPLY !== 'false', workflow: 'dovec-lock-proof', dryHint: 'the dry run also needs the CI token; run it in the workflow' })

const apply = process.env.APPLY
const why = refusal({ ref: process.env.GITHUB_REF, inCI: inCI(), apply })
if (why) { console.error(`REFUSED: ${why}. Nothing was sent.`); process.exit(1) }

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(process.env.SUPABASE_URL ?? '')?.[1]
if (!token || !ref) { console.error('SUPABASE_ACCESS_TOKEN / SUPABASE_URL missing or not a project URL.'); process.exit(1) }

async function post(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await r.text()
  if (!r.ok) return { error: `HTTP ${r.status}: ${text.slice(0, 600)}` }
  try { return { rows: JSON.parse(text) } } catch { return { error: 'unparseable response' } }
}

const { code } = await runProof({ apply, post, sleep: ms => new Promise(r => setTimeout(r, ms)), uuid: randomUUID, log: console.log })
process.exit(code)

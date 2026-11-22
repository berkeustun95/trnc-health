#!/usr/bin/env node
// contact_events vocabulary tokens: one owner, the newest file's exact set.
//
// verify_schema.sql holds "contact_events module/action vocabulary is exactly the N-… set" tokens. When a
// migration rebuilds contact_events_module_check or contact_events_action_check, the previous owner token must
// stand down (`OR EXISTS (… schema_migrations_applied WHERE filename = '<new file>')`, a :supersede line) and the
// new file must own the new exact set. 20261225 (module 'news') added neither: the dry run passed, the apply
// committed, and the post-apply schema check went red on the 17-module token (run 45066684322, 2026-11-22).
// The dry run never runs that check, so this file checks it from the files, before any push or apply.
//
// Rules, per vocabulary (module, action):
//   1. The newest migration that ADDs the CHECK (uncommented SQL) defines the expected set.
//   2. Exactly one token has no supersede line: the owner. Its tag names that newest file.
//   3. The owner's ARRAY is exactly that set.
//   4. Every other token supersedes to a file at or after its own.
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MIG = resolve(ROOT, 'supabase/migrations')
const VS = process.argv[2] ? resolve(process.argv[2]) : resolve(ROOT, 'supabase/verify_schema.sql')

const lits = s => [...s.matchAll(/'([A-Za-z_]+)'/g)].map(m => m[1])
const same = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join()
// Tags are written '1115_eatery_partners' (old short form) or '20261165_vehicles' (full).
const tagFile = tag => (/^\d{4}_/.test(tag) ? '2026' + tag : tag) + '.sql'

const files = readdirSync(MIG).filter(f => /^\d+_[a-z0-9_]+\.sql$/.test(f)).sort()
const vs = readFileSync(VS, 'utf8')
const segs = vs.split(/UNION ALL SELECT '/).slice(1)

const problems = []
for (const kind of ['module', 'action']) {
  const con = `contact_events_${kind}_check`
  let newest = null, expected = null
  for (const f of files) {
    const sql = readFileSync(resolve(MIG, f), 'utf8').split('\n').filter(l => !/^\s*--/.test(l)).join('\n')
    const m = new RegExp(`ADD\\s+CONSTRAINT\\s+${con}\\s+CHECK\\s*\\(([\\s\\S]*?)\\)\\s*\\)?\\s*;`, 'i').exec(sql)
    if (m) { newest = f; expected = lits(m[1]) }
  }
  if (!newest) { problems.push(`${kind}: no migration ADDs ${con}`); continue }

  const tokens = segs
    .filter(s => new RegExp(`^[^']+','contact_events ${kind} vocabulary is exactly`).test(s))
    .map(s => {
      const tag = s.slice(0, s.indexOf("'"))
      const arr = /IS NOT DISTINCT FROM\s+ARRAY\[([\s\S]*?)\]/.exec(s)
      const sup = [...s.matchAll(/OR EXISTS \(SELECT 1 FROM public\.schema_migrations_applied WHERE filename = '([^']+)'\)/g)].map(m => m[1])
      return { tag, set: arr ? lits(arr[1]) : null, sup }
    })

  const owners = tokens.filter(t => !t.sup.length)
  console.log(`${kind}: newest CHECK in ${newest} (${expected.length}); tokens ${tokens.length}; owners: ${owners.map(t => t.tag).join(', ') || 'none'}`)
  if (owners.length !== 1) problems.push(`${kind}: ${owners.length} owner tokens (want exactly 1): ${owners.map(t => t.tag).join(', ') || 'none'}`)
  for (const o of owners) {
    if (tagFile(o.tag) !== newest) problems.push(`${kind}: owner token '${o.tag}' is not the newest CHECK file ${newest}. Add a :supersede line to it and an exact-set token for ${newest}.`)
    if (!o.set) problems.push(`${kind}: owner token '${o.tag}' has no IS NOT DISTINCT FROM ARRAY[…]`)
    else if (!same(o.set, expected)) problems.push(`${kind}: owner token '${o.tag}' set [${[...o.set].sort()}] ≠ ${newest} [${[...expected].sort()}]`)
  }
  for (const t of tokens.filter(t => t.sup.length)) {
    for (const s of t.sup) if (!files.includes(s)) problems.push(`${kind}: token '${t.tag}' supersedes to a file that does not exist: ${s}`)
    if (!t.sup.some(s => s >= tagFile(t.tag))) problems.push(`${kind}: token '${t.tag}' supersedes only to older files: ${t.sup}`)
  }
}

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`)
  console.error('✗ contact_events vocabulary tokens are out of step with the migrations (scripts/check-contact-events-vocab.mjs).')
  process.exit(1)
}
console.log('✓ contact_events vocabulary tokens: one owner per vocabulary, exact set of the newest CHECK.')

#!/usr/bin/env node
// ─── Release holds: refuses `npm run ota` (production) while HEAD carries a merge Berke has not cleared ──
//
// A hold names one merge commit on main that is fine on Preview but NOT cleared for production. Once it is
// on main every later main carries it, so the freeze-by-branch habit cannot protect it; this can. Unlike
// release-freeze.json there is no env override: clearing a hold is a commit ("cleared": true) after
// Berke's go in chat. `ota:preview` never calls it.
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const file = resolve(root, 'release-holds.json')
let f
try { f = JSON.parse(readFileSync(file, 'utf8')) } catch (e) {
  console.error(`release holds: cannot read ${file} (${e.message}) — refusing rather than guessing.`)
  process.exit(1)
}
if (!Array.isArray(f.holds)) { console.error('release holds: "holds" must be an array — refusing.'); process.exit(1) }

const git = (...args) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
const blocking = []
for (const h of f.holds) {
  if (h.cleared === true) continue
  try { git('cat-file', '-e', `${h.commit}^{commit}`) } catch {
    console.error(`release holds: PR #${h.pr}'s commit ${h.commit} is not in this clone — fetch first. Refusing.`)
    process.exit(1)
  }
  try { git('merge-base', '--is-ancestor', h.commit, 'HEAD'); blocking.push(h) } catch { /* HEAD lacks it */ }
}
if (!blocking.length) { console.log('release holds: none on HEAD'); process.exit(0) }

const bar = '═'.repeat(72)
console.error(`\n${bar}
  RELEASE HOLD — production OTA refused. Nothing was published.
${blocking.map(h => `  PR #${h.pr} (${h.commit.slice(0, 7)}) is on HEAD and NOT cleared for production:
    ${h.what} — held since ${h.since}.
    Clear: ${h.clear}`).join('\n')}
  Preview is unaffected (npm run ota:preview).
${bar}\n`)
process.exit(1)

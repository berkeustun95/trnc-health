#!/usr/bin/env node
// Tests for scripts/lib/release-lane.mjs on throwaway git repos in a temp dir (never this repo's refs).
//   node scripts/test-release-lane.mjs        (npm run release-lane:test)
// RELEASE_LANE_LIB points the test at another copy of the module — used only to prove each test
// goes red against a deliberately broken check (CLAUDE.md, verification principle 2).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const libUrl = process.env.RELEASE_LANE_LIB ? pathToFileURL(resolve(process.env.RELEASE_LANE_LIB)).href : new URL('./lib/release-lane.mjs', import.meta.url).href
const { assessReleaseLane, assessLaneCopies } = await import(libUrl)
// The lib pins its environment at import, so an env-dependent case must start a fresh process that has the variable BEFORE the import.
const assessWithEnv = (cwd, env) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `const { assessReleaseLane } = await import(${JSON.stringify(libUrl)}); console.log(JSON.stringify(assessReleaseLane({ cwd: ${JSON.stringify(cwd)} })))`], { encoding: 'utf8', env: { ...process.env, ...env } }))

const cfg = v => `module.exports = { expo: {\n  version: '${v}',\n  runtimeVersion: { policy: 'appVersion' },\n} }\n`
const root = mkdtempSync(join(tmpdir(), 'release-lane-'))
let n = 0

// main: base (1.4.0) ← version bump 1.4.1 ← merge of feature branch (two commits, one file each)
function fixture() {
  const dir = join(root, `r${n++}`)
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const w = (f, body) => writeFileSync(join(dir, f), body)
  execFileSync('git', ['init', '-q', '-b', 'main', dir])
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false')
  w('app.config.js', cfg('1.4.0')); w('a.txt', 'one\ntwo\nthree\n'); g('add', '.'); g('commit', '-qm', 'base')
  const base = g('rev-parse', 'HEAD')
  g('checkout', '-qb', 'feature'); w('a.txt', 'one\ntwo\nthree\nfour\n'); g('commit', '-qam', 'feature work')
  g('checkout', '-q', 'main'); w('app.config.js', cfg('1.4.1')); g('commit', '-qam', 'Release 1.4.1')
  g('merge', '-q', '--no-ff', '-m', 'Merge pull request #1 from x/feature', 'feature')
  const merge = g('rev-parse', 'HEAD')
  g('update-ref', 'refs/remotes/origin/main', 'main')
  return { dir, g, w, base, merge }
}
// Diverged-file fixture: main has s.js (v0) → v1 (first line renamed, so the lane's pre-image differs) → orig (inserts `return` in pub()).
// The lane picks only v0 and then carries the insert in admin() instead, under orig's trailer. adminZ differs from pub's z so -U3 contexts differ; same = identical blocks.
function relocated(f, same) {
  const blk = (z, ins) => `  x()\n  y()\n  ${z}\n${ins}  q()\n  r()\n  s()\n`
  const file = (head, a, b) => `function ${head}() {\n  guard()\n${blk(same ? 'z()' : 'z2()', a)}}\n\nfunction pub() {\n  open()\n${blk('z()', b)}}\n`
  f.g('checkout', '-q', 'main'); f.w('s.js', file('admin', '', '')); f.g('add', '.'); f.g('commit', '-qm', 'add s'); const addS = f.g('rev-parse', 'HEAD')
  f.w('s.js', file('admin2', '', '')); f.g('commit', '-qam', 'rename')
  f.w('s.js', file('admin2', '', '  return\n')); f.g('commit', '-qam', 'early return in pub'); const orig = f.g('rev-parse', 'HEAD'); f.g('update-ref', 'refs/remotes/origin/main', 'main')
  f.g('checkout', '-qb', 'release/1.4', f.base); f.g('cherry-pick', '-x', addS); f.w('s.js', file('admin', '  return\n', '')); f.g('commit', '-qam', `x\n\n(cherry picked from commit ${orig})`)
  return assessReleaseLane({ cwd: f.dir })
}
const releaseLane = f => { f.g('checkout', '-qb', 'release/1.4', f.base); f.g('cherry-pick', '-x', '-m', '1', f.merge) }

// Preview-lineage copies: HEAD = main (non-release); the lane commit is published as origin/release/1.4 and Previewed.
const preview = f => { const tip = f.g('rev-parse', 'HEAD'); f.g('update-ref', 'refs/remotes/origin/release/1.4', tip); f.g('checkout', '-q', 'main'); return assessLaneCopies({ cwd: f.dir, preview: tip }) }
const prOnLane = f => { // a PR branch based on the lane tip with one -x copy of a new main commit, merged --no-ff
  const tip = f.g('rev-parse', 'HEAD')
  f.g('checkout', '-qb', 'pr'); f.w('b.txt', 'five\n'); f.g('add', '.'); f.g('commit', '-qm', 'pick source'); f.g('checkout', '-q', 'main'); f.g('cherry-pick', '-x', 'pr')
  const orig = f.g('rev-parse', 'HEAD'); f.g('update-ref', 'refs/remotes/origin/main', 'main')
  f.g('checkout', '-q', 'pr'); f.g('reset', '-q', '--hard', tip); f.g('cherry-pick', '-x', orig)
  f.g('checkout', '-q', 'release/1.4'); f.g('merge', '-q', '--no-ff', '-m', 'Merge pull request #2', 'pr')
}

const tests = [
  ['copies: valid -x picks plus a PR merge on a release lane Preview are accepted, copy → original printed', f => { releaseLane(f); prOnLane(f); const r = preview(f); return r.applies && r.ok && r.copies.length === 2 && r.copies.every(c => c.pick && c.original) }],
  ['copies: a hand-written commit on the lane is refused, named', f => { releaseLane(f); f.w('b.txt', 'x\n'); f.g('add', '.'); f.g('commit', '-qm', 'hand-written'); const r = preview(f); return r.applies && !r.ok && r.failures.some(m => m.includes('hand-written') && m.includes('no "(cherry picked')) }],
  ['copies: a pick whose original is not in HEAD is refused', f => { f.g('checkout', '-qb', 'release/1.4', f.base); f.g('checkout', '-qb', 'side'); f.w('a.txt', 'one\ntwo\nthree\nside\n'); f.g('commit', '-qam', 'side work'); const side = f.g('rev-parse', 'HEAD'); f.g('checkout', '-q', 'release/1.4'); f.g('cherry-pick', '-x', side); const r = preview(f); return r.applies && !r.ok && r.failures.some(m => m.includes('is not on HEAD')) }],
  ['copies: a patch-id mismatch (trailer kept, patch edited) is refused', f => { releaseLane(f); f.w('a.txt', 'one\ntwo\nthree\nfour\nEVIL\n'); f.g('commit', '-q', '--amend', '--no-edit', '-a'); const r = preview(f); return r.applies && !r.ok && r.failures.some(m => m.includes('different result') || (m.includes('patch-id') && m.includes('differs'))) }],
  ['copies: a relocated hunk in a diverged file (verbatim patch-id differs) is refused', f => { relocated(f, false); const r = preview(f); return r.applies && !r.ok && r.failures.some(m => m.includes('verbatim patch-id') && m.includes('differs')) }],
  ['copies: a reverting merge on the lane is refused', f => {
    releaseLane(f); const merge = f.g('commit-tree', `${f.base}^{tree}`, '-p', 'HEAD', '-p', f.base, '-m', 'Merge revert'); f.g('reset', '-q', '--hard', merge)
    const r = preview(f); return r.applies && !r.ok && r.failures.some(m => m.includes('not an ancestor of the second'))
  }],
  ['copies: an evil merge with changes of its own is refused', f => {
    releaseLane(f); const tip = f.g('rev-parse', 'HEAD'); f.g('checkout', '-qb', 'pr'); f.w('b.txt', 'x\n'); f.g('add', '.'); f.g('commit', '-qm', 'pr work'); f.g('checkout', '-q', 'release/1.4')
    f.g('merge', '-q', '--no-ff', '--no-commit', 'pr'); f.w('smuggled.txt', 's\n'); f.g('add', '.'); f.g('commit', '-qm', 'Merge sneaky'); void tip
    const r = preview(f); return r.applies && !r.ok && r.failures.some(m => m.includes('tree differs'))
  }],
  ['copies: a Preview on a branch that is no origin/release/* lane does not apply (missing commits stay missing as before)', f => {
    f.g('checkout', '-qb', 'feat/unrelated', f.base); f.w('b.txt', 'x\n'); f.g('add', '.'); f.g('commit', '-qm', 'unreviewed'); const tip = f.g('rev-parse', 'HEAD'); f.g('checkout', '-q', 'main')
    return assessLaneCopies({ cwd: f.dir, preview: tip }).applies === false
  }],
  ['copies: from a release/* HEAD the copies rule does not apply', f => { releaseLane(f); const tip = f.g('rev-parse', 'HEAD'); f.g('update-ref', 'refs/remotes/origin/release/1.4', tip); return assessLaneCopies({ cwd: f.dir, preview: tip }).applies === false }],

  ['a valid lane is exempt, lists the pick', f => { releaseLane(f); const r = assessReleaseLane({ cwd: f.dir }); return r.exempt && r.picks.length === 1 && r.refusals.length === 0 }],
  ['a detached HEAD at origin/release/* is exempt', f => { releaseLane(f); f.g('update-ref', 'refs/remotes/origin/release/1.4', 'HEAD'); f.g('checkout', '-q', '--detach'); return assessReleaseLane({ cwd: f.dir }).exempt }],
  ['a non-cherry-pick commit on the lane is refused', f => { releaseLane(f); f.w('b.txt', 'x\n'); f.g('add', '.'); f.g('commit', '-qm', 'hand-written'); const r = assessReleaseLane({ cwd: f.dir }); return !r.exempt && r.refusals.some(m => m.includes('hand-written') && m.includes('no "(cherry picked')) }],
  ['a trailer pointing off main is refused', f => { f.g('checkout', '-qb', 'release/1.4', f.base); f.g('checkout', '-qb', 'side'); f.w('a.txt', 'one\ntwo\nthree\nside\n'); f.g('commit', '-qam', 'side work'); const side = f.g('rev-parse', 'HEAD'); f.g('checkout', '-q', 'release/1.4'); f.g('cherry-pick', '-x', side); const r = assessReleaseLane({ cwd: f.dir }); return !r.exempt && r.refusals.some(m => m.includes('is not on origin/main')) }],
  ['a patch-id mismatch (trailer kept, patch edited) is refused', f => { releaseLane(f); f.w('a.txt', 'one\ntwo\nthree\nfour\nEVIL\n'); f.g('commit', '-q', '--amend', '--no-edit', '-a'); const r = assessReleaseLane({ cwd: f.dir }); return !r.exempt && r.refusals.some(m => m.includes('different result') || (m.includes('patch-id') && m.includes('differs'))) }],
  ['the same runtime as main is refused', f => { f.g('checkout', '-q', 'main'); f.w('app.config.js', cfg('1.4.0')); f.g('commit', '-qam', 'revert bump'); f.g('update-ref', 'refs/remotes/origin/main', 'main'); releaseLane(f); const r = assessReleaseLane({ cwd: f.dir }); return !r.exempt && r.refusals.some(m => m.includes('same runtime')) }],
  ['a non-release branch is not exempt (behaviour unchanged)', f => { releaseLane(f); f.g('branch', '-m', 'feat/other'); const r = assessReleaseLane({ cwd: f.dir }); return !r.exempt && !r.releaseBranch }],
  ['a dirty tracked tree is refused', f => { releaseLane(f); f.w('a.txt', 'dirty\n'); const r = assessReleaseLane({ cwd: f.dir }); return !r.exempt && r.refusals.some(m => m.includes('tracked files are modified')) }],
  ['an evil merge (changes only in the merge) is refused', f => {
    releaseLane(f); f.w('smuggled.txt', 's\n'); f.g('add', '.')
    const merge = f.g('commit-tree', f.g('write-tree'), '-p', 'HEAD', '-p', f.base, '-m', 'Merge sneaky'); f.g('reset', '-q', '--hard', merge)
    const r = assessReleaseLane({ cwd: f.dir }); return !r.exempt && r.refusals.some(m => m.includes('not an ancestor of the second') || m.includes('tree differs'))
  }],
  ['a reverting merge (tree == second parent, second parent is the base) is refused', f => {
    releaseLane(f)
    const merge = f.g('commit-tree', `${f.base}^{tree}`, '-p', 'HEAD', '-p', f.base, '-m', 'Merge revert'); f.g('reset', '-q', '--hard', merge)
    const r = assessReleaseLane({ cwd: f.dir }); return !r.exempt && r.refusals.some(m => m.includes('not an ancestor of the second'))
  }],
  ['a PR-style merge (first parent ancestor of second, tree == second) is accepted', f => {
    releaseLane(f); const tip = f.g('rev-parse', 'HEAD')
    f.g('checkout', '-qb', 'pr'); f.w('b.txt', 'five\n'); f.g('add', '.'); f.g('commit', '-qm', 'pick source'); f.g('checkout', '-q', 'main'); f.g('cherry-pick', '-x', 'pr')
    const orig = f.g('rev-parse', 'HEAD'); f.g('update-ref', 'refs/remotes/origin/main', 'main')
    f.g('checkout', '-q', 'pr'); f.g('reset', '-q', '--hard', tip); f.g('cherry-pick', '-x', orig)
    f.g('checkout', '-q', 'release/1.4'); f.g('merge', '-q', '--no-ff', '-m', 'Merge pull request #2', 'pr')
    const r = assessReleaseLane({ cwd: f.dir }); return r.exempt && r.picks.length === 2
  }],
  ['a whitespace-only edit in a string literal under a kept trailer is refused', f => {
    f.g('checkout', '-q', 'main'); f.w('c.js', "const k = 'adminonly'\n"); f.g('add', '.'); f.g('commit', '-qm', 'add c'); f.g('update-ref', 'refs/remotes/origin/main', 'main')
    const orig = f.g('rev-parse', 'HEAD'); f.g('checkout', '-qb', 'release/1.4', f.base); f.g('cherry-pick', '-x', orig)
    f.w('c.js', "const k = 'ad minonly'\n"); f.g('commit', '-q', '--amend', '--no-edit', '-a')
    const r = assessReleaseLane({ cwd: f.dir }); return !r.exempt && r.refusals.some(m => m.includes('different result') || m.includes('differs'))
  }],
  ['N6b: a hunk relocated to another spot with identical context under a kept trailer is refused (patch-id ignores line numbers)', f => {
    const blk = ins => `  x()\n  y()\n  z()\n${ins}  q()\n  r()\n  s()\n`
    const file = (a, b) => `function admin() {\n  guard()\n${blk(a)}}\n\nfunction pub() {\n  open()\n${blk(b)}}\n`
    f.g('checkout', '-q', 'main'); f.w('s.js', file('', '')); f.g('add', '.'); f.g('commit', '-qm', 'add s'); const addS = f.g('rev-parse', 'HEAD')
    f.w('s.js', file('', '  return\n')); f.g('commit', '-qam', 'early return in pub'); const orig = f.g('rev-parse', 'HEAD'); f.g('update-ref', 'refs/remotes/origin/main', 'main')
    f.g('checkout', '-qb', 'release/1.4', f.base); f.g('cherry-pick', '-x', addS); f.w('s.js', file('  return\n', '')); f.g('commit', '-qam', `x\n\n(cherry picked from commit ${orig})`)
    const r = assessReleaseLane({ cwd: f.dir }); return !r.exempt && r.refusals.some(m => m.includes('s.js'))
  }],
  ['K1: relocated hunk in a diverged file is refused with git config diff.context=0', f => { f.g('config', 'diff.context', '0'); const r = relocated(f, false); return !r.exempt && r.refusals.some(m => m.includes('verbatim patch-id') && m.includes('differs')) }],
  ['K1: relocated hunk in a diverged file is refused with GIT_DIFF_OPTS=--unified=0 in the environment (fresh process)', f => {
    relocated(f, false); const r = assessWithEnv(f.dir, { GIT_DIFF_OPTS: '--unified=0' }); return !r.exempt && r.refusals.some(m => m.includes('verbatim patch-id') && m.includes('differs'))
  }],
  ['a valid diverged pick with a blank context line stays exempt under global diff.suppressBlankEmpty=true (fresh process)', f => {
    const gc = join(root, `gc${n}`); writeFileSync(gc, '[diff]\n\tsuppressBlankEmpty = true\n')
    const file = (head, ins) => `function ${head}() {\n  guard()\n  x()\n\n  y()\n  z()\n${ins}  q()\n\n  r()\n}\n`
    f.g('checkout', '-q', 'main'); f.w('s.js', file('admin', '')); f.g('add', '.'); f.g('commit', '-qm', 'add s'); const addS = f.g('rev-parse', 'HEAD')
    f.w('s.js', file('admin2', '')); f.g('commit', '-qam', 'rename'); f.w('s.js', file('admin2', '  return\n')); f.g('commit', '-qam', 'ins'); const orig = f.g('rev-parse', 'HEAD'); f.g('update-ref', 'refs/remotes/origin/main', 'main')
    f.g('checkout', '-qb', 'release/1.4', f.base); f.g('cherry-pick', '-x', addS); f.g('cherry-pick', '-x', orig)
    const r = assessWithEnv(f.dir, { GIT_CONFIG_GLOBAL: gc }); return r.exempt && r.picks.some(p => p.diverged.includes('s.js'))
  }],
  ['R1: relocated hunk whose 3-line context is duplicated in a diverged file is refused (pre-image occurs twice)', f => { const r = relocated(f, true); return !r.exempt && r.refusals.some(m => m.includes('s.js') && m.includes('occurs 2 times')) }],
  ['a diverged file whose hunk lands once in its own spot is exempt (positive control for R1)', f => {
    const file = (head, ins) => `function ${head}() {\n  guard()\n  x()\n  y()\n  z()\n${ins}  q()\n  r()\n  s()\n}\n`
    f.g('checkout', '-q', 'main'); f.w('s.js', file('admin', '')); f.g('add', '.'); f.g('commit', '-qm', 'add s'); const addS = f.g('rev-parse', 'HEAD')
    f.w('s.js', file('admin2', '')); f.g('commit', '-qam', 'rename'); f.w('s.js', file('admin2', '  return\n')); f.g('commit', '-qam', 'ins'); const orig = f.g('rev-parse', 'HEAD'); f.g('update-ref', 'refs/remotes/origin/main', 'main')
    f.g('checkout', '-qb', 'release/1.4', f.base); f.g('cherry-pick', '-x', addS); f.g('cherry-pick', '-x', orig)
    const r = assessReleaseLane({ cwd: f.dir }); return r.exempt && r.picks.some(p => p.diverged.includes('s.js'))
  }],
  ['a binary swapped under a kept trailer is refused', f => {
    f.g('checkout', '-q', 'main'); writeFileSync(join(f.dir, 'i.bin'), Buffer.from([0, 1, 2, 3])); f.g('add', '.'); f.g('commit', '-qm', 'add bin'); f.g('update-ref', 'refs/remotes/origin/main', 'main')
    const orig = f.g('rev-parse', 'HEAD'); f.g('checkout', '-qb', 'release/1.4', f.base); f.g('cherry-pick', '-x', orig)
    writeFileSync(join(f.dir, 'i.bin'), Buffer.from([9, 9, 9, 9])); f.g('commit', '-q', '--amend', '--no-edit', '-a')
    const r = assessReleaseLane({ cwd: f.dir }); return !r.exempt
  }],
  ['a binary swapped under a kept trailer is refused with textconv + diff.external configured', f => {
    f.g('config', 'diff.same.textconv', 'echo same #'); f.g('config', 'diff.external', 'true'); writeFileSync(join(f.dir, '.git', 'info', 'attributes'), '*.bin diff=same\n')
    f.g('checkout', '-q', 'main'); writeFileSync(join(f.dir, 'i.bin'), Buffer.from([0, 1, 2, 3])); f.g('add', '.'); f.g('commit', '-qm', 'add bin'); f.g('update-ref', 'refs/remotes/origin/main', 'main')
    const orig = f.g('rev-parse', 'HEAD'); f.g('checkout', '-qb', 'release/1.4', f.base); f.g('cherry-pick', '-x', orig)
    writeFileSync(join(f.dir, 'i.bin'), Buffer.from([9, 9, 9, 9])); f.g('commit', '-q', '--amend', '--no-edit', '-a')
    const r = assessReleaseLane({ cwd: f.dir }); return !r.exempt
  }],
  ['a pick touching an extra file is refused', f => { releaseLane(f); f.w('extra.txt', 'x\n'); f.g('add', '.'); f.g('commit', '-q', '--amend', '--no-edit'); const r = assessReleaseLane({ cwd: f.dir }); return !r.exempt && r.refusals.some(m => m.includes('different files')) }],
  ['an empty lane (HEAD == base) is refused', f => { f.g('checkout', '-qb', 'release/1.4', f.base); const r = assessReleaseLane({ cwd: f.dir }); return !r.exempt && r.refusals.some(m => m.includes('empty proof')) }],
]

let failed = 0
for (const [name, fn] of tests) {
  let ok = false, err = ''
  try { ok = fn(fixture()) } catch (e) { err = ` (${String(e.message).split('\n')[0]})` }
  if (!ok) failed++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${err}`)
}
rmSync(root, { recursive: true, force: true })
console.log(failed ? `\n${failed} of ${tests.length} FAILED\n` : `\nrelease-lane: ${tests.length} of ${tests.length} passed\n`)
process.exit(failed ? 1 : 0)

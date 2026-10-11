#!/usr/bin/env node
// ─── Push guard: no vault notes or dev journal in this PUBLIC repo ───────────
//
//   (pre-push)  <stdin: "<local ref> <local sha> <remote ref> <remote sha>" lines>
//   node scripts/check-push-no-vault-files.mjs --commits <sha> [<sha>…]   check commits by hand
//   node scripts/check-push-no-vault-files.mjs --self                     offline rule tests
//
// Added 2026-10-11: a rescue branch (a recovered stash) went to GitHub carrying Berke's private
// dev journal (daily-updates.md) inside the stash's untracked-files parent, a commit no diff of
// the branch shows. Nothing in this repo looked at what a push would publish.
//
// Checks every commit the push sends that no remote-tracking ref already has — merge parents
// and stash parents included (git rev-list walks all parents) — and every file each one ADDS or
// CHANGES (a root commit: its whole tree). A push is refused if a file:
//   • is named daily-updates.md (the dev journal), anywhere;
//   • has a path through ObsidianVault/ or .obsidian/, or starts with one of the vault's
//     top-level folders (00-inbox/, 10-ada/, … read from ~/ObsidianVault);
//   • is byte-identical to a note in ~/ObsidianVault (.md/.canvas/.txt ≥ 64 bytes) — a copy
//     under any other name.
// LIMIT, stated: an EDITED excerpt of a note passes. On a machine without the vault (CI) only
// the name rules run, and the script says so.

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'

const VAULT = join(homedir(), 'ObsidianVault')
const ZERO = /^0+$/
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 1 << 26 }).trim()

export function nameProblem(path, vaultFolders = []) {
  const p = path.replace(/\\/g, '/')
  if (/^daily-updates\.md$/i.test(basename(p))) return 'dev journal (daily-updates.md)'
  if (/(^|\/)(ObsidianVault|\.obsidian)(\/|$)/.test(p)) return 'Obsidian vault path'
  const top = p.split('/')[0]
  if (vaultFolders.includes(top)) return `vault folder ${top}/`
  return null
}

function vaultIndex() {
  if (!existsSync(VAULT)) return null
  const folders = readdirSync(VAULT).filter(n => /^\d\d-/.test(n) && statSync(join(VAULT, n)).isDirectory())
  const files = []
  const walk = d => { for (const n of readdirSync(d)) {
    if (n === '.obsidian' || n === '.git' || n === '.trash') continue
    const f = join(d, n), st = statSync(f)
    if (st.isDirectory()) walk(f)
    else if (/\.(md|canvas|txt)$/i.test(n) && st.size >= 64) files.push(f)
  } }
  walk(VAULT)
  const hashes = new Map()
  for (let i = 0; i < files.length; i += 200) {
    const out = execFileSync('git', ['hash-object', '--', ...files.slice(i, i + 200)], { encoding: 'utf8' }).trim().split('\n')
    out.forEach((h, k) => hashes.set(h, files[i + k].slice(VAULT.length + 1)))
  }
  return { folders, hashes }
}

// Files each commit adds or changes: [{ commit, path, blob }]
function touched(commit) {
  const parents = git('rev-list', '--parents', '-n', '1', commit).split(' ').slice(1)
  const rows = []
  if (!parents.length) {
    for (const l of git('ls-tree', '-r', commit).split('\n').filter(Boolean)) {
      const [meta, path] = l.split('\t'); const [, type, blob] = meta.split(' ')
      if (type === 'blob') rows.push({ commit, path, blob })
    }
  }
  for (const p of parents) {
    for (const l of git('diff-tree', '-r', '--no-commit-id', '--raw', '--diff-filter=ACMR', p, commit).split('\n').filter(Boolean)) {
      const [meta, ...paths] = l.split('\t'); const blob = meta.split(' ')[3]
      rows.push({ commit, path: paths.at(-1), blob })
    }
  }
  return rows
}

export function check(commits, vault) {
  const problems = []
  const seen = new Set()
  for (const c of commits) for (const r of touched(c)) {
    const key = r.path + '\0' + r.blob
    if (seen.has(key)) continue
    seen.add(key)
    const why = nameProblem(r.path, vault?.folders ?? []) ?? (vault?.hashes.has(r.blob) ? `identical to vault note ${vault.hashes.get(r.blob)}` : null)
    if (why) problems.push(`${r.commit.slice(0, 7)}  ${r.path}  — ${why}`)
  }
  return problems
}

if (process.argv.includes('--self')) {
  let bad = 0
  const t = (label, got, want) => { const ok = (got === null) === (want === null); if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${label} -> ${got}`) }
  const F = ['00-inbox', '10-ada', '70-daily']
  console.log('\n── push vault guard self-test ──')
  t('daily-updates.md at root       ', nameProblem('daily-updates.md', F), 'x')
  t('Daily-Updates.md in a subfolder ', nameProblem('docs/Daily-Updates.md', F), 'x')
  t('ObsidianVault path              ', nameProblem('backup/ObsidianVault/10-ada/x.md', F), 'x')
  t('.obsidian config                ', nameProblem('.obsidian/workspace.json', F), 'x')
  t('vault folder at repo root       ', nameProblem('10-ada/2026-10-10_duyurular-plan.md', F), 'x')
  t('app code                        ', nameProblem('screens/StudentHubScreen.js', F), null)
  t('Student Hub image               ', nameProblem('assets/backgrounds/ada-bg-student-hub.png', F), null)
  t('repo README                     ', nameProblem('README.md', F), null)
  t('a folder merely containing "ada"', nameProblem('data/ada-10/x.md', F), null)
  console.log(bad ? `\nSELF-TEST FAILED (${bad})\n` : '\nself-test clean\n')
  process.exit(bad ? 1 : 0)
}

let commits = []
const i = process.argv.indexOf('--commits')
if (i >= 0) commits = process.argv.slice(i + 1)
else {
  let input = ''
  try { input = readFileSync(0, 'utf8') } catch { /* no stdin: nothing being pushed */ }
  for (const line of input.split('\n').filter(Boolean)) {
    const [, localSha, , remoteSha] = line.trim().split(/\s+/)
    if (!localSha || ZERO.test(localSha)) continue                    // a branch delete publishes nothing
    const not = ['--not', '--remotes']
    if (remoteSha && !ZERO.test(remoteSha)) {
      try { git('cat-file', '-e', remoteSha); not.push(remoteSha) } catch { /* unknown locally (force-push over unseen work) */ }
    }
    commits.push(...git('rev-list', localSha, ...not).split('\n').filter(Boolean))
  }
}
commits = [...new Set(commits)]
const vault = vaultIndex()
const problems = check(commits, vault)
const scope = vault ? `${vault.hashes.size} vault notes by content + names` : 'names only (no ~/ObsidianVault on this machine)'
if (problems.length) {
  console.error(`\n✗ push blocked: ${problems.length} vault/journal file(s) would be published to this PUBLIC repo (${scope}):`)
  for (const p of problems) console.error('    ' + p)
  console.error('  Remove them from those commits (they may sit in a stash\'s untracked parent), then push again.\n')
  process.exit(1)
}
console.log(`vault/journal guard: OK (${commits.length} new commit(s) checked; ${scope})`)

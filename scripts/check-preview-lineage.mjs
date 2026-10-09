#!/usr/bin/env node
// ─── Preview lineage: refuse a production OTA that leaves Previewed code off main ──────────────
//
//   node scripts/check-preview-lineage.mjs      # run by `npm run ota`, after check-ota-preflight
//
// Every production OTA is Previewed first (CLAUDE.md). The failure this stops, 2026-10-06: the
// Profile layout fix was Previewed from fix/open-now-json, never merged, and production 01a1109b
// shipped without it. So: every Preview update on this runtime's major.minor (1.3.x for 1.3.0)
// must have been built from a commit HEAD contains. Commits come from `update:view` (update:list
// has no commit field); every page of 50 groups is read (--offset, 2026-10-09: the branch passed 50),
// and more than MAX_PAGES pages is a refusal, not a guess.
// The unit is the WORK, not the merge commit: a Preview built from a release-branch merge passes
// when every non-merge commit under it is in HEAD (860b89a / 0fcb597 on release/redesign-1, whose
// duty commits reached main through feat/redesign). Those are printed, never silent.
//
// Unknown is a refusal: EAS unreachable, a group with no commit, or a commit this clone cannot
// find after one fetch. A Preview deliberately dropped by Berke passes only with
// PREVIEW_LINEAGE_OVERRIDE=1, which he hands over; the missing commits are printed either way.
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EAS = ['-y', 'eas-cli@24.7.0']
const PAGE = 50
const MAX_PAGES = 20
const run = promisify(execFile)
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const bar = '═'.repeat(72)

function refuse(lines) {
  if (process.env.PREVIEW_LINEAGE_OVERRIDE === '1') {
    console.warn(`\n${bar}\n  PREVIEW LINEAGE OVERRIDDEN (PREVIEW_LINEAGE_OVERRIDE=1) — publishing anyway.\n  ${lines.join('\n  ')}\n  Only for a Preview Berke has explicitly dropped. Log it in the journal.\n${bar}\n`)
    process.exit(0)
  }
  console.error(`\n${bar}
  PREVIEW LINEAGE — production OTA refused. Nothing was published.
  ${lines.join('\n  ')}
  Merge the branch into main (and Preview the result) before publishing. A Preview Berke has
  explicitly dropped: PREVIEW_LINEAGE_OVERRIDE=1 npm run ota -- --message "…"   (and log it).
${bar}\n`)
  process.exit(1)
}

const version = (readFileSync(resolve(ROOT, 'app.config.js'), 'utf8').match(/^\s*version:\s*'([^']+)'/m) || [])[1]
if (!version) refuse(['cannot read the app version from app.config.js — lineage unknown.'])
const series = version.split('.').slice(0, 2).join('.')
const inSeries = rv => typeof rv === 'string' && rv.split('.').slice(0, 2).join('.') === series

let groups
try {
  const all = []
  for (let n = 0; ; n++) {
    if (n >= MAX_PAGES) refuse([`the preview branch has ${all.length}+ updates, more than ${MAX_PAGES} pages of ${PAGE} — older ${series}.x Previews would go unchecked.`])
    const { stdout } = await run('npx', [...EAS, 'update:list', '--branch', 'preview', '--limit', String(PAGE), '--offset', String(n * PAGE), '--json', '--non-interactive'], { cwd: ROOT, maxBuffer: 1 << 24 })
    const page = JSON.parse(stdout).currentPage ?? []
    all.push(...page)
    if (page.length < PAGE) break
  }
  if (new Set(all.map(g => g.group)).size !== all.length) refuse([`EAS paging returned a group twice (${all.length} rows) — the pages overlap, so the list cannot be trusted.`])
  console.log(`\nPreview lineage: read ${all.length} Preview update group(s) in ${Math.ceil((all.length + 1) / PAGE)} page(s)`)
  groups = all.filter(g => inSeries(g.runtimeVersion))
} catch (e) {
  refuse([`could not list Preview updates from EAS (${String(e.message).split('\n')[0]}) — lineage unknown.`])
}

const views = await Promise.all(groups.map(async g => {
  try {
    const { stdout } = await run('npx', [...EAS, 'update:view', g.group, '--json'], { cwd: ROOT, maxBuffer: 1 << 24 })
    const json = JSON.parse(stdout.slice(stdout.indexOf('[')))
    return { g, commit: (Array.isArray(json) ? json : [json]).map(u => u.gitCommitHash).find(Boolean) ?? null }
  } catch (e) {
    return { g, error: String(e.message).split('\n')[0] }
  }
}))

const isAncestor = c => { try { git('merge-base', '--is-ancestor', c, 'HEAD'); return true } catch { return false } }
const missingWork = c => git('rev-list', '--no-merges', c, '--not', 'HEAD').split('\n').filter(Boolean)
const known = c => { try { git('cat-file', '-e', `${c}^{commit}`); return true } catch { return false } }
if (views.some(v => v.commit && !known(v.commit))) { try { git('fetch', '-q', 'origin') } catch { /* reported as unknown below */ } }

const head = git('rev-parse', '--short', 'HEAD')
const missing = [], viaMerge = []
for (const v of views) {
  const label = `${v.g.group.slice(0, 8)} ${v.g.runtimeVersion} ${v.g.message.replace(/\s*\([^)]*ago by [^)]*\)$/, '').slice(0, 90)}`
  if (v.error) missing.push(`? ${label}\n      EAS view failed: ${v.error}`)
  else if (!v.commit) missing.push(`? ${label}\n      records no git commit`)
  else if (!known(v.commit)) missing.push(`? ${v.commit.slice(0, 7)} ${label}\n      commit not in this clone, even after a fetch`)
  else if (!isAncestor(v.commit)) {
    const work = missingWork(v.commit)
    if (work.length) missing.push(`✗ ${v.commit.slice(0, 7)} ${label}\n      ${work.length} commit(s) not in HEAD, e.g. ${work.slice(0, 3).map(c => c.slice(0, 7)).join(' ')}`)
    else viaMerge.push(`· ${v.commit.slice(0, 7)} ${label}`)
  }
}

console.log(`\nPreview lineage: ${views.length} Preview update(s) on ${series}.x checked against HEAD ${head}`)
if (viaMerge.length) console.log(`  merge commit not in HEAD, but every commit under it is:\n    ${viaMerge.join('\n    ')}`)
if (missing.length) refuse([`${missing.length} of ${views.length} Preview update(s) on ${series}.x are NOT in HEAD ${head}:`, ...missing.map(m => `  ${m}`)])
console.log(`  ✓ every ${series}.x Preview commit is contained in HEAD\n`)

// ─── Store-lane exemption: may this HEAD publish an OTA from a feat/store-<X.Y.Z> lane? ─────────
//
// Used by check-ota-preview-target.mjs, check-preview-lineage.mjs and check-ota-preflight.mjs. The 1.4.3 store
// lane (feat/store-1.4.3) is a RUNTIME ahead of main (1.4.2): it carries its own commits (version bump, changelogs,
// age tick, legal versions) and is fed by "merge main into lane" PRs, so the release/* pick-proof (release-lane.mjs)
// can never apply. Every condition is read from git (and, for L3, from GitHub's branch-rule API) — never a flag or
// env var. All of them must hold:
//   L1 runtime   HEAD's version V (app.config.js, policy appVersion) differs from origin/main's; the branch (if
//                named) is feat/store-V; origin/feat/store-V exists and HEAD is an ancestor of it or equal to it
//                (detached works: a pinned SHA passes only once it is already on the pushed lane)
//   L2 open      origin/main's runtime is BELOW V. Once main reaches V the lane has merged: "lane closed"
//   L3 protected GitHub's rules for feat/store-V include pull_request, non_fast_forward and deletion
//                (protect-release-lanes must cover refs/heads/feat/store-*). Unreadable or missing → refused
//   L4 clean     tracked files are unmodified (eas update ships the WORKING TREE)
// The L3 reader is a parameter (tests inject one); nothing the publish path honours can swap it.
//
// The pure deciders below are what the lineage / preflight scripts ask. EAS is read in those scripts, never here.
import { execFileSync } from 'node:child_process'

const REPO = 'berkeustun95/trnc-health'
const LANE_BRANCH = /^feat\/store-.+/
export const REQUIRED_RULES = ['deletion', 'non_fast_forward', 'pull_request']

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 }).trim()
const succeeds = (cwd, ...args) => { try { git(cwd, ...args); return true } catch { return false } }
const lines = s => s.split('\n').filter(Boolean)

const semver = v => (typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v)) ? v.split('.').map(Number) : null
// -1 / 0 / 1, or null when either side is not a plain x.y.z
export const compareRuntime = (a, b) => {
  const x = semver(a), y = semver(b)
  if (!x || !y) return null
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

export function runtimeAt(cwd, ref) {
  let cfg
  try { cfg = git(cwd, 'show', `${ref}:app.config.js`) } catch { return { error: `cannot read app.config.js at ${ref}` } }
  const version = (cfg.match(/^\s*version:\s*'([^']+)'/m) || [])[1]
  const policy = /runtimeVersion:\s*\{\s*policy:\s*'appVersion'/.test(cfg)
  if (!version) return { error: `no version in app.config.js at ${ref}` }
  if (!policy) return { error: `runtimeVersion policy at ${ref} is not appVersion — runtime unknown` }
  return { version }
}

// Default L3 reader: the rules GitHub applies to the branch, as a list of rule types. Throws when unreadable.
export function ghRuleTypes(branch) {
  const out = execFileSync('gh', ['api', `repos/${REPO}/rules/branches/${branch}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const rules = JSON.parse(out)
  if (!Array.isArray(rules)) throw new Error('unexpected response (not a list of rules)')
  return rules.map(r => r.type)
}

const fetchQuiet = (cwd, ...refs) => { try { git(cwd, 'fetch', '-q', 'origin', ...refs) } catch { /* judged on what the clone has */ } }

export function assessStoreLane({ cwd, ruleTypes = ghRuleTypes, fetch = true }) {
  const res = { applies: false, exempt: false, versionDiffers: false, branch: null, version: null, mainVersion: null, laneRef: null, laneOnly: [], rules: null, refusals: [] }
  const refuse = m => res.refusals.push(m)
  try { res.branch = git(cwd, 'symbolic-ref', '-q', '--short', 'HEAD') } catch { res.branch = null }
  if (fetch) fetchQuiet(cwd, 'main')
  const head = runtimeAt(cwd, 'HEAD'), main = runtimeAt(cwd, 'origin/main')
  res.version = head.version ?? null
  res.mainVersion = main.version ?? null
  res.versionDiffers = Boolean(head.version && main.version && head.version !== main.version)
  const laneRef = head.version ? `origin/feat/store-${head.version}` : null
  if (fetch && head.version) fetchQuiet(cwd, `feat/store-${head.version}`)
  const laneExists = Boolean(laneRef) && succeeds(cwd, 'rev-parse', '--verify', '-q', `refs/remotes/${laneRef}^{commit}`)
  res.applies = (res.branch !== null && LANE_BRANCH.test(res.branch)) || (res.versionDiffers && laneExists)
  if (!res.applies) return res
  res.laneRef = laneRef

  // L1 — runtime
  if (head.error) refuse(`L1: ${head.error}`)
  else if (main.error) refuse(`L1: ${main.error}`)
  else {
    if (!res.versionDiffers) refuse(`L1: HEAD's runtime ${head.version} is main's runtime — there is no store lane to publish from`)
    if (res.branch !== null && res.branch !== `feat/store-${head.version}`) refuse(`L1: branch ${res.branch} is not feat/store-${head.version} — the branch name must equal HEAD's app.config.js version`)
    if (!laneExists) refuse(`L1: ${laneRef} does not exist on origin — push the lane first`)
    else if (!succeeds(cwd, 'merge-base', '--is-ancestor', 'HEAD', laneRef)) refuse(`L1: HEAD ${git(cwd, 'rev-parse', '--short', 'HEAD')} is not on ${laneRef} (unpushed or a different branch) — publish only what is already on the pushed lane`)
    // L2 — lane open
    const cmp = compareRuntime(main.version, head.version)
    if (cmp === null) refuse(`L2: cannot compare main's runtime ${main.version} with ${head.version}`)
    else if (cmp >= 0) refuse(`L2: lane closed — origin/main is at runtime ${main.version}, not below ${head.version}; publish from main`)
  }
  // L3 — protected
  const lane = head.version ? `feat/store-${head.version}` : null
  if (lane) {
    try {
      res.rules = [...new Set(ruleTypes(lane))].sort()
      const lacking = REQUIRED_RULES.filter(r => !res.rules.includes(r))
      if (lacking.length) refuse(`L3: ${lane} is not protected — GitHub applies [${res.rules.join(', ') || 'no rules'}], lacking [${lacking.join(', ')}]. Berke must add refs/heads/feat/store-* to the protect-release-lanes ruleset.`)
    } catch (e) { refuse(`L3: cannot read the branch rules for ${lane} (${String(e.message).split('\n')[0]}) — protection unknown, refusing`) }
  }
  // L4 — clean tree
  const dirty = git(cwd, 'status', '--porcelain', '--untracked-files=no')
  if (dirty) refuse(`L4: tracked files are modified — eas update ships the WORKING TREE:\n      ${dirty.split('\n').join('\n      ')}`)

  if (succeeds(cwd, 'rev-parse', '--verify', '-q', 'refs/remotes/origin/main^{commit}')) res.laneOnly = lines(git(cwd, 'log', '--no-merges', '--format=%h %s', 'origin/main..HEAD'))
  res.exempt = res.refusals.length === 0
  return res
}

export function describeStoreLane(r) {
  if (!r.applies) return []
  const out = [`store lane ${r.laneRef ?? '?'}: runtime ${r.version ?? '?'} (main ${r.mainVersion ?? '?'}), ${r.exempt ? 'EXEMPT — L1 runtime, L2 open, L3 protected, L4 clean all hold' : 'NOT exempt'}`]
  if (r.rules) out.push(`  protection: [${r.rules.join(', ')}]`)
  for (const m of r.refusals) out.push(`  ✗ ${m}`)
  if (r.exempt || r.laneOnly.length) {
    out.push(`  lane-only commits (origin/main..HEAD, no merges): ${r.laneOnly.length}`)
    for (const c of r.laneOnly) out.push(`    ${c}`)
  }
  return out
}

// ── pure deciders ─────────────────────────────────────────────────────────────────────────────────

// Lane mode checks only Previews on exactly the lane's runtime: no series widening, no NEXT_LANE.
export const laneLineageScope = (laneVersion, previewRuntime) => typeof previewRuntime === 'string' && previewRuntime === laneVersion

// Main side: may a Preview that HEAD lacks be excused because it was built on a store lane? All must hold:
// its runtime is not HEAD's, it is newer than main's, origin/feat/store-<its runtime> exists and contains the commit.
export function previewExcusedByStoreLane({ cwd, previewCommit, previewRuntime, headRuntime }) {
  const no = why => ({ excused: false, why })
  if (!previewCommit || !semver(previewRuntime)) return no('no commit or no x.y.z runtime')
  if (previewRuntime === headRuntime) return no(`runtime ${previewRuntime} is HEAD's own runtime`)
  const main = runtimeAt(cwd, 'origin/main')
  if (main.error) return no(main.error)
  if (compareRuntime(previewRuntime, main.version) !== 1) return no(`runtime ${previewRuntime} is not newer than main's ${main.version}`)
  const lane = `origin/feat/store-${previewRuntime}`
  if (!succeeds(cwd, 'rev-parse', '--verify', '-q', `refs/remotes/${lane}^{commit}`)) return no(`${lane} does not exist`)
  if (!succeeds(cwd, 'merge-base', '--is-ancestor', previewCommit, lane)) return no(`${previewCommit.slice(0, 7)} is not on ${lane}`)
  return { excused: true, why: `built on ${lane} (runtime ${previewRuntime} ahead of main ${main.version})`, lane }
}

// Lane mode: some Preview must have been built from a commit whose TREE equals HEAD's (the exact code being published).
export function treePreviewed(headTree, previewCommits, cwd) {
  const matches = []
  for (const c of previewCommits) {
    try { if (git(cwd, 'rev-parse', `${c}^{tree}`) === headTree) matches.push(c) } catch { /* unknown commit: no match */ }
  }
  return { ok: matches.length > 0, matches }
}

// Reduce EAS build rows (build:list --json) to the newest finished production store build per platform.
// An older build (a superseded TestFlight / widgets build) is not what users run now, and would refuse forever.
export function newestStoreBuilds(rows, version) {
  const per = new Map()
  for (const b of rows) {
    if (b.status !== 'FINISHED' || b.buildProfile !== 'production' || b.distribution !== 'STORE') continue
    if ((b.runtime?.version ?? b.runtimeVersion ?? b.appVersion) !== version) continue
    const n = Number(b.appBuildVersion)
    if (!b.gitCommitHash || !Number.isFinite(n)) continue
    const cur = per.get(b.platform)
    if (!cur || n > Number(cur.appBuildVersion)) per.set(b.platform, b)
  }
  return [...per.values()]
}

// builds: [{ platform, appBuildVersion, gitCommitHash }]. Every commit must be an ancestor of HEAD (unknown after a fetch = missing).
export function containsBuildCommits(builds, cwd) {
  const contained = [], missing = []
  for (const b of builds) {
    const c = b.gitCommitHash
    if (!c) { missing.push({ ...b, why: 'records no git commit' }); continue }
    if (!succeeds(cwd, 'cat-file', '-e', `${c}^{commit}`)) fetchQuiet(cwd)
    if (!succeeds(cwd, 'cat-file', '-e', `${c}^{commit}`)) missing.push({ ...b, why: 'commit not in this clone, even after a fetch' })
    else if (succeeds(cwd, 'merge-base', '--is-ancestor', c, 'HEAD')) contained.push(b)
    else missing.push({ ...b, why: 'HEAD does not contain it' })
  }
  return { ok: missing.length === 0, contained, missing }
}

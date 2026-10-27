// ─── Release-lane exemption: may this HEAD publish without containing origin/main? ──────────────
//
// Used by check-ota-preview-target.mjs and check-preview-lineage.mjs. A release/* lane (release/1.4)
// is a RUNTIME behind main: it carries only reviewed picks of main's merge commits, so "HEAD contains
// origin/main" can never hold there and "Nothing Previewed stays off main" is checked the other way
// round (everything on the lane is provably on main). Every condition is read from git — never a
// flag or env var. All of them must hold:
//   (0) the branch is release/*  (detached: an origin/release/* ref points at HEAD)
//   (a) HEAD's runtime (app.config.js version, policy appVersion) differs from origin/main's
//   (b) base = merge-base(HEAD, origin/main) is an ancestor of origin/main
//   (c) every non-merge commit in base..HEAD has a "(cherry picked from commit <sha>)" trailer whose
//       sha is an ancestor of origin/main AND whose `git patch-id --verbatim` (whitespace
//       counts) equals the pick's (a merge original, picked with -m 1, is compared as
//       `git diff <orig>^1 <orig>`), AND the pick touches exactly the paths the original touched. patch-id drops
//       line numbers, so it is only the proof for a file whose pre-image DIFFERS between the lane and main;
//       for a path whose pre-image (mode+blob at <pick>^ vs <orig>^1) is identical the post-image must be
//       identical too (exact, no patch-id). At least one pick must be proven (an empty proof is no exemption).
//       A merge in base..HEAD is accepted ONLY as a GitHub PR merge: exactly 2 parents, first parent an
//       ancestor of the second (PR branch based on the lane tip), tree == second parent's tree — so all
//       content comes from the second parent's non-merge commits, which (c) checks
//   (d) the tracked tree is clean (eas update ships the WORKING TREE)
import { execFileSync } from 'node:child_process'

const RELEASE_BRANCH = /^release\/.+/
const raw = (cwd, args, input) => execFileSync('git', args, { cwd, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 27 })
const git = (cwd, ...args) => raw(cwd, args).trim()
const succeeds = (cwd, ...args) => { try { raw(cwd, args); return true } catch { return false } }
const lines = s => s.split('\n').filter(Boolean)
const short = (cwd, c) => git(cwd, 'log', '-1', '--format=%h %s', c)

function runtimeAt(cwd, ref) {
  let cfg
  try { cfg = raw(cwd, ['show', `${ref}:app.config.js`]) } catch { return { error: `cannot read app.config.js at ${ref}` } }
  const version = (cfg.match(/^\s*version:\s*'([^']+)'/m) || [])[1]
  const policy = /runtimeVersion:\s*\{\s*policy:\s*'appVersion'/.test(cfg)
  if (!version) return { error: `no version in app.config.js at ${ref}` }
  if (!policy) return { error: `runtimeVersion policy at ${ref} is not appVersion — runtime unknown` }
  return { version }
}

function patchId(cwd, a, b) {
  const diff = raw(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--binary', '--no-color', a, b])
  if (!diff) return null
  return raw(cwd, ['patch-id', '--verbatim'], diff).split(' ')[0] || null
}

// path → { oldMode, newMode, oldSha, newSha } for a..b, renames split into delete+add (raw output, no textconv)
function treeChanges(cwd, a, b) {
  const tok = raw(cwd, ['diff-tree', '--raw', '-z', '--no-renames', '--no-abbrev', '-r', a, b]).split('\0')
  const out = new Map()
  for (let i = 0; i + 1 < tok.length; i += 2) {
    const m = tok[i].match(/^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) /)
    if (!m) continue
    out.set(tok[i + 1], { pre: `${m[1]} ${m[3]}`, post: `${m[2]} ${m[4]}` })
  }
  return out
}

function branchNames(cwd) {
  const name = git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD')
  if (name !== 'HEAD') return [name]
  return lines(git(cwd, 'for-each-ref', '--points-at', 'HEAD', '--format=%(refname:strip=3)', 'refs/remotes/origin/release/'))
}

// → { exempt, releaseBranch, refusals[], picks[{pick, original, patchId}], headRuntime, mainRuntime }
export function assessReleaseLane({ cwd, mainRef = 'origin/main' }) {
  const res = { exempt: false, releaseBranch: false, refusals: [], picks: [], branch: null, headRuntime: null, mainRuntime: null }
  const refuse = m => { res.refusals.push(m); return res }
  try {
    const names = branchNames(cwd)
    res.branch = names.join(', ')
    const releaseNames = names.filter(n => RELEASE_BRANCH.test(n)) // (0)
    res.releaseBranch = releaseNames.length > 0
    if (!res.releaseBranch) return refuse(`branch "${res.branch}" is not release/* — the exemption is for release lanes only`)

    const head = runtimeAt(cwd, 'HEAD'), main = runtimeAt(cwd, mainRef)
    if (head.error || main.error) return refuse(head.error || main.error)
    res.headRuntime = head.version; res.mainRuntime = main.version
    if (head.version === main.version) return refuse(`HEAD's runtime ${head.version} equals ${mainRef}'s — same runtime, so HEAD must contain main`) // (a)

    let base
    try { base = git(cwd, 'merge-base', 'HEAD', mainRef) } catch { return refuse(`HEAD and ${mainRef} share no merge-base`) }
    if (!succeeds(cwd, 'merge-base', '--is-ancestor', base, mainRef)) return refuse(`merge-base ${base.slice(0, 7)} is not an ancestor of ${mainRef}`) // (b)

    for (const c of lines(git(cwd, 'rev-list', '--merges', `${base}..HEAD`))) { // PR merges only
      const ps = git(cwd, 'log', '-1', '--format=%P', c).split(' ').filter(Boolean)
      if (ps.length !== 2) { refuse(`merge commit ${short(cwd, c)} has ${ps.length} parents — only 2-parent PR merges are accepted`); continue }
      if (!succeeds(cwd, 'merge-base', '--is-ancestor', ps[0], ps[1])) { refuse(`merge commit ${short(cwd, c)}: first parent is not an ancestor of the second (not a PR branch based on the lane tip)`); continue }
      if (git(cwd, 'rev-parse', `${c}^{tree}`) !== git(cwd, 'rev-parse', `${ps[1]}^{tree}`)) refuse(`merge commit ${short(cwd, c)}: tree differs from its second parent's (changes of its own)`)
    }
    for (const c of lines(git(cwd, 'rev-list', '--no-merges', '--reverse', `${base}..HEAD`))) { // (c)
      const label = short(cwd, c)
      const trailer = [...git(cwd, 'log', '-1', '--format=%B', c).matchAll(/\(cherry picked from commit ([0-9a-f]{40})\)/g)].pop()
      if (!trailer) { refuse(`${label}: no "(cherry picked from commit …)" trailer`); continue }
      const orig = trailer[1]
      if (!succeeds(cwd, 'cat-file', '-e', `${orig}^{commit}`)) { refuse(`${label}: trailer ${orig.slice(0, 7)} is not a commit in this clone`); continue }
      if (!succeeds(cwd, 'merge-base', '--is-ancestor', orig, mainRef)) { refuse(`${label}: original ${orig.slice(0, 7)} is not on ${mainRef}`); continue }
      const parents = git(cwd, 'log', '-1', '--format=%P', c).split(' ').filter(Boolean)
      const origParents = git(cwd, 'log', '-1', '--format=%P', orig).split(' ').filter(Boolean)
      if (parents.length !== 1 || origParents.length === 0) { refuse(`${label}: pick or original has no usable parent for a patch`); continue }
      const myChanges = treeChanges(cwd, `${c}^`, c), origChanges = treeChanges(cwd, `${orig}^1`, orig)
      const onlyPick = [...myChanges.keys()].filter(p => !origChanges.has(p)), onlyOrig = [...origChanges.keys()].filter(p => !myChanges.has(p))
      if (onlyPick.length || onlyOrig.length) { refuse(`${label}: touches different files than original ${short(cwd, orig)} (extra: ${onlyPick.join(', ') || '-'}; missing: ${onlyOrig.join(', ') || '-'})`); continue }
      const exact = [], diverged = []
      let bad = null
      for (const [p, mc] of myChanges) {
        const oc = origChanges.get(p)
        if (mc.pre !== oc.pre) diverged.push(p)
        else if (mc.post !== oc.post) { bad = p; break }
        else exact.push(p)
      }
      if (bad) { refuse(`${label}: ${bad} has the same pre-image as on main but a different result than original ${short(cwd, orig)}`); continue }
      const mine = patchId(cwd, `${c}^`, c)
      const theirs = patchId(cwd, `${orig}^1`, orig)
      if (!mine || !theirs) { refuse(`${label}: empty patch, no patch-id to compare`); continue }
      if (mine !== theirs) { refuse(`${label}: verbatim patch-id ${mine.slice(0, 10)} differs from original ${short(cwd, orig)} (${theirs.slice(0, 10)})`); continue }
      res.picks.push({ pick: label, original: short(cwd, orig), patchId: mine, exact, diverged })
    }

    if (res.picks.length === 0 && res.refusals.length === 0) refuse(`no cherry-picks between ${base.slice(0, 7)} and HEAD — an empty proof is not an exemption`)

    const dirty = git(cwd, 'status', '--porcelain', '--untracked-files=no') // (d)
    if (dirty) refuse(`tracked files are modified:\n      ${dirty.split('\n').join('\n      ')}`)
  } catch (e) {
    refuse(`could not assess the release lane (${String(e.message).split('\n')[0]})`)
  }
  res.exempt = res.refusals.length === 0
  return res
}

export function describeLane(res, mainRef = 'origin/main') {
  if (res.exempt) {
    return [`release-lane exemption APPLIES to ${res.branch}: runtime ${res.headRuntime} (${mainRef} is ${res.mainRuntime}), every non-merge commit is a cherry-pick of a commit on ${mainRef} with an identical verbatim patch-id:`,
      ...res.picks.map(p => `    ${p.pick}\n      ← ${p.original}  [verbatim patch-id ${p.patchId.slice(0, 10)}]` +
        p.exact.map(f => `\n      exact (same pre-image, same result): ${f}`).join('') + p.diverged.map(f => `\n      patch-id only, file diverged: ${f}`).join(''))]
  }
  return [`release-lane exemption NOT applied to ${res.branch ?? '?'}:`, ...res.refusals.map(r => `    ${r}`)]
}

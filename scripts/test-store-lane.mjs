#!/usr/bin/env node
// Tests for scripts/lib/store-lane.mjs and the check scripts that use it, on throwaway git repos (a bare origin + a
// clone, never this repo's refs).
//   node scripts/test-store-lane.mjs        (npm run store-lane:test)
// STORE_LANE_LIB points the test at another copy of the lib (also copied into the end-to-end repos) — used only to
// prove each test goes red against a deliberately broken check (CLAUDE.md, verification principle 2).
// The end-to-end cases run the real check scripts inside the throwaway repo with a fake `npx` (EAS answers from files)
// and a fake `gh` (branch rules from a file) first on PATH — test-process PATH only; the scripts honour no env override.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const libPath = process.env.STORE_LANE_LIB ? resolve(process.env.STORE_LANE_LIB) : resolve(here, 'lib/store-lane.mjs')
const { assessStoreLane, previewExcusedByStoreLane, laneLineageScope, treePreviewed, containsBuildCommits, newestStoreBuilds, assessStoreBuildRows, nextLaneAllowance } = await import(pathToFileURL(libPath).href)

const cfg = v => `module.exports = { expo: {\n  version: '${v}',\n  runtimeVersion: { policy: 'appVersion' },\n} }\n`
const PROT = () => ['deletion', 'non_fast_forward', 'pull_request']
const root = mkdtempSync(join(tmpdir(), 'store-lane-'))
let n = 0

// fake npx / gh, shared by every end-to-end repo
const bin = join(root, 'bin'); mkdirSync(bin)
writeFileSync(join(bin, 'npx'), `#!/usr/bin/env node
const fs = require('fs'), d = process.env.FAKE_DIR, a = process.argv.slice(2), has = s => a.includes(s)
const out = o => { process.stdout.write(typeof o === 'string' ? o : JSON.stringify(o)); process.exit(0) }
if (has('update:list')) { const off = Number(a[a.indexOf('--offset') + 1] || 0); out(off ? { currentPage: [] } : JSON.parse(fs.readFileSync(d + '/list.json', 'utf8'))) }
if (has('update:view')) out(fs.readFileSync(d + '/view-' + a[a.indexOf('update:view') + 1] + '.json', 'utf8'))
if (has('channel:view')) { const id = a[a.indexOf('channel:view') + 1] === 'preview' ? 'bp' : 'bq'; out({ currentPage: { branchMapping: JSON.stringify({ data: [{ branchId: id }] }), updateBranches: [{ id, name: id === 'bp' ? 'preview' : 'production' }] } }) }
if (has('config')) out({ extra: { appVariant: 'preview' }, android: { package: 'x.preview' }, version: 'x' })
if (has('env:list')) out('EXPO_PUBLIC_SUPABASE_URL=x\\nEXPO_PUBLIC_SUPABASE_ANON_KEY=y\\n')
process.stderr.write('fake npx: unhandled ' + a.join(' ')); process.exit(2)
`)
writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('fs'), f = process.env.FAKE_DIR + '/rules.json'
if (!fs.existsSync(f)) { process.stderr.write('gh: no rules file (unreadable)'); process.exit(1) }
process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(f, 'utf8')).map(type => ({ type }))))
`)
chmodSync(join(bin, 'npx'), 0o755); chmodSync(join(bin, 'gh'), 0o755)

// origin: main (1.4.2) ← lane feat/store-1.4.3 (one lane-only commit: version bump 1.4.3, pushed). The clone ends ON the lane.
function fixture() {
  const base = join(root, `r${n++}`); mkdirSync(base)
  const origin = join(base, 'origin.git'), dir = join(base, 'w'), eas = join(base, 'eas'); mkdirSync(eas)
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
  execFileSync('git', ['clone', '-q', origin, dir], { stdio: 'ignore' })
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const w = (f, body) => writeFileSync(join(dir, f), body)
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false'); g('checkout', '-q', '-B', 'main')
  w('app.config.js', cfg('1.4.2')); w('a.txt', 'one\n')
  w('package.json', JSON.stringify({ scripts: { 'ota:preview': 'APP_VARIANT=preview eas update --channel preview' } }))
  g('add', '.'); g('commit', '-qm', 'base 1.4.2'); g('push', '-q', 'origin', 'main')
  const mainBase = g('rev-parse', 'HEAD')
  g('checkout', '-qb', 'feat/store-1.4.3'); w('app.config.js', cfg('1.4.3')); g('commit', '-qam', 'Release 1.4.3'); g('push', '-q', 'origin', 'feat/store-1.4.3')
  const bump = g('rev-parse', 'HEAD')
  const f = { dir, g, w, eas, mainBase, bump, rev: r => g('rev-parse', r), tree: r => g('rev-parse', `${r}^{tree}`) }
  f.rules = list => writeFileSync(join(eas, 'rules.json'), JSON.stringify(list))
  f.rules(['deletion', 'non_fast_forward', 'pull_request'])
  // a commit on the lane, optionally pushed
  f.laneCommit = (push, name = 'lane work') => { w('lane.txt', `${name}\n`); g('add', 'lane.txt'); g('commit', '-qm', name); if (push) g('push', '-q', 'origin', 'feat/store-1.4.3'); return g('rev-parse', 'HEAD') }
  // a Preview commit that is NOT on origin's lane: a side branch from the lane bump (1.4.3) or from main base (1.4.2)
  f.side = (from, name) => { const cur = g('rev-parse', '--abbrev-ref', 'HEAD'); g('checkout', '-qb', `side-${name}`, from); w(`${name}.txt`, 'x\n'); g('add', `${name}.txt`); g('commit', '-qm', name); const c = g('rev-parse', 'HEAD'); g('checkout', '-q', cur); return c }
  f.main = () => g('checkout', '-q', 'main')
  // feat/voice-input at 1.4.0 (pushed), then main moves on; hermes() = a two-parent merge of main INTO a voice-input commit
  f.voice = () => { const cur = g('rev-parse', '--abbrev-ref', 'HEAD'); g('checkout', '-qb', 'feat/voice-input', f.mainBase); w('app.config.js', cfg('1.4.0')); g('commit', '-qam', 'voice 1.4.0'); g('push', '-q', 'origin', 'feat/voice-input'); const c = g('rev-parse', 'HEAD'); g('checkout', '-q', 'main'); w('m.txt', 'main moved\n'); g('add', 'm.txt'); g('commit', '-qm', 'main moves'); g('push', '-q', 'origin', 'main'); g('checkout', '-q', cur); return c }
  f.hermes = () => { const v = f.voice(); g('checkout', '-q', '-B', 'agent/x-14', v); g('merge', '-q', '--no-ff', '-m', 'merge main', 'origin/main'); return v }
  f.lane = () => g('checkout', '-q', 'feat/store-1.4.3')
  f.bumpMain = () => { f.main(); w('app.config.js', cfg('1.4.3')); g('commit', '-qam', 'main reaches 1.4.3'); g('push', '-q', 'origin', 'main') }
  f.previews = groups => {
    writeFileSync(join(eas, 'list.json'), JSON.stringify({ currentPage: groups.map((p, i) => ({ group: p.group ?? `grp${i}0000000000`, runtimeVersion: p.rv, message: `preview ${i}` })) }))
    groups.forEach((p, i) => writeFileSync(join(eas, `view-${p.group ?? `grp${i}0000000000`}.json`), JSON.stringify([{ gitCommitHash: p.commit }])))
  }
  // end-to-end: copy the real scripts (and the lib under test) into the throwaway repo and run one there
  mkdirSync(join(dir, 'scripts/lib'), { recursive: true })
  for (const s of ['check-ota-preview-target.mjs', 'check-preview-lineage.mjs', 'check-release-holds.mjs']) copyFileSync(join(here, s), join(dir, 'scripts', s))
  copyFileSync(join(here, 'lib/release-lane.mjs'), join(dir, 'scripts/lib/release-lane.mjs'))
  copyFileSync(libPath, join(dir, 'scripts/lib/store-lane.mjs'))
  f.run = script => { const r = spawnSync(process.execPath, [join(dir, 'scripts', script)], { cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_DIR: eas, PREVIEW_LINEAGE_OVERRIDE: '' } }); const res = { code: r.status, out: `${r.stdout}\n${r.stderr}` }; if (process.env.STORE_LANE_DEBUG) console.log(`--- ${script} exit ${res.code}\n${res.out}`); return res }
  return f
}
const assess = (f, ruleTypes = PROT) => assessStoreLane({ cwd: f.dir, ruleTypes })
const has = (r, re) => r.refusals.some(m => re.test(m))

const tests = [
  // ── assessStoreLane: L1–L4 ──
  ['lane applies: HEAD = pushed feat/store-1.4.3, main below, protected, clean → exempt, the lane-only commit listed', f => { const r = assess(f); return r.applies && r.exempt && r.refusals.length === 0 && r.laneOnly.length === 1 && /Release 1.4.3/.test(r.laneOnly[0]) && r.rules.join() === 'deletion,non_fast_forward,pull_request' }],
  ['lane applies: a detached HEAD at the pushed lane tip is exempt (a pinned-SHA production publish)', f => { f.g('checkout', '-q', '--detach'); const r = assess(f); return r.applies && r.exempt }],
  ['non-lane: HEAD on main is not a store lane (applies false, nothing refused)', f => { f.main(); const r = assess(f); return !r.applies && !r.exempt && r.refusals.length === 0 }],
  ['L1 branch/version mismatch: feat/store-1.4.4 carrying version 1.4.3 is refused', f => { f.g('checkout', '-qb', 'feat/store-1.4.4'); const r = assess(f); return r.applies && !r.exempt && has(r, /L1: branch feat\/store-1\.4\.4 is not feat\/store-1\.4\.3/) }],
  ['L1 branch/version mismatch: an unrelated branch name on the lane commit is refused', f => { f.g('checkout', '-qb', 'feat/other'); const r = assess(f); return r.applies && !r.exempt && has(r, /L1: branch feat\/other is not/) }],
  ['L1 unpushed HEAD: a lane commit not on origin/feat/store-1.4.3 is refused', f => { f.laneCommit(false); const r = assess(f); return r.applies && !r.exempt && has(r, /L1: HEAD \w+ is not on origin\/feat\/store-1\.4\.3/) }],
  ['L1 unpushed HEAD (positive control): the same commit once pushed is exempt', f => { f.laneCommit(true); return assess(f).exempt }],
  ['L1 no origin lane: version 1.4.3 on a feat/store-1.4.3 branch that origin does not have is refused', f => { f.g('push', '-q', 'origin', '--delete', 'feat/store-1.4.3'); f.g('update-ref', '-d', 'refs/remotes/origin/feat/store-1.4.3'); const r = assess(f); return r.applies && !r.exempt && has(r, /L1: origin\/feat\/store-1\.4\.3 does not exist/) }],
  ['L2 main at V: once origin/main is 1.4.3 the lane is closed and refuses', f => { f.bumpMain(); f.lane(); const r = assess(f); return r.applies && !r.exempt && has(r, /L2: lane closed/) }],
  ['L4 dirty tree: a modified tracked file is refused', f => { f.w('a.txt', 'dirty\n'); const r = assess(f); return r.applies && !r.exempt && has(r, /L4: tracked files are modified/) }],
  ['L4 untracked files do not count (positive control for the dirty-tree case; same --untracked-files=no reading as the other guards)', f => { f.w('new-untracked.txt', 'x\n'); return assess(f).exempt }],
  ['L3 unprotected: an empty rule list (today feat/store-1.4.3) is refused, the missing rules named', f => { const r = assess(f, () => []); return r.applies && !r.exempt && has(r, /L3: .*lacking \[deletion, non_fast_forward, pull_request\]/) }],
  ['L3 partial: pull_request + non_fast_forward without deletion is refused', f => { const r = assess(f, () => ['pull_request', 'non_fast_forward']); return !r.exempt && has(r, /lacking \[deletion\]/) }],
  ['L3 unreadable: a throwing rule reader refuses (protection unknown)', f => { const r = assess(f, () => { throw new Error('gh: HTTP 401') }); return !r.exempt && has(r, /L3: cannot read the branch rules/) }],
  ['L3 asks for the lane branch by name (the rules of feat/store-1.4.3, not main)', f => { let asked = null; assess(f, b => { asked = b; return PROT() }); return asked === 'feat/store-1.4.3' }],

  // ── pure deciders ──
  ['excuse: main HEAD (1.4.2) excuses a 1.4.3 Preview built on the pushed lane', f => { f.main(); const r = previewExcusedByStoreLane({ cwd: f.dir, previewCommit: f.bump, previewRuntime: '1.4.3', headRuntime: '1.4.2', ruleTypes: PROT }); return r.excused && /origin\/feat\/store-1\.4\.3/.test(r.why) }],
  ['excuse: not a 1.4.3 Preview built off the lane (commit not on origin/feat/store-1.4.3)', f => { f.main(); const c = f.side(f.bump, 'offlane'); const r = previewExcusedByStoreLane({ cwd: f.dir, previewCommit: c, previewRuntime: '1.4.3', headRuntime: '1.4.2', ruleTypes: PROT }); return !r.excused && /not on origin\/feat\/store-1\.4\.3/.test(r.why) }],
  ['excuse: not after main reaches 1.4.3 (HEAD runtime = the Preview runtime)', f => { f.bumpMain(); const r = previewExcusedByStoreLane({ cwd: f.dir, previewCommit: f.bump, previewRuntime: '1.4.3', headRuntime: '1.4.3', ruleTypes: PROT }); return !r.excused }],
  ['excuse: not for HEAD\'s own runtime even while main is still below it (HEAD on the lane, Preview on the lane)', f => { const r = previewExcusedByStoreLane({ cwd: f.dir, previewCommit: f.bump, previewRuntime: '1.4.3', headRuntime: '1.4.3', ruleTypes: PROT }); return !r.excused && /HEAD's own runtime/.test(r.why) }],
  ['excuse: not once origin/main is 1.4.3 even while HEAD still says 1.4.2 (not newer than main)', f => { f.bumpMain(); const r = previewExcusedByStoreLane({ cwd: f.dir, previewCommit: f.bump, previewRuntime: '1.4.3', headRuntime: '1.4.2', ruleTypes: PROT }); return !r.excused && /not newer than main/.test(r.why) }],
  ['excuse: not a 1.4.2 feature-branch Preview (HEAD\'s own runtime)', f => { f.main(); const c = f.side(f.mainBase, 'feat142'); const r = previewExcusedByStoreLane({ cwd: f.dir, previewCommit: c, previewRuntime: '1.4.2', headRuntime: '1.4.2', ruleTypes: PROT }); return !r.excused }],
  ['excuse: not a newer runtime with no lane on origin (1.4.9 Preview)', f => { f.main(); const r = previewExcusedByStoreLane({ cwd: f.dir, previewCommit: f.bump, previewRuntime: '1.4.9', headRuntime: '1.4.2', ruleTypes: PROT }); return !r.excused && /does not exist/.test(r.why) }],
  ['scope: lane mode checks exactly its runtime — 1.4.3 in, 1.4.2 and 1.4.4 and 1.4.30 out', () => laneLineageScope('1.4.3', '1.4.3') === true && laneLineageScope('1.4.3', '1.4.2') === false && laneLineageScope('1.4.3', '1.4.4') === false && laneLineageScope('1.4.3', '1.4.30') === false],
  ['tree: a Preview commit with HEAD\'s tree is accepted, even under another SHA', f => { f.g('commit', '-q', '--allow-empty', '-m', 'same tree, new sha'); const twin = f.rev('HEAD'); const r = treePreviewed(f.tree('HEAD'), [f.bump, twin], f.dir); return r.ok && r.matches.includes(twin) && r.matches.length === 2 }],
  ['tree: no Preview with HEAD\'s tree (an ancestor with another tree) is refused; an unknown commit is no match', f => { f.laneCommit(false); const r = treePreviewed(f.tree('HEAD'), [f.bump, 'deadbeef'.repeat(5)], f.dir); return !r.ok && r.matches.length === 0 }],
  ['builds: HEAD containing the store build commit passes', f => { const r = containsBuildCommits([{ platform: 'IOS', appBuildVersion: '29', gitCommitHash: f.bump }], f.dir); return r.ok && r.contained.length === 1 }],
  ['builds: a build commit HEAD lacks refuses, the build named', f => { const c = f.side(f.bump, 'buildcommit'); const r = containsBuildCommits([{ platform: 'IOS', appBuildVersion: '29', gitCommitHash: c }], f.dir); return !r.ok && r.missing[0].platform === 'IOS' && /does not contain/.test(r.missing[0].why) }],
  ['builds: a commit this clone cannot find (even after a fetch) refuses; a row with no commit refuses', f => { const r = containsBuildCommits([{ platform: 'ANDROID', appBuildVersion: '33', gitCommitHash: 'ab'.repeat(20) }, { platform: 'IOS', appBuildVersion: '29', gitCommitHash: null }], f.dir); return !r.ok && r.missing.length === 2 }],
  ['builds: only the newest finished production store build per platform counts (a superseded build is ignored)', () => {
    const row = (platform, v, c, extra = {}) => ({ platform, appBuildVersion: v, gitCommitHash: c, status: 'FINISHED', buildProfile: 'production', distribution: 'STORE', appVersion: '1.4.3', runtime: { version: '1.4.3' }, ...extra })
    const r = newestStoreBuilds([row('IOS', '24', 'old'), row('IOS', '29', 'new'), row('ANDROID', '33', 'andr'), row('ANDROID', '34', 'internal', { distribution: 'INTERNAL' }), row('IOS', '30', 'err', { status: 'ERRORED' }), row('IOS', '31', 'other', { appVersion: '1.4.2', runtime: { version: '1.4.2' } })], '1.4.3')
    return r.map(b => b.gitCommitHash).sort().join() === 'andr,new'
  }],

  ['next lane: a Hermes-shaped merge (first parent on feat/voice-input, 1.4.0) is allowed, one line printed', f => { f.hermes(); const r = nextLaneAllowance({ cwd: f.dir }); return r.allowed && /next lane: runtime 1\.4\.0 = origin\/feat\/voice-input, first parent on it/.test(r.why) }],
  ['next lane: a different version whose first parent is NOT on voice-input refuses', f => { f.voice(); f.main(); f.g('checkout', '-qb', 'feat/other'); f.w('app.config.js', cfg('1.4.0')); f.g('commit', '-qam', 'own 1.4.0'); const r = nextLaneAllowance({ cwd: f.dir }); return !r.allowed && /neither HEAD nor its first parent/.test(r.why) }],
  ['next lane: a version equal to neither main nor voice-input refuses even with a first parent on voice-input', f => { f.hermes(); f.w('app.config.js', cfg('1.9.9')); f.g('commit', '-qam', 'odd version'); const r = nextLaneAllowance({ cwd: f.dir }); return !r.allowed && /is not origin\/feat\/voice-input's 1\.4\.0/.test(r.why) }],
  ['next lane: no origin/feat/voice-input at all refuses', f => { const r = nextLaneAllowance({ cwd: f.dir }); return !r.allowed }],
  ['preflight builds: rows present but none parsed refuses, saying so', () => { const r = assessStoreBuildRows([{ platform: 'IOS', renamedStatus: 'FINISHED' }, { platform: 'ANDROID' }], '1.4.2'); return r.builds.length === 0 && /EAS returned 2 production build rows for runtime 1\.4\.2 but none parsed/.test(r.problem) }],
  ['preflight builds: zero rows is no problem (printed pass); parsed rows are no problem', () => {
    const row = { platform: 'IOS', appBuildVersion: '19', gitCommitHash: 'abc', status: 'FINISHED', buildProfile: 'production', distribution: 'STORE', runtime: { version: '1.4.2' } }
    return assessStoreBuildRows([], '1.4.2').problem === null && assessStoreBuildRows([row], '1.4.2').problem === null && assessStoreBuildRows([row], '1.4.2').builds.length === 1
  }],
  ['excuse: an unprotected feat/store-<runtime> (no rules) does not excuse, lacking rules named', f => { f.main(); const r = previewExcusedByStoreLane({ cwd: f.dir, previewCommit: f.bump, previewRuntime: '1.4.3', headRuntime: '1.4.2', ruleTypes: () => [] }); return !r.excused && /not protected \(lacking \[deletion, non_fast_forward, pull_request\]\)/.test(r.why) }],
  ['excuse: unreadable rules do not excuse, with the reason', f => { f.main(); const r = previewExcusedByStoreLane({ cwd: f.dir, previewCommit: f.bump, previewRuntime: '1.4.3', headRuntime: '1.4.2', ruleTypes: () => { throw new Error('gh: HTTP 401') } }); return !r.excused && /cannot read the branch rules.*HTTP 401/.test(r.why) }],
  ['excuse: asks the rules of the PREVIEW runtime lane by name', f => { f.main(); let asked = null; previewExcusedByStoreLane({ cwd: f.dir, previewCommit: f.bump, previewRuntime: '1.4.3', headRuntime: '1.4.2', ruleTypes: b => { asked = b; return PROT() } }); return asked === 'feat/store-1.4.3' }],

  // ── end-to-end: the real check scripts in the throwaway repo ──
  ['lineage lane mode: a missing 1.4.2 Preview is ignored, a Preview of HEAD\'s tree on 1.4.3 passes', f => {
    const c142 = f.side(f.mainBase, 'only142'); f.previews([{ rv: '1.4.3', commit: f.bump }, { rv: '1.4.2', commit: c142 }])
    const r = f.run('check-preview-lineage.mjs'); return r.code === 0 && /store lane mode/.test(r.out) && /exact tree was Previewed/.test(r.out)
  }],
  ['lineage lane mode: a missing 1.4.3 Preview (not in HEAD) refuses, named', f => {
    const bad = f.side(f.bump, 'unlanded'); f.previews([{ rv: '1.4.3', commit: f.bump }, { rv: '1.4.3', commit: bad }])
    const r = f.run('check-preview-lineage.mjs'); return r.code === 1 && r.out.includes(bad.slice(0, 7)) && /problem\(s\) with the Previews on 1\.4\.3/.test(r.out) && /not in HEAD/.test(r.out)
  }],
  ['lineage lane mode: no 1.4.3 Preview with HEAD\'s tree refuses', f => {
    f.laneCommit(true); f.previews([{ rv: '1.4.3', commit: f.bump }])
    const r = f.run('check-preview-lineage.mjs'); return r.code === 1 && /tree equals HEAD/.test(r.out)
  }],
  ['lineage lane mode: no Preview at all on 1.4.3 refuses (only a 1.4.2 one exists)', f => {
    const c = f.side(f.mainBase, 'only142b'); f.previews([{ rv: '1.4.2', commit: c }])
    const r = f.run('check-preview-lineage.mjs'); return r.code === 1 && /tree equals HEAD/.test(r.out)
  }],
  ['lineage lane mode: an unprotected lane refuses before reading Previews', f => {
    f.rules([]); f.previews([{ rv: '1.4.3', commit: f.bump }])
    const r = f.run('check-preview-lineage.mjs'); return r.code === 1 && /not exempt/.test(r.out) && /L3:/.test(r.out)
  }],
  ['lineage main: a 1.4.3 Preview built on the pushed lane is excused, printed, and does not block main', f => {
    f.main(); f.previews([{ rv: '1.4.3', commit: f.bump }])
    const r = f.run('check-preview-lineage.mjs'); return r.code === 0 && /store lane: built on origin\/feat\/store-<runtime>/.test(r.out) && /built on origin\/feat\/store-1\.4\.3/.test(r.out)
  }],
  ['lineage main: a 1.4.3 Preview off the lane still refuses', f => {
    f.main(); const bad = f.side(f.bump, 'offlane2'); f.previews([{ rv: '1.4.3', commit: bad }])
    const r = f.run('check-preview-lineage.mjs'); return r.code === 1 && r.out.includes(bad.slice(0, 7))
  }],
  ['lineage main: after main reaches 1.4.3 a lane Preview not in HEAD is no longer excused', f => {
    f.bumpMain(); f.lane(); const c = f.laneCommit(false); f.main(); f.previews([{ rv: '1.4.3', commit: c }])
    const r = f.run('check-preview-lineage.mjs'); return r.code === 1 && !/store lane: built on/.test(r.out)
  }],
  ['lineage main: a 1.4.2 feature-branch Preview not in HEAD still refuses', f => {
    f.main(); const c = f.side(f.mainBase, 'feat142b'); f.previews([{ rv: '1.4.2', commit: c }])
    const r = f.run('check-preview-lineage.mjs'); return r.code === 1 && r.out.includes(c.slice(0, 7))
  }],
  ['lineage main (positive control): a Preview that HEAD contains passes without any excuse', f => {
    f.main(); f.previews([{ rv: '1.4.2', commit: f.mainBase }])
    const r = f.run('check-preview-lineage.mjs'); return r.code === 0 && !/store lane: built on/.test(r.out)
  }],
  ['ota:preview target: the lane (exempt) passes, prints its lane-only commits', f => {
    const r = f.run('check-ota-preview-target.mjs'); return r.code === 0 && /lane-only commits \(origin\/main\.\.HEAD, no merges\): 1/.test(r.out) && /Release 1\.4\.3/.test(r.out)
  }],
  ['ota:preview target: an unprotected lane refuses (L3)', f => { f.rules([]); const r = f.run('check-ota-preview-target.mjs'); return r.code === 1 && /L3:/.test(r.out) }],
  ['ota:preview target: a stray branch whose version differs from main (no lane) refuses', f => {
    f.main(); f.g('checkout', '-qb', 'feat/stray'); f.w('app.config.js', cfg('1.4.9')); f.g('commit', '-qam', 'stray bump')
    const r = f.run('check-ota-preview-target.mjs'); return r.code === 1 && /neither a store lane nor a proven release\/\* lane/.test(r.out)
  }],
  ['ota:preview target: a Hermes-shaped 1.4.0 merge on voice-input passes and prints the next-lane line', f => { f.hermes(); const r = f.run('check-ota-preview-target.mjs'); return r.code === 0 && /next lane: runtime 1\.4\.0 = origin\/feat\/voice-input, first parent on it/.test(r.out) }],
  ['ota:preview target: a 1.4.0 HEAD whose first parent is off voice-input still refuses', f => { f.voice(); f.main(); f.g('checkout', '-qb', 'feat/other2'); f.w('app.config.js', cfg('1.4.0')); f.g('commit', '-qam', 'own 1.4.0'); const r = f.run('check-ota-preview-target.mjs'); return r.code === 1 && /neither a store lane nor a proven release/.test(r.out) }],
  ['lineage main: an unprotected lane (rules unreadable) no longer excuses the 1.4.3 Preview', f => {
    f.main(); f.rules([]); f.previews([{ rv: '1.4.3', commit: f.bump }])
    const r = f.run('check-preview-lineage.mjs'); return r.code === 1 && !/store lane: built on/.test(r.out)
  }],
  ['ota:preview target (positive control): main itself passes, no store-lane noise', f => { f.main(); const r = f.run('check-ota-preview-target.mjs'); return r.code === 0 && !/store lane/.test(r.out) }],
  ['ota:preview target: a lane that lacks origin/main still refuses (HEAD must contain main)', f => {
    f.main(); f.w('b.txt', 'main moved\n'); f.g('add', 'b.txt'); f.g('commit', '-qm', 'main moves on'); f.g('push', '-q', 'origin', 'main'); f.lane()
    const r = f.run('check-ota-preview-target.mjs'); return r.code === 1 && /does not contain origin\/main/.test(r.out)
  }],

  // ── release holds: a hold on the lane's first lane-only commit ──
  ['release holds: a hold naming the lane-only commit refuses on a lane HEAD and says Commit <sha7>, never PR #null', f => {
    writeFileSync(join(f.dir, 'release-holds.json'), JSON.stringify({ holds: [{ pr: null, commit: f.bump, what: 'lane frozen', since: '2026-11-19', cleared: false, clear: 'Berke says go' }] }))
    const r = f.run('check-release-holds.mjs'); return r.code === 1 && r.out.includes(`Commit ${f.bump.slice(0, 7)}`) && !/PR #null/.test(r.out)
  }],
  ['release holds: the same hold exits 0 on main HEAD ("none on HEAD")', f => {
    writeFileSync(join(f.dir, 'release-holds.json'), JSON.stringify({ holds: [{ pr: null, commit: f.bump, what: 'lane frozen', since: '2026-11-19', cleared: false, clear: 'Berke says go' }] }))
    f.main(); const r = f.run('check-release-holds.mjs'); return r.code === 0 && /none on HEAD/.test(r.out)
  }],
  ['release holds: a hold with a PR number still prints PR #n', f => {
    writeFileSync(join(f.dir, 'release-holds.json'), JSON.stringify({ holds: [{ pr: 7, commit: f.bump, what: 'x', since: '2026-11-19', cleared: false, clear: 'y' }] }))
    const r = f.run('check-release-holds.mjs'); return r.code === 1 && /PR #7/.test(r.out)
  }],
]

let failed = 0
for (const [name, fn] of tests) {
  let ok = false, err = ''
  try { ok = fn(fixture()) } catch (e) { err = ` (${String(e.message).split('\n')[0]})` }
  if (!ok) failed++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${err}`)
}
// ── the REAL Apple-review freeze: this repo's release-holds.json entry on 03e738a0 against the real lane and main ──
// Each case runs the real check-release-holds.mjs in a --shared, no-checkout clone of this repo with HEAD set to the
// real commit (only the script and the holds file are written). STORE_LANE_HOLDS_CHECK / STORE_LANE_HOLDS_JSON point
// at other copies only for the red-first runs, like STORE_LANE_LIB.
const repo = resolve(here, '..')
const LANE_HOLD = '03e738a0bef1a0c50195f96958fd0877a5db8cc6'
const holdsCheck = process.env.STORE_LANE_HOLDS_CHECK ? resolve(process.env.STORE_LANE_HOLDS_CHECK) : join(here, 'check-release-holds.mjs')
const holdsJson = JSON.parse(readFileSync(process.env.STORE_LANE_HOLDS_JSON ? resolve(process.env.STORE_LANE_HOLDS_JSON) : join(repo, 'release-holds.json'), 'utf8'))
const realEntry = (holdsJson.holds || []).find(h => h.commit === LANE_HOLD)
const rg = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
// Only this hold goes into the clone, so a later uncleared main hold cannot turn these cases red.
const laneOnlyHolds = cleared => ({ holds: realEntry ? [{ ...realEntry, ...(cleared ? { cleared: true } : {}) }] : [] })
// GIT_* stripped so a GIT_DIR/GIT_WORK_TREE inherited from a hook can never point the clone's git calls at this repo.
const cloneEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))
const realRun = (ref, holds) => {
  const d = join(root, `real${n++}`)
  execFileSync('git', ['clone', '-q', '--shared', '--no-checkout', repo, d], { stdio: 'ignore', env: cloneEnv })
  execFileSync('git', ['update-ref', '--no-deref', 'HEAD', rg('rev-parse', `${ref}^{commit}`)], { cwd: d, env: cloneEnv })
  mkdirSync(join(d, 'scripts')); copyFileSync(holdsCheck, join(d, 'scripts/check-release-holds.mjs'))
  writeFileSync(join(d, 'release-holds.json'), JSON.stringify(holds))
  const r = spawnSync(process.execPath, [join(d, 'scripts/check-release-holds.mjs')], { cwd: d, encoding: 'utf8', env: cloneEnv })
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` }
}
const real = []
if (realEntry?.cleared === true) {
  console.log(`  - real freeze: the hold on ${LANE_HOLD.slice(0, 7)} is cleared in release-holds.json; real-repo cases retired`)
} else {
  real.push(
    ['real freeze: release-holds.json holds 03e738a0 uncleared', () => realEntry?.cleared === false],
    ['real freeze: origin/feat/store-1.4.3 carries 03e738a0 and origin/main does not', () => {
      try { rg('merge-base', '--is-ancestor', LANE_HOLD, 'origin/feat/store-1.4.3') } catch { return false }
      try { rg('merge-base', '--is-ancestor', LANE_HOLD, 'origin/main'); return false } catch { return true }
    }],
    ['real freeze: the lane HEAD (origin/feat/store-1.4.3) is REFUSED, naming Commit 03e738a', () => {
      const r = realRun('origin/feat/store-1.4.3', laneOnlyHolds(false)); return r.code === 1 && /RELEASE HOLD/.test(r.out) && r.out.includes(`Commit ${LANE_HOLD.slice(0, 7)} is on HEAD`)
    }],
    ['real freeze: main HEAD (origin/main) passes ("none on HEAD")', () => {
      const r = realRun('origin/main', laneOnlyHolds(false)); return r.code === 0 && /none on HEAD/.test(r.out)
    }],
    ['real freeze: the lane HEAD passes once the same entry says "cleared": true', () => {
      const r = realRun('origin/feat/store-1.4.3', laneOnlyHolds(true)); return r.code === 0 && /none on HEAD/.test(r.out)
    }],
  )
}
for (const [name, fn] of real) {
  let ok = false, err = ''
  try { ok = fn() } catch (e) { err = ` (${String(e.message).split('\n')[0]})` }
  if (!ok) failed++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${err}`)
}
const total = tests.length + real.length
rmSync(root, { recursive: true, force: true })
console.log(failed ? `\n${failed} of ${total} FAILED\n` : `\nstore-lane: ${total} of ${total} passed\n`)
process.exit(failed ? 1 : 0)

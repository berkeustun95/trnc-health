#!/usr/bin/env node
// ─── OTA preflight: refuse a publish that would roll production back or ship without Supabase ─
//
//   node scripts/check-ota-preflight.mjs      # run by `npm run ota` BEFORE `eas update`
//
// `eas update` bundles THE WORKING TREE and publishes it to every install of this runtime.
// Two ways that goes wrong silently, both met on 2026-09-24:
//
//  (a) LINEAGE. Publishing from a branch that does not contain the commit the runtime is
//      running RIGHT NOW replaces that code with older code — a rollback nobody asked for.
//      feat/shinypaw-assets was 35 commits behind main after the Visit NCY go-live; one OTA
//      from it would have removed the routes, the 2026-09-24 policy and the notice hotfix.
//      So: ask EAS which commit the newest production update for THIS runtime was built
//      from, and refuse unless HEAD contains it. Tracked files must also be unmodified —
//      the working tree is what ships, so a clean lineage under a dirty tree proves nothing.
//
//      Also (store builds): for every runtime, HEAD must contain the commit of the newest finished production store build
//      of runtime V per platform (eas build:list) — this covers a runtime with no OTA yet, where the embedded bundle is
//      what runs. On a store lane (scripts/lib/store-lane.mjs) HEAD must also contain main's newest production update
//      commit (main's runtime), so a user moving from main's runtime to the lane's keeps every shipped fix.
//
//  (b) SUPABASE ENV. The go-live checkout had no .env. The bundle would have shipped with
//      EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY undefined — every query failing, for everyone.
//      So: resolve both the way Expo does for a production bundle (process env first, then
//      .env.production.local, .env.local, .env.production, .env) and refuse unless both are
//      present and well-formed. A SECRET key in the anon slot is refused too. Values are
//      never printed — only where each came from.
//
//  (c) VARIANT (2026-10-07). The config this publish resolves must not be ADA Preview's —
//      extra.appVariant switches on REDESIGN/CHECKINS for everyone. See the block below.
//
// No override flag, deliberately. If EAS cannot be reached the lineage is UNKNOWN, and an
// unknown lineage is a refusal: fix the network, don't publish blind.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assessStoreLane, describeStoreLane, runtimeAt, assessStoreBuildRows, containsBuildCommits } from './lib/store-lane.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EAS = ['-y', 'eas-cli@24.7.0']
const problems = []
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()

console.log('\nOTA preflight')

// ── (b) Supabase env, as Expo resolves it for a production bundle ─────────────
{
  const files = ['.env.production.local', '.env.local', '.env.production', '.env']
  const fromFiles = {}
  for (const f of files) {
    const p = resolve(ROOT, f)
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/)
      if (m && !(m[1] in fromFiles)) fromFiles[m[1]] = { v: m[2].trim().replace(/^["']|["']$/g, ''), f }
    }
  }
  const get = k => (process.env[k] ? { v: process.env[k], f: 'process env' } : fromFiles[k] ?? null)
  const url = get('EXPO_PUBLIC_SUPABASE_URL'), key = get('EXPO_PUBLIC_SUPABASE_ANON_KEY')
  const urlOk = url && /^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(url.v)
  const isSecret = key && (/^sb_secret_/.test(key.v) ||
    (/^eyJ/.test(key.v) && /service_role/.test(Buffer.from(key.v.split('.')[1] ?? '', 'base64').toString('utf8'))))
  const keyOk = key && !isSecret && /^(sb_publishable_[A-Za-z0-9_-]{10,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)$/.test(key.v)
  const wired = /process\.env\.EXPO_PUBLIC_SUPABASE_URL/.test(readFileSync(resolve(ROOT, 'lib/supabase.js'), 'utf8'))
  if (!urlOk) problems.push(`EXPO_PUBLIC_SUPABASE_URL is ${url ? 'malformed' : 'MISSING'} — the bundle would ship without a Supabase URL (looked in: process env, ${files.join(', ')})`)
  if (isSecret) problems.push('EXPO_PUBLIC_SUPABASE_ANON_KEY holds a SECRET/service_role key — it would ship to every phone')
  else if (!keyOk) problems.push(`EXPO_PUBLIC_SUPABASE_ANON_KEY is ${key ? 'malformed' : 'MISSING'} — the bundle would ship without a Supabase key`)
  if (!wired) problems.push('lib/supabase.js no longer reads process.env.EXPO_PUBLIC_SUPABASE_URL — this check would be checking the wrong thing')
  console.log(`  ${urlOk ? '✓' : '✗'} Supabase URL   ${url ? `from ${url.f}` : 'not found'}`)
  console.log(`  ${keyOk ? '✓' : '✗'} Supabase key   ${key ? `from ${key.f}${isSecret ? ' (SECRET KEY — refused)' : ''}` : 'not found'}`)
}

// ── (c) variant: production must never publish the ADA Preview config ────────
// constants/redesign.js turns REDESIGN and CHECKINS on when extra.appVariant === 'preview',
// and app.config.js sets that ONLY when APP_VARIANT=preview. A stray APP_VARIANT in the shell
// or a .env file (Expo loads .env before evaluating app.config.js) would ship check-ins and the
// redesign to every production user. Asked of the resolver itself — the config this publish
// would carry — not of the variable, so any other route to the same key is caught too.
{
  let variant = null, err = null
  try {
    const cfg = JSON.parse(sh('npx', ['expo', 'config', '--json'], { env: { ...process.env, CI: '1' } }))
    variant = cfg?.extra?.appVariant ?? null
  } catch (e) { err = String(e.message).split('\n')[0] }
  if (err) problems.push(`could not resolve the app config (${err}) — cannot prove this is not the Preview variant`)
  else if (variant !== null) problems.push(`the resolved config carries extra.appVariant = '${variant}' (APP_VARIANT set in the shell or a .env file) — this would switch on Preview-only features (REDESIGN, CHECKINS) for every production user`)
  console.log(`  ${!err && variant === null ? '✓' : '✗'} variant        ${err ? 'unresolved' : variant === null ? 'production (no extra.appVariant)' : `PREVIEW ('${variant}') — refused`}`)
}

// ── (d) the ADA Preview key and the order test number must never reach a production bundle ───
// EXPO_PUBLIC_ADA_PREVIEW_KEY lets any request read unpublished rows (20261120 is_previewer()); EXPO_PUBLIC_ADA_TEST_WHATSAPP
// is the tester's own number that Preview orders go to. Expo inlines an EXPO_PUBLIC_ value at bundle time wherever it
// is defined — the shell, any .env file (loaded regardless of --environment) or the EAS environment — so the code
// gate does not keep it out of the BUNDLE. Refuse when either can be seen from here, and when its one gated use
// (lib/supabase.js, utils/eateryBasket.js) stops being behind the Preview config.
{
  const GATED = [
    ['EXPO_PUBLIC_ADA_PREVIEW_KEY', 'lib/supabase.js'],
    ['EXPO_PUBLIC_ADA_TEST_WHATSAPP', 'utils/eateryBasket.js'],
  ]
  let eas = null
  try { eas = sh('npx', [...EAS, 'env:list', '--environment', 'production']) }
  catch (e) { problems.push(`could not list the EAS production environment (${String(e.message).split('\n')[0]}) — cannot prove the preview key and test number are absent`) }
  for (const [NAME, FILE] of GATED) {
    const seen = []
    if (process.env[NAME]) seen.push('process env')
    for (const f of ['.env.production.local', '.env.local', '.env.production', '.env']) {
      const p = resolve(ROOT, f)
      if (existsSync(p) && new RegExp(`^\\s*(?:export\\s+)?${NAME}\\s*=`, 'm').test(readFileSync(p, 'utf8'))) seen.push(f)
    }
    if (eas !== null && new RegExp(`^${NAME}=`, 'm').test(eas)) seen.push('EAS production environment')
    if (seen.length) problems.push(`${NAME} is defined in: ${seen.join(', ')} — it would be inlined into this production bundle`)
    const lib = readFileSync(resolve(ROOT, FILE), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
    const gated = new RegExp(`appVariant\\s*===\\s*'preview'\\s*\\?\\s*process\\.env\\.${NAME}\\s*:\\s*undefined`).test(lib)
    const uses = (lib.match(new RegExp(NAME, 'g')) || []).length
    if (!gated || uses !== 1) problems.push(`${FILE} must read ${NAME} exactly once, behind extra.appVariant === 'preview' (found ${uses} use(s), gated: ${gated})`)
    console.log(`  ${!seen.length && eas !== null && gated && uses === 1 ? '✓' : '✗'} ${NAME === 'EXPO_PUBLIC_ADA_PREVIEW_KEY' ? 'preview key   ' : 'test number   '} ${seen.length ? 'VISIBLE in ' + seen.join(', ') + ' — refused' : eas === null ? 'unverified' : 'absent from shell, .env files and EAS production'}${gated && uses === 1 ? '' : `; ${FILE} gate broken`}`)
  }
}

// ── (a) lineage: HEAD must contain the commit this runtime is running ─────────
{
  const cfg = readFileSync(resolve(ROOT, 'app.config.js'), 'utf8')
  const version = (cfg.match(/^\s*version:\s*'([^']+)'/m) || [])[1]
  const policy = /runtimeVersion:\s*\{\s*policy:\s*'appVersion'/.test(cfg)
  if (!version || !policy) {
    problems.push(`cannot tell which runtime this tree publishes to (version ${version ?? '?'}, runtimeVersion policy appVersion: ${policy})`)
  } else {
    const dirty = sh('git', ['status', '--porcelain', '--untracked-files=no'])
    if (dirty) problems.push(`tracked files are modified — eas update ships the WORKING TREE, not HEAD:\n      ${dirty.split('\n').join('\n      ')}`)
    const store = assessStoreLane({ cwd: ROOT })
    if (store.applies && store.versionDiffers && !store.exempt) problems.push(`HEAD looks like a store lane but is not exempt:\n      ${describeStoreLane(store).join('\n      ')}`)
    const laneMode = store.exempt
    if (laneMode) console.log('  ' + describeStoreLane(store).join('\n  '))
    const head = sh('git', ['rev-parse', '--short', 'HEAD'])
    const showCommit = group => {
      const view = JSON.parse(sh('npx', [...EAS, 'update:view', group, '--json']))
      return (Array.isArray(view) ? view : [view]).map(u => u.gitCommitHash).find(Boolean) ?? null
    }
    const contains = c => {
      try { sh('git', ['cat-file', '-e', `${c}^{commit}`]) } catch { try { sh('git', ['fetch', '-q', 'origin']) } catch { /* reported below */ } }
      try { sh('git', ['merge-base', '--is-ancestor', c, 'HEAD']); return true } catch { return false }
    }
    let live = null, group = null, mainLive = null, mainGroup = null
    const mainVersion = laneMode ? runtimeAt(ROOT, 'origin/main').version ?? null : null
    try {
      const list = JSON.parse(sh('npx', [...EAS, 'update:list', '--branch', 'production', '--limit', '50', '--json', '--non-interactive']))
      const page = list.currentPage ?? []
      group = page.find(g => g.runtimeVersion === version)?.group ?? null
      if (group) {
        live = showCommit(group)
        if (!live) problems.push(`the live ${version} update ${group.slice(0, 8)} records no git commit — lineage unknown`)
      }
      if (laneMode) {
        if (!mainVersion) problems.push("cannot read origin/main's runtime — lane lineage unknown, refusing")
        else {
          mainGroup = page.find(g => g.runtimeVersion === mainVersion)?.group ?? null
          if (!mainGroup) problems.push(`no production update found for main's runtime ${mainVersion} in the newest 50 — cannot prove the lane keeps every shipped fix, refusing`)
          else if (!(mainLive = showCommit(mainGroup))) problems.push(`main's live ${mainVersion} update ${mainGroup.slice(0, 8)} records no git commit — lineage unknown`)
        }
      }
    } catch (e) {
      problems.push(`could not ask EAS what runtime ${version} is running (${String(e.message).split('\n')[0]}) — lineage unknown, refusing`)
    }
    if (live) {
      const ok = contains(live)
      if (!ok) problems.push(`HEAD ${head} does NOT contain ${live.slice(0, 7)}, the commit runtime ${version} is running now (update ${group.slice(0, 8)}) — publishing would roll production back. Merge it in first.`)
      console.log(`  ${ok ? '✓' : '✗'} runtime ${version} runs ${live.slice(0, 7)} (update ${group.slice(0, 8)}); HEAD ${head} ${ok ? 'contains it' : 'does NOT contain it'}`)
    } else if (!group && !problems.some(p => p.includes('could not ask EAS'))) {
      console.log(`  · runtime ${version} has no production OTA yet — the embedded bundle is live (the store builds below are what runs)`)
    }
    if (mainLive) {
      const ok = contains(mainLive)
      if (!ok) problems.push(`store lane: HEAD ${head} does NOT contain ${mainLive.slice(0, 7)}, the commit main's runtime ${mainVersion} is running now (update ${mainGroup.slice(0, 8)}) — a user moving to ${version} would lose that fix. Sync main into the lane first.`)
      console.log(`  ${ok ? '✓' : '✗'} lane keeps main's runtime ${mainVersion} fixes: runs ${mainLive.slice(0, 7)} (update ${mainGroup.slice(0, 8)}); HEAD ${ok ? 'contains it' : 'does NOT contain it'}`)
    }
    // store builds of THIS runtime, newest finished production build per platform: HEAD must contain what the stores run
    if (!problems.some(p => p.includes('could not ask EAS'))) {
      try {
        const rows = []
        for (let n = 0; ; n++) {
          if (n >= 10) throw new Error('more than 10 pages of builds')
          const page = JSON.parse(sh('npx', [...EAS, 'build:list', '--platform', 'all', '--status', 'finished', '--build-profile', 'production', '--app-version', version, '--limit', '50', '--offset', String(n * 50), '--json', '--non-interactive']))
          rows.push(...page)
          if (page.length < 50) break
        }
        const { builds, problem } = assessStoreBuildRows(rows, version)
        if (problem) problems.push(problem)
        if (!builds.length && !problem) console.log(`  · no finished production store build of runtime ${version} on EAS — nothing the stores run to protect`)
        const r = containsBuildCommits(builds, ROOT)
        for (const b of r.contained) console.log(`  ✓ store build ${b.platform} (${b.appBuildVersion}) of ${version} was made from ${b.gitCommitHash.slice(0, 7)}; HEAD ${head} contains it`)
        for (const b of r.missing) {
          problems.push(`HEAD ${head} does NOT contain ${(b.gitCommitHash ?? '?').slice(0, 7)}, the commit store build ${b.platform} (${b.appBuildVersion}) of runtime ${version} was made from (${b.why}) — an OTA would replace code the store build embeds. Merge it in first.`)
          console.log(`  ✗ store build ${b.platform} (${b.appBuildVersion}): ${b.why}`)
        }
      } catch (e) { problems.push(`could not read the production store builds of runtime ${version} from EAS (${String(e.message).split('\n')[0]}) — what the stores run is unknown, refusing`) }
    }
    console.log(`  ${dirty ? '✗' : '✓'} working tree: tracked files ${dirty ? 'MODIFIED' : 'clean'}`)
  }
}

if (problems.length) {
  console.error('\n  ┌─ OTA REFUSED ──────────────────────────────────────────────────')
  for (const p of problems) console.error(`  │ ${p}`)
  console.error('  └────────────────────────────────────────────────────────────────\n')
  process.exit(1)
}
console.log('  OTA preflight: OK\n')

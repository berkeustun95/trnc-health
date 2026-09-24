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
//  (b) SUPABASE ENV. The go-live checkout had no .env. The bundle would have shipped with
//      EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY undefined — every query failing, for everyone.
//      So: resolve both the way Expo does for a production bundle (process env first, then
//      .env.production.local, .env.local, .env.production, .env) and refuse unless both are
//      present and well-formed. A SECRET key in the anon slot is refused too. Values are
//      never printed — only where each came from.
//
// No override flag, deliberately. If EAS cannot be reached the lineage is UNKNOWN, and an
// unknown lineage is a refusal: fix the network, don't publish blind.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

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
    let live = null, group = null
    try {
      const list = JSON.parse(sh('npx', [...EAS, 'update:list', '--branch', 'production', '--limit', '50', '--json', '--non-interactive']))
      group = (list.currentPage ?? []).find(g => g.runtimeVersion === version)?.group ?? null
      if (group) {
        const view = JSON.parse(sh('npx', [...EAS, 'update:view', group, '--json']))
        live = (Array.isArray(view) ? view : [view]).map(u => u.gitCommitHash).find(Boolean) ?? null
        if (!live) problems.push(`the live ${version} update ${group.slice(0, 8)} records no git commit — lineage unknown`)
      }
    } catch (e) {
      problems.push(`could not ask EAS what runtime ${version} is running (${String(e.message).split('\n')[0]}) — lineage unknown, refusing`)
    }
    if (live) {
      try { sh('git', ['cat-file', '-e', `${live}^{commit}`]) } catch { try { sh('git', ['fetch', '-q', 'origin']) } catch { /* reported below */ } }
      let contains = false
      try { sh('git', ['merge-base', '--is-ancestor', live, 'HEAD']); contains = true } catch { /* not an ancestor, or unknown */ }
      const head = sh('git', ['rev-parse', '--short', 'HEAD'])
      if (!contains) problems.push(`HEAD ${head} does NOT contain ${live.slice(0, 7)}, the commit runtime ${version} is running now (update ${group.slice(0, 8)}) — publishing would roll production back. Merge it in first.`)
      console.log(`  ${contains ? '✓' : '✗'} runtime ${version} runs ${live.slice(0, 7)} (update ${group.slice(0, 8)}); HEAD ${head} ${contains ? 'contains it' : 'does NOT contain it'}`)
    } else if (!group && !problems.some(p => p.includes('could not ask EAS'))) {
      console.log(`  · runtime ${version} has no production OTA yet — the embedded bundle is live; nothing to roll back`)
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

#!/usr/bin/env node
// ─── ota:preview preflight: prove the publish can only reach ADA Preview ──────
//
//   node scripts/check-ota-preview-target.mjs      # run by `npm run ota:preview` BEFORE `eas update`
//
// `npm run ota` has its own preflight; ota:preview had none (2026-10-07). What a correct
// preview publish needs, each asked of the thing itself rather than assumed:
//   (a) the package.json command publishes to --channel preview and names no production target;
//   (b) EAS: channel "preview" maps ONLY to branch(es) named "preview" — never production's branch;
//   (c) the config this publish resolves (APP_VARIANT=preview) is the Preview variant;
//   (d) tracked files are clean (eas update ships the WORKING TREE) and HEAD contains origin/main
//       ("Nothing Previewed stays off main", CLAUDE.md);
//   (e) the EAS preview environment carries the Supabase URL + key (names only, never values).
// No override flag.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EAS = ['-y', 'eas-cli@24.7.0']
const sh = (cmd, args, env = {}) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }).trim()
const problems = []
const row = (ok, label, detail) => console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(16)} ${detail}`)
console.log('\nPreview OTA preflight')

// (a)
{
  const cmd = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).scripts?.['ota:preview'] ?? ''
  const upd = cmd.slice(cmd.lastIndexOf('eas update'))
  const ok = /--channel preview\b/.test(upd) && !/production/.test(upd) && /APP_VARIANT=preview/.test(cmd) && !/--branch\b/.test(upd)
  if (!ok) problems.push(`package.json ota:preview does not publish strictly to --channel preview with APP_VARIANT=preview: "${upd}"`)
  row(ok, 'command', ok ? 'eas update --channel preview, APP_VARIANT=preview, no production/branch target' : upd)
}
// (b)
try {
  const view = n => JSON.parse(sh('npx', [...EAS, 'channel:view', n, '--json', '--non-interactive'])).currentPage
  const pv = view('preview'), prod = view('production')
  const ids = JSON.parse(pv.branchMapping).data.map(d => d.branchId)
  const names = ids.map(id => pv.updateBranches.find(b => b.id === id)?.name ?? `?${id.slice(0, 8)}`)
  const prodIds = JSON.parse(prod.branchMapping).data.map(d => d.branchId)
  const ok = ids.length > 0 && names.every(n => n === 'preview') && !ids.some(id => prodIds.includes(id))
  if (!ok) problems.push(`EAS channel "preview" maps to [${names.join(', ')}] — must be only the "preview" branch and none of production's`)
  row(ok, 'EAS channel', `preview → [${names.join(', ')}]; shares no branch with production`)
} catch (e) { problems.push(`could not read the EAS channels (${String(e.message).split('\n')[0]}) — target unknown, refusing`) }
// (c)
try {
  const cfg = JSON.parse(sh('npx', ['expo', 'config', '--json'], { APP_VARIANT: 'preview', CI: '1' }))
  const ok = cfg?.extra?.appVariant === 'preview' && /\.preview$/.test(cfg?.android?.package ?? '')
  if (!ok) problems.push(`resolved config is not the Preview variant (appVariant ${cfg?.extra?.appVariant}, package ${cfg?.android?.package})`)
  row(ok, 'config', `appVariant ${cfg?.extra?.appVariant} · ${cfg?.android?.package} · runtime ${cfg?.version}`)
} catch (e) { problems.push(`could not resolve the app config (${String(e.message).split('\n')[0]})`) }
// (d)
{
  const dirty = sh('git', ['status', '--porcelain', '--untracked-files=no'])
  if (dirty) problems.push(`tracked files are modified — eas update ships the WORKING TREE:\n      ${dirty.split('\n').join('\n      ')}`)
  try { sh('git', ['fetch', '-q', 'origin', 'main']) } catch { /* checked below */ }
  let contains = false
  try { sh('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']); contains = true } catch { /* no */ }
  if (!contains) problems.push('HEAD does not contain origin/main — publish Preview only from a branch that contains main')
  row(!dirty && contains, 'tree', `${dirty ? 'tracked files MODIFIED' : 'clean'} · HEAD ${sh('git', ['rev-parse', '--short', 'HEAD'])} ${contains ? 'contains' : 'LACKS'} origin/main`)
}
// (e)
try {
  const out = sh('npx', [...EAS, 'env:list', '--environment', 'preview'])
  const names = [...out.matchAll(/^([A-Z_]+)=/gm)].map(m => m[1])
  const ok = names.includes('EXPO_PUBLIC_SUPABASE_URL') && names.includes('EXPO_PUBLIC_SUPABASE_ANON_KEY')
  if (!ok) problems.push(`EAS preview environment lacks the Supabase URL/key (has: ${names.join(', ')})`)
  row(ok, 'EAS env', `preview has ${names.join(', ')}`)
} catch (e) { problems.push(`could not read the EAS preview environment (${String(e.message).split('\n')[0]})`) }

if (problems.length) {
  console.error('\n  ┌─ PREVIEW OTA REFUSED ──────────────────────────────────────────')
  for (const p of problems) console.error(`  │ ${p}`)
  console.error('  └────────────────────────────────────────────────────────────────\n')
  process.exit(1)
}
console.log('  Preview OTA preflight: OK — this publish can only reach ADA Preview\n')

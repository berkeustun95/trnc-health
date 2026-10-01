#!/usr/bin/env node
// ─── Every production writer calls prodWriteGuard() first ────────────────────
//
// DERIVED, not a list: a script is a WRITER when it can reach a service key AND makes
// a write call. Every writer must call prodWriteGuard() before it reads a key, reads
// .env, creates a client or fetches. A new writer that forgets is red here — in the
// gisekibris-feed self-test step and in `npm run check:prod-writes`.
//
// Prints every script it classified, so a writer the patterns MISSED is visible as a
// row that should not be in the "read-only" group, rather than silently absent.
//
//   node scripts/check-prod-write-guard.mjs
//   node scripts/check-prod-write-guard.mjs --selftest

import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const KEY = /ada-supabase-service-role|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|serviceRoleKey\b/
const WRITE = /\.(insert|upsert|update|delete|rpc|upload|remove)\(|functions\/v1\//
const NOT_A_WRITE = /createHash\([^)]*\)\.update\(|\.update\(Buffer/g
// What the guard must precede: a key read, a client, a network call, or the loadEnv()
// CALL. `function serviceRoleKey(` is a declaration, not a read. Reading .env itself is
// not listed: it holds no service key, and its path also appears inside function
// declarations that run after the guard.
const FIRST_TOUCH = [/(?<!function )\bserviceRoleKey\(/, /find-generic-password/, /(?<!function )\bloadEnv\(\)/,
  /\bcreateClient\(/, /\bfetch\(/]

const code = src => src.split('\n').map(l => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l)).join('\n')

export function classify(src) {
  const c = code(src)
  const key = KEY.test(c)
  const write = WRITE.test(c.replace(NOT_A_WRITE, ''))
  if (!key || !write) return { kind: key ? 'read-only (key, no write)' : 'no key' }
  const guardAt = c.search(/\bprodWriteGuard\(/)
  if (guardAt < 0) return { kind: 'writer', ok: false, why: 'never calls prodWriteGuard()' }
  const touches = FIRST_TOUCH.map(re => c.search(re)).filter(i => i >= 0)
  const first = touches.length ? Math.min(...touches) : Infinity
  if (first < guardAt) {
    const line = c.slice(0, first).split('\n').length
    return { kind: 'writer', ok: false, why: `touches a key/env/client/network at line ${line}, before the guard` }
  }
  return { kind: 'writer', ok: true }
}

if (process.argv.includes('--selftest')) {
  let bad = 0
  const t = (label, got, want) => { const ok = got === want; if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(44)} ${got}${ok ? '' : `  wanted ${want}`}`) }
  const guard = "prodWriteGuard({ wouldWrite: !dry, workflow: 'x' })\n"
  const client = "const sb = createClient(url, serviceRoleKey())\nawait sb.from('t').upsert(rows)\n"
  t('guarded writer passes', classify(guard + client).ok, true)
  t('unguarded writer fails', classify(client).ok, false)
  t('guard AFTER the client fails', classify(client + guard).ok, false)
  t('guard after a Keychain read fails', classify("const k = execFileSync('security',['find-generic-password','-s','ada-supabase-service-role'])\n" + guard + "x.update(1)").ok, false)
  t('a commented-out guard does not count', classify('// ' + guard + client).ok, false)
  t('a loadEnv() DECLARATION above the guard is fine', classify("function loadEnv() {}\n" + guard + 'loadEnv()\n' + client).ok, true)
  t('a loadEnv() CALL above the guard fails', classify('loadEnv()\n' + guard + client).ok, false)
  t('hash.update is not a write', classify("const k = process.env.SUPABASE_SERVICE_ROLE_KEY\ncreateHash('sha256').update(x)").kind, 'read-only (key, no write)')
  t('edge-function call counts as a write', classify("const k = process.env.SUPABASE_SECRET_KEY\nawait fetch(`${u}/functions/v1/x`)").ok, false)
  console.log(bad ? `\n  ${bad} self-test failure(s).` : '\n  Self-test clean.')
  process.exit(bad ? 1 : 0)
}

const files = readdirSync(resolve(ROOT, 'scripts'), { recursive: true })
  .filter(f => /\.(mjs|cjs|js)$/.test(f) && !f.includes('node_modules'))
  .map(f => resolve(ROOT, 'scripts', f))
  .filter(f => !f.endsWith('lib/prod-write-guard.mjs') && !f.endsWith('check-prod-write-guard.mjs'))
  .sort()

const rows = files.map(f => ({ file: relative(ROOT, f), ...classify(readFileSync(f, 'utf8')) }))
const writers = rows.filter(r => r.kind === 'writer')
const readOnly = rows.filter(r => r.kind.startsWith('read-only'))
const failing = writers.filter(r => !r.ok)

console.log(`\nProduction writers (${writers.length}) — each must call prodWriteGuard() first:`)
for (const r of writers) console.log(`  ${r.ok ? '✓' : '✗'} ${r.file}${r.ok ? '' : `  — ${r.why}`}`)
console.log(`\nRead-only with a service key (${readOnly.length}) — no guard needed; they cannot run locally once the key is gone:`)
for (const r of readOnly) console.log(`    ${r.file}`)
console.log(`\n${rows.length - writers.length - readOnly.length} other script(s) reach no service key.`)
if (failing.length) {
  console.error(`\n✗ ${failing.length} writer(s) without a guard in front. Add, before any key/.env/client/fetch:`)
  console.error(`    import { prodWriteGuard } from './lib/prod-write-guard.mjs'`)
  console.error(`    prodWriteGuard({ wouldWrite: <true when this run writes>, workflow: '<workflow name or null>' })`)
  process.exit(1)
}
console.log('\n✓ every production writer is guarded.')

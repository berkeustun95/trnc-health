#!/usr/bin/env node
// ─── .easignore must exclude everything .gitignore does ──────────────────────
//
//   node scripts/check-easignore.mjs          # guard (pre-push): exit 1 when a rule is missing
//   node scripts/check-easignore.mjs --self   # proves the guard can go red
//
// When .easignore exists, EAS uses it INSTEAD of .gitignore for the build upload, so a file
// that is only gitignored is packed and sent with every build. Found 2026-10-28: .env (test
// passwords), a local *.jks keystore and .claude/settings.local.json in the archive
// (`eas build:inspect --stage archive`). Every .gitignore rule must therefore also be an
// .easignore rule; .easignore may add its own (vendor/, the Play service account, …).
import { readFileSync } from 'node:fs'

const rules = text => new Set(text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')))

export function missingRules(gitignore, easignore) {
  const eas = rules(easignore)
  return [...rules(gitignore)].filter(r => !eas.has(r))
}

if (process.argv.includes('--self')) {
  const git = '.env\n*.jks\n# comment\nvendor/\n'
  const okEas = '# header\n.env\n*.jks\nvendor/\nextra/\n'
  const badEas = '.env\nvendor/\n'
  const a = missingRules(git, okEas), b = missingRules(git, badEas)
  const pass = a.length === 0 && b.length === 1 && b[0] === '*.jks'
  console.log(`easignore self-test: complete file → ${a.length} missing; file without *.jks → [${b.join(', ')}]`)
  if (!pass) { console.error('✗ easignore self-test FAILED: the guard cannot see a missing rule'); process.exit(1) }
  console.log('easignore self-test: OK')
  process.exit(0)
}

const missing = missingRules(readFileSync('.gitignore', 'utf8'), readFileSync('.easignore', 'utf8'))
if (missing.length) {
  console.error(`✗ .easignore is missing ${missing.length} .gitignore rule(s); EAS would upload what they hide:`)
  for (const r of missing) console.error(`    ${r}`)
  console.error('  Copy them into the .gitignore block at the top of .easignore.')
  process.exit(1)
}
console.log(`easignore: OK (all ${rules(readFileSync('.gitignore', 'utf8')).size} .gitignore rules are in .easignore)`)

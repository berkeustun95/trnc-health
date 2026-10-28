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
// Not watched: .git/info/exclude and ~/.config/git/ignore (machine-local; their rules are
// copied by hand into .easignore's second block) and nested .gitignore files.
import { readFileSync } from 'node:fs'

const rules = text => new Set(text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')))

export function missingRules(gitignore, easignore) {
  const eas = rules(easignore)
  return [...rules(gitignore)].filter(r => !eas.has(r))
}

// A `!` rule re-includes what an earlier rule excluded, so presence alone is not enough: an
// `.easignore`-only `!.env` would ship .env with every rule above still "present".
export function extraNegations(gitignore, easignore) {
  const git = rules(gitignore)
  return [...rules(easignore)].filter(r => r.startsWith('!') && !git.has(r))
}

if (process.argv.includes('--self')) {
  const git = '.env\n*.jks\n# comment\nvendor/\n'
  const okEas = '# header\n.env\n*.jks\nvendor/\nextra/\n'
  const badEas = '.env\nvendor/\n'
  const negEas = okEas + '!.env\n'
  const a = missingRules(git, okEas), b = missingRules(git, badEas), n = extraNegations(git, negEas)
  const pass = a.length === 0 && extraNegations(git, okEas).length === 0 && b.length === 1 && b[0] === '*.jks' && n.length === 1 && n[0] === '!.env'
  console.log(`easignore self-test: complete file → ${a.length} missing; file without *.jks → [${b.join(', ')}]; file with !.env → [${n.join(', ')}]`)
  if (!pass) { console.error('✗ easignore self-test FAILED: the guard cannot see a missing rule or a re-include'); process.exit(1) }
  console.log('easignore self-test: OK')
  process.exit(0)
}

const gi = readFileSync('.gitignore', 'utf8'), ea = readFileSync('.easignore', 'utf8')
const missing = missingRules(gi, ea), negs = extraNegations(gi, ea)
if (missing.length || negs.length) {
  if (missing.length) {
    console.error(`✗ .easignore is missing ${missing.length} .gitignore rule(s); EAS would upload what they hide:`)
    for (const r of missing) console.error(`    ${r}`)
    console.error('  Copy them into the .gitignore block at the top of .easignore.')
  }
  if (negs.length) {
    console.error(`✗ .easignore re-includes with ${negs.length} \`!\` rule(s) .gitignore does not have:`)
    for (const r of negs) console.error(`    ${r}`)
  }
  process.exit(1)
}
console.log(`easignore: OK (all ${rules(readFileSync('.gitignore', 'utf8')).size} .gitignore rules are in .easignore)`)

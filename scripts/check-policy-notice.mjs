#!/usr/bin/env node
// The policy-update notice: who is told, and who must NOT be (utils/policyNoticeRules.js).
import { shouldShowPolicyNotice as show } from '../utils/policyNoticeRules.js'
const C = '2026-10-01', OLD = '2026-09-20'
const cases = [
  ['account that accepted an OLDER version → told',            { seen: null, termsVersion: OLD, current: C, returning: true },  true],
  ['…even on a device that was never onboarded (reinstall)',   { seen: null, termsVersion: OLD, current: C, returning: false }, true],
  ['account that accepted THIS version (new signup) → not',     { seen: null, termsVersion: C,   current: C, returning: false }, false],
  ['already dismissed for this version → not',                  { seen: C,    termsVersion: OLD, current: C, returning: true },  false],
  ['dismissed for an OLDER version → told again',               { seen: OLD,  termsVersion: OLD, current: C, returning: true },  true],
  ['returning guest (no account) → told',                       { seen: null, termsVersion: null, current: C, returning: true }, true],
  ['brand-new install, no account → not',                       { seen: null, termsVersion: null, current: C, returning: false }, false],
]
let bad = 0
for (const [label, input, want] of cases) {
  const got = show(input)
  if (got !== want) bad++
  console.log(`  ${got === want ? '✓' : '✗'} ${label}${got === want ? '' : `  → got ${got}`}`)
}
if (bad) { console.error(`\n  POLICY NOTICE CHECK FAILED — ${bad}\n`); process.exit(1) }
console.log('\npolicy notice rules: OK\n')

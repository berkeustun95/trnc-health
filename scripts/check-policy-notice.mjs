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
// STRUCTURE (the 2026-09-24 incident): the notice must be rendered AFTER the lines that
// define its visibility and its handler, in the same render — i.e. in App's final return,
// not inside the content selector that runs before them. Hermes has no TDZ: earlier use
// reads undefined, and Modal visible={undefined} is SHOWN.
import { readFileSync } from 'node:fs'
{
  const app = readFileSync(new URL('../App.js', import.meta.url), 'utf8')
  const use = app.indexOf('<PolicyUpdateNotice')
  const defVisible = app.indexOf('const policyNoticeVisible')
  const defDismiss = app.indexOf('const dismissPolicyNotice')
  const finalReturn = app.indexOf('  return (\n    <SafeAreaProvider>')
  const ok = use > 0 && defVisible > 0 && defDismiss > 0 && finalReturn > 0 && use > defVisible && use > defDismiss && use > finalReturn
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} App.js renders <PolicyUpdateNotice> in the final return, after its visibility and handler are defined` +
    (ok ? '' : `  → use@${use} visible@${defVisible} dismiss@${defDismiss} return@${finalReturn}`))
  const comp = readFileSync(new URL('../components/PolicyUpdateNotice.js', import.meta.url), 'utf8')
  const strict = /<Modal visible=\{visible === true\}/.test(comp)
  if (!strict) bad++
  console.log(`  ${strict ? '✓' : '✗'} the Modal is shown only for visible === true (RN treats undefined as shown)`)
}
if (bad) { console.error(`\n  POLICY NOTICE CHECK FAILED — ${bad}\n`); process.exit(1) }
console.log('\npolicy notice rules: OK\n')

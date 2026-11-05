#!/usr/bin/env node
// utils/browserFallback.js: the system browser opens only when an Android tab did not come up. Wiring pins for both doors below.
import fs from 'node:fs'
import { openWithFallback, BROWSER_OPEN_TIMEOUT_MS, BROWSER_BOUNCE_MS } from '../utils/browserFallback.js'

let bad = 0
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`) }
const tick = () => new Promise(r => setImmediate(r))

// events = [[atMs, state]], delivered in order on a fake clock; the 2000 ms timer then fires.
async function run({ platform = 'android', events = [], opens = () => Promise.resolve({ type: 'opened' }), systemFails = false }) {
  const listeners = new Set(), system = []
  let clock = 0, fire = null
  const appState = { addEventListener: (_, f) => { listeners.add(f); return { remove: () => listeners.delete(f) } } }
  const out = openWithFallback({
    platform, appState, url: 'https://x.test/', setTimer: f => { fire = f }, now: () => clock,
    openSystem: async u => { if (systemFails) throw new Error('no browser'); system.push(u) },
    open: opens,
  }).then(r => ({ r }), () => ({ threw: true }))
  await tick()
  for (const [at, state] of events) { clock = at; [...listeners].forEach(l => l(state)) }
  clock = BROWSER_OPEN_TIMEOUT_MS
  fire?.()
  const res = await out
  return { result: res.threw ? 'threw' : res.r, system: system.length, listeners: listeners.size }
}
const noTab = { result: 'system', system: 1, listeners: 0 }
const tab = { result: 'in-app', system: 0, listeners: 0 }

eq('the 2 seconds Berke asked for', BROWSER_OPEN_TIMEOUT_MS, 2000)
eq('a tab that stays up: no system browser', await run({ events: [[10, 'background']] }), tab)
eq('never left ADA: the same link in the system browser, once', await run({}), noTab)
eq('2026-11-03: the launcher bounced ADA for 150 ms, no tab: system browser', await run({ events: [[10, 'background'], [160, 'active']] }), noTab)
eq('a bounce just under the limit: system browser', await run({ events: [[10, 'background'], [10 + BROWSER_BOUNCE_MS - 1, 'active']] }), noTab)
eq('the user read the tab and closed it inside 2 s: no system browser', await run({ events: [[10, 'background'], [10 + BROWSER_BOUNCE_MS, 'active']] }), tab)
eq('bounce, then a slow tab that stays up: no system browser', await run({ events: [[10, 'background'], [150, 'active'], [900, 'background']] }), tab)
eq('a late "active" with no leave before it is not a visit: system browser', await run({ events: [[100, 'active']] }), noTab)
eq('Android refuses the tab: system browser, once', await run({ opens: () => Promise.reject(new Error('refused')) }), noTab)
eq('the system browser fails too: the caller hears it', (await run({ opens: () => Promise.reject(new Error('refused')), systemFails: true })).result, 'threw')
eq('iOS: never the system browser (SFSafariViewController keeps ADA active)', await run({ platform: 'ios' }), tab)
eq('iOS refused: thrown to the caller, not stacked in Safari', await run({ platform: 'ios', opens: () => Promise.reject(new Error('refused')) }), { result: 'threw', system: 0, listeners: 0 })

for (const [name, file] of [['partner hand-off', '../utils/eaterySite.js'], ['KKTCELL hand-off', '../lib/connectivity.js']]) {
  const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
  eq(`wiring: ${name} opens through the fallback`, /await openWithFallback\(\{ platform: Platform\.OS, appState: AppState, openSystem: u => Linking\.openURL\(u\), url, open: \(\) => WebBrowser\.openBrowserAsync\(url, \{/.test(src), true)
  eq(`wiring: ${name} has no direct open left`, src.split('openBrowserAsync(url').length, 2)
}
if (bad) { console.error(`\n✗ browser fallback: ${bad} failed`); process.exit(1) }
console.log('\nbrowser fallback: OK')

#!/usr/bin/env node
// utils/browserFallback.js: the system browser opens only when an Android tab did not come up. Wiring pins for both doors below.
import fs from 'node:fs'
import { openWithFallback, BROWSER_OPEN_TIMEOUT_MS } from '../utils/browserFallback.js'

let bad = 0
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`) }

function rig({ platform = 'android', leavesAt = null, state = 'background', opens = () => Promise.resolve({ type: 'opened' }), systemFails = false }) {
  const listeners = new Set(), system = []
  let removed = 0, cleared = 0
  const appState = { addEventListener: (_, f) => { listeners.add(f); return { remove: () => { removed++; listeners.delete(f) } } } }
  let fire = null
  const setTimer = f => { fire = f; return 1 }
  const clearTimer = () => { cleared++ }
  const run = openWithFallback({
    platform, appState, url: 'https://x.test/', ms: 2000, setTimer, clearTimer,
    openSystem: async u => { if (systemFails) throw new Error('no browser'); system.push(u) },
    open: async () => { const r = await opens(); if (leavesAt === 'during') [...listeners].forEach(l => l(state)); return r },
  })
  return { run, system, timeUp: () => fire?.(), leave: s => [...listeners].forEach(l => l(s)), listeners, counts: () => ({ removed, cleared }) }
}
const tick = () => new Promise(r => setImmediate(r))

eq('the timeout is the 2 seconds Berke asked for', BROWSER_OPEN_TIMEOUT_MS, 2000)
{ const r = rig({ leavesAt: 'during' }); eq('a tab that comes up while opening: no system browser', [await r.run, r.system], ['in-app', []]); eq('  the listener and timer are released', r.counts(), { removed: 1, cleared: 1 }) }
{ const r = rig({}); await tick(); r.leave('background'); eq('a tab that comes up after the open resolves: no system browser', [await r.run, r.system], ['in-app', []]) }
{ const r = rig({}); await tick(); r.timeUp(); eq('no tab within the time: the same link in the system browser, once', [await r.run, r.system], ['system', ['https://x.test/']]); eq('  the listener is released', r.listeners.size, 0) }
{ const r = rig({}); await tick(); r.leave('active'); r.timeUp(); eq('"active" is not leaving: still falls back', [await r.run, r.system], ['system', ['https://x.test/']]) }
{ const r = rig({ opens: () => Promise.reject(new Error('refused')) }); await tick(); eq('Android refuses the tab: system browser at once', [await r.run, r.system], ['system', ['https://x.test/']]) }
{ const r = rig({ opens: () => Promise.reject(new Error('refused')), systemFails: true }); await tick(); let threw = false; try { await r.run } catch { threw = true } eq('the system browser fails too: the caller hears it', threw, true) }
{ const r = rig({ platform: 'ios' }); eq('iOS: never the system browser (SFSafariViewController keeps ADA active)', [await r.run, r.system, r.listeners.size], ['in-app', [], 0]) }
{ const r = rig({ platform: 'ios', opens: () => Promise.reject(new Error('refused')) }); let threw = false; try { await r.run } catch { threw = true } eq('iOS refused: thrown to the caller, not stacked in Safari', [threw, r.system], [true, []]) }

for (const [name, file] of [['partner hand-off', '../utils/eaterySite.js'], ['KKTCELL hand-off', '../lib/connectivity.js']]) {
  const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
  eq(`wiring: ${name} opens through the fallback`, /await openWithFallback\(\{ platform: Platform\.OS, appState: AppState, openSystem: u => Linking\.openURL\(u\), url, open: \(\) => WebBrowser\.openBrowserAsync\(url, \{/.test(src), true)
  eq(`wiring: ${name} has no direct open left`, src.split('openBrowserAsync(url').length, 2)
}
if (bad) { console.error(`\n✗ browser fallback: ${bad} failed`); process.exit(1) }
console.log('\nbrowser fallback: OK')

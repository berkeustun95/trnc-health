// Safety net for the in-app browser on Android (Berke, 2026-11-05): openBrowserAsync resolves 'opened' as soon as Android accepts
// the intent, even when the browser then shows nothing (Samsung Internet, 2026-11-03, cause unknown). The only signal that a tab
// really came up is ADA leaving the foreground, so no such signal within `ms` opens the same link in the system browser.
// Android only: SFSafariViewController is presented inside ADA, which stays 'active' for the whole visit.
// Dependencies are passed in so scripts/test-browser-fallback.mjs can run this without React Native.
export const BROWSER_OPEN_TIMEOUT_MS = 2000

function leavesForeground(appState, ms, setTimer, clearTimer) {
  return new Promise(resolve => {
    let sub = null
    const done = left => { clearTimer(timer); sub?.remove(); resolve(left) }
    const timer = setTimer(() => done(false), ms)
    sub = appState.addEventListener('change', next => { if (next !== 'active') done(true) })
  })
}

export async function openWithFallback({ platform, appState, openSystem, url, open, ms = BROWSER_OPEN_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  if (platform !== 'android') { await open(); return 'in-app' }
  const left = leavesForeground(appState, ms, setTimer, clearTimer)   // listening BEFORE the open: a fast tab must not be missed
  let refused = false
  try { await open() } catch { refused = true }
  if (!refused && await left) return 'in-app'
  await openSystem(url)
  return 'system'
}

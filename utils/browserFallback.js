// Safety net for the in-app browser on Android (Berke, 2026-11-05): openBrowserAsync resolves 'opened' as soon as Android accepts
// the intent, even when the browser then shows nothing (Samsung Internet, 2026-11-03, cause unknown: its launcher activity started
// and no tab followed). The launcher alone sends ADA to the background within ~10 ms, so "ADA left the foreground" proves nothing.
// The verdict is taken at the deadline: still away = a tab is up; back after a real visit = the user closed it; never left, or back
// after a bounce shorter than BROWSER_BOUNCE_MS = no tab, so the same link opens in the system browser.
// Android only: SFSafariViewController is presented inside ADA, which stays 'active' for the whole visit.
// Dependencies are passed in so scripts/test-browser-fallback.mjs can run this without React Native.
export const BROWSER_OPEN_TIMEOUT_MS = 2000
export const BROWSER_BOUNCE_MS = 800

function tabCameUp({ appState, ms, bounceMs, setTimer, now }) {
  return new Promise(resolve => {
    let awaySince = null, lastAway = 0
    const sub = appState.addEventListener('change', next => {
      if (next !== 'active') { if (awaySince === null) awaySince = now() }
      else if (awaySince !== null) { lastAway = now() - awaySince; awaySince = null }
    })
    setTimer(() => { sub.remove(); resolve(awaySince !== null || lastAway >= bounceMs) }, ms)
  })
}

export async function openWithFallback({ platform, appState, openSystem, url, open, ms = BROWSER_OPEN_TIMEOUT_MS, bounceMs = BROWSER_BOUNCE_MS, setTimer = setTimeout, now = Date.now }) {
  if (platform !== 'android') { await open(); return 'in-app' }
  const up = tabCameUp({ appState, ms, bounceMs, setTimer, now })   // listening BEFORE the open: a fast tab must not be missed
  try { await open() } catch { await openSystem(url); return 'system' }
  if (await up) return 'in-app'
  await openSystem(url)
  return 'system'
}

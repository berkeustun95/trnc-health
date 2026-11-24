// Decides WHEN to ask for a missing profile again, with no timers inside (jest drives it; App owns the interval).
// Needed because JS timers pause with the screen off and a hung fetch never fails: after the automatic retries give up,
// nothing else re-asks. isMissing() is true while there is a session whose profile is not held.
// Only the NEWEST load counts: a superseded older load may settle late or never and is ignored. A load still unsettled
// PROFILE_STALE_LOAD_MS after it started is treated as hung and a fresh one supersedes it (no timer needed: any read or tick does it).
export const PROFILE_SCREEN_RETRY_MS = 15000
export const PROFILE_STALE_LOAD_MS = 10000

export function createProfileRecovery({ loadOnce, isMissing, current, log = () => {}, now = Date.now }) {
  let newestId = 0
  let newestStart = 0
  let newestSettled = true
  let wanted = false

  function load(session) {
    const id = ++newestId
    newestStart = now()
    newestSettled = false
    const settle = () => {
      if (id !== newestId) return // a superseded load settling late must not disturb the newest one
      newestSettled = true
      if (!wanted) return
      wanted = false // cleared first: a reload that fails again must not loop
      const s = current() // the session NOW, not the one that asked: it may have signed out since
      if (s && isMissing()) { log('wanted-reload'); load(s) }
    }
    let p
    try { p = Promise.resolve(loadOnce(session)) } catch (e) { p = Promise.reject(e) }
    return p.then(settle, settle)
  }

  const busy = () => !newestSettled // busy = the newest load has not settled yet
  const staleAge = () => now() - newestStart
  const isStale = () => busy() && staleAge() >= PROFILE_STALE_LOAD_MS
  const ageSec = () => Math.floor(staleAge() / 1000)

  // A Home read just succeeded, so the network works: a profile that is still missing gets asked for again now.
  function homeReadOk(session) {
    if (!session || !isMissing()) return
    if (isStale()) { log('supersede-stale', { age: ageSec(), via: 'home' }); load(session); return }
    if (busy()) { wanted = true; log('reload-wanted'); return }
    log('home-ok-reload')
    load(session)
  }

  // beforeLoad runs just before the load starts (App marks the offline screen as shown so success reloads Home's data).
  function screenTick(session, beforeLoad = () => {}) {
    if (!session || !isMissing() || (busy() && !isStale())) { log('screen-tick', { started: false }); return false }
    if (busy()) log('supersede-stale', { age: ageSec(), via: 'tick' })
    log('screen-tick', { started: true })
    beforeLoad()
    load(session)
    return true
  }

  return { load, busy, homeReadOk, screenTick }
}

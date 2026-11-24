// Decides WHEN to ask for a missing profile again, with no timers inside (jest drives it; App owns the interval).
// Needed because JS timers pause with the screen off and a hung fetch never fails: after the automatic retries give up,
// nothing else re-asks. isMissing() is true while there is a session whose profile is not held.
// A counter, not a flag: a superseded older load can still be running next to the newest one.
export const PROFILE_SCREEN_RETRY_MS = 15000

export function createProfileRecovery({ loadOnce, isMissing, current, log = () => {} }) {
  let inFlight = 0
  let wanted = false

  function load(session) {
    inFlight++
    const settle = () => {
      inFlight--
      if (inFlight > 0 || !wanted) return
      wanted = false // cleared first: a reload that fails again must not loop
      const s = current() // the session NOW, not the one that asked: it may have signed out since
      if (s && isMissing()) { log('wanted-reload'); load(s) }
    }
    let p
    try { p = Promise.resolve(loadOnce(session)) } catch (e) { p = Promise.reject(e) }
    return p.then(settle, settle)
  }

  const busy = () => inFlight > 0

  // A Home read just succeeded, so the network works: a profile that is still missing gets asked for again now.
  function homeReadOk(session) {
    if (!session || !isMissing()) return
    if (busy()) { wanted = true; log('reload-wanted'); return }
    log('home-ok-reload')
    load(session)
  }

  // beforeLoad runs just before the load starts (App marks the offline screen as shown so success reloads Home's data).
  function screenTick(session, beforeLoad = () => {}) {
    if (!session || busy() || !isMissing()) { log('screen-tick', { started: false }); return false }
    log('screen-tick', { started: true })
    beforeLoad()
    load(session)
    return true
  }

  return { load, busy, homeReadOk, screenTick }
}

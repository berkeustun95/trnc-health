// Push-tap routing, pure (no React Native imports) so __tests__/pushRoute.test.js runs it as is.
// App.js has ONE place that acts on these (routePush / takePushResponse); the warm listener, the cold-start read and a
// tap parked before the session restored all go through it.

// Which screen a push asks for, or null. Precedence is the order of the branches.
export function pushRoute(data, { studentHub } = {}) {
  if (!data || typeof data !== 'object') return null
  const screen = data.screen
  if (screen === 'duty') return 'duty'
  if (screen === 'weekend') return 'weekend'
  if (screen === 'profile') return 'profile'
  if (screen === 'notifications') return 'notifications'
  // Gated on the flag: a tap must never land on Coming Soon. This push can only come from 20261029's messaging, so on a
  // bundle where the module is dark the notification is from a feature this build lacks; doing nothing is honest.
  if (screen === 'conversation') return studentHub === true ? 'conversation' : null
  if (screen === 'eatery_order') return 'eatery_order'
  if (screen === 'admin') return 'admin'
  if (screen === 'marketplace' || screen === 'marketplace_conversation') return 'marketplace'
  return null
}

// What to do with a tap response. 'dup' = this notification id was already routed in this runtime (the warm listener and
// the cold-start read can both see the same tap); 'park' = no session yet, keep it and route once there is one.
// The caller adds `id` to `handled` on 'route'.
export function pushIntake(response, { hasSession, handled } = {}) {
  try {
    const request = response?.notification?.request
    if (!request) return { action: 'none', id: null, data: {} }
    const id = request.identifier ?? null
    const data = request.content?.data ?? {}
    if (id != null && handled?.has(id)) return { action: 'dup', id, data }
    if (!hasSession) return { action: 'park', id, data }
    return { action: 'route', id, data }
  } catch {
    return { action: 'none', id: null, data: {} }
  }
}

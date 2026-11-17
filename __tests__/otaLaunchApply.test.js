import { otaApplyBlocker, openedByPush, OTA_APPLY_WINDOW_MS } from '../utils/otaLaunchApply'

const OK = { fetchedId: 'b', runningId: 'a', emergency: false, elapsedMs: 2500, touched: false, appState: 'active', launchedByTap: false, launchedByLink: false, lastAppliedId: null }

test('a fresh launch, untouched, reloads into the new update', () => {
  expect(otaApplyBlocker(OK)).toBeNull()
})

test.each([
  ['nothing fetched', { fetchedId: null }],
  ['fetched the one already running', { fetchedId: 'a' }],
  ['emergency launch (the new bundle failed before)', { emergency: true }],
  ['already reloaded once for it: no loop', { lastAppliedId: 'b' }],
  ['past the launch window', { elapsedMs: OTA_APPLY_WINDOW_MS + 1 }],
  ['the user touched the screen', { touched: true }],
  ['app went to the background', { appState: 'background' }],
  ['opened from a push', { launchedByTap: true }],
  ['opened from a link', { launchedByLink: true }],
])('no reload: %s', (_, over) => {
  expect(otaApplyBlocker({ ...OK, ...over })).not.toBeNull()
})

test('an older applied id does not block a newer update', () => {
  expect(otaApplyBlocker({ ...OK, lastAppliedId: 'a' })).toBeNull()
})

// notification.date is NOT the tap time: iOS sends seconds since 1970, Android the server's send time (google.sent_time).
// A duty push sent at 17:00 and tapped at 17:10 opened this launch all the same.
describe('openedByPush', () => {
  const sent = Date.now() - 10 * 60 * 1000
  test('Android: tapped 10 min after the server sent it', () => {
    expect(openedByPush({ notification: { date: sent } }, false)).toBe(true)
  })
  test('iOS: date in seconds', () => {
    expect(openedByPush({ notification: { date: Math.floor(sent / 1000) } }, false)).toBe(true)
  })
  test('a push handler already routed, the response already cleared', () => {
    expect(openedByPush(null, true)).toBe(true)
  })
  test('no tap, nothing routed', () => {
    expect(openedByPush(null, false)).toBe(false)
  })
})

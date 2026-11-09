import { otaApplyBlocker, OTA_APPLY_WINDOW_MS } from '../utils/otaLaunchApply'

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

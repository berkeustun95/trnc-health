// Onboarding v2: the App.js ORDERING the pure rules (utils/onboardingState.js) cannot see. Source-shape
// assertions in the style of signOutHelper.test.js. ONB_APP_SRC points the suite at another copy of App.js
// (QA plants each break in a scratch copy to prove every test can go red).
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync(process.env.ONB_APP_SRC || path.join(__dirname, '..', 'App.js'), 'utf8')

// The body of `function <name>(` / `async function <name>(` up to the next line that closes at 2-space indent.
function fnBody(name) {
  const m = src.match(new RegExp(`\\n  (?:async )?function ${name}\\(`))
  if (!m) throw new Error(`function ${name} not found`)
  const start = m.index
  const end = src.indexOf('\n  }\n', start)
  if (end < 0) throw new Error(`end of ${name} not found`)
  return src.slice(start, end)
}
function at(hay, needle, label) {
  const i = hay.indexOf(needle)
  if (i < 0) throw new Error(`${label}: ${JSON.stringify(needle)} not found`)
  return i
}
const selectorStart = at(src, '\n  let content\n', 'selector')

test('Hemen başla: pending duty is awaited on disk BEFORE signInAnonymously', () => {
  const b = fnBody('startAsGuest')
  expect(at(b, 'await setPending(PENDING_DUTY)', 'arm')).toBeLessThan(at(b, 'signInAnonymously()', 'sign-in'))
  expect(b).toMatch(/if \(armPending\(\)\) await setPending\(PENDING_DUTY\)/)
})

test('setPending writes KEY_PENDING (or removes it) inside a try', () => {
  const b = fnBody('setPending')
  expect(b).toMatch(/try \{\s*if \(value\) await AsyncStorage\.setItem\(KEY_PENDING, value\)\s*else await AsyncStorage\.removeItem\(KEY_PENDING\)\s*\} catch \{\}/)
})

test('Giriş yap clears pending and never arms it', () => {
  const b = fnBody('startLogin')
  expect(b).toContain('await setPending(null)')
  expect(b).not.toMatch(/PENDING_(DUTY|SIGNUP)/)
})

test('SIGNED_OUT removes the pending key (state + storage)', () => {
  const i = at(src, "if (event === 'SIGNED_OUT') {", 'signed-out handler')
  const block = src.slice(i, src.indexOf('\n      }\n', i))
  expect(block).toContain('setOnbPending(null)')
  expect(block).toContain('AsyncStorage.removeItem(KEY_PENDING)')
})

test('Screen 2 resolve: outcome remembered before pending clears; onboarded written only after pending is removed', () => {
  const b = fnBody('resolveDutyOffer')
  const remember = at(b, 'rememberDutyOffer(outcome)', 'remember')
  const clear = at(b, 'await setPending(null)', 'clear pending')
  const onb = at(b, "AsyncStorage.setItem(KEY_ONBOARDED, 'true')", 'onboarded')
  expect(remember).toBeLessThan(clear)
  expect(clear).toBeLessThan(onb)
})

test('wizard done: signup -> duty is set before the profile reload', () => {
  const i = at(src, 'const next = pendingAfterWizard(onbPending)', 'wizard hand-off')
  expect(i).toBeLessThan(src.indexOf('reloadProfile()', i))
  expect(src.slice(i, src.indexOf('reloadProfile()', i))).toContain('AsyncStorage.setItem(KEY_PENDING, next)')
})

test('second offer: decided, THEN KEY_REOFFER awaited, THEN shown; a push-opened list returns first', () => {
  const b = fnBody('maybeOfferDutyAgain')
  expect(b).toMatch(/^\s*async function maybeOfferDutyAgain\(fromPush\) \{\s*if \(fromPush \|\|/)
  const decide = at(b, 'decideReoffer(', 'decide')
  const write = at(b, 'await AsyncStorage.setItem(KEY_REOFFER, REOFFER_SHOWN)', 'write')
  const show = at(b, 'setDutyReoffer(variant)', 'show')
  expect(decide).toBeLessThan(write)
  expect(write).toBeLessThan(show)
  expect(b).toMatch(/if \(!variant\) return/)
})

test('closeDutyList hands the from-push mark to the second offer', () => {
  const b = fnBody('closeDutyList')
  expect(at(b, 'const fromPush = dutyFromPushRef.current', 'read')).toBeLessThan(at(b, 'maybeOfferDutyAgain(fromPush)', 'offer'))
})

test('both push handlers (warm and cold start) mark the duty list as push-opened', () => {
  const warm = src.match(/if \(screen === 'duty'\) \{\s*dutyFromPushRef\.current = true\s*\n\s*setShowDutyList\(true\)/g) || []
  const cold = src.match(/if \(screen === 'duty'\) \{ dutyFromPushRef\.current = true; setShowDutyList\(true\) \}/g) || []
  expect([warm.length, cold.length]).toEqual([1, 1])
  // and no duty-screen push branch opens the list without the mark
  const unmarked = src.match(/screen === 'duty'\)\s*setShowDutyList\(true\)/g) || []
  expect(unmarked).toEqual([])
})

test('launch registration: waits for pending, honours "later", reads (never requests) the permission', () => {
  const i = at(src, 'async function registerPushToken()', 'registration')
  const head = src.slice(src.lastIndexOf('useEffect(() => {', i), i)
  expect(head).toContain('if (pushRetry === 0 && onbPending !== null) return')
  expect(head).toContain('if (pushRetry === 0 && !launchMayRegisterPush(dutyOfferRef.current)) return')
  const body = src.slice(i, src.indexOf('registerPushToken()\n', i))
  expect(body).toMatch(/pushRetry === 0\s*\?\s*await Notifications\.getPermissionsAsync\(\)/)
  expect(body.indexOf("if (status !== 'granted') return")).toBeLessThan(body.indexOf('getExpoPushTokenAsync'))
})

test('selector order: force block above Start; age screen above Screen 2; Screen 2 above the wizard block; one Screen 2', () => {
  const sel = src.slice(selectorStart)
  const force = at(sel, "} else if (updateTier === 'force') {", 'force')
  const start = at(sel, '} else if (!session && showWelcome) {', 'start')
  const age = at(sel, '} else if (ageIneligible) {', 'age')
  const duty = at(sel, "} else if (onbStep === 'duty') {", 'duty')
  const gate = at(sel, '} else if (gateActive) {', 'gate')
  expect(force).toBeLessThan(start)
  expect(sel.indexOf('<StartScreen', start)).toBeLessThan(sel.indexOf('} else if', start + 5))
  expect(age).toBeLessThan(duty)
  expect(duty).toBeLessThan(gate)
  expect((src.match(/<DutyAlertsScreen\b/g) || []).length).toBe(1)
  expect(sel.indexOf('<DutyAlertsScreen', duty)).toBeLessThan(gate)
})

test('force-update modal shows from boot, Start included (not only on an onboarded device); soft stays onboarded-only', () => {
  const i = at(src, 'const appUpdateVisible =', 'appUpdateVisible')
  const expr = src.slice(i, src.indexOf('\n  //', i))
  expect(expr).toContain('onboarded !== null')
  expect(expr).toMatch(/\(forceBlocking \|\| \(updateTier === 'soft' && onboarded === true/)
  expect(expr.slice(0, expr.indexOf('(forceBlocking'))).not.toContain('onboarded === true')
})

test('second offer only for a guest or this session\'s customer, past force / wizard / age gates', () => {
  const i = at(src, 'reofferBlockedRef.current = !(', 'reoffer gate')
  const expr = src.slice(i, src.indexOf('\n  )\n', i))
  expect(expr).toContain("isGuest(session) || (profileUid === session.user.id && profile?.role === 'customer')")
  for (const term of ["updateTier !== 'force'", '!gateActive', '!ageIneligible', 'onbPending === null', '!showDutyList'])
    expect(expr).toContain(term)
})

test('Hermes: every value the selector reads for onboarding is declared above `let content`', () => {
  for (const decl of ['const onbStep =', 'const dutyInitialRegion =', 'const tourChipVisible =', 'const gateActive =',
    'const ageIneligible =', 'const policyNoticeDue =', 'const lang ='])
    expect(at(src, decl, decl)).toBeLessThan(selectorStart)
})

test("'nicosia' is a read fallback only: never written, never a device region or a prefill", () => {
  expect(src).not.toMatch(/(setItem|multiSet|setHomeCity|setDeviceRegion)\([^)]*'nicosia'/)
  expect(src).not.toMatch(/prefillRegion=\{[^}]*'nicosia'/)
  expect(src).not.toMatch(/KEY_HOME[^\n]*'nicosia'/)
})

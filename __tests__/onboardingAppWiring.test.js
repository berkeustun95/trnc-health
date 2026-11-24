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

test('Giriş yap (Start and the Auth login tab) arms signin on a device not yet onboarded, else clears pending', () => {
  const b = fnBody('startLogin')
  expect(b).toContain('await setPending(armPending() ? PENDING_SIGNIN : null)')
  expect(b).not.toMatch(/PENDING_(DUTY|SIGNUP)/)
  const m = fnBody('authModeChanged')
  expect(m).toContain("if (mode === 'login') setPending(armPending() ? PENDING_SIGNIN : null)")
  expect(m).not.toContain('logOnboardingEvent')
})

test('Giriş yap: the permission is read once per session while signin is pending, a failed read means Home, and it feeds the decision', () => {
  const i = at(src, 'if (!session || onbPending !== PENDING_SIGNIN || signinPerm) return', 'perm effect guard')
  const effect = src.slice(i, src.indexOf('}, [session?.user?.id, onbPending, signinPerm])', i))
  expect(effect).toContain('Notifications.getPermissionsAsync()')
  expect(effect).not.toContain('requestPermissionsAsync')
  expect(effect).toContain("setSigninPerm({ status: 'unavailable', canAskAgain: false })")
  expect(src).toMatch(/decideOnboardingStep\(\{[^}]*\n\s*perm: signinPerm,\n\s*\}\)/)
  const so = at(src, "if (event === 'SIGNED_OUT') {", 'signed-out handler')
  expect(src.slice(so, src.indexOf('\n      }\n', so))).toContain('setSigninPerm(null)')
})

test('Giriş yap -> Screen 2: the city chip is pre-selected from the profile region (regions only)', () => {
  expect(src).toMatch(/<DutyAlertsScreen [^>]*initialCity=\{REGIONS\.includes\(profile\?\.region\) \? profile\.region : null\}/)
  const duty = fs.readFileSync(path.join(__dirname, '..', 'screens', 'DutyAlertsScreen.js'), 'utf8')
  expect(duty).toMatch(/initialCity = null \}\) \{\s*const \[city, setCity\] = useState\(initialCity\)/)
})

test('a signin hand-off shows the spinner, not the Home skeleton, while the profile loads', () => {
  expect(src).toContain('} else if ((loading || !profile) && (onbPending === PENDING_DUTY || onbPending === PENDING_SIGNIN)) {')
})

test('weather with no fix: device home city, then the profile city, then Lefkoşa', () => {
  expect(src).toContain('resolvedCoords = weatherPointFor(REGIONS.includes(st?.home) ? st.home : profileRegionRef.current)')
  expect(fnBody('homeCityChanged')).toContain('fetchWeather(weatherPointFor(isRegion ? home : profileRegionRef.current))')
  const i = at(src, 'profileRegionRef.current = region', 'profile region effect')
  const effect = src.slice(i, src.indexOf('}, [profile?.region, userLocation])', i))
  expect(effect).toContain('if (!region || userLocation) return')
  expect(effect).toContain('if (!cancelled && !REGIONS.includes(st?.home)) fetchWeather(weatherPointFor(region))')
})

const startSrc = fs.readFileSync(process.env.ONB_START_SRC || path.join(__dirname, '..', 'screens', 'StartScreen.js'), 'utf8')

test('Start: Kayıt ol primary, Giriş yap outline (visible edge on the page ground), guest a visible text button; each tap logs its event before acting', () => {
  const fn = name => startSrc.slice(at(startSrc, `function ${name}(`, name), startSrc.indexOf('\n  }\n', at(startSrc, `function ${name}(`, name)))
  expect(at(fn('signUp'), 'logOnboardingEvent(START_CHOICE_EVENTS.signup)', 'log')).toBeLessThan(at(fn('signUp'), 'onSignUp()', 'act'))
  expect(at(fn('logIn'), 'logOnboardingEvent(START_CHOICE_EVENTS.signin)', 'log')).toBeLessThan(at(fn('logIn'), 'onLogin()', 'act'))
  const g = fn('start')
  expect(at(g, 'logOnboardingEvent(START_CHOICE_EVENTS.guest)', 'log')).toBeLessThan(at(g, 'await onStart()', 'act'))
  expect(startSrc).toMatch(/<Button size="lg" title=\{t\('signup', lang\)\} onPress=\{signUp\} disabled=\{busy\}/)
  expect(startSrc).toMatch(/<Button size="lg" variant="outline" title=\{t\('login', lang\)\} onPress=\{logIn\} disabled=\{busy\}/)
  expect(startSrc).toMatch(/<Button variant="text" title=\{t\('continueAsGuest', lang\)\} onPress=\{start\} loading=\{busy\}/)
  expect(startSrc).toContain('<InlineAlert message={error} />')
  // The App handlers stay unlogged: only a Start tap counts.
  for (const name of ['startAsGuest', 'startLogin', 'startSignUp']) expect(fnBody(name)).not.toContain('logOnboardingEvent')
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

test('every push path (warm, cold, parked) marks the duty list as push-opened', () => {
  // All three reach routePush through takePushResponse (__tests__/pushRouteSource.test.js), so ONE branch carries the mark.
  const marked = src.match(/case 'duty': dutyFromPushRef\.current = true; setShowDutyList\(true\); break/g) || []
  expect(marked.length).toBe(1)
  // and no push branch opens the list without the mark
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
    'const ageIneligible =', 'const policyNoticeDue =', 'const lang =', 'const [signinPerm, setSigninPerm]', 'const profileRegionRef ='])
    expect(at(src, decl, decl)).toBeLessThan(selectorStart)
})

test("'nicosia' is a read fallback only: never written, never a device region or a prefill", () => {
  expect(src).not.toMatch(/(setItem|multiSet|setHomeCity|setDeviceRegion)\([^)]*'nicosia'/)
  expect(src).not.toMatch(/prefillRegion=\{[^}]*'nicosia'/)
  expect(src).not.toMatch(/KEY_HOME[^\n]*'nicosia'/)
})

const homeSrc = fs.readFileSync(path.join(__dirname, '..', 'screens', 'HomeScreen.js'), 'utf8')

test('tour chip sits below the Nöbetçi/Acil tiles, never above them', () => {
  const tiles = at(homeSrc, '<View ref={dutyBannerRef} collapsable={false} style={s.rWidgets}>', 'tiles row')
  const emergency = at(homeSrc, '<EmergencyTile ', 'emergency tile')
  const chip = at(homeSrc, '<TourChip ', 'tour chip')
  expect(chip).toBeGreaterThan(emergency)
  expect(homeSrc.slice(at(homeSrc, 'function renderHubRedesign', 'hub'), tiles)).not.toContain('<TourChip')
})

test('Make Home yours hides while @trnc_tour_chip is armed; App passes the raw state, live', () => {
  expect(src).toMatch(/\n\s*tourChipArmed=\{tourChip\}/)
  expect(homeSrc).toMatch(/\{customiseDone === false && !tourChipArmed && \(\s*<CustomiseCard/)
  expect(fnBody('retireTourChip')).toContain('setTourChip(false)')
})

test('second offer: copy fixed at decision (device city, else profile region, else short with no fix); short copy only with no home city and no fix', () => {
  const b = fnBody('maybeOfferDutyAgain')
  expect(b).toMatch(/\[, homeCity\]\] = await AsyncStorage\.multiGet\(\[KEY_DUTY_OFFER, KEY_REOFFER, KEY_ONBOARDED, KEY_CITY_HOME\]\)/)
  expect(b).toContain('const reofferHomeRegion = homeCity ?? (REGIONS.includes(profile?.region) ? profile.region : null)')
  expect(at(b, 'setReofferNoCityCopy(reofferNoCity({ home: reofferHomeRegion, hasFix: !!userLocation }))', 'copy')).toBeLessThan(at(b, 'setDutyReoffer(variant)', 'show'))
  expect(src).toMatch(/<DutyReofferSheet [^>]*noCity=\{reofferNoCityCopy\}/)
  const sheet = fs.readFileSync(path.join(__dirname, '..', 'components', 'DutyReofferSheet.js'), 'utf8')
  expect(sheet).toContain("noCity ? t('dutyReofferBodyNoCity', lang) : t('dutyAlertsBody', lang)")
})

test('design pass: outline edge is primary, short screens shrink the logo, reset row reads destructive', () => {
  const btn = fs.readFileSync(path.join(__dirname, '..', 'components', 'ui', 'Button.js'), 'utf8')
  expect(btn).toMatch(/outline:\s*\{ bg: colors\.card,\s*fg: colors\.primaryDark, border: colors\.primary \}/)
  const start = fs.readFileSync(path.join(__dirname, '..', 'screens', 'StartScreen.js'), 'utf8')
  expect(start).toContain('const short = useWindowDimensions().height < 700')
  expect(start).toContain('style={short ? s.logoShort : s.logo}')
  const settings = fs.readFileSync(path.join(__dirname, '..', 'components', 'shell', 'Settings.js'), 'utf8')
  expect(settings).toContain("row('refresh-outline', 'health', 'devResetOnboarding', a.onResetOnboarding, { destructive: true, chevron: false })")
})

test('Start choices (start_choice_*) are logged only on first-time phones; start_shown stays unconditional', () => {
  const start = fs.readFileSync(path.join(__dirname, '..', 'screens', 'StartScreen.js'), 'utf8')
  expect(start).toMatch(/export default function StartScreen\(\{[^}]*\blogChoices\b[^}]*\}\)/)
  expect(start).toMatch(/if \(logChoices\) logOnboardingEvent\(START_CHOICE_EVENTS\.signup\)/)
  expect(start).toMatch(/if \(logChoices\) logOnboardingEvent\(START_CHOICE_EVENTS\.signin\)/)
  expect(start).toMatch(/if \(logChoices\) logOnboardingEvent\(START_CHOICE_EVENTS\.guest\)/)
  expect(start).not.toMatch(/\n\s*logOnboardingEvent\(START_CHOICE_EVENTS/)
  expect(start).toContain('logOnboardingEvent(START_SHOWN_EVENT)')
  expect(start).not.toMatch(/logChoices[^\n]*START_SHOWN_EVENT|START_SHOWN_EVENT[^\n]*logChoices/)
  const m = src.match(/<StartScreen\b[\s\S]*?\/>/)
  expect(m).not.toBeNull()
  expect(m[0]).toContain('logChoices={armPending()}')
  expect(at(src, 'const armPending = () => shouldArmPending(', 'armPending')).toBeLessThan(selectorStart)
})

// ── Hung-request safety (RN OkHttp has no timeout) ──
function loadEffectBody() {
  const start = at(src, '    async function load() {', 'load()')
  return src.slice(start, at(src, '  }, [retryCount])', 'load effect end'))
}

test('load() ends loading in a finally, so a throw cannot leave the skeleton up', () => {
  const body = loadEffectBody()
  expect(body).toMatch(/\} finally \{[^}]*setLoading\(false\)/)
  expect(body).toContain('      try {\n')
  expect(at(body, 'try {', 'try')).toBeLessThan(at(body, "AsyncStorage.getItem('ada_favorites')", 'first read'))
})

test('load() reads are bounded: facilities / duty / reviews at 10 s with an abort signal, location raced at 8 s, a facilities timeout sets facilityLoadError', () => {
  const body = loadEffectBody()
  expect(body.match(/\.abortSignal\(s\)/g).length).toBe(3)
  expect(body.match(/, 10000\)/g).length).toBe(3)
  expect(body).toContain('.catch(e => ({ data: null, error: e }))\n      if (error) setFacilityLoadError(true)')
  const loc = body.slice(at(body, 'Location.getForegroundPermissionsAsync()', 'perm'))
  expect(loc.indexOf('}, 8000)')).toBeGreaterThan(loc.indexOf('passiveFix('))
  expect(loc.indexOf('}, 8000)')).toBeLessThan(loc.indexOf('} catch {'))

  // a fix landing after the 8 s race (catch already set denied) must clear it
  expect(loc).toContain('else { setUserLocation(loc.coords); setLocationDenied(false); resolvedCoords = loc.coords }')
})

test('weather invoke has a timeout and a failure still clears the key; weather does not hold loading', () => {
  const fn = fnBody('fetchWeather')
  expect(fn).toContain("supabase.functions.invoke('weather', { body: { lat: wLat, lon: wLon }, timeout: 8000 })")
  expect(fn).toContain('weatherKeyRef.current = null')
  const body = loadEffectBody()
  expect(at(body, 'setLoading(false)\n      await fetchWeather(', 'loading before weather')).toBeGreaterThan(0)
})

test('45 s safety net: a held (loading || !profile) routes to ProfileLoadFailedScreen; Retry reloads the profile AND bumps retryCount', () => {
  const eff = src.slice(at(src, '  // Safety net: a session whose profile', 'safety net'))
  const effEnd = eff.slice(0, at(eff, '[session?.user?.id, loading, profile, retryCount])', 'deps'))
  expect(effEnd).toContain('!(loading || !profile)')
  expect(effEnd).toContain('setTimeout(() => setLoadStalledUid(uid), 45000)')
  expect(effEnd).toContain('return () => clearTimeout(timer)')
  const sel = src.slice(selectorStart)
  const branch = sel.slice(at(sel, 'profileLoadFailedUid === session.user.id || loadStalledUid === session.user.id', 'stalled branch'))
  const retry = branch.slice(0, at(branch, '/>', 'end of screen'))
  expect(retry).toContain('<ProfileLoadFailedScreen')
  expect(retry).toContain('onRetry={retryProfileLoad}')
  const fnStart = at(src, 'function retryProfileLoad() {', 'retryProfileLoad')
  const rp = src.slice(fnStart, fnStart + src.slice(fnStart).indexOf('\n  }\n') )
  expect(rp).toContain('profileRecoveryRef.current.load(sess)')
  expect(rp).toContain('setLoading(true)')
  expect(rp).toContain('setRetryCount(c => c + 1)')
  expect(src.indexOf('const [loadStalledUid')).toBeLessThan(selectorStart)
})

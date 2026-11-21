// Source guard: the push-tap routing in App.js must stay ONE path (takePushResponse), and every place that can close the
// duty list or a routed screen behind a push must leave a [push-route] breadcrumb for the logcat read on a Preview build.
const fs = require('fs')
const path = require('path')

// PUSH_ROUTE_APP_JS lets the red-first check point the guard at a deliberately broken scratch copy.
const app = fs.readFileSync(process.env.PUSH_ROUTE_APP_JS || path.join(__dirname, '..', 'App.js'), 'utf8')

function slice(from, to) {
  const s = app.indexOf(from)
  expect(s).toBeGreaterThan(-1)
  const e = app.indexOf(to, s + from.length)
  expect(e).toBeGreaterThan(s)
  return app.slice(s, e)
}

const warm = slice('addNotificationResponseReceivedListener', '}, [])')
const cold = slice('// Cold-start tap', '}, [session])')
const routing = slice('const routePush = data', "useEffect(() => {\n    const sub = Notifications.addNotificationResponseReceivedListener")

test('warm listener and cold-start path both go through takePushResponse', () => {
  expect(warm).toContain("takePushResponse(response, 'warm')")
  expect(cold).toContain("takePushResponse(parked, 'parked')")
  expect(cold).toContain("takePushResponse(r, 'cold')")
  expect(cold).toContain('getLastNotificationResponseAsync')
})

test('no screen comparison on push data in the handlers', () => {
  for (const body of [warm, cold, routing]) expect(body).not.toMatch(/screen\s*===/)
  expect(app).not.toMatch(/const screen\s*=\s*data\.screen/)
})

test.each([
  ['closeDutyList', 'function closeDutyList() {', '[push-route] reset closeDutyList'],
  ['oliNavigate', 'const oliNavigate = (target) => {', '[push-route] reset oliNavigate'],
  ['cityNavigate', 'const cityNavigate = (target) => {', '[push-route] reset cityNavigate'],
  ['ota-reload', 'await Updates.reloadAsync()', '[push-route] reset ota-reload'],
])('reset site %s logs a breadcrumb', (_n, anchor, line) => {
  const i = app.indexOf(anchor)
  expect(i).toBeGreaterThan(-1)
  const region = anchor.startsWith('await') ? app.slice(i - 200, i + anchor.length) : app.slice(i, i + 400)
  expect(region).toContain(line)
})

test('both back-chain closeDutyList calls log a breadcrumb', () => {
  const calls = app.match(/if \(showDutyList\) \{[^}]*closeDutyList\(\)[^}]*\}/g) ?? []
  expect(calls.length).toBe(2)
  for (const c of calls) expect(c).toContain('[push-route] reset backchain')
})

test('no [push-route] log interpolates an identifier, conversation, listing or code', () => {
  const lines = app.split('\n').filter(l => l.includes('[push-route]'))
  expect(lines.length).toBeGreaterThanOrEqual(7)
  for (const l of lines) expect(l).not.toMatch(/\$\{[^}]*(identifier|\bid\b|conversation|listing|code|token|user)/i)
})

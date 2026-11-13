// Sign-out scope guard (Berke, 2026-11-12): "Çıkış yap" ends the session on THIS device only
// (`scope: 'local'`); only the safety sign-outs (after account deletion, under-13) are
// `scope: 'global'`. auth-js's default is 'global', so a bare call silently logs the user out
// everywhere. This parses app source with @babel/parser (not a regex: comments mention a bare
// `supabase.auth.signOut()`, and calls can span lines) and fails with file:line of every offender.
// Berke (2026-11-12): provider-role screens (provider, home_service_provider, insurance_provider,
// estate_agent, organizer) keep their ORIGINAL bare `signOut()` (global by auth-js default); admin,
// customer and guest sites are local. A bare call counts as global, and is allowed ONLY at those legacy
// provider sites (pinned below by exact per-file count; in App.js structurally, inside the
// `profile.role === 'provider'` branch). A count bump must land in the same commit as the new site, with the reason.
// Push-token clear (Berke, 2026-11-12): a signed-out phone must not keep getting that account's pushes, and the
// client cannot update its own profiles row once the session is gone. So customer/guest/admin sign-outs go through
// utils/signOut.js (clear the token, then sign out); the ONLY explicit-scope auth.signOut calls live there (one local,
// one global). Every former local site calls signOutThisDevice(); every deletion site calls
// signOutEverywhere({ clearToken: false }) (the row is gone); the under-13 button (email account, row survives) calls
// signOutEverywhere({ clearToken: true }). Provider-role bare sites are unchanged and out of scope.
const fs = require('fs')
const path = require('path')
const { parse } = require('@babel/parser')

const ROOT = path.join(__dirname, '..')
const EXPECTED_DELETION_FNS = 5 // ProfileScreen, ProviderScreen, InsuranceDashboard, HomeServiceDashboard, ProfileSetup
const EXPECTED_UNDER13 = 2 // AgeIneligibleScreen + App.js ageDeletedNotice
// Was 8 direct local + 4 direct global + 14 bare. Now the 8 local sites call signOutThisDevice() and the 4 global sites
// call signOutEverywhere(...), so the only direct explicit-scope calls are the one local + one global inside the helper.
const HELPER_FILE = path.join('utils', 'signOut.js')
const EXPECTED_DIRECT_GLOBAL = 1
const EXPECTED_DIRECT_LOCAL = 1
const EXPECTED_THIS_DEVICE = { 'App.js': 4, [path.join('screens', 'ProfileScreen.js')]: 1, [path.join('screens', 'ProfileSetupScreen.js')]: 1, [path.join('screens', 'AdminScreen.js')]: 2 }
const EXPECTED_EVERYWHERE = 4 // 2 deletion (ProfileScreen, ProfileSetupScreen) + 2 under-13 (AgeIneligibleScreen, App.js ageDeletedNotice)
const EXPECTED_BARE = 14
const HELPERS = new Set(['signOutThisDevice', 'signOutEverywhere'])
const BARE_ALLOW = {
  [path.join('screens', 'ProviderScreen.js')]: 2,
  [path.join('screens', 'ProviderOnboardingScreen.js')]: 1,
  [path.join('screens', 'HomeServiceDashboardScreen.js')]: 2,
  [path.join('screens', 'InsuranceDashboardScreen.js')]: 2,
  [path.join('screens', 'EstateAgentDashboardScreen.js')]: 2,
  [path.join('screens', 'OrganizerScreen.js')]: 1,
  'App.js': { providerBranch: 4 },
}
const EXCLUDED = new Set(['node_modules', 'scripts', '__tests__', 'supabase', 'web', 'docs', '.git'])
const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod'])

const propName = m => (!m.computed && m.property.type === 'Identifier' ? m.property.name
  : m.computed && m.property.type === 'StringLiteral' ? m.property.value : null)
const isMember = n => n && (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression')
const isCall = n => n && (n.type === 'CallExpression' || n.type === 'OptionalCallExpression')
// `<x>.auth.signOut` or `auth.signOut` (after `const { auth } = supabase`)
const isAuthSignOut = n => isMember(n) && propName(n) === 'signOut' &&
  ((isMember(n.object) && propName(n.object) === 'auth') || (n.object.type === 'Identifier' && n.object.name === 'auth'))
const isAuthObj = n => (isMember(n) && propName(n) === 'auth') || (n && n.type === 'Identifier' && n.name === 'auth')

function scopeOf(call) {
  if (call.arguments.length !== 1) return null
  const a = call.arguments[0]
  if (a.type !== 'ObjectExpression' || a.properties.length !== 1) return null // exactly one property: no spread, no duplicate scope key
  const p = a.properties.find(x => x.type === 'ObjectProperty' && !x.computed &&
    ((x.key.type === 'Identifier' && x.key.name === 'scope') || (x.key.type === 'StringLiteral' && x.key.value === 'scope')))
  return p && p.value.type === 'StringLiteral' && ['local', 'global'].includes(p.value.value) ? p.value.value : null
}

// signOutEverywhere({ clearToken: true|false }) -> the literal boolean, else null (variable, missing, extra property)
function clearTokenOf(call) {
  if (call.arguments.length !== 1) return null
  const a = call.arguments[0]
  if (a.type !== 'ObjectExpression' || a.properties.length !== 1) return null
  const p = a.properties[0]
  const ok = p.type === 'ObjectProperty' && !p.computed && p.key.type === 'Identifier' && p.key.name === 'clearToken' && p.value.type === 'BooleanLiteral'
  return ok ? p.value.value : null
}

// `else if (profile.role === 'provider') { ... }`: is path[i+1] (the child) the consequent of such an IfStatement?
const isProviderIf = n => n.type === 'IfStatement' && n.test.type === 'BinaryExpression' && n.test.operator === '===' &&
  isMember(n.test.left) && propName(n.test.left) === 'role' && n.test.left.object.name === 'profile' &&
  n.test.right.type === 'StringLiteral' && n.test.right.value === 'provider'
const inProviderBranch = (ancestors, node) => ancestors.some((a, i) => isProviderIf(a) && (ancestors[i + 1] || node) === a.consequent)

// -> { calls: [{ file, line, scope, bare, allowedBare, inAgeNotice }], offenders: [string], deletionFns: [{ file, line, signOuts }] }
function scan(source, file, allow = BARE_ALLOW) {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] })
  const calls = [], helperCalls = [], offenders = [], fns = new Map()
  const at = n => `${file}:${n.loc.start.line}`
  const walk = (node, ancestors, fn) => {
    if (!node || typeof node.type !== 'string') return
    let curFn = fn
    if (FN_TYPES.has(node.type)) { curFn = node; fns.set(node, { signOuts: [], deletes: [] }) }
    if (isCall(node) && isAuthSignOut(node.callee)) {
      const scope = scopeOf(node)
      const inAgeNotice = ancestors.some(a => a.type === 'JSXOpeningElement' && a.name.name === 'AgeIneligibleScreen') ||
        ancestors.some(a => a.type === 'JSXElement' && a.openingElement.name.name === 'AgeIneligibleScreen')
      const bare = node.arguments.length === 0
      const rule = allow[file]
      const allowedBare = bare && (typeof rule === 'number' || (!!rule && inProviderBranch(ancestors, node)))
      const c = { file, line: node.loc.start.line, scope, bare, allowedBare, inAgeNotice }
      calls.push(c)
      if (curFn) fns.get(curFn).signOuts.push(c)
      if (bare && !allowedBare) offenders.push(`${at(node)} bare auth.signOut() outside the legacy provider-role allow-list (global by default; name { scope: 'local' | 'global' })`)
      else if (!scope && !bare) offenders.push(`${at(node)} auth.signOut needs exactly one argument with exactly one property { scope: 'local' | 'global' } (a bare, variable, spread or duplicated scope can default to every device)`)
      else if (scope && file !== HELPER_FILE) offenders.push(`${at(node)} auth.signOut({ scope: '${scope}' }) outside utils/signOut.js: use signOutThisDevice() / signOutEverywhere({ clearToken }) so the push token is cleared first`)
    } else if (isCall(node) && node.callee.type === 'Identifier' && HELPERS.has(node.callee.name) && file !== HELPER_FILE) {
      const helper = node.callee.name
      const inAgeNotice = ancestors.some(a => a.type === 'JSXElement' && a.openingElement.name.name === 'AgeIneligibleScreen')
      const clearToken = helper === 'signOutEverywhere' ? clearTokenOf(node) : null
      const c = { file, line: node.loc.start.line, helper, scope: helper === 'signOutEverywhere' ? 'global' : 'local', clearToken, inAgeNotice }
      helperCalls.push(c)
      if (curFn) fns.get(curFn).signOuts.push(c)
      if (helper === 'signOutThisDevice' && node.arguments.length) offenders.push(`${at(node)} signOutThisDevice() takes no arguments`)
      if (helper === 'signOutEverywhere' && clearToken === null) offenders.push(`${at(node)} signOutEverywhere needs a literal { clearToken: true | false } and nothing else`)
      if (helper === 'signOutEverywhere' && file.endsWith('AgeIneligibleScreen.js') && clearToken !== true)
        offenders.push(`${at(node)} the under-13 button (email account, profiles row survives) must call signOutEverywhere({ clearToken: true })`)
      if (helper === 'signOutEverywhere' && inAgeNotice && clearToken !== false)
        offenders.push(`${at(node)} the under-13 notice sign-out runs after delete_own_account (row gone): signOutEverywhere({ clearToken: false })`)
    } else if (isAuthSignOut(node) && !(isCall(ancestors[ancestors.length - 1]) && ancestors[ancestors.length - 1].callee === node)) {
      offenders.push(`${at(node)} auth.signOut used by reference; call it inline with an explicit scope`)
    }
    if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && isAuthObj(node.init) &&
      node.id.properties.some(p => p.type === 'ObjectProperty' && p.key.name === 'signOut')) {
      offenders.push(`${at(node)} signOut destructured out of auth; call it inline with an explicit scope`)
    }
    if (isCall(node) && isMember(node.callee) && propName(node.callee) === 'rpc' && node.arguments[0] &&
      node.arguments[0].type === 'StringLiteral' && node.arguments[0].value === 'delete_own_account' && curFn) {
      fns.get(curFn).deletes.push(node)
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue
      const v = node[key]
      if (Array.isArray(v)) v.forEach(c => walk(c, [...ancestors, node], curFn))
      else if (v && typeof v === 'object') walk(v, [...ancestors, node], curFn)
    }
  }
  walk(ast.program, [], null)
  const rule = allow[file]
  if (rule) {
    const want = typeof rule === 'number' ? rule : rule.providerBranch
    const got = calls.filter(c => c.allowedBare)
    if (got.length !== want) offenders.push(`${file} expected exactly ${want} allow-listed bare auth.signOut() calls, found ${got.length} (${got.map(c => c.line).join(', ')})`)
  }
  const deletionFns = []
  for (const [fn, info] of fns) {
    if (!info.deletes.length) continue
    const line = fn.loc.start.line
    deletionFns.push({ file, line, signOuts: info.signOuts })
    if (!info.signOuts.length) offenders.push(`${file}:${line} function calls rpc('delete_own_account') but never signs out`)
    info.signOuts.filter(c => !c.allowedBare && !(c.helper === 'signOutEverywhere' && c.clearToken === false)).forEach(c =>
      offenders.push(`${file}:${c.line} sign-out after delete_own_account (function at ${file}:${line}) must be signOutEverywhere({ clearToken: false }) (global, row already gone) or an allow-listed bare call`))
  }
  return { calls, helperCalls, offenders, deletionFns }
}

function appSources() {
  const appJs = fs.readFileSync(path.join(ROOT, 'App.js'), 'utf8')
  const imported = [...appJs.matchAll(/from '\.\/([^/']+)\//g)].map(m => m[1])
  const dirs = [...new Set(['screens', 'components', 'utils', 'lib', 'hooks', 'constants', 'navigation', ...imported])]
    .filter(d => !EXCLUDED.has(d) && fs.existsSync(path.join(ROOT, d)) && fs.statSync(path.join(ROOT, d)).isDirectory())
  const files = ['App.js']
  const walkDir = d => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      if (EXCLUDED.has(e.name)) continue
      const rel = path.join(d, e.name)
      if (e.isDirectory()) walkDir(rel)
      else if (e.name.endsWith('.js')) files.push(rel)
    }
  }
  dirs.forEach(walkDir)
  return files
}

describe('auth.signOut scope guard (real source)', () => {
  const files = appSources()
  const results = files.map(f => scan(fs.readFileSync(path.join(ROOT, f), 'utf8'), f))
  const calls = results.flatMap(r => r.calls)
  const helperCalls = results.flatMap(r => r.helperCalls)
  const deletionFns = results.flatMap(r => r.deletionFns)
  const global = calls.filter(c => c.scope === 'global')
  const local = calls.filter(c => c.scope === 'local')
  const bare = calls.filter(c => c.allowedBare)
  const thisDevice = helperCalls.filter(c => c.helper === 'signOutThisDevice')
  const everywhere = helperCalls.filter(c => c.helper === 'signOutEverywhere')
  const fmt = c => `${c.file}:${c.line}`
  const bareList = 'Allowed bare (legacy provider-role, global) sign-outs:\n' + bare.map(c => `  ${fmt(c)}`).join('\n')

  test('scanner read real files (not vacuous)', () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files).toContain('App.js')
    expect(files).toContain(HELPER_FILE)
    expect(files.some(f => f.startsWith('screens'))).toBe(true)
  })

  test('every call names scope local or global; no by-reference or destructured use', () => {
    console.log(bareList)
    const offenders = results.flatMap(r => r.offenders)
    if (offenders.length) throw new Error(offenders.join('\n') + '\n' + bareList)
  })

  test('deletion functions sign out globally, through the helper without a token clear', () => {
    console.log('delete_own_account functions:\n' + deletionFns.map(d => `  ${d.file}:${d.line} -> ${d.signOuts.map(s => `${s.line}:${s.helper ? `${s.helper}(clearToken ${s.clearToken})` : s.scope || 'bare'}`).join(', ')}`).join('\n'))
    expect(deletionFns.map(fmt)).toHaveLength(EXPECTED_DELETION_FNS)
    expect(deletionFns.flatMap(d => d.signOuts).filter(c => c.allowedBare)).toHaveLength(3) // Provider, InsuranceDashboard, HomeServiceDashboard
    // the other two (ProfileScreen, ProfileSetupScreen) are customer deletions: global helper, no clear (row already gone)
    const viaHelper = deletionFns.flatMap(d => d.signOuts).filter(c => c.helper)
    expect(viaHelper.map(c => `${c.helper}:${c.clearToken}`)).toEqual(['signOutEverywhere:false', 'signOutEverywhere:false'])
  })

  test('helper call sites: 8 this-device, 4 everywhere (2 deletion + 2 under-13)', () => {
    console.log('signOutThisDevice sites:\n' + thisDevice.map(c => `  ${fmt(c)}`).join('\n') +
      '\nsignOutEverywhere sites:\n' + everywhere.map(c => `  ${fmt(c)} clearToken ${c.clearToken}`).join('\n'))
    const perFile = {}
    thisDevice.forEach(c => { perFile[c.file] = (perFile[c.file] || 0) + 1 })
    expect(perFile).toEqual(EXPECTED_THIS_DEVICE)
    expect(everywhere).toHaveLength(EXPECTED_EVERYWHERE)
    const deletionSites = new Set(deletionFns.flatMap(d => d.signOuts).filter(c => c.helper).map(fmt))
    const under13 = everywhere.filter(c => !deletionSites.has(fmt(c)))
    expect(under13).toHaveLength(EXPECTED_UNDER13)
    const bad = under13.filter(c => !(c.file === path.join('screens', 'AgeIneligibleScreen.js') || (c.file === 'App.js' && c.inAgeNotice)))
    expect(bad.map(fmt)).toEqual([])
    expect(under13.find(c => c.file.endsWith('AgeIneligibleScreen.js')).clearToken).toBe(true)
    expect(under13.find(c => c.file === 'App.js').clearToken).toBe(false)
  })

  test('direct explicit-scope auth.signOut calls live only in utils/signOut.js (one local, one global); bare allow-list unchanged', () => {
    console.log('direct local: ' + local.map(fmt) + '\ndirect global: ' + global.map(fmt))
    expect(local.map(c => c.file)).toEqual([HELPER_FILE])
    expect(global.map(c => c.file)).toEqual([HELPER_FILE])
    expect(local).toHaveLength(EXPECTED_DIRECT_LOCAL)
    expect(global).toHaveLength(EXPECTED_DIRECT_GLOBAL)
    expect(bare).toHaveLength(EXPECTED_BARE)
  })
})

describe('auth.signOut scope guard (self-check on fixtures)', () => {
  const run = (src, file = 'fixture.js', allow = BARE_ALLOW) => scan(src, file, allow)
  const red = (src, file, allow, re) => {
    const o = run(src, file, allow).offenders
    expect(o.length).toBeGreaterThan(0)
    if (re) expect(o.join('\n')).toMatch(re)
  }
  const green = (src, file, allow) => expect(run(src, file, allow).offenders).toEqual([])
  const app1 = { 'App.js': { providerBranch: 1 } } // fixtures carry one provider-branch call, not the real 4
  const app0 = { 'App.js': { providerBranch: 0 } } // fixtures with no provider-branch call
  const organizer = path.join('screens', 'OrganizerScreen.js')
  const providerScreen = path.join('screens', 'ProviderScreen.js')
  const ageScreen = path.join('screens', 'AgeIneligibleScreen.js')
  const appProvider = "if (a) {} else if (profile.role === 'provider') { x = () => supabase.auth.signOut() } else if (profile.role === 'organizer') { y = 1 }"

  test('red: bare call', () => red('async function f(){ await supabase.auth.signOut() }'))
  test('red: multi-line bare call', () => red('async function f(){\n await supabase\n  .auth\n  .signOut(\n  )\n}'))
  test('red: by reference', () => red('const f = supabase.auth.signOut'))
  test('red: destructured', () => red('const { signOut } = supabase.auth'))
  test("red: scope 'others'", () => red("supabase.auth.signOut({ scope: 'others' })", HELPER_FILE))
  test('red: variable scope', () => red("const s = 'local'; supabase.auth.signOut({ scope: s })", HELPER_FILE))
  test('red: scope object with a spread', () => red("supabase.auth.signOut({ scope: 'local', ...x })", HELPER_FILE, undefined, /exactly one property/))
  test('red: spread after scope can override it', () => red("supabase.auth.signOut({ ...x, scope: 'local' })", HELPER_FILE, undefined, /exactly one property/))
  test('red: duplicate scope key', () => red("supabase.auth.signOut({ scope: 'local', scope: 'global' })", HELPER_FILE, undefined, /exactly one property/))
  test('red: local call at a customer site (must use the helper)', () =>
    red("const a = () => supabase.auth.signOut({ scope: 'local' })", path.join('screens', 'ProfileScreen.js'), undefined, /outside utils\/signOut\.js/))
  test('red: global call at a customer site (must use the helper)', () =>
    red("const a = () => supabase.auth.signOut({ scope: 'global' })", ageScreen, undefined, /outside utils\/signOut\.js/))
  test('red: delete_own_account function with a direct local sign-out', () =>
    red("async function d(){ await supabase.rpc('delete_own_account'); await supabase.auth.signOut({ scope: 'local' }) }", HELPER_FILE, undefined, /must be signOutEverywhere/))
  test('red: delete_own_account function with the this-device helper', () =>
    red("async function d(){ await supabase.rpc('delete_own_account'); await signOutThisDevice() }", undefined, undefined, /must be signOutEverywhere/))
  test('red: delete_own_account function whose global helper clears the token (row is gone)', () =>
    red("async function d(){ await supabase.rpc('delete_own_account'); await signOutEverywhere({ clearToken: true }) }", undefined, undefined, /must be signOutEverywhere\(\{ clearToken: false \}\)/))
  test('red: delete_own_account function with no sign-out', () =>
    red("const d = async () => { await supabase.rpc('delete_own_account') }"))
  test('red: under-13 button without the token clear', () =>
    red("async function s(){ await signOutEverywhere({ clearToken: false }) }", ageScreen, undefined, /clearToken: true/))
  test('red: under-13 button with a variable clearToken', () =>
    red("async function s(){ await signOutEverywhere({ clearToken: x }) }", ageScreen, undefined, /literal/))
  test('red: under-13 notice (row deleted) trying to clear the token', () =>
    red("c = <AgeIneligibleScreen onDone={() => { signOutEverywhere({ clearToken: true }) }} />", 'App.js', app0, /clearToken: false/))
  test('red: signOutEverywhere without options', () => red('signOutEverywhere()', undefined, undefined, /literal/))
  test('red: signOutEverywhere with an extra property', () => red('signOutEverywhere({ clearToken: true, ...x })', undefined, undefined, /literal/))
  test('red: bare call outside the allow-list (another screen)', () =>
    red('const a = () => supabase.auth.signOut()', path.join('screens', 'ProfileScreen.js'), undefined, /outside the legacy provider-role allow-list/))
  test('red: extra bare call in an allow-listed file', () =>
    red('const a = () => supabase.auth.signOut(); const b = () => supabase.auth.signOut()', organizer, undefined, /expected exactly 1 allow-listed bare/))
  test('red: allow-listed file with a missing bare call', () => red('const a = 1', organizer, undefined, /expected exactly 1/))
  test('red: allow-listed file, bare call turned local', () =>
    red("const a = () => supabase.auth.signOut({ scope: 'local' })", organizer, undefined, /expected exactly 1/))
  test('red: App.js bare call outside the provider branch', () =>
    red(appProvider + "; z = () => supabase.auth.signOut()", 'App.js', app1, /outside the legacy provider-role allow-list/))
  test('red: App.js bare call in another role branch', () =>
    red("if (a) {} else if (profile.role === 'provider') { } else if (profile.role === 'organizer') { y = () => supabase.auth.signOut() }", 'App.js', app1, /outside the legacy/))
  test('red: deletion function in a non-allow-listed file with bare sign-out', () =>
    red("async function d(){ await supabase.rpc('delete_own_account'); await supabase.auth.signOut() }", undefined, undefined, /outside the legacy/))
  test('red: deletion function in an allow-listed file, sign-out turned local', () =>
    red("async function d(){ await supabase.rpc('delete_own_account'); await supabase.auth.signOut({ scope: 'local' }) }", providerScreen, { [providerScreen]: 0 }, /must be signOutEverywhere/))
  test('green: allowed bare call (one in an allow-listed file)', () =>
    green('const a = () => supabase.auth.signOut()', organizer))
  test('green: allowed bare deletion sign-out counts as global', () =>
    green("async function d(){ await supabase.rpc('delete_own_account'); await supabase.auth.signOut() }", providerScreen, { [providerScreen]: 1 }))
  test('green: App.js bare call inside the provider branch, nested', () =>
    green("if (a) {} else if (profile.role === 'provider') { if (b) { x = () => supabase.auth.signOut() } } else if (profile.role === 'organizer') { y = 1 }", 'App.js', app1))
  test('green: commented-out bare call', () => green('// supabase.auth.signOut()\n/* supabase.auth.signOut() */\nconst a = 1'))
  test('green: GoogleSignin.signOut()', () => green('async function f(){ await GoogleSignin.signOut() }'))
  test('green: explicit scopes inside the helper module', () => {
    green("const a = () => supabase.auth.signOut({ scope: 'local' })", HELPER_FILE)
    green("const a = () => supabase.auth.signOut({ scope: 'global' })", HELPER_FILE)
  })
  test('green: helper sites', () => {
    green('const a = () => signOutThisDevice()')
    green("async function d(){ await supabase.rpc('delete_own_account'); await signOutEverywhere({ clearToken: false }) }")
    green("async function s(){ await signOutEverywhere({ clearToken: true }) }", ageScreen)
    green("c = <AgeIneligibleScreen onDone={() => { signOutEverywhere({ clearToken: false }) }} />", 'App.js', app0)
  })
})

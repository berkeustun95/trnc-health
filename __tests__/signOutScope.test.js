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
const fs = require('fs')
const path = require('path')
const { parse } = require('@babel/parser')

const ROOT = path.join(__dirname, '..')
const EXPECTED_DELETION_FNS = 5 // ProfileScreen, ProviderScreen, InsuranceDashboard, HomeServiceDashboard, ProfileSetup
const EXPECTED_UNDER13 = 2 // AgeIneligibleScreen + App.js ageDeletedNotice
// 8 local + 4 explicit global + 14 allow-listed bare (3 of them deletion sign-outs) = 26 sites (was 19 + 7 before provider screens reverted)
const EXPECTED_GLOBAL = 4
const EXPECTED_LOCAL = 8
const EXPECTED_BARE = 14
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
  if (a.type !== 'ObjectExpression' || a.properties.length < 1) return null
  const p = a.properties.find(x => x.type === 'ObjectProperty' && !x.computed &&
    ((x.key.type === 'Identifier' && x.key.name === 'scope') || (x.key.type === 'StringLiteral' && x.key.value === 'scope')))
  return p && p.value.type === 'StringLiteral' && ['local', 'global'].includes(p.value.value) ? p.value.value : null
}

// `else if (profile.role === 'provider') { ... }`: is path[i+1] (the child) the consequent of such an IfStatement?
const isProviderIf = n => n.type === 'IfStatement' && n.test.type === 'BinaryExpression' && n.test.operator === '===' &&
  isMember(n.test.left) && propName(n.test.left) === 'role' && n.test.left.object.name === 'profile' &&
  n.test.right.type === 'StringLiteral' && n.test.right.value === 'provider'
const inProviderBranch = (ancestors, node) => ancestors.some((a, i) => isProviderIf(a) && (ancestors[i + 1] || node) === a.consequent)

// -> { calls: [{ file, line, scope, bare, allowedBare, inAgeNotice }], offenders: [string], deletionFns: [{ file, line, signOuts }] }
function scan(source, file, allow = BARE_ALLOW) {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] })
  const calls = [], offenders = [], fns = new Map()
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
      else if (!scope && !bare) offenders.push(`${at(node)} auth.signOut needs exactly one argument { scope: 'local' | 'global' } (a bare or variable scope defaults to every device)`)
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
    info.signOuts.filter(c => c.scope !== 'global' && !c.allowedBare).forEach(c =>
      offenders.push(`${file}:${c.line} sign-out after delete_own_account (function at ${file}:${line}) must be global: scope 'global' or an allow-listed bare call`))
  }
  return { calls, offenders, deletionFns }
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
  const deletionFns = results.flatMap(r => r.deletionFns)
  const global = calls.filter(c => c.scope === 'global')
  const local = calls.filter(c => c.scope === 'local')
  const bare = calls.filter(c => c.allowedBare)
  const fmt = c => `${c.file}:${c.line}`
  const bareList = 'Allowed bare (legacy provider-role, global) sign-outs:\n' + bare.map(c => `  ${fmt(c)}`).join('\n')

  test('scanner read real files (not vacuous)', () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files).toContain('App.js')
    expect(files.some(f => f.startsWith('screens'))).toBe(true)
  })

  test('every call names scope local or global; no by-reference or destructured use', () => {
    console.log(bareList)
    const offenders = results.flatMap(r => r.offenders)
    if (offenders.length) throw new Error(offenders.join('\n') + '\n' + bareList)
  })

  test('deletion functions sign out globally', () => {
    console.log('delete_own_account functions:\n' + deletionFns.map(d => `  ${d.file}:${d.line} -> ${d.signOuts.map(s => `${s.line}:${s.scope || 'bare'}`).join(', ')}`).join('\n'))
    expect(deletionFns.map(fmt)).toHaveLength(EXPECTED_DELETION_FNS)
    expect(deletionFns.flatMap(d => d.signOuts).filter(c => c.allowedBare)).toHaveLength(3) // Provider, InsuranceDashboard, HomeServiceDashboard
  })

  test('global allow-list: deletion sites + exactly two under-13 sites', () => {
    const deletionGlobals = new Set(deletionFns.flatMap(d => d.signOuts).filter(c => c.scope === 'global').map(fmt))
    const under13 = global.filter(c => !deletionGlobals.has(fmt(c)))
    const bad = under13.filter(c => !(
      (c.file === path.join('screens', 'AgeIneligibleScreen.js')) || (c.file === 'App.js' && c.inAgeNotice)))
    expect(bad.map(fmt)).toEqual([])
    expect(under13.map(fmt).sort()).toHaveLength(EXPECTED_UNDER13)
    expect(under13.filter(c => c.file === 'App.js')).toHaveLength(1)
    expect(under13.filter(c => c.file.endsWith('AgeIneligibleScreen.js'))).toHaveLength(1)
    expect(global).toHaveLength(EXPECTED_GLOBAL)
    expect(local).toHaveLength(EXPECTED_LOCAL)
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
  const organizer = path.join('screens', 'OrganizerScreen.js')
  const providerScreen = path.join('screens', 'ProviderScreen.js')
  const appProvider = "if (a) {} else if (profile.role === 'provider') { x = () => supabase.auth.signOut() } else if (profile.role === 'organizer') { y = 1 }"

  test('red: bare call', () => red('async function f(){ await supabase.auth.signOut() }'))
  test('red: multi-line bare call', () => red('async function f(){\n await supabase\n  .auth\n  .signOut(\n  )\n}'))
  test('red: by reference', () => red('const f = supabase.auth.signOut'))
  test('red: destructured', () => red('const { signOut } = supabase.auth'))
  test("red: scope 'others'", () => red("supabase.auth.signOut({ scope: 'others' })"))
  test('red: variable scope', () => red("const s = 'local'; supabase.auth.signOut({ scope: s })"))
  test('red: delete_own_account function with local scope', () =>
    red("async function d(){ await supabase.rpc('delete_own_account'); await supabase.auth.signOut({ scope: 'local' }) }"))
  test('red: delete_own_account function with no sign-out', () =>
    red("const d = async () => { await supabase.rpc('delete_own_account') }"))
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
    red("async function d(){ await supabase.rpc('delete_own_account'); await supabase.auth.signOut({ scope: 'local' }) }", providerScreen, { [providerScreen]: 0 }, /must be global/))
  test('green: allowed bare call (one in an allow-listed file)', () =>
    green('const a = () => supabase.auth.signOut()', organizer))
  test('green: allowed bare deletion sign-out counts as global', () =>
    green("async function d(){ await supabase.rpc('delete_own_account'); await supabase.auth.signOut() }", providerScreen, { [providerScreen]: 1 }))
  test('green: App.js bare call inside the provider branch, nested', () =>
    green("if (a) {} else if (profile.role === 'provider') { if (b) { x = () => supabase.auth.signOut() } } else if (profile.role === 'organizer') { y = 1 }", 'App.js', app1))
  test('green: commented-out bare call', () => green('// supabase.auth.signOut()\n/* supabase.auth.signOut() */\nconst a = 1'))
  test('green: GoogleSignin.signOut()', () => green('async function f(){ await GoogleSignin.signOut() }'))
  test('green: explicit scopes, deletion global', () => {
    green("const a = () => supabase.auth.signOut({ scope: 'local' })")
    green("async function d(){ await supabase.rpc('delete_own_account'); await supabase.auth.signOut({ scope: 'global' }) }")
  })
})

// Sign-out scope guard (Berke, 2026-11-12): "Çıkış yap" ends the session on THIS device only
// (`scope: 'local'`); only the safety sign-outs (after account deletion, under-13) are
// `scope: 'global'`. auth-js's default is 'global', so a bare call silently logs the user out
// everywhere. This parses app source with @babel/parser (not a regex: comments mention a bare
// `supabase.auth.signOut()`, and calls can span lines) and fails with file:line of every offender.
// A count bump below must land in the same commit as the new site, with the reason.
const fs = require('fs')
const path = require('path')
const { parse } = require('@babel/parser')

const ROOT = path.join(__dirname, '..')
const EXPECTED_DELETION_FNS = 5 // ProfileScreen, ProviderScreen, InsuranceDashboard, HomeServiceDashboard, ProfileSetup
const EXPECTED_UNDER13 = 2 // AgeIneligibleScreen + App.js ageDeletedNotice
const EXPECTED_GLOBAL = 7
const EXPECTED_LOCAL = 19
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

// -> { calls: [{ file, line, scope, enclosingFn, inAgeNotice }], offenders: [string], deletionFns: [{ file, line, signOuts }] }
function scan(source, file) {
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
      const c = { file, line: node.loc.start.line, scope, inAgeNotice }
      calls.push(c)
      if (curFn) fns.get(curFn).signOuts.push(c)
      if (!scope) offenders.push(`${at(node)} auth.signOut needs exactly one argument { scope: 'local' | 'global' } (a bare or variable scope defaults to every device)`)
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
  const deletionFns = []
  for (const [fn, info] of fns) {
    if (!info.deletes.length) continue
    const line = fn.loc.start.line
    deletionFns.push({ file, line, signOuts: info.signOuts })
    if (!info.signOuts.length) offenders.push(`${file}:${line} function calls rpc('delete_own_account') but never signs out`)
    info.signOuts.filter(c => c.scope !== 'global').forEach(c =>
      offenders.push(`${file}:${c.line} sign-out after delete_own_account (function at ${file}:${line}) must be scope 'global'`))
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
  const fmt = c => `${c.file}:${c.line}`

  test('scanner read real files (not vacuous)', () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files).toContain('App.js')
    expect(files.some(f => f.startsWith('screens'))).toBe(true)
  })

  test('every call names scope local or global; no by-reference or destructured use', () => {
    expect(results.flatMap(r => r.offenders)).toEqual([])
  })

  test('deletion functions sign out globally', () => {
    console.log('delete_own_account functions:\n' + deletionFns.map(d => `  ${d.file}:${d.line} -> ${d.signOuts.map(s => `${s.line}:${s.scope}`).join(', ')}`).join('\n'))
    expect(deletionFns.map(fmt)).toHaveLength(EXPECTED_DELETION_FNS)
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
  })
})

describe('auth.signOut scope guard (self-check on fixtures)', () => {
  const run = src => scan(src, 'fixture.js')
  const red = src => expect(run(src).offenders.length).toBeGreaterThan(0)
  const green = src => expect(run(src).offenders).toEqual([])

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
  test('green: commented-out bare call', () => green('// supabase.auth.signOut()\n/* supabase.auth.signOut() */\nconst a = 1'))
  test('green: GoogleSignin.signOut()', () => green('async function f(){ await GoogleSignin.signOut() }'))
  test('green: explicit scopes, deletion global', () => {
    green("const a = () => supabase.auth.signOut({ scope: 'local' })")
    green("async function d(){ await supabase.rpc('delete_own_account'); await supabase.auth.signOut({ scope: 'global' }) }")
  })
})

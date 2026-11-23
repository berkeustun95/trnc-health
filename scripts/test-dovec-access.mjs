// Döveç access (static), node only:  node scripts/test-dovec-access.mjs
// Merge condition: in a production build a guest or normal user has no way to reach any Döveç screen or data; only an admin
// through AdminScreen's preview entry can. Each check reads the SOURCE and prints what it matched.
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DOVEC_PARTNER_LIVE } from '../constants/flags.js'

let bad = 0
const check = (name, ok, matched) => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}\n       matched: ${matched}`) }
const root = new URL('..', import.meta.url)
const rootPath = fileURLToPath(root)
const read = p => readFileSync(fileURLToPath(new URL(p, root)), 'utf8')
const norm = s => s.replace(/\s+/g, ' ').trim()
const count = (s, needle) => s.split(needle).length - 1
const lineOf = (s, i) => s.slice(0, i).split('\n').length
const grep = args => { try { return execFileSync('git', ['grep', '-n', ...args], { cwd: rootPath, encoding: 'utf8' }).trim().split('\n').filter(Boolean) } catch { return [] } }

const APP = read('App.js'), ACC = read('screens/AccommodationScreen.js')

// ── T1 flags
check('T1 DOVEC_PARTNER_LIVE is false (imported)', DOVEC_PARTNER_LIVE === false, `constants/flags.js export = ${DOVEC_PARTNER_LIVE}`)
{
  const g = read('scripts/check-module-flags.mjs')
  const blk = g.slice(g.indexOf('const EXPECTED_SCALARS = {'))
  const m = blk.slice(0, blk.indexOf('\n}')).match(/^\s*DOVEC_PARTNER_LIVE:\s*(\w+)/m)
  check('T1 check-module-flags EXPECTED_SCALARS baseline DOVEC_PARTNER_LIVE false', !!m && m[1] === 'false', m ? norm(m[0]) : 'no match')
}

// ── T2 DOVEC_PREVIEW source
{
  const r = read('constants/redesign.js')
  const m = r.match(/export const DOVEC_PREVIEW\s*=\s*([^\n]+)/)
  const want = "(typeof __DEV__ !== 'undefined' && __DEV__) || IS_PREVIEW_BUILD"
  check('T2 DOVEC_PREVIEW = dev bundle || preview build', !!m && norm(m[1]) === want, m ? norm(m[0]) : 'no match')
  const p = r.match(/const IS_PREVIEW_BUILD\s*=\s*([^\n]+)/)
  check("T2 IS_PREVIEW_BUILD = extra.appVariant === 'preview'", !!p && norm(p[1]) === "Constants.expoConfig?.extra?.appVariant === 'preview'", p ? norm(p[0]) : 'no match')
  const hits = grep(['-E', 'DOVEC_PREVIEW[[:space:]]*=[^=]', '--', '*.js', '*.mjs', '*.cjs', '*.jsx', ':!node_modules', ':!scripts/test-dovec-access.mjs'])
  check('T2 exactly one assignment to DOVEC_PREVIEW in the repo', hits.length === 1 && hits[0].startsWith('constants/redesign.js'), `${hits.length}: ${hits.join(' | ').slice(0, 200)}`)
}

// ── T3 production OTA cannot carry the Preview variant
{
  const pk = read('package.json')
  const ota = JSON.parse(pk).scripts.ota
  const a = ota.indexOf('check-ota-preflight.mjs'), b = ota.indexOf('eas update --channel production')
  check('T3 ota runs check-ota-preflight.mjs before eas update --channel production', a > -1 && b > -1 && a < b, `preflight@${a} < eas update@${b}`)
  const f = read('scripts/check-ota-preflight.mjs')
  const line = f.split('\n').find(l => l.includes('variant !== null) problems.push')) || ''
  const cfgLine = f.split('\n').find(l => l.includes('cfg?.extra?.appVariant ?? null')) || ''
  const ex = f.split('\n').findIndex(l => l.includes('if (problems.length)')), ex2 = f.split('\n').findIndex(l => l.includes('process.exit(1)'))
  check('T3 preflight reads extra.appVariant and pushes a problem when non-null, then exits 1', !!line && !!cfgLine && ex > -1 && ex2 > ex,
    `${norm(cfgLine)} || ${norm(line).slice(0, 60)}… || if(problems.length)@L${ex + 1} exit(1)@L${ex2 + 1}`)
}

// ── T5 AccommodationScreen
{
  const loads = count(ACC, 'loadDovec(')
  const guard = ACC.indexOf('if (!DOVEC_PARTNER_LIVE && !DOVEC_PREVIEW) return')
  const eff = ACC.lastIndexOf('useEffect(() => {', ACC.indexOf('loadDovec('))
  const firstStmt = norm(ACC.slice(eff + 'useEffect(() => {'.length, eff + 'useEffect(() => {'.length + 80)).startsWith('if (!DOVEC_PARTNER_LIVE && !DOVEC_PREVIEW) return')
  check('T5 one loadDovec( call, preceded by the flag/preview guard as the effect\'s first statement', loads === 1 && guard > -1 && guard < ACC.indexOf('loadDovec(') && firstStmt, `loadDovec( x${loads}; guard @L${lineOf(ACC, guard)} < call @L${lineOf(ACC, ACC.indexOf('loadDovec('))}; effect's first statement is the guard: ${firstStmt}`)

  const EXPR = "dovecReady && !isDorm && (intent === 'sale' || intent === 'all') && <DovecEntryCard"
  const cards = count(ACC, '<DovecEntryCard')
  check('T5 <DovecEntryCard once, only inside dovecReady && !isDorm && (intent sale|all)', cards === 1 && count(ACC, EXPR) === 1, `<DovecEntryCard x${cards}; expression x${count(ACC, EXPR)} @L${lineOf(ACC, ACC.indexOf(EXPR))}`)

  const screens = count(ACC, '<DovecProjectsScreen')
  const open = ACC.indexOf('{dovecOpen === true && ('), scr = ACC.indexOf('<DovecProjectsScreen')
  const blockEnd = ACC.indexOf('\n      )}', open)
  check('T5 <DovecProjectsScreen only inside a dovecOpen === true block', screens === 1 && open > -1 && scr > open && scr < blockEnd, `x${screens}; block L${lineOf(ACC, open)}-L${lineOf(ACC, blockEnd)}, screen @L${lineOf(ACC, scr)}`)

  const sets = count(ACC, 'setDovecReady(true)')
  const ln = ACC.split('\n').find(l => l.includes('setDovecReady(true)')) || ''
  check('T5 setDovecReady(true) once, inside the dovecShown(...) && ... projects.length > 0 condition', sets === 1 && /dovecShown\(.*\) && d\.projects\.length > 0\) setDovecReady\(true\)/.test(ln), `x${sets}: ${norm(ln)}`)
}

// ── T6 App.js
{
  const sets = count(APP, "setAdminPreview('dovec')")
  const br = APP.indexOf("} else if (profile.role === 'admin' && !adminPreview) {")
  const next = APP.indexOf('} else if', br + 10)
  const at = APP.indexOf("setAdminPreview('dovec')")
  check("T6 exactly one setAdminPreview('dovec'), inside the admin && !adminPreview AdminScreen branch", sets === 1 && br > -1 && at > br && at < next, `x${sets} @L${lineOf(APP, at)}; branch L${lineOf(APP, br)}..next else-if L${lineOf(APP, next)}`)
  const a = count(APP, '<DovecProjectsScreen'), b = count(ACC, '<DovecProjectsScreen')
  check('T6 <DovecProjectsScreen once in App.js and once in AccommodationScreen.js', a === 1 && b === 1, `App.js x${a}, AccommodationScreen.js x${b}`)
  const o = count(APP, 'setOpenedDovec(true)')
  check('T6 setOpenedDovec(true) once in App.js', o === 1, `x${o} @L${lineOf(APP, APP.indexOf('setOpenedDovec(true)'))}`)
  const appFiles = [...['App.js'], ...['screens', 'components', 'components/dovec', 'utils', 'constants'].flatMap(d => readdirSync(fileURLToPath(new URL(d + '/', root))).filter(f => /\.(js|jsx)$/.test(f)).map(f => `${d}/${f}`))]
  const hits = appFiles.flatMap(f => read(f).split('\n').map((l, i) => [f, i + 1, l]).filter(([, , l]) => /dovec/i.test(l) && /isAdmin/.test(l)))
  const mentions = appFiles.reduce((n, f) => n + read(f).split('\n').filter(l => /dovec/i.test(l)).length, 0)
  check('T6 no isAdmin on any line mentioning dovec (app code)', hits.length === 0 && mentions > 20, `${hits.length} hits (${hits.map(h => h.slice(0, 2).join(':')).join(',')}) over ${appFiles.length} files, ${mentions} dovec lines scanned`)
}

// ── T7 import graph
{
  const want = {
    loadDovec: ['components/dovec/DovecEnquiryForm.js', 'screens/AccommodationScreen.js', 'screens/DovecProjectsScreen.js'],   // the form imports sendDovecLead from the same module
    DovecProjectsScreen: ['App.js', 'screens/AccommodationScreen.js'],
    DovecEnquiryForm: ['screens/DovecProjectsScreen.js'],
  }
  for (const [sym, allowed] of Object.entries(want)) {
    const lines = grep(['-E', `(import .*${sym}|require\\(.*${sym})`, '--', '*.js', '*.mjs', '*.cjs', '*.jsx', ':!node_modules', ':!scripts/test-dovec-*.mjs'])
    const files = [...new Set(lines.map(l => l.split(':')[0]))].sort()
    check(`T7 ${sym} imported only from the allowed set`, JSON.stringify(files) === JSON.stringify([...allowed].sort()), files.join(', ') || 'none')
  }
}

// ── T8 no dovec in deep links, push routing, Home, Explore, search_content
{
  const slice = (src, from, to) => { const i = src.indexOf(from), j = src.indexOf(to, i + 1); return i > -1 && j > i ? src.slice(i, j) : '' }
  const regions = [
    ['App.js handleDeepLink', slice(APP, 'async function handleDeepLink(url) {', "const sub = Linking.addEventListener('url'"), 'exchangeCodeForSession'],
    ['App.js routePush + takePushResponse', slice(APP, 'const routePush = data => {', 'const sub = Notifications.addNotificationResponseReceivedListener'), "case 'marketplace'"],
    ['utils/pushRoute.js', read('utils/pushRoute.js'), 'export function pushRoute'],
    ['utils/notificationRoute.js', read('utils/notificationRoute.js'), 'export function notificationRoute'],
    ['screens/HomeScreen.js', read('screens/HomeScreen.js'), 'export default function'],
    ['screens/ExploreScreen.js', read('screens/ExploreScreen.js'), 'export default function'],
  ]
  const migDir = 'supabase/migrations/'
  const mig = readdirSync(fileURLToPath(new URL(migDir, root))).filter(f => f.endsWith('.sql')).filter(f => /create\s+(or\s+replace\s+)?function\s+(public\.)?search_content\b/i.test(read(migDir + f)))
  for (const f of mig) regions.push([migDir + f, read(migDir + f), 'search_content'])
  let total = 0, empty = []
  for (const [name, text, anchor] of regions) { if (!text || !text.includes(anchor)) empty.push(name); total += (text.match(/dovec/gi) || []).length }
  check('T8 regions non-empty (each contains its known anchor)', empty.length === 0 && mig.length > 0, `${regions.length} regions, ${mig.length} search_content migrations, empty: [${empty.join(', ')}]`)
  check('T8 no dovec (any case) in deep-link handler, push routing, Home, Explore, search_content migrations', total === 0, `${total} matches in: ${regions.map(r => r[0].replace(migDir, 'mig/')).join(', ')}`)
}

console.log(bad ? `\n${bad} FAILED` : '\nall PASS')
process.exit(bad ? 1 : 0)

// Every back handler registers through addBackListener (utils/backHandler.js). On Android
// that IS BackHandler.addEventListener; on iOS BackHandler is a no-op stub and the left-edge
// swipe walks the shim's own stack. A direct BackHandler.addEventListener anywhere else still
// works on Android and is invisible to the iOS swipe — no error, the layer is just skipped
// (a live walk would close Explore instead of ending the walk). Runs before every OTA.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SHIM = 'utils/backHandler.js'
// App code only. scripts/ is excluded because this file names the pattern it forbids.
const SKIP = new Set(['node_modules', '.git', '.expo', 'dist', 'web', 'docs', 'vendor', 'scripts', 'supabase', 'fastlane', 'ios', 'android', 'assets'])
const PATTERN = /BackHandler\s*\.\s*addEventListener/

const files = []
const walk = dir => {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(js|jsx|ts|tsx)$/.test(name)) files.push(p)
  }
}
walk(ROOT)

const hits = []
let shimHasIt = false
for (const f of files) {
  const rel = relative(ROOT, f)
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (!PATTERN.test(line)) return
    if (rel === SHIM) shimHasIt = true
    else hits.push(`  ${rel}:${i + 1}  ${line.trim()}`)
  })
}

// Positive controls: a walk that found no app code, or a shim that no longer holds the one
// permitted call, would make "0 hits" meaningless.
const appJs = files.some(f => relative(ROOT, f) === 'App.js')
if (!appJs || files.length < 50 || !shimHasIt) {
  console.error(`back listener guard: BROKEN INSTRUMENT — scanned ${files.length} file(s), App.js ${appJs ? 'found' : 'MISSING'}, shim call ${shimHasIt ? 'found' : 'MISSING'} in ${SHIM}`)
  process.exit(1)
}
if (hits.length) {
  console.error(`back listener guard: FAILED — BackHandler.addEventListener outside ${SHIM}; use addBackListener or the iOS edge swipe skips this layer:\n${hits.join('\n')}`)
  process.exit(1)
}
console.log(`back listener guard: OK (${files.length} files, only ${SHIM} calls BackHandler.addEventListener)`)

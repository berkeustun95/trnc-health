#!/usr/bin/env node
// ─── Icon-only controls without a screen-reader name ────────────────────────
// A TouchableOpacity / Pressable whose ONLY child is an icon (<Ionicons|Feather|MaterialIcons>)
// and that carries no accessibilityLabel is announced as "button" and nothing else. This finds
// them in customer-facing screens/components (role screens allow-listed, as in check-font-family).
//   node scripts/check-icon-labels.mjs [--report]
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPORT = process.argv.includes('--report')
const ALLOW = new Set(['screens/AdminScreen.js', 'screens/ProviderScreen.js', 'screens/ProviderOnboardingScreen.js',
  'screens/OrganizerScreen.js', 'screens/EstateAgentDashboardScreen.js', 'screens/EstateAgentOnboardingScreen.js',
  'screens/HomeServiceDashboardScreen.js', 'screens/HomeServiceOnboardingScreen.js', 'screens/InsuranceDashboardScreen.js',
  'screens/InsuranceOnboardingScreen.js', 'screens/GarageOnboardingScreen.js', 'screens/GroomingOnboardingScreen.js',
  'screens/TransportOnboardingScreen.js', 'screens/JobPostOnboardingScreen.js'])
const walk = (d, o = []) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p, o) : f.endsWith('.js') && o.push(p) } return o }
const files = [...walk(join(ROOT, 'screens')), ...walk(join(ROOT, 'components')), join(ROOT, 'App.js')]
const out = []
for (const f of files) {
  const rel = relative(ROOT, f)
  if (ALLOW.has(rel)) continue
  const src = readFileSync(f, 'utf8')
  // <TouchableOpacity …props…> <Icon …/> </TouchableOpacity> with nothing else inside.
  // The opening tag is scanned with BRACE DEPTH, not a regex: props like onPress={() => x}
  // contain '>' and a [^>]* pattern stops inside them — the first version of this guard did
  // exactly that and was blind to every icon button with an inline arrow handler.
  for (const m of src.matchAll(/<(TouchableOpacity|Pressable|TouchableWithoutFeedback)\b/g)) {
    const tag = m[1]
    let i = m.index + m[0].length, depth = 0, quote = null
    for (; i < src.length; i++) {
      const c = src[i]
      if (quote) { if (c === quote && src[i - 1] !== '\\') quote = null; continue }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue }
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    if (src[i - 1] === '/') continue                      // self-closing: no children
    const props = src.slice(m.index, i)
    const close = src.indexOf(`</${tag}>`, i)
    if (close < 0) continue
    const inner = src.slice(i + 1, close).trim()
    if (!/^<(Ionicons|Feather|MaterialIcons|MaterialCommunityIcons)\b[\s\S]*\/>$/.test(inner)) continue
    if ((inner.match(/</g) || []).length !== 1) continue   // exactly one element: the icon
    if (/accessibilityLabel\s*=/.test(props)) continue
    out.push(`${rel}:${src.slice(0, m.index).split('\n').length}`)
  }
}
if (REPORT || !out.length) {
  console.log(`icon labels: ${out.length} icon-only control(s) without accessibilityLabel`)
  for (const x of out) console.log('  ' + x)
  process.exit(0)
}
console.error(`\n  icon labels: ${out.length} icon-only control(s) without accessibilityLabel:`)
for (const x of out) console.error('    ' + x)
process.exit(1)

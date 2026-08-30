#!/usr/bin/env node
// ─── getadaapp.com deploy guard ──────────────────────────────────────────────
//
//   npm run web:check           # exit 1 if a deploy would break a store URL
//   npm run web:check -- --self # prove every failure path is reachable
//
// ─── THE OUTAGE THIS EXISTS TO PREVENT ──────────────────────────────────────
//
// `wrangler deploy` uploads the ENTIRE assets directory as the Worker's manifest.
// It is not a merge — the manifest is REPLACED. So a deploy from a ./web that is
// missing support.html silently removes that page from the manifest, and because
// `not_found_handling` is "none" the /support route then falls THROUGH to Vercel,
// which answers with a Next.js 404.
//
// getadaapp.com/support is the App Store SUPPORT URL and getadaapp.com/privacy is
// the PRIVACY URL, registered with both stores. So the failure is a store-listing
// outage that presents as an ordinary 404 page — nothing about it looks like a
// deploy problem, and nobody is watching that URL.
//
// Same shape and same reason as the `npm run ota` wrapper: `wrangler deploy`, like
// `eas update`, bundles the WORKING TREE and has no lifecycle hook, so a wrapper is
// the only place a guard can stand.
//
// ─── WHY IT ALSO READS wrangler.jsonc ───────────────────────────────────────
//
// Dropping a ROUTE takes the same page down as deleting the file, and so does
// flipping not_found_handling. All three asset settings were measured against the
// live site by curl on 2026-08-30 before this project moved into the repo:
//
//   two exact routes, no wildcard  →  /privacyzz falls through to Vercel, and
//                                     /logo.png is served by Vercel, not by us
//   not_found_handling: "none"     →  that fall-through happens at all
//   html_handling: auto-trailing-slash → /privacy/ 308s to /privacy
//
// A changed setting is invisible until production, which is exactly the kind of
// thing this repo insists on asserting rather than remembering.

import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Every page the Worker must keep serving, and what it is registered as.
const REQUIRED_PAGES = [
  { file: 'privacy.html', route: 'getadaapp.com/privacy', role: 'App Store + Play PRIVACY URL' },
  { file: 'support.html', route: 'getadaapp.com/support', role: 'App Store SUPPORT URL' },
]

const EXPECTED_ASSETS = {
  directory:           './web',
  html_handling:       'auto-trailing-slash',
  not_found_handling:  'none',
}

// jsonc → json. String-aware, so a `//` inside a value is not treated as a comment.
function stripJsonComments(text) {
  let out = '', i = 0, inStr = false
  while (i < text.length) {
    const c = text[i]
    if (inStr) {
      out += c
      if (c === '\\') { out += text[i + 1] ?? ''; i += 2; continue }
      if (c === '"') inStr = false
      i++; continue
    }
    if (c === '"') { inStr = true; out += c; i++; continue }
    if (text.startsWith('//', i)) { while (i < text.length && text[i] !== '\n') i++; continue }
    if (text.startsWith('/*', i)) { i = text.indexOf('*/', i); i = i < 0 ? text.length : i + 2; continue }
    out += c; i++
  }
  return out
}

// The world the checks run against. Real mode reads disk; --self injects mutations,
// which is what makes every failure path provably reachable rather than assumed.
function readWorld() {
  const cfgRaw = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8')
  const cfg = JSON.parse(stripJsonComments(cfgRaw))
  const dir = cfg.assets?.directory ?? './web'
  const pages = {}
  for (const { file } of REQUIRED_PAGES) {
    const p = join(ROOT, dir, file)
    pages[file] = existsSync(p) && statSync(p).isFile()
      ? readFileSync(p, 'utf8')
      : null
  }
  return { cfg, pages }
}

function check({ cfg, pages }, log = console.log) {
  const problems = []

  // ── the pages themselves ──
  for (const { file, route, role } of REQUIRED_PAGES) {
    const body = pages[file]
    if (body === null) {
      problems.push(`${file} is MISSING from the assets directory — ${route} would 404 (${role})`)
      log(`    ✗ ${file.padEnd(14)} MISSING`)
      continue
    }
    if (body.trim().length === 0) {
      problems.push(`${file} is EMPTY — ${route} would serve a blank page (${role})`)
      log(`    ✗ ${file.padEnd(14)} EMPTY`)
      continue
    }
    // A file can exist and be non-empty and still not be a page — a truncated write,
    // a stray editor swap file, a merge conflict marker.
    if (!/<html[\s>]/i.test(body) || !/<\/html>/i.test(body)) {
      problems.push(`${file} does not look like a complete HTML document (no <html>…</html>)`)
      log(`    ✗ ${file.padEnd(14)} NOT A COMPLETE HTML DOCUMENT (${body.length} chars)`)
      continue
    }
    if (/^<{7}|^>{7}|^={7}/m.test(body)) {
      problems.push(`${file} contains a merge conflict marker`)
      log(`    ✗ ${file.padEnd(14)} MERGE CONFLICT MARKER`)
      continue
    }
    log(`    ✓ ${file.padEnd(14)} ${String(body.length).padStart(6)} chars  → ${route}`)
  }

  // ── the three asset settings, each with a measured production consequence ──
  for (const [k, want] of Object.entries(EXPECTED_ASSETS)) {
    const got = cfg.assets?.[k]
    if (got !== want) {
      problems.push(`assets.${k} is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`)
      log(`    ✗ assets.${k} = ${JSON.stringify(got)}  (expected ${JSON.stringify(want)})`)
    } else {
      log(`    ✓ assets.${k} = ${JSON.stringify(want)}`)
    }
  }

  // ── routes: DERIVED, not a name lookup. Print what is there and count it, so a
  //    THIRD route (a wildcard, say) fails just as loudly as a missing one: a
  //    wildcard pulls every Vercel-served path on the zone into the Worker, and the
  //    Worker would answer 404 for each one it has no asset for.
  const routes = (cfg.routes ?? []).map(r => (typeof r === 'string' ? r : r.pattern))
  log(`    · routes declared (${routes.length}): ${routes.join(', ') || '(none)'}`)
  const wanted = REQUIRED_PAGES.map(p => p.route)
  const missing = wanted.filter(r => !routes.includes(r))
  const extra   = routes.filter(r => !wanted.includes(r))
  if (routes.length !== wanted.length || missing.length || extra.length) {
    if (missing.length) problems.push(`route(s) missing from wrangler.jsonc: ${missing.join(', ')}`)
    if (extra.length)   problems.push(`unexpected route(s): ${extra.join(', ')} — a wildcard would shadow Vercel-served paths like /logo.png`)
    log(`    ✗ expected exactly ${wanted.length}: ${wanted.join(', ')}`)
  } else {
    log(`    ✓ exactly the ${wanted.length} expected routes, no wildcard`)
  }

  return problems
}

// ─── --self: prove each failure path is REACHABLE ────────────────────────────
// A guard nobody has watched fail is a decoration. Each case below mutates a copy
// of the REAL world and asserts (a) the mutation actually landed, and (b) the check
// noticed. Assertion (a) is not ceremony: a "break" that silently fails to apply
// produces a green run that reads exactly like a dead check — this repo has already
// lost an afternoon to precisely that.
function self() {
  const real = readWorld()
  const quiet = () => {}
  const base = check(real, quiet)
  if (base.length) {
    console.error('  --self cannot run: the REAL world is already failing.')
    for (const p of base) console.error('    • ' + p)
    return 1
  }
  console.log('  baseline: the real world PASSES, so any red below is caused by the mutation\n')

  const clone = () => ({ cfg: JSON.parse(JSON.stringify(real.cfg)), pages: { ...real.pages } })
  const cases = [
    ['support.html deleted', w => { w.pages['support.html'] = null },
                             w => w.pages['support.html'] === null],
    ['privacy.html deleted', w => { w.pages['privacy.html'] = null },
                             w => w.pages['privacy.html'] === null],
    ['support.html emptied', w => { w.pages['support.html'] = '' },
                             w => w.pages['support.html'] === ''],
    ['privacy.html truncated mid-document', w => { w.pages['privacy.html'] = real.pages['privacy.html'].slice(0, 400) },
                             w => w.pages['privacy.html'].length === 400],
    ['merge conflict marker in privacy.html', w => { w.pages['privacy.html'] = '<html>\n<<<<<<< HEAD\n</html>' },
                             w => w.pages['privacy.html'].includes('<<<<<<<')],
    ['not_found_handling flipped to 404-page', w => { w.cfg.assets.not_found_handling = '404-page' },
                             w => w.cfg.assets.not_found_handling === '404-page'],
    ['html_handling flipped', w => { w.cfg.assets.html_handling = 'none' },
                             w => w.cfg.assets.html_handling === 'none'],
    ['assets.directory repointed', w => { w.cfg.assets.directory = './public' },
                             w => w.cfg.assets.directory === './public'],
    ['/support route dropped', w => { w.cfg.routes = w.cfg.routes.filter(r => !r.pattern.endsWith('/support')) },
                             w => !w.cfg.routes.some(r => r.pattern.endsWith('/support'))],
    ['wildcard route added', w => { w.cfg.routes.push({ pattern: 'getadaapp.com/*', zone_name: 'getadaapp.com' }) },
                             w => w.cfg.routes.some(r => r.pattern.endsWith('/*'))],
  ]

  let bad = 0
  for (const [name, mutate, landed] of cases) {
    const w = clone()
    mutate(w)
    if (!landed(w)) {                       // (a) did the break actually happen?
      console.error(`    ✗ ${name.padEnd(40)} MUTATION DID NOT LAND — the test is broken, not the guard`)
      bad++; continue
    }
    const found = check(w, quiet)           // (b) did the guard notice?
    if (!found.length) {
      console.error(`    ✗ ${name.padEnd(40)} mutation landed but the guard stayed GREEN`)
      bad++; continue
    }
    console.log(`    ✓ ${name.padEnd(40)} red: ${found[0]}`)
  }
  console.log(`\n  ${cases.length - bad}/${cases.length} failure paths reachable`)
  return bad === 0 ? 0 : 1
}

// ─── main ────────────────────────────────────────────────────────────────────
const isSelf = process.argv.includes('--self')
console.log('getadaapp.com deploy guard')
console.log('  scope: the WORKING TREE that `wrangler deploy` would upload — not git HEAD\n')

if (isSelf) {
  const code = self()
  console.log(code === 0
    ? '\n  --self PASS — every failure path goes red.'
    : '\n  --self FAIL — a failure path is unreachable. Fix the guard.')
  process.exit(code)
}

const problems = check(readWorld())
if (!problems.length) {
  console.log('\n  PASS — both store-registered pages would be served, settings unchanged.')
  console.log('  REMINDER: this checks the FILES, not the deploy. Verify both URLs after `wrangler deploy`.')
  process.exit(0)
}
console.error('\n  FAIL — this deploy would break a store-registered URL.')
for (const p of problems) console.error('    • ' + p)
console.error('\n  wrangler deploy REPLACES the asset manifest; it does not merge.')
console.error('  Fix ./web or wrangler.jsonc. Do not deploy past this.')
process.exit(1)

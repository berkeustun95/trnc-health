#!/usr/bin/env node
// ─── Native modules must never be imported at module top level ───────────────
//
//   npm run native:safe
//
// ─── THE FAILURE THIS EXISTS TO PREVENT ─────────────────────────────────────
//
// `eas update` ships JS to binaries that are ALREADY INSTALLED. A native module added after
// those binaries were built does not exist on them. expo-web-browser's entry point is:
//
//     import { requireNativeModule } from 'expo-modules-core'
//     export default requireNativeModule('ExpoWebBrowser')
//
// — a TOP-LEVEL call. So a static `import ... from 'expo-web-browser'` anywhere in the
// reachable graph runs it while the BUNDLE IS EVALUATED, which is at launch, on every
// device, whether or not the screen using it is ever opened. On an older binary it throws
// and the app dies on the splash screen.
//
// runtimeVersion.policy is 'appVersion', which does NOT fence those binaries unless the
// version is bumped — so nothing else in this repo stops that OTA from going out.
//
// The safe form is `require()` INSIDE a function, which runs only when the user taps.
// This guard asserts that form mechanically, because the dangerous edit — changing a
// require inside a handler into an import at the top — is a one-line tidy-up that looks
// like an improvement and reviews clean.
//
// ─── WHAT A HEALTHY RUN PRINTS ──────────────────────────────────────────────
//
// The module name, the file, and the enclosing function the require sits in. A guard that
// prints only "OK" cannot be told apart from one whose scan matched nothing — so it also
// fails when it finds NO reference at all, which would mean the scan broke or the call
// site moved somewhere this script does not look.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
// @babel/parser and @babel/traverse are not direct dependencies — they arrive through
// babel-preset-expo -> @babel/core, which IS a direct dependency, so the chain is stable.
// Noted because this guard runs in pre-push: if it ever dies with MODULE_NOT_FOUND, that is
// the reason, and the fix is `npx expo install @babel/parser @babel/traverse` rather than a
// hunt for what broke.
import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'

const traverse = _traverse.default ?? _traverse
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Native modules that were added AFTER a production build shipped, and so must never be
// statically imported. Add to this list whenever a native dependency is introduced.
// react-native-webview: installed 2026-09-21 to ride the 1.2.0 build for the Adabüs map, with
// nothing importing it yet. It is a native COMPONENT, so its eventual require() belongs inside
// the rendering component, with a fallback.
//
// The three social sign-in modules: the 1.2.0 runtime fences old binaries from them, but
// google-signin's JS calls TurboModuleRegistry.getEnforcing at evaluation, so a top-level
// import would also crash Expo Go at launch. All three stay require()-in-function.
const GUARDED = [
  'expo-web-browser', 'react-native-webview',
  '@react-native-google-signin/google-signin', 'expo-apple-authentication', 'expo-crypto',
]

const SKIP = new Set(['node_modules', '.git', 'assets', 'docs', 'web', 'supabase', 'scripts'])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.jsx?$/.test(entry)) out.push(full)
  }
  return out
}

const problems = []
const found = []

for (const file of walk(ROOT)) {
  const src = readFileSync(file, 'utf8')
  if (!GUARDED.some(m => src.includes(m))) continue

  let ast
  try {
    ast = parse(src, { sourceType: 'module', plugins: ['jsx'] })
  } catch (e) {
    problems.push(`${relative(ROOT, file)}: could not parse (${e.message.split('\n')[0]})`)
    continue
  }

  traverse(ast, {
    // The dangerous form: `import ... from 'expo-web-browser'` at module scope.
    ImportDeclaration(path) {
      const name = path.node.source.value
      if (!GUARDED.includes(name)) return
      problems.push(
        `${relative(ROOT, file)}:${path.node.loc.start.line} STATIC IMPORT of '${name}'. `
        + `This runs requireNativeModule at bundle-evaluation time and will crash every `
        + `binary built before that module was added. Move it to require() inside the handler.`,
      )
    },

    // The safe form: require('expo-web-browser') with a Function ancestor.
    CallExpression(path) {
      const { callee, arguments: args } = path.node
      if (callee.type !== 'Identifier' || callee.name !== 'require') return
      if (!args.length || args[0].type !== 'StringLiteral') return
      const name = args[0].value
      if (!GUARDED.includes(name)) return

      const fn = path.getFunctionParent()
      const where = `${relative(ROOT, file)}:${path.node.loc.start.line}`
      if (!fn) {
        problems.push(
          `${where} TOP-LEVEL require() of '${name}'. A require at module scope runs at `
          + `bundle-evaluation time exactly as an import does. Move it inside the handler.`,
        )
      } else {
        const fnName = fn.node.id?.name
          ?? fn.parent?.id?.name
          ?? fn.parent?.key?.name
          ?? '(anonymous function)'
        found.push(`${where}  require('${name}') inside ${fnName}()`)
      }
    },
  })
}

for (const f of found) console.log(`  ${f}`)

// A scan that finds nothing is not a pass. Either the call site moved somewhere this script
// does not walk, or the walk itself broke — both look identical to "everything is fine".
if (!found.length && !problems.length) {
  problems.push(
    `found NO reference to any of [${GUARDED.join(', ')}] in the walked tree. Either the `
    + `call site moved out of the scanned directories or this scan is broken — both are `
    + `indistinguishable from a pass, so this is a failure.`,
  )
}

if (problems.length) {
  console.error('')
  console.error('  ┌─ NATIVE IMPORT SAFETY FAILED ──────────────────────────────────┐')
  for (const p of problems) console.error(`  │ ${p}`)
  console.error('  └────────────────────────────────────────────────────────────────┘')
  console.error('')
  process.exit(1)
}

console.log('')
console.log(`native import safety: OK (${found.length} guarded require(s), none at module scope)`)

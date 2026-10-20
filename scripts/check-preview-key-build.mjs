// ─── EAS build guard: the ADA Preview key never goes into a non-Preview binary ─
// Runs as eas-build-pre-install (package.json). EXPO_PUBLIC_ADA_PREVIEW_KEY lets a request read unpublished rows
// (20261120 is_previewer()) and is inlined into the JS bundle wherever it is defined at build time: the EAS
// environment the profile resolves, or a .env* file (.easignore uploads them). It belongs only to the `preview`
// environment, i.e. only to APP_VARIANT=preview builds. Any other build that can see it is refused here, before
// the binary exists. The OTA path has the same rule in check-ota-preflight.mjs (d).
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NAME = 'EXPO_PUBLIC_ADA_PREVIEW_KEY'
const preview = process.env.APP_VARIANT === 'preview'
const seen = []
if (process.env[NAME]) seen.push('build environment')
for (const f of ['.env.production.local', '.env.local', '.env.production', '.env']) {
  const p = resolve(ROOT, f)
  if (existsSync(p) && new RegExp(`^\\s*(?:export\\s+)?${NAME}\\s*=`, 'm').test(readFileSync(p, 'utf8'))) seen.push(f)
}
if (!preview && seen.length) {
  console.error(`✗ preview key guard: ${NAME} is visible to a NON-Preview build (${seen.join(', ')}) — it would be inlined into the binary. Remove it from that EAS environment / file.`)
  process.exit(1)
}
console.log(`✓ preview key guard: ${preview ? 'Preview build (key allowed)' : 'not a Preview build, key absent'}`)

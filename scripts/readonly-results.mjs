#!/usr/bin/env node
// Opens a supabase-readonly run's sealed result and appends it to the vault, never to the terminal or a log.
//
//   node scripts/readonly-results.mjs <run-id> [vault file]   # default: 10-ada/readonly-results.md
//
// The private key is on Berke's Mac only (~/.config/ada-claude-code/readonly-results.pem, 600, outside every repo).
import { execFileSync } from 'node:child_process'
import { readFileSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { unseal } from './lib/readonly-seal.mjs'

const [run, target] = process.argv.slice(2)
if (!/^\d+$/.test(run ?? '')) { console.error('usage: node scripts/readonly-results.mjs <run-id> [vault file]'); process.exit(1) }
const file = target ?? join(homedir(), 'ObsidianVault/10-ada/readonly-results.md')
const key = readFileSync(join(homedir(), '.config/ada-claude-code/readonly-results.pem'), 'utf8')
const log = execFileSync('gh', ['run', 'view', run, '--log'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const text = unseal(log, key)
appendFileSync(file, `\n## supabase-readonly run ${run}\n\n\`\`\`\n${text}\n\`\`\`\n`)
console.log(`run ${run}: result appended to ${file}`)

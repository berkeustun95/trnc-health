// supabase-readonly's sealing, end to end on a throwaway key plus the committed public key's match with the Mac's private key.
//
//   node scripts/test-readonly-seal.mjs
import { generateKeyPairSync, createPublicKey } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { seal, unseal, BEGIN } from './lib/readonly-seal.mjs'

let bad = 0
const t = (name, got, want) => {
  const ok = got === want
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${got}, want ${want}`}`)
}
const threw = fn => { try { fn(); return false } catch { return true } }

const pair = () => generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
const { publicKey, privateKey } = pair()
const secret = JSON.stringify({ users_total: 12345, id: '7f1c2d3e-4a5b-4c6d-8e7f-001122334455', name: 'Şükrü' }).repeat(40)
const block = seal(secret, publicKey)
// How `gh run view --log` shows it: job, step and timestamp in front of every line.
const log = ['role: x', ...block.split('\n')].map(l => `read\tRead (supabase_read_only_user)\t2026-11-05T20:21:19.0391387Z ${l}`).join('\n')

t('opens from a raw block', unseal(block, privateKey), secret)
t('opens from an Actions log with prefixes', unseal(log, privateKey), secret)
t('the block hides the number', block.includes('12345'), false)
t('the block hides the id', block.includes('7f1c2d3e'), false)
t('no line is longer than 120 characters', block.split('\n').every(l => l.length <= 120), true)
t('another key cannot open it', threw(() => unseal(block, pair().privateKey)), true)
const body = block.split('\n'); body[2] = body[2].slice(0, -4) + 'AAAA'
t('a changed block is refused', threw(() => unseal(body.join('\n'), privateKey)), true)
t('a log without a block is refused', threw(() => unseal('nothing here', privateKey)), true)
t('the marker is what the parser looks for', block.startsWith(BEGIN), true)

const mac = join(homedir(), '.config/ada-claude-code/readonly-results.pem')
if (existsSync(mac)) {
  const pub = readFileSync(new URL('./lib/readonly-results.pub', import.meta.url), 'utf8')
  const key = readFileSync(mac, 'utf8')
  t('the committed public key matches this Mac\'s private key', createPublicKey(key).export({ type: 'spki', format: 'pem' }).trim(), pub.trim())
}

console.log(bad ? `\nFAILED: ${bad}` : '\nall passed')
process.exit(bad ? 1 : 0)

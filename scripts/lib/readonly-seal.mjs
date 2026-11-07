// ─── Sealed results for supabase-readonly ─────────────────────────────────────
//
// Actions logs on this repo are public, and a read-only query's result can hold user totals or ids
// (Berke, 2026-11-05). So the runner seals every result with the public key committed beside this
// file, and only the private key on Berke's Mac opens it: AES-256-GCM for the text, RSA-OAEP for
// the AES key. Open one with scripts/readonly-results.mjs.
import { randomBytes, createCipheriv, createDecipheriv, publicEncrypt, privateDecrypt, constants } from 'node:crypto'

const OAEP = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }
export const BEGIN = '-----BEGIN READONLY RESULT-----'
export const END = '-----END READONLY RESULT-----'

export function seal(text, publicKey) {
  const key = randomBytes(32), iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const blob = Buffer.from(JSON.stringify({
    k: publicEncrypt({ key: publicKey, ...OAEP }, key).toString('base64'),
    iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), body: body.toString('base64'),
  })).toString('base64')
  return [BEGIN, ...blob.match(/.{1,120}/g), END].join('\n')
}

// Takes a whole Actions log: timestamps and anything around the block are ignored.
export function unseal(log, privateKey) {
  const lines = log.split('\n').map(l => l.replace(/^.*?(?=-----(BEGIN|END) READONLY RESULT-----)/, '').trim())
  const a = lines.indexOf(BEGIN), b = lines.indexOf(END)
  if (a < 0 || b < a) throw new Error('no sealed result in this log')
  const blob = lines.slice(a + 1, b).map(l => l.replace(/^.*\s/, '')).join('')
  const { k, iv, tag, body } = JSON.parse(Buffer.from(blob, 'base64').toString('utf8'))
  const key = privateDecrypt({ key: privateKey, ...OAEP }, Buffer.from(k, 'base64'))
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8')
}

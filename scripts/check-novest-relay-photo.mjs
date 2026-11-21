#!/usr/bin/env node
// Read-only relay photo check: fetches ONE known Novest photo through the relay and compares its sha256 and size.
// It answers "does the relay hand back unaltered bytes", nothing else. No Supabase client, no service key.
//
//   NOVEST_RELAY_URL / NOVEST_RELAY_KEY / NOVEST_RELAY_CA set -> node scripts/check-novest-relay-photo.mjs
//
// The mirror's User-Agent is read from the mirror script's source (importing it would run the mirror).

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { relayFetch } from './lib/novest-relay-client.mjs'

const PHOTO = 'https://coldwellbankernovest.com/wp-content/uploads/2026/11/WhatsApp-Image-2026-11-04-at-15.40.38-2-1536x2048.jpeg'
const SHA256 = 'd580dcf07676857e71cf3246b15df32224e4305bbfb0c83cb3b11f6d4c641041'
const SIZE = 2_574_830

const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'mirror-novest-images.mjs'), 'utf8')
const ua = /^const MIRROR_UA = '([^'\n]+)'$/m.exec(src)?.[1]
const bad = (bytes, why) => {
  console.log(`::error::relay photo check failed: photo changed upstream OR relay altered bytes (${bytes} bytes${why ? `, ${why}` : ''})`)
  process.exit(1)
}
if (!ua) { console.log('::error::relay photo check failed: mirror User-Agent not found in the mirror script'); process.exit(1) }

const t0 = Date.now()
let bytes = 0
try {
  const res = await relayFetch(PHOTO, { headers: { 'User-Agent': ua } })
  if (!res.ok) bad(0, `status ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  bytes = buf.length
  const match = createHash('sha256').update(buf).digest('hex') === SHA256 && bytes === SIZE
  console.log(`relay photo check: ${match ? 'MATCH' : 'MISMATCH'} · ${bytes} bytes · ${Date.now() - t0} ms`)
  if (!match) bad(bytes)
} catch (e) {
  bad(bytes, e.message)
}

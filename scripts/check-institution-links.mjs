#!/usr/bin/env node
// ─── University links health (institutions.website_url, 20261025) ───────────
//
//   node scripts/check-institution-links.mjs          # exit 1 if a link is dead or missing
//   node scripts/check-institution-links.mjs --self   # prove every classification is reachable
//   node scripts/check-institution-links.mjs --file links.tsv   # check a PROPOSED list (name<TAB>url
//                                                                 per line) before it is migrated
//
// A link is content that EXPIRES: a university rebrands (World Peace → Altınbaş, same
// domain for now), moves its site, or lets a domain lapse. The Student Hub page would keep
// rendering "Visit website" over a dead host with nothing anywhere going red. Same posture
// as check-duty-staleness.mjs: run by hand or from a cron, NOT in pre-push — a push must
// not be blocked because a university's server is down.
//
// ─── FIVE OUTCOMES, AND ONLY `dead` AND `missing` FAIL ──────────────────────
//   ok          2xx, redirects followed (the final address is printed when it differs)
//   challenge   403/503 carrying `cf-mitigated: challenge` — Cloudflare's bot check. A
//               person in a browser passes it; a script cannot. NOT a dead site.
//   bad chain   the server omits or misorders its intermediate certificate
//               (UNABLE_TO_VERIFY_LEAF_SIGNATURE / …ISSUER_CERT_LOCALLY). Node refuses it;
//               browsers that fetch intermediates recover. www.eul.edu.tr and arucad.edu.tr
//               on 2026-09-16. Printed, not failed — the site is up.
//   no answer   timeout or dropped connection. Printed, not failed: ncc.metu.edu.tr timed
//               out for minutes on 2026-09-16 and then answered in under a second, and a
//               check that flaps teaches the reader to re-run until green. ⚠ The price: a
//               host that times out FOREVER never turns this red — read the no-answer line.
//   dead        DNS gone, an expired/invalid certificate, a refused connection, or a
//               definitive HTTP error (4xx/5xx without the challenge header). Exit 1.
//   missing     an active university with no link — 20261025 set one on every row. Exit 1.
//
// GET, never HEAD — this repo already learned that hosts throttle HEAD harder than GET.

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OTHER_INSTITUTION_ID = '00000000-0000-4000-b000-0000000000ff'
const TIMEOUT_MS = 20000
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const c = { r: s => `\x1b[31m${s}\x1b[0m`, g: s => `\x1b[32m${s}\x1b[0m`,
            y: s => `\x1b[33m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m` }

// The classifier takes what a fetch produced, so --self can drive it without a network.
export function classify({ status, challenge, errorCode }) {
  if (errorCode) {
    if (errorCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || errorCode === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY') return 'bad chain'
    if (errorCode === 'TIMEOUT' || errorCode === 'UND_ERR_CONNECT_TIMEOUT' || errorCode === 'UND_ERR_SOCKET' ||
        errorCode === 'ECONNRESET') return 'no answer'
    return 'dead'                                   // ENOTFOUND, CERT_*, ECONNREFUSED, …
  }
  if (status >= 200 && status < 300) return 'ok'
  if ((status === 403 || status === 503) && challenge) return 'challenge'
  return 'dead'
}

if (process.argv.includes('--self')) {
  const cases = [
    [{ status: 200 }, 'ok'],
    [{ status: 403, challenge: true }, 'challenge'],
    [{ status: 503, challenge: true }, 'challenge'],
    [{ status: 403, challenge: false }, 'dead'],
    [{ status: 404 }, 'dead'],
    [{ status: 500 }, 'dead'],
    [{ errorCode: 'ENOTFOUND' }, 'dead'],
    [{ errorCode: 'CERT_HAS_EXPIRED' }, 'dead'],
    [{ errorCode: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }, 'bad chain'],
    [{ errorCode: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' }, 'bad chain'],
    [{ errorCode: 'TIMEOUT' }, 'no answer'],
    [{ errorCode: 'UND_ERR_SOCKET' }, 'no answer'],
  ]
  let bad = 0
  for (const [input, want] of cases) {
    const got = classify(input)
    console.log(`  ${got === want ? c.g('✓') : c.r('✗')} ${JSON.stringify(input).padEnd(38)} → ${got}${got === want ? '' : ` (want ${want})`}`)
    if (got !== want) bad++
  }
  console.log(bad ? c.r(`\n  --self FAIL — ${bad} case(s)`) : c.g('\n  --self PASS — every outcome reachable'))
  process.exit(bad ? 1 : 0)
}

const fileIdx = process.argv.indexOf('--file')
let rows
if (fileIdx !== -1) {
  const path = process.argv[fileIdx + 1]
  if (!path || !existsSync(path)) { console.error(c.r(`\n  --file needs an existing path (got ${path})\n`)); process.exit(1) }
  rows = readFileSync(path, 'utf8').split('\n').filter(l => l.trim()).map(l => {
    const [name, website_url] = l.split('\t').slice(-2)
    return { name, website_url: website_url?.trim() || null }
  })
  if (!rows.length) { console.error(c.r('\n  --file parsed to 0 rows. Refusing.\n')); process.exit(1) }
} else {
  if (existsSync(resolve(ROOT, '.env'))) {
    for (const line of readFileSync(resolve(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
  }
  const { EXPO_PUBLIC_SUPABASE_URL: URL, EXPO_PUBLIC_SUPABASE_ANON_KEY: KEY, ADA_TEST_EMAIL, ADA_TEST_PASSWORD } = process.env
  if (!URL || !KEY || !ADA_TEST_EMAIL || !ADA_TEST_PASSWORD) {
    console.error(c.r('\n  EXPO_PUBLIC_SUPABASE_URL/_ANON_KEY and ADA_TEST_EMAIL/_PASSWORD are required.'))
    console.error(c.d('  institutions is readable only TO authenticated: as anon every read is 0 rows,'))
    console.error(c.d('  which would print "no links to check". Refusing rather than lie.\n'))
    process.exit(1)
  }

  const supabase = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error: authErr } = await supabase.auth.signInWithPassword({ email: ADA_TEST_EMAIL, password: ADA_TEST_PASSWORD })
  if (authErr) { console.error(c.r(`\n  sign-in failed: ${authErr.message}\n`)); process.exit(1) }

  const { data, error } = await supabase.from('institutions')
    .select('id, name, is_active, website_url').eq('is_active', true).neq('id', OTHER_INSTITUTION_ID).order('name')
  await supabase.auth.signOut({ scope: 'local' })
  // POSITIVE CONTROL: the table is seeded and cannot be empty. Zero rows means this reader
  // is blind (RLS, a degraded token), not that there is nothing to check.
  if (error || !data?.length) {
    console.error(c.r(`\n  read ${data?.length ?? 0} active universities${error ? ` (${error.message})` : ''} — this reader is blind. Refusing.\n`))
    process.exit(1)
  }
  rows = data
}

async function probe(url) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': UA } })
    res.body?.cancel().catch(() => {})
    return { status: res.status, challenge: res.headers.get('cf-mitigated') === 'challenge', finalUrl: res.url }
  } catch (e) {
    return { errorCode: e.name === 'AbortError' ? 'TIMEOUT' : (e.cause?.code ?? e.code ?? e.name), detail: e.cause?.message ?? e.message }
  } finally {
    clearTimeout(timer)
  }
}

console.log(`university links — ${rows.length} ${fileIdx !== -1 ? 'from ' + process.argv[fileIdx + 1] : 'active universities (Other excluded)'}\n`)
const buckets = { ok: [], challenge: [], 'bad chain': [], dead: [], 'no answer': [], missing: [] }
const results = await Promise.all(rows.map(async r => (r.website_url ? { r, p: await probe(r.website_url) } : { r })))
for (const { r, p } of results) {
  if (!p) { buckets.missing.push(r); console.log(`  ${c.r('✗ missing  ')} ${r.name}`); continue }
  const kind = classify(p)
  buckets[kind].push(r)
  const moved = p.finalUrl && p.finalUrl.replace(/\/$/, '') !== r.website_url.replace(/\/$/, '') ? c.d(` → ${p.finalUrl}`) : ''
  const tag = { ok: c.g('✓ ok       '), challenge: c.y('~ challenge'), dead: c.r('✗ dead     '), 'bad chain': c.y('~ bad chain'), 'no answer': c.y('? no answer') }[kind]
  console.log(`  ${tag} ${r.name.padEnd(48)} ${r.website_url}${p.status ? ` ${p.status}` : ` ${p.errorCode}`}${moved}`)
}

console.log(`\n  ok ${buckets.ok.length} · challenge ${buckets.challenge.length} · bad chain ${buckets['bad chain'].length} · no answer ${buckets['no answer'].length} · dead ${buckets.dead.length} · missing ${buckets.missing.length}`)
if (buckets.challenge.length) console.log(c.d('  challenge = Cloudflare bot check; a browser passes it. Not a failure.'))
if (buckets['bad chain'].length) console.log(c.d('  bad chain = the server sends an incomplete certificate chain; browsers usually recover. Tell the university.'))
if (buckets['no answer'].length) console.log(c.d('  no answer = timeout or dropped connection. Re-run later; if it persists, check from a TRNC connection.'))
const failing = buckets.dead.length + buckets.missing.length
console.log(failing ? c.r(`\n  FAIL — ${failing} link(s) dead or missing.`) : c.g('\n  PASS — no dead or missing links.'))
process.exit(failing ? 1 : 0)

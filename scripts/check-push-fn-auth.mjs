#!/usr/bin/env node
// send-duty-notification and send-weekend-digest caller gate, offline: verify_jwt true, the serviceCaller check
// as the first statements of the handler, and every HTTP response body limited to an identifier allow-list (no user counts, no spreads).
// The pure decision (_shared/caller-auth.mjs) is tested in check-sync-novest-auth.mjs; here it only has to exist.
import { readFileSync } from 'node:fs'
import { serviceCaller } from '../supabase/functions/_shared/caller-auth.mjs'

const problems = []
const check = (ok, msg) => { if (!ok) problems.push(msg) }
check(typeof serviceCaller === 'function', '_shared/caller-auth.mjs must export serviceCaller')

// ONE constant: switching to exact-only = change this line and the `if (...)` line in both handlers.
const ACCEPT_RULE = 'if (!caller) {'

const IMPORT = "import { serviceCaller } from '../_shared/caller-auth.mjs'"
const NO_COUNTS = new Set(['true', 'false', 'ok', 'caller', 'date', 'today', 'outcome', 'error', 'pushFailed'])
const DIGEST_BODY = new Set(['true', 'false', 'ok', 'caller', 'mode', 'testersOnly', 'events', 'length', 'outcome', 'message', 'error', 'from', 'to', 'w'])
const COUNT_KEYS = ['notified', 'pushed', 'pushOk', 'pushErrorCount', 'pushRetries', 'errorKinds', 'pharmacies']
const FNS = [
  { name: 'send-duty-notification', finalBody: /JSON\.stringify\(\{ ok: !pushFailed, caller, date: today, outcome \}\)/, allow: NO_COUNTS },
  { name: 'send-weekend-digest', finalBody: /JSON\.stringify\(\{ ok: outcome !== 'push_failed', caller,/, allow: DIGEST_BODY },
]
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Balanced argument text of every `JSON.stringify(`, skipping string literals.
function stringifyArgs(src) {
  const out = []
  for (let at = src.indexOf('JSON.stringify('); at !== -1; at = src.indexOf('JSON.stringify(', at + 1)) {
    let i = at + 'JSON.stringify('.length, depth = 1
    const start = i
    while (i < src.length && depth > 0) {
      const c = src[i]
      if (c === "'" || c === '"' || c === '`') { for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++ }
      else if (c === '(') depth++
      else if (c === ')') depth--
      i++
    }
    out.push(src.slice(start, i - 1))
  }
  return out
}

const cfg = JSON.parse(readFileSync(new URL('../supabase/functions/deploy-config.json', import.meta.url), 'utf8'))
for (const fn of FNS) {
  const n = fn.name
  check(cfg.functions?.[n]?.verify_jwt === true,
    `deploy-config.json: ${n} verify_jwt must be true; the "role" branch trusts a signature only the gateway checks`)
  const raw = readFileSync(new URL(`../supabase/functions/${n}/index.ts`, import.meta.url), 'utf8')
  const src = raw.replace(/('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, s) => s ?? ' ')
  check(src.includes(IMPORT), `${n} must contain exactly: ${IMPORT}`)
  const idents = src.match(/\bserviceCaller\b/g)?.length ?? 0
  check(idents === 2, `${n}: serviceCaller must occur exactly twice (the import and the call), found ${idents}`)
  const serves = src.split('serve(').length - 1
  check(serves === 1, `${n} must contain exactly one serve( (found ${serves})`)
  const open = /\bserve\(\s*async\s*\(req\)\s*=>\s*\{/.exec(src)
  check(open !== null, `${n} handler must be serve(async (req) => {`)
  const body = open ? src.slice(open.index + open[0].length) : ''
  const GATE = new RegExp([
    /^\s*const caller = await serviceCaller\(\s*req\.headers\.get\('Authorization'\),\s*Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)\s*\)\s*;?/,
    new RegExp('\\s*' + esc(ACCEPT_RULE) + `\\s*console\\.error\\('${n}: caller refused'\\)\\s*;?\\s*`),
    /return new Response\(\s*JSON\.stringify\(\{ ok: false, error: 'unauthorized' \}\),\s*/,
    /\{ status: 401, headers: \{ 'Content-Type': 'application\/json' \} \}\s*\)\s*;?\s*\}/,
  ].map(r => r.source).join(''))
  const m = GATE.exec(body)
  check(m !== null, `${n}: the first statements of the handler must be the serviceCaller gate (${ACCEPT_RULE}) returning 401, exactly as pinned in scripts/check-push-fn-auth.mjs`)
  const after = m ? body.slice(m[0].length) : body
  check(body.trimStart().startsWith('const caller = await serviceCaller('),
    `${n}: the handler's first token must be the gate, before any createClient( / req.json( / .from( / fetch(`)
  check(fn.finalBody.test(after), `${n}: the final response must carry caller as the second key`)

  const responseWords = src.match(/\bResponse\b/g)?.length ?? 0
  check(responseWords === src.split('new Response(').length - 1, `${n}: every Response must be built as new Response( with a JSON.stringify( body (no Response.json, no aliasing)`)
  const bodies = stringifyArgs(src)
  const responses = src.split('new Response(').length - 1
  check(bodies.length === responses, `${n}: every new Response( must carry a JSON.stringify( body (${responses} responses, ${bodies.length} bodies)`)
  {
    for (const b of bodies) {
      const ids = b.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, ' ').match(/[A-Za-z_$][\w$]*/g) ?? []
      const bad = ids.filter(x => !fn.allow.has(x))
      check(bad.length === 0, `${n}: a response body uses ${[...new Set(bad)].join(', ')}; only ${[...fn.allow].join(', ')} are allowed (no user counts, ${COUNT_KEYS.join('/')} stay in duty_push_runs)`)
      check(!/\.\.\./.test(b), `${n}: a response body must not spread an object`)
    }
  }
}

if (problems.length) {
  console.error('push function auth check FAILED:')
  for (const p of problems) console.error('  ✗ ' + p)
  process.exit(1)
}
console.log(`push function auth check: OK (${FNS.length} functions: verify_jwt, gate pinned first in handler, response bodies on an allow-list, no counts)`)

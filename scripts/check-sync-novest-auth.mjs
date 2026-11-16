#!/usr/bin/env node
// sync-novest caller gate, offline: the pure decision in _shared/caller-auth.mjs plus the position of the
// check inside the handler. Tokens are built at runtime and unsigned (the gateway verifies signatures).
import { readFileSync } from 'node:fs'
import { serviceCaller } from '../supabase/functions/_shared/caller-auth.mjs'

const problems = []
const check = (ok, msg) => { if (!ok) problems.push(msg) }

const b64u = o => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = claims => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u(claims)}.dummysig`
const bearer = t => 'Bearer ' + t

const svc = jwt({ role: 'service_role' })
const cases = [
  ['service_role JWT', bearer(svc), 'env-key-unrelated', 'role'],
  ['service_role JWT, env unset', bearer(svc), undefined, 'role'],
  ['exact JWT-form key', bearer(svc), svc, 'exact'],
  ['exact non-JWT key', bearer('sb_secret_abc'), 'sb_secret_abc', 'exact'],
  ['exact wins when both match', bearer(svc), svc, 'exact'],
  ['non-JWT key that differs', bearer('sb_secret_abd'), 'sb_secret_abc', null],
  ['anon JWT', bearer(jwt({ role: 'anon' })), 'k', null],
  ['authenticated JWT', bearer(jwt({ role: 'authenticated' })), 'k', null],
  ['guest JWT', bearer(jwt({ role: 'authenticated', is_anonymous: true })), 'k', null],
  ['no header', null, 'k', null],
  ['undefined header', undefined, 'k', null],
  ['empty header', '', 'k', null],
  ['empty bearer, empty env', 'Bearer ', '', null],
  ['empty bearer, undefined env', 'Bearer ', undefined, null],
  ['empty bearer', 'Bearer ', 'k', null],
  ['malformed JWT', bearer('notajwt'), 'k', null],
  ['non-JSON payload', bearer('a.' + btoa('not json') + '.c'), 'k', null],
  ['role with trailing space', bearer(jwt({ role: 'service_role ' })), 'k', null],
  ['role upper case', bearer(jwt({ role: 'SERVICE_ROLE' })), 'k', null],
  ['role nested in app_metadata', bearer(jwt({ role: 'authenticated', app_metadata: { role: 'service_role' } })), 'k', null],
  ['no Bearer scheme', svc, 'k', null],
  ['two Authorization values joined', bearer(svc) + ', ' + bearer(jwt({ role: 'anon' })), 'k', null],
  ['two values, forged first', bearer(jwt({ role: 'anon' })) + ', ' + bearer(svc), 'k', null],
  ['2-segment token', bearer('x.' + svc.split('.')[1]), 'k', null],
  ['5-segment token', bearer(svc + '.x.y'), 'k', null],
  ['space inside payload', bearer(svc.split('.')[0] + '.' + svc.split('.')[1].slice(0, 5) + ' ' + svc.split('.')[1].slice(5) + '.sig'), 'k', null],
  ['trailing space', bearer(svc) + ' ', 'k', null],
  ['double space after Bearer', 'Bearer  ' + svc, 'k', null],
  ['padded base64 payload', bearer(svc.split('.')[0] + '.' + btoa(JSON.stringify({ role: 'service_role' })) + '.sig'), 'k', null],
  ['standard-base64 payload with +/', bearer(svc.split('.')[0] + '.' + btoa('{"role":"service_role","x":"\u00fb\u00ff\u00fe"}') + '.sig'), 'k', null],
]
for (const [name, header, key, want] of cases) {
  const got = await serviceCaller(header, key)
  check(got === want, `${name}: expected ${want}, got ${got}`)
}

const cfg = JSON.parse(readFileSync(new URL('../supabase/functions/deploy-config.json', import.meta.url), 'utf8'))
check(cfg.functions?.['sync-novest']?.verify_jwt === true,
  'deploy-config.json: sync-novest verify_jwt must be true; the "role" branch trusts a signature only the gateway checks')

const raw = readFileSync(new URL('../supabase/functions/sync-novest/index.ts', import.meta.url), 'utf8')
const src = raw.replace(/('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, s) => s ?? ' ')
const IMPORT = "import { serviceCaller } from '../_shared/caller-auth.mjs'"
check(src.includes(IMPORT), `sync-novest must contain exactly: ${IMPORT}`)
const idents = src.match(/\bserviceCaller\b/g)?.length ?? 0
check(idents === 2, `sync-novest: serviceCaller must occur exactly twice (the import and the call), found ${idents}`)
const serves = src.split('Deno.serve(').length - 1
check(serves === 1, `sync-novest must contain exactly one Deno.serve (found ${serves})`)
const open = /Deno\.serve\(\s*async\s*\(req\)\s*=>\s*\{/.exec(src)
check(open !== null, 'sync-novest handler must be Deno.serve(async (req) => {')
const body = open ? src.slice(open.index + open[0].length) : ''
const GATE = new RegExp([
  /^\s*const caller = await serviceCaller\(\s*req\.headers\.get\('Authorization'\),\s*Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)\s*\)\s*;?/,
  /\s*if \(!caller\) \{\s*(?:console\.error\('sync-novest: caller refused'\)\s*;?\s*)?/,
  /return new Response\(\s*JSON\.stringify\(\{ ok: false, error: 'unauthorized' \}\),\s*/,
  /\{ status: 401, headers: \{ 'Content-Type': 'application\/json' \} \}\s*\)\s*;?\s*\}/,
].map(r => r.source).join(''))
check(GATE.test(body), 'sync-novest: the first statements of the handler must be the serviceCaller gate returning 401, exactly as pinned in scripts/check-sync-novest-auth.mjs')
check(/\bok: true, caller,/.test(body) && /\bok: false, caller,/.test(body),
  'sync-novest responses must carry caller as the second key')

if (problems.length) {
  console.error('sync-novest auth check FAILED:')
  for (const p of problems) console.error('  ✗ ' + p)
  process.exit(1)
}
console.log(`sync-novest auth check: OK (${cases.length} caller cases, verify_jwt, gate pinned first in handler)`)

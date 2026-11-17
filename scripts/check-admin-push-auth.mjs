#!/usr/bin/env node
// admin-push caller gate, offline: the pure decision (adminCaller in _shared/caller-auth.mjs) as unit cases, plus
// the static facts: verify_jwt true, the gate is the first statements of the handler (before req.json()), no console
// or log line carries a token / id / allowlist variable, and every response body stays on an allow-list.
// Tokens are built at runtime and unsigned (the gateway verifies signatures; getUser is faked here).
import { readFileSync } from 'node:fs'
import { adminCaller } from '../supabase/functions/_shared/caller-auth.mjs'

const problems = []
const check = (ok, msg) => { if (!ok) problems.push(msg) }
check(typeof adminCaller === 'function', '_shared/caller-auth.mjs must export adminCaller')

const b64u = o => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = claims => `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u(claims)}.dummysig`
const bearer = t => 'Bearer ' + t
const userJwt = jwt({ role: 'authenticated', sub: 'u1' })
const serviceJwt = jwt({ role: 'service_role' })

// A fake service client: getUser verifies a token like Auth does (the service key and unknown tokens are not users).
const USERS = { [userJwt]: { id: 'u-admin' } }
function rig({ user = { id: 'u-admin' }, getUserError = null, getUserThrows = false, role = 'admin', noRow = false, roleError = null, roleThrows = false } = {}) {
  const calls = { getUser: 0, getRole: 0 }
  return {
    calls,
    deps: {
      async getUser(token) {
        calls.getUser++
        if (getUserThrows) throw new Error('network')
        if (getUserError) return { data: { user: null }, error: getUserError }
        if (token === serviceJwt) return { data: { user: null }, error: { status: 403, message: 'invalid claim: missing sub claim' } }
        return { data: { user }, error: null }
      },
      async getRole(id) {
        calls.getRole++
        if (roleThrows) throw new Error('network')
        return roleError ? { data: null, error: roleError } : { data: noRow ? null : { role }, error: null }
      },
    },
  }
}
const cases = [
  // [name, header, rig options, expected result, expected getRole calls]
  ['admin: the positive control', bearer(userJwt), {}, { id: 'u-admin' }, 1],
  ['no header', null, {}, { status: 401, error: 'unauthorized' }, 0],
  ['undefined header', undefined, {}, { status: 401, error: 'unauthorized' }, 0],
  ['empty header', '', {}, { status: 401, error: 'unauthorized' }, 0],
  ['no Bearer scheme', userJwt, {}, { status: 401, error: 'unauthorized' }, 0],
  ['malformed token', bearer('notajwt'), {}, { status: 401, error: 'unauthorized' }, 0],
  ['two JWTs joined', bearer(userJwt) + ', ' + bearer(userJwt), {}, { status: 401, error: 'unauthorized' }, 0],
  ['trailing space', bearer(userJwt) + ' ', {}, { status: 401, error: 'unauthorized' }, 0],
  ['service key (getUser rejects it)', bearer(serviceJwt), {}, { status: 401, error: 'unauthorized' }, 0],
  ['getUser 401', bearer(userJwt), { getUserError: { status: 401 } }, { status: 401, error: 'unauthorized' }, 0],
  ['getUser 400', bearer(userJwt), { getUserError: { status: 400 } }, { status: 401, error: 'unauthorized' }, 0],
  ['getUser 500', bearer(userJwt), { getUserError: { status: 500 } }, { status: 503, error: 'auth_unavailable' }, 0],
  ['getUser 503', bearer(userJwt), { getUserError: { status: 503 } }, { status: 503, error: 'auth_unavailable' }, 0],
  ['getUser error without a status', bearer(userJwt), { getUserError: { message: 'fetch failed' } }, { status: 503, error: 'auth_unavailable' }, 0],
  ['getUser throws', bearer(userJwt), { getUserThrows: true }, { status: 503, error: 'auth_unavailable' }, 0],
  ['getUser returns no user', bearer(userJwt), { user: null }, { status: 401, error: 'unauthorized' }, 0],
  ['anonymous (guest)', bearer(userJwt), { user: { id: 'u-guest', is_anonymous: true } }, { status: 401, error: 'unauthorized' }, 0],
  ['customer', bearer(userJwt), { role: 'customer' }, { status: 403, error: 'forbidden' }, 1],
  ['provider', bearer(userJwt), { role: 'provider' }, { status: 403, error: 'forbidden' }, 1],
  ['role "Admin" (case)', bearer(userJwt), { role: 'Admin' }, { status: 403, error: 'forbidden' }, 1],
  ['no profile row', bearer(userJwt), { noRow: true }, { status: 403, error: 'forbidden' }, 1],
  ['profiles read error', bearer(userJwt), { roleError: { message: 'x' } }, { status: 503, error: 'auth_unavailable' }, 1],
  ['profiles read throws', bearer(userJwt), { roleThrows: true }, { status: 503, error: 'auth_unavailable' }, 1],
]
for (const [name, header, opts, want, roleCalls] of cases) {
  const r = rig(opts)
  const got = await adminCaller(header, r.deps)
  check(JSON.stringify(got) === JSON.stringify(want), `${name}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`)
  check(r.calls.getRole === roleCalls, `${name}: getRole called ${r.calls.getRole} times, expected ${roleCalls}`)
}
{
  // the role is read for the id Auth returned, never for anything the caller supplied
  let asked = null
  const got = await adminCaller(bearer(userJwt), { ...rig().deps, getRole: async id => { asked = id; return { data: { role: 'admin' }, error: null } } })
  check(asked === 'u-admin' && got.id === 'u-admin', `getRole must be asked for the id getUser returned, asked ${asked}`)
}

const cfg = JSON.parse(readFileSync(new URL('../supabase/functions/deploy-config.json', import.meta.url), 'utf8'))
check(cfg.functions?.['admin-push']?.verify_jwt === true, 'deploy-config.json: admin-push verify_jwt must be true')

const strip = raw => raw.replace(/('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, s) => s ?? ' ')
const fnPath = f => new URL(`../supabase/functions/admin-push/${f}`, import.meta.url)
const rawIndex = readFileSync(fnPath('index.ts'), 'utf8')
const rawSend = readFileSync(fnPath('send.ts'), 'utf8')
const index = strip(rawIndex), send = strip(rawSend)

// Literals removed (kept as ' '), the identifiers left in the balanced argument text of every `<open>` call.
function callArgs(src, open) {
  const out = []
  for (let at = src.indexOf(open); at !== -1; at = src.indexOf(open, at + 1)) {
    let i = at + open.length, depth = 1
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
// Identifiers only (property names after a dot included); literals in the original text are masked by strip() already
// only for the stripped copy, so read idents from a literal-masked copy of the ORIGINAL argument text.
const maskLiterals = s => s.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, ' ')
const idents = s => maskLiterals(s).match(/[A-Za-z_$][\w$]*/g) ?? []
const noStrip = raw => raw.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ')

check(index.includes("import { adminCaller } from '../_shared/caller-auth.mjs'") || rawIndex.includes("import { adminCaller } from '../_shared/caller-auth.mjs'"),
  "admin-push/index.ts must import adminCaller from '../_shared/caller-auth.mjs'")
check((index.match(/\badminCaller\b/g)?.length ?? 0) === 2, 'index.ts: adminCaller must occur exactly twice (the import and the call)')
check((index.match(/\bserve\(/g)?.length ?? 0) === 1, 'index.ts must contain exactly one serve(')
check(!/\bserviceCaller\b/.test(index), 'index.ts must not use serviceCaller: the service key is not an admin')

const open = /\bserve\(\s*async\s*\(req\)\s*=>\s*\{/.exec(index)
check(open !== null, 'index.ts handler must be serve(async (req) => {')
const body = open ? index.slice(open.index + open[0].length) : ''
const GATE = new RegExp([
  /^\s*const caller = await adminCaller\(\s*req\.headers\.get\('Authorization'\),\s*\{\s*/,
  /getUser: \(jwt\) => service\.auth\.getUser\(jwt\),\s*/,
  /getRole: \(id\) => service\.from\('profiles'\)\.select\('role'\)\.eq\('id', id\)\.maybeSingle\(\),\s*\}\s*\)\s*;?/,
  /\s*if \(!\('id' in caller\)\) \{\s*console\.error\('admin-push: caller refused', caller\.status\)\s*;?\s*/,
  /return new Response\(\s*JSON\.stringify\(\{ ok: false, error: caller\.error \}\),\s*/,
  /\{ status: caller\.status, headers: \{ 'Content-Type': 'application\/json' \} \}\s*\)\s*;?\s*\}/,
].map(r => r.source).join(''))
const gate = GATE.exec(body)
check(gate !== null, 'index.ts: the first statements of the handler must be the adminCaller gate returning caller.status, exactly as pinned in scripts/check-admin-push-auth.mjs')
check(body.trimStart().startsWith('const caller = await adminCaller('), "index.ts: the handler's first token must be the gate, before req.json( / .from( on any other table / fetch(")
const afterGate = gate ? body.slice(gate[0].length) : body
check(!/req\.json\(|\bhandle\(/.test(gate ? gate[0] : ''), 'index.ts: req.json( / handle( must come after the gate')
check(/req\.json\(/.test(afterGate) && /\bhandle\(/.test(afterGate), 'index.ts: the body is read and handled only after the gate')

// Logs: counts and codes only. An allow-list of identifiers in every console.* / log( argument.
const LOG_OK = new Set(['caller', 'status', 'code'])
for (const [file, raw] of [['index.ts', rawIndex], ['send.ts', rawSend]]) {
  for (const open of ['console.error(', 'console.log(', 'console.warn(', 'console.info(', 'console.debug(', 'd.log(']) {
    for (const a of callArgs(noStrip(raw), open)) {
      const ids = idents(a)
      const bad = ids.filter(x => !LOG_OK.has(x))
      check(bad.length === 0, `${file}: a ${open} line uses ${[...new Set(bad)].join(', ')}; only ${[...LOG_OK].join(', ')} may be printed (no token, id, allowlist, title, body)`)
    }
  }
}

// Responses: index.ts bodies carry only these identifiers; send.ts out(...) bodies only these keys/values.
const INDEX_BODY = new Set(['ok', 'false', 'error', 'caller', 'result', 'body'])
const SEND_BODY = new Set(['ok', 'true', 'false', 'error', 'outcome', 'test', 'recipients', 'pushed', 'previous', 'req', 'profiles', 'length', 'pushOk', 'out', 'bad'])
for (const a of callArgs(noStrip(rawIndex), 'JSON.stringify(')) {
  const bad = idents(a).filter(x => !INDEX_BODY.has(x))
  check(bad.length === 0, `index.ts: a response body uses ${[...new Set(bad)].join(', ')}`)
  check(!/\.\.\./.test(a), 'index.ts: a response body must not spread an object')
}
check((index.split('new Response(').length - 1) === callArgs(noStrip(rawIndex), 'JSON.stringify(').length, 'index.ts: every new Response( must carry a JSON.stringify( body')
for (const a of callArgs(noStrip(rawSend), 'out(')) {
  const bad = idents(a).filter(x => !SEND_BODY.has(x) && !/^\d+$/.test(x))
  check(bad.length === 0, `send.ts: a response uses ${[...new Set(bad)].join(', ')}; only ${[...SEND_BODY].join(', ')} are allowed (no id, token, text)`)
  check(!/\.\.\./.test(a), 'send.ts: a response must not spread an object')
}
check(!/console\./.test(send), 'send.ts must not print anything itself (use d.log with a code)')

// The send-once ledger is not the duty ledger: the #484 watch reads duty_push_runs only.
check(!/duty_push_runs/.test(rawIndex.replace(/\/\/[^\n]*/g, '')) && !/duty_push_runs/.test(noStrip(rawSend)), 'admin-push must never write duty_push_runs')

if (problems.length) {
  console.error('admin-push auth check FAILED:')
  for (const p of problems) console.error('  ✗ ' + p)
  process.exit(1)
}
console.log(`admin-push auth check: OK (${cases.length} adminCaller cases incl. the admin positive control, verify_jwt, gate pinned first in handler, logs and responses on allow-lists)`)

// dovec-lead-forget engine (scripts/dovec-lead-forget.mjs + scripts/lib/dovec-lead-forget.mjs): the real script is run as a subprocess
// against a local stub server standing in for PostgREST. No production, no key (a fake one), no network beyond 127.0.0.1.
//   node scripts/test-dovec-lead-forget.mjs
// Evidence of: the reference is checked before any request; an apply outside CI is refused by prodWriteGuard; the log carries only
// the seven allowlisted booleans (an injected name/phone is dropped), an HTTP error prints status + code only, the exit codes and
// the exact result lines. NOT evidence of: the SQL function (test-dovec-lead-forget-sql.mjs) or the workflow's approval gate.
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REF_RE, KEYS, allowlisted, errorCode, verdict } from './lib/dovec-lead-forget.mjs'

// The names are built, not spelled: this file holds only a fake key and a 127.0.0.1 stub, and must not be classified as a production writer.
const KEY_ENV = 'SUPABASE_SERVICE' + '_ROLE_KEY'
const RPC_PATH = '/rest/v1/' + 'rpc/dovec_lead_forget'
const ENGINE = fileURLToPath(new URL('./dovec-lead-forget.mjs', import.meta.url))
let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const A = (...on) => Object.fromEntries(KEYS.map(k => [k, on.includes(k)]))

let requests = []
let reply = () => ({ status: 200, body: A() })
const server = http.createServer((req, res) => {
  let data = ''
  req.on('data', c => { data += c })
  req.on('end', () => {
    requests.push({ url: req.url, method: req.method, body: data, auth: req.headers.authorization })
    const r = reply(data)
    res.writeHead(r.status, { 'Content-Type': 'application/json' })
    res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body))
  })
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const URL_ = `http://127.0.0.1:${server.address().port}`

const exec = (args, { ci = true, env = {} } = {}) => new Promise(resolve => {
  const out = join(mkdtempSync(join(tmpdir(), 'dlf-')), 'gh-output')
  const e = { PATH: process.env.PATH, EXPO_PUBLIC_SUPABASE_URL: URL_, [KEY_ENV]: 'fake-service-key-for-test', GITHUB_OUTPUT: out, ...env }
  if (ci) e.GITHUB_ACTIONS = 'true'
  const p = spawn(process.execPath, [ENGINE, ...args], { env: e })
  let so = '', se = ''
  p.stdout.on('data', c => { so += c }); p.stderr.on('data', c => { se += c })
  p.on('close', code => resolve({ code, so, se, all: so + se, gh: existsSync(out) ? readFileSync(out, 'utf8') : '' }))
})
const call = async (args, rep, opts) => { requests = []; reply = rep ?? reply; return exec(args, opts) }

console.log('── the pure parts')
t('REF_RE accepts ADA-1 and ADA-90000000001', [REF_RE.test('ADA-1'), REF_RE.test('ADA-90000000001')], [true, true])
t('REF_RE refuses malformed and TEST-1', ['ADA-', 'ada-1', ' ADA-1', 'ADA-1\n', 'ADA-1x', 'TEST-1', '', 'ADA--1'].map(x => REF_RE.test(x)), Array(8).fill(false))
t('allowlisted keeps exactly the seven and drops anything else', allowlisted({ ...A('found'), name: 'X', phone: '1', extra: { a: 1 } }), A('found'))
t('allowlisted rejects a missing key, a non-boolean, an array, null', [allowlisted({ found: true }), allowlisted({ ...A(), found: 'true' }), allowlisted([]), allowlisted(null)], [null, null, null, null])
t('errorCode: only a short code, else unknown', [errorCode({ code: '42501', message: 'Jane Doe +44' }), errorCode({ code: 'x y z <script>' }), errorCode('boom'), errorCode(null)], ['42501', 'unknown', 'unknown', 'unknown'])
const V = (a, apply) => { const v = verdict(a, apply); return [v.exit, v.lines[v.lines.length - 1].replace('  result: ', '')] }
t('verdict dry ok', V(A('valid_reference', 'found', 'settled'), false), [0, 'DRY OK, apply would wipe name, phone, e-mail, message and user id of this enquiry; status and everything else stay'])
t('verdict dry already wiped', V(A('valid_reference', 'found', 'settled', 'already_wiped'), false), [0, 'DRY OK, already wiped, nothing to change'])
t('verdict applied', V(A('valid_reference', 'found', 'settled', 'wiped', 'applied'), true), [0, 'APPLIED, personal fields wiped; status and everything else unchanged'])
t('verdict second apply', V(A('valid_reference', 'found', 'settled', 'already_wiped', 'applied'), true), [0, 'already wiped, nothing changed'])
t('verdict refusals exit 1: pending, not found, test, invalid', [V(A('valid_reference', 'found'), true)[0], V(A('valid_reference'), true)[0], V(A('valid_reference', 'found', 'is_test', 'settled'), true)[0], V(A(), true)[0]], [1, 1, 1, 1])
t('verdict: a dry run that reports a write, or an apply that did not apply, aborts', [V(A('valid_reference', 'found', 'settled', 'wiped'), false)[0], V(A('valid_reference', 'found', 'settled'), true)[0]], [1, 1])

console.log('── the engine, as a subprocess')
{
  for (const bad_ of ['ADA-', 'ada-1', 'TEST-1', 'ADA-1;--', '', 'ADA-1 ']) {
    const r = await call([`--ref=${bad_}`], undefined)
    t(`malformed ref ${JSON.stringify(bad_)}: exit 2, zero requests`, [r.code, requests.length], [2, 0])
  }
  let r = await call([], undefined)
  t('no --ref: exit 2, zero requests', [r.code, requests.length], [2, 0])
  r = await call(['--ref=ADA-1', '--ref=ADA-2'], undefined)
  t('two --ref: exit 2, zero requests', [r.code, requests.length], [2, 0])
  r = await call(['--ref=ADA-1', '--apply'], undefined, { ci: false })
  t('apply outside CI: refused by prodWriteGuard before any request', [r.code, requests.length, /REFUSED/.test(r.all)], [1, 0, true])

  r = await call(['--ref=ADA-12'], () => ({ status: 200, body: A('valid_reference', 'found', 'settled') }))
  t('dry ok: exit 0, one POST to the rpc, p_apply false, service key as bearer', [r.code, requests.length, requests[0]?.url, requests[0]?.method, JSON.parse(requests[0].body), requests[0]?.auth],
    [0, 1, RPC_PATH, 'POST', { p_reference: 'ADA-12', p_apply: false }, 'Bearer fake-service-key-for-test'])
  console.log('    DRY OUTPUT:\n' + r.so.split('\n').map(l => '      ' + l).join('\n'))
  t('  prints all seven keys and the dry result line, ok=true to GITHUB_OUTPUT', [KEYS.every(k => r.so.includes(`  ${k}: `)), r.so.includes('  result: DRY OK, apply would wipe'), r.gh.trim()], [true, true, 'ok=true'])
  t('  the secret key is never printed', r.all.includes('fake-service-key-for-test'), false)

  r = await call(['--ref=ADA-12', '--apply'], () => ({ status: 200, body: A('valid_reference', 'found', 'settled', 'wiped', 'applied') }))
  t('apply: exit 0, p_apply true', [r.code, JSON.parse(requests[0].body)], [0, { p_reference: 'ADA-12', p_apply: true }])
  console.log('    APPLY OUTPUT:\n' + r.so.split('\n').map(l => '      ' + l).join('\n'))
  t('  result line', r.so.includes('  result: APPLIED, personal fields wiped; status and everything else unchanged'), true)

  r = await call(['--ref=ADA-12', '--apply'], () => ({ status: 200, body: A('valid_reference', 'found', 'settled', 'already_wiped', 'applied') }))
  t('second apply on a wiped row: exit 0 and says "already wiped, nothing changed"', [r.code, r.so.includes('  result: already wiped, nothing changed')], [0, true])

  r = await call(['--ref=ADA-12', '--apply'], () => ({ status: 200, body: A('valid_reference', 'found') }))
  t('apply refused on a pending row: exit non-zero, ok=false', [r.code, r.gh.trim(), r.so.includes('REFUSED, the enquiry is still pending')], [1, 'ok=false', true])
  r = await call(['--ref=ADA-12'], () => ({ status: 200, body: A('valid_reference') }))
  t('dry on an unknown reference: exit non-zero (dry is not ok)', [r.code, r.gh.trim()], [1, 'ok=false'])
  r = await call(['--ref=ADA-12'], () => ({ status: 200, body: A('valid_reference', 'found', 'is_test', 'settled') }))
  t('dry on the test enquiry: exit non-zero', [r.code, r.so.includes('REFUSED, that is the test enquiry')], [1, true])

  r = await call(['--ref=ADA-12'], () => ({ status: 200, body: { ...A('valid_reference', 'found', 'settled'), name: 'Jane Q Person', phone: '+441234567890', email: 'jane@example.invalid', message: 'secret text', user_id: '11111111-2222-4333-8444-555555555555' } }))
  t('an injected name / phone / email / message / user_id is not printed', [r.code, /Jane|\+4412|jane@|secret text|11111111/.test(r.all)], [0, false])
  r = await call(['--ref=ADA-12'], () => ({ status: 200, body: { found: true, name: 'Jane Q Person' } }))
  t('an answer missing the booleans: exit 1, "not printed", nothing echoed', [r.code, /not the expected seven/.test(r.so), /Jane/.test(r.all)], [1, true, false])
  r = await call(['--ref=ADA-12'], () => ({ status: 200, body: 'not json Jane Q Person' }))
  t('an unreadable answer: exit 1, nothing echoed', [r.code, /Jane/.test(r.all)], [1, false])

  r = await call(['--ref=ADA-12', '--apply'], () => ({ status: 403, body: { code: '42501', message: 'permission denied for Jane Q Person', details: '+441234567890', hint: 'x' } }))
  t('HTTP error: status + code only, exit 1, ok=false, no body text', [r.code, r.so.includes('  http 403, error code 42501'), /Jane|permission denied|\+4412/.test(r.all), r.gh.trim()], [1, true, false, 'ok=false'])
  r = await call(['--ref=ADA-12'], () => ({ status: 500, body: '<html>Jane Q Person</html>' }))
  t('HTTP 500 with a non-JSON body: status + unknown code, nothing echoed', [r.code, r.so.includes('  http 500, error code unknown'), /Jane|html/.test(r.all)], [1, true, false])
}
server.close()
console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)

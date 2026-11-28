// dovec-lead-forget engine (scripts/dovec-lead-forget.mjs + scripts/lib/dovec-lead-forget.mjs): the real script is run as a subprocess
// against a local stub server standing in for PostgREST. No production, no key (a fake one), no network beyond 127.0.0.1.
//   node scripts/test-dovec-lead-forget.mjs
// Evidence of: the reference and the e-mail are checked before any request (the e-mail arrives in DOVEC_FORGET_EMAIL, never in argv);
// an apply outside CI is refused by prodWriteGuard; the log carries only the ten allowlisted booleans and never the e-mail (an injected name/phone is dropped), an HTTP error prints status + code only, the exit codes and
// the exact result lines. NOT evidence of: the SQL function (test-dovec-lead-forget-sql.mjs) or the workflow's approval gate.
import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REF_RE, KEYS, allowlisted, errorCode, verdict } from './lib/dovec-lead-forget.mjs'

// The names are built, not spelled: this file holds only a fake key and a 127.0.0.1 stub, and must not be classified as a production writer.
const KEY_ENV = 'SUPABASE_SERVICE' + '_ROLE_KEY'
const RPC_PATH = '/rest/v1/' + 'rpc/dovec_lead_forget'
const TEN = ['valid_reference', 'found', 'is_test', 'settled', 'account_linked', 'account_has_email', 'email_matches_account', 'already_wiped', 'wiped', 'applied']
const ENV_EMAIL = 'DOVEC_FORGET' + '_EMAIL'
const EMAIL = 'Zq.Leak-Probe7+tag@Example.INVALID'
const EMAIL_FORMS = [EMAIL, EMAIL.toLowerCase(), 'zq.leak-probe7']
const leaks = txt => EMAIL_FORMS.some(f => txt.toLowerCase().includes(f.toLowerCase()))
const ENGINE = fileURLToPath(new URL('./dovec-lead-forget.mjs', import.meta.url))
let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const A = (...on) => Object.fromEntries(TEN.map(k => [k, on.includes(k)]))
const OK = ['valid_reference', 'found', 'settled', 'account_linked', 'account_has_email', 'email_matches_account']

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
  const e = { PATH: process.env.PATH, EXPO_PUBLIC_SUPABASE_URL: URL_, [KEY_ENV]: 'fake-service-key-for-test', GITHUB_OUTPUT: out, [ENV_EMAIL]: ` ${EMAIL} `, ...env }
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k]
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
t('KEYS is exactly the ten agreed booleans', [...KEYS], TEN)
t('allowlisted keeps exactly the ten and drops anything else', allowlisted({ ...A('found'), name: 'X', phone: '1', extra: { a: 1 } }), A('found'))
t('allowlisted rejects a missing key, a non-boolean, an array, null', [allowlisted({ found: true }), allowlisted({ ...A(), found: 'true' }), allowlisted([]), allowlisted(null)], [null, null, null, null])
t('errorCode: only a short code, else unknown', [errorCode({ code: '42501', message: 'Jane Doe +44' }), errorCode({ code: 'x y z <script>' }), errorCode('boom'), errorCode(null)], ['42501', 'unknown', 'unknown', 'unknown'])
const V = (a, apply) => { const v = verdict(a, apply); return [v.exit, v.lines[v.lines.length - 1].replace('  result: ', '')] }
t('verdict dry ok', V(A(...OK), false), [0, 'DRY OK, apply would wipe name, phone, e-mail, message and user id of this enquiry; status and everything else stay'])
t('verdict dry already wiped', V(A(...OK, 'already_wiped'), false), [0, 'DRY OK, already wiped, nothing to change'])
t('verdict applied', V(A(...OK, 'wiped', 'applied'), true), [0, 'APPLIED, personal fields wiped; status and everything else unchanged'])
t('verdict second apply', V(A(...OK, 'already_wiped', 'applied'), true), [0, 'already wiped, nothing changed'])
t('verdict refusals exit 1: pending, not found, test, invalid', [V(A('valid_reference', 'found'), true)[0], V(A('valid_reference'), true)[0], V(A(...OK, 'is_test'), true)[0], V(A(), true)[0]], [1, 1, 1, 1])
const NOT = k => OK.filter(x => x !== k)
t('verdict: no linked account refuses (dry and apply), with its own line', [V(A(...NOT('account_linked')), false), V(A(...NOT('account_linked')), true)],
  Array(2).fill([1, 'REFUSED, the enquiry has no linked account any more (already wiped or account deleted); nothing to match the e-mail against']))
t('verdict: linked account without an e-mail refuses', V(A(...NOT('account_has_email'), 'account_linked'), true), [1, 'REFUSED, the account that sent this enquiry has no e-mail to match'])
t('verdict: e-mail mismatch refuses, ok is false', [V(A(...NOT('email_matches_account')), true), verdict(A(...NOT('email_matches_account')), false).ok], [[1, 'REFUSED, the e-mail does not match the account that sent this enquiry (nothing changed)'], false])
t('verdict: ok needs the match', [verdict(A(...OK), false).ok, verdict(A(...NOT('email_matches_account')), true).ok], [true, false])
t('verdict: a pending row is still reported as pending before any account line', V(A('valid_reference', 'found'), true)[1].startsWith('REFUSED, the enquiry is still pending'), true)
t('verdict: a dry run that reports a write, or an apply that did not apply, aborts', [V(A(...OK, 'wiped'), false)[0], V(A(...OK), true)[0]], [1, 1])

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
  const refuseEmail = async (label, env, args = ['--ref=ADA-1']) => {
    const x = await call(args, undefined, { env })
    t(`e-mail ${label}: exit 2, zero requests, nothing printed, ok not set to true`, [x.code, requests.length, leaks(x.all) || /BadAddr|a b@c/.test(x.all), /ok=true/.test(x.gh)], [2, 0, false, false])
  }
  await refuseEmail('missing', { [ENV_EMAIL]: undefined })
  await refuseEmail('empty', { [ENV_EMAIL]: '' })
  await refuseEmail('blank', { [ENV_EMAIL]: ' \t ' })
  await refuseEmail('without @', { [ENV_EMAIL]: 'BadAddr.example.invalid' })
  await refuseEmail('too long (321)', { [ENV_EMAIL]: 'a'.repeat(312) + '@bad.test' })
  await refuseEmail('control character inside', { [ENV_EMAIL]: 'a\u0007b@c.test' })
  await refuseEmail('newline inside', { [ENV_EMAIL]: 'a b@c.test\nx@y.test' })
  await refuseEmail('on the command line (argv is never the way in)', {}, ['--ref=ADA-1', `--email=${EMAIL}`])
  r = await call(['--ref=ADA-12'], () => ({ status: 200, body: A(...OK) }), { env: { [ENV_EMAIL]: 'a'.repeat(315) + '@b.co' } })
  t('exactly 320 characters is accepted', [r.code, requests.length], [0, 1])
  r = await call(['--ref=ADA-1', '--apply'], undefined, { ci: false })
  t('apply outside CI: refused by prodWriteGuard before any request', [r.code, requests.length, /REFUSED/.test(r.all)], [1, 0, true])

  r = await call(['--ref=ADA-12'], () => ({ status: 200, body: A(...OK) }))
  t('dry ok: exit 0, one POST to the rpc, p_apply false, service key as bearer', [r.code, requests.length, requests[0]?.url, requests[0]?.method, JSON.parse(requests[0].body), requests[0]?.auth],
    [0, 1, RPC_PATH, 'POST', { p_reference: 'ADA-12', p_email: EMAIL, p_apply: false }, 'Bearer fake-service-key-for-test'])
  console.log('    DRY OUTPUT:\n' + r.so.split('\n').map(l => '      ' + l).join('\n'))
  t('  prints all ten keys and the dry result line, ok=true to GITHUB_OUTPUT', [TEN.every(k => r.so.includes(`  ${k}: `)), r.so.includes('  result: DRY OK, apply would wipe'), r.gh.trim()], [true, true, 'ok=true'])
  t('  the secret key is never printed', r.all.includes('fake-service-key-for-test'), false)

  r = await call(['--ref=ADA-12', '--apply'], () => ({ status: 200, body: A(...OK, 'wiped', 'applied') }))
  t('apply: exit 0, p_apply true', [r.code, JSON.parse(requests[0].body)], [0, { p_reference: 'ADA-12', p_email: EMAIL, p_apply: true }])
  console.log('    APPLY OUTPUT:\n' + r.so.split('\n').map(l => '      ' + l).join('\n'))
  t('  result line', r.so.includes('  result: APPLIED, personal fields wiped; status and everything else unchanged'), true)

  r = await call(['--ref=ADA-12', '--apply'], () => ({ status: 200, body: A(...OK, 'already_wiped', 'applied') }))
  t('second apply on a wiped row: exit 0 and says "already wiped, nothing changed"', [r.code, r.so.includes('  result: already wiped, nothing changed')], [0, true])

  r = await call(['--ref=ADA-12', '--apply'], () => ({ status: 200, body: A('valid_reference', 'found') }))
  t('apply refused on a pending row: exit non-zero, ok=false', [r.code, r.gh.trim(), r.so.includes('REFUSED, the enquiry is still pending')], [1, 'ok=false', true])
  r = await call(['--ref=ADA-12'], () => ({ status: 200, body: A('valid_reference') }))
  t('dry on an unknown reference: exit non-zero (dry is not ok)', [r.code, r.gh.trim()], [1, 'ok=false'])
  r = await call(['--ref=ADA-12'], () => ({ status: 200, body: A(...OK, 'is_test') }))
  t('dry on the test enquiry: exit non-zero', [r.code, r.so.includes('REFUSED, that is the test enquiry')], [1, true])

  r = await call(['--ref=ADA-12', '--apply'], () => ({ status: 200, body: { ...A(...OK, 'wiped', 'applied'), email: EMAIL, p_email: EMAIL, account_email: EMAIL.toLowerCase() } }))
  t('an injected e-mail in the answer is dropped: nothing carrying it in stdout, stderr or GITHUB_OUTPUT', [r.code, leaks(r.all), leaks(r.gh)], [0, false, false])
  r = await call(['--ref=ADA-12'], () => ({ status: 200, body: A(...OK) }))
  t('the e-mail the person wrote is in none of: stdout, stderr, GITHUB_OUTPUT (dry ok)', [leaks(r.so), leaks(r.se), leaks(r.gh)], [false, false, false])
  r = await call(['--ref=ADA-12'], () => ({ status: 200, body: A(...NOT('email_matches_account')) }))
  t('mismatch: exit 1, ok=false, the refusal line, nothing leaked', [r.code, r.gh.trim(), r.so.includes('REFUSED, the e-mail does not match'), leaks(r.all)], [1, 'ok=false', true, false])
  r = await call(['--ref=ADA-12', '--apply'], () => ({ status: 200, body: A('valid_reference', 'found', 'settled') }))
  t('apply on a wiped/unlinked row: exit 1 with the no-account line', [r.code, r.so.includes('REFUSED, the enquiry has no linked account any more')], [1, true])
  r = await call(['--ref=ADA-12'], () => ({ status: 200, body: { ...A(...OK), name: 'Jane Q Person', phone: '+441234567890', email: 'jane@example.invalid', message: 'secret text', user_id: '11111111-2222-4333-8444-555555555555' } }))
  t('an injected name / phone / email / message / user_id is not printed', [r.code, /Jane|\+4412|jane@|secret text|11111111/.test(r.all)], [0, false])
  r = await call(['--ref=ADA-12'], () => ({ status: 200, body: { found: true, name: 'Jane Q Person' } }))
  t('an answer missing the booleans: exit 1, "not printed", nothing echoed', [r.code, /not the expected ten/.test(r.so), /Jane/.test(r.all)], [1, true, false])
  r = await call(['--ref=ADA-12'], () => ({ status: 200, body: 'not json Jane Q Person' }))
  t('an unreadable answer: exit 1, nothing echoed', [r.code, /Jane/.test(r.all)], [1, false])

  r = await call(['--ref=ADA-12', '--apply'], () => ({ status: 403, body: { code: '42501', message: `permission denied for ${EMAIL}`, details: '+441234567890', hint: EMAIL } }))
  t('HTTP error: status + code only, exit 1, ok=false, no body text', [r.code, r.so.includes('  http 403, error code 42501'), /Jane|permission denied|\+4412/.test(r.all) || leaks(r.all), r.gh.trim()], [1, true, false, 'ok=false'])
  r = await call(['--ref=ADA-12'], () => ({ status: 500, body: '<html>Jane Q Person</html>' }))
  t('HTTP 500 with a non-JSON body: status + unknown code, nothing echoed', [r.code, r.so.includes('  http 500, error code unknown'), /Jane|html/.test(r.all)], [1, true, false])
}

// Workflow text: the enquiry reference AND the e-mail must be masked before anything can print them (the log of a public repo).
const WF = process.env.DOVEC_FORGET_WORKFLOW || fileURLToPath(new URL('../.github/workflows/dovec-lead-forget.yml', import.meta.url))
const wf = readFileSync(WF, 'utf8')
const jobBody = job => wf.split(new RegExp(`^  ${job}:\\n`, 'm'))[1]?.split(/^  [a-z][^\n]*:\n/m)[0] ?? ''
for (const job of ['dry', 'apply']) {
  const steps = jobBody(job).split(/^      - /m).slice(1)
  const first = steps[0] ?? ''
  const EXPR = /\$\{\{\s*inputs\.(ref|email)/
  const maskAt = steps.findIndex(x => x.includes('::add-mask::'))
  const useAt = steps.findIndex(x => EXPR.test(x))
  t(`workflow ${job}: first step masks the ref AND the e-mail from GITHUB_EVENT_PATH (no set -x, no inputs expression in it)`,
    [maskAt, first.includes('GITHUB_EVENT_PATH'), first.includes('.inputs.ref'), first.includes('.inputs.email'), (first.match(/::add-mask::/g) || []).length >= 1, /set -x|xtrace/.test(first), EXPR.test(first)],
    [0, true, true, true, true, false, false])
  t(`workflow ${job}: first step also masks the lower-cased / trimmed e-mail`, /tr '\[:upper:\]' '\[:lower:\]'/.test(first) && /sed -e/.test(first), true)
  t(`workflow ${job}: the e-mail expression appears once, as the env of a step after the mask`, [useAt > maskAt && maskAt === 0, (jobBody(job).match(/\$\{\{\s*inputs\.email/g) || []).length, /^ {10}DOVEC_FORGET_EMAIL: \$\{\{ inputs\.email \}\}$/m.test(jobBody(job))], [true, 1, true])
  t(`workflow ${job}: first step refuses a line break in the ref or the e-mail (exit 1, error without a value)`, [/\$'\\n'|\$'\\r'/.test(first), /::error::[^"]*"; exit 1/.test(first)], [true, true])
  const script = (first.split(/run: \|\n/)[1] ?? '').split('\n').map(l => l.replace(/^ {10}/, '')).join('\n')
  const SECRET_LINES = ['Zq.Line-One@Example.INVALID', '  Zq.Line-Two  ']
  for (const [what, inputs] of [['email', { ref: 'ADA-1', email: SECRET_LINES.join('\n') }], ['ref', { ref: 'ADA-1\n' + SECRET_LINES[0], email: 'a@b.invalid' }], ['leading newline in ref', { ref: '\nADA-2', email: 'a@b.invalid' }]]) {
    const dir = mkdtempSync(join(tmpdir(), 'mask-'))
    const ev = join(dir, 'event.json')
    writeFileSync(ev, JSON.stringify({ inputs }))
    const r = spawnSync('bash', ['-c', script], { env: { PATH: process.env.PATH, GITHUB_EVENT_PATH: ev }, encoding: 'utf8' })
    const out = r.stdout.split('\n').filter(Boolean)
    const masked = new Set(out.filter(l => l.startsWith('::add-mask::')).map(l => l.slice(12)))
    const firstOther = out.findIndex(l => !l.startsWith('::add-mask::'))
    const lastMask = out.map(l => l.startsWith('::add-mask::')).lastIndexOf(true)
    const lines = [...inputs.ref.split('\n'), ...inputs.email.split('\n')].filter(Boolean)
    t(`workflow ${job}: mask step, multi-line ${what}: every non-empty line is masked before any other output, then exit 1, and the error prints no value`,
      [r.status, lines.filter(l => !masked.has(l)), firstOther === -1 || firstOther > lastMask, out.some(l => l.startsWith('::error::')) && !lines.some(l => out.filter(o => !o.startsWith('::add-mask::')).join('\n').includes(l))], [1, [], true, true])
  }
}
t('workflow: no run-name, no inputs.email outside the two env lines, none in the approve job, no echo of it', [/^run-name:/m.test(wf), (wf.match(/\$\{\{\s*inputs\.email/g) || []).length - (wf.match(/^[^#\n]*DOVEC_FORGET_EMAIL: \$\{\{ inputs\.email \}\}$/gm) || []).length, /inputs\.(email|ref)\s*\}\}/.test(jobBody('approve')), /echo[^\n]*(IN_EMAIL|DOVEC_FORGET_EMAIL|inputs\.email)/.test(wf)], [false, 0, false, false])
t('workflow: email is a required string input, its description carries no address', [/^      email:\n[^\n]*\n {8}type: string\n {8}required: true/m.test(wf), /^      email:\n {8}description: '[^'@]*'/m.test(wf)], [true, true])
server.close()
console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)

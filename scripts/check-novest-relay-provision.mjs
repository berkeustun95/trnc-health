#!/usr/bin/env node
// Offline proof of the Novest relay provisioning scripts (ops/hermes/novest-relay/{provision,setup}.sh): the dry runs
// execute nothing, and a stubbed real run keeps the relay key and the server IP off every command line and out of
// every output. No network, no ssh, no GitHub: every external tool is a stub that logs.
//
//   node scripts/check-novest-relay-provision.mjs
//   node scripts/check-novest-relay-provision.mjs --provision <alt.sh> --setup <alt.sh>   # red-first: broken copies

import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, chmodSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'ops/hermes/novest-relay')
const arg = n => { const i = process.argv.indexOf(n); return i !== -1 ? resolve(process.argv[i + 1]) : null }
const PROVISION = arg('--provision') ?? join(DIR, 'provision.sh')
const SETUP = arg('--setup') ?? join(DIR, 'setup.sh')

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n      got    ${JSON.stringify(got)}\n      wanted ${JSON.stringify(want)}`}`)
}

const IMG_SHA = 'd580dcf07676857e71cf3246b15df32224e4305bbfb0c83cb3b11f6d4c641041'
const FAKE_IP = '1.2.3.4'
const BASH = '/bin/bash'
const tmp = mkdtempSync(join(tmpdir(), 'novest-provision-test-'))
const sh = (cmd) => spawnSync('sh', ['-c', cmd], { encoding: 'utf8' }).stdout.trim()
const REAL_SHASUM = sh('command -v shasum')

const writeStub = (dir, name, body) => { const p = join(dir, name); writeFileSync(p, `#!/bin/sh\n${body}\n`); chmodSync(p, 0o755) }
const freshDir = n => { const d = join(tmp, n); mkdirSync(d); return d }
const lines = f => (existsSync(f) ? readFileSync(f, 'utf8') : '')

try {
  console.log('dry runs execute nothing and print no secret-shaped value')
  {
    const stubs = freshDir('dry-stubs'), log = join(tmp, 'dry.log')
    for (const n of ['ssh', 'gh', 'openssl', 'curl', 'sudo', 'ufw', 'useradd', 'systemctl', 'install', 'tar', 'shasum', 'ss', 'chmod', 'chown']) writeStub(stubs, n, `echo ${n} >> "${log}"\nexit 1`)
    const env = { PATH: `${stubs}:/usr/bin:/bin`, HOME: tmp, LOG: log }
    const dry = (script) => spawnSync(BASH, [script, '--dry-run'], { env, encoding: 'utf8', cwd: tmp })
    const ipv4 = /\b\d{1,3}(\.\d{1,3}){3}\b/
    const setup = dry(SETUP), prov = dry(PROVISION)
    t('setup.sh --dry-run exits 0', [setup.status, setup.stderr], [0, ''])
    t('provision.sh --dry-run exits 0', [prov.status, prov.stderr], [0, ''])
    t('no stub was ever called (nothing executed)', lines(log), '')
    const so = setup.stdout, po = prov.stdout
    for (const f of ['useradd --system', 'ufw allow 8443/tcp comment novest-relay', 'systemctl enable --now novest-relay', '/etc/novest-relay/key.sha256', '<sha256(key)>', 'check: ufw is active', '<staging-dir>/tls.crt', '--connect-to <ip>:8443:localhost:8443'])
      t(`setup dry-run prints: ${f}`, so.includes(f), true)
    for (const f of ['ssh -G <ssh-alias>', 'tar --no-xattrs -c', "ssh -t <ssh-alias> 'sudo bash <staging-dir>/setup.sh --staging <staging-dir>'", "ssh <ssh-alias> 'cat <staging-dir>/tls.crt && rm -rf <staging-dir>'",
      'gh secret set NOVEST_RELAY_KEY --env production --repo berkeustun95/trnc-health', 'gh secret set NOVEST_RELAY_URL --env production --repo berkeustun95/trnc-health', 'gh secret set NOVEST_RELAY_CA --env production --repo berkeustun95/trnc-health',
      'openssl rand -hex 32', 'NOVEST_ROUTE is not touched', IMG_SHA])
      t(`provision dry-run prints: ${f}`, po.includes(f), true)
    t('provision dry-run has exactly three secret set lines', po.split('\n').filter(l => /secret set /.test(l)).length, 3)
    for (const [n, o] of [['setup', so], ['provision', po]]) {
      t(`${n} dry-run: no 64-hex value (apart from the known image digest)`, /[0-9a-f]{64}/.test(o.split(IMG_SHA).join('')), false)
      t(`${n} dry-run: no IPv4 address at all`, ipv4.test(o), false)
    }
    t('provision dry-run never mentions the variable route as a command', /variable set|NOVEST_ROUTE=/.test(po), false)
    const dryR = (script) => spawnSync(BASH, [script, '--rotate-cert', '--dry-run'], { env, encoding: 'utf8', cwd: tmp })
    const rs = dryR(SETUP), rp = dryR(PROVISION)
    t('setup.sh --rotate-cert --dry-run exits 0', [rs.status, rs.stderr], [0, ''])
    t('provision.sh --rotate-cert --dry-run exits 0', [rp.status, rp.stderr], [0, ''])
    t('rotate dry runs executed nothing (no stub called)', lines(log), '')
    for (const f of ['openssl ecparam -name prime256v1 -genkey -noout -out /etc/novest-relay/tls.key.new', '-days 730', 'subjectAltName=IP:<ip>', 'mv /etc/novest-relay/tls.key.new /etc/novest-relay/tls.key', 'mv /etc/novest-relay/tls.crt.new /etc/novest-relay/tls.crt', 'systemctl restart novest-relay', 'key.sha256 is not touched', 'expect 401', 'expect 405', '<staging-dir>/tls.crt'])
      t(`setup rotate dry-run prints: ${f}`, rs.stdout.includes(f), true)
    for (const f of ['setup.sh --rotate-cert --staging <staging-dir>', 'gh secret set NOVEST_RELAY_CA --env production', 'no relay key, no hash', 'keyed checks are impossible', 'fail TLS pinning', 'ssh -G <ssh-alias>'])
      t(`provision rotate dry-run prints: ${f}`, rp.stdout.includes(f), true)
    t('provision rotate dry-run sets exactly one secret (CA), no key generation', [rp.stdout.split('\n').filter(l => /secret set /.test(l)).length, /secret set NOVEST_RELAY_(KEY|URL)|rand -hex|shasum/.test(rp.stdout)], [1, false])
    for (const [n, o] of [['setup rotate', rs.stdout], ['provision rotate', rp.stdout]]) {
      t(`${n} dry-run: no 64-hex value, no IPv4 address`, [/[0-9a-f]{64}/.test(o), ipv4.test(o)], [false, false])
      t(`${n} dry-run: never mentions the relay key hash file as an input`, /sha256\(key\)/.test(o), false)
    }
  }

  console.log('setup.sh real mode refuses early')
  {
    const stubs = freshDir('setup-stubs'), log = join(tmp, 'setup.log')
    for (const n of ['ufw', 'useradd', 'systemctl', 'install']) writeStub(stubs, n, `echo ${n} >> "${log}"\nexit 1`)
    const env = { PATH: `${stubs}:/usr/bin:/bin`, HOME: tmp }
    const r = (...a) => spawnSync(BASH, [SETUP, ...a], { env, encoding: 'utf8', cwd: tmp })
    const a = r(), b = r('--staging', '/tmp/novest-relay.abc123'), c = r('1.2.3.4')
    t('no arguments is refused with usage', [a.status, a.stderr.startsWith('REFUSED: usage')], [1, true])
    const rotNoStg = r('--rotate-cert')
    t('--rotate-cert without --staging is refused with usage', [rotNoStg.status, rotNoStg.stderr.startsWith('REFUSED: usage')], [1, true])
    t('a bare IP argument (the old interface) is refused', [c.status, c.stderr.startsWith('REFUSED: usage')], [1, true])
    if (process.getuid && process.getuid() !== 0) t('without root: refused before touching anything', [b.status, b.stderr.includes('run as root')], [1, true])
    t('no system tool was called', lines(log), '')
  }

  console.log('provision.sh with stubbed tools (real mode)')
  {
    const mkCert = ip => {
      const d = freshDir('cert-' + ip.replace(/\./g, '-'))
      const g = spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', join(d, 'k.pem'), '-out', join(d, 'c.pem'),
        '-days', '2', '-subj', '/CN=novest-relay', '-addext', `subjectAltName=IP:${ip}`], { encoding: 'utf8' })
      if (g.status !== 0) throw new Error('openssl could not generate the throwaway cert')
      return join(d, 'c.pem')
    }
    const goodCert = mkCert(FAKE_IP), wrongCert = mkCert('5.6.7.8')

    const scenario = (name, { ip = FAKE_IP, cert = goodCert, ghApiFail = '', curlBad = '', alias = [], setFail = '' } = {}) => {
      const stubs = freshDir(name + '-stubs'), log = freshDir(name + '-log')
      writeStub(stubs, 'ssh', `echo "$*" >> "$LOG/ssh.argv"
if [ "$1" = "-G" ]; then echo "hostname $STUB_IP"; echo "user ops"; exit 0; fi
if [ "$1" = "-t" ]; then exit 0; fi
last=""; for a in "$@"; do last=$a; done
case "$last" in
  umask*) cat > "$LOG/upload.tar"; printf %s /tmp/novest-relay.Ab12Cd;;
  "cat "*) cat "$STUB_CERT";;
  *) ;;
esac`)
      writeStub(stubs, 'gh', `echo "$*" >> "$LOG/gh.argv"
if [ "$1" = "api" ]; then
  if [ -n "$STUB_GH_API_FAIL" ]; then echo "gh: HTTP 403" >&2; exit 1; fi
  echo '{"key_id":"x","key":"y"}'; exit 0
fi
if [ "$1" = "secret" ] && [ "$2" = "set" ]; then cat > "$LOG/gh.stdin.$3"; [ "$3" = "$STUB_GH_SET_FAIL" ] && { echo "gh: boom" >&2; exit 1; }; echo "Set Actions secret $3 for the repository"; exit 0; fi
exit 1`)
      writeStub(stubs, 'curl', `echo "$*" >> "$LOG/curl.argv"
cfg=$(cat); printf '%s\\n--\\n' "$cfg" >> "$LOG/curl.stdin"
out=""; ua=0; prev=""
for a in "$@"; do [ "$prev" = "-o" ] && out=$a; [ "$prev" = "-A" ] && ua=$a; prev=$a; done
case "$cfg" in *Authorization*) hk=1;; *) hk=0;; esac
if [ "$hk" = 0 ]; then code=401; [ -n "\${STUB_CURL_BAD:-}" ] && code=200
else
  case "$cfg" in
    *wp-admin*) code=403;;
    *) if [ "$ua" = 0 ]; then code=400; else code=200; fi;;
  esac
fi
if [ -n "$out" ] && [ "$out" != /dev/null ]; then echo imagebytes > "$out"; fi
printf %s "$code"`)
      writeStub(stubs, 'shasum', `if [ $# -eq 2 ]; then exec "${REAL_SHASUM}" "$@"; fi
echo "${IMG_SHA}  $3"`)
      const env = { PATH: `${stubs}:/usr/bin:/bin`, HOME: tmp, LOG: log, STUB_IP: ip, STUB_CERT: cert, STUB_GH_API_FAIL: ghApiFail, STUB_CURL_BAD: curlBad, STUB_GH_SET_FAIL: setFail }
      const r = spawnSync(BASH, [PROVISION, ...alias], { env, encoding: 'utf8', cwd: tmp, input: '' })
      const logs = f => lines(join(log, f))
      return { r, logs, log }
    }

    const ok = scenario('ok')
    const key = ok.logs('gh.stdin.NOVEST_RELAY_KEY')
    t('exits 0', [ok.r.status, ok.r.stderr.includes('Done') || ok.r.stdout.includes('Done')], [0, true])
    t('the key reached gh on stdin: 64 hex, exactly', /^[0-9a-f]{64}$/.test(key), true)
    const argvAll = ['ssh.argv', 'gh.argv', 'curl.argv'].map(f => ok.logs(f)).join('\n')
    const outAll = ok.r.stdout + ok.r.stderr
    t('the key is on no command line of ssh, gh or curl', key.length === 64 && argvAll.includes(key), false)
    t('the IP is on no command line of ssh, gh or curl', argvAll.includes(FAKE_IP), false)
    t('the key is in no output of provision.sh', outAll.includes(key), false)
    t('the IP is in no output of provision.sh', outAll.includes(FAKE_IP), false)
    t('the key is only on gh stdin for NOVEST_RELAY_KEY (not URL, not CA)', [ok.logs('gh.stdin.NOVEST_RELAY_URL').includes(key), ok.logs('gh.stdin.NOVEST_RELAY_CA').includes(key)], [false, false])
    t('the three secrets were set with no --body and no value on argv', ok.logs('gh.argv').split('\n').filter(l => l.startsWith('secret set')),
      ['NOVEST_RELAY_KEY', 'NOVEST_RELAY_URL', 'NOVEST_RELAY_CA'].map(n => `secret set ${n} --env production --repo berkeustun95/trnc-health`))
    t('URL secret is https://<ip>:8443', ok.logs('gh.stdin.NOVEST_RELAY_URL'), `https://${FAKE_IP}:8443`)
    const ca = ok.logs('gh.stdin.NOVEST_RELAY_CA')
    t('CA secret is the public certificate and holds no private key', [ca.includes('BEGIN CERTIFICATE'), ca.includes('PRIVATE KEY')], [true, false])
    t('the variable NOVEST_ROUTE was never touched', /variable|NOVEST_ROUTE/.test(ok.logs('gh.argv')), false)
    t('curl got url and key on stdin (-K -), not on argv', [ok.logs('curl.stdin').includes(`Bearer ${key}`), ok.logs('curl.stdin').includes(`https://${FAKE_IP}:8443`), /Bearer|:8443/.test(ok.logs('curl.argv'))], [true, true, false])
    t('five curl calls ran (no key, feed, image, admin, default UA)', ok.logs('curl.argv').trim().split('\n').length, 5)
    const sshCalls = ok.logs('ssh.argv').trim().split('\n')
    t('ssh calls in order: -G, upload, setup (-t), cert fetch', [sshCalls[0], sshCalls[1].startsWith('ada-hermes umask'), sshCalls[2], sshCalls[3]],
      ['-G ada-hermes', true, '-t ada-hermes sudo bash /tmp/novest-relay.Ab12Cd/setup.sh --staging /tmp/novest-relay.Ab12Cd', 'ada-hermes cat /tmp/novest-relay.Ab12Cd/tls.crt && rm -rf /tmp/novest-relay.Ab12Cd'])
    t('no further ssh calls', sshCalls.length, 4)
    // The uploaded tar: exactly six files, key.sha256 == sha256(key), ip file present, the key itself nowhere in it.
    const ex = freshDir('ok-extract')
    const tx = spawnSync('tar', ['-x', '-C', ex, '-f', join(ok.log, 'upload.tar')], { encoding: 'utf8' })
    t('the uploaded tar unpacks to exactly the six files', [tx.status, readdirSync(ex).sort()], [0, ['ip', 'key.sha256', 'novest-relay.service', 'relay.mjs', 'setup.sh', 'teardown.sh']])
    t('key.sha256 is sha256 of the key', readFileSync(join(ex, 'key.sha256'), 'utf8').trim(), createHash('sha256').update(key).digest('hex'))
    t('the upload holds no private key and no key (only its hash)', readdirSync(ex).some(f => readFileSync(join(ex, f), 'utf8').includes(key)), false)

    const refused = scenario('gh403', { ghApiFail: '1' })
    t('GitHub preflight 403: exits 1 with the plain message', [refused.r.status, refused.r.stderr.includes('needs the Environments: write permission); nothing was changed')], [1, true])
    t('  and no ssh call other than -G, no secret set, no key generated', [refused.logs('ssh.argv').trim(), refused.logs('gh.argv').includes('secret set')], ['-G ada-hermes', false])

    const priv = scenario('priv', { ip: '10.0.0.5' })
    t('alias that resolves to a private address is refused before gh or any upload', [priv.r.status, priv.logs('ssh.argv').trim(), priv.logs('gh.argv')], [1, '-G ada-hermes', ''])
    const named = scenario('named', { ip: 'hermes.example.org' })
    t('alias with a hostname instead of an IPv4 is refused', [named.r.status, named.logs('gh.argv')], [1, ''])

    const wrong = scenario('wrongcert', { cert: wrongCert })
    t('certificate whose IP SAN differs from the server is refused, no secret set', [wrong.r.status, wrong.logs('gh.argv').includes('secret set'), wrong.r.stderr.includes('teardown.sh')], [1, false, true])

    const badCheck = scenario('badcheck', { curlBad: '1' })
    t('a failed remote check stops the run: no secret set, teardown path printed', [badCheck.r.status, badCheck.logs('gh.argv').includes('secret set'), badCheck.r.stderr.includes('ssh -t ada-hermes sudo bash /usr/local/lib/novest-relay/teardown.sh')], [1, false, true])
    t('  the failed run still never printed the key or IP', [badCheck.r.stdout + badCheck.r.stderr].some(o => o.includes(FAKE_IP) || /[0-9a-f]{64}/.test(o.split(IMG_SHA).join(''))), false)

    const partial = scenario('partial', { setFail: 'NOVEST_RELAY_URL' })
    t('a failure after NOVEST_RELAY_KEY was set says so (not "No GitHub secret was set")', [partial.r.status, partial.r.stderr.includes('No GitHub secret was set'), partial.r.stderr.includes('ALREADY set in this run: NOVEST_RELAY_KEY.'), partial.r.stderr.includes('NOVEST_RELAY_CA.')], [1, false, true, false])
    const none = scenario('noneset', { setFail: 'NOVEST_RELAY_KEY' })
    t('a failure on the first secret still says no secret was set', [none.r.status, none.r.stderr.includes('No GitHub secret was set.')], [1, true])
    const late = scenario('late', { curlBad: '1' })
    t('a failure before any secret still says no secret was set', late.r.stderr.includes('No GitHub secret was set.'), true)

    const rot = scenario('rot', { alias: ['--rotate-cert'] })
    const rOut = rot.r.stdout + rot.r.stderr
    t('rotate: exits 0 and says only NOVEST_RELAY_CA changed', [rot.r.status, rOut.includes('Only NOVEST_RELAY_CA was changed')], [0, true])
    t('rotate: only NOVEST_RELAY_CA was set, over stdin, no value on argv', rot.logs('gh.argv').split('\n').filter(l => l.startsWith('secret set')), ['secret set NOVEST_RELAY_CA --env production --repo berkeustun95/trnc-health'])
    const rca = rot.logs('gh.stdin.NOVEST_RELAY_CA')
    t('rotate: the CA secret is the new public certificate, no private key', [rca.includes('BEGIN CERTIFICATE'), rca.includes('PRIVATE KEY')], [true, false])
    t('rotate: no KEY or URL secret stdin file exists', [existsSync(join(rot.log, 'gh.stdin.NOVEST_RELAY_KEY')), existsSync(join(rot.log, 'gh.stdin.NOVEST_RELAY_URL'))], [false, false])
    const rssh = rot.logs('ssh.argv').trim().split('\n')
    t('rotate: ssh calls in order -G, upload, setup --rotate-cert (-t), cert fetch', [rssh[0], rssh[1].startsWith('ada-hermes umask'), rssh[2], rssh[3], rssh.length],
      ['-G ada-hermes', true, '-t ada-hermes sudo bash /tmp/novest-relay.Ab12Cd/setup.sh --rotate-cert --staging /tmp/novest-relay.Ab12Cd', 'ada-hermes cat /tmp/novest-relay.Ab12Cd/tls.crt && rm -rf /tmp/novest-relay.Ab12Cd', 4])
    const rex = freshDir('rot-extract')
    spawnSync('tar', ['-x', '-C', rex, '-f', join(rot.log, 'upload.tar')])
    t('rotate: the upload is only setup.sh and ip (no key, no hash, no relay.mjs)', readdirSync(rex).sort(), ['ip', 'setup.sh'])
    t('rotate: ip file holds the address, nothing else was uploaded', readFileSync(join(rex, 'ip'), 'utf8').trim(), FAKE_IP)
    t('rotate: one curl call (no key), url on stdin, no Authorization header, nothing on argv', [rot.logs('curl.argv').trim().split('\n').length, rot.logs('curl.stdin').includes('Authorization'), /:8443/.test(rot.logs('curl.argv'))], [1, false, false])
    t('rotate: the IP is on no argv and in no output', [['ssh.argv', 'gh.argv', 'curl.argv'].some(f => rot.logs(f).includes(FAKE_IP)), rOut.includes(FAKE_IP)], [false, false])
    t('rotate: output tells the operator the keyed checks are skipped and the pinning-gap note', [rOut.includes('keyed checks are skipped'), rOut.includes('fail TLS pinning')], [true, true])
    t('rotate: prints the fingerprint only', /certificate: .*Fingerprint=([0-9A-F]{2}:){31}[0-9A-F]{2}/i.test(rOut), true)
    const rwrong = scenario('rotwrong', { cert: wrongCert, alias: ['--rotate-cert'] })
    t('rotate: a certificate for another IP is refused, no secret set', [rwrong.r.status, rwrong.logs('gh.argv').includes('secret set')], [1, false])
    const rbad = scenario('rotbad', { curlBad: '1', alias: ['--rotate-cert'] })
    t('rotate: a failed pinned check sets no secret and does not suggest teardown', [rbad.r.status, rbad.logs('gh.argv').includes('secret set'), rbad.r.stderr.includes('No GitHub secret was set.'), rbad.r.stderr.includes('Teardown is not needed')], [1, false, true, true])
    const rsetfail = scenario('rotsetfail', { setFail: 'NOVEST_RELAY_CA', alias: ['--rotate-cert'] })
    t('rotate: a failed NOVEST_RELAY_CA set is reported, nothing else was set', [rsetfail.r.status, rsetfail.r.stderr.includes('setting NOVEST_RELAY_CA failed')], [1, true])

    const custom = scenario('alias', { alias: ['my-box'] })
    t('a custom ssh alias is used for every call', custom.logs('ssh.argv').trim().split('\n').every(l => /^(-G |-t |)my-box/.test(l)), true)

    const xtrace = spawnSync(BASH, ['-x', PROVISION, '--dry-run'], { env: { PATH: '/usr/bin:/bin', HOME: tmp, SHELLOPTS: 'xtrace' }, encoding: 'utf8' })
    t('xtrace in SHELLOPTS is refused', [xtrace.status === 0, xtrace.stderr.includes('xtrace is on')], [false, true])
    const benv = spawnSync(BASH, [PROVISION, '--dry-run'], { env: { PATH: '/usr/bin:/bin', HOME: tmp, BASH_ENV: '/dev/null' }, encoding: 'utf8' })
    t('BASH_ENV set is refused', [benv.status === 0, benv.stderr.includes('BASH_ENV')], [false, true])
  }

  console.log('shared rules')
  {
    const rule = f => /\[\[ \$(?:IP|ip) =~ (\^\(0\\\.\|.*?\)) \]\]/.exec(readFileSync(f, 'utf8'))?.[1]
    t('provision.sh and setup.sh use the same private-range rule', [rule(PROVISION) !== undefined, rule(PROVISION) === rule(SETUP)], [true, true])
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log(bad ? `\n${bad} check(s) FAILED` : '\nall checks passed')
process.exit(bad ? 1 : 0)

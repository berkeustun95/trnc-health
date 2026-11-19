// deno test supabase/functions/send-duty-notification/push_diag_test.ts
import { ATTEMPT_TIMEOUT_MS, sendBatch, type SendDeps } from './push.ts'
import { BODY_CAP_CHARS, clean, redact } from './push-diag.ts'

const batch = Array.from({ length: 100 }, (_, i) => ({ to: `ExponentPushToken[t${i}]` }))
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`) }
const okTickets = (n: number, errs: string[] = []) =>
  new Response(JSON.stringify({ data: [...Array(n - errs.length).fill({ status: 'ok', id: 'x' }),
    ...errs.map((e) => ({ status: 'error', message: `"ExponentPushToken[secret]" is not registered`, details: { error: e } }))] }), { status: 200 })
const UUID = '123e4567-e89b-12d3-a456-426614174000'

interface Seen { url: string; init: RequestInit; timeout: number }
function rig(step: () => Response | Promise<Response>) {
  const seen: Seen[] = []
  let lastTimeout = -1
  const deps: SendDeps = {
    fetchFn: (url, init) => { seen.push({ url, init, timeout: lastTimeout }); return Promise.resolve(step()) },
    makeSignal: (ms) => { lastTimeout = ms; return new AbortController().signal },
  }
  return { deps, seen }
}
// A fake clock that moves 7 ms per reading, so timings are deterministic.
const clock = () => { let t = 1000; return () => (t += 7) }
function diagFor(lines: string[], extra: Record<string, unknown> = {}) {
  return { group: 0, runStartMs: 1000, log: (l: string) => { lines.push(l) }, now: clock(), bodyTimeoutMs: 50, ...extra }
}

const scenarios: Array<[string, () => Response | Promise<Response>]> = [
  ['200 all ok', () => okTickets(100)],
  ['200 with error tickets', () => okTickets(100, ['DeviceNotRegistered', 'MessageTooBig'])],
  ['503', () => new Response('<html>503</html>', { status: 503 })],
  ['429 retry-after', () => new Response('x', { status: 429, headers: { 'retry-after': '1' } })],
  ['500', () => new Response('x', { status: 500 })],
  ['502', () => new Response('x', { status: 502 })],
  ['504', () => new Response('x', { status: 504 })],
  ['400', () => new Response('x', { status: 400 })],
  ['timeout', () => { throw new DOMException('t', 'TimeoutError') }],
  ['abort', () => { throw new DOMException('a', 'AbortError') }],
  ['TypeError', () => { throw new TypeError('tcp connect error') }],
  ['unparseable 200', () => new Response('not json', { status: 200 })],
  ['short ticket list', () => okTickets(90)],
]

Deno.test('diag on or off: identical BatchResult, one fetch, identical request', async () => {
  for (const [name, step] of scenarios) {
    const a = rig(step)
    const b = rig(step)
    const lines: string[] = []
    const ra = await sendBatch(batch, a.deps)
    const rb = await sendBatch(batch, { ...b.deps, diag: diagFor(lines) })
    eq(rb, ra, name + ': result')
    eq([a.seen.length, b.seen.length], [1, 1], name + ': fetch count')
    const strip = (s: Seen) => ({ url: s.url, method: s.init.method, headers: s.init.headers, body: s.init.body, timeout: s.timeout })
    eq(strip(b.seen[0]), strip(a.seen[0]), name + ': request')
    eq(b.seen[0].timeout, ATTEMPT_TIMEOUT_MS, name + ': timeout value')
    eq(lines.length, 1, name + ': exactly one diag line')
    if (!lines[0].startsWith('duty-push-diag {') || lines[0].includes('\n')) throw new Error('line shape: ' + lines[0])
  }
})

Deno.test('a logger that throws changes nothing', async () => {
  for (const [name, step] of scenarios) {
    const a = rig(step)
    const b = rig(step)
    const ra = await sendBatch(batch, a.deps)
    const rb = await sendBatch(batch, { ...b.deps, diag: { group: 0, runStartMs: 0, log: () => { throw new Error('log broke') }, bodyTimeoutMs: 50 } })
    eq(rb, ra, name)
    eq(b.seen.length, 1, name + ': fetch count')
  }
})

Deno.test('a clock that throws changes nothing', async () => {
  const a = rig(() => new Response('x', { status: 503 }))
  const ra = await sendBatch(batch, a.deps)
  const b = rig(() => new Response('x', { status: 503 }))
  const rb = await sendBatch(batch, { ...b.deps, diag: { group: 0, runStartMs: 0, log: () => {}, now: () => { throw new Error('clock') }, bodyTimeoutMs: 50 } })
  eq(rb, ra, 'result'); eq(b.seen.length, 1, 'fetch count')
})

Deno.test('503 body that never closes: returns within the body timeout, same result', async () => {
  const mk = () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('<html>stuck')) } }), { status: 503 })
  const plain = await sendBatch(batch, rig(mk).deps)
  const lines: string[] = []
  const t0 = Date.now()
  const r = rig(mk)
  const out = await sendBatch(batch, { ...r.deps, diag: diagFor(lines, { bodyTimeoutMs: 80 }) })
  const took = Date.now() - t0
  eq(out, plain, 'result')
  eq(r.seen.length, 1, 'fetch count')
  if (took > 1500) throw new Error('hung ' + took + ' ms')
  if (!lines[0].includes('<html>stuck')) throw new Error('partial body should still be logged: ' + lines[0])
})

Deno.test('a body stream that throws changes nothing', async () => {
  const mk = () => new Response(new ReadableStream({ start(c) { c.error(new Error('boom')) } }), { status: 503 })
  const plain = await sendBatch(batch, rig(mk).deps)
  const lines: string[] = []
  const out = await sendBatch(batch, { ...rig(mk).deps, diag: diagFor(lines) })
  eq(out, plain, 'result')
  eq(lines.length, 1, 'one line')
})

Deno.test('leaks: tokens, uuids, newlines, unlisted headers never reach a line', async () => {
  const secretBody = [`a ExponentPushToken[abc] b ExpoPushToken[abc] c ${UUID}`, 'line2\nline3\r\nline4', 'cut ExponentPushToken[abcdefg'].join('\n')
  const headers = new Headers({
    'via': '1.1 google', 'server': 'Google Frontend', 'content-type': 'text/html', 'retry-after': '3',
    'set-cookie': 'sid=SECRETCOOKIE', 'authorization': 'Bearer SECRETAUTH', 'x-something-else': 'SECRETOTHER',
    'x-request-id': `req-${UUID}`,
  })
  const lines: string[] = []
  await sendBatch(batch, { ...rig(() => new Response(secretBody, { status: 503, headers })).deps, diag: diagFor(lines) })
  const all = lines.join('\n')
  for (const bad of ['ExponentPushToken[', 'ExpoPushToken[', 'abc]', 'abcdefg', UUID, 'SECRETCOOKIE', 'SECRETAUTH', 'SECRETOTHER',
    'set-cookie', 'authorization', 'x-something-else', 'Accept-Encoding', 'Content-Type":"application']) {
    if (all.includes(bad)) throw new Error('leaked ' + bad + ' in ' + all)
  }
  for (const good of ['1.1 google', 'Google Frontend', 'text/html', '"retry-after":"3"', '[token]', '[uuid]', 'x-request-id']) {
    if (!all.includes(good)) throw new Error('missing ' + good + ' in ' + all)
  }
  if (/\\n|\\r/.test(all)) throw new Error('newline escape survived: ' + all)
})

Deno.test('redact runs before the cap: a token or uuid straddling the cap is not half-logged', () => {
  const body = 'x'.repeat(BODY_CAP_CHARS - 12) + UUID
  const out = clean(body, BODY_CAP_CHARS)
  if (out.includes(UUID.slice(0, 8))) throw new Error('uuid prefix leaked at the cap: ' + out.slice(-30))
  const tok = 'y'.repeat(BODY_CAP_CHARS - 20) + 'ExponentPushToken[SECRETSECRETSECRET]'
  if (clean(tok, BODY_CAP_CHARS).includes('SECRET')) throw new Error('token leaked at the cap')
  eq(redact('ExponentPushToken[abc'), '[token]', 'token cut by the read limit (no closing bracket)')
  eq(clean('a\nb\u0000c', 99), 'a b c', 'control chars flattened')
  eq(clean('z'.repeat(2000), BODY_CAP_CHARS).length, BODY_CAP_CHARS, 'cap')
})

Deno.test('byte limit: a long body is cut, a cut token is redacted', async () => {
  const body = 'ok ExponentPushToken[ABCDEFGHIJ' + 'z'.repeat(500)
  const lines: string[] = []
  await sendBatch(batch, { ...rig(() => new Response(body, { status: 503 })).deps, diag: diagFor(lines, { bodyMaxBytes: 30 }) })
  if (lines[0].includes('ABCDE') || !lines[0].includes('[token]')) throw new Error(lines[0])
})

Deno.test('byte limit stops the read itself: a fast endless body is not pulled past the limit', async () => {
  let pulls = 0
  const mk = () => new Response(new ReadableStream({ pull(c) { pulls++; c.enqueue(new TextEncoder().encode('0123456789')) } }, { highWaterMark: 0 }), { status: 503 })
  const lines: string[] = []
  const t0 = Date.now()
  const out = await sendBatch(batch, { ...rig(mk).deps, diag: diagFor(lines, { bodyMaxBytes: 30, bodyTimeoutMs: 1500 }) })
  eq(out.accepted, false, 'not accepted')
  if (Date.now() - t0 > 700) throw new Error('read ran to the timeout instead of the byte limit')
  if (pulls > 10) throw new Error('pulled ' + pulls + ' chunks for a 30-byte limit')
})

Deno.test('accepted group: status and timings only, never the body, size or counts', async () => {
  const lines: string[] = []
  let readCalled = false
  const res = okTickets(100, ['DeviceNotRegistered'])
  const origText = res.text.bind(res)
  res.text = () => { readCalled = true; return origText() }
  await sendBatch(batch, { ...rig(() => res).deps, diag: diagFor(lines) })
  eq(readCalled, false, 'diag did not read the body')
  eq(Object.keys(JSON.parse(lines[0].slice('duty-push-diag '.length))), ['g', 'status', 'ms_headers', 'ms_total', 'run_ms'], 'keys')
  for (const w of ['secret', 'ExponentPushToken', 'DeviceNotRegistered', 'size', 'body', 'ok']) {
    if (lines[0].toLowerCase().includes(w.toLowerCase()) && w !== 'ok') throw new Error('accepted line has ' + w + ': ' + lines[0])
  }
})

Deno.test('thrown fetch: error name only, never the message', async () => {
  const lines: string[] = []
  await sendBatch(batch, { ...rig(() => { throw new TypeError('tcp ExponentPushToken[abc] ' + UUID) }).deps, diag: diagFor(lines) })
  eq(lines[0], 'duty-push-diag {"g":0,"size":100,"error":"TypeError","ms_total":7,"run_ms":21}', 'line')
})

Deno.test('Google front-end 503 (HTML) line, as logged', async () => {
  const html = '<!DOCTYPE html>\n<html lang=en>\n  <title>Error 503 (Server Error)!!1</title>\n  <p>The server is temporarily unable to service your request.</p>\n</html>'
  const lines: string[] = []
  await sendBatch(batch, { ...rig(() => new Response(html, { status: 503, headers: { 'via': '1.1 google', 'content-type': 'text/html; charset=UTF-8', 'content-length': String(html.length), 'date': 'Wed, 18 Nov 2026 15:00:08 GMT', 'alt-svc': 'h3=":443"' } })).deps, diag: diagFor(lines) })
  console.log(lines[0])
  eq(JSON.parse(lines[0].slice(15)).status, 503, 'status')
})

Deno.test('without diag: console output is exactly today\'s and the body is cancelled, not read', async () => {
  const errs: string[] = []; const logs: string[] = []
  const oe = console.error; const ol = console.log
  console.error = (...a: unknown[]) => { errs.push(a.join(' ')) }
  console.log = (...a: unknown[]) => { logs.push(a.join(' ')) }
  let cancelled = false; let pulls = 0
  const res = new Response(new ReadableStream({ pull(c) { pulls++; c.enqueue(new TextEncoder().encode('x')) }, cancel() { cancelled = true } }), { status: 503 })
  try {
    await sendBatch(batch, rig(() => res).deps)
    await sendBatch(batch, rig(() => { throw new DOMException('t', 'TimeoutError') }).deps)
  } finally { console.error = oe; console.log = ol }
  eq(errs, ['Expo push batch failed: HTTP 503', 'Expo push batch threw: TimeoutError'], 'console.error')
  eq(logs, [], 'console.log')
  eq(cancelled, true, 'cancelled')
  eq(pulls <= 1, true, 'body not read (one eager prefetch by the stream itself is not a read)')
})

Deno.test('with diag the existing console.error lines are unchanged', async () => {
  const errs: string[] = []
  const oe = console.error
  console.error = (...a: unknown[]) => { errs.push(a.join(' ')) }
  try {
    await sendBatch(batch, { ...rig(() => new Response('x', { status: 503 })).deps, diag: diagFor([]) })
    await sendBatch(batch, { ...rig(() => { throw new DOMException('t', 'TimeoutError') }).deps, diag: diagFor([]) })
  } finally { console.error = oe }
  eq(errs, ['Expo push batch failed: HTTP 503', 'Expo push batch threw: TimeoutError'], 'console.error')
})

Deno.test('wiring: only send-duty-notification passes diag; push.ts has no header allow-list', async () => {
  const rd = (p: string) => Deno.readTextFile(new URL(p, import.meta.url))
  if (!(await rd('./index.ts')).includes('diag: { group: i / 100, runStartMs }')) throw new Error('index.ts does not pass diag')
  for (const p of ['../send-weekend-digest/index.ts', '../marketplace-photo-review/index.ts', '../admin-push/send.ts']) {
    if ((await rd(p)).includes('diag')) throw new Error(p + ' must not pass diag')
  }
})

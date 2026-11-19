// Opt-in diagnostics for a push batch that Expo did not accept (2026-11-18: HTTP 503 on the first group of the weekday
// run). LOGGING ONLY: nothing here may change a BatchResult, a request, or how long the run waits beyond the bounded body
// read. No remote imports. Every public function swallows its own errors.
// Privacy: never a push token, user id or total in a line. Redaction runs on the FULL read text, BEFORE the cap.
// An accepted (200) response is never read: its tickets embed tokens on DeviceNotRegistered.

export const BODY_MAX_BYTES = 8 * 1024
export const BODY_CAP_CHARS = 512
export const HEADER_CAP_CHARS = 200
export const BODY_READ_TIMEOUT_MS = 2_000
export const HEADER_ALLOW = ['via', 'server', 'date', 'retry-after', 'content-type', 'content-length', 'x-cloud-trace-context', 'x-request-id', 'cf-ray'] as const

export interface DiagDeps {
  group: number
  runStartMs: number
  log?: (line: string) => void
  now?: () => number
  bodyTimeoutMs?: number
  bodyMaxBytes?: number
}

const TOKEN_RE = /Expo(nent)?PushToken\[[^\]]*\]?/g
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
// deno-lint-ignore no-control-regex
const CTRL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g
const KIND_RE = /^[A-Za-z0-9_]{1,64}$/

export function redact(s: string): string {
  return s.replace(TOKEN_RE, '[token]').replace(UUID_RE, '[uuid]')
}
// Redact first on everything read, then flatten, then cap.
export function clean(s: string, cap: number): string {
  return redact(s).replace(CTRL_RE, ' ').slice(0, cap)
}

export function allowedHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of HEADER_ALLOW) {
    try {
      const v = h.get(name)
      if (v !== null) out[name] = clean(v, HEADER_CAP_CHARS)
    } catch { /* skip this header */ }
  }
  return out
}

// At most maxBytes, and at most timeoutMs: a body that never ends cannot hang the run. Always cancels the stream.
export async function readBodyBounded(res: Response, timeoutMs: number, maxBytes: number): Promise<string> {
  const body = res.body
  if (!body) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs) })
  const pump = (async () => {
    while (total < maxBytes) {
      const { done, value } = await reader.read()
      if (done) return
      if (value) { chunks.push(value); total += value.byteLength }
    }
  })()
  pump.catch(() => {})
  try {
    await Promise.race([pump, deadline])
  } finally {
    clearTimeout(timer)
    reader.cancel().catch(() => {})
  }
  const all = new Uint8Array(Math.min(total, maxBytes))
  let at = 0
  for (const c of chunks) {
    const part = c.subarray(0, Math.max(0, all.length - at))
    all.set(part, at)
    at += part.length
  }
  return new TextDecoder().decode(all)
}

export interface Tracker {
  headers(): void
  nonAccepted(res: Response, size: number): Promise<void>
  accepted(res: Response): void
  thrown(e: unknown, size: number): void
}

export function startDiag(dg: DiagDeps | undefined): Tracker | null {
  if (!dg) return null
  const now = dg.now ?? Date.now
  const emit = (o: Record<string, unknown>) => {
    try { (dg.log ?? console.log)('duty-push-diag ' + JSON.stringify(o)) } catch { /* logging never breaks a send */ }
  }
  const since = (a: number) => { try { return Math.round(now() - a) } catch { return -1 } }
  let t0 = 0
  let msHeaders = 0
  try { t0 = now() } catch { /* timings are best effort */ }
  return {
    headers() { msHeaders = since(t0) },
    async nonAccepted(res, size) {
      try {
        let body: string
        try {
          body = clean(await readBodyBounded(res, dg.bodyTimeoutMs ?? BODY_READ_TIMEOUT_MS, dg.bodyMaxBytes ?? BODY_MAX_BYTES), BODY_CAP_CHARS)
        } catch { body = '[unreadable]' }
        emit({ g: dg.group, size, status: res.status, ms_headers: msHeaders, ms_total: since(t0), run_ms: since(dg.runStartMs),
          headers: allowedHeaders(res.headers), body })
      } catch { /* */ }
    },
    accepted(res) {
      try { emit({ g: dg.group, status: res.status, ms_headers: msHeaders, ms_total: since(t0), run_ms: since(dg.runStartMs) }) } catch { /* */ }
    },
    thrown(e, size) {
      try {
        const name = e instanceof Error && KIND_RE.test(e.name) ? e.name : 'other'
        emit({ g: dg.group, size, error: name, ms_total: since(t0), run_ms: since(dg.runStartMs) })
      } catch { /* */ }
    },
  }
}

// The data-jobs calls an edge function makes: ask the pause switch before a scheduled run, record the outcome after.
// FAIL-OPEN by design: a gate that errors, times out or is missing (404 / PGRST202 before 20261210 is applied) says
// 'run'; a record that fails is swallowed. Neither can change the caller's response. One short attempt, no retries.
// Never logs a response body, a URL or a key; only fixed codes.
const TIMEOUT_MS = 5000
const CLASS = /^[A-Za-z0-9_]{1,64}$/

function rpcOf({ url, key, fetchImpl = fetch, timeoutMs = TIMEOUT_MS, log = () => {} }) {
  return async (fn, args) => {
    if (!url || !key) { log('data_jobs_not_configured'); return { ok: false } }
    try {
      const res = await fetchImpl(`${url.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) { log(`data_jobs_${fn}_status_${res.status}`); return { ok: false } }
      let body = null
      try { body = await res.json() } catch { /* no body */ }
      return { ok: true, body }
    } catch { log(`data_jobs_${fn}_unreachable`); return { ok: false } }
  }
}

// 'paused' only on an explicit 'paused' answer; everything else is 'run'.
export async function dataJobGate(cfg, job) {
  const r = await rpcOf(cfg)('data_job_gate', { p_job: job, p_source: 'edge', p_run_ref: null })
  return r.ok && r.body === 'paused' ? 'paused' : 'run'
}

// outcome 'ok' | 'failed'; errorClass is a fixed vocabulary word (anything else is dropped to 'unknown').
export async function recordDataJobRun(cfg, job, outcome, errorClass, startedAtMs) {
  const failed = outcome === 'failed'
  const args = {
    p_job: job,
    p_outcome: failed ? 'failed' : 'ok',
    p_error_class: failed ? (CLASS.test(errorClass ?? '') ? errorClass : 'unknown') : null,
    p_run_ref: null,
    p_source: 'edge',
    p_started_at: Number.isFinite(startedAtMs) ? new Date(startedAtMs).toISOString() : null,
  }
  await rpcOf(cfg)('record_data_job_run', args)
}

// ─── Contact-tap outbox: the queue behind logContactEvent (20261084) ─────────
//
// Pure logic, no React Native imports, so scripts/check-contact-outbox.mjs can run it under Node.
// A tap is recorded with a RANDOM per-tap id, kept in a small persisted queue, sent at once, and
// re-sent (flush) when the app comes back to the foreground or starts. The server's primary key
// makes a re-send harmless: an id it already has comes back as a conflict, which counts as
// delivered. So a tap is counted exactly once, however many times it is sent.
//
// RULE ONE (logContactEvent.js) holds: record() returns synchronously. Storage and network work
// happen afterwards and are never awaited by the caller, so the call / page opens at once.
//
// What a send can answer:
//   'delivered' · 'duplicate' (the server has it)  → remove from the queue
//   'drop'  (un-sendable: a CHECK or permission refusal) → remove, never retry, so one bad tap
//           cannot pin the queue
//   'retry' (offline, timed out, 5xx)               → keep; the next flush tries again
// The queue holds at most MAX_EVENTS (oldest dropped first) and nothing older than MAX_AGE_MS.
// created_at is stamped by the SERVER on arrival, so a tap re-sent later is dated when it landed.

export const OUTBOX_KEY = '@ada_contact_outbox_v1'
export const MAX_EVENTS = 50
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function createOutbox({ send, storage, uuid, now = () => Date.now(), warn = () => {} }) {
  let queue = []                 // [{ id, module, entity_id, action, region, t }] oldest first
  let loaded = false
  let loading = null
  let flushing = false
  const inFlight = new Set()

  function trim() {
    const cutoff = now() - MAX_AGE_MS
    queue = queue.filter(e => e && e.t >= cutoff)
    if (queue.length > MAX_EVENTS) queue = queue.slice(queue.length - MAX_EVENTS)
  }

  // Never writes before the stored queue has been read: a write before load would erase taps
  // queued in an earlier session. load() ends by writing the merged queue.
  function persist() {
    trim()
    if (!loaded) return Promise.resolve()
    const snapshot = JSON.stringify(queue)
    return Promise.resolve().then(() => storage.setItem(OUTBOX_KEY, snapshot)).catch(warn)
  }

  function load() {
    if (loaded) return Promise.resolve()
    if (!loading) {
      loading = Promise.resolve()
        .then(() => storage.getItem(OUTBOX_KEY))
        .then(raw => {
          let stored = []
          try { stored = JSON.parse(raw || '[]') } catch { stored = [] }
          const byId = new Map()
          for (const e of [...(Array.isArray(stored) ? stored : []), ...queue]) if (e && e.id) byId.set(e.id, e)
          queue = [...byId.values()].sort((a, b) => a.t - b.t)
        })
        .catch(warn)
        .then(() => { loaded = true; return persist() })
    }
    return loading
  }

  async function sendOne(e) {
    if (inFlight.has(e.id)) return 'busy'
    inFlight.add(e.id)
    try {
      let outcome
      try {
        outcome = await send({ id: e.id, module: e.module, entity_id: e.entity_id, action: e.action, region: e.region })
      } catch (err) { warn(err); outcome = 'retry' }
      if (outcome === 'delivered' || outcome === 'duplicate' || outcome === 'drop') {
        queue = queue.filter(x => x.id !== e.id)
        await persist()
      }
      return outcome
    } finally {
      inFlight.delete(e.id)
    }
  }

  // Synchronous by contract (RULE ONE). Returns the tap's id.
  function record(module, entityId, action, region = null) {
    const e = { id: uuid(), module, entity_id: entityId, action, region: region || null, t: now() }
    queue.push(e)
    trim()
    Promise.resolve()
      .then(() => sendOne(e))
      .catch(warn)
    load().catch(warn)
    return e.id
  }

  // Re-send everything queued, one at a time; stop at the first 'retry' (still offline).
  async function flush() {
    if (flushing) return
    flushing = true
    try {
      await load()
      trim()
      await persist()
      for (const e of [...queue]) {
        const r = await sendOne(e)
        if (r === 'retry') break
      }
    } catch (err) {
      warn(err)
    } finally {
      flushing = false
    }
  }

  return { record, flush, pending: () => queue.slice() }
}

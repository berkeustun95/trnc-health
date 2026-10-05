#!/usr/bin/env node
// The contact-tap outbox (utils/contactOutbox.js), run for real against a fake server that
// enforces the PRIMARY KEY the way contact_events does since 20261084: a second insert of the
// same id is a conflict ('duplicate'). Proves, without a phone or the database:
//   a tap made offline is queued and arrives EXACTLY ONCE after reconnecting; a re-send the server
//   already has is not counted twice; RULE ONE (record() is synchronous, even with storage and
//   network hung); the 50-event cap, the 7-day age limit, dropping an un-sendable tap, and the
//   cold-start merge (a tap made before the stored queue loads does not erase it).
//   node scripts/check-contact-outbox.mjs
import { createOutbox, OUTBOX_KEY, MAX_EVENTS, MAX_AGE_MS } from '../utils/contactOutbox.js'

let bad = 0
const t = (label, ok, got) => { if (!ok) bad++; console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : `   (got ${got})`}`) }
const tick = () => new Promise(r => setTimeout(r, 0))
const settle = async () => { for (let i = 0; i < 20; i++) await tick() }

function world({ online = true, stored = null } = {}) {
  const server = new Map()        // id -> row (the PRIMARY KEY)
  const store = new Map(stored ? [[OUTBOX_KEY, JSON.stringify(stored)]] : [])
  let clock = 1_000_000_000_000, n = 0
  const w = {
    server, store, online, inserts: 0, refuse: new Set(),
    storage: { getItem: async k => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v) } },
    now: () => clock, advance: ms => { clock += ms },
    uuid: () => `id-${++n}`,
    send: async row => {
      if (!w.online) return 'retry'
      w.inserts++
      if (w.refuse.has(row.action)) return 'drop'
      if (server.has(row.id)) return 'duplicate'
      server.set(row.id, row); return 'delivered'
    },
  }
  return w
}
const make = w => createOutbox({ send: w.send, storage: w.storage, uuid: w.uuid, now: w.now })
const stored = w => JSON.parse(w.store.get(OUTBOX_KEY) || '[]')

// 1. Offline tap → queued and persisted, nothing on the server; reconnect + foreground → exactly once.
{
  const w = world({ online: false }); const ob = make(w)
  ob.record('hotels', 'h1', 'call', 'kyrenia'); await settle()
  t('offline: tap is queued', ob.pending().length === 1, ob.pending().length)
  t('offline: queue is persisted', stored(w).length === 1, stored(w).length)
  t('offline: nothing reached the server', w.server.size === 0, w.server.size)
  w.online = true; await ob.flush(); await settle()
  t('reconnect: the tap arrived', w.server.size === 1, w.server.size)
  t('reconnect: queue emptied (memory + storage)', ob.pending().length === 0 && stored(w).length === 0, `${ob.pending().length}/${stored(w).length}`)
  await ob.flush(); await ob.flush(); await settle()
  t('more flushes: still counted exactly once', w.server.size === 1, w.server.size)
}
// 2. A re-send the server already has (insert landed, the reply was lost) is NOT counted twice.
{
  const w = world()
  const realSend = w.send
  let first = true
  w.send = async row => { const r = await realSend(row); if (first) { first = false; return 'retry' } return r }   // landed, reply lost
  const ob2 = createOutbox({ send: row => w.send(row), storage: w.storage, uuid: w.uuid, now: w.now })
  ob2.record('hotels', 'h2', 'book', null); await settle()
  t('reply lost: server has it, phone still queues it', w.server.size === 1 && ob2.pending().length === 1, `${w.server.size}/${ob2.pending().length}`)
  await ob2.flush(); await settle()
  t('re-send: server answers duplicate → removed from the queue', ob2.pending().length === 0, ob2.pending().length)
  t('re-send: the server still counts it ONCE', w.server.size === 1, w.server.size)
  t('re-send: the same id was sent twice', w.inserts === 2, w.inserts)
}
// 3. RULE ONE: record() returns synchronously even if storage and the network never answer.
{
  const hang = () => new Promise(() => {})
  const ob = createOutbox({ send: hang, storage: { getItem: hang, setItem: hang }, uuid: () => 'x', now: () => 1 })
  const t0 = Date.now(); const id = ob.record('towing', 't1', 'call', null)
  t('RULE ONE: record() is synchronous with storage + network hung', id === 'x' && Date.now() - t0 < 50, Date.now() - t0)
}
// 4. Cap and age.
{
  const w = world({ online: false }); const ob = make(w)
  for (let i = 0; i < MAX_EVENTS + 1; i++) ob.record('hotels', `h${i}`, 'maps', null)
  await settle()
  t(`cap: ${MAX_EVENTS + 1} offline taps keep the newest ${MAX_EVENTS}`, ob.pending().length === MAX_EVENTS && ob.pending()[0].entity_id === 'h1', `${ob.pending().length}, first ${ob.pending()[0]?.entity_id}`)
  w.advance(MAX_AGE_MS + 1); w.online = true; await ob.flush(); await settle()
  t('age: taps older than 7 days are dropped, never sent', w.server.size === 0 && ob.pending().length === 0, `${w.server.size}/${ob.pending().length}`)
}
// 5. An un-sendable tap (a CHECK refusal) is dropped, not retried forever; the next one still goes.
{
  const w = world(); w.refuse.add('bogus'); const ob = make(w)
  ob.record('hotels', 'h1', 'bogus', null); ob.record('hotels', 'h2', 'call', null); await settle()
  await ob.flush(); await settle()
  t('drop: refused tap removed, the good one delivered', ob.pending().length === 0 && w.server.size === 1, `${ob.pending().length}/${w.server.size}`)
}
// 6. Cold start: a tap made before the stored queue loads must not erase it.
{
  const old = [{ id: 'old-1', module: 'pets', entity_id: 'p1', action: 'website', region: null, t: 1_000_000_000_000 - 1000 }]
  const w = world({ online: false, stored: old }); const ob = make(w)
  ob.record('hotels', 'h1', 'call', null); await settle()
  t('cold start: stored tap kept + new tap added', ob.pending().length === 2 && stored(w).length === 2, `${ob.pending().length}/${stored(w).length}`)
  w.online = true; await ob.flush(); await settle()
  t('cold start: both delivered once', w.server.size === 2 && ob.pending().length === 0, `${w.server.size}/${ob.pending().length}`)
}
console.log(bad ? `\n  ${bad} failure(s).` : '\n  contact outbox: OK')
process.exit(bad ? 1 : 0)

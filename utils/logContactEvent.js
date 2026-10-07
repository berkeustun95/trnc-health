import { AppState } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase'
import { createOutbox } from './contactOutbox'

// ─── Anonymous contact-tap counter — the app-wide seam ───────────────────────
//
// Records that SOMEONE tapped through to contact a listed firm. Towing is the pilot and
// the only caller today; Garages, Home Services, Beauty and Transportation all have call
// buttons and will want this. Adding them is adding call sites — the table is already
// polymorphic (module, entity_id), so no migration is involved.
// Schema, RLS and the reporting view: supabase/migrations/20260910_contact_events.sql.
//
// ─── RULE ONE: THIS MUST NEVER COST SOMEONE THEIR PHONE CALL ─────────────────
//
// On a roadside with one bar of signal, an analytics write that hangs must not delay the
// tel: link. So: nothing is awaited, nothing is returned, and NOTHING CAN THROW. The
// try/catch is not defensive padding — this function is called on the line BEFORE
// Linking.openURL, so a synchronous throw here means the call never happens. A dropped
// metric is nothing; a dropped emergency call is the whole product failing.
//
// Since 20261084 a tap made with no signal is QUEUED on the phone and re-sent later (THE OUTBOX,
// below), so the counts are exact except for taps on a phone that never opens ADA again within
// 7 days, or beyond 50 queued taps. Delayed taps are dated when they ARRIVE (server created_at).
//
// ─── RULE TWO: NO IDENTIFIER, EVER ──────────────────────────────────────────
//
// No user id, no device id, no session id. (The per-tap id of 20261084 is a fresh random UUID per
// TAP, never reused, so it cannot link two rows: it is a dedupe key, not an identifier.) Someone calling a tow truck at 3am is not a
// data point that should be attached to a person, and the metric wanted is a COUNT, not
// a list. Do not "just add" an install id to make dedup possible: dedup already happens
// at query time by collapsing each firm-minute (see contact_events_monthly), and any
// column that lets two rows be recognised as the same origin turns this from a counter
// into a behavioural log. `region` is safe precisely because it does not recur.
//
// ─── THE TWO WAYS THIS SILENTLY LOGS NOTHING ────────────────────────────────
//
// Both produce zero rows, no error, no crash — and the natural conclusion is "nobody
// taps call", which is indistinguishable from real low demand. Neither is theoretical;
// they are why the `.then()` and the missing `.select()` below are load-bearing:
//
//  1. supabase-js query builders are LAZY THENABLES. `supabase.from(x).insert(y)` builds
//     an object and sends NOTHING; the fetch is constructed inside .then() (see
//     PostgrestBuilder.then in @supabase/postgrest-js). Dropping the .then() below turns
//     this whole file into an expensive no-op.
//  2. Chaining .select() onto the insert asks PostgREST to return the row, which needs
//     SELECT privilege the client deliberately does not have. The insert then fails —
//     and fire-and-forget swallows it. NEVER add .select() here.
//
// Rows in the table are the only proof this works. See BLOCK V10 of
// supabase/verify_contact_events.sql for the eight-surface device pass.

// ─── THE OUTBOX (20261084, 2026-10-05) ───────────────────────────────────────
//
// A tap used to be one fire-and-forget insert, aborted after TIMEOUT_MS and swallowed: a tap
// whose request had not gone out before the user left for the dialer / browser / map could
// vanish. Now each tap gets a RANDOM per-tap id (never derived from the device or the user, so
// RULE TWO stands), is queued on the phone (utils/contactOutbox.js), sent at once, and re-sent
// on app foreground and start until the server confirms it. The primary key makes a re-send
// harmless (409 = already delivered), so every tap is counted exactly once. Nothing here is
// awaited by the caller: RULE ONE stands.

// Bounds one SEND, never the user. A send that times out stays queued and is retried later.
const TIMEOUT_MS = 4000

function newId() {
  try {
    const Crypto = require('expo-crypto')
    if (typeof Crypto?.randomUUID === 'function') return Crypto.randomUUID()
  } catch { /* fall through */ }
  // RFC 4122 v4 shape from Math.random: only reached if expo-crypto is missing. Random per tap.
  const h = '0123456789abcdef'
  let s = ''
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-'
    else if (i === 14) s += '4'
    else if (i === 19) s += h[(Math.random() * 4) | 8]
    else s += h[(Math.random() * 16) | 0]
  }
  return s
}

const warn = e => { if (__DEV__) console.warn('[logContactEvent]', e?.message || e) }

// One insert. NEVER add .select() (see THE TWO WAYS above): it would need a SELECT privilege the
// client does not have, and the insert would fail.
async function send(row) {
  let controller = null
  let timer = null
  if (typeof AbortController === 'function') {
    controller = new AbortController()
    timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  }
  try {
    let q = supabase.from('contact_events').insert(row)
    if (controller) q = q.abortSignal(controller.signal)
    const res = await q
    if (!res?.error) return 'delivered'
    if (res.error.code === '23505' || res.status === 409) return 'duplicate'
    // Refused for good (a CHECK, a permission): retrying cannot help and would pin the queue.
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429 && res.status !== 401) {
      warn(new Error(`insert refused (${res.status} ${res.error.code}): ${res.error.message}`))
      return 'drop'
    }
    return 'retry'
  } catch (e) {
    return 'retry'   // offline, aborted, timed out
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const outbox = createOutbox({ send, storage: AsyncStorage, uuid: newId, warn })

// Re-send what is queued when the app comes back to the foreground, and shortly after start.
try {
  AppState.addEventListener('change', s => { if (s === 'active') outbox.flush() })
  setTimeout(() => outbox.flush(), 2000)
} catch (e) { warn(e) }

export function logContactEvent(module, entityId, action, region = null) {
  try {
    // entityId is NOT NULL in the table; a null here would be a rejected round-trip.
    if (!module || !entityId || !action) return
    outbox.record(module, entityId, action, region)
  } catch (e) {
    warn(e)
  }
}

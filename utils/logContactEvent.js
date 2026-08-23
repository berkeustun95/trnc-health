import { supabase } from '../lib/supabase'

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
// The cost of that guarantee is that the counts are a FLOOR, not a measurement — taps
// made with no signal are simply absent, and that bias falls hardest on exactly the
// roadside-at-night case towing exists for. Quote "at least 47", never "47".
//
// ─── RULE TWO: NO IDENTIFIER, EVER ──────────────────────────────────────────
//
// No user id, no device id, no session id. Someone calling a tow truck at 3am is not a
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

const noop = () => {}

// Bounds the SOCKET, never the user — the caller has already dialled by the time this
// fires. Without it a request on a dying connection can sit open for RN's fetch default,
// which is no timeout at all.
const TIMEOUT_MS = 4000

export function logContactEvent(module, entityId, action, region = null) {
  try {
    // entityId is NOT NULL in the table; a null here would be a rejected round-trip on a
    // connection we just said we cannot spare.
    if (!module || !entityId || !action) return

    let signal
    let done = noop
    // AbortController is present in RN 0.81, but this file is the one place in the app
    // where a ReferenceError would cost a phone call — so it is checked, not assumed.
    if (typeof AbortController === 'function') {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      signal = controller.signal
      done = () => clearTimeout(timer)
    }

    let q = supabase
      .from('contact_events')
      .insert({ module, entity_id: entityId, action, region: region || null })
    if (signal) q = q.abortSignal(signal)

    // BOTH handlers, and no .select(). The second handler is what makes an aborted or
    // network-failed write a no-op instead of an unhandled rejection.
    q.then(
      res => {
        done()
        // Production stays silent by design. In development the same silence is a
        // liability — it is what would let a broken call site survive to the OTA — so
        // surface it exactly where someone can act on it.
        if (__DEV__ && res && res.error) {
          console.warn('[logContactEvent] insert failed:', res.error.message)
        }
      },
      err => {
        done()
        if (__DEV__ && err?.name !== 'AbortError') {
          console.warn('[logContactEvent] insert threw:', err?.message || err)
        }
      },
    )
  } catch (e) {
    // Deliberately swallowed. Reaching here means something upstream is broken (no
    // client, no network stack); the tel: link on the next line still has to fire.
    if (__DEV__) console.warn('[logContactEvent] threw synchronously:', e?.message || e)
  }
}

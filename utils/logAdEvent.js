import { supabase } from '../lib/supabase'

// ─── Anonymous ad counters — views and taps, attached to nobody ──────────────
//
// Calls bump_ad_counter(), a SECURITY DEFINER function that adds 1 to view_count or
// tap_count on one active ad_banners row. That RPC is the ONLY write path the app has on
// that table: the client is deliberately never granted UPDATE, so there is no way from
// here to set a counter, decrement one, or touch any other column.
// Schema and the function: supabase/migrations/20261008_ad_banners.sql.
//
// ─── RULE ONE: NO IDENTIFIER, EVER ──────────────────────────────────────────
//
// No user id, no device id, no session id, no install id, no IP, no dedup key. The
// function neither takes one nor looks one up. This is the same contract
// utils/logContactEvent.js is written against and it exists for the same reason: ADA keeps
// usage data off Supabase given EU hosting and declared 13-17 year old users, and the
// metric wanted here is a COUNT, not a list.
//
// Do not "just add" an install id to make per-person dedup possible. The view dedup below
// is per PROCESS and lives in memory, which is why it leaves no trace; any column that
// lets two increments be recognised as the same origin turns a counter into a behavioural
// log, and no amount of hashing undoes that.
//
// ─── RULE TWO: THIS MUST NEVER COST A TAP ───────────────────────────────────
//
// Nothing is awaited, nothing is returned, and NOTHING CAN THROW. logAdTap() is called on
// the line BEFORE Linking.openURL / the in-app navigation, so a synchronous throw here
// would mean the destination never opens — an advertiser's paid tap swallowed by our own
// analytics. A dropped count is nothing; a dead banner is the product failing in front of
// the one person paying for it.
//
// ─── THE TWO WAYS THIS SILENTLY COUNTS NOTHING ──────────────────────────────
//
// Both produce zero, no error, no crash — and zero reads as "nobody looks at the ads",
// which is a conclusion somebody would act on. Neither is theoretical:
//
//  1. supabase-js builders are LAZY THENABLES. `supabase.rpc(...)` builds an object and
//     sends NOTHING; the fetch is constructed inside .then(). Drop the .then() below and
//     this whole file is an expensive no-op. (logContactEvent carries the same warning
//     about .insert(); .rpc() has the identical shape.)
//  2. A missing EXECUTE grant on bump_ad_counter for `anon` — the app signs in
//     anonymously on launch, so most sessions are `authenticated` with is_anonymous=true,
//     but a render landing before that completes runs as true `anon`. The migration
//     asserts both grants from pg_proc rather than trusting the GRANT statement.

const noop = () => {}

// Bounds the SOCKET, never the user — the destination has already opened by the time this
// fires. Without it a request on a dying connection sits open for RN fetch's default,
// which is no timeout at all.
const TIMEOUT_MS = 4000

// ─── ONE VIEW PER AD PER APP PROCESS ────────────────────────────────────────
//
// Module-level, so it resets when the JS context does (cold start, OTA reload) and
// persists across every navigation in between. Deliberately NOT AsyncStorage: persisting
// it would mean writing "this device saw this ad" to disk, which is a trace at rest and
// exactly what the anonymity contract above forbids. In-memory costs us the dedup across
// restarts and buys us leaving nothing behind.
//
// ⚠ THIS IS THE LARGER OF THE TWO UNDERCOUNTS, AND IT IS DELIBERATE. A user who returns to
//   Home five times in one session is ONE view, not five. So view_count is nearer to REACH
//   than to impressions — "at least N app opens on which this banner was on screen" — and
//   must never be quoted as an impression count. The other undercount is the network: a
//   failed write is dropped and there is no retry queue.
const viewedThisProcess = new Set()

function fire(adId, kind) {
  try {
    if (!adId || !kind) return

    let signal
    let done = noop
    // AbortController exists in RN 0.81, but this file is on the path of a paid tap, so it
    // is checked rather than assumed — a ReferenceError here would cost the destination.
    if (typeof AbortController === 'function') {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      signal = controller.signal
      done = () => clearTimeout(timer)
    }

    let q = supabase.rpc('bump_ad_counter', { p_ad_id: adId, p_kind: kind })
    if (signal) q = q.abortSignal(signal)

    // BOTH handlers. The second is what makes an aborted or network-failed write a no-op
    // instead of an unhandled rejection over the screen.
    q.then(
      res => {
        done()
        // Production stays silent by design. In development that same silence is what
        // would let a broken call site survive to the OTA, so surface it where somebody
        // can act on it.
        if (__DEV__ && res && res.error) {
          console.warn(`[logAdEvent] ${kind} failed:`, res.error.message)
        }
      },
      err => {
        done()
        if (__DEV__ && err?.name !== 'AbortError') {
          console.warn(`[logAdEvent] ${kind} threw:`, err?.message || err)
        }
      },
    )
  } catch (e) {
    // Deliberately swallowed. Reaching here means something upstream is broken (no client,
    // no network stack); the destination on the next line still has to open.
    if (__DEV__) console.warn('[logAdEvent] threw synchronously:', e?.message || e)
  }
}

// Called from the banner Image's onLoad — the artwork has actually drawn, not merely that
// a row came back from the query. A mount abandoned mid-flight, or an image that never
// loaded, is not a view.
//
// ⚠ AND IT IS STILL NOT "SOMEBODY SAW IT". The home_footer slot sits at the bottom of a
//   plain (non-virtualised) ScrollView, so it mounts and loads on essentially every app
//   open whether or not the user scrolls to it. This is a SERVED-IMPRESSION count deduped
//   per app process. Quote it as "at least N app opens on which the banner was served",
//   never as "N people saw your ad" — the second is a claim this number cannot support,
//   and the first is always true.
export function logAdView(adId) {
  try {
    if (!adId || viewedThisProcess.has(adId)) return
    viewedThisProcess.add(adId)
    fire(adId, 'view')
  } catch (e) {
    if (__DEV__) console.warn('[logAdEvent] view threw synchronously:', e?.message || e)
  }
}

// NOT deduped. A second tap on the same banner is a second real intent to reach the
// advertiser, and it is the number they care about most.
export function logAdTap(adId) {
  fire(adId, 'tap')
}

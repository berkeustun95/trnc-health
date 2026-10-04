// Check-ins — every network call the app makes for them, in one place.
// Server half and who-sees-what: supabase/migrations/20261078_checkins.sql.
//
// Each function takes the Supabase client as its first argument instead of importing
// lib/supabase: that import pulls AsyncStorage and cannot load in Node, and this module is
// exercised in Node against the real SQL (scratchpad harness, PGlite) until 20261078 is
// applied at go-live. Screens pass `supabase`.
//
// Nothing here widens App.js PROFILE_COLUMNS: the three check-in columns are read in their
// own select (RouteBadges' rule). Against a database without the migration that select
// fails alone, not the profile load every screen depends on.
import { metresBetween } from '../constants/walkingRoutes.js'

// Mirrors check_in() in 20261078. The client pre-check is UX only; the server decides.
export const CHECKIN_RADIUS_M   = 150
export const CHECKIN_ACCURACY_M = 50
// The notice text's version, stamped by accept_checkin_notice(). Bump it when the wording
// of checkinNoticeBody changes in any language.
export const CHECKIN_NOTICE_VERSION = '2026-10-02'
export const FEED_PAGE = 20

const CODES = ['AUTH_REQUIRED', 'NOT_ELIGIBLE', 'BANNED', 'NAME_REQUIRED', 'NOTICE_REQUIRED',
  'PLACE_NOT_FOUND', 'BAD_FIX', 'LOW_ACCURACY', 'TOO_FAR', 'TOO_FAST', 'DAILY_LIMIT']

// The refusal code inside a PostgREST error; else 'NETWORK' when the request never reached a
// server; else 'UNKNOWN' (a server error — missing function, 5xx). postgrest-js reports a
// failed fetch (offline, DNS, timeout) as status 0 and nothing else as 0, so "check your
// connection" is shown only for status 0 — never for a server that answered with an error.
export function checkinErrorCode(error, status) {
  if (!error) return null
  const m = String(error.message ?? '')
  return CODES.find(c => m.includes(c)) ?? (status === 0 ? 'NETWORK' : 'UNKNOWN')
}

// The same refusals the server would give, decided on the phone so a fix that cannot pass
// never costs a round trip. Returns null when the fix is worth sending.
export function precheck(place, fix) {
  if (!fix || !Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)) return 'BAD_FIX'
  if (!(fix.accuracy > 0 && fix.accuracy <= CHECKIN_ACCURACY_M)) return 'LOW_ACCURACY'
  if (metresBetween(fix, place) > CHECKIN_RADIUS_M) return 'TOO_FAR'
  return null
}

// { ok, prefs: { display_name, checkins_public, checkins_notice_at }, code } for the caller.
export async function loadCheckinPrefs(client, uid) {
  const { data, error, status } = await client.from('profiles')
    .select('display_name, checkins_public, checkins_notice_at').eq('id', uid).maybeSingle()
  return error || !data ? { ok: false, prefs: null, code: error ? checkinErrorCode(error, status) : 'UNKNOWN' }
    : { ok: true, prefs: data, code: null }
}

// The effective checkins_public after the stamp (the server decides it from the DOB).
export async function acceptNotice(client) {
  const { data, error, status } = await client.rpc('accept_checkin_notice', { p_version: CHECKIN_NOTICE_VERSION })
  return error ? { ok: false, code: checkinErrorCode(error, status) } : { ok: true, isPublic: data === true }
}

export async function checkIn(client, placeId, fix) {
  const { data, error, status } = await client.rpc('check_in', {
    p_place_id: placeId, p_lat: fix.latitude, p_lng: fix.longitude, p_accuracy: fix.accuracy,
  })
  if (error) return { ok: false, code: checkinErrorCode(error, status) }
  const row = Array.isArray(data) ? data[0] : data
  return { ok: true, already: row?.already === true, id: row?.checkin_id ?? null }
}

// One page, newest first. `before` is the last row of the previous page. `more` is true when
// the page came back full — the next call may still return zero rows, which ends the list.
export async function loadFeed(client, { placeId = null, before = null, limit = FEED_PAGE } = {}) {
  const { data, error, status } = await client.rpc('get_checkin_feed', {
    p_place_id: placeId,
    p_before_at: before?.created_at ?? null,
    p_before_id: before?.checkin_id ?? null,
    p_limit: limit,
  })
  if (error) return { ok: false, code: checkinErrorCode(error, status), rows: [], more: false }
  const rows = data ?? []
  return { ok: true, rows, more: rows.length === limit }
}

// The caller's own check-ins (owner-only RLS), newest first, with the place for the label.
// PAGED, not capped: the policy promises a user can delete ANY of their check-ins, so the list
// must reach all of them. id breaks created_at ties so a page boundary never skips or repeats.
export const MINE_PAGE = 30
export async function loadMine(client, uid, offset = 0, limit = MINE_PAGE) {
  const { data, error } = await client.from('checkins')
    .select('id, created_at, place_id, places(name, name_i18n, category)')
    .eq('user_id', uid).order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(offset, offset + limit - 1)
  return error ? null : data ?? []
}

export async function deleteCheckin(client, id) {
  const { data, error } = await client.from('checkins').delete().eq('id', id).select('id')
  return !error && (data?.length ?? 0) === 1
}

export async function setCheckinsPublic(client, uid, next) {
  const { data, error } = await client.from('profiles')
    .update({ checkins_public: next }).eq('id', uid).select('checkins_public').single()
  return error ? null : data?.checkins_public === true
}

// "time ago" as an i18n key + count, for tCount. Older than a week reads as a date.
export function agoParts(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return { key: 'checkinAgoNow', n: 0 }
  if (s < 3600) return { key: 'checkinAgoMin', n: Math.floor(s / 60) }
  if (s < 86400) return { key: 'checkinAgoHour', n: Math.floor(s / 3600) }
  if (s < 7 * 86400) return { key: 'checkinAgoDay', n: Math.floor(s / 86400) }
  return { key: 'date', n: 0 }
}

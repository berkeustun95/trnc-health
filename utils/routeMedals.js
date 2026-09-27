import { useEffect, useRef, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '../lib/supabase'
import { logContactEvent } from './logContactEvent'
import { medalNeed, stopsVisitedAt } from '../constants/walkingRoutes'

// ─── Route medals: the phone half ───────────────────────────────────────────
// Server half and the privacy reasoning: supabase/migrations/20261056_route_medals.sql.
//
// Two device-local records, both ids only — never a coordinate, never a time of arrival:
//   PROGRESS  per route: which stop ids a fix has come within reach of, 24 h from the first.
//             The location watch is foreground-only, so a Famagusta walk with the phone in a
//             pocket between stops has to survive kills and resumes to be earnable at all.
//   PENDING   medals earned but not yet on an account: a guest's (held 7 days, claimed at
//             the first signed-in session) or a signed-in award whose RPC failed. `forUser`
//             pins a failed award to its account, so another person signing in on the same
//             phone cannot collect it; a guest's is null and goes to whoever signs in.

const PROGRESS_KEY = '@trnc_route_progress_v1'
const PENDING_KEY  = '@trnc_medal_pending_v1'
const PROGRESS_MS  = 24 * 3600 * 1000
const PENDING_MS   = 7 * 24 * 3600 * 1000

async function readJson(key, fallback) {
  try { const raw = await AsyncStorage.getItem(key); return raw ? JSON.parse(raw) : fallback } catch { return fallback }
}
const writeJson = (key, v) => AsyncStorage.setItem(key, JSON.stringify(v)).catch(() => {})

async function readProgress(routeId) {
  const all = await readJson(PROGRESS_KEY, {})
  const p = all[routeId]
  return p && Date.now() - p.startedAt < PROGRESS_MS ? p : null
}
async function writeProgress(routeId, p) {
  const all = await readJson(PROGRESS_KEY, {})
  const now = Date.now()
  for (const k of Object.keys(all)) if (now - all[k].startedAt >= PROGRESS_MS) delete all[k]
  all[routeId] = p
  await writeJson(PROGRESS_KEY, all)
}

async function addPending(routeId, forUser) {
  const list = (await readJson(PENDING_KEY, [])).filter(x => Date.now() - x.earnedAt < PENDING_MS && x.routeId !== routeId)
  list.push({ routeId, forUser, earnedAt: Date.now() })
  await writeJson(PENDING_KEY, list)
}

// Awards every pending medal this account may claim. Called on each signed-in session start.
// A refusal the server will repeat forever (route gone) drops the entry; a network failure keeps it.
export async function claimPendingMedals(userId) {
  const list = (await readJson(PENDING_KEY, [])).filter(x => Date.now() - x.earnedAt < PENDING_MS)
  const keep = []
  for (const x of list) {
    if (x.forUser && x.forUser !== userId) { keep.push(x); continue }
    const { error } = await supabase.rpc('award_route_medal', { p_route_id: x.routeId })
    if (error && !/ROUTE_NOT_FOUND/.test(error.message ?? '')) keep.push(x)
  }
  await writeJson(PENDING_KEY, keep)
}

// Walk-mode hook. `active` = a walk is on for `route`. Returns what the panel shows:
//   visited  stop ids reached (count against `need`)
//   medal    null | { state: 'saved', date } | { state: 'guest' } | { state: 'pending' }
export function useRouteMedal({ enabled, active, route, pos, userId, guest }) {
  const [visited, setVisited] = useState(() => new Set())
  const [medal, setMedal] = useState(null)
  const progress = useRef(null)
  const routeId = route?.id ?? null
  const on = enabled && active && !!routeId

  // Load (or start) this route's progress when a walk starts — including a walk restored
  // after the stop → place page → back round trip, which remounts the map.
  useEffect(() => {
    progress.current = null
    setVisited(new Set()); setMedal(null)
    if (!on) return
    let gone = false
    readProgress(routeId).then(p => {
      if (gone) return
      progress.current = p ?? { stopIds: [], startedAt: Date.now(), earned: false }
      setVisited(new Set(progress.current.stopIds))
      if (progress.current.earned) setMedal(progress.current.medal ?? { state: 'pending' })
    })
    return () => { gone = true }
  }, [on, routeId])

  useEffect(() => {
    const p = progress.current
    if (!on || !p || !pos) return
    const hits = stopsVisitedAt(route.stops, pos).filter(id => !p.stopIds.includes(id))
    if (!hits.length) return
    p.stopIds = [...p.stopIds, ...hits]
    setVisited(new Set(p.stopIds))
    if (!p.earned && p.stopIds.length >= medalNeed(route.stops.length)) {
      p.earned = true
      earn(p)
    } else {
      writeProgress(routeId, p)
    }
  }, [on, pos, route, routeId])

  // Marked earned BEFORE anything leaves the phone, so a kill mid-award cannot log the
  // Ministry event twice. Dev builds never log it (review sessions run against prod).
  async function earn(p) {
    await writeProgress(routeId, p)
    if (!__DEV__) logContactEvent('explore', routeId, 'route_complete', route.region ?? null)
    let m
    if (guest || !userId) {
      await addPending(routeId, null)
      m = { state: 'guest' }
    } else {
      const { data, error } = await supabase.rpc('award_route_medal', { p_route_id: routeId })
      if (error) { await addPending(routeId, userId); m = { state: 'pending' } }
      else m = { state: 'saved', date: data }
    }
    p.medal = m
    await writeProgress(routeId, p)
    setMedal(m)
  }

  return { visited, need: route ? medalNeed(route.stops.length) : 0, medal }
}

// 'YYYY-MM-DD' (a TRNC calendar date from the server) → a local Date at midnight. new Date(str)
// would read it as UTC midnight and show the previous day anywhere west of Greenwich.
export function medalDate(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString([], { dateStyle: 'medium' })
}

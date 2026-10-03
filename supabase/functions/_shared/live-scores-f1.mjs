// ─── Live Scores sync: Formula 1, API-Sports only ────────────────────────────
//
// Imported by supabase/functions/live-scores-f1; the pure half is tested from Node by
// scripts/check-live-scores-sync.mjs.
//
// FREE PLAN, AS MEASURED 2026-10-03: `season=`, `next=` and `competition=` need a season the
// plan refuses, so there is no calendar and no standings. What works is `races?date=` for
// yesterday/today/tomorrow (UTC), which returns one row per SESSION (practice, qualifying,
// sprint, race), and `rankings/races?race=<id>` for a session's classification.
//
//   daily  3 requests: races for yesterday, today, tomorrow → f1_races. Then one
//          rankings call per finished RACE whose final result is not stored yet, so
//          "Last race" survives between race weekends.
//   poll   only while a race session is on (start − 5 min to start + 150 min, or later while
//          the API still says Live): one rankings call per poll, plus one races?date call
//          from 110 min in, to learn when it is over. Interval: the shared quota spread,
//          floor 7 minutes, against the F1 cap of 90.
import {
  apiSports, utcDate, pollIntervalMinutes, nextUtcMidnight, usedToday,
} from './live-scores.mjs'

const RACE_WINDOW_BEFORE_MIN = 5
const RACE_WINDOW_AFTER_MIN = 150
const STATUS_CHECK_AFTER_MIN = 110
const F1_DAILY_REQUESTS = 3

// API-Sports session type → f1_races.session_type. null = unknown: skipped and logged.
export function mapSessionType(type) {
  const t = String(type || '').toLowerCase()
  if (t === 'race') return 'race'
  if (t.includes('sprint') && (t.includes('qualif') || t.includes('shootout'))) return 'sprint_qualifying'
  if (t.includes('sprint')) return 'sprint'
  if (t.includes('qualif')) return 'qualifying'
  const p = t.match(/([123])(?:st|nd|rd)?\s*practice|practice\s*([123])/)
  if (p) return `practice${p[1] || p[2]}`
  return null
}

export function mapRaceStatus(status) {
  const s = String(status || '').toLowerCase()
  if (s === 'live') return 'live'
  if (s === 'completed' || s === 'finished') return 'finished'
  if (s === 'cancelled' || s === 'canceled') return 'cancelled'
  if (s === 'postponed') return 'postponed'
  if (s === 'scheduled') return 'scheduled'
  return null
}

// One races?date item → an f1_races row (homogeneous keys), or { skip }.
export function sessionRowFrom(r, now) {
  const session_type = mapSessionType(r.type)
  if (!session_type) return { skip: `unknown session type ${JSON.stringify(r.type)}` }
  if (!Number.isInteger(r.id) || !r.date) return { skip: `race row without id/date` }
  return {
    row: {
      api_race_id: r.id,
      season: Number(r.season) || new Date(r.date).getUTCFullYear(),
      name: String(r.competition?.name || 'Grand Prix').slice(0, 120),
      circuit: r.circuit?.name ?? null,
      locality: r.competition?.location?.city ?? null,
      country: r.competition?.location?.country ?? null,
      race_at: r.date,
      session_type,
      status: mapRaceStatus(r.status) ?? 'scheduled',
      last_synced_at: now,
    },
    unknownStatus: mapRaceStatus(r.status) === null ? r.status : null,
  }
}

// One rankings/races item → an f1_results row (homogeneous keys), or null.
export function resultRowFrom(it, raceId, isFinal, now) {
  const name = it?.driver?.name
  if (!name) return null
  const int = v => (Number.isInteger(v) ? v : (/^\d+$/.test(String(v ?? '')) ? Number(v) : null))
  return {
    race_id: raceId,
    position: int(it.position),
    driver_name: String(name).slice(0, 80),
    driver_code: it.driver?.abbr ? String(it.driver.abbr).slice(0, 4) : null,
    team: it.team?.name ? String(it.team.name).slice(0, 80) : null,
    points: null,
    laps: int(it.laps),
    time_text: it.time != null ? String(it.time).slice(0, 24) : null,
    status_text: null,
    grid: int(it.grid),
    is_final: isFinal,
    updated_at: now,
  }
}

async function upsertSessions(sb, items, now, say) {
  const rows = []
  for (const r of items) {
    const m = sessionRowFrom(r, now)
    if (m.skip) { say(`f1 skip: ${m.skip}`); continue }
    if (m.unknownStatus) say(`f1: unknown status ${JSON.stringify(m.unknownStatus)} on ${r.id}, stored as scheduled`)
    rows.push(m.row)
  }
  if (!rows.length) return 0
  const { error } = await sb.from('f1_races').upsert(rows, { onConflict: 'api_race_id' })
  if (error) throw new Error(`f1_races upsert: ${error.message}`)
  return rows.length
}

async function storeResults(sb, key, race, isFinal, now, say) {
  const items = await apiSports(sb, 'f1', key, `/rankings/races?race=${race.api_race_id}`)
  if (items[0]) say(`f1 rankings sample keys: ${Object.keys(items[0]).join(',')}`)
  const rows = items.map(it => resultRowFrom(it, race.id, isFinal, now)).filter(Boolean)
  if (rows.length) {
    const { error } = await sb.from('f1_results').upsert(rows, { onConflict: 'race_id,driver_name' })
    if (error) throw new Error(`f1_results upsert: ${error.message}`)
  }
  say(`f1: ${rows.length} result row(s) for ${race.name} (${isFinal ? 'final' : 'live'})`)
  return rows.length
}

async function markFinal(sb, race) {
  const { error } = await sb.from('f1_races').update({ status: 'finished', results_final: true }).eq('id', race.id)
  if (error) throw new Error(`f1_races final: ${error.message}`)
  const { error: e2 } = await sb.from('f1_results').update({ is_final: true }).eq('race_id', race.id)
  if (e2) throw new Error(`f1_results final: ${e2.message}`)
}

export async function runDailyF1(sb, _sport, key, say) {
  const now = new Date().toISOString()
  const day = 86400000
  let n = 0
  for (const d of [utcDate(Date.now() - day), utcDate(now), utcDate(Date.now() + day)]) {
    n += await upsertSessions(sb, await apiSports(sb, 'f1', key, `/races?date=${d}`), now, say)
  }
  say(`f1: ${n} session(s) upserted`)
  // Finished races whose final classification we do not hold yet.
  const { data: owed, error } = await sb.from('f1_races').select('id, api_race_id, name, race_at')
    .eq('session_type', 'race').eq('status', 'finished').eq('results_final', false)
  if (error) throw new Error(`f1_races (owed): ${error.message}`)
  for (const race of owed) {
    await storeResults(sb, key, race, true, now, say)
    await markFinal(sb, race)
  }
  await sb.from('live_sync_state').update({ last_daily_on: utcDate(now) }).eq('sport', 'f1')
  return scheduleF1(sb, now, say)
}

async function activeRace(sb, now) {
  const t = Date.parse(now)
  const { data, error } = await sb.from('f1_races').select('id, api_race_id, name, race_at, status')
    .eq('session_type', 'race').in('status', ['scheduled', 'live'])
    .gte('race_at', new Date(t - 6 * 3600000).toISOString())
    .lte('race_at', new Date(t + RACE_WINDOW_BEFORE_MIN * 60000).toISOString())
    .order('race_at', { ascending: false }).limit(1)
  if (error) throw new Error(`f1_races (active): ${error.message}`)
  const r = data[0]
  if (!r) return null
  // Past the window only while the API still said Live last time we asked (red flags, delays).
  const end = Date.parse(r.race_at) + RACE_WINDOW_AFTER_MIN * 60000
  return t <= end || r.status === 'live' ? r : null
}

export async function runPollF1(sb, _sport, key, say) {
  const now = new Date().toISOString()
  const race = await activeRace(sb, now)
  if (!race) { say('f1: no race session on'); return scheduleF1(sb, now, say) }
  await storeResults(sb, key, race, false, now, say)
  if (race.status !== 'live') await sb.from('f1_races').update({ status: 'live' }).eq('id', race.id)
  if (Date.parse(now) >= Date.parse(race.race_at) + STATUS_CHECK_AFTER_MIN * 60000) {
    const items = await apiSports(sb, 'f1', key, `/races?date=${utcDate(race.race_at)}`)
    const me = items.find(r => r.id === race.api_race_id)
    const st = mapRaceStatus(me?.status)
    say(`f1: ${race.name} status from API: ${me?.status ?? 'not returned'}`)
    if (st === 'finished') { await markFinal(sb, race); say(`f1: ${race.name} final`) }
    else if (st === 'cancelled' || st === 'postponed') {
      await sb.from('f1_races').update({ status: st }).eq('id', race.id)
    }
  }
  return scheduleF1(sb, new Date().toISOString(), say)
}

async function scheduleF1(sb, now, say) {
  const race = await activeRace(sb, now)
  let next
  if (race) {
    const liveEndsAt = new Date(Math.max(Date.parse(race.race_at) + RACE_WINDOW_AFTER_MIN * 60000, Date.parse(now) + 30 * 60000)).toISOString()
    const { data: st } = await sb.from('live_sync_state').select('last_daily_on').eq('sport', 'f1').maybeSingle()
    const mins = pollIntervalMinutes({
      used: await usedToday(sb, 'f1', now), liveEndsAt, now,
      dailyDone: st?.last_daily_on === utcDate(now), dailyReserve: F1_DAILY_REQUESTS,
    })
    next = mins === null ? nextUtcMidnight(now) : new Date(Date.parse(now) + mins * 60000).toISOString()
    say(`f1: ${race.name} on, next poll in ${mins ?? 'quota exhausted → after UTC midnight'} min`)
  } else {
    const { data: up, error } = await sb.from('f1_races').select('race_at')
      .eq('session_type', 'race').eq('status', 'scheduled').gt('race_at', now).order('race_at').limit(1)
    if (error) throw new Error(`f1_races (upcoming): ${error.message}`)
    const start = up?.[0] ? Date.parse(up[0].race_at) - RACE_WINDOW_BEFORE_MIN * 60000 : null
    next = new Date(start && start < Date.parse(now) + 6 * 3600000 ? Math.max(start, Date.parse(now) + 60000) : Date.parse(now) + 6 * 3600000).toISOString()
    say(`f1: idle, next poll at ${next}`)
  }
  const { error: uErr } = await sb.from('live_sync_state')
    .update({ next_poll_at: next, last_run_at: now, last_error: null }).eq('sport', 'f1')
  if (uErr) throw new Error(`live_sync_state: ${uErr.message}`)
  return next
}

// ─── Live Scores sync, shared by live-scores-football and live-scores-basketball ───
//
// Imported by both Deno functions; the pure half (status maps, row builders, the poll
// interval) is also importable from Node, which is how scripts/check-live-scores-sync.mjs
// tests it without a network or a database.
//
// API-SPORTS FREE PLAN, AS MEASURED 2026-10-03 — every design choice below follows from it:
//   • 100 requests/day PER SPORT; we stop at 90 (claim_api_request, in the database).
//   • `date=` only for yesterday/today/tomorrow (UTC). `season=`, `next=`, `ids=` refused.
//     So there are no standings, and no batched lookup of tracked matches by id.
//   • `timezone=` is ignored on date queries: responses are UTC, so dates here are UTC.
//   • football has `live=all` (with events); basketball has NO live parameter, so its
//     live poll is `games?date=` for each UTC date that has an active match.
//   • `live=all` drops a match the moment it ends, so a football match missing from the
//     live response is closed with ONE `fixtures?date=` call per affected date.
//   • Errors arrive as HTTP 200 with a non-empty `errors` object. Treat that as failure.

export const DAILY_CAP = 90
export const MIN_POLL_MINUTES = 7
// How long after kick-off a match is still worth polling for, and the length of a match
// used to estimate the end of the live window.
const LIVE_WINDOW_MIN = { football: 240, basketball: 240 }
const EXPECTED_LENGTH_MIN = { football: 115, basketball: 150 }
// Requests held back from the live budget: the next daily run (2) and one finals sweep.
const RESERVE_DAILY = 2
const RESERVE_FINALS = 1

export const HOSTS = {
  football:   'https://v3.football.api-sports.io',
  basketball: 'https://v1.basketball.api-sports.io',
  f1:         'https://v1.formula-1.api-sports.io',
}

// ─── Status vocabulary → matches.status. null = unknown code: log, leave the row alone.
const FOOTBALL_STATUS = {
  TBD: 'scheduled', NS: 'scheduled',
  '1H': 'live', '2H': 'live', ET: 'live', BT: 'live', P: 'live', LIVE: 'live',
  HT: 'ht',
  FT: 'ft', AET: 'ft', PEN: 'ft', AWD: 'ft', WO: 'ft',
  PST: 'postponed',
  CANC: 'cancelled', ABD: 'cancelled',
  SUSP: 'suspended', INT: 'suspended',
}
const BASKETBALL_STATUS = {
  NS: 'scheduled',
  Q1: 'live', Q2: 'live', Q3: 'live', Q4: 'live', OT: 'live', BT: 'live',
  HT: 'ht',
  FT: 'ft', AOT: 'ft', AWD: 'ft',
  POST: 'postponed',
  CANC: 'cancelled', ABD: 'cancelled',
  SUSP: 'suspended',
}
export function mapStatus(sport, short) {
  const m = sport === 'football' ? FOOTBALL_STATUS : BASKETBALL_STATUS
  return m[short] ?? null
}

export function utcDate(d) {
  return new Date(d).toISOString().slice(0, 10)
}

// ─── Payload → rows. Every row has the SAME keys (a ragged upsert payload makes
// PostgREST NULL the columns the shorter rows omit).
export function teamRowsFrom(sport, items) {
  const seen = new Map()
  for (const it of items) {
    for (const side of ['home', 'away']) {
      const t = it.teams[side]
      if (!t?.id || seen.has(String(t.id))) continue
      seen.set(String(t.id), {
        sport, source: 'api', external_id: String(t.id),
        name: String(t.name || '').trim().slice(0, 80) || '?',
        // The provider's URL is never shown to a phone (20261071): mirrorLogos copies it once
        // into the team-logos bucket and only that copy goes in logo_url.
        source_logo_url: typeof t.logo === 'string' && t.logo.startsWith('https://') ? t.logo : null,
      })
    }
  }
  return [...seen.values()]
}

// One fixture/game → a matches row, or { skip: reason } when the status is unknown.
export function matchRowFrom(sport, it, leagueIdByExt, teamIdByExt, now) {
  const short = sport === 'football' ? it.fixture.status.short : it.status.short
  const status = mapStatus(sport, short)
  if (!status) return { skip: `unknown status ${short}` }
  const extId = String(sport === 'football' ? it.fixture.id : it.id)
  const league_id = leagueIdByExt.get(String(it.league.id))
  const home_team_id = teamIdByExt.get(String(it.teams.home.id))
  const away_team_id = teamIdByExt.get(String(it.teams.away.id))
  if (!league_id || !home_team_id || !away_team_id) return { skip: `unresolved league/team for ${extId}` }

  let home_score, away_score, minute = null, clock = null
  if (sport === 'football') {
    home_score = it.goals.home ?? null
    away_score = it.goals.away ?? null
    const el = it.fixture.status.elapsed
    if (status === 'live' && Number.isInteger(el)) minute = Math.min(el + (it.fixture.status.extra || 0), 200)
  } else {
    home_score = it.scores?.home?.total ?? null
    away_score = it.scores?.away?.total ?? null
    if (status === 'live' && it.status.timer != null) clock = String(it.status.timer).slice(0, 8)
  }
  return {
    row: {
      sport, source: 'api', external_id: extId, league_id, home_team_id, away_team_id,
      home_score, away_score, minute, clock,
      period: status === 'live' || status === 'ht' ? String(short).slice(0, 8) : null,
      status,
      kickoff_at: sport === 'football' ? it.fixture.date : it.date,
      last_synced_at: now,
    },
  }
}

// API-Football events → match_events rows (goals and cards only). The dedupe_key is the
// identity the API never gives us; it is stable across polls for the same event.
export function eventRowsFrom(fixture, matchId) {
  const out = []
  const homeId = fixture.teams.home.id
  for (const e of fixture.events || []) {
    let type = null
    if (e.type === 'Goal') {
      type = e.detail === 'Own Goal' ? 'own_goal' : e.detail === 'Penalty' ? 'penalty'
           : e.detail === 'Missed Penalty' ? 'missed_penalty' : 'goal'
    } else if (e.type === 'Card') {
      type = e.detail === 'Yellow Card' ? 'yellow' : 'red'   // 'Red Card', 'Second Yellow card'
    }
    if (!type) continue
    const team_side = e.team?.id === homeId ? 'home' : 'away'
    const player_name = e.player?.name ? String(e.player.name).slice(0, 80) : null
    const minute = Number.isInteger(e.time?.elapsed) ? e.time.elapsed : null
    const extra_minute = Number.isInteger(e.time?.extra) ? e.time.extra : null
    out.push({
      match_id: matchId, type, team_side, player_name, minute, extra_minute,
      dedupe_key: [type, team_side, minute ?? '', extra_minute ?? '', player_name ?? ''].join('|'),
    })
  }
  return out
}

// ─── The poll interval: spread what is left of today's quota over what is left of the
// live window, never faster than every 7 minutes. Quota resets at 00:00 UTC, so the window
// is clipped there. Returns minutes, or null when nothing can be afforded today.
export function pollIntervalMinutes({ used, liveEndsAt, now, dailyDone, dailyReserve = RESERVE_DAILY }) {
  const nowMs = new Date(now).getTime()
  const midnight = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1)
  const windowEnd = Math.min(new Date(liveEndsAt).getTime(), midnight)
  const minutesLeft = Math.max(1, Math.ceil((windowEnd - nowMs) / 60000))
  const budget = DAILY_CAP - used - RESERVE_FINALS - (dailyDone ? 0 : dailyReserve)
  if (budget <= 0) return null
  return Math.max(MIN_POLL_MINUTES, Math.ceil(minutesLeft / budget))
}

export function nextUtcMidnight(now) {
  const d = new Date(now)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 5)).toISOString()
}

// ─── IO ─────────────────────────────────────────────────────────────────────

export class QuotaExhausted extends Error {}

// Only service_role may run a sync. verify_jwt proves the token is signed by this project;
// the anon key is ALSO such a token, so without this check anyone holding the app could
// invoke the function and spend the day's quota.
export function callerIsServiceRole(req, serviceKey) {
  const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  // The exact service key (a non-JWT secret key from CI) is accepted as itself.
  if (serviceKey && tok === serviceKey) return true
  const part = tok.split('.')[1]
  if (!part) return false
  try {
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
    return json.role === 'service_role'
  } catch { return false }
}

async function logRequest(sb, row) {
  const { error } = await sb.from('api_request_log').insert(row)
  if (error) console.error(`api_request_log insert failed: ${error.message}`)
}

// Spend one request (or refuse), call API-Sports, log the call. Throws on any failure.
export async function apiSports(sb, sport, key, path) {
  const { data: ok, error } = await sb.rpc('claim_api_request', { p_sport: sport })
  if (error) throw new Error(`claim_api_request: ${error.message}`)
  if (ok !== true) throw new QuotaExhausted(`${sport}: daily cap of ${DAILY_CAP} reached`)

  let status = null, results = null, err = null, body = null
  try {
    const res = await fetch(HOSTS[sport] + path, { headers: { 'x-apisports-key': key } })
    status = res.status
    body = await res.json().catch(() => null)
    results = body?.results ?? null
    const errs = body?.errors
    const hasErr = errs && (Array.isArray(errs) ? errs.length : Object.keys(errs).length)
    if (!res.ok || !body || hasErr) err = hasErr ? JSON.stringify(errs).slice(0, 500) : `HTTP ${status}`
  } catch (e) {
    err = String(e?.message || e).slice(0, 500)
  }
  await logRequest(sb, { sport, provider: 'api-sports', endpoint: path, http_status: status, results, error: err })
  if (err) throw new Error(`${sport} ${path}: ${err}`)
  return body.response || []
}

export async function usedToday(sb, sport, now) {
  const { data, error } = await sb.from('api_quota_log').select('requests_used')
    .eq('day', utcDate(now)).eq('sport', sport).maybeSingle()
  if (error) throw new Error(`api_quota_log: ${error.message}`)
  return data?.requests_used ?? 0
}

async function enabledLeagues(sb, sport) {
  const { data, error } = await sb.from('leagues').select('id, external_id')
    .eq('sport', sport).eq('source', 'api').eq('enabled', true)
  if (error) throw new Error(`leagues: ${error.message}`)
  return new Map(data.map(l => [String(l.external_id), l.id]))
}

// Men's senior only (Berke, 2026-10-04). The provider's "Friendlies" competition (id 10) mixes
// youth national teams into the senior one (seen: "Portugal U18 – Turkey U18"), so a fixture
// with an age-limited or women's side is dropped, whatever competition it arrives under.
export const NOT_SENIOR_MEN = /(^|[^a-z0-9])(u-?\d{2}|under[- ]?\d{2})($|[^0-9])|\bwomen\b|\bw$|\bfem(enil|inine|inino)?\b/i
export function isSeniorMenFixture(it) {
  return !NOT_SENIOR_MEN.test(String(it.teams?.home?.name || '')) && !NOT_SENIOR_MEN.test(String(it.teams?.away?.name || ''))
}

// Rows stored before the filter existed are removed the same way (DB work, no API request).
async function pruneNonSenior(sb, sport, say) {
  if (sport !== 'football') return
  const { data: teams, error } = await sb.from('teams').select('id')
    .eq('sport', sport).eq('source', 'api').filter('name', 'imatch', '(^|[^a-z0-9])(u-?[0-9]{2}|under[- ]?[0-9]{2})($|[^0-9])|women| w$')
  if (error) throw new Error(`teams (non-senior): ${error.message}`)
  if (!teams.length) return
  const ids = teams.map(t => t.id).join(',')
  const { data: gone, error: dErr } = await sb.from('matches').delete()
    .eq('source', 'api').or(`home_team_id.in.(${ids}),away_team_id.in.(${ids})`).select('id')
  if (dErr) throw new Error(`matches (non-senior prune): ${dErr.message}`)
  if (gone.length) say(`${sport}: removed ${gone.length} youth/women's match(es)`)
}

// Upsert teams then matches for the items that belong to enabled leagues. Returns the
// upserted rows' { id, external_id } so football can attach events.
async function upsertItems(sb, sport, items, leagueIdByExt, now, say) {
  const mine = items.filter(it => leagueIdByExt.has(String(it.league.id)) && (sport !== 'football' || isSeniorMenFixture(it)))
  if (!mine.length) return []
  const teams = teamRowsFrom(sport, mine)
  const { data: tRows, error: tErr } = await sb.from('teams')
    .upsert(teams, { onConflict: 'sport,source,external_id' }).select('id, external_id')
  if (tErr) throw new Error(`teams upsert: ${tErr.message}`)
  const teamIdByExt = new Map(tRows.map(t => [t.external_id, t.id]))

  const rows = []
  for (const it of mine) {
    const r = matchRowFrom(sport, it, leagueIdByExt, teamIdByExt, now)
    if (r.skip) say(`skip: ${r.skip}`); else rows.push(r.row)
  }
  if (!rows.length) return []
  const { data: mRows, error: mErr } = await sb.from('matches')
    .upsert(rows, { onConflict: 'sport,source,external_id' }).select('id, external_id')
  if (mErr) throw new Error(`matches upsert: ${mErr.message}`)
  say(`${sport}: upserted ${rows.length} match(es)`)
  return mRows
}

async function syncFootballEvents(sb, fixtures, mRows) {
  const idByExt = new Map(mRows.map(m => [m.external_id, m.id]))
  for (const f of fixtures) {
    const matchId = idByExt.get(String(f.fixture.id))
    if (!matchId) continue
    const rows = eventRowsFrom(f, matchId)
    if (rows.length) {
      const { error } = await sb.from('match_events')
        .upsert(rows, { onConflict: 'match_id,dedupe_key', ignoreDuplicates: true })
      if (error) throw new Error(`match_events upsert: ${error.message}`)
    }
    // An event the API withdrew (a VAR-cancelled goal) is removed; nothing else is touched.
    const keep = rows.map(r => r.dedupe_key)
    let del = sb.from('match_events').delete().eq('match_id', matchId)
    if (keep.length) del = del.not('dedupe_key', 'in', `(${keep.map(k => `"${k.replace(/"/g, '\\"')}"`).join(',')})`)
    const { error: dErr } = await del
    if (dErr) throw new Error(`match_events prune: ${dErr.message}`)
  }
}

// ─── Logos: copy each provider logo ONCE into the public team-logos bucket ──────
// Phones load logos from our bucket only (teams_logo_check). Only the provider's media host
// is fetched — the URL comes from API data, so anything else is refused rather than proxied.
const LOGO_HOST = 'media.api-sports.io'
const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const LOGO_MAX_BYTES = 524288

export function logoPath(sport, externalId, contentType) {
  const ext = LOGO_TYPES[contentType]
  if (!ext || !/^[0-9a-z-]+$/i.test(String(externalId))) return null
  return `${sport}/${String(externalId).toLowerCase()}.${ext}`
}

export async function mirrorLogos(sb, sport, say, limit = 40) {
  const { data: todo, error } = await sb.from('teams').select('id, external_id, source_logo_url')
    .eq('sport', sport).eq('source', 'api').is('logo_url', null).not('source_logo_url', 'is', null).limit(limit)
  if (error) throw new Error(`teams (logos): ${error.message}`)
  let copied = 0, failed = 0, missing = 0
  for (const t of todo) {
    try {
      const u = new URL(t.source_logo_url)
      if (u.protocol !== 'https:' || u.hostname !== LOGO_HOST) throw new Error(`host ${u.hostname} not allowed`)
      const res = await fetch(u.toString())
      // 404 = the provider has no image for this team (seen 2026-10-03 on two BSL teams).
      // Clear the source so the 7-minute poll stops refetching it; the daily upsert writes the
      // URL back, so it is retried once a day and copied if the provider ever adds the file.
      // The app shows its placeholder meanwhile.
      if (res.status === 404) {
        await sb.from('teams').update({ source_logo_url: null }).eq('id', t.id)
        missing++
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const type = (res.headers.get('content-type') || '').split(';')[0].trim()
      const path = logoPath(sport, t.external_id, type)
      if (!path) throw new Error(`content-type ${type}`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (bytes.length > LOGO_MAX_BYTES) throw new Error(`${bytes.length} bytes`)
      const { error: upErr } = await sb.storage.from('team-logos').upload(path, bytes, { contentType: type, upsert: true })
      if (upErr) throw new Error(`upload: ${upErr.message}`)
      const publicUrl = sb.storage.from('team-logos').getPublicUrl(path).data.publicUrl
      const { error: uErr } = await sb.from('teams').update({ logo_url: publicUrl }).eq('id', t.id)
      if (uErr) throw new Error(`teams update: ${uErr.message}`)
      copied++
    } catch (e) {
      failed++
      say(`logo ${sport}/${t.external_id}: ${String(e?.message || e).slice(0, 120)}`)
    }
  }
  if (todo.length) say(`${sport}: logos copied ${copied}, none at provider ${missing}, failed ${failed}, of ${todo.length} pending`)
  return { copied, missing, failed }
}

const dateQuery = (sport, d) => sport === 'football' ? `/fixtures?date=${d}` : `/games?date=${d}`

// ─── daily: today's and tomorrow's games (UTC), which also covers NBA tip-offs at
// 23:00-03:00 UTC (02:00-06:00 TRNC). Two requests per sport.
export async function runDaily(sb, sport, key, say) {
  const now = new Date().toISOString()
  const leagues = await enabledLeagues(sb, sport)
  const today = utcDate(now)
  const tomorrow = utcDate(Date.now() + 86400000)
  for (const d of [today, tomorrow]) {
    const items = await apiSports(sb, sport, key, dateQuery(sport, d))
    await upsertItems(sb, sport, items, leagues, now, say)
  }
  const { error } = await sb.from('api_request_log').delete().lt('at', new Date(Date.now() - 30 * 86400000).toISOString())
  if (error) say(`api_request_log purge failed: ${error.message}`)
  await sb.from('live_sync_state').update({ last_daily_on: today }).eq('sport', sport)
  await pruneNonSenior(sb, sport, say)
  await mirrorLogos(sb, sport, say)
  return schedule(sb, sport, now, say)
}

// ─── poll: the live tick. Called by the minute cron only when next_poll_at is due.
export async function runPoll(sb, sport, key, say) {
  const now = new Date().toISOString()
  const active = await activeMatches(sb, sport, now)
  if (!active.length) { say(`${sport}: nothing live or due`); return schedule(sb, sport, now, say) }

  const leagues = await enabledLeagues(sb, sport)
  if (sport === 'football') {
    const live = await apiSports(sb, sport, key, '/fixtures?live=all')
    const mine = live.filter(f => leagues.has(String(f.league.id)) && isSeniorMenFixture(f))
    const mRows = await upsertItems(sb, sport, mine, leagues, now, say)
    await syncFootballEvents(sb, mine, mRows)
    // Anything we track that is past kick-off but absent from the live list has ended,
    // been postponed or not started on time: one date call per affected date closes it.
    // A 'scheduled' row only counts once it is 20 minutes overdue, so a late kick-off does
    // not cost a date call on every poll.
    const liveIds = new Set(mine.map(f => String(f.fixture.id)))
    const overdue = Date.parse(now) - 20 * 60000
    const missing = active.filter(m => !liveIds.has(m.external_id)
      && (m.status !== 'scheduled' || Date.parse(m.kickoff_at) < overdue))
    for (const d of [...new Set(missing.map(m => utcDate(m.kickoff_at)))]) {
      const items = await apiSports(sb, sport, key, dateQuery(sport, d))
      await upsertItems(sb, sport, items, leagues, now, say)
    }
  } else {
    for (const d of [...new Set(active.map(m => utcDate(m.kickoff_at)))]) {
      const items = await apiSports(sb, sport, key, dateQuery(sport, d))
      await upsertItems(sb, sport, items, leagues, now, say)
    }
  }
  await pruneNonSenior(sb, sport, say)
  await mirrorLogos(sb, sport, say, 10)
  return schedule(sb, sport, new Date().toISOString(), say)
}

// Matches worth polling: not finished, kicked off within the live window (or about to).
async function activeMatches(sb, sport, now) {
  const from = new Date(new Date(now).getTime() - LIVE_WINDOW_MIN[sport] * 60000).toISOString()
  const to = new Date(new Date(now).getTime() + 2 * 60000).toISOString()
  const { data, error } = await sb.from('matches').select('id, external_id, kickoff_at, status')
    .eq('sport', sport).eq('source', 'api').in('status', ['scheduled', 'live', 'ht'])
    .gte('kickoff_at', from).lte('kickoff_at', to)
  if (error) throw new Error(`matches (active): ${error.message}`)
  return data
}

// Decide next_poll_at and write the state row. Live → the quota-spread interval; idle →
// the next kick-off (the daily cron covers anything not yet known).
async function schedule(sb, sport, now, say) {
  const active = await activeMatches(sb, sport, now)
  let next
  if (active.length) {
    const lastKick = Math.max(...active.map(m => Date.parse(m.kickoff_at)))
    const liveEndsAt = new Date(lastKick + EXPECTED_LENGTH_MIN[sport] * 60000).toISOString()
    const { data: st } = await sb.from('live_sync_state').select('last_daily_on').eq('sport', sport).maybeSingle()
    const mins = pollIntervalMinutes({
      used: await usedToday(sb, sport, now), liveEndsAt, now, dailyDone: st?.last_daily_on === utcDate(now),
    })
    next = mins === null ? nextUtcMidnight(now) : new Date(new Date(now).getTime() + mins * 60000).toISOString()
    say(`${sport}: ${active.length} active, next poll in ${mins ?? 'quota exhausted → after UTC midnight'} min`)
  } else {
    const { data: upcoming, error } = await sb.from('matches').select('kickoff_at')
      .eq('sport', sport).eq('source', 'api').eq('status', 'scheduled').gt('kickoff_at', now)
      .order('kickoff_at').limit(1)
    if (error) throw new Error(`matches (upcoming): ${error.message}`)
    next = upcoming?.[0]?.kickoff_at ?? new Date(new Date(now).getTime() + 6 * 3600000).toISOString()
    say(`${sport}: idle, next poll at ${next}`)
  }
  const { error: uErr } = await sb.from('live_sync_state')
    .update({ next_poll_at: next, last_run_at: now, last_error: null }).eq('sport', sport)
  if (uErr) throw new Error(`live_sync_state: ${uErr.message}`)
  return next
}

// Ops: list the provider's CURRENT 'World' competitions (internationals + UEFA club cups) for
// a human to choose from. One request; writes nothing. Called via the live-scores-run workflow.
export async function runLeagueLookup(sb, sport, key, say) {
  const items = await apiSports(sb, sport, key, '/leagues?country=World&current=true')
  const list = items.map(x => ({ id: x.league?.id, name: x.league?.name, type: x.league?.type,
    season: (x.seasons || []).find(z => z.current)?.year ?? null }))
    .sort((a, b) => a.id - b.id)
  say(`leagues: ${list.length} current World competitions`)
  for (const l of list) say(`league ${l.id} | ${l.name} | ${l.type} | ${l.season}`)
  return null
}

// The handler both functions export. mode: 'daily' | 'poll'.
export async function handle(req, sport, createClient, env, runners = { daily: runDaily, poll: runPoll }) {
  if (!callerIsServiceRole(req, env('SUPABASE_SERVICE_ROLE_KEY'))) return new Response('forbidden', { status: 403 })
  const log = []
  const say = s => { log.push(s); console.log(s) }
  const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } })
  const key = env('API_SPORTS_KEY')
  let mode = 'poll'
  try { const m = (await req.json())?.mode; mode = runners[m] ? m : 'poll' } catch { /* empty body = poll */ }
  try {
    if (!key) throw new Error('API_SPORTS_KEY is not set')
    const next = await runners[mode](sb, sport, key, say)
    return Response.json({ ok: true, mode, next_poll_at: next, log })
  } catch (e) {
    const msg = String(e?.message || e)
    say(`ERROR: ${msg}`)
    // Quota exhausted: sleep until the UTC reset rather than re-firing every 7 minutes.
    const patch = { last_error: msg.slice(0, 500), last_run_at: new Date().toISOString() }
    if (e instanceof QuotaExhausted) patch.next_poll_at = nextUtcMidnight(new Date())
    await sb.from('live_sync_state').update(patch).eq('sport', sport)
    return Response.json({ ok: false, mode, error: msg, log }, { status: e instanceof QuotaExhausted ? 429 : 500 })
  }
}

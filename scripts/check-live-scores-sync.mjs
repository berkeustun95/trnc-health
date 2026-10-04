#!/usr/bin/env node
// ─── Live Scores sync: offline checks of the pure half ───────────────────────
//
//   node scripts/check-live-scores-sync.mjs
//
// Tests supabase/functions/_shared/live-scores.mjs without a network or a database:
// status mapping, row building, event identity, the quota-spread interval and the
// service_role gate. Shapes are copied from real API-Sports responses (2026-10-03).
import {
  mapStatus, matchRowFrom, eventRowsFrom, teamRowsFrom, pollIntervalMinutes, callerIsServiceRole,
  DAILY_CAP,
  logoPath, isSeniorMenFixture,
} from '../supabase/functions/_shared/live-scores.mjs'
import { mapSessionType, mapRaceStatus, sessionRowFrom, resultRowFrom } from '../supabase/functions/_shared/live-scores-f1.mjs'

const problems = []
const check = (ok, msg) => { if (!ok) problems.push(msg) }

// Every status code seen in one day's real payloads must map; an unknown one must not.
for (const c of ['NS', 'TBD', '1H', '2H', 'HT', 'ET', 'P', 'FT', 'AET', 'PEN', 'AWD', 'PST', 'CANC', 'ABD', 'SUSP', 'INT'])
  check(mapStatus('football', c) !== null, `football status ${c} is unmapped`)
for (const c of ['NS', 'Q1', 'Q2', 'Q3', 'Q4', 'OT', 'HT', 'FT', 'AOT', 'POST', 'CANC'])
  check(mapStatus('basketball', c) !== null, `basketball status ${c} is unmapped`)
check(mapStatus('football', 'XYZ') === null, 'an unknown football status must map to null (row left alone)')
check(mapStatus('football', 'HT') === 'ht' && mapStatus('football', 'PEN') === 'ft', 'football HT/PEN mapping')

const fixture = {
  fixture: { id: 1001, date: '2026-10-03T19:00:00+00:00', status: { short: '2H', elapsed: 67, extra: null } },
  league: { id: 39 },
  teams: { home: { id: 40, name: 'Liverpool', logo: 'https://media.api-sports.io/football/teams/40.png' },
           away: { id: 50, name: 'Manchester City', logo: 'https://media.api-sports.io/football/teams/50.png' } },
  goals: { home: 2, away: 1 },
  events: [
    { time: { elapsed: 12, extra: null }, team: { id: 40 }, player: { name: 'M. Salah' }, type: 'Goal', detail: 'Normal Goal' },
    { time: { elapsed: 30, extra: null }, team: { id: 50 }, player: { name: 'E. Haaland' }, type: 'Goal', detail: 'Penalty' },
    { time: { elapsed: 45, extra: 2 }, team: { id: 50 }, player: { name: 'R. Dias' }, type: 'Card', detail: 'Second Yellow card' },
    { time: { elapsed: 50, extra: null }, team: { id: 40 }, player: { name: 'X' }, type: 'subst', detail: 'Substitution 1' },
  ],
}
const leagues = new Map([['39', 7]])
const teams = new Map([['40', 101], ['50', 102]])
const now = '2026-10-03T20:10:00.000Z'

const fr = matchRowFrom('football', fixture, leagues, teams, now)
check(fr.row && fr.row.status === 'live' && fr.row.minute === 67 && fr.row.period === '2H'
      && fr.row.home_score === 2 && fr.row.league_id === 7 && fr.row.external_id === '1001',
      `football row wrong: ${JSON.stringify(fr)}`)
const unknown = matchRowFrom('football', { ...fixture, fixture: { ...fixture.fixture, status: { short: 'XYZ' } } }, leagues, teams, now)
check(unknown.skip, 'an unknown status must skip the row, not write it')
const ft = matchRowFrom('football', { ...fixture, fixture: { ...fixture.fixture, status: { short: 'FT', elapsed: 90 } } }, leagues, teams, now)
check(ft.row?.status === 'ft' && ft.row.minute === null && ft.row.period === null, 'a finished match carries no minute/period')

const game = {
  id: 5001, date: '2026-10-04T23:00:00+00:00', league: { id: 12 },
  status: { short: 'Q3', timer: '7' },
  teams: { home: { id: 1, name: 'Boston Celtics' }, away: { id: 2, name: 'New York Knicks' } },
  scores: { home: { total: 71 }, away: { total: 68 } },
}
const br = matchRowFrom('basketball', game, new Map([['12', 9]]), new Map([['1', 11], ['2', 12]]), now)
check(br.row && br.row.home_score === 71 && br.row.clock === '7' && br.row.period === 'Q3' && br.row.minute === null,
      `basketball row wrong: ${JSON.stringify(br)}`)

// Upsert payloads must be homogeneous (a ragged payload NULLs the shorter rows' columns).
const tr = teamRowsFrom('football', [fixture, fixture])
check(tr.length === 2, `teams must be de-duplicated (got ${tr.length})`)
check(new Set(tr.map(t => Object.keys(t).sort().join())).size === 1, 'team rows are ragged')
check(tr.every(t => !('logo_url' in t) && t.source_logo_url?.startsWith('https://media.api-sports.io/')),
      'the sync must write the provider URL to source_logo_url and NEVER to logo_url (phones only load our copy)')
check(logoPath('football', '40', 'image/png') === 'football/40.png', 'logo path for a png')
check(logoPath('football', '40', 'text/html') === null, 'a non-image response must not be stored')
check(logoPath('football', '../x', 'image/png') === null, 'a path-traversal external_id must be refused')

const ev = eventRowsFrom(fixture, 900)
check(ev.length === 3, `3 events expected (goal, penalty, second yellow; the sub ignored), got ${ev.length}`)
check(ev[0].type === 'goal' && ev[0].team_side === 'home', 'first event: home goal')
check(ev[1].type === 'penalty' && ev[1].team_side === 'away', 'second event: away penalty')
check(ev[2].type === 'red' && ev[2].extra_minute === 2, 'second yellow is a red, with stoppage minute')
check(eventRowsFrom(fixture, 900).map(e => e.dedupe_key).join() === ev.map(e => e.dedupe_key).join(),
      'dedupe_key must be stable across polls')
check(new Set(ev.map(e => e.dedupe_key)).size === ev.length, 'dedupe_key must be unique per event')

// The interval: never under 7 minutes; null once the budget is gone; spreads over the window.
check(pollIntervalMinutes({ used: 0, liveEndsAt: '2026-10-03T21:00:00Z', now: '2026-10-03T19:00:00Z', dailyDone: true }) === 7,
      'a large budget must floor at 7 minutes (the spec\'s minimum)')
check(pollIntervalMinutes({ used: DAILY_CAP - 1, liveEndsAt: '2026-10-03T21:00:00Z', now: '2026-10-03T19:00:00Z', dailyDone: true }) === null,
      'with only the finals reserve left, nothing is affordable')
const spread = pollIntervalMinutes({ used: 80, liveEndsAt: '2026-10-03T21:00:00Z', now: '2026-10-03T19:00:00Z', dailyDone: true })
check(spread === 14, `120 min over 9 affordable polls must give 14 min (got ${spread})`)
const clipped = pollIntervalMinutes({ used: 80, liveEndsAt: '2026-10-04T02:00:00Z', now: '2026-10-03T23:00:00Z', dailyDone: true })
check(clipped === 7, `the window is clipped at the 00:00 UTC quota reset (got ${clipped})`)

// Men's senior only: youth and women's sides are dropped (real names seen 2026-10-04).
const fx = (h, a) => ({ teams: { home: { name: h }, away: { name: a } } })
for (const [h, a, want] of [['Italy', 'Türkiye', true], ['Portugal U18', 'Turkey U18', false], ['Spain U-21', 'France U-21', false],
     ['England W', 'Wales W', false], ['Brazil Women', 'Chile Women', false], ['Turks and Caicos Islands', 'British Virgin Islands', true],
     ['Wolves', 'Watford', true], ['Under 20 Argentina', 'Chile', false], ['Bayer 04 Leverkusen', 'FC Utrecht', true]])
  check(isSeniorMenFixture(fx(h, a)) === want, `${h} – ${a} should be ${want ? 'kept' : 'dropped'}`)

// F1 (shapes from a real races?date response, 2026-10-03).
check(mapSessionType('Race') === 'race' && mapSessionType('Sprint') === 'sprint', 'race / sprint')
check(mapSessionType('1st Practice') === 'practice1' && mapSessionType('3rd Practice') === 'practice3', 'practice numbering')
check(mapSessionType('Sprint Shootout') === 'sprint_qualifying' && mapSessionType('1st Qualifying') === 'qualifying', 'qualifying kinds')
check(mapSessionType('Warm-up') === null, 'an unknown session type must map to null (skipped)')
check(mapRaceStatus('Completed') === 'finished' && mapRaceStatus('Scheduled') === 'scheduled' && mapRaceStatus('??') === null, 'race status map')
const realRace = { id: 2727, competition: { id: 2, name: 'Bahrain Grand Prix', location: { country: 'Bahrain', city: 'Sakhir' } },
  circuit: { id: 62, name: 'Sepang International Circuit' }, season: 2026, type: 'Race', date: '2026-10-04T07:00:00+00:00', status: 'Scheduled' }
const sr = sessionRowFrom(realRace, now)
check(sr.row && sr.row.api_race_id === 2727 && sr.row.session_type === 'race' && sr.row.status === 'scheduled'
      && sr.row.circuit === 'Sepang International Circuit' && sr.row.season === 2026, `f1 session row wrong: ${JSON.stringify(sr)}`)
const rr = resultRowFrom({ position: 1, driver: { name: 'Max Verstappen', abbr: 'VER' }, team: { name: 'Red Bull Racing' }, time: '1:31:44.742', laps: 56, grid: '2' }, 9, true, now)
check(rr && rr.position === 1 && rr.driver_code === 'VER' && rr.grid === 2 && rr.is_final === true, `f1 result row wrong: ${JSON.stringify(rr)}`)
check(resultRowFrom({ position: 3 }, 9, false, now) === null, 'a result without a driver name is dropped')
check(rr.points === 25, `P1 scores 25 (got ${rr.points})`)
const p11 = resultRowFrom({ position: 11, driver: { name: 'X' }, time: null, gap: '+48.2s', laps: 55 }, 9, true, now)
check(p11.points === 0 && p11.time_text === '+48.2s', `P11: 0 points and the gap as time_text (got ${JSON.stringify(p11)})`)
const p10 = resultRowFrom({ position: '10', driver: { name: 'Y' }, time: { time: '+1 Lap' }, grid: { position: 7 } }, 9, true, now)
check(p10.points === 1 && p10.time_text === '+1 Lap' && p10.grid === 7, `string position, object time/grid (got ${JSON.stringify(p10)})`)
const noPos = resultRowFrom({ position: null, driver: { name: 'Z' } }, 9, true, now)
check(noPos.points === null && noPos.time_text === null, 'an unclassified row carries no points and no time')

// The gate: only a service_role token passes.
const tok = role => 'x.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.y'
const req = h => ({ headers: { get: k => (k === 'authorization' ? h : null) } })
check(callerIsServiceRole(req('Bearer ' + tok('service_role'))) === true, 'service_role token must pass')
check(callerIsServiceRole(req('Bearer ' + tok('anon'))) === false, 'the anon key must be refused')
check(callerIsServiceRole(req('')) === false, 'no token must be refused')
check(callerIsServiceRole(req('Bearer sb_secret_abc'), 'sb_secret_abc') === true, 'the exact service key must pass')
check(callerIsServiceRole(req('Bearer sb_publishable_x'), 'sb_secret_abc') === false, 'another non-JWT key must be refused')

if (problems.length) {
  console.error('live-scores sync check FAILED:')
  for (const p of problems) console.error('  ✗ ' + p)
  process.exit(1)
}
console.log('live-scores sync check: OK (status maps, rows, events, interval, caller gate)')

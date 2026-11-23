#!/usr/bin/env node
// KTFF live scores sync: offline checks.
//   node scripts/check-ktff-sync.mjs
// Tests supabase/functions/_shared/ktff.mjs without a network or a database: tolerant parsing, the Asia/Famagusta
// kickoff conversion, back-off math, one request's outcomes (200 / 304 / 403 / 429 / non-JSON / timeout), and whole
// runs against an in-memory store and a scripted fetch. Fixtures follow the shape documented at ktff.org/sitene-ekle/api
// (read 2026-11-23). NOT evidence of: the live API (403 until KTFF approves our Origin), real Postgres, Deno's fetch.
import {
  cleanText, cleanInt, cleanColor, ktffLogoSource, localToUtcIso, mergeLegend, parseStandingsItem, parseStandings, parseFixtures,
  parseRetryAfter, exponentialBackoffMs, planBackoff, ktffGet, sniffImage, makeLogoCopier, runKtff, handle,
  REQUEST_BUDGET, KTFF_ORIGIN, KTFF_BASE, LOGO_MAX_BYTES,
} from '../supabase/functions/_shared/ktff.mjs'

const problems = []
const check = (ok, msg) => { if (!ok) problems.push(msg) }
const eq = (got, want, msg) => check(JSON.stringify(got) === JSON.stringify(want), `${msg}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
const MIN = 60000, HOUR = 3600000

// sanitising
eq(cleanText('  Mağusa\u0000 Türk​  Gücü\n'), 'Mağusa Türk Gücü', 'control chars and zero-width stripped, spaces collapsed')
eq(cleanText('x'.repeat(500), 10), 'xxxxxxxxxx', 'length cap')
eq([cleanText(''), cleanText('   '), cleanText(5), cleanText(null)], [null, null, null, null], 'blank / non-string text is null')
eq([cleanInt(3), cleanInt(-7), cleanInt('3'), cleanInt(1.5), cleanInt(null), cleanInt(2 ** 40)], [3, -7, null, null, null, null], 'ints')
eq([cleanColor('#00FF7a'), cleanColor('00ff7a'), cleanColor('#0f0'), cleanColor('#00ff7aff'), cleanColor(null)], ['#00FF7a', null, null, null, null], 'colours')
eq(ktffLogoSource('https://ktff.org/storage/a.png'), 'https://ktff.org/storage/a.png', 'ktff.org logo kept')
for (const bad of ['http://ktff.org/a.png', 'https://evilktff.org/a.png', 'https://ktff.org.evil.com/a.png', 'https://user:p@ktff.org/a.png',
  'https://ktff.org:8443/a.png', 'https://127.0.0.1/a.png', 'https://example.com/a.png', '/storage/a.png', '', null, 'javascript:alert(1)'])
  eq(ktffLogoSource(bad), null, `logo source refused: ${bad}`)

// time zone
eq(localToUtcIso('2026-11-29 15:00'), '2026-11-29T13:00:00.000Z', 'winter kickoff is UTC+2')
eq(localToUtcIso('2026-07-12 20:00'), '2026-07-12T17:00:00.000Z', 'summer kickoff is UTC+3')
eq([localToUtcIso(''), localToUtcIso('2026-02-30 10:00'), localToUtcIso('2026-11-29T15:00'), localToUtcIso('2026-11-29 25:00'), localToUtcIso(null)],
  [null, null, null, null, null], 'blank / impossible / malformed local time is null')

// standings parsing
const row = (rank, id, name, over = {}) => ({ rank, team_id: id, team: name, team_logo: `https://ktff.org/logos/${id}.png`, played: 10, won: 5, drawn: 3, lost: 2,
  goals_for: 20, goals_against: 12, goal_difference: 8, points: 18, position_marker: null, ...over })
const mk = { id: 1, color: '#00AA00', text_color: '#FFFFFF' }
const standingsJson = {
  available_leagues: [{ id: 1, name_tr: 'Süper Lig', name_en: 'Super League', logo: '' }],
  data: [
    { league_id: 1, name_tr: 'Süper Lig', name_en: 'Super League', logo: 'https://ktff.org/logos/l1.png',
      data_tr: [
        row(1, 11, 'Çetinkaya', { position_marker: mk }),
        row(2, 12, 'Mağusa Türk Gücü'),
        row(3, 13, 'Yenicami', { goal_difference: -14, points: -2, team_logo: 'https://evil.example.com/x.png' }),
        { rank: 'bad', team_id: 'x', team: 'broken' },
      ],
      data_en: [row(1, 11, 'Cetinkaya', { position_marker: mk }), row(2, 12, 'Magusa Turk Gucu'), row(3, 13, 'Yenicami', { team_logo: 'https://evil.example.com/x.png' })],
      position_legend_tr: [{ id: 1, color: '#00AA00', text_color: '#FFFFFF', text: 'Şampiyonlar Ligi' }, { id: 2, color: '#FF0000', text_color: '#FFFFFF', label: 'Küme düşme' }],
    },
    { league_id: 2, name_tr: '1. Lig', name_en: '1st League', logo: '', data_tr: [], data_en: [], position_legend_tr: [], position_legend_en: [] },
    { league_id: 7, name_tr: 'unknown league', data_tr: [row(1, 99, 'Z')] },
  ],
}
const parsed = parseStandings(standingsJson)
eq(parsed.map(p => p.league_id), [1, 2], 'league 7 ignored')
const l1 = parsed[0]
eq(l1.rows.map(r => r.team_id), [11, 12, 13], 'the broken row is skipped')
eq(l1.rows[0].team_tr + '|' + l1.rows[0].team_en, 'Çetinkaya|Cetinkaya', 'tr and en merged by team_id')
eq([l1.rows[2].goal_difference, l1.rows[2].points], [-14, -2], 'negative goal difference and points survive')
eq(l1.rows[2].source_logo_url, null, 'non-ktff logo host is NULL')
eq(l1.rows[0].source_logo_url, 'https://ktff.org/logos/11.png', 'ktff logo kept')
eq([l1.rows[0].marker_id, l1.rows[0].marker_color, l1.rows[0].marker_text_color], [1, '#00AA00', '#FFFFFF'], 'position marker')
eq([l1.rows[1].marker_id, l1.rows[1].marker_color], [null, null], 'no marker is NULL')
eq(l1.legend, [
  { id: 1, color: '#00AA00', text_color: '#FFFFFF', label_tr: 'Şampiyonlar Ligi', label_en: 'Şampiyonlar Ligi' },
  { id: 2, color: '#FF0000', text_color: '#FFFFFF', label_tr: 'Küme düşme', label_en: 'Küme düşme' },
], 'missing position_legend_en falls back to Turkish; label from text|label')
eq(parsed[1].rows, [], 'empty data arrays give no rows')
eq(parsed[1].legend, [], 'empty legend')
eq(parseStandings(null), [], 'null body')
eq(parseStandings({ data: 'nope' }), [], 'wrong-shaped data')
eq(mergeLegend([{ id: 1, color: 'red', name: 'N' }], [{ id: 1, title: 'T' }, { id: 2, label: 'E-only' }]),
  [{ id: 1, color: null, text_color: null, label_tr: 'N', label_en: 'T' }, { id: 2, color: null, text_color: null, label_tr: 'E-only', label_en: 'E-only' }],
  'legend merge by id, label from text|label|name|title, bad colour NULL')

// fixtures parsing
const m = (id, h, a, hs, as, dt, over = {}) => ({ match_id: id, home_team: h, home_logo: 'https://ktff.org/l/h.png', home_score: hs, away_score: as, away_team: a, away_logo: 'https://ktff.org/l/a.png', match_datetime: dt, ...over })
const fixJson = {
  league_id: 1, name_tr: 'Süper Lig', name_en: 'Super League', logo: 'https://ktff.org/logos/l1.png', selected_week: 5, available_weeks: [3, 1, 2, 5, 4, 4, 'x'],
  data_tr: [m(101, 'Çetinkaya', 'Yenicami', '2', '1', '2026-11-22 15:00'), m(102, 'MTG', 'Doğan', '', '', ''), m(103, 'A', 'B', '', '', '2026-11-29 15:00', { home_logo: 'https://other.example/x.png' }), { match_id: 'x' }],
  data_en: [m(101, 'Cetinkaya', 'Yenicami', '2', '1', '2026-11-22 15:00'), m(102, 'MTG', 'Dogan', '', '', ''), m(103, 'A', 'B', '', '', '2026-11-29 15:00', { home_logo: 'https://other.example/x.png' })],
}
const f = parseFixtures(fixJson, 1, null)
eq(f.available_weeks, [1, 2, 3, 4, 5], 'available_weeks ints, unique, ascending')
eq(f.rows.map(r => r.match_id), [101, 102, 103], 'a match without an integer id is skipped')
eq([f.rows[0].home_score, f.rows[0].away_score, f.rows[0].kickoff_at, f.rows[0].match_local], ['2', '1', '2026-11-22T13:00:00.000Z', '2026-11-22 15:00'], 'played match')
eq([f.rows[1].home_score, f.rows[1].away_score, f.rows[1].kickoff_at, f.rows[1].match_local], [null, null, null, null], "'' scores and '' datetime are NULL")
eq(f.rows[0].home_team_tr + '|' + f.rows[0].home_team_en + '|' + f.rows[1].away_team_tr + '|' + f.rows[1].away_team_en, 'Çetinkaya|Cetinkaya|Doğan|Dogan', 'fixture names tr / en')
eq(f.rows[2].home_source_logo_url, null, 'non-ktff fixture logo is NULL')
eq(f.rows.every(r => r.week === 5 && r.league_id === 1), true, 'rows carry selected_week and league')
eq(parseFixtures({ league_id: 1, selected_week: 9, available_weeks: [9], data_tr: [], data_en: [] }, 1, 9).rows, [], 'empty week')
eq(parseFixtures(undefined, 2, 3).rows, [], 'undefined body')

// back-off math
eq([1, 2, 3, 4, 5, 6, 12].map(exponentialBackoffMs).map(x => x / MIN), [15, 30, 60, 120, 240, 360, 360], 'exponential 15 min doubling, cap 6 h')
const NOW = Date.UTC(2026, 10, 23, 9, 0, 0)
const p403 = planBackoff({ outcome: 'http', status: 403, failCount: 0, nowMs: NOW })
eq([p403.delayMs / HOUR, p403.stop, p403.failCount, p403.nextAllowedAt], [6, true, 1, '2026-11-23T15:00:00.000Z'], '403: +6 h, stop')
const p429 = planBackoff({ outcome: 'http', status: 429, retryAfterHeader: '120', failCount: 2, nowMs: NOW })
eq([p429.delayMs / MIN, p429.stop, p429.failCount], [2, true, 3], '429 Retry-After 120 honoured, stop')
eq(planBackoff({ outcome: 'http', status: 429, retryAfterHeader: '5', nowMs: NOW }).delayMs / MIN, 1, 'Retry-After floor 1 min')
eq(planBackoff({ outcome: 'http', status: 429, retryAfterHeader: '999999', nowMs: NOW }).delayMs / HOUR, 24, 'Retry-After cap 24 h')
eq(planBackoff({ outcome: 'http', status: 503, retryAfterHeader: new Date(NOW + 10 * MIN).toUTCString(), nowMs: NOW }).delayMs / MIN, 10, '503 HTTP-date Retry-After')
const p503 = planBackoff({ outcome: 'http', status: 503, failCount: 2, nowMs: NOW })
eq([p503.delayMs / MIN, p503.stop], [60, false], '503 without header: exponential, no stop')
eq(planBackoff({ outcome: 'http', status: 429, failCount: 0, nowMs: NOW }).delayMs / MIN, 15, '429 without header: 15 min')
for (const [o, s] of [['http', 500], ['http', 502], ['network', 0], ['non_json', -1], ['store', 0]])
  eq(planBackoff({ outcome: o, status: s, failCount: 1, nowMs: NOW }).delayMs / MIN, 30, `${o} ${s}: exponential`)
for (const s of [404, 422]) eq(planBackoff({ outcome: 'http', status: s, failCount: 5, nowMs: NOW }).delayMs / HOUR, 6, `${s}: 6 h`)
eq([parseRetryAfter('30', NOW), parseRetryAfter(null, NOW), parseRetryAfter('soon', NOW), parseRetryAfter(new Date(NOW - 5000).toUTCString(), NOW)], [30000, null, null, 0], 'Retry-After parsing')

// one request
const hdrs = h => ({ get: k => h[String(k).toLowerCase()] ?? null })
const res = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: hdrs(headers), body: { cancel: async () => {} }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) })
let seen
const fetchOnce = r => async (url, init) => { seen = { url, init }; return r }
let r = await ktffGet(fetchOnce(res(200, { a: 1 }, { etag: '"v1"' })), '/fikstur', { league_id: '1', week: 'now' }, '"v0"')
eq([r.outcome, r.status, r.etag, r.json], ['ok', 200, '"v1"', { a: 1 }], '200 parsed with ETag')
eq([seen.url, seen.init.headers.Origin, seen.init.headers.Accept, seen.init.headers['If-None-Match']],
  [`${KTFF_BASE}/fikstur?league_id=1&week=now`, KTFF_ORIGIN, 'application/json', '"v0"'], 'request headers and URL')
await ktffGet(fetchOnce(res(200, {})), '/puan-durumu', {}, null)
eq([seen.url, 'If-None-Match' in seen.init.headers], [`${KTFF_BASE}/puan-durumu`, false], 'no ETag, no If-None-Match')
eq((await ktffGet(fetchOnce(res(304, '')), '/x', {}, '"v1"')).outcome, 'not_modified', '304')
r = await ktffGet(fetchOnce(res(403, { message: 'x' })), '/x', {}, null)
eq([r.outcome, r.status], ['http', 403], '403')
r = await ktffGet(fetchOnce(res(429, '', { 'retry-after': '90' })), '/x', {}, null)
eq([r.outcome, r.status, r.retryAfter], ['http', 429, '90'], '429 carries Retry-After')
eq((await ktffGet(fetchOnce(res(200, '<html>maintenance</html>')), '/x', {}, null)).outcome, 'non_json', 'HTML 200 is non_json')
eq((await ktffGet(async () => { throw new Error('boom') }, '/x', {}, null)).outcome, 'network', 'thrown fetch is network')
const hang = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))))
r = await ktffGet(hang, '/x', {}, null, 25)
eq([r.outcome, r.status], ['network', 0], 'hung request times out')

// logos
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const SVGBYTES = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
eq(sniffImage(SVGBYTES), null, 'svg is not an accepted image')
check(!!sniffImage(PNG), 'png is sniffed')
const streamOf = bytes => ({ getReader: () => { let sent = false; return { read: async () => (sent ? { done: true } : (sent = true, { done: false, value: bytes })), cancel: async () => {} } } })
const imgRes = (bytes, type, extra = {}) => ({ status: 200, ok: true, headers: hdrs({ 'content-type': type, ...extra }), body: streamOf(bytes), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })
const storage = { upload: async () => ({ error: null }), publicUrl: p => `https://proj.supabase.co/storage/v1/object/public/team-logos/${p}` }
const copier = fx => makeLogoCopier({ fetchImpl: fx, storage })
const got = await copier(async () => imgRes(PNG, 'image/png'))('https://ktff.org/logos/11.png')
check(/^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/public\/team-logos\/ktff\/[0-9a-f]{16}\.png$/.test(got), `logo copied under ktff/<16 hex>.png, got ${got}`)
eq(await copier(async () => imgRes(PNG, 'image/png'))('https://ktff.org/logos/11.png'), got, 'same source, same path')
eq(await copier(async () => { throw new Error('must not fetch') })('https://example.com/x.png'), null, 'non-ktff host: no fetch')
eq(await copier(async () => imgRes(SVGBYTES, 'image/svg+xml'))('https://ktff.org/l.svg'), null, 'SVG refused')
eq(await copier(async () => imgRes(SVGBYTES, 'image/png'))('https://ktff.org/l.png'), null, 'SVG bytes labelled png refused')
eq(await copier(async () => imgRes(PNG, 'image/png', { 'content-length': String(LOGO_MAX_BYTES + 1) }))('https://ktff.org/l.png'), null, 'declared oversize refused')
eq(await copier(async () => imgRes(new Uint8Array(LOGO_MAX_BYTES + 1).fill(7), 'image/png'))('https://ktff.org/l.png'), null, 'streamed oversize refused')
eq(await copier(async () => ({ status: 302, ok: false, headers: hdrs({ location: 'https://evil.example/x' }) }))('https://ktff.org/l.png'), null, 'redirect not followed')
eq(await makeLogoCopier({ fetchImpl: async () => imgRes(PNG, 'image/png'), storage: { upload: async () => ({ error: { message: 'x' } }), publicUrl: () => 'u' } })('https://ktff.org/l.png'), null, 'upload error gives null')

// whole runs: in-memory store, scripted KTFF
function memStore() {
  const s = { states: new Map(), leagues: new Map(), standings: new Map(), fixtures: new Map(), deletes: 0, failOn: null }
  const key = (l, t) => `${l}:${t}`
  return {
    s,
    async loadStates() { return new Map(s.states) },
    async saveState(ep, patch) { s.states.set(ep, { ...(s.states.get(ep) ?? { endpoint: ep, fail_count: 0 }), ...patch }) },
    async loadLeagues() { return new Map(s.leagues) },
    async loadLogoCache() { const c = new Map(); for (const x of [...s.leagues.values(), ...s.standings.values()]) if (x.source_logo_url && x.logo_url) c.set(x.source_logo_url, x.logo_url); return c },
    async upsertLeague(rw) { s.leagues.set(rw.league_id, { ...(s.leagues.get(rw.league_id) ?? { legend: [], available_weeks: [] }), ...rw }) },
    async upsertStandings(rows) { if (s.failOn === 'standings') throw new Error('db down'); for (const x of rows) s.standings.set(key(x.league_id, x.team_id), { ...(s.standings.get(key(x.league_id, x.team_id)) ?? {}), ...x }) },
    async pruneStandings(l, keep) { for (const k of [...s.standings.keys()]) { const [kl, kt] = k.split(':').map(Number); if (kl === l && !keep.includes(kt)) { s.standings.delete(k); s.deletes++ } } },
    async upsertFixtures(rows) { for (const x of rows) s.fixtures.set(x.match_id, { ...(s.fixtures.get(x.match_id) ?? {}), ...x }) },
    async fixtureWeeks(l) { return new Set([...s.fixtures.values()].filter(x => x.league_id === l).map(x => x.week)) },
    async pendingLogoSources() {
      const o = new Set()
      for (const x of [...s.standings.values(), ...s.leagues.values()]) if (x.source_logo_url && !x.logo_url) o.add(x.source_logo_url)
      for (const x of s.fixtures.values()) { if (x.home_source_logo_url && !x.home_logo_url) o.add(x.home_source_logo_url); if (x.away_source_logo_url && !x.away_logo_url) o.add(x.away_source_logo_url) }
      return o
    },
    async setLogo(src, url) {
      for (const x of [...s.standings.values(), ...s.leagues.values()]) if (x.source_logo_url === src && !x.logo_url) x.logo_url = url
      for (const x of s.fixtures.values()) { if (x.home_source_logo_url === src && !x.home_logo_url) x.home_logo_url = url; if (x.away_source_logo_url === src && !x.away_logo_url) x.away_logo_url = url }
    },
  }
}
const weekJson = (L, w) => ({ league_id: L, name_tr: `L${L}`, name_en: `L${L}en`, logo: '', selected_week: w, available_weeks: Array.from({ length: 12 }, (_, i) => i + 1),
  data_tr: [m(L * 1000 + w, 'H', 'A', '1', '0', '2026-11-22 15:00')], data_en: [m(L * 1000 + w, 'H', 'A', '1', '0', '2026-11-22 15:00')] })
function scriptedFetch(script) {
  const calls = []
  const fx = async (url, init) => {
    if (!url.startsWith(KTFF_BASE)) return imgRes(PNG, 'image/png')
    const u = new URL(url)
    const k = u.pathname.endsWith('puan-durumu') ? 'standings' : `fixtures:${u.searchParams.get('league_id')}:${u.searchParams.get('week')}`
    calls.push({ k, inm: init.headers['If-None-Match'] ?? null, origin: init.headers.Origin })
    return script(k, init)
  }
  fx.calls = calls
  return fx
}
const okScript = k => {
  if (k === 'standings') return res(200, standingsJson, { etag: '"s1"' })
  const [, L, w] = k.split(':')
  return res(200, weekJson(+L, w === 'now' ? 5 : +w), { etag: `"f-${k}"` })
}
let nowT = Date.UTC(2026, 10, 23, 9, 0, 0)
const clock = () => nowT
const cp = fx => makeLogoCopier({ fetchImpl: fx, storage })
const runWith = (st, fx) => runKtff(st, { fetchImpl: fx, copyLogo: cp(fx), nowFn: clock })

{
  const st = memStore(); const fx = scriptedFetch(okScript)
  const out = await runWith(st, fx)
  check(fx.calls.length <= REQUEST_BUDGET, `a run spends at most ${REQUEST_BUDGET} requests, spent ${fx.calls.length}`)
  eq(fx.calls.slice(0, 5).map(c => c.k), ['standings', 'fixtures:1:now', 'fixtures:2:now', 'fixtures:1:4', 'fixtures:2:4'], 'order: standings, this week, previous week')
  check(fx.calls.every(c => c.origin === KTFF_ORIGIN), 'every request sends the Origin')
  check(out.ok === true, 'first run ok')
  eq(st.s.leagues.get(1).current_week, 5, 'current_week from selected_week')
  eq(st.s.standings.get('1:11').logo_url?.includes('/team-logos/ktff/'), true, 'ktff logo copied, our URL stored')
  eq(st.s.standings.get('1:13').logo_url ?? null, null, 'non-ktff logo never gets a URL')
  eq([st.s.states.get('standings').etag, st.s.states.get('standings').fail_count, st.s.states.get('standings').next_allowed_at], ['"s1"', 0, null], 'standings state after a clean run')
  eq(st.s.deletes, 0, 'nothing deleted on a first run')
  st.s.standings.set('2:50', { league_id: 2, team_id: 50, rank: 1 })
  nowT += 10 * MIN
  const fx2 = scriptedFetch((k, init) => (init.headers['If-None-Match'] ? res(304, '') : okScript(k)))
  await runWith(st, fx2)
  eq(st.s.standings.has('2:50'), true, 'an empty league response never deletes that league standings')
  eq(fx2.calls.find(c => c.k === 'standings').inm, '"s1"', 'second run sends the stored ETag')
  eq(st.s.states.get('standings').last_success_at, new Date(nowT).toISOString(), '304 bumps last_success_at')
  eq(st.s.states.get('standings').etag, '"s1"', '304 keeps the ETag')
  const st3 = memStore(); const fx3 = scriptedFetch(okScript)
  await runWith(st3, fx3)
  st3.s.standings.set('1:77', { league_id: 1, team_id: 77 })
  nowT += HOUR
  await runWith(st3, scriptedFetch(okScript))
  eq(st3.s.standings.has('1:77'), false, 'a team missing from a NON-empty league response is pruned')
}

{
  nowT = Date.UTC(2026, 10, 23, 9, 0, 0)
  const st = memStore(); const fx = scriptedFetch(() => res(403, { message: 'x' }))
  const out = await runWith(st, fx)
  eq([fx.calls.length, out.ok], [1, false], '403: one request only')
  const s = st.s.states.get('standings')
  eq([s.last_status, s.fail_count, s.next_allowed_at], [403, 1, '2026-11-23T15:00:00.000Z'], '403 recorded')
  eq([st.s.standings.size, st.s.fixtures.size], [0, 0], '403 wrote no data')
  nowT += 2 * HOUR
  const fx2 = scriptedFetch(okScript)
  const out2 = await runWith(st, fx2)
  eq([out2.skipped, fx2.calls.length], ['backoff', 0], 'inside the back-off window: no request')
  nowT += 5 * HOUR
  const out3 = await runWith(st, scriptedFetch(okScript))
  eq([out3.ok, st.s.states.get('standings').fail_count, st.s.states.get('standings').last_status], [true, 0, 200], 'after the window the flip to 200 is picked up')
}

{
  nowT = Date.UTC(2026, 10, 23, 9, 0, 0)
  const st = memStore()
  await runWith(st, scriptedFetch(okScript))
  const before = [st.s.standings.size, st.s.fixtures.size]
  nowT += 7 * HOUR
  const f5 = scriptedFetch(k => (k === 'standings' ? res(500, '') : k.startsWith('fixtures:1') ? res(429, '', { 'retry-after': '1800' }) : okScript(k)))
  const out = await runWith(st, f5)
  eq(f5.calls.map(c => c.k), ['standings', 'fixtures:1:now'], '500 continues; 429 stops')
  eq([st.s.standings.size, st.s.fixtures.size], before, 'failures delete nothing')
  eq(st.s.states.get('standings').next_allowed_at, new Date(nowT + 30 * MIN).toISOString(), 'global gate is the longest back-off of the run')
  eq([st.s.states.get('fixtures:1').last_status, out.ok], [429, false], '429 recorded on its endpoint; run not ok')
}

{
  nowT = Date.UTC(2026, 10, 23, 9, 0, 0)
  const st = memStore(); st.s.failOn = 'standings'
  const out = await runWith(st, scriptedFetch(okScript))
  eq([st.s.states.get('standings').etag ?? null, st.s.states.get('standings').fail_count, out.ok], [null, 1, false], 'DB error: no ETag stored, failure counted')
}

{
  nowT = Date.UTC(2026, 10, 23, 9, 0, 0)
  const st = memStore()
  const out = await runWith(st, scriptedFetch(() => res(200, '<html>maintenance</html>')))
  eq([st.s.states.get('standings').last_status, st.s.states.get('standings').fail_count, out.ok], [-1, 1, false], 'non-JSON recorded as status -1')
}

// the handler gate
const mkReq = (method, auth) => new Request('https://x.test/', { method, headers: auth ? { authorization: auth } : {} })
const jwt = role => 'h.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.s'
const noClient = () => { throw new Error('must not reach the database') }
const env = k => (k === 'SUPABASE_SERVICE_ROLE_KEY' ? 'sb_secret_test' : 'x')
eq((await handle(mkReq('POST', 'Bearer ' + jwt('anon')), noClient, env)).status, 403, 'anon key refused')
eq((await handle(mkReq('POST', null), noClient, env)).status, 403, 'no token refused')
eq((await handle(mkReq('POST', 'Bearer ' + jwt('authenticated')), noClient, env)).status, 403, 'user token refused')

if (problems.length) {
  console.error('ktff sync check FAILED:')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log('ktff sync check: OK (parsing, Famagusta time, back-off, 200/304/403/429, runs, logo guard, caller gate)')

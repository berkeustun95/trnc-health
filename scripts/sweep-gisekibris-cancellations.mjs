#!/usr/bin/env node
// ─── Unattended cancellation sweep ───────────────────────────────────────────
//
//   node scripts/sweep-gisekibris-cancellations.mjs --dry    # decide, write nothing
//   node scripts/sweep-gisekibris-cancellations.mjs          # apply
//   node scripts/sweep-gisekibris-cancellations.mjs --selftest
//   … --null-dead-links   also set ticket_url = null on rows whose page is dead
//
// ─── DEAD LINKS (2026-11-25, issue #601) ────────────────────────────────────
//
// check-gisekibris-urls.mjs only probes rows IN today's feed. Two stand-up shows left
// the feed on 19 Nov and their pages went 404; this sweep probed them every day, filed
// the 404 under UNKNOWN in its log, and nothing else saw it: the Buy Ticket button
// opened a 404 for a week. Now every upcoming approved row absent from the feed (held
// rows included) gets a link verdict too, and dead ones go in --report (dead_links),
// which the workflow lists in the "rows need a decision" issue.
// A dead link NEVER cancels: decide() is unchanged and a 404 is still 'unknown' there.
// --null-dead-links hides the button (ticket_url only, never status), capped at
// MAX_NULL; without it the scheduled run only reports.
//
// Runs LAST in the daily pipeline, after fetch → prepare → check-urls → import.
//
// ─── WHAT IT IS FOR ─────────────────────────────────────────────────────────
//
// The partner's feed is a ROLLING FULL CATALOGUE (confirmed 2026-09-20: "Bunlar şu
// anda aktifler"), so a row we hold that is absent from a fresh feed is either
// past-dated or cancelled. The importer reports those rows and never deletes them,
// which is correct while a human reads the report — and useless unattended. This
// closes that gap for the one case that can be decided mechanically.
//
// ─── WHY IT IS NOT JUST "ABSENT FROM THE FEED, SO CANCEL IT" ────────────────
//
// Absence is necessary, not sufficient. THE ONLY THING THAT CANCELS A ROW HERE IS
// THE PARTNER'S OWN FLAG READING LITERALLY TRUE on that row's own page. Absent,
// missing, malformed, ambiguous, unreachable, non-200 — every one of those means
// LEAVE IT ALONE and say so by name.
//
// That asymmetry is deliberate and it is the whole design. A false cancel hides a
// real event from every user and nothing in the app would report it; a missed
// cancel leaves one stale card that the 24h cutoff eventually eats. Those costs
// are not comparable, so the tie is broken the same way every time.
//
//   ⚠ ABSENT IS UNKNOWN, AND UNKNOWN IS NOT CANCELLED. About a quarter of the
//     partner's pages are a seat-map render that carries no isCancelled key at
//     all. On 2026-09-24, FAMUSIC X CHILL was absent from the feed, future-dated,
//     and sat between two rows that both read TRUE — and it STAYS APPROVED,
//     because its own page says nothing. Do not relax this because the neighbours
//     were cancelled; that is the reasoning that turns a probe into a guess.
//
// ─── FOUR STRUCTURAL LIMITS ─────────────────────────────────────────────────
//
//   1. SCOPE. Eligible = source='gisekibris' AND status='approved' AND
//      start_date >= now() AND external_id absent from the feed just imported.
//      Nothing else is even looked at.
//   2. IT NEVER UN-CANCELS. The write filters on status='approved', so a cancelled
//      row is unreachable by this script whatever a later fetch says.
//      Reinstatement is a human decision, permanently.
//   3. THE CAP — see MAX_CANCEL / MAX_SHARE below. This is the guard against a
//      feed glitch becoming dozens of silent cancellations.
//   4. A PROBE FAILURE IS NOT A VERDICT. Network error, timeout, non-200, absent
//      flag, two contradictory flags: all are reported and none is acted on.
//
// Every decision is printed with the evidence it was made on — the row, the
// verdict, and what the probe actually read — so the log can be audited without
// re-running anything.
import { createClient } from '@supabase/supabase-js'
import { readAllResult } from './lib/read-all-rows.mjs'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prodWriteGuard } from './lib/prod-write-guard.mjs'
import { isNotFoundPage } from './lib/gisekibris-page.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SEED = resolve(ROOT, 'supabase/seed/gisekibris-events-clean.json')
const SOURCE = 'gisekibris'
const TIMEOUT_MS = 20000
const CONCURRENCY = 4
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// ─── THE CAP, and why it is two numbers ─────────────────────────────────────
//
// A feed glitch is the failure this exists for. The fetch step already refuses an
// empty or malformed response, but a PARTIALLY truncated feed — 5 rows where 37
// were expected — passes every guard upstream and makes 32 healthy rows look
// absent. Without a cap this script would then cancel 32 live events overnight,
// one page at a time, with a tidy log.
//
// MAX_CANCEL is absolute: 5. The real batch on 2026-09-24 was 2. Five leaves room
// for a genuinely bad week (a venue closing, a promoter pulling a run) while being
// far below any plausible truncation.
//
// MAX_SHARE is proportional: 0.25. The absolute number alone is not enough when
// the catalogue is small — 5 of 8 eligible rows is a catastrophe that 5 permits.
//
// BOTH must pass. Exceeding either is a STOP, not a warning: it exits non-zero
// having written nothing, and names every candidate so a human can act.
const MAX_CANCEL = 5
const MAX_SHARE = 0.25

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const selftest = args.includes('--selftest')
const nullDead = args.includes('--null-dead-links')
prodWriteGuard({ wouldWrite: !dry && !selftest, workflow: 'gisekibris-feed',
  dryHint: 'node scripts/sweep-gisekibris-cancellations.mjs --dry' })

// ─── The decision, as a pure function ───────────────────────────────────────
//
// Separated from all IO precisely so --selftest can drive it directly: the rule is
// the thing worth testing, and a test that needs the network to reach it is a test
// that will be skipped. `probe` is what the reader returned, never a bare boolean.
//   probe = { ok:boolean, status:number|null, flag:true|false|null, error?:string }
// flag === null means absent OR contradictory — both unknown, deliberately merged
// because neither is evidence.
export function decide(row, probe) {
  if (row.status !== 'approved')      return { verdict: 'skip',    why: `status is ${row.status}, not approved` }
  if (row.source !== SOURCE)          return { verdict: 'skip',    why: `source is ${row.source}` }
  if (!(new Date(row.start_date) >= new Date(row.now ?? Date.now())))
                                      return { verdict: 'skip',    why: 'past-dated' }
  if (row.inFeed)                     return { verdict: 'skip',    why: 'present in the current feed' }
  if (row.held)                       return { verdict: 'skip',    why: 'held for Berke (skipped or cancelled in this feed)' }
  if (!row.ticket_url)                return { verdict: 'unknown', why: 'no ticket_url to probe' }
  if (!probe || probe.ok !== true)    return { verdict: 'unknown', why: `probe failed: ${probe?.error ?? `HTTP ${probe?.status ?? '?'}`}` }
  if (probe.flag === true)            return { verdict: 'cancel',  why: 'isCancelled reads literally TRUE' }
  if (probe.flag === false)           return { verdict: 'live',    why: 'isCancelled reads false' }
  return { verdict: 'unknown', why: 'isCancelled absent or contradictory on the page' }
}

// Dead = the partner says the page is not there: 404/410, a /404 landing, or HTTP 200
// rendering their 404 page. A 5xx, timeout or network error is their box or ours,
// never a verdict on the event.
const MAX_NULL = 5
export function linkHealth(probe) {
  if (!probe) return { verdict: 'skip', why: 'no ticket_url' }
  if (probe.status === 404 || probe.status === 410) return { verdict: 'dead', why: `HTTP ${probe.status}` }
  if (/\/404(\/|$|\?)/.test(probe.finalUrl ?? '')) return { verdict: 'dead', why: `redirected to ${probe.finalUrl}` }
  if (probe.notFound) return { verdict: 'dead', why: `HTTP ${probe.status} rendering "404 - Sayfa Bulunamadı"` }
  if (probe.ok === true) return { verdict: 'ok', why: `HTTP ${probe.status}` }
  return { verdict: 'unknown', why: probe.error ?? `HTTP ${probe.status ?? '?'}` }
}

// Rows this run deliberately left OUT of the seed: prepare's skipped rows (when their
// id is known) and the probe's feed_cancelled rows. They are absent from the feed for
// a reason we already know, so they are never swept: Berke decides (2026-11-14).
export function heldIds(meta) {
  return new Set([...(meta?.skipped ?? []), ...(meta?.feed_cancelled ?? [])]
    .flatMap(r => [r?.external_id, r?.also_external_id]).filter(Boolean))
}

// ─── Self-test ──────────────────────────────────────────────────────────────
if (selftest) {
  const base = { status:'approved', source:SOURCE, start_date:'2099-01-01T00:00:00Z', inFeed:false, ticket_url:'u' }
  const T = (label, row, probe, want) => {
    const got = decide(row, probe).verdict
    const ok = got === want
    if (!ok) FAILS++
    console.log(`    ${ok ? '✓' : '✗'} ${label.padEnd(52)} ${got}${ok ? '' : `  wanted ${want}`}`)
  }
  let FAILS = 0
  console.log('\n  the ONLY thing that cancels')
  T('flag TRUE, in scope                          -> cancel', base, {ok:true,status:200,flag:true}, 'cancel')
  console.log('\n  a TRUE that must NOT fire (scope)')
  T('flag TRUE but PAST-dated',      {...base, start_date:'2020-01-01T00:00:00Z'}, {ok:true,status:200,flag:true}, 'skip')
  T('flag TRUE but PRESENT in feed', {...base, inFeed:true},                      {ok:true,status:200,flag:true}, 'skip')
  T('flag TRUE but already cancelled (never un-cancels)', {...base, status:'cancelled'}, {ok:true,status:200,flag:true}, 'skip')
  T('flag TRUE but a draft row',     {...base, status:'draft'},                    {ok:true,status:200,flag:true}, 'skip')
  T('flag TRUE but not our source',  {...base, source:'manual'},                   {ok:true,status:200,flag:true}, 'skip')
  T('flag TRUE but HELD (skipped / feed-cancelled)', {...base, held:true}, {ok:true,status:200,flag:true}, 'skip')
  {
    const h = heldIds({ skipped: [{ external_id: 'gk-A', also_external_id: 'gk-C' }, { external_id: null }], feed_cancelled: [{ external_id: 'gk-B' }] })
    const ok = [...h].sort().join(',') === 'gk-A,gk-B,gk-C'
    if (!ok) FAILS++
    console.log(`    ${ok ? '✓' : '✗'} ${'heldIds: skipped (both ids) + feed_cancelled'.padEnd(52)} ${[...h].sort().join(',')}`)
  }
  console.log('\n  an ABSENT / unreadable flag that must NOT fire')
  T('flag ABSENT (seat-map render)', base, {ok:true,status:200,flag:null},          'unknown')
  T('flag contradictory (two values)', base, {ok:true,status:200,flag:null},        'unknown')
  T('page 404',                      base, {ok:false,status:404,flag:null},         'unknown')
  T('network error',                 base, {ok:false,status:null,flag:null,error:'ECONNRESET'}, 'unknown')
  T('no ticket_url at all',          {...base, ticket_url:null}, {ok:true,status:200,flag:true}, 'unknown')
  console.log('\n  a FALSE flag is live, not unknown')
  T('flag false',                    base, {ok:true,status:200,flag:false},          'live')

  console.log('\n  the cap')
  // 2 of 8 is exactly 0.25 and PASSES: a 25% cap permits 25%. That case was
  // written expecting STOP on the first draft, and the code was right — the
  // boundary belongs in the test precisely because it is easy to get backwards.
  const capCases = [[2,10,'pass'],[5,40,'pass'],[2,8,'pass'],
                    [6,40,'STOP (absolute)'],[3,8,'STOP (share)'],[3,10,'STOP (share)']]
  for (const [n, eligible, want] of capCases) {
    const over = n > MAX_CANCEL || n / eligible > MAX_SHARE
    const got = over ? (n > MAX_CANCEL ? 'STOP (absolute)' : 'STOP (share)') : 'pass'
    const ok = got === want
    if (!ok) FAILS++
    console.log(`    ${ok ? '✓' : '✗'} ${String(n).padStart(2)} of ${String(eligible).padEnd(3)} eligible`.padEnd(56) + `${got}${ok ? '' : `  wanted ${want}`}`)
  }
  console.log('\n  link health (a dead link is reported; it never cancels — see "page 404" above)')
  const L = (label, probe, want) => {
    const got = linkHealth(probe).verdict
    const ok = got === want
    if (!ok) FAILS++
    console.log(`    ${ok ? '✓' : '✗'} ${label.padEnd(52)} ${got}${ok ? '' : `  wanted ${want}`}`)
  }
  L('HTTP 404',                         {ok:false,status:404,flag:null},                       'dead')
  L('HTTP 410',                         {ok:false,status:410,flag:null},                       'dead')
  L('HTTP 200 that renders the 404 page', {ok:true,status:200,flag:null,notFound:true},       'dead')
  L('redirected to /404',               {ok:true,status:200,flag:null,finalUrl:'https://x/404'}, 'dead')
  L('real page',                        {ok:true,status:200,flag:false,notFound:false},        'ok')
  L('HTTP 500 (their box, not a verdict)', {ok:false,status:500,flag:null},                    'unknown')
  L('network error',                    {ok:false,status:null,flag:null,error:'ECONNRESET'},   'unknown')
  L('not probed (no ticket_url)',       null,                                                  'skip')
  for (const [n, want] of [[MAX_NULL, false], [MAX_NULL + 1, true]]) {
    const ok = (n > MAX_NULL) === want
    if (!ok) FAILS++
    console.log(`    ${ok ? '✓' : '✗'} ${`null cap: ${n} dead link(s) ${want ? 'refused' : 'allowed'}`.padEnd(52)}`)
  }

  console.log('\n  the probe reads the page (localhost)')
  {
    const { createServer } = await import('node:http')
    // A real event page carries the not-found text too, inside its i18n dictionary.
    const dict = '"notFound404":"404 - Sayfa Bulunamadı"'
    const srv = createServer((req, res) => {
      const shell = `<html>${dict}<span class="css-x">404 - Sayfa Bulunamadı</span></html>`
      if (req.url === '/gone') { res.writeHead(404); res.end(shell); return }
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(req.url === '/soft' ? shell : `<html>${dict}{"isCancelled":false}</html>`)
    })
    await new Promise(r => srv.listen(0, '127.0.0.1', r))
    const origin = `http://127.0.0.1:${srv.address().port}`
    for (const [path, want] of [['/gone', 'dead'], ['/soft', 'dead'], ['/live', 'ok']]) {
      const got = linkHealth(await readFlag(origin + path)).verdict
      const ok = got === want
      if (!ok) FAILS++
      console.log(`    ${ok ? '✓' : '✗'} ${path.padEnd(52)} ${got}${ok ? '' : `  wanted ${want}`}`)
    }
    srv.close()
    const refused = linkHealth(await readFlag('http://127.0.0.1:1/x')).verdict
    if (refused !== 'unknown') FAILS++
    console.log(`    ${refused === 'unknown' ? '✓' : '✗'} ${'connection refused'.padEnd(52)} ${refused}`)
  }

  console.log(FAILS ? `\n  ${FAILS} self-test failure(s).\n` : '\n  Self-test clean.\n')
  process.exit(FAILS ? 1 : 0)
}

// ─── IO ─────────────────────────────────────────────────────────────────────
function fail(...l){ for(const x of l) console.error(x); process.exit(1) }

function loadEnv() {
  const p = resolve(ROOT, '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}
loadEnv()

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
if (!SUPABASE_URL) fail('EXPO_PUBLIC_SUPABASE_URL missing — expected in .env')
let key
try {
  key = execFileSync('security', ['find-generic-password','-s','ada-supabase-service-role','-w'],
    { encoding:'utf8', stdio:['ignore','pipe','ignore'] }).trim()
} catch { key = process.env.SUPABASE_SERVICE_ROLE_KEY }   // CI supplies it as a secret
if (!key) fail('No service-role key: not in the Keychain and SUPABASE_SERVICE_ROLE_KEY is unset.')

if (!existsSync(SEED)) fail(`Seed not found: ${SEED}. Run fetch + prepare first.`)
const seedJson = JSON.parse(readFileSync(SEED,'utf8'))
const seedEvents = seedJson.events ?? []
const held = heldIds(seedJson.meta)
// The feed set is what decides ABSENCE, so an empty one would make every row a
// candidate. prepare cannot emit an empty seed, but this script must not depend on
// that being true somewhere else.
if (!seedEvents.length) fail('Seed contains zero events — refusing to treat every stored row as absent.')
const feedIds = new Set(seedEvents.map(e => e.external_id))

const sb = createClient(SUPABASE_URL, key, { auth:{persistSession:false, autoRefreshToken:false} })

async function readFlag(url) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { redirect:'follow', signal:ctl.signal, headers:{'User-Agent':UA} })
    const body = await res.text()
    const seen = new Set([...body.matchAll(/"isCancelled"\s*:\s*(true|false)/g)].map(m => m[1] === 'true'))
    // size !== 1 is absent (0) or self-contradictory (2). Both unknown: taking the
    // first of two disagreeing values would invent a definite answer.
    const notFound = isNotFoundPage(body)
    return { ok: res.status === 200 && !notFound, status: res.status, finalUrl: res.url, notFound,
             flag: seen.size === 1 ? [...seen][0] : null }
  } catch (e) {
    return { ok:false, status:null, flag:null, error: e.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : `${e.message}${e.cause ? ` (${e.cause.code ?? e.cause.name}: ${e.cause.message})` : ''} · ${url}` }
  } finally { clearTimeout(timer) }
}

const nowIso = new Date().toISOString()
const { data: rows, error } = await readAllResult((a, b) => sb.from('events')
  .select('external_id,title,start_date,status,source,ticket_url', { count: 'exact' })
  .eq('source', SOURCE).eq('status','approved').gte('start_date', nowIso).order('start_date').order('id').range(a, b))
if (error) fail(`read failed: ${error.message}`)

// Held rows: which are LIVE in the app right now (approved and not over by the app's own
// rule), so the issue can say so. Read separately: a live event may have started already.
const reportArg = args.indexOf('--report')
let report
if (held.size) {
  const { isEventOver } = await import('../utils/eventVisibility.js')
  // unpaged-ok: .in() over this run's held ids, at most the feed's own size (tens of rows)
  const { data: heldRows, error: hErr } = await sb.from('events')
    .select('external_id,title,start_date,end_date,status').eq('source', SOURCE).in('external_id', [...held])
  if (hErr) fail(`read of held rows failed: ${hErr.message}`)
  const byId = new Map((heldRows ?? []).map(r => [r.external_id, r]))
  const tag = r => { const d = byId.get(r.external_id)
    return { ...r, in_app: !!d && d.status === 'approved' && !isEventOver(d), db_status: d?.status ?? null } }
  report = { skipped: (seedJson.meta?.skipped ?? []).map(r => r.external_id ? tag(r) : { ...r, in_app: false, db_status: null }),
                   feed_cancelled: (seedJson.meta?.feed_cancelled ?? []).map(tag) }
  console.log(`\n  held (never swept): ${held.size}`)
  for (const r of [...report.skipped, ...report.feed_cancelled].filter(r => r.external_id))
    console.log(`    ${r.in_app ? 'LIVE IN APP' : 'not in app '}  ${r.external_id}  ${r.title.slice(0, 44)}`)
} else {
  report = { skipped: seedJson.meta?.skipped ?? [], feed_cancelled: [] }
}
report.dead_links = []
// Written on every exit, the cap's STOP and fail() included, so the issue still lists dead links.
if (reportArg !== -1) process.on('exit', () =>
  writeFileSync(resolve(args[reportArg + 1]), JSON.stringify(report, null, 2) + '\n'))

// Held rows are probed for link health but still never swept (decide() skips them).
const absent = rows.filter(r => !feedIds.has(r.external_id))
const eligible = absent.filter(r => !held.has(r.external_id))
console.log('')
console.log(`Gişe Kıbrıs cancellation sweep${dry ? '  (DRY RUN — nothing written)' : ''}`)
console.log(`  feed: ${feedIds.size} events · approved & future-dated in DB: ${rows.length}`)
console.log(`  candidates (absent from the feed, not held): ${eligible.length} · link-checked (held included): ${absent.length}`)
if (!absent.length) { console.log('\n  Nothing to consider.\n'); process.exit(0) }

// probe with a small pool
const probes = new Array(absent.length)
let cursor = 0
await Promise.all(Array.from({length: Math.min(CONCURRENCY, absent.length)}, async () => {
  while (cursor < absent.length) {
    const i = cursor++
    probes[i] = absent[i].ticket_url ? await readFlag(absent[i].ticket_url) : null
  }
}))

const decided = absent.map((r, i) => ({ row: r, probe: probes[i],
  ...decide({...r, inFeed:false, held: held.has(r.external_id), now: nowIso}, probes[i]) }))
const toCancel = decided.filter(d => d.verdict === 'cancel')
const unknown  = decided.filter(d => d.verdict === 'unknown')
const live     = decided.filter(d => d.verdict === 'live')
const skipped  = decided.filter(d => d.verdict === 'skip')

console.log('\n  ── every decision, with the evidence it was made on ──')
for (const d of decided) {
  const p = d.probe
  const read = p ? `HTTP ${p.status ?? 'ERR'} · isCancelled=${p.flag === null ? 'ABSENT' : p.flag}${p.error ? ` · ${p.error}` : ''}` : 'not probed'
  console.log(`    ${d.verdict.toUpperCase().padEnd(8)} ${d.row.external_id}  ${d.row.title.slice(0,38).padEnd(40)} ${d.row.start_date.slice(0,10)}`)
  console.log(`             ${read}`)
  console.log(`             ${d.why}`)
}
console.log(`\n  cancel ${toCancel.length} · live ${live.length} · unknown ${unknown.length} · skipped ${skipped.length}`)
if (unknown.length) {
  console.log('\n  ⚠ UNKNOWN — untouched, and NOT counted as either live or cancelled.')
  console.log('    Absent is unknown; unknown is not cancelled. These need a human, not a default:')
  for (const d of unknown) console.log(`      ${d.row.external_id}  ${d.row.title.slice(0,44)}  (${d.why})`)
}

// ─── Dead links ─────────────────────────────────────────────────────────────
const dead = decided.map(d => ({ d, h: linkHealth(d.probe) })).filter(x => x.h.verdict === 'dead')
console.log(`\n  ── Buy Ticket links (absent from the feed) ──`)
console.log(`    dead ${dead.length}  (404 / not-found page; a 5xx or timeout is not dead)`)
const mayNull = nullDead && !dry && dead.length <= MAX_NULL
for (const { d, h } of dead) {
  const entry = { external_id: d.row.external_id, title: d.row.title, start_date: d.row.start_date,
                  ticket_url: d.row.ticket_url, why: h.why, nulled: false }
  let action = 'button still showing'
  if (mayNull) {
    // ticket_url only. Matching the probed URL means a link changed since the read is left alone.
    const { data, error: nErr } = await sb.from('events')
      .update({ ticket_url: null, updated_at: new Date().toISOString() })
      .eq('external_id', d.row.external_id).eq('source', SOURCE).eq('status', 'approved')
      .eq('ticket_url', d.row.ticket_url).select('external_id')
    if (nErr) fail(`nulling ticket_url failed for ${d.row.external_id}: ${nErr.message}`)
    entry.nulled = data.length === 1
    action = entry.nulled ? 'ticket_url → null (button hidden)' : 'NOT nulled: row changed since the read'
  } else if (nullDead && dry) action = 'would set ticket_url → null'
  report.dead_links.push(entry)
  console.log(`\n    DEAD  ${d.row.external_id}  ${d.row.title.slice(0, 44)}  ${d.row.start_date.slice(0, 10)}`)
  console.log(`          ${h.why}`)
  console.log(`          before: ${d.row.ticket_url}`)
  console.log(`          ${action}`)
}
if (nullDead && dead.length > MAX_NULL)
  console.log(`\n    ⛔ ${dead.length} dead links is over the cap of ${MAX_NULL}: NOTHING nulled. A wave this size is\n` +
              `       more likely their site than ${dead.length} removed events. Listed in the issue.`)
else if (dead.length && !nullDead)
  console.log('\n    Reported only. Hide them with --null-dead-links (workflow input null_dead_links).')

if (!toCancel.length) { console.log('\n  Nothing to cancel.\n'); process.exit(0) }

// ─── The cap ────────────────────────────────────────────────────────────────
const share = toCancel.length / Math.max(rows.length, 1)
if (toCancel.length > MAX_CANCEL || share > MAX_SHARE) {
  console.error('')
  console.error(`  ⛔ STOPPING — the cap refused this run. NOTHING WAS WRITTEN.`)
  console.error(`     would cancel ${toCancel.length} row(s); cap is ${MAX_CANCEL} absolute and ${Math.round(MAX_SHARE*100)}% of the`)
  console.error(`     ${rows.length} approved future-dated rows (this run: ${Math.round(share*100)}%).`)
  console.error('')
  console.error('     A batch this large is more likely a truncated feed than a real wave of')
  console.error('     cancellations — and a truncated feed that passes the fetch guard is exactly')
  console.error('     what this cap exists for. Verify the feed is complete, then act by hand.')
  console.error('')
  for (const d of toCancel) console.error(`       ${d.row.external_id}  ${d.row.title.slice(0,44)}  ${d.row.start_date.slice(0,10)}`)
  console.error('')
  process.exit(1)
}

if (dry) {
  console.log(`\n  (dry) would set status='cancelled' on ${toCancel.length} row(s). Re-run without --dry.\n`)
  process.exit(0)
}

// Scoped so it can reach neither a row outside the list nor a cancelled one.
const ids = toCancel.map(d => d.row.external_id)
const { data: moved, error: wErr } = await sb.from('events')
  .update({ status:'cancelled', updated_at:new Date().toISOString() })
  .in('external_id', ids).eq('source', SOURCE).eq('status','approved')
  .select('external_id,title,start_date,status')
if (wErr) fail(`write failed: ${wErr.message}`)

console.log(`\n  ✓ cancelled ${moved.length} row(s):`)
for (const r of moved) console.log(`      ${r.external_id}  ${r.title.slice(0,40).padEnd(42)} ${r.start_date.slice(0,10)}`)
if (moved.length !== ids.length) {
  console.error(`\n  ⚠ expected ${ids.length}, moved ${moved.length}. The filter is scoped to those ids in`)
  console.error('    approved state, so nothing extra can have changed — but investigate.')
  process.exit(1)
}
console.log('')

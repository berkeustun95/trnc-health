// ADA feed-freshness alert (Mac, launchd every 6 h). Read-only: GitHub run times via the REST API, with an
// ada-claude-code App token minted here and handed to the check in its env (never printed). Since 2026-11-27 this
// no longer goes through the gh binary (x86_64 under /usr/local, dead on the M4 Mac without Rosetta).
// A check that cannot run (no network on wake, mint failure, timeout, unreadable feed) sends ONE combined
// "check could not run" message, never one "feed stale" per feed (01:43 27 Nov: 4 false stale alerts).
// Writes ~/ObsidianVault/10-ada/alerts/feed-freshness.md every run; sends Telegram (@ada_dev_team_bot,
// token from the Keychain item "ada-telegram-bot", never on a command line, in a file or a log) only when:
//   - a feed becomes stale (and once a day while it stays stale), or
//   - a stale feed comes back ("all clear", once).
//   node run.mjs           normal run
//   node run.mjs --test    send one test message with the current status, change nothing
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOME = homedir()
const HERE = dirname(fileURLToPath(import.meta.url))
// Test hooks (never set by launchd): ADA_FF_DRY=1 prints instead of sending; ADA_FF_RESULT / _STATE / _NOTE redirect files.
const DRY = process.env.ADA_FF_DRY === '1'
const STATE = process.env.ADA_FF_STATE || join(HOME, '.local/state/ada-feed-freshness/state.json')
const NOTE = process.env.ADA_FF_NOTE || join(HOME, 'ObsidianVault/10-ada/alerts/feed-freshness.md')
const CHAT_ID = '8321808511'          // Berke's Telegram user id (the bot's only allowed user)
const REMIND_H = 24
const test = process.argv.includes('--test')

const NOISE = [/^node:internal\//, /^at /, /^\^+$/, /triggerUncaughtException/, /^Node\.js v/, /^throw /, /^[{}\]]+$/, /^\w+: ['"\d[-]/]
const describe = e => [...new Set((e?.stderr?.toString() || e?.message || String(e)).split('\n').map(l => l.trim())
  .filter(l => l && !NOISE.some(re => re.test(l)))
  .map(l => l.replace(/^\[cause\]:\s*/, '').replace(/\s*\{$/, '').replace(/^\[(.*)\]$/, '$1')))].join(' · ').slice(0, 300) || 'unknown error'
const sleep = s => new Promise(ok => setTimeout(ok, s * 1000))

// The mint needs the network: right after boot or wake it may not be up yet. ~65 s of retries.
async function mintToken() {
  const waits = [5, 10, 20, 30]
  for (let i = 0; ; i++) {
    try {
      return execFileSync(process.execPath, [join(HOME, '.config/ada-claude-code/app-token.mjs')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim()
    } catch (e) {
      if (i >= waits.length) throw new Error(`could not mint the GitHub App token: ${describe(e)}`)
      await sleep(waits[i])
    }
  }
}

const now = new Date()
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { stale: {}, history: [] }
const out = process.env.ADA_FF_RESULT || join(tmpdir(), `ada-feed-freshness-${process.pid}.json`)
let result = null, checkError = null
if (!process.env.ADA_FF_RESULT) {
  try {
    const token = await mintToken()
    try {
      execFileSync(process.execPath, [join(HERE, 'check-feed-freshness.mjs'), '--json', out], {
        stdio: ['ignore', 'pipe', 'pipe'], timeout: 150000, env: { ...process.env, GITHUB_TOKEN: token } })
    } catch (e) { if (!existsSync(out)) throw new Error(`check did not finish: ${describe(e)}`) }
  } catch (e) { checkError = e.message }
}
if (!checkError) {
  result = JSON.parse(readFileSync(out, 'utf8'))
  const bad = result.feeds.filter(f => f.unreadable)
  if (bad.length) checkError = [...new Set(bad.map(f => f.error))].join(' / ') + (bad.length < result.feeds.length ? ` (${bad.map(f => f.name).join(', ')})` : '')
}
if (!process.env.ADA_FF_RESULT) try { unlinkSync(out) } catch {}

const fmt = f => f.lastAt ? `${f.name}: last ${f.status === 'completed' ? 'run' : 'successful sync'} ${Math.round(f.ageH)} h ago` : `${f.name}: ${f.why}`
const messages = []
const feeds = result?.feeds ?? []
// The check itself: one message when it breaks, once a day while broken, one when it works again.
if (checkError) {
  if (!state.check_failed) {
    messages.push(`⚠️ ADA feed check could not run — ${checkError}. This is the checker, not the feeds; their state is unknown until it runs again.`)
    state.history.unshift(`${now.toISOString()} CHECK FAILED ${checkError}`)
    state.check_failed = { since: now.toISOString(), lastAlert: now.toISOString(), error: checkError }
  } else if (now - Date.parse(state.check_failed.lastAlert) >= REMIND_H * 36e5) {
    messages.push(`⚠️ ADA feed check still not running (since ${state.check_failed.since.slice(0, 16).replace('T', ' ')} UTC) — ${checkError}.`)
    state.check_failed.lastAlert = now.toISOString()
  }
} else if (state.check_failed) {
  messages.push(`✅ ADA feed check is running again.\n` + feeds.map(f => `${f.stale ? '⚠️' : '✓'} ${fmt(f)}`).join('\n'))
  state.history.unshift(`${now.toISOString()} CHECK OK (failed since ${state.check_failed.since})`)
  delete state.check_failed
}
// Per-feed alerts only from feeds that were actually read; an unreadable feed keeps its previous state.
const readable = feeds.filter(f => !f.unreadable)
const nowStale = Object.fromEntries(readable.filter(f => f.stale).map(f => [f.name, f]))
for (const [name, f] of Object.entries(nowStale)) {
  const prev = state.stale[name]
  if (!prev) {
    messages.push(`⚠️ ADA feed stale — ${fmt(f)} (limit ${result?.max_age_h ?? 48} h).`)
    state.history.unshift(`${now.toISOString()} STALE ${fmt(f)}`)
    state.stale[name] = { since: now.toISOString(), lastAlert: now.toISOString() }
  } else if (now - Date.parse(prev.lastAlert) >= REMIND_H * 36e5) {
    messages.push(`⚠️ Still stale — ${fmt(f)} (stale since ${prev.since.slice(0, 16).replace('T', ' ')} UTC).`)
    prev.lastAlert = now.toISOString()
  }
}
for (const name of Object.keys(state.stale)) {
  if (nowStale[name]) continue
  const f = readable.find(x => x.name === name)
  if (!f) continue
  messages.push(`✅ ADA feed back — ${f ? fmt(f) : name}.`)
  state.history.unshift(`${now.toISOString()} BACK  ${f ? fmt(f) : name}`)
  delete state.stale[name]
}
state.history = state.history.slice(0, 100)

async function telegram(text) {
  if (DRY) { console.log('[dry telegram] ' + text); return }
  const token = execFileSync('security', ['find-generic-password', '-s', 'ada-telegram-bot', '-w'], { encoding: 'utf8' }).trim()
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(20000),
  })
  const body = await res.json().catch(() => ({}))
  if (!body.ok) throw new Error(`Telegram HTTP ${res.status} ${body.description ?? ''}`)
}

const lines = feeds.map(f => `| ${f.name} | ${f.lastAt ? f.lastAt.replace('T', ' ').slice(0, 16) + ' UTC' : '—'} | ${f.ageH ?? '—'} h | ${f.unreadable ? '**unreadable**' : f.stale ? '**STALE**' : 'ok'} |`)
const status = (head) => [
  `${head}`, '',
  `| Feed | Last ${'successful'} run | Age | State |`, '|---|---|---|---|', ...lines,
].join('\n')

if (test) {
  await telegram(`🧪 Test — ADA feed-freshness alert is set up on the Mac (checks every 6 h, limit 48 h).\n` +
    (checkError ? `⚠️ check could not run: ${checkError}` : feeds.map(f => `${f.stale ? '⚠️' : '✓'} ${fmt(f)}`).join('\n')))
  console.log('test message sent')
  process.exit(0)
}

let sendError = null
for (const m of messages) { try { await telegram(m) } catch (e) { sendError = e.message } }

mkdirSync(dirname(STATE), { recursive: true })
writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n')
mkdirSync(dirname(NOTE), { recursive: true })
writeFileSync(NOTE, [
  '---', 'type: alert-log', 'source: ~/.local/share/ada-feed-freshness (launchd com.ada.feed-freshness, every 6 h)', '---', '',
  '# Feed freshness (48 h)', '',
  status(`Checked ${now.toISOString().replace('T', ' ').slice(0, 16)} UTC — ${checkError ? `**check could not run:** ${checkError}${Object.keys(nowStale).length ? ` · ${Object.keys(nowStale).length} stale among the readable` : ''}` : Object.keys(nowStale).length ? `**${Object.keys(nowStale).length} stale**` : 'all fresh'}${sendError ? ` — ⚠ Telegram send failed: ${sendError}` : ''}`),
  '', 'Same check as daily-health `feeds:freshness` (scripts/check-feed-freshness.mjs). Telegram fires when a feed goes stale, once a day while it stays stale, and once when it is back.',
  '', '## History (state changes, newest first)', '', ...(state.history.length ? state.history.map(h => `- ${h}`) : ['- (none yet)']), '',
].join('\n'))
console.log(`${now.toISOString()} stale=${Object.keys(nowStale).length}${checkError ? ` check-failed="${checkError}"` : ''} sent=${messages.length}${sendError ? ' send-error' : ''}`)

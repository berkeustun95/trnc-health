// Throttling / suppression check for the city-welcome decision.
// Run:  node scripts/validate-city-welcome.mjs
//
// decideWelcome is pure, so the whole rule matrix — including the 30-day
// cooldown boundary — can be verified here in milliseconds instead of by
// waiting a month and driving between cities.

import {
  decideWelcome, shouldAskHomeCity, COOLDOWN_MS, ASK_COOLDOWN_MS, VISITING,
} from '../utils/cityWelcomeRules.js'

const NOW = Date.UTC(2026, 6, 14) // fixed clock; no wall-time flake
const DAY = 24 * 60 * 60 * 1000

// A resident of Kyrenia who has never seen a card anywhere.
const resident = { enabled: true, home: 'kyrenia', seen: {}, asked: true }
// Someone who answered "I'm just visiting".
const visitor  = { enabled: true, home: VISITING,  seen: {}, asked: true }

const cases = [
  // [name, state, region, expect{show, variant, reason}]
  ['resident, at home',
    resident, 'kyrenia',   { show: false, reason: 'home-city' }],
  ['resident, day trip to Famagusta (first time)',
    resident, 'famagusta', { show: true, variant: 'rich', reason: 'first-visit' }],

  ['resident, back home the next day — still suppressed',
    { ...resident, seen: { famagusta: NOW - DAY } }, 'kyrenia',
    { show: false, reason: 'home-city' }],

  ['resident commutes home->Famagusta daily for a month — only the first shows',
    { ...resident, seen: { famagusta: NOW - 29 * DAY } }, 'famagusta',
    { show: false, reason: 'cooldown-active' }],

  ['cooldown boundary: 30 days minus a second — still silent',
    { ...resident, seen: { famagusta: NOW - COOLDOWN_MS + 1000 } }, 'famagusta',
    { show: false, reason: 'cooldown-active' }],
  ['cooldown boundary: exactly 30 days — the lighter nudge',
    { ...resident, seen: { famagusta: NOW - COOLDOWN_MS } }, 'famagusta',
    { show: true, variant: 'nudge', reason: 'cooldown-elapsed' }],
  ['cooldown boundary: 31 days — nudge',
    { ...resident, seen: { famagusta: NOW - 31 * DAY } }, 'famagusta',
    { show: true, variant: 'nudge', reason: 'cooldown-elapsed' }],

  ['cooldown is PER CITY — Famagusta on cooldown does not mute Karpaz',
    { ...resident, seen: { famagusta: NOW - DAY } }, 'karpaz',
    { show: true, variant: 'rich', reason: 'first-visit' }],

  ['tourist ("just visiting") — every city is eligible',
    visitor, 'nicosia', { show: true, variant: 'rich', reason: 'first-visit' }],
  ['tourist, second city same trip',
    { ...visitor, seen: { nicosia: NOW - 2 * DAY } }, 'kyrenia',
    { show: true, variant: 'rich', reason: 'first-visit' }],
  ['tourist, re-enters a city they saw yesterday',
    { ...visitor, seen: { nicosia: NOW - DAY } }, 'nicosia',
    { show: false, reason: 'cooldown-active' }],

  ['master toggle off — silent even in a brand-new city',
    { ...visitor, enabled: false }, 'karpaz', { show: false, reason: 'disabled' }],
  ['toggle off outranks everything, including home',
    { ...resident, enabled: false }, 'kyrenia', { show: false, reason: 'disabled' }],

  ['home city not answered yet — silent (cannot tell resident from visitor)',
    { enabled: true, home: null, seen: {}, asked: false }, 'nicosia',
    { show: false, reason: 'home-city-unknown' }],

  ['outside TRNC / no fix — silent',
    visitor, null, { show: false, reason: 'no-region' }],
  ['no fix outranks a disabled toggle (ordering sanity)',
    { ...visitor, enabled: false }, null, { show: false, reason: 'no-region' }],
]

let pass = 0
const fails = []

console.log('\n' + '-'.repeat(78))
console.log('CITY WELCOME — THROTTLING & SUPPRESSION')
console.log('-'.repeat(78) + '\n')

for (const [name, state, region, expect] of cases) {
  const got = decideWelcome({ ...state, region, now: NOW })
  const ok = got.show === expect.show
    && got.reason === expect.reason
    && (expect.variant ?? null) === got.variant

  if (ok) pass++
  else fails.push({ name, expect, got })

  const detail = `show=${got.show}${got.variant ? ` ${got.variant}` : ''} (${got.reason})`
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`)
  console.log(`       ${detail}`)
  if (!ok) console.log(`       expected show=${expect.show}${expect.variant ? ` ${expect.variant}` : ''} (${expect.reason})`)
}

// --- the home-city question: when do we ask? --------------------------------

const unasked = { asked: false, enabled: true, askLast: 0, coachMarksRunning: false }

const askCases = [
  ['first eligible cold start — ask',
    unasked, { ask: true, reason: 'first-ask' }],

  ['first run (coach marks up) — defer, do not stack a 4th thing on first open',
    { ...unasked, coachMarksRunning: true }, { ask: false, reason: 'first-run-busy' }],

  ['soft-dismissed 1h ago — do NOT re-ask this launch',
    { ...unasked, askLast: NOW - 60 * 60 * 1000 }, { ask: false, reason: 'ask-cooldown' }],
  ['soft-dismissed 23h59m ago — still silent',
    { ...unasked, askLast: NOW - ASK_COOLDOWN_MS + 60 * 1000 }, { ask: false, reason: 'ask-cooldown' }],
  ['soft-dismissed 24h ago — re-ask (never locked out forever)',
    { ...unasked, askLast: NOW - ASK_COOLDOWN_MS }, { ask: true, reason: 're-ask' }],
  ['soft-dismissed 3 days ago — re-ask',
    { ...unasked, askLast: NOW - 3 * 24 * 60 * 60 * 1000 }, { ask: true, reason: 're-ask' }],

  ['answered ("I live in Kyrenia") — never ask again',
    { ...unasked, asked: true }, { ask: false, reason: 'already-answered' }],
  ['answered ("just visiting") — never ask again',
    { ...unasked, asked: true }, { ask: false, reason: 'already-answered' }],

  ['welcomes turned off — do not nag for a home city',
    { ...unasked, enabled: false }, { ask: false, reason: 'disabled' }],
  ['answered outranks the ask-cooldown (ordering sanity)',
    { ...unasked, asked: true, askLast: NOW - 10 * 24 * 60 * 60 * 1000 },
    { ask: false, reason: 'already-answered' }],
]

console.log('\n' + '-'.repeat(78))
console.log('HOME-CITY QUESTION — WHEN DO WE ASK?')
console.log('-'.repeat(78) + '\n')

for (const [name, state, expect] of askCases) {
  const got = shouldAskHomeCity({ ...state, now: NOW })
  const ok = got.ask === expect.ask && got.reason === expect.reason
  if (ok) pass++
  else fails.push({ name, expect, got })
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`)
  console.log(`       ask=${got.ask} (${got.reason})`)
  if (!ok) console.log(`       expected ask=${expect.ask} (${expect.reason})`)
}

const total = cases.length + askCases.length

console.log('\n' + '-'.repeat(78))
console.log(`\n${pass}/${total} passed${fails.length ? ` — ${fails.length} FAILED` : ' — clean'}\n`)
process.exit(fails.length ? 1 : 0)

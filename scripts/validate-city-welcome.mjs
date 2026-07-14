// Throttling / suppression check for the city-welcome decision.
// Run:  node scripts/validate-city-welcome.mjs
//
// decideWelcome is pure, so the whole rule matrix — including the 30-day
// cooldown boundary — can be verified here in milliseconds instead of by
// waiting a month and driving between cities.

import { decideWelcome, COOLDOWN_MS, VISITING } from '../utils/cityWelcomeRules.js'

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

console.log('\n' + '-'.repeat(78))
console.log(`\n${pass}/${cases.length} passed${fails.length ? ` — ${fails.length} FAILED` : ' — clean'}\n`)
process.exit(fails.length ? 1 : 0)

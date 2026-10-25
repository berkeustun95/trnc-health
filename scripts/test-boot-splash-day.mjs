#!/usr/bin/env node
// When does the boot splash play? utils/bootSplashDay.js, asserted case by case.
//   node scripts/test-boot-splash-day.mjs
import { localDay, shouldPlaySplash, splashRecord } from '../utils/bootSplashDay.js'

let failed = 0
const check = (name, got, want) => {
  const ok = got === want
  if (!ok) failed++
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(58)} got ${JSON.stringify(got)}${ok ? '' : `, want ${JSON.stringify(want)}`}`)
}

const day = '2026-10-25'
const build = 'ota-01a17326'
console.log('\nboot splash: when it plays')
check('fresh install (nothing stored)', shouldPlaySplash(null, day, build), true)
check('already played today, same build', shouldPlaySplash(splashRecord(day, build), day, build), false)
check('played yesterday', shouldPlaySplash(splashRecord('2026-10-24', build), day, build), true)
check('played today, but a new OTA since', shouldPlaySplash(splashRecord(day, 'ota-01a10000'), day, build), true)
check('played today, but a new store build since', shouldPlaySplash(splashRecord(day, 'embedded-1.4.1'), day, 'embedded-1.4.2'), true)
check('stored value is garbage', shouldPlaySplash('not json', day, build), true)
check('stored value is JSON null', shouldPlaySplash('null', day, build), true)

// The day is the device's LOCAL date: 23:30 and 00:30 local are different days even when the
// UTC date is the same, which a toISOString() slice would get wrong.
check('local day of 2026-10-25 23:30 local', localDay(new Date(2026, 9, 25, 23, 30)), '2026-10-25')
check('local day of 2026-10-26 00:30 local', localDay(new Date(2026, 9, 26, 0, 30)), '2026-10-26')
check('single-digit month and day are zero-padded', localDay(new Date(2026, 0, 5, 12)), '2026-01-05')

if (failed) { console.error(`\nboot splash day: ${failed} FAILED`); process.exit(1) }
console.log('\nboot splash day: OK')

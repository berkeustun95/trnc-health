// parseIsOpen (utils/facilityUtils.js) against both stored hours formats.
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-open-now.mjs
// The JSON is built the way components/HoursPicker.js buildOutput() writes it
// ({Day: {o, c}}, closed days absent) — that component imports react-native, so the shape
// is mirrored here, and the first case asserts the mirror against the picker's own source.
import { readFileSync } from 'node:fs'
import { parseIsOpen } from '../utils/facilityUtils.js'

const picker = readFileSync(new URL('../components/HoursPicker.js', import.meta.url), 'utf8')
let pass = 0, fail = 0
const ok = (name, cond, got) => { if (cond) pass++; else { fail++; console.log('FAIL', name, '→', JSON.stringify(got)) } }
ok('mirror: HoursPicker still writes {o, c} per open day', /result\[d\] = \{ o: schedule\[d\]\.openTime, c: schedule\[d\]\.closeTime \}/.test(picker))
ok('mirror: HoursPicker still offers 00:00 as the last time', /TIMES\.push\('00:00'\)/.test(picker))

const at = (dow, hh, mm = 0) => {   // 2026-10-04 is a Sunday; +dow days
  const d = new Date(2026, 9, 4 + dow, hh, mm)
  if (d.getDay() !== dow) throw new Error('calendar assumption broken')
  return d
}
const MON = 1, TUE = 2, SAT = 6, SUN = 0
const pharm = JSON.stringify({ Mon: { o: '08:30', c: '19:00' }, Tue: { o: '08:30', c: '19:00' }, Sat: { o: '09:00', c: '13:00' } })
ok('Mon 10:00 open', parseIsOpen(pharm, at(MON, 10)) === true)
ok('Mon 08:29 closed (before open)', parseIsOpen(pharm, at(MON, 8, 29)) === false)
ok('Mon 08:30 open (open is inclusive)', parseIsOpen(pharm, at(MON, 8, 30)) === true)
ok('Mon 19:00 closed (close is exclusive)', parseIsOpen(pharm, at(MON, 19)) === false)
ok('Sun closed (day absent)', parseIsOpen(pharm, at(SUN, 11)) === false)
ok('Sat 12:59 open, 13:00 closed', parseIsOpen(pharm, at(SAT, 12, 59)) === true && parseIsOpen(pharm, at(SAT, 13)) === false)
const late = JSON.stringify({ Sat: { o: '18:00', c: '00:00' } })
ok('close 00:00 = midnight: Sat 23:59 open', parseIsOpen(late, at(SAT, 23, 59)) === true)
ok('close 00:00 does NOT spill into Sun 00:30', parseIsOpen(late, at(SUN, 0, 30)) === false)
const overnight = JSON.stringify({ Mon: { o: '20:00', c: '02:00' } })
ok('overnight: Mon 23:00 open', parseIsOpen(overnight, at(MON, 23)) === true)
ok('overnight spill: Tue 01:30 open', parseIsOpen(overnight, at(TUE, 1, 30)) === true)
ok('overnight spill ends: Tue 02:00 closed', parseIsOpen(overnight, at(TUE, 2)) === false)
// Unreadable is null (unknown), never false (closed).
ok('malformed JSON → null', parseIsOpen('{"Mon":', at(MON, 10)) === null)
ok('unknown day key → null', parseIsOpen(JSON.stringify({ Monday: { o: '09:00', c: '17:00' } }), at(MON, 10)) === null)
ok('bad time → null', parseIsOpen(JSON.stringify({ Mon: { o: '9am', c: '17:00' } }), at(MON, 10)) === null)
ok('empty object → null', parseIsOpen('{}', at(MON, 10)) === null)
ok('array → null', parseIsOpen('[]', at(MON, 10)) === null)
ok('null/empty → null', parseIsOpen(null) === null && parseIsOpen('') === null)
// The legacy format keeps working.
ok('legacy Mon-Fri 09:00-18:00, Mon 10:00 open', parseIsOpen('Mon-Fri 09:00-18:00', at(MON, 10)) === true)
ok('legacy, Sun closed', parseIsOpen('Mon-Fri 09:00-18:00', at(SUN, 10)) === false)
ok('legacy 24/7', parseIsOpen('24/7', at(SUN, 3)) === true)
ok('legacy garbage → null', parseIsOpen('ask at the counter', at(MON, 10)) === null)
console.log(`${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)

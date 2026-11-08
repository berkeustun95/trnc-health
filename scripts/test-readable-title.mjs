// The app's readableTitle (utils/readableTitle.js) and the Friday push's (send-weekend-digest/digest.ts)
// must case a title the same way: the push names an event, the app then shows it.
import assert from 'node:assert/strict'
import { readableTitle as app } from '../utils/readableTitle.js'
import { readableTitle as push } from '../supabase/functions/send-weekend-digest/digest.ts'

const CASES = [
  ['PEPPA PIG ÇOCUK TİYATROSU', 'Peppa Pig Çocuk Tiyatrosu'],
  ['TOM VE JERRY - KIBRIS KIDS FEST', 'Tom ve Jerry - Kıbrıs Kids Fest'],
  ['BOEING BOEING', 'Boeing Boeing'],
  ["DJ ARDA İLE YILBAŞI PARTİSİ LEFKOŞA'DA", "DJ Arda ile Yılbaşı Partisi Lefkoşa'da"],
  ['KKTC CUP 2026: EMU VS. NEU', 'KKTC Cup 2026: EMU vs. NEU'],
  ['HÜSEYİN KIRMIZI PİYANO RESİTALİ', 'Hüseyin Kırmızı Piyano Resitali'],
  ['Murda Konseri', 'Murda Konseri'],
  ['ODTÜ', 'ODTÜ'],
  ['  Jazz Night  ', 'Jazz Night'],
]
let n = 0
for (const [input, want] of CASES) {
  assert.equal(app(input), want, `app: ${input}`)
  assert.equal(push(input), want, `push: ${input}`)
  n++
}
assert.equal(app(null), null)
console.log(`readable title: OK (${n} cases, app == push)`)

import { assertEquals } from 'https://deno.land/std@0.177.0/testing/asserts.ts'
import { weekendWindow, inWindow, weekPick, digestMessage, readableTitle } from './digest.ts'

const iso = (d: Date) => d.toISOString()

Deno.test('Friday 17:00 TRNC (winter, UTC+2) → Sat 00:00 .. Mon 00:00 local', () => {
  const w = weekendWindow(new Date('2026-11-13T15:00:00Z'))
  assertEquals([iso(w.from), iso(w.to)], ['2026-11-13T22:00:00.000Z', '2026-11-15T22:00:00.000Z'])
})

Deno.test('summer (UTC+3) window, and Sunday = what is left of it', () => {
  const fri = weekendWindow(new Date('2026-07-17T14:00:00Z'))
  assertEquals(iso(fri.from), '2026-07-17T21:00:00.000Z')
  const sun = weekendWindow(new Date('2026-07-19T08:00:00Z'))
  assertEquals([iso(sun.from), iso(sun.to)], ['2026-07-18T21:00:00.000Z', '2026-07-19T21:00:00.000Z'])
})

Deno.test('inWindow: Saturday show in, Friday night out, running festival in, next Monday out', () => {
  const w = weekendWindow(new Date('2026-11-13T15:00:00Z'))
  const e = (s: string, end: string | null = null) => ({ title: 'x', start_date: s, end_date: end })
  assertEquals([
    inWindow(e('2026-11-14T20:00:00+02:00'), w),
    inWindow(e('2026-11-13T20:00:00+02:00', '2026-11-13T23:00:00+02:00'), w),
    inWindow(e('2026-11-10T10:00:00+02:00', '2026-11-20T22:00:00+02:00'), w),
    inWindow(e('2026-11-16T20:00:00+02:00'), w),
  ], [true, false, true, false])
})

Deno.test('weekPick: same week same pick, next week moves on', () => {
  const rows = ['a', 'b', 'c']
  assertEquals(weekPick(rows, new Date('2026-11-13T15:00:00Z')), weekPick(rows, new Date('2026-11-11T09:00:00Z')))
  const a = weekPick(rows, new Date('2026-11-13T15:00:00Z')), b = weekPick(rows, new Date('2026-11-20T15:00:00Z'))
  assertEquals(a === b, false)
  assertEquals(weekPick([], new Date()), null)
})

Deno.test('message: two names, the rest counted, a place in the reader language; ALL-CAPS titles re-cased', () => {
  const ev = [
    { title: 'PEPPA PIG ÇOCUK TİYATROSU', start_date: '', end_date: null },
    { title: 'Murda Konseri', start_date: '', end_date: null },
    { title: 'x', start_date: '', end_date: null }, { title: 'y', start_date: '', end_date: null },
  ]
  const place = { name: 'Bellapais Abbey', name_i18n: { en: 'Bellapais Abbey', tr: 'Bellapais Manastırı' } }
  assertEquals(digestMessage('Turkish', ev, place), {
    title: "🎉 Bu hafta sonu ADA'da",
    body: 'Peppa Pig Çocuk Tiyatrosu · Murda Konseri +2 etkinlik daha\nGezmek için: Bellapais Manastırı',
  })
  assertEquals(digestMessage('Klingon', ev.slice(0, 1), null).body, 'Peppa Pig Çocuk Tiyatrosu')
})

Deno.test('readableTitle: ALL CAPS → normal casing, Turkish and English per word, acronyms kept', () => {
  assertEquals([
    readableTitle('PEPPA PIG ÇOCUK TİYATROSU'),
    readableTitle('TOM VE JERRY - KIBRIS KIDS FEST'),
    readableTitle('BOEING BOEING'),
    readableTitle("DJ ARDA İLE YILBAŞI PARTİSİ LEFKOŞA'DA"),
    readableTitle('KKTC CUP 2026: EMU VS. NEU'),
    readableTitle('Murda Konseri'),
    readableTitle('ODTÜ'),
  ], [
    'Peppa Pig Çocuk Tiyatrosu',
    'Tom ve Jerry - Kıbrıs Kids Fest',
    'Boeing Boeing',
    "DJ Arda ile Yılbaşı Partisi Lefkoşa'da",
    'KKTC Cup 2026: EMU vs. NEU',
    'Murda Konseri',
    'ODTÜ',
  ])
})

// Pure logic behind the Duyurular screens (constants/duyurular.js): the ≥3-items category rule
// (Berke 2026-10-10), TRNC day boundaries for "Son günler", and the search fold.
//   node scripts/test-duyurular-ui.mjs
import { visibleCategories, daysLeft, isClosingSoon, matchesQuery, MIN_ITEMS_FOR_CATEGORY } from '../constants/duyurular.js'

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
const items = [...Array(3).fill({ category: 'kamu' }), ...Array(2).fill({ category: 'ihale' }), { category: 'kesinti' }]
t('threshold is 3', MIN_ITEMS_FOR_CATEGORY, 3)
t('only categories with ≥3 items are offered', visibleCategories(items).map(c => [c.key, c.count]), [['kamu', 3]])
t('a category at 3 appears', visibleCategories([...items, { category: 'ihale' }]).map(c => c.key), ['kamu', 'ihale'])

// 2026-10-10 23:30 TRNC = 20:30 UTC; a deadline at 23:59:59 TRNC the same day is 0 days away.
const now = new Date('2026-10-10T20:30:00Z')
t('same TRNC day → 0', daysLeft('2026-10-10T20:59:59Z', now), 0)
t('next TRNC day → 1', daysLeft('2026-10-11T20:59:59Z', now), 1)
t('yesterday → -1', daysLeft('2026-10-09T20:59:59Z', now), -1)
// 00:30 TRNC on the 11th = 21:30 UTC on the 10th: a deadline "10 Ekim" is now in the past.
t('just after TRNC midnight the old day is past', daysLeft('2026-10-10T20:59:59Z', new Date('2026-10-10T21:30:00Z')), -1)
const open = (iso) => ({ kind: 'open', deadline_at: iso })
t('7 days → closing soon', isClosingSoon(open('2026-10-17T20:59:59Z'), now), true)
t('8 days → not yet', isClosingSoon(open('2026-10-18T20:59:59Z'), now), false)
t('past → no', isClosingSoon(open('2026-10-09T20:59:59Z'), now), false)
t('a result never closes', isClosingSoon({ kind: 'result', deadline_at: '2026-10-12T20:59:59Z' }, now), false)

const it = { title: 'GELİR VE VERGİ DAİRESİ MÜNHAL DUYURUSU', institution: 'Kamu Hizmeti Komisyonu' }
t('search: lowercase Turkish matches all-caps İ', matchesQuery(it, 'gelir münhal'), true)
t('search: ASCII typing matches Turkish letters', matchesQuery(it, 'munhal dairesi'), true)
t('search: institution matches', matchesQuery(it, 'komisyon'), true)
t('search: every word must match', matchesQuery(it, 'münhal ihale'), false)
t('search: empty matches all', matchesQuery(it, '  '), true)

console.log(bad ? `\n✗ ${bad} failure(s).` : '\n✓ all checks pass.')
process.exit(bad ? 1 : 0)

// readAllResult / readAllRows (supabase/functions/_shared/read-all-rows.mjs): the paging helper behind the six reads
// that used to be a plain select (PostgREST max-rows 1000).   node scripts/test-read-all-result.mjs
import { readAllRows, readAllResult } from '../supabase/functions/_shared/read-all-rows.mjs'

let bad = 0
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
// A fake PostgREST over n rows: range(a, b) answers min(b-a+1, maxRows) rows with the exact count.
const server = (n, maxRows = 1000, { stopAfter = Infinity } = {}) => {
  let calls = 0
  return { calls: () => calls, page: async (a, b) => {
    calls++
    const end = calls > stopAfter ? a : Math.min(b + 1, a + maxRows, n)
    return { data: Array.from({ length: Math.max(0, end - a) }, (_, i) => ({ id: a + i })), error: null, count: n }
  } }
}

console.log('readAllResult / readAllRows')
let s = server(2500)
let r = await readAllResult(s.page)
t('2500 rows at max-rows 1000: all read, no error', [r.error, r.data.length, s.calls()], [null, 2500, 3])
t('  in order, no duplicates', [r.data[0].id, r.data[2499].id, new Set(r.data.map(x => x.id)).size], [0, 2499, 2500])
r = await readAllResult(server(1700, 500).page)
t('server max-rows 500 (below our page size): still all 1700', [r.error, r.data.length], [null, 1700])
t('exactly 1000 rows and 0 rows', [(await readAllResult(server(1000).page)).data.length, (await readAllResult(server(0).page)).data.length], [1000, 0])
r = await readAllResult(server(2500, 1000, { stopAfter: 1 }).page)
t('a TRUNCATED read is an error with NO data (never a short list)', [r.data, /read 1000 rows, expected 2500/.test(r.error?.message)], [null, true])
r = await readAllResult(async () => ({ data: null, error: { message: 'relation "walking_legs" does not exist' }, count: null }))
t('a query error comes back as { data: null, error } (call sites keep their handling)', [r.data, r.error.message], [null, 'relation "walking_legs" does not exist'])
let threw = false
try { await readAllRows(server(2500, 1000, { stopAfter: 1 }).page) } catch { threw = true }
t('readAllRows itself still throws on truncation', threw, true)
console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)

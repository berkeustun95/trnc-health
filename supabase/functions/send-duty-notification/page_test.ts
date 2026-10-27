// deno test supabase/functions/send-duty-notification/page_test.ts
import { type Page, readAllById } from './page.ts'

type Row = { id: string }
const table = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(6, '0') }))

// A fake PostgREST: honours `id > after`, ORDER BY id, and a server max-rows cap that overrides our limit.
function server(rows: Row[], maxRows: number, opts: { dropAfterCall?: number } = {}) {
  let calls = 0
  return {
    calls: () => calls,
    fetchPage: async (after: string | null): Promise<Page<Row>> => {
      calls++
      let page = rows.filter((r) => after == null || r.id > after).slice(0, Math.min(1000, maxRows))
      if (opts.dropAfterCall && calls > opts.dropAfterCall) page = [] // the server stops giving rows early
      return { data: page, error: null, count: rows.length }
    },
  }
}
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`) }

Deno.test('2500 rows at max-rows 1000: all 2500 read, no duplicates, in order', async () => {
  const s = server(table(2500), 1000)
  const r = await readAllById(s.fetchPage)
  eq([r.error, r.rows.length, new Set(r.rows.map((x) => x.id)).size, r.rows[0].id, r.rows[2499].id], [null, 2500, 2500, '000000', '002499'], 'result')
})

Deno.test('server max-rows BELOW our limit (500): still all rows (ends on an empty page, not a short one)', async () => {
  const r = await readAllById(server(table(1700), 500).fetchPage)
  eq([r.error, r.rows.length], [null, 1700], 'result')
})

Deno.test('exactly 1000 and 0 rows are handled', async () => {
  eq((await readAllById(server(table(1000), 1000).fetchPage)).rows.length, 1000, '1000')
  eq((await readAllById(server(table(0), 1000).fetchPage)), { rows: [], error: null }, 'empty')
})

Deno.test('a truncated read is REFUSED, not returned short (red-first: the old plain select would have passed 1000 of 2500)', async () => {
  const r = await readAllById(server(table(2500), 1000, { dropAfterCall: 1 }).fetchPage)
  eq([r.rows.length, r.error], [0, 'TRUNCATED: received 1000 of 2500 rows'], 'refused')
})

Deno.test('a missing exact count is refused; a query error is passed on', async () => {
  const noCount = await readAllById(async () => ({ data: table(3), error: null, count: null }))
  eq(noCount.error !== null, true, 'no count')
  const bad = await readAllById(async () => ({ data: null, error: { message: 'boom' }, count: null }))
  eq([bad.rows.length, bad.error], [0, 'boom'], 'error')
})

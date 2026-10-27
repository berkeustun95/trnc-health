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
  eq((await readAllById(server(table(0), 1000).fetchPage)).rows.length, 0, 'empty')
})

Deno.test('a short read is re-read ONCE, then SENT to the rows read with the shortfall recorded (never refused)', async () => {
  const srv = server(table(2500), 1000, { dropAfterCall: 1 })
  const r = await readAllById(srv.fetchPage)
  // read 1: page 1 (1000 rows) then the server stops = 1000 of 2500. Re-read: pages 2.. return nothing (calls > 1).
  eq([r.error, r.rows.length, r.shortBy, r.reads], [null, 1000, 1500, 2], 'delivered to what was read')
})

Deno.test('a transient shortfall is healed by the single re-read', async () => {
  let call = 0
  const all = table(2500)
  const r = await readAllById(async (after): Promise<Page<Row>> => {
    call++
    const rows = all.filter((x) => after == null || x.id > after).slice(0, 1000)
    // the FIRST read loses its last page (a mid-read hiccup); the re-read is clean
    return { data: call === 3 ? [] : rows, error: null, count: 2500 }
  })
  eq([r.error, r.rows.length, r.shortBy, r.reads], [null, 2500, undefined, 2], 'healed')
})

Deno.test('a profile deleted mid-read (count drops by one) does not block the send', async () => {
  const all = table(1500)
  const r = await readAllById(async (after): Promise<Page<Row>> => ({
    data: all.filter((x) => (after == null || x.id > after) && x.id !== '000700').slice(0, 1000), error: null, count: 1500,
  }))
  eq([r.error, r.rows.length, r.shortBy], [null, 1499, 1], 'one missing, still sent')
})

Deno.test('a real query error is an error (the only refusal); so is zero rows with a positive count', async () => {
  const bad = await readAllById(async () => ({ data: null, error: { message: 'boom' }, count: null }))
  eq([bad.rows.length, bad.error], [0, 'boom'], 'error')
  const none = await readAllById(async () => ({ data: [], error: null, count: 900 }))
  eq([none.rows.length, none.error], [0, 'read 0 of 900 rows'], 'zero of nine hundred')
})

Deno.test('a missing exact count is not a refusal: rows are returned, flagged unverified', async () => {
  let n = 0
  const r = await readAllById(async (): Promise<Page<Row>> => ({ data: n++ === 0 ? table(3) : [], error: null, count: null }))
  eq([r.error, r.rows.length, r.countUnverified], [null, 3, true], 'unverified')
})

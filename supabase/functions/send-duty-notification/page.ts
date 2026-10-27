// Keyset-paged read of a whole table through PostgREST, free of remote imports so `deno test` runs it offline.
//
// WHY: PostgREST's server-side `max-rows` (1000) silently truncates a plain select. Reading `profiles` that way
// would send the duty push to the first 1000 users only, with no error. CLAUDE.md verification principle 12:
// compare `count: 'exact'` to rows received, never `rows >= cap`.
//
// HOW: pages by `id > lastId ORDER BY id`, not offset/range, so a row inserted or deleted mid-run cannot shift a
// later page and skip someone. The page size is whatever the server returns (max-rows may be below our limit), so the
// loop ends on an EMPTY page, never on a short one. The exact count comes from the first page.
//
// A MISMATCH DOES NOT REFUSE (this is a delivery job: refusing means everyone misses the day's push). On a short read
// the whole read is repeated once; if it is still short the rows read are RETURNED with `shortBy` set, and the caller
// records it. Only a real query error (or a read that returned nothing although the count says there are rows) is an
// error. A count that never arrives is returned as `countUnverified`.

export interface Page<T> {
  data: T[] | null
  error: { message: string } | null
  count: number | null
}

export type PageFetcher<T> = (afterId: string | null) => PromiseLike<Page<T>>

export interface ReadResult<T> {
  rows: T[]
  error: string | null
  shortBy?: number
  countUnverified?: boolean
  reads?: number
}

async function readOnce<T extends { id: string }>(fetchPage: PageFetcher<T>, maxPages: number) {
  const rows: T[] = []
  let after: string | null = null
  let expected: number | null = null
  for (let page = 0; page < maxPages; page++) {
    const { data, error, count } = await fetchPage(after)
    if (error) return { error: error.message, rows: [] as T[], expected }
    if (page === 0) expected = count
    if (!data || data.length === 0) return { error: null, rows, expected }
    rows.push(...data)
    after = data[data.length - 1].id
  }
  return { error: `gave up after ${maxPages} pages`, rows: [] as T[], expected }
}

export async function readAllById<T extends { id: string }>(
  fetchPage: PageFetcher<T>,
  maxPages = 1000,
): Promise<ReadResult<T>> {
  let last: Awaited<ReturnType<typeof readOnce<T>>> | null = null
  let best: typeof last = null
  let readsDone = 0
  for (let read = 1; read <= 2; read++) {
    readsDone = read
    last = await readOnce(fetchPage, maxPages)
    if (last.error) {
      // A failed RE-read after a short but non-empty first read must not cost everyone the push: send what the
      // first read got and record the shortfall. A first-read error (or a 0-row first read) still refuses.
      if (read === 2 && best && best.rows.length > 0 && best.expected != null) {
        return { rows: best.rows, error: null, shortBy: best.expected - best.rows.length, reads: 2 }
      }
      return { rows: [], error: last.error, reads: read }
    }
    if (last.expected == null) return { rows: last.rows, error: null, countUnverified: true, reads: read }
    if (last.rows.length >= last.expected) return { rows: last.rows, error: null, reads: read }
    if (best == null || last.rows.length > best.rows.length) best = last
  }
  const { rows, expected } = best!   // the fuller of the two reads
  if (rows.length === 0) return { rows: [], error: `read 0 of ${expected} rows`, reads: readsDone }
  return { rows, error: null, shortBy: (expected as number) - rows.length, reads: readsDone }
}

// The error_kinds entries for a profiles read (counts only). Kept pure so the wiring is testable. These are NOT failed
// pushes: they must be merged into error_kinds directly, never through the push-error counter.
export function profileReadKinds(r: { shortBy?: number; countUnverified?: boolean }): Record<string, number> {
  const kinds: Record<string, number> = {}
  if (r.shortBy) kinds.profiles_count_mismatch = r.shortBy
  if (r.countUnverified) kinds.profiles_count_unverified = 1
  return kinds
}

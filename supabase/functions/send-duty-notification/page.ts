// Keyset-paged read of a whole table through PostgREST, free of remote imports so `deno test` runs it offline.
//
// WHY: PostgREST's server-side `max-rows` (1000) silently truncates a plain select. Reading `profiles` that way
// would send the duty push to the first 1000 users only, with no error. CLAUDE.md verification principle 12:
// compare `count: 'exact'` to rows received, never `rows >= cap`.
//
// HOW: pages by `id > lastId ORDER BY id`, not offset/range, so a row inserted or deleted mid-run cannot shift a
// later page and skip someone. The page size is whatever the server returns (max-rows may be below our limit), so the
// loop ends on an EMPTY page, never on a short one. The exact count is taken from the first page and the read is
// refused if fewer rows arrive than that. (Rows inserted after the first page may or may not be seen; rows deleted
// during the read can make a false refusal: both are rare and a refusal is loud, a silent short list is not.)

export interface Page<T> {
  data: T[] | null
  error: { message: string } | null
  count: number | null
}

export type PageFetcher<T> = (afterId: string | null) => PromiseLike<Page<T>>

export async function readAllById<T extends { id: string }>(
  fetchPage: PageFetcher<T>,
  maxPages = 1000,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = []
  let after: string | null = null
  let expected: number | null = null
  for (let page = 0; page < maxPages; page++) {
    const { data, error, count } = await fetchPage(after)
    if (error) return { rows: [], error: error.message }
    if (page === 0) {
      if (count == null) return { rows: [], error: 'no exact count returned: cannot verify the read is complete' }
      expected = count
    }
    if (!data || data.length === 0) {
      if (expected != null && rows.length < expected) {
        return { rows: [], error: `TRUNCATED: received ${rows.length} of ${expected} rows` }
      }
      return { rows, error: null }
    }
    rows.push(...data)
    after = data[data.length - 1].id
  }
  return { rows: [], error: `gave up after ${maxPages} pages` }
}

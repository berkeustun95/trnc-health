// Read every row of a PostgREST query. The server caps a response at its max-rows (1000, but it
// can be set lower), so a plain select silently truncates. `page(from, to)` returns the query for one
// range, built WITH { count: 'exact' } and an ORDER BY on a unique column. Pages advance by the rows
// actually received. Throws unless rows received === exact count.
export async function readAllRows(page, size = 1000) {
  const rows = []
  let exact = null
  let from = 0
  for (;;) {
    const { data, error, count } = await page(from, from + size - 1)
    if (error) throw new Error(error.message ?? String(error))
    exact = count
    rows.push(...data)
    if (data.length === 0 || (exact !== null && rows.length >= exact)) break
    from += data.length
  }
  if (rows.length !== exact) throw new Error(`read ${rows.length} rows, expected ${exact}`)
  return { rows, exact }
}

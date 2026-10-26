// Read every row of a PostgREST query. The server caps a response at its max-rows (1000), so a plain
// select silently truncates. `page(from, to)` returns the query for one range, built WITH
// { count: 'exact' } and an ORDER BY on a unique column. Throws unless rows received === exact count.
export async function readAllRows(page, size = 1000) {
  const rows = []
  let exact = null
  for (let from = 0; ; from += size) {
    const { data, error, count } = await page(from, from + size - 1)
    if (error) throw new Error(error.message ?? String(error))
    exact = count
    rows.push(...data)
    if (data.length === 0 || (exact !== null && rows.length >= exact)) break
  }
  if (rows.length !== exact) throw new Error(`read ${rows.length} rows, expected ${exact}`)
  return { rows, exact }
}

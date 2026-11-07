import { useState, useEffect, useCallback, useRef } from 'react'
import { CARS_PAGE } from '../constants/cars'

// One page at a time (Accommodation's idiom): count: 'exact' for the total, `.range()` per page,
// done when a page comes back short. `buildQuery` must return a fresh query each call; a new
// buildQuery (any filter change) starts over at page 0. `skip` holds the query back (e.g. while
// the exchange rates a price filter needs are still loading).
//
// A request token drops answers that arrive after the filters moved on: without it a slow page-0
// for the OLD filters can land after the new one and show a list that matches nothing on screen.
export default function usePagedVehicles(buildQuery, { skip = false } = {}) {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [moreError, setMoreError] = useState(false)
  const token = useRef(0)

  const load = useCallback(async (pageNum = 0, { pull = false } = {}) => {
    const my = ++token.current
    if (pageNum === 0) { if (pull) setRefreshing(true); else setLoading(true); setLoadError(false) } else setLoadingMore(true)
    setMoreError(false)
    const from = pageNum * CARS_PAGE
    let res
    try { res = await buildQuery().range(from, from + CARS_PAGE - 1) } catch (e) { res = { error: e } }
    if (my !== token.current) return
    const { data, count, error } = res
    if (!error && data) {
      setItems(prev => (pageNum === 0 ? data : [...prev, ...data]))
      setTotal(count ?? 0)
      setPage(pageNum)
      setDone(data.length < CARS_PAGE)
    } else if (pageNum === 0) {
      setItems([]); setLoadError(true)
    } else {
      setMoreError(true)
    }
    setLoading(false); setRefreshing(false); setLoadingMore(false)
  }, [buildQuery])

  useEffect(() => {
    if (skip) return
    setDone(false)
    load(0)
  }, [load, skip])

  const loadMore = useCallback(() => {
    if (loadingMore || done || loading || refreshing || moreError || skip) return
    load(page + 1)
  }, [loadingMore, done, loading, refreshing, moreError, skip, load, page])

  return {
    items, total, loading: loading || skip, refreshing, loadingMore, loadError, moreError, page,
    reload: () => load(0), refresh: () => load(0, { pull: true }), retryMore: () => load(page + 1), loadMore,
  }
}

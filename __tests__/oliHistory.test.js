// loadOliHistory on a hung connection: the query is aborted after HISTORY_TIMEOUT_MS and returns an error, so the
// sheet (which holds sending while history loads) does not stay dead.
import { loadOliHistory, HISTORY_TIMEOUT_MS } from '../utils/oliHistory'

let mockSignal
jest.mock('../lib/supabase', () => {
  const builder = {
    select: () => builder, order: () => builder, limit: () => builder,
    abortSignal: s => { mockSignal = s; return builder },
    then: (ok, fail) => new Promise((_, reject) => {
      const abort = () => reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }))
      if (!mockSignal) return   // no abort wired: hangs, as a dead connection does
      if (mockSignal.aborted) abort()
      else mockSignal.addEventListener('abort', abort)
    }).then(ok, fail),
  }
  return { supabase: { from: () => builder } }
})

test('a history load that never answers ends as an error', async () => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] })
  try {
    const pending = loadOliHistory()
    jest.advanceTimersByTime(HISTORY_TIMEOUT_MS + 10)
    const { rows, error } = await pending
    expect(rows).toEqual([])
    expect(error).toBeTruthy()
  } finally { jest.useRealTimers() }
})

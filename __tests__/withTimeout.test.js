const { withTimeout, TimeoutError } = require('../utils/withTimeout')

afterEach(() => jest.useRealTimers())

test('resolves with the work result and clears its timer', async () => {
  jest.useFakeTimers()
  await expect(withTimeout(() => Promise.resolve(7), 1000)).resolves.toBe(7)
  expect(jest.getTimerCount()).toBe(0)
})

test('a hung run rejects with TimeoutError after ms and its signal is aborted, even if it ignores abort', async () => {
  jest.useFakeTimers()
  let sig
  const p = withTimeout(s => { sig = s; return new Promise(() => {}) }, 5000)
  const caught = p.catch(e => e)
  await jest.advanceTimersByTimeAsync(4999)
  expect(sig.aborted).toBe(false)
  await jest.advanceTimersByTimeAsync(1)
  const e = await caught
  expect(e).toBeInstanceOf(TimeoutError)
  expect(sig.aborted).toBe(true)
})

test('a rejecting or throwing run passes its error through', async () => {
  await expect(withTimeout(() => Promise.reject(new Error('x')), 1000)).rejects.toThrow('x')
  await expect(withTimeout(() => { throw new Error('y') }, 1000)).rejects.toThrow('y')
})

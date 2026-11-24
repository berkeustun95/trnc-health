// React Native's OkHttp has no request timeout, so a hung request never settles. run(signal) starts the work;
// after ms the signal is aborted and the returned promise rejects with a TimeoutError, even if run ignores abort.
export class TimeoutError extends Error {
  constructor(ms) {
    super(`timed out after ${ms} ms`)
    this.name = 'TimeoutError'
  }
}

export function withTimeout(run, ms) {
  const controller = new AbortController()
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new TimeoutError(ms))
    }, ms)
  })
  let work
  try { work = Promise.resolve(run(controller.signal)) } catch (e) { work = Promise.reject(e) }
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

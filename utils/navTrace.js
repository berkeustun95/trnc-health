// TEMPORARY diagnostic — delete with its call sites before shipping.
//
// Round two, and deliberately narrow. The swipe now fires nowhere, from the edge
// or otherwise, so the gate is rejecting everything. This traces the gate's inputs
// and each of its terms at the moment it is evaluated, rather than reasoning about
// them — which is how `x0 === 0` survived three commits.
export function navTrace(tag, data = {}) {
  const body = Object.entries(data)
    .map(([k, v]) => `${k}=${v === undefined ? 'UNDEFINED' : v === null ? 'NULL' : v}`)
    .join('  ')
  console.log(`[nav] ${String(tag).padEnd(9)} ${body}`)
}

// Featured-tier helpers, shared across every facility directory so the badge,
// the "is this row featured right now" test, and the fair-rotation ordering have
// ONE definition. "Actively featured" is derived from featured_until (> now),
// matching the DB — no boolean to keep in sync, auto-expires with zero cron.

export function isFeatured(row) {
  return !!row?.featured_until && new Date(row.featured_until) > new Date()
}

// Fisher-Yates, returns a NEW array (never mutates the caller's data).
function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Pin actively-featured rows to the top, fairly rotated among themselves (uniform
// random per load — no cap, no "owner #1 forever"). Regular rows keep the order
// they arrived in (the directory's own server sort). Call this ONLY when featured
// surfacing is enabled; otherwise render the rows untouched.
export function partitionFeatured(rows) {
  const featured = []
  const regular  = []
  for (const r of rows) (isFeatured(r) ? featured : regular).push(r)
  return [...shuffle(featured), ...regular]
}

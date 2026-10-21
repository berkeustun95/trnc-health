// ─── Yeme-İçme basket: the pure store (no React, no Expo: scripts/test-eatery-order.mjs runs it as is) ────────
// One basket per partner id, { [dishId]: qty }, in memory only. Next to it sits at most ONE undo snapshot per partner:
// taken by clearAll (the whole basket + the note) and by changeQty when the last unit of a dish goes (the bin).
// A snapshot lives until the first basket edit that really changes something, until undo() takes it, or until the
// snackbar that offers it times out (dropSnapshot). A no-op never drops it, and an empty basket never overwrites it.
const baskets = new Map()
const snaps = new Map()
const listeners = new Set()
const EMPTY = Object.freeze({})
const emit = () => listeners.forEach(l => l())

export const getBasket = pid => baskets.get(pid) || EMPTY
export const subscribe = fn => { listeners.add(fn); return () => { listeners.delete(fn) } }

function put(pid, basket) {
  if (!basket || Object.keys(basket).length === 0) baskets.delete(pid)
  else baskets.set(pid, basket)
  emit()
}

// Adds delta (clamped 0..99) to one dish; 0 removes it. Returns null (nothing changed), 'changed', or 'removed'
// (the last unit of that dish went: a snapshot of the basket before it is kept for undo).
export function changeQty(pid, dishId, delta) {
  const cur = getBasket(pid)
  const before = cur[dishId] || 0
  const next = Math.max(0, Math.min(99, before + delta))
  if (next === before) return null
  const removed = next === 0
  if (removed) snaps.set(pid, { basket: cur, note: null, kind: 'item' })
  else snaps.delete(pid)
  const b = { ...cur }
  if (removed) delete b[dishId]
  else b[dishId] = next
  put(pid, b)
  return removed ? 'removed' : 'changed'
}

// Empties the basket, keeping it (and the note) for undo. false when there was nothing to clear.
export function clearAll(pid, note) {
  const cur = getBasket(pid)
  if (Object.keys(cur).length === 0) return false
  snaps.set(pid, { basket: cur, note: note ?? '', kind: 'all' })
  put(pid, null)
  return true
}

// Puts the snapshot back and returns it ({ basket, note, kind }), or null when there is none.
export function undo(pid) {
  const s = snaps.get(pid) || null
  snaps.delete(pid)
  if (s) put(pid, s.basket)
  return s
}

export const dropSnapshot = pid => { snaps.delete(pid) }
export const hasSnapshot = pid => snaps.has(pid)

// ─── Yeme-İçme basket: the pure store (no React, no Expo: scripts/test-eatery-order.mjs runs it as is) ────────
// One basket per partner id, { [lineKey]: qty }, in memory only. A line key is the dish id alone ("12", a dish with no options chosen:
// exactly the old shape) or "12|3,7x2": the dish plus its sorted option ids (a removal is just "3", an extra is "7x<qty>"). Next to it sits at most ONE undo snapshot per partner:
// taken by clearAll (the whole basket + the note) and by changeQty when the last unit of a dish goes (the bin).
// A snapshot lives until the first basket edit that really changes something, until undo() takes it, or until the
// snackbar that offers it times out (dropSnapshot). A no-op never drops it, and an empty basket never overwrites it.
const baskets = new Map()
const snaps = new Map()
const listeners = new Set()
let lastAdded = null   // the partner id of the latest real add, anywhere (menu or quiz results): the results bar follows it
const EMPTY = Object.freeze({})
const MAX_LINE_QTY = 99
const emit = () => listeners.forEach(l => l())

export const getBasket = pid => baskets.get(pid) || EMPTY
export const getLastAdded = () => lastAdded
export const subscribe = fn => { listeners.add(fn); return () => { listeners.delete(fn) } }

function put(pid, basket) {
  if (!basket || Object.keys(basket).length === 0) baskets.delete(pid)
  else baskets.set(pid, basket)
  emit()
}

// opts: [{ id, qty }] in any order, duplicates not expected. No options -> the bare dish id (never "12|").
export function lineKey(itemId, opts) {
  const list = (opts || []).filter(o => o && Number(o.qty) > 0).map(o => ({ id: Number(o.id), qty: Number(o.qty) })).sort((a, b) => a.id - b.id)
  if (list.length === 0) return String(itemId)
  return `${itemId}|${list.map(o => (o.qty === 1 ? String(o.id) : `${o.id}x${o.qty}`)).join(',')}`
}

// -> { itemId: string, opts: [{ id, qty }] }. A key that does not parse cleanly gives opts [] with the whole key as the id.
export function parseKey(key) {
  const k = String(key)
  const bar = k.indexOf('|')
  if (bar < 0) return { itemId: k, opts: [] }
  const opts = []
  for (const part of k.slice(bar + 1).split(',')) {
    const m = /^(\d+)(?:x(\d+))?$/.exec(part)
    if (!m) return { itemId: k, opts: [] }
    opts.push({ id: Number(m[1]), qty: m[2] ? Number(m[2]) : 1 })
  }
  return { itemId: k.slice(0, bar), opts }
}

// How many of one dish the basket holds across all its lines (plain and with options).
export function dishQty(basket, itemId) {
  const id = String(itemId)
  let n = 0
  for (const k of Object.keys(basket || {})) if (parseKey(k).itemId === id) n += basket[k]
  return n
}

// True when one dish needs the options sheet for its Ekle: it has visible options, or the basket still holds an option line of it
// (a dish that lost its options must not get a stepper whose minus only touches the bare key).
export const dishUsesSheet = (basket, itemId, hasVisibleOptions) => hasVisibleOptions || dishKeys(basket, itemId).some(k => k !== String(itemId))

// The keys of one dish's lines, in basket order.
export const dishKeys = (basket, itemId) => Object.keys(basket || {}).filter(k => parseKey(k).itemId === String(itemId))

// Adds delta (clamped 0..99) to one line; 0 removes it. Returns null (nothing changed), 'changed', or 'removed'
// (the last unit of that dish went: a snapshot of the basket before it is kept for undo).
export function changeQty(pid, dishId, delta) {   // dishId = a line key (the bare dish id for a plain line)
  const cur = getBasket(pid)
  const before = cur[dishId] || 0
  const next = Math.max(0, Math.min(99, before + delta))
  if (next === before) return null
  const removed = next === 0
  if (next > before) lastAdded = pid
  if (removed) snaps.set(pid, { basket: cur, note: null, kind: 'item' })
  else snaps.delete(pid)
  const b = { ...cur }
  if (removed) delete b[dishId]
  else b[dishId] = next
  put(pid, b)
  return removed ? 'removed' : 'changed'
}

// The sheet's result: puts qty on `toKey`, taking the line `fromKey` away (editing a line replaces it; fromKey null = a fresh add).
// Landing on a line that already exists adds to it (clamped). Any real change drops the undo snapshot, like every edit.
export function setLine(pid, fromKey, toKey, qty) {
  const cur = getBasket(pid)
  const b = { ...cur }
  if (fromKey != null) delete b[fromKey]
  b[toKey] = Math.max(1, Math.min(MAX_LINE_QTY, (b[toKey] || 0) + Math.max(1, Number(qty) || 1)))
  if (JSON.stringify(b) === JSON.stringify(cur)) return false
  snaps.delete(pid)
  lastAdded = pid
  put(pid, b)
  return true
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

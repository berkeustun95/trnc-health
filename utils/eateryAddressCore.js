// Delivery address book, the pure half (no AsyncStorage, so plain Node can test it). utils/eateryAddress.js is the storage half.
// This file must not import supabase or logContactEvent (test-eatery-order.mjs).
import { oneLine, sanitizeAddressField, addressKind, addressComplete, ADDRESS_BOOK_MAX, ADDRESS_NAME_MAX, ADDRESS_UNIT_MAX, ADDRESS_DIRECTIONS_MAX } from '../constants/eatery.js'

export { ADDRESS_BOOK_MAX, ADDRESS_NAME_MAX, ADDRESS_UNIT_MAX, ADDRESS_DIRECTIONS_MAX }
export const BOOK_KEY = 'ada.eateryAddresses.v1'
export const OLD_KEY = 'ada.eateryAddress.v1'

export const emptyBook = () => ({ v: 1, lastUsedId: null, items: [] })
export const makeId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

// Both numbers valid or both null; 5 dp (~1 m).
export function normalizePin(lat, lng) {
  const ok = typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  return ok ? { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5 } : { lat: null, lng: null }
}

// One entry, every text field through the sanitizer; null when it has no id or no text at all.
export function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id.trim()) return null
  const pin = normalizePin(raw.lat, raw.lng)
  const e = {
    id: raw.id.trim().slice(0, 40),
    kind: addressKind(raw.kind),
    name: oneLine(raw.name, ADDRESS_NAME_MAX),
    district: sanitizeAddressField(raw.district),
    street: sanitizeAddressField(raw.street),
    building: sanitizeAddressField(raw.building),
    floor: oneLine(raw.floor, ADDRESS_UNIT_MAX),
    flat: oneLine(raw.flat, ADDRESS_UNIT_MAX),
    directions: oneLine(raw.directions, ADDRESS_DIRECTIONS_MAX),
    lat: pin.lat,
    lng: pin.lng,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
  }
  return e.district || e.street || e.building || e.name ? e : null
}

const fixLastUsed = (items, id) => (items.some(i => i.id === id) ? id : items[0]?.id ?? null)

// raw: a JSON string or the parsed value. Anything malformed = the empty book; never throws.
export function normalizeBook(raw) {
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!o || typeof o !== 'object' || o.v !== 1 || !Array.isArray(o.items)) return emptyBook()
    const seen = new Set()
    const items = []
    for (const r of o.items) {
      const e = normalizeEntry(r)
      if (!e || seen.has(e.id)) continue
      seen.add(e.id)
      items.push(e)
      if (items.length >= ADDRESS_BOOK_MAX) break
    }
    return { v: 1, lastUsedId: fixLastUsed(items, o.lastUsedId), items }
  } catch { return emptyBook() }
}

// ─── Pure book operations: each returns { book, ok, item?, reason? } and never mutates ───
export function bookAdd(book, entry, now = Date.now(), id = makeId()) {
  if (book.items.length >= ADDRESS_BOOK_MAX) return { book, ok: false, reason: 'full' }
  const item = normalizeEntry({ ...entry, id, updatedAt: now })
  if (!item || !addressComplete(item)) return { book, ok: false, reason: 'invalid' }
  return { book: { v: 1, lastUsedId: item.id, items: [...book.items, item] }, ok: true, item }
}
export function bookUpdate(book, id, patch, now = Date.now()) {
  const cur = book.items.find(i => i.id === id)
  if (!cur) return { book, ok: false, reason: 'missing' }
  const item = normalizeEntry({ ...cur, ...patch, id, updatedAt: now })
  if (!item) return { book, ok: false, reason: 'invalid' }
  return { book: { ...book, items: book.items.map(i => (i.id === id ? item : i)) }, ok: true, item }
}
export function bookDelete(book, id) {
  const items = book.items.filter(i => i.id !== id)
  return { v: 1, lastUsedId: fixLastUsed(items, book.lastUsedId), items }
}
export const bookSetLastUsed = (book, id) => (book.items.some(i => i.id === id) ? { ...book, lastUsedId: id } : book)

// The one-address book of the first version: street / building / district only, no pin.
export function bookFromOld(raw) {
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!o || typeof o !== 'object') return emptyBook()
    const e = normalizeEntry({ id: makeId(), kind: 'other', name: '', street: o.street, building: o.building, district: o.district, updatedAt: Date.now() })
    return e ? { v: 1, lastUsedId: e.id, items: [e] } : emptyBook()
  } catch { return emptyBook() }
}

// storage: { getItem, setItem, removeItem } (AsyncStorage's shape). The new key is written FIRST; the old one goes only after
// that write succeeded, so a failed write keeps the old address for the next try. Never throws.
export async function loadBookFrom(storage) {
  try {
    const raw = await storage.getItem(BOOK_KEY)
    if (raw != null) return normalizeBook(raw)
    const old = await storage.getItem(OLD_KEY)
    if (old == null) return emptyBook()
    const book = bookFromOld(old)
    if (book.items.length === 0) { try { await storage.removeItem(OLD_KEY) } catch { /* retried next time */ } return book }
    try {
      await storage.setItem(BOOK_KEY, JSON.stringify(book))
      await storage.removeItem(OLD_KEY)
    } catch { /* old key stays until the book is written */ }
    return book
  } catch { return emptyBook() }
}

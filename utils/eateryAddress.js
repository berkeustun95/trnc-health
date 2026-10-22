import AsyncStorage from '@react-native-async-storage/async-storage'
import { BOOK_KEY, OLD_KEY, emptyBook, loadBookFrom, bookAdd, bookUpdate, bookDelete, bookSetLastUsed } from './eateryAddressCore'

// The delivery address book stays on THIS phone: up to 10 addresses (name, text, optional map pin), never sent anywhere.
// This file must not import supabase or logContactEvent (test-eatery-order.mjs). Pure logic: eateryAddressCore.js.
export { ADDRESS_BOOK_MAX } from './eateryAddressCore'

// { v, lastUsedId, items } — the empty book when nothing is saved, malformed, or storage failed. Never throws.
export const loadBook = () => loadBookFrom(AsyncStorage)

async function change(fn) {
  try {
    const book = await loadBook()
    const r = fn(book)
    if (r.ok === false) return r
    await AsyncStorage.setItem(BOOK_KEY, JSON.stringify(r.book))
    return r
  } catch { return { ok: false, reason: 'storage' } }
}

// { ok:true, item } | { ok:false, reason:'full'|'invalid'|'storage' }. The new address becomes the last used one.
export const addAddress = entry => change(b => bookAdd(b, entry))
export const updateAddress = (id, patch) => change(b => bookUpdate(b, id, patch))
export const deleteAddress = id => change(b => ({ ok: true, book: bookDelete(b, id) }))
export const setLastUsed = id => change(b => ({ ok: true, book: bookSetLastUsed(b, id) }))

// Account deletion: the book and the pre-book key.
export async function clearBook() {
  for (const k of [BOOK_KEY, OLD_KEY]) { try { await AsyncStorage.removeItem(k) } catch { /* nothing to clear */ } }
}
export { emptyBook }

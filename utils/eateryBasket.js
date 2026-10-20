import { useEffect, useState } from 'react'
import Constants from 'expo-constants'

// ─── Yeme-İçme order basket: in memory only ─────────────────────────────────
// One basket per partner id, { [dishId]: qty }. It survives leaving and reopening the partner page and is
// gone when the app is killed. No AsyncStorage, no database: what someone wants to eat is not ours to keep.

// ADA Preview only: a partner with no WhatsApp number of its own orders to the tester's number, so the flow can
// be tried end to end before any restaurant is live. Same two gates as PREVIEW_KEY in lib/supabase.js; the value
// is inlined at bundle time, so scripts/check-ota-preflight.mjs (d) refuses a production publish that could see it.
const TEST_WHATSAPP = Constants.expoConfig?.extra?.appVariant === 'preview' ? process.env.EXPO_PUBLIC_ADA_TEST_WHATSAPP : undefined

// The number an order goes to: the partner's own, else (Preview only) the test number. A fixture partner has none.
// The visible WhatsApp contact button reads partner.whatsapp alone and never this.
export const effectiveWhatsapp = p => {
  if (!p || p.placeholder) return ''
  const own = typeof p.whatsapp === 'string' ? p.whatsapp.trim() : ''
  return own || (TEST_WHATSAPP || '').trim()
}

const baskets = new Map()
const listeners = new Set()
const EMPTY = Object.freeze({})
const emit = () => listeners.forEach(l => l())

export const getBasket = pid => baskets.get(pid) || EMPTY

export function setBasket(pid, basket) {
  if (!basket || Object.keys(basket).length === 0) baskets.delete(pid)
  else baskets.set(pid, basket)
  emit()
}

// Adds delta (clamped 0..99) to one dish; 0 removes it.
export function changeQty(pid, dishId, delta) {
  const cur = getBasket(pid)
  const next = Math.max(0, Math.min(99, (cur[dishId] || 0) + delta))
  if (next === (cur[dishId] || 0)) return
  const b = { ...cur }
  if (next === 0) delete b[dishId]
  else b[dishId] = next
  setBasket(pid, b)
}

export function useBasket(pid) {
  const [basket, setLocal] = useState(() => getBasket(pid))
  useEffect(() => {
    const sync = () => setLocal(getBasket(pid))
    listeners.add(sync)
    sync()
    return () => { listeners.delete(sync) }
  }, [pid])
  return basket
}

import { useEffect, useState } from 'react'
import Constants from 'expo-constants'
import { getBasket, subscribe } from './eateryBasketCore'

// ─── Yeme-İçme order basket: in memory only (the store itself is eateryBasketCore.js) ──────────────
// It survives leaving and reopening the partner page and is
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

export { getBasket, changeQty, clearAll, undo, dropSnapshot, getLastAdded } from './eateryBasketCore'

export function useBasket(pid) {
  const [basket, setLocal] = useState(() => getBasket(pid))
  useEffect(() => {
    const sync = () => setLocal(getBasket(pid))
    const off = subscribe(sync)
    sync()
    return off
  }, [pid])
  return basket
}

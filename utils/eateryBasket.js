import { useEffect, useState } from 'react'
import Constants from 'expo-constants'
import { getBasket, subscribe } from './eateryBasketCore'
import { eateryContactNumbers, eateryLogsContacts } from '../constants/eatery'

// ─── Yeme-İçme order basket: in memory only (the store itself is eateryBasketCore.js) ──────────────
// It survives leaving and reopening the partner page and is
// gone when the app is killed. No AsyncStorage, no database: what someone wants to eat is not ours to keep.

// ADA Preview only: every partner contact (order, WhatsApp button, Ara) goes to the tester's number instead of the
// partner's own, so a test can never reach a real shop. Same two gates as PREVIEW_KEY in lib/supabase.js; the value
// is inlined at bundle time, so scripts/check-ota-preflight.mjs (d) refuses a production publish that could see it.
export const IS_PREVIEW = Constants.expoConfig?.extra?.appVariant === 'preview'
const TEST_WHATSAPP = Constants.expoConfig?.extra?.appVariant === 'preview' ? process.env.EXPO_PUBLIC_ADA_TEST_WHATSAPP : undefined
// Owner-demo recording (Berke, 2026-11-02): a short "your basket is being sent" hand-off screen before the partner's site opens,
// and no PREVIEW tags. ADA Preview only AND only when the bundle was published with EXPO_PUBLIC_EATERY_DEMO=1; production can
// never show it. Off by default: publish the Preview without the variable to turn it off.
export const EATERY_DEMO = IS_PREVIEW && process.env.EXPO_PUBLIC_EATERY_DEMO === '1'

// The one door to a partner's numbers for the screens; the rule itself is eateryContactNumbers (constants/eatery.js).
const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__
export const CONTACT_LOGGING = eateryLogsContacts({ isPreview: IS_PREVIEW, isDev: IS_DEV })
export const partnerContactNumbers = p => eateryContactNumbers(p, { isPreview: IS_PREVIEW, testNumber: TEST_WHATSAPP, isDev: IS_DEV })
export const effectiveWhatsapp = p => partnerContactNumbers(p).whatsapp || ''

export { getBasket, changeQty, setLine, clearAll, undo, dropSnapshot, getLastAdded, lineKey, parseKey, dishQty, dishKeys, dishUsesSheet } from './eateryBasketCore'

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

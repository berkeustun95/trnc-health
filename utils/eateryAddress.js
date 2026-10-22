import AsyncStorage from '@react-native-async-storage/async-storage'
import { sanitizeAddressField } from '../constants/eatery'

// The delivery address stays on THIS phone, only to prefill Sepetim next time. Three text fields and nothing else: never
// the delivery mode, never coordinates. This file must not import supabase or logContactEvent (test-eatery-order.mjs).
const KEY = 'ada.eateryAddress.v1'
const FIELDS = ['street', 'building', 'district']

// { street, building, district } or null (nothing saved, malformed, or storage failed). Never throws.
export async function loadAddress() {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    if (!raw) return null
    const o = JSON.parse(raw)
    if (!o || typeof o !== 'object') return null
    const out = {}
    for (const f of FIELDS) out[f] = sanitizeAddressField(o[f])
    return FIELDS.some(f => out[f]) ? out : null
  } catch { return null }
}

export async function saveAddress({ street, building, district } = {}) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ street: sanitizeAddressField(street), building: sanitizeAddressField(building), district: sanitizeAddressField(district) }))
  } catch { /* a failed save only means no prefill next time */ }
}

export async function clearAddress() {
  try { await AsyncStorage.removeItem(KEY) } catch { /* nothing to clear */ }
}

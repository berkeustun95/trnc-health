import AsyncStorage from '@react-native-async-storage/async-storage'

// The TRNC Central Bank's daily rates, shared by ExchangeRatesScreen (the table + calculator) and
// CarsScreen (the GBP price filter). Moved here unchanged from ExchangeRatesScreen.js.

// New cache key: the KKTC payload shape differs from the old Frankfurter one,
// so a fresh key avoids parsing a stale incompatible cache after the OTA.
export const FX_CACHE_KEY = 'ada_kktc_fx_cache_v1'

// ─── PINNED SCHEMA — KKTC Merkez Bankası daily FX feed ──────────────────────
// Source: https://mb.gov.ct.tr/kur/gunluk.xml  (official TRNC Central Bank,
// public, no API key, XML published since 2011). Parsed with regex against a
// FIXED, government-controlled flat schema — deliberately no XML library.
// Header:   <Kur_Tarihi> DD/MM/YYYY   <Gecerli_Tarih_Araligi> single date OR
//           "DD/MM/YYYY - DD/MM/YYYY" (weekends/holidays span a range).
// Per row:  <Resmi_Kur> … <Birim> <Sembol> <Doviz_Alis> <Doviz_Satis>
//           <Efektif_Alis> <Efektif_Satis> … </Resmi_Kur>
// If parseKktcFx() starts returning null, these element names likely changed —
// diff against a fresh fetch of the URL above to diagnose.
const FX_URL = 'https://mb.gov.ct.tr/kur/gunluk.xml'

// The currencies kept from the feed. Adding one = one entry here (parser is generic).
export const FX_CODES = ['USD', 'GBP', 'EUR']

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))
  return m ? m[1].trim() : null
}

export function parseKktcFx(xml) {
  if (!xml) return null
  const date = tag(xml, 'Kur_Tarihi')
  const validRange = tag(xml, 'Gecerli_Tarih_Araligi')
  const rates = {}
  const blocks = xml.match(/<Resmi_Kur>[\s\S]*?<\/Resmi_Kur>/g) || []
  for (const block of blocks) {
    const sym = tag(block, 'Sembol')
    if (!sym || !FX_CODES.includes(sym)) continue
    // Birim is the unit multiplier (e.g. JPY quotes per 100). Always divide so
    // adding a Birim>1 currency later can never silently produce a 100× value.
    const birim = parseFloat(tag(block, 'Birim')) || 1
    const num = name => {
      const v = parseFloat(tag(block, name))
      return Number.isFinite(v) ? v / birim : null
    }
    rates[sym] = {
      dovizAlis:    num('Doviz_Alis'),
      dovizSatis:   num('Doviz_Satis'),
      efektifAlis:  num('Efektif_Alis'),
      efektifSatis: num('Efektif_Satis'),
    }
  }
  if (!date || Object.keys(rates).length === 0) return null
  return { date, validRange, rates }
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export async function fetchKktcFx() {
  const resp = await fetch(FX_URL)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const xml = await resp.text()
  const parsed = parseKktcFx(xml)
  if (!parsed) throw new Error('parse failed')
  return { ...parsed, fetchedOn: todayStr() }
}

// Today's cache if there is one; otherwise a fresh fetch, stored. On a failed fetch it hands back
// the older cache (or null) with failed: true, so the caller decides whether stale rates will do.
export async function loadKktcFx() {
  let cache = null
  try {
    const raw = await AsyncStorage.getItem(FX_CACHE_KEY)
    if (raw) cache = JSON.parse(raw)
  } catch (_) {}

  if (cache && cache.fetchedOn === todayStr()) return { data: cache, failed: false }

  try {
    const fresh = await fetchKktcFx()
    await AsyncStorage.setItem(FX_CACHE_KEY, JSON.stringify(fresh))
    return { data: fresh, failed: false }
  } catch (_) {
    return { data: cache, failed: true }
  }
}

// A retry skips the cache: the caller already has whatever it held.
export async function refreshKktcFx() {
  const fresh = await fetchKktcFx()
  await AsyncStorage.setItem(FX_CACHE_KEY, JSON.stringify(fresh))
  return fresh
}

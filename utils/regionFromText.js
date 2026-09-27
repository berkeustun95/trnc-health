import { resolveRegion } from './resolveRegion'

// ─── District from an address's text — the fallback when there are no coordinates ──
//
// TRNC addresses put the town at the end ("Kaya Palazzo, Girne"), so the LAST town named
// wins; on a tie the LONGER name wins, so a key that is a prefix of another (boğaz / boğaziçi)
// cannot silently defeat it. Same rule as townOf() in scripts/geocode-pharmacies-tier2.mjs,
// but mapped to the app's region slugs — where Karpaz is its own district, not İskele.
//
// Only names that sit unambiguously inside one district are listed; a village near a
// boundary is left out rather than guessed. Turkish lower-casing first: 'İ' → 'i', 'I' → 'ı'.

const TOWN = {
  // nicosia
  lefkoşa: 'nicosia', lefkosa: 'nicosia', nicosia: 'nicosia', lefkosia: 'nicosia',
  gönyeli: 'nicosia', hamitköy: 'nicosia', ortaköy: 'nicosia', kumsal: 'nicosia',
  yenikent: 'nicosia', yenişehir: 'nicosia', 'küçük kaymaklı': 'nicosia', göçmenköy: 'nicosia',
  taşkınköy: 'nicosia', metehan: 'nicosia', kermiya: 'nicosia', haspolat: 'nicosia',
  dereboyu: 'nicosia', köşklüçiftlik: 'nicosia',
  // kyrenia
  girne: 'kyrenia', kyrenia: 'kyrenia', keryneia: 'kyrenia', lapta: 'kyrenia',
  alsancak: 'kyrenia', karaoğlanoğlu: 'kyrenia', çatalköy: 'kyrenia', doğanköy: 'kyrenia',
  karakum: 'kyrenia', zeytinlik: 'kyrenia', bellapais: 'kyrenia', beylerbeyi: 'kyrenia',
  ozanköy: 'kyrenia', esentepe: 'kyrenia', çamlıbel: 'kyrenia', edremit: 'kyrenia',
  boğazköy: 'kyrenia',
  // famagusta
  gazimağusa: 'famagusta', gazimagusa: 'famagusta', mağusa: 'famagusta', magusa: 'famagusta',
  famagusta: 'famagusta', ammochostos: 'famagusta', sakarya: 'famagusta', maraş: 'famagusta',
  çanakkale: 'famagusta', baykal: 'famagusta', karakol: 'famagusta', salamis: 'famagusta',
  tuzla: 'famagusta', dumlupınar: 'famagusta', boğaziçi: 'famagusta',
  // morphou
  güzelyurt: 'morphou', guzelyurt: 'morphou', morphou: 'morphou', morfou: 'morphou',
  // lefke
  lefke: 'lefke', gemikonağı: 'lefke', yeşilyurt: 'lefke', gaziveren: 'lefke',
  // iskele
  iskele: 'iskele', trikomo: 'iskele', boğaz: 'iskele', 'long beach': 'iskele',
  // karpaz
  karpaz: 'karpaz', dipkarpaz: 'karpaz', rizokarpaso: 'karpaz',
}

const trLower = s => String(s).replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase()

export function regionFromText(text) {
  if (!text) return null
  const t = trLower(text)
  let best = null, at = -1, len = -1
  for (const [needle, region] of Object.entries(TOWN)) {
    const i = t.lastIndexOf(needle)
    if (i > at || (i === at && i !== -1 && needle.length > len)) { at = i; len = needle.length; best = region }
  }
  return best
}

// An event's district: its coordinates first (exact), else the town at the end of its
// location text. Used for EVERY event, so future imports without coordinates are placed too.
export function eventRegion(event) {
  const byCoords = event?.latitude != null && event?.longitude != null
    ? resolveRegion(event.latitude, event.longitude) : null
  return byCoords ?? regionFromText(event?.location)
}

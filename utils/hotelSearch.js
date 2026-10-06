// Oteller name search and sort (HotelsTab). Pure, so scripts/check-hotel-search.mjs runs it in Node.

// Turkish-tolerant folding: "celebi" finds "Çelebi", "dome" finds "DOME", "lords" finds
// "Lord's". Explicit map, not String.normalize: Hermes' Unicode support is not something to
// bet a search box on. I/İ/ı all fold to i (Turkish casing rules would otherwise split them).
const FOLD = {
  ı: 'i', İ: 'i', I: 'i', ş: 's', Ş: 's', ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ö: 'o', Ö: 'o', ü: 'u', Ü: 'u',
  â: 'a', Â: 'a', î: 'i', Î: 'i', û: 'u', Û: 'u', é: 'e', É: 'e', è: 'e', ê: 'e', ë: 'e', á: 'a', à: 'a', ä: 'a',
  ó: 'o', ò: 'o', í: 'i', ú: 'u', ñ: 'n',
}
export function foldName(s) {
  return String(s ?? '')
    .replace(/[ıİIşŞçÇğĞöÖüÜâÂîÎûÛéÉèêëáàäóòíúñ]/g, c => FOLD[c])
    .toLowerCase()
    .replace(/[’'`´.]/g, '')
    .replace(/[^a-z0-9Ͱ-ϿЀ-ӿ؀-ۿ]+/g, ' ')
    .trim()
}

export function matchesName(name, query) {
  const q = foldName(query)
  return !q || foldName(name).includes(q)
}

export const HOTEL_SORTS = ['recommended', 'az', 'za', 'stars']
export const HOTEL_SORT_LABEL_KEY = {
  recommended: 'hotelSortRecommended', az: 'hotelSortAZ', za: 'hotelSortZA', stars: 'hotelSortStars',
}

// classRank: HOTEL_CLASSES order (stars high → low, then the non-star types); stars: star count,
// 0 for a non-star type. 'recommended' is the order the tab has always had.
export function sortHotels(hotels, sort, { classRank, stars, compare }) {
  const byName = (a, b) => compare(a.name, b.name)
  const cmp = {
    recommended: (a, b) => (classRank[a.kitob_class] - classRank[b.kitob_class]) || byName(a, b),
    az: byName,
    za: (a, b) => byName(b, a),
    stars: (a, b) => ((stars[b.kitob_class] || 0) - (stars[a.kitob_class] || 0)) || byName(a, b),
  }[sort] || ((a, b) => (classRank[a.kitob_class] - classRank[b.kitob_class]) || byName(a, b))
  return [...hotels].sort(cmp)
}

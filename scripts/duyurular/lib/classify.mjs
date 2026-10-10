// Which items are announcements, what kind they are, and which category they land in.
// Every comparison is on trLower() text (see text.mjs for why).
//
// Per-source filter_mode (measured 2026-10-10: announcement-category feeds keep ~70–100%,
// news feeds 0–10%):
//   'all'      — keep everything except DROP matches
//   'keywords' — keep only KEEP matches, and still not DROP matches

import { trLower } from './text.mjs'

export const KEEP = new RegExp([
  'duyuru', 'münhal', 'ilan', 'ihale', 'başvuru', 'müracaat', 'sınav', 'burs', 'kontenjan', 'kayıt',
  'son gün', 'son tarih', 'son teklif', 'son ödeme', 'kesinti', 'uyarı', 'çağrı', 'hibe', 'destek program',
  'kılavuz', 'personel alım', 'eleman alım', 'istihdam', 'kadro', 'seçim', 'yol kapa', 'trafiğe kapa',
  'kapatıl', 'asfalt', 'takvim', 'af kanun', 'erteleme', 'nakil', 'dikkatine', 'beyanname', 'prim',
  'vacanc', 'position', 'call for', 'deadline', 'scholarship', 'tender', 'announcement',
].join('|'))

export const DROP = new RegExp([
  'ziyaret', 'kabul etti', 'görüştü', 'görüşme gerçekleştir', 'konuştu', 'başsağlığı', 'taziye', 'kutla',
  'tebrik', 'anma', 'törenle', 'töreni', 'mesajı', 'ödül', 'ağırladı', 'katıldı', 'söyleşi', 'konferans',
  'panel', 'oryantasyon', 'şenli', 'festival', 'sergi', 'turnuva', 'konser', 'seminer', 'çalıştay', 'webinar',
].join('|'))

export function passesFilter(title, source) {
  const t = trLower(title)
  if (DROP.test(t)) return { keep: false, why: 'drop' }
  if (source.drop && source.drop.test(t)) return { keep: false, why: 'source_drop' }
  if (source.filter_mode === 'all') return { keep: true }
  return KEEP.test(t) ? { keep: true } : { keep: false, why: 'no_keyword' }
}

// 'result' items (exam results, tender award notices = "karar ilanı", "sonuç bildirgesi")
// never enter "Son günler" and never get a deadline hunt.
const RESULT = /sonuç|sonuc|karar ilanı|kazanan|kesinleşen|yerleştirme liste|kesin kayıt hakkı|asil ve yedek|results/
const OPEN = /münhal|ihale|başvuru|müracaat|burs|kayıt|sınav|çağrı|alım|istihdam|kontenjan|teklif|ilan|vacanc|position|call for|scholarship|tender|deadline/

export function kindOf(title) {
  const t = trLower(title)
  if (RESULT.test(t)) return 'result'
  if (OPEN.test(t)) return 'open'
  return 'info'
}

// Category starts from the source; two narrow overrides move an item where a resident would
// look for it. A Central Bank "DİBS ihale" is a bond auction, not a tender: it stays put.
export function categoryOf(title, source) {
  const t = trLower(title)
  if (source.category !== 'ihale' && /ihale/.test(t) && !/dibs|borçlanma|senedi/.test(t)) return 'ihale'
  if ((source.category === 'belediye' || source.category === 'kamu') &&
      /kesinti|su verilemeyecek|elektrik verilemeyecek|trafiğe kapa|yol kapa|asfalt çalışması|yol çalışması/.test(t)) return 'kesinti'
  return source.category
}

// Category precedence when the same URL arrives from two feeds of one site.
export const CATEGORY_RANK = ['ihale', 'kesinti', 'kamu', 'egitim', 'destek', 'ulasim', 'belediye']

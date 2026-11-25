// gisekibris.com can answer HTTP 200 with its "404 - Sayfa Bulunamadı" page (seen
// 2026-11-25 on yusuf-bilal-altintas-stand-up, byte-identical to an unknown slug's 404).
// Every real event page also carries that text, in its i18n dictionary
// ("notFound404":"404 - Sayfa Bulunamadı"), so only the RENDERED element counts.
const RENDERED_NOT_FOUND = />\s*404 - Sayfa Bulunamadı\s*</

export function isNotFoundPage(body) {
  return typeof body === 'string' && RENDERED_NOT_FOUND.test(body)
}

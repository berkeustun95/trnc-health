// Bugün ADA'da slider — slide assembly. Pure: no network, no storage, no React, so plain Node can test it.
//   slide 1   the lead: the resolver ladder's item (utils/homeStripResolver.js), unchanged
//   slide 2.. one per active eatery partner. EDITORIAL (Berke, 2026-10-20): no "Sponsorlu" pill, shown to everyone
//             (guests, no-DOB and under-18 accounts included). A partner whose adult_only is anything but an explicit
//             false (20261121; true, or not selected) keeps the 18+ promo gate. Paid DB promos (the lead) keep the
//             Sponsorlu label and the 18+ gate in utils/homeStripResolver.js — unchanged.
// "Never twice running" (STRIP_LAST_KIND_KEY) is a rule of the lead only; partner slides ignore it.
import { t } from '../constants/i18n.js'
import { eateryPartnerVisible } from '../constants/eatery.js'

const byBase = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name))

// A partner slide has no photo: the ADA frame + the partner logo are the whole design. `logoPath` is the raw
// eatery-images storage path (the component resolves the URL with eateryImageUrl); `placeholder` marks a
// Preview-fixture partner so the UI can say so.
export const partnerSlide = (row, lang) => ({
  kind: 'promo', id: `eatery-${row.slug}`,
  title: row.name,
  subtitle: t('eateryStripSub', lang),
  eaterySlug: row.slug,
  logoPath: row.logo_path ?? null,
  placeholder: !!row.placeholder,
  ...(row.is_active === false ? { unpublished: true } : null),
  action: { type: 'eatery', slug: row.slug },
})

// Fair rotation: the partner order starts at partners[rotation % n] and wraps. A missing or garbage
// rotation counts as 0.
const startIndex = (rotation, n) => {
  const r = Number.isInteger(rotation) && rotation >= 0 ? rotation : 0
  return n > 0 ? r % n : 0
}

// The rotation value to store after the slider has shown its partners: the next partner leads next time.
export const nextStripRotation = (rotation, n) => (n > 0 ? (startIndex(rotation, n) + 1) % n : 0)

// lead: the ladder's item (never null in practice: the ladder ends in the generic card). If it ever were,
// the partners alone are returned rather than throwing in the render path.
export function assembleStripSlides({ lead, partners, promosEligible, gates, rotation = 0, lang }) {
  const slides = lead ? [lead] : []
  const seen = new Set()
  // Fail closed: only an explicit adult_only === false is editorial; anything else needs a promo-eligible user.
  const allowed = r => r.adult_only === false || promosEligible === true
  const rows = (Array.isArray(partners) ? partners : [])
    .filter(r => r && typeof r.slug === 'string' && r.slug && r.name && allowed(r) && eateryPartnerVisible(r, gates) && !seen.has(r.slug) && seen.add(r.slug))
    .sort(byBase)
  const k = startIndex(rotation, rows.length)
  for (const r of [...rows.slice(k), ...rows.slice(0, k)]) slides.push(partnerSlide(r, lang))
  return slides
}

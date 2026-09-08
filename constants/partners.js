// Commercial partners — one entry per firm, and a second partner must cost exactly
// one entry here.
//
// A PARTNER IS NOT A TIER. There is no is_featured column and no paid-placement
// machinery behind this file: a partner is a specific firm we have a specific
// agreement with, named in code, and the directory around them is unchanged. That is
// deliberately different from facilities' `featured_until` (a self-serve tier anyone
// can buy) — conflating the two would mean a config edit could sell placement, which
// is a decision that should never be one line in a constants file.
//
// No react-native import and NO require(): plain data only, so a Node-side guard can
// import this module and check the uuid against supabase/migrations/20261011. The same
// constraint constants/towing.js and constants/ads.js carry, for the same reason.
// The logo asset is resolved in the CARD (components/home-services/PartnerCard.js),
// because require() is what would break that.

import { LANG_CODES } from './i18n.js'

// ─── THE UUID IS THE CONTRACT ────────────────────────────────────────────────
//
// It is the same literal as supabase/migrations/20261011_seed_tadilart_cyprus.sql, and
// the H-token in verify_schema.sql asserts the row still carries it. A typo here does
// not throw: the row lookup returns nothing, the card does not render, and the module
// looks exactly as it did before the partnership. Change one, change all three.
export const HS_PARTNERS = [
  {
    id:         '0496fb4c-4e5d-4e35-a238-dd1fcb402541',
    slug:       'tadilart-cyprus',
    // The DISPLAY name comes from the home_services row, not from here — one source of
    // truth, and it is the one an admin can correct. This is for logs and asset lookup.
    name:       'TadilArt Cyprus',
    taglineKey: 'hsPartnerTadilartTagline',
    // Phase 3 renders this on the partner detail screen. The key is declared now so the
    // config shape is complete; the nine strings are NOT written yet, because partner
    // marketing copy nobody has approved is not something to invent.
    aboutKey:   'hsPartnerTadilartAbout',
    // Pending. The card falls back to an initials monogram, which is the finished empty
    // state and not a placeholder box — same posture as components/TowingLogo.js.
    logo:       null,
    // Deferred. The detail screen hides the whole gallery section when this is empty;
    // it never renders empty frames.
    gallery:    [],
  },
]

export const HS_PARTNER_IDS = HS_PARTNERS.map(p => p.id)

const BY_ID = Object.fromEntries(HS_PARTNERS.map(p => [p.id, p]))
export const hsPartner = id => BY_ID[id]

// ─── The WhatsApp handoff, in TWO languages and not nine ─────────────────────
//
// Turkish for locale `tr`, English for the other eight. This is NOT an oversight and it
// deliberately does not live in constants/i18n.js, because a key sitting in that file
// invites the next person to "finish" it into nine locales — and nine translations of a
// message addressed to a Turkish-speaking contractor in Lefkoşa is work with no reader.
// The message is read by the FIRM, not by the user who sends it.
//
// The consequence, stated so it is chosen rather than discovered: a Russian speaker taps
// WhatsApp and the draft in their compose box is English. That is the right trade — they
// can edit it, and an English sentence a builder can act on beats a Russian one nobody at
// the firm reads.
const TEMPLATES = {
  tr: (service) => `Merhaba, ADA uygulamasından yazıyorum. ${service} için fiyat teklifi almak istiyorum.`,
  en: (service) => `Hello, I'm contacting you from the ADA app. I'd like a quote for ${service}.`,
}

// Used when the card is tapped from the module LANDING, where no category is selected.
const GENERIC_SERVICE = { tr: 'tadilat işleri', en: 'renovation work' }

// `lang` is a FULL NAME ('Turkish'), not a code — LANG_CODES is the only place that
// mapping exists. Comparing against 'tr' here would silently send English to every
// Turkish speaker, and would look completely correct in review.
export const partnerWaLocale = lang => (LANG_CODES[lang] === 'tr' ? 'tr' : 'en')

// serviceByLocale: { tr, en } — the service name IN THE MESSAGE'S OWN LANGUAGE, never in
// the reader's. A Turkish message naming "Bathroom Renovation" is worse than either
// language on its own. Pass null/undefined for the landing card's generic fallback.
export function partnerWaMessage(lang, serviceByLocale) {
  const loc     = partnerWaLocale(lang)
  const service = serviceByLocale?.[loc] || GENERIC_SERVICE[loc]
  return TEMPLATES[loc](service)
}

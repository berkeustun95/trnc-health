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
    // Rendered by the partner detail screen. The nine strings exist as of Phase 3 and are
    // a DRAFT pending the partner's approval — if they are ever pulled, deleting the key
    // or the strings hides the block rather than printing the key name, because both the
    // card and the detail screen compare t()'s result against the key itself.
    aboutKey:   'hsPartnerTadilartAbout',
    // Asset KEYS, not files. constants/partnerAssets.js is the only place a key becomes
    // a require(); an unwired key yields undefined and the logo falls back to a monogram.
    logo:       'tadilart/logo',
    logoOnDark: 'tadilart/logo-onDark',

    // ─── Gallery: each project declares its OWN mode ──────────────────────
    //
    // Two modes because two projects genuinely differ in what the photos are FOR, and
    // forcing one shape on both loses the point of the other. A bathroom is a
    // TRANSFORMATION: the whole claim is this room became that room, and it only lands
    // if the two frames are adjacent. An extension is a PROCESS: nobody doubts that a
    // terrace can become a room, the question is whether these people can build it, and
    // the answer is the steel going up in step 3 — which a before/after pair deletes.
    //
    // A third project gets whichever mode fits it; `mode` is per project, never per
    // partner, so a firm can have both. An unknown mode renders nothing rather than
    // guessing.
    //
    // LABELS ARE i18n KEYS. Never text in the image: the source posts had English
    // "Before" and "In Progress" burned into the artwork, which is a label that seven of
    // our nine locales cannot read and no translation can reach. Those crops are gone
    // and must not come back.
    gallery: [
      {
        id: 'bathroom',
        mode: 'pairs',
        titleKey: 'hsPartnerProjBathroom',
        // Written as the DIVISION, not as a decimal, so the number carries where it came
        // from: every one of these ten frames is 1080x1225. All shots render with
        // resizeMode 'cover', so a container aspect that disagrees with the source
        // centre-crops — and for a bathroom the dimension being trimmed is the one the
        // photo exists to show, floor to ceiling. The screen's old hardcoded 1 was a
        // guess made before the files existed and cost ~12% of the height.
        aspect: 1080 / 1225,
        pairs: [
          { labelKey: 'hsPartnerPairWc',     before: 'tadilart/bathroom/before_1_wc',     after: 'tadilart/bathroom/after_1_wide' },
          { labelKey: 'hsPartnerPairShower', before: 'tadilart/bathroom/before_2_shower', after: 'tadilart/bathroom/after_3_shower' },
          { labelKey: 'hsPartnerPairBasin',  before: 'tadilart/bathroom/before_3_basin',  after: 'tadilart/bathroom/after_5_basin' },
        ],
        // Frames with no counterpart. They are worth showing and they are NOT pairs —
        // filing them as one would mean inventing a "before" for a finished vanity.
        extra: [
          'tadilart/bathroom/progress_1',
          'tadilart/bathroom/after_2_vanity',
          'tadilart/bathroom/after_4_wc',
          'tadilart/bathroom/after_6_door',
        ],
      },
      {
        id: 'extension',
        mode: 'sequence',
        titleKey: 'hsPartnerProjExtension',
        // This set is NOT uniform: four frames are 1080x921, 01_oncesi is 1080x889 and
        // 06_sonuc is 1080x885. One container aspect has to serve all six, so this is the
        // dominant one — exact for four, and the other two lose about 4% off the sides,
        // which is the smallest total crop available. There is no single "real" value to
        // take here and pretending otherwise would be the rounding this avoids.
        aspect: 1080 / 921,
        // ORDER IS THE CONTENT. Array order is the render order; there is no sort key,
        // because a numeric field invites someone to renumber and lose the sequence.
        steps: [
          { labelKey: 'hsPartnerBefore',       image: 'tadilart/extension/01_oncesi' },
          { labelKey: 'hsPartnerStepStart',    image: 'tadilart/extension/02_baslangic' },
          { labelKey: 'hsPartnerStepSteel',    image: 'tadilart/extension/03_celik' },
          { labelKey: 'hsPartnerStepBuild',    image: 'tadilart/extension/04_insa' },
          { labelKey: 'hsPartnerStepFacade',   image: 'tadilart/extension/05_cephe' },
          { labelKey: 'hsPartnerStepResult',   image: 'tadilart/extension/06_sonuc' },
        ],
      },
    ],
  },
]

export const HS_PARTNER_IDS = HS_PARTNERS.map(p => p.id)

// ─── Gallery derivation — pure, and the ONLY place emptiness is decided ─────
//
// Takes the resolver (constants/partnerAssets.js's `partnerAsset`) rather than importing
// it, so this stays require()-free and a Node harness can drive it with a stub map. The
// screen renders exactly what this returns and makes no emptiness decisions of its own;
// a section that is hidden is hidden HERE, once, for both modes.
//
// THE RULE FOR A HALF-MISSING PAIR: drop it. A pair whose `after` has not been wired
// would otherwise render as a lone "before" photo captioned Öncesi — a picture of a
// derelict bathroom presented as a partner's portfolio, which is worse than showing
// nothing. A sequence, by contrast, keeps whatever steps resolve: it is a story with a
// gap, not a claim inverted.
export function partnerGallery(partner, resolve) {
  const out = []
  for (const project of partner?.gallery || []) {
    if (project.mode === 'pairs') {
      const pairs = (project.pairs || [])
        .map(p => ({ labelKey: p.labelKey, before: resolve(p.before), after: resolve(p.after) }))
        .filter(p => p.before && p.after)
      const extra = (project.extra || []).map(resolve).filter(Boolean)
      if (pairs.length || extra.length) out.push({ ...project, pairs, extra })
    } else if (project.mode === 'sequence') {
      const steps = (project.steps || [])
        .map(st => ({ labelKey: st.labelKey, image: resolve(st.image) }))
        .filter(st => st.image)
      if (steps.length) out.push({ ...project, steps })
    }
    // An unrecognised mode contributes nothing. Silently rendering it as one of the two
    // known shapes would show a partner's photos in an order nobody chose.
  }
  return out
}

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

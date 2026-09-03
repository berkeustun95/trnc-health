// Home hero — the district photo, the Explore place it opens, and the photo's provenance.
//
// ─── WIKIMEDIA COMMONS, WITH AN ATTRIBUTION UI ──────────────────────────────
//
// The first version of this file used bundled ADA-owned images precisely BECAUSE the
// hero had no way to render a credit. That constraint is gone: the hero now carries an
// ℹ︎ chip opening a sheet, built on the same components/PhotoCredit.js that
// ExploreProfileScreen renders, so a licensed third-party photo can be shown correctly.
//
// Sourcing rules these five images were selected under:
//   • Public domain, CC0 or CC BY only. NO share-alike — a CC BY-SA hero would put a
//     copyleft obligation on the surrounding work, which is not a trade to make for
//     decoration. Also no NC and no ND.
//   • Verified to depict the TRNC, not the Republic of Cyprus. Ambiguous means REJECTED,
//     not guessed. This is not hypothetical: a licence-clean search for "Lefke" returns
//     a Greek FERRY named Lefka Ori and a mountain range in Crete, both of which would
//     have sailed through an automated filter.
//   • Verified to depict the PLACE THE HERO OPENS, not merely the district. A photo
//     taken FROM Saint Hilarion looking at the Kyrenia coast is a fine picture and the
//     wrong one: the tap opens a castle the user cannot see in the image.
//
// ─── THE PROVENANCE IS DATA, AND IT IS PART OF THE PHOTO ────────────────────
//
// Each entry carries the credit as fields, not as a pre-formatted string, so the sheet
// renders it through the same code path as every other attributed photo in the app.
//
// ⚠ INCOMPLETE PROVENANCE IS TREATED AS NO PHOTO. A district whose entry has an asset
//   but is missing an author, a licence name, a licence URL or a source page falls back
//   to the generic hero and becomes non-tappable — see resolveHero(). That is the whole
//   point of the rule: the failure mode it prevents is publishing somebody's photograph
//   with the attribution silently missing, which is a licence breach that looks exactly
//   like a working screen. Making it fail CLOSED costs one district's hero; making it
//   fail open costs a licence.
//
// ─── PROVENANCE READ FROM THE COMMONS API, NOT FROM A PAGE ──────────────────
//
// Every field below came from `action=query&prop=imageinfo&iiprop=extmetadata` on
// commons.wikimedia.org on 2026-09-03 — the structured record, not a scrape. Coordinates
// on the file were checked against a TRNC bounding box where present, and the file's
// categories were read where they were not.
//
// ─── TWO DISTRICTS HAVE NO PHOTO, DELIBERATELY ──────────────────────────────
//
//   morphou — no licence-clean photograph of St. Mamas Church could be found.
//   lefke   — the only licence-clean images of its places (Soli, Vouni) are 1920s
//             Swedish Cyprus Expedition excavation photographs. Genuine, correctly
//             licensed, and wrong for a hero next to today's temperature.
//
// They render the generic and are not tappable. That is the designed behaviour, not a
// gap: the alternative was a share-alike image or a guess about what a photo depicts.

import { REGIONS } from './regions'

// Licences accepted here. A licence not on this list fails the completeness check even
// if every other field is present — an unrecognised licence string is exactly the
// ambiguity the sourcing rules say to reject rather than resolve by guessing.
const ALLOWED_LICENCES = new Set([
  'CC0', 'Public domain', 'CC BY 2.0', 'CC BY 3.0', 'CC BY 4.0',
])

export const HOME_HERO = {
  nicosia: {
    placeId: '1100ad4c-a412-4528-b96d-c2543fd23b25',   // Büyük Han (Great Inn)
    asset:   require('../assets/hero/hero-nicosia.jpg'),
    credit: {
      author:     'ToprakM',
      license:    'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0',
      sourceUrl:  'https://commons.wikimedia.org/wiki/File:B%C3%BCy%C3%BCk_Han_(Great_Inn)_at_North_Nicosia.jpg',
      source:     'commons',
    },
  },
  kyrenia: {
    placeId: 'd773e658-95ac-48ba-ae53-5936374a976f',   // St. Hilarion Castle
    asset:   require('../assets/hero/hero-kyrenia.jpg'),
    credit: {
      // CC0 waives the attribution REQUIREMENT. Credited anyway: the sheet exists, the
      // author is known, and dropping a name because the licence does not compel it is
      // a choice nobody would defend out loud.
      author:     'Chris06',
      license:    'CC0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      sourceUrl:  'https://commons.wikimedia.org/wiki/File:Saint_Hilarion_Castle_(01).JPG',
      source:     'commons',
    },
  },
  famagusta: {
    placeId: '28f69a7c-48f1-4a51-b84e-37beda5e29b8',   // Salamis Ancient City
    asset:   require('../assets/hero/hero-famagusta.jpg'),
    credit: {
      author:     'George Groutas',
      license:    'CC BY 2.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
      sourceUrl:  'https://commons.wikimedia.org/wiki/File:Salamis_Ruins,_Cyprus.jpg',
      source:     'commons',
    },
  },
  iskele: {
    placeId: '88def13a-3ee3-4c3b-bb7b-56bf15f27f33',   // Kantara Castle
    asset:   require('../assets/hero/hero-iskele.jpg'),
    credit: {
      author:     'George Groutas',
      license:    'CC BY 2.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
      sourceUrl:  'https://commons.wikimedia.org/wiki/File:Castle_of_Kantara.jpg',
      source:     'commons',
    },
  },
  karpaz: {
    placeId: '95b6d924-e3c0-40e4-a2bd-b55ca1a105ef',   // Golden Beach (Altın Kumsal)
    asset:   require('../assets/hero/hero-karpaz.jpg'),
    credit: {
      // "Golden Beach" is a name a hundred beaches share. This file's own coordinates
      // (35.640, 34.537) sit on the Karpaz peninsula and its category is
      // "Golden Beach, Northern Cyprus" — that pair is what resolved the ambiguity.
      author:     'Александр Чудновский',
      license:    'CC BY 3.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
      sourceUrl:  'https://commons.wikimedia.org/wiki/File:Golden_Beach_-_panoramio_(7).jpg',
      source:     'commons',
    },
  },

  // No licence-clean, unambiguous photograph found. See the note above — these are
  // decided absences, not missing rows.
  morphou: { placeId: '9f14da0c-e9a2-4489-81e2-20973b662942', asset: null, credit: null },
  lefke:   { placeId: '328fad9c-9da7-4273-a638-1682de89da39', asset: null, credit: null },
}

// The fallback image. auth-bg.png is already the Home background and already ships in
// every bundle, so a district with no photo costs zero additional bytes.
export const HERO_GENERIC = require('../assets/auth-bg.png')

const filled = v => typeof v === 'string' && v.trim().length > 0

// Is this credit complete enough to publish the photo it belongs to?
// Exported so a guard script can ask the same question this module asks.
export function creditIsComplete(c) {
  return !!c
    && filled(c.author)
    && filled(c.license)
    && filled(c.licenseUrl)
    && filled(c.sourceUrl)
    && ALLOWED_LICENCES.has(c.license.trim())
}

// Resolve a region slug to everything the hero needs.
//
// An unknown or null slug — a guest with location denied and no profile.region — lands
// on the generic, which is the same state as a district with no photo. One code path.
export function resolveHero(region) {
  const entry = region && HOME_HERO[region]
  // ALL THREE, together: an asset, a place to open, and provenance good enough to
  // display. Any one missing and the district is generic and inert.
  const usable = !!entry?.asset && !!entry?.placeId && creditIsComplete(entry.credit)

  return {
    source:    usable ? entry.asset : HERO_GENERIC,
    isGeneric: !usable,
    placeId:   usable ? entry.placeId : null,
    // Shaped for components/PhotoCredit.js, which expects the same field names
    // resolveAttribution() produces for a place row. One renderer, one shape.
    credit: usable ? {
      credit:     entry.credit.author,
      license:    entry.credit.license,
      licenseUrl: entry.credit.licenseUrl,
      sourceUrl:  entry.credit.sourceUrl,
      source:     entry.credit.source ?? 'commons',
    } : null,
  }
}

// Every canonical region should have an entry, or a district silently loses its hero the
// day somebody adds an eighth slug to regions.js.
//
// ⚠ A WARNING AND NOT A THROW, DELIBERATELY. An earlier draft threw at import time, which
//   would have turned one developer's editing mistake into an app that will not START —
//   and for nothing, because resolveHero() above already degrades a missing or unknown
//   region to the generic hero correctly. __DEV__ puts the message where the mistake is
//   made and nowhere near a user.
if (__DEV__) {
  const missing = REGIONS.filter(r => !HOME_HERO[r])
  if (missing.length) {
    console.warn(`homeHero.js: no entry for region(s) ${missing.join(', ')} — those districts fall back to the generic hero`)
  }
  for (const [r, e] of Object.entries(HOME_HERO)) {
    if (e.asset && !creditIsComplete(e.credit)) {
      console.warn(`homeHero.js: '${r}' has a photo but incomplete/unaccepted provenance — it will render the GENERIC hero rather than publish an unattributed image`)
    }
  }
}

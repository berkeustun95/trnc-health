// Partner image assets — the ONE file in the app that require()s them.
//
// ─── WHY THIS FILE EXISTS SEPARATELY FROM constants/partners.js ─────────────
// partners.js must stay importable by plain Node (a guard checks its uuid against the
// seed migration), and `require()` of a PNG is exactly what breaks that. So partners.js
// carries string KEYS and this file maps key -> asset. A key with no entry here yields
// `undefined`, which every consumer already treats as "no image": the logo falls back to
// a monogram, a gallery project with no images does not render at all.
//
// ─── WHY THE ENTRIES ARE COMMENTED OUT ──────────────────────────────────────
// Metro resolves require() at BUILD time. A require() of a file that is not on disk is a
// bundler error, not a runtime null — so the app would not start, and `npx expo start`
// would fail for everyone, not just for whoever is looking at this screen. The entries
// are therefore written out in full and commented, so wiring them is deleting `// ` and
// nothing else.
//
// ─── THE 18 FILES, EXACT PATHS ──────────────────────────────────────────────
// Two logos, at the names they were specified under:
//   assets/partners/tadilart-logo.png          1600x455, transparent, BLACK mark
//   assets/partners/tadilart-logo-onDark.png   1600x455, transparent, WHITE mark
// Sixteen photos, under a per-partner folder so partner #2 cannot collide:
//   assets/partners/tadilart/bathroom/before_1_wc.jpg
//   assets/partners/tadilart/bathroom/before_2_shower.jpg
//   assets/partners/tadilart/bathroom/before_3_basin.jpg
//   assets/partners/tadilart/bathroom/after_1_wide.jpg
//   assets/partners/tadilart/bathroom/after_2_vanity.jpg
//   assets/partners/tadilart/bathroom/after_3_shower.jpg
//   assets/partners/tadilart/bathroom/after_4_wc.jpg
//   assets/partners/tadilart/bathroom/after_5_basin.jpg
//   assets/partners/tadilart/bathroom/after_6_door.jpg
//   assets/partners/tadilart/bathroom/progress_1.jpg
//   assets/partners/tadilart/extension/01_oncesi.jpg
//   assets/partners/tadilart/extension/02_baslangic.jpg
//   assets/partners/tadilart/extension/03_celik.jpg
//   assets/partners/tadilart/extension/04_insa.jpg
//   assets/partners/tadilart/extension/05_cephe.jpg
//   assets/partners/tadilart/extension/06_sonuc.jpg
//
// If the photos arrive as .png rather than .jpg, change the extension HERE and nowhere
// else — constants/partners.js names keys, never files.
//
// After dropping the files in: uncomment the block below, then `npm run partners:check`.

export const PARTNER_ASSETS = {
  // ─── TadilArt Cyprus ──────────────────────────────────────────────────────
  'tadilart/logo':                 require('../assets/partners/tadilart-logo.png'),
  'tadilart/logo-onDark':          require('../assets/partners/tadilart-logo-onDark.png'),

  'tadilart/bathroom/before_1_wc':     require('../assets/partners/tadilart/bathroom/before_1_wc.jpg'),
  'tadilart/bathroom/before_2_shower': require('../assets/partners/tadilart/bathroom/before_2_shower.jpg'),
  'tadilart/bathroom/before_3_basin':  require('../assets/partners/tadilart/bathroom/before_3_basin.jpg'),
  'tadilart/bathroom/after_1_wide':    require('../assets/partners/tadilart/bathroom/after_1_wide.jpg'),
  'tadilart/bathroom/after_2_vanity':  require('../assets/partners/tadilart/bathroom/after_2_vanity.jpg'),
  'tadilart/bathroom/after_3_shower':  require('../assets/partners/tadilart/bathroom/after_3_shower.jpg'),
  'tadilart/bathroom/after_4_wc':      require('../assets/partners/tadilart/bathroom/after_4_wc.jpg'),
  'tadilart/bathroom/after_5_basin':   require('../assets/partners/tadilart/bathroom/after_5_basin.jpg'),
  'tadilart/bathroom/after_6_door':    require('../assets/partners/tadilart/bathroom/after_6_door.jpg'),
  'tadilart/bathroom/progress_1':      require('../assets/partners/tadilart/bathroom/progress_1.jpg'),

  'tadilart/extension/01_oncesi':      require('../assets/partners/tadilart/extension/01_oncesi.jpg'),
  'tadilart/extension/02_baslangic':   require('../assets/partners/tadilart/extension/02_baslangic.jpg'),
  'tadilart/extension/03_celik':       require('../assets/partners/tadilart/extension/03_celik.jpg'),
  'tadilart/extension/04_insa':        require('../assets/partners/tadilart/extension/04_insa.jpg'),
  'tadilart/extension/05_cephe':       require('../assets/partners/tadilart/extension/05_cephe.jpg'),
  'tadilart/extension/06_sonuc':       require('../assets/partners/tadilart/extension/06_sonuc.jpg'),

  // ─── Alasia Dorm (Yurtlar) ────────────────────────────────────────────────
  // COMMENTED FOR THE SAME REASON TadilArt's ENTRIES ONCE WERE, and it is worth
  // restating because the failure is not a runtime one: Metro resolves require() at BUILD
  // time, so a require() of a file that is not on disk is a bundler error. Uncommenting
  // these before Özok delivers does not render a broken image — it stops `npx expo start`
  // for everyone.
  //
  // Until then the keys resolve to undefined, which PartnerLogoStrip renders as a
  // monogram: a finished state, not a placeholder box. Wiring them is deleting `// `.
  //
  // ⚠ WRITTEN PERMISSION. The logo and photos are Özok's. These were wired on Berke's
  //   instruction; the permission item stays on the owed list until it is in writing.
  //
  // ⚠ THERE IS NO INVERTED LOGO, and the brief expected one. Alasia's site carries three
  //   logo files — logo512.png plus a theme pair — and the theme pair turns out to be
  //   `class="logo desktop"` and `class="logo mobile"`: the SAME wordmark at two sizes,
  //   not light and inverted. All three share a 2.65:1 aspect, which is the giveaway.
  //   So `alasia/logo-onDark` is deliberately absent. PartnerLogoStrip already resolves
  //   the dark variant as `logoOnDark || logo`, so a dark surface falls back to this one
  //   — correct today because every surface it sits on is light, and a real problem the
  //   day one is not. Ask Özok for an inverted file before building a dark surface.
  'alasia/logo':      require('../assets/partners/alasia/logo512.png'),

  // ⚠ ALASIA'S OWN PUBLISHED SMALLER VARIANTS, NOT THE FULL-RESOLUTION ORIGINALS.
  //   The originals are 2560x1710 and 2048-wide: seven of those decode to 103 MB of
  //   ARGB8888, and this repo already caps a pager at five images because 45 x 10 x 3.5 MB
  //   was untenable on a mid-range Android. At the sizes below the same seven decode to
  //   24.4 MB and occupy 1.00 MB on disk.
  //   These are files ALASIA PUBLISHES (WordPress emits -1024x684 and -1536x*), so nothing
  //   was resized, re-encoded or edited here — the smaller file is theirs too.
  'alasia/hero-1':    require('../assets/partners/alasia/hero-1.jpg'),
  'alasia/hero-2':    require('../assets/partners/alasia/hero-2.jpg'),

  // Paired to rooms by the alt text on alasiadorm.com/rooms/, which names each one — not
  // by document order, which would have been a guess. There is NO photo for the Single
  // Bungalow on their site; that row renders without one.
  'alasia/room-blk1': require('../assets/partners/alasia/room-blk1.jpg'),
  'alasia/room-blk2': require('../assets/partners/alasia/room-blk2.jpg'),
  'alasia/room-blk3': require('../assets/partners/alasia/room-blk3.jpg'),
  'alasia/room-bng2': require('../assets/partners/alasia/room-bng2.jpg'),
  'alasia/room-bng4': require('../assets/partners/alasia/room-bng4.jpg'),
}

export const partnerAsset = key => (key ? PARTNER_ASSETS[key] : undefined)

// ─── Light / dark wordmark ──────────────────────────────────────────────────
//
// TadilArt's mark is PURE BLACK on transparency, so on any dark surface it disappears
// entirely — not degraded, gone — and the -onDark file is the white version.
//
// ⚠ `variant: 'dark'` IS CURRENTLY PASSED BY NOTHING. Neither the pinned card nor the
//   partner detail screen has a dark surface: both sit on colors.cardBg (#FFFFFF) over
//   colors.bg. The variant is wired because the asset exists and because the day a dark
//   surface appears is not the day anyone will remember that a logo is pure black. It is
//   dead until then, deliberately, and that is recorded rather than left to be
//   rediscovered.
export function partnerLogo(partner, variant = 'light') {
  if (!partner) return undefined
  const key = variant === 'dark' ? (partner.logoOnDark || partner.logo) : partner.logo
  return partnerAsset(key)
}

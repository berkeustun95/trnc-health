---
name: ada-style
description: ADA's locked visual direction and exact design tokens (Mix v2 Home, light mode, tiles, floating pill tab bar, photo-backed module screens, partner-screen rule, no navy). Load before designing, auditing or changing any ADA screen, component or style.
---

# ADA style: locked decisions

These are Berke's decisions. They are not up for redesign; audit AGAINST them. Where any other skill
(frontend-design included) disagrees, this file wins. Every value below is read from the code. If the
code and this file ever disagree, the code is the authority: re-read it and fix this file in the same PR.

## Sources of truth
- `constants/theme.js`: `colors`, `category`, `font`, `type`, `radii`, `space`, `elevation`, `motion`,
  `press`, `TAP`, `listBottomPad`, plus `contrastRatio` / `readableOn` / `brandInk` / `withAlpha`.
- `components/ui/`: the shared kit (Card, ListCard, ListRow, ScreenHeader, ModuleScreen, SectionHeader,
  EmptyState, ErrorState, Skeleton, Button, IconButton, BottomSheet, FloatingTabBar, CategoryIcon, haptics).
- Home: `screens/HomeScreen.js` (redesign branch of it), `components/home/redesign/`.
- Never invent a value. A value that is not a token needs its own reason in a comment, like the existing
  ones in theme.js. Legacy tokens (`colors.bg`, `spacing`, `radius`, `shadow`, `fontSize`) are for
  unmigrated screens only; new work uses the redesign roles (`canvas`, `card`, `type`, `radii`, `space`, `elevation`).

## 1. Light mode only
`app.config.js` sets `userInterfaceStyle: 'light'`. No dark variants, no `useColorScheme` branches.

## 2. Mix v2 Home (HOME_V2_LIVE + REDESIGN_LIVE, both true)
- Page ground: `colors.canvas` `#F4F6F5`. White cards (`colors.card`) separate from it by
  `elevation.card` only (the two are 1.09:1). Never add a second background surface.
- Hero photo band on top (`RedesignHero`), then widgets, favourites, then the four service panels.
- Ink: `colors.textPrimary` `#1A2B33`, secondary `colors.textSecondary` `#55657A`, tile labels `colors.tileInk` `#3F4E57`.

## 3. Home tiles: soft-tinted, labels Medium
- Icon well: `CategoryIcon`, 52×52, radius `radii.tile` (16), background = the category's soft tint,
  icon = its ink, icon size `round(size × 0.46)`.
- Category tints (`category` in theme.js), bg / ink:
  health `#FBEAEC` / `#B83246` · explore `#F1EAFB` / `#6B3FB0` · homeLife `#FBF0E0` / `#92560C` · city `#E7EEFB` / `#2F55B5`.
- Tile label: 11pt, `Inter_500Medium` (Medium, not SemiBold), `colors.tileInk`, centred, fixed
  two-line box `GRID_LABEL_HEIGHT` (`constants/homeModules.js`) so rows keep one rhythm in all 9 languages.
- Panels: white, `radii.card` (20), `paddingVertical: 12`; panel title `type.rowTitle`, 8pt category dot.
- "Yakında" badge: `colors.tileInk` pill, 9.5pt `Inter_600SemiBold`, white.
- Guards: `npm run home:check`, `npm run labels:check` (fontScale 1.3).

## 4. Floating pill tab bar (`components/ui/FloatingTabBar.js`)
- White (`colors.card`), `radii.pill`, `elevation.tabBar`, height 64 (`TAB_BAR_H`), inset 24 each side,
  12 above the bottom inset. Active tab: `colors.primaryLight` pill, label `type.small` SemiBold in
  `colors.primaryDark`; inactive icon `colors.textSecondary`.
- A canvas fade sits under it. Content scrolling under it pads with `useTabBarFootprint()` / `TabBarPad`.
- It is drawn on Home's tabs only, not on module screens.

## 5. Module screens: full-screen photo behind see-through cards (`components/ui/ModuleScreen.js`)
- The module's photo fills the screen under a black tint `MODULE_TINT` 0.25; a header band under the
  status bar at `HEADER_SCRIM` 0.5.
- Cards on the photo are white at `CARD_ALPHA` 0.93 (`CARD_BG`), radius `radii.card` (20). `Card` and
  `ListCard` do this automatically through `useOnPhoto()`; never hand-roll it.
- Text straight on the photo is white and must sit on the header scrim or a dark pill (`PILL_ALPHA` 0.55,
  `OnPhotoLabel`, `SectionHeader`). `npm run hero:check` bounds all of these over a pure white pixel.

## 6. No navy anywhere
- No navy surface, header, bar, button, chip, sheet or gradient in ADA's own frame. Brand colour is the
  teal `colors.primary` `#0E7C7B` / `primaryDark` `#0A5E5D`, accent `#FF8552`.
- `textPrimary` `#1A2B33` is ink, not a surface: allowed as text, never as a fill for large areas.
- Known: `ModuleScreen` root `#22313A` (dark slate shown only before the photo paints) and
  `category.city` ink `#2F55B5`. Flag them in an audit; do not change them without Berke's call.
- Partner brand colours (e.g. KKTCELL navy, kept via `brandInk`) are partner content, see §7.

## 7. Partner screens: restyle ADA's frame only
ADA may restyle its own frame around a partner: header, back button, spacing, page ground, fonts of
ADA-owned text. ADA NEVER changes partner content: logos, brand colours, photos, copy, the order of items
or partners, or partner buttons (labels, colours, targets). Partner surfaces include
`constants/partners.js` (order), `constants/partnerAssets.js` (logos), `constants/partnerPreview.js`,
`constants/petPartners.js`, `constants/dorms.js`, `HomeServicePartnerCard.js`, `HomeServicePartnerScreen.js`,
`screens/Connectivity*Screen.js` (KKTCELL etc.), `DormPartnerScreen.js` and pet-hotel partner cards (`screens/pets/`).
Anything that changes how a partner LOOKS (even a frame change that crops, recolours or reorders their
content) → stop and flag it for Berke's approval. A paid placement must still read as distinct from ADA's
editorial guidance.

## Type, radii, spacing, elevation, motion (theme.js)
- Fonts: Inter only (`font.regular/medium/semibold/bold`); `check-font-family.mjs` guards it.
- `type`: caption 11/14 M · meta 12/16 M · small 13/18 R · body 14/20 R · rowTitle 15/20 SB ·
  sheetTitle 17/22 B · sectionHeading 18/24 B · detailTitle 24/30 B · heroHeadline 26/32 B ·
  pageTitle 28/34 B · display 30/36 B.
- `radii`: xs 6 · sm 10 · md 12 · tile 16 · card 20 · widget 24 · sheet 28 · pill 999.
- `space`: 4 · 8 · 12 · 16 · 20 · 24. Screen gutter 16 or 20, matching the sibling screen.
- `elevation`: card (y3 blur12 .07) · floating (y8 blur24 .12) · tabBar (y10 blur30 .16). Never a
  border AND a shadow on the same card.
- `motion`: fast 180 · base 250 · sheetIn 280 · sheetOut 220 · spring {bounciness 4, speed 12}.
- `press`: opacity 0.7 small controls, 0.85 cards. `TAP` = 44 (minimum touch target).
- Text on tint: `primaryDark` on `primaryLight` (6.71:1), never `primary` (4.44). Red text = `dangerInk`.
  Input borders = `fieldBorder`. Check any new pair with `contrastRatio`.
- Single-line labels that hug their width spread `ellipsizeSlack`.

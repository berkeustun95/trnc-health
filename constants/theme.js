export const colors = {
  primary:       '#0E7C7B',
  primaryLight:  '#E6F4F4',
  // Deeper teal for TEXT sitting on primaryLight. `primary` on `primaryLight` is only
  // 4.44:1 — it scrapes AA for body text and reads washed out when the tinted bar sits
  // over a PageBackground photo. This is 6.71:1 on the same tint.
  primaryDark:   '#0A5E5D',
  accent:        '#FF8552',
  accentLight:   '#FFF0EB',
  bg:            '#F7F8FA',
  // Home V2's page canvas, below the hero band. A WARM cream against the app's otherwise
  // cool greys, so the photo band reads as a distinct object sitting ON a page rather
  // than as the page itself.
  //
  // WHY A NEW TOKEN AND NOT `sand`. sand (#EFEBE2) is the obvious candidate and is the
  // wrong one: it is documented below as the towing coverage map's "uncovered region"
  // fill and is MIRRORED in scripts/generate-towing-map.mjs, so a third consumer with
  // different needs would mean a change made for Home silently shifts a generated map
  // legend. Same hue family, deliberately — this is sand's much lighter sibling — but its
  // own token with its own reason to change.
  //
  // ONE canvas colour, not two: cards on top of it are `cardBg` (#FFFFFF) as everywhere
  // else in the app. Do not add a second background surface.
  //
  // RETUNED 2026-09-03 (polish round 2): was #FAF6EF, which measured 11 points of
  // R-minus-B warmth and read yellow and heavy against white cards rather than as a
  // near-white ground. This is 2 points warm and a luminance of 0.955 against 0.925 —
  // lighter and much closer to neutral, while still not the cool blue-grey of `bg`.
  bgWarm:        '#FAFAF8',
  cardBg:        '#FFFFFF',
  surface:       '#FFFFFF',
  border:        '#E8EDF2',
  textPrimary:   '#1A2B33',
  textSecondary: '#64748B',
  success:       '#2E9E5B',
  successLight:  '#E6F5ED',
  danger:        '#D1495B',
  dangerLight:   '#FAEAEC',

  // Home icon tints, one pair per module category. Urgent and service alias the
  // existing palette; tintLifestyleFg is a deepened accent because accent itself
  // only hits 2.17 contrast on accentLight and is unreadable at icon size.
  tintUrgentBg:    '#FAEAEC',
  tintUrgentFg:    '#D1495B',
  tintServiceBg:   '#E6F4F4',
  tintServiceFg:   '#0E7C7B',
  tintLifestyleBg: '#FFF0EB',
  tintLifestyleFg: '#C2410C',

  // Warm neutral from the Çekici module's design. ADA's palette is otherwise cool
  // (bg/border are blue-greys), so this is the ONE warm token — it exists because the
  // coverage map needs an "uncovered region" fill that reads as land rather than as a
  // disabled UI surface, and because the logo tile needs a backdrop that flatters mixed
  // firm logos. Mirrored in scripts/generate-towing-map.mjs as SAND; if you change one,
  // change both or the legend swatch stops matching the map.
  sand:            '#EFEBE2',
}

export const typeColors = {
  pharmacy: { bg: '#F3E8FF', text: '#7C3AED' },
  clinic:   { bg: '#E6F4F4', text: '#0E7C7B' },
  hospital: { bg: '#FAEAEC', text: '#D1495B' },
  dentist:  { bg: '#E6F5ED', text: '#2E9E5B' },
  vet:      { bg: '#FEF3C7', text: '#D97706' },
  grooming: { bg: '#FCE7F3', text: '#BE185D' },
}

export const placeColors = {
  beach:    { bg: '#E0F2FE', text: '#0369A1' },
  landmark: { bg: '#FEF9C3', text: '#A16207' },
}

export const gameColors = {
  // 2048 tile ramp — a cohesive designed gradient, kept whole as literals.
  tile2048: {
    2:    { bg: '#E6F4F4', text: colors.textPrimary },
    4:    { bg: '#CDEAEA', text: colors.textPrimary },
    8:    { bg: '#FFF0EB', text: '#C2410C' },
    16:   { bg: '#FFD9C7', text: '#C2410C' },
    32:   { bg: '#FF8552', text: '#FFFFFF' },
    64:   { bg: '#F97316', text: '#FFFFFF' },
    128:  { bg: '#FBBF24', text: '#FFFFFF' },
    256:  { bg: '#F59E0B', text: '#FFFFFF' },
    512:  { bg: '#2E9E5B', text: '#FFFFFF' },
    1024: { bg: '#0E7C7B', text: '#FFFFFF' },
    2048: { bg: '#7C3AED', text: '#FFFFFF' },
    high: { bg: '#1A2B33', text: '#FFFFFF' },   // >= 4096
  },

  // Sudoku selection/peer highlights — no token equivalents.
  sudoku: {
    selected:  '#BFE3E3',
    sameValue: '#DCF0F0',
    peer:      '#F1F7F7',
  },

  // Memory face tints — all 9 are exact matches to existing tokens.
  memoryTints: [
    colors.primary, colors.accent, colors.success, colors.danger,
    typeColors.pharmacy.text, typeColors.vet.text, typeColors.grooming.text,
    placeColors.beach.text, placeColors.landmark.text,
  ],
}

export const shadow = {
  shadowColor:   '#1A2B33',
  shadowOpacity: 0.07,
  shadowRadius:  12,
  shadowOffset:  { width: 0, height: 3 },
  elevation:     3,
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 40,
}

export const fontSize = {
  sm: 13,
  md: 16,
  lg: 20,
  xl: 26,
}

export const radius = {
  sm:   8,
  md:   12,
  card: 16,
  lg:   20,
  xl:   28,
}

// ─── Readable foreground on an arbitrary colour ─────────────────────────────
//
// WHY THIS EXISTS. A partner supplies their own brand hex and it is drawn as a filled
// surface with text on it — the dorm showcase's deal band is the first. Hardcoding white
// works right up until the brand is light, and then the text is simply gone: white on a
// brand yellow measures 1.43:1 against the 4.5:1 body text needs. The ADA teal fallback
// had hidden that since the band was written, because the band had never once rendered
// against a real accent.
//
// This is the same problem the `tintLifestyleFg` note above records — accent is unreadable
// at icon size on accentLight — solved once as a function instead of once per surface by
// hand. It is deliberately NOT partner-specific: any future partner's colour goes through
// the same call and needs no further work.
//
// No react-native import: constants/theme.js is plain data and a Node-side guard imports
// these to assert every configured accent produces a readable foreground.

const srgb = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))

// WCAG relative luminance. Accepts #rgb or #rrggbb; returns null for anything else rather
// than guessing, so a malformed hex fails loudly at the guard instead of silently
// resolving to black and looking like a design decision.
export function luminance(hex) {
  let h = String(hex || '').trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  const [r, g, b] = [0, 2, 4].map(i => srgb(parseInt(h.slice(i, i + 2), 16) / 255))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// WCAG contrast ratio, 1..21. null if either colour is unreadable as a hex.
export function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b)
  if (la == null || lb == null) return null
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

// The better of white and ink for text sitting ON `bg`. Returns whichever scores higher —
// it does NOT promise 4.5:1, because for some mid-tone colours neither reaches it and this
// function cannot invent a third option. `scripts/check-dorms.mjs` asserts that every
// accent actually CONFIGURED clears 4.5:1, which is the check that has teeth; this just
// picks the best available.
//
// Falls back to white on an unparseable hex — the same thing the old hardcoded behaviour
// did, so a bad value degrades to the previous state rather than to black-on-black.
export function readableOn(bg, { light = '#FFFFFF', dark = colors.textPrimary } = {}) {
  const cl = contrastRatio(light, bg)
  const cd = contrastRatio(dark, bg)
  if (cl == null || cd == null) return light
  return cl >= cd ? light : dark
}

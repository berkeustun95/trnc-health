export const colors = {
  primary:       '#0E7C7B',
  primaryLight:  '#E6F4F4',
  accent:        '#FF8552',
  accentLight:   '#FFF0EB',
  bg:            '#F7F8FA',
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

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
}

export const placeColors = {
  beach:    { bg: '#E0F2FE', text: '#0369A1' },
  landmark: { bg: '#FEF9C3', text: '#A16207' },
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

// Phone country codes for the profile fields. Extracted from ProfileScreen 2026-08-30
// so the profile-completion wizard and ProfileScreen share ONE list — two copies of a
// dial-code table drift the first time somebody adds a country to only one of them.
//
// Order is deliberate and NOT alphabetical: the countries ADA's users actually come
// from sit at the top. Do not "tidy" it into alphabetical order.
//
// ⚠ There is no default. The wizard starts with NO code selected, because assuming +90
//   for every user of an app whose whole purpose is helping newcomers is exactly the
//   wrong default.
export const COUNTRY_CODES = [
  { code: '+90',  label: 'Turkey' },
  { code: '+357', label: 'Cyprus' },
  { code: '+44',  label: 'United Kingdom' },
  { code: '+1',   label: 'USA / Canada' },
  { code: '+49',  label: 'Germany' },
  { code: '+33',  label: 'France' },
  { code: '+31',  label: 'Netherlands' },
  { code: '+46',  label: 'Sweden' },
  { code: '+39',  label: 'Italy' },
  { code: '+34',  label: 'Spain' },
  { code: '+30',  label: 'Greece' },
  { code: '+7',   label: 'Russia' },
  { code: '+98',  label: 'Iran' },
  { code: '+966', label: 'Saudi Arabia' },
  { code: '+971', label: 'UAE' },
  { code: '+962', label: 'Jordan' },
  { code: '+970', label: 'Palestine' },
  { code: '+964', label: 'Iraq' },
  { code: '+963', label: 'Syria' },
  { code: '+961', label: 'Lebanon' },
  { code: '+20',  label: 'Egypt' },
  { code: '+91',  label: 'India' },
  { code: '+86',  label: 'China' },
  { code: '+82',  label: 'South Korea' },
  { code: '+81',  label: 'Japan' },
  { code: '+61',  label: 'Australia' },
]

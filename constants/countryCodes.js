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
import { COUNTRY_NAMES } from './countryNames.js'

export const COUNTRY_CODES = [
  { code: '+90',  region: 'TR', label: 'Turkey' },
  { code: '+357', region: 'CY', label: 'Cyprus' },
  { code: '+44',  region: 'GB', label: 'United Kingdom' },
  { code: '+1',   region: ['US', 'CA'], label: 'USA / Canada' },
  { code: '+49',  region: 'DE', label: 'Germany' },
  { code: '+33',  region: 'FR', label: 'France' },
  { code: '+31',  region: 'NL', label: 'Netherlands' },
  { code: '+46',  region: 'SE', label: 'Sweden' },
  { code: '+39',  region: 'IT', label: 'Italy' },
  { code: '+34',  region: 'ES', label: 'Spain' },
  { code: '+30',  region: 'GR', label: 'Greece' },
  { code: '+7',   region: 'RU', label: 'Russia' },
  { code: '+98',  region: 'IR', label: 'Iran' },
  { code: '+966', region: 'SA', label: 'Saudi Arabia' },
  { code: '+971', region: 'AE', label: 'UAE' },
  { code: '+962', region: 'JO', label: 'Jordan' },
  { code: '+970', region: 'PS', label: 'Palestine' },
  { code: '+964', region: 'IQ', label: 'Iraq' },
  { code: '+963', region: 'SY', label: 'Syria' },
  { code: '+961', region: 'LB', label: 'Lebanon' },
  { code: '+20',  region: 'EG', label: 'Egypt' },
  { code: '+91',  region: 'IN', label: 'India' },
  { code: '+86',  region: 'CN', label: 'China' },
  { code: '+82',  region: 'KR', label: 'South Korea' },
  { code: '+81',  region: 'JP', label: 'Japan' },
  { code: '+61',  region: 'AU', label: 'Australia' },
]

// Picker options in the app language: '<code>  <name>'. Only the label is translated (names from the generated static table,
// scripts/gen-country-names.mjs; no Intl at runtime). English and any language without a table keep the English label.
export function countryCodeOptions(lang) {
  const names = COUNTRY_NAMES[lang]
  return COUNTRY_CODES.map(c => {
    const name = names ? [].concat(c.region).map(r => names[r]).join(' / ') : c.label
    return { value: c.code, label: `${c.code}  ${name}` }
  })
}

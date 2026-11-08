// The Kısayollar widget's four targets (Berke 2026-11-08: live sections only, no Coming Soon).
// Icon + tone = the Home V2 grid tile (constants/homeGroups.js / homeModules.js, CategoryIcon);
// tones are theme.js `category`: duty → health, Keşfet + Yeme & İçme → explore, Emlak → homeLife.
// targets/widgets/Shortcuts.swift carries the same four with SF Symbols — keep them in step.
import strings from './strings.json'

export const SHORTCUTS = [
  { key: 'duty',   url: 'ada://duty',   labelKey: 'scDuty',   ionicon: 'medkit-outline',     bg: '#FBEAEC', ink: '#B83246' },
  { key: 'kesfet', url: 'ada://kesfet', labelKey: 'scKesfet', ionicon: 'compass-outline',    bg: '#F1EAFB', ink: '#6B3FB0' },
  { key: 'eatery', url: 'ada://eatery', labelKey: 'scEatery', ionicon: 'restaurant-outline', bg: '#F1EAFB', ink: '#6B3FB0' },
  { key: 'emlak',  url: 'ada://emlak',  labelKey: 'scEmlak',  ionicon: 'home-outline',       bg: '#FBF0E0', ink: '#92560C' },
]

// App language name ('Turkish') or code ('tr') → a code strings.json has; English otherwise.
export function widgetText(code, key) {
  return (strings[code] ?? strings.en)[key] ?? strings.en[key]
}

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'

// Renders a HS_CATEGORIES entry's icon in whichever family it names.
//
// It exists for ONE glyph — `bathtub-outline`, because Ionicons has no bathroom icon (see
// constants/homeServices.js). A ternary at each call site would have been shorter, but
// there are four call sites and the whole point of that constants file is that this
// module stopped having four copies of anything.
const FAMILIES = { ion: Ionicons, mci: MaterialCommunityIcons }

export default function HomeServiceIcon({ category, size, color, style }) {
  if (!category?.icon) return null
  const Glyph = FAMILIES[category.family] || Ionicons
  return <Glyph name={category.icon} size={size} color={color} style={style} />
}

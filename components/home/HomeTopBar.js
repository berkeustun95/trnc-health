import { View, Image, TextInput, TouchableOpacity, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather, Ionicons } from '@expo/vector-icons'
import { colors } from '../../constants/theme'
import { t } from '../../constants/i18n'

// The app bar. Two forms, one component.
//
//   onHero (default)  — rendered INSIDE the hero photograph: ADA wordmark centred on a
//                       white chip, three white circular buttons top-right.
//   searchOpen        — the expanded search field, rendered on the page canvas with the
//                       hero unmounted, because at that point the results ARE the screen.
//
// ─── SEARCH EXPANDS IN PLACE ────────────────────────────────────────────────
// There is no full-screen search surface in this app — V1's global search is an inline
// bar inside the hub with its results rendered underneath it, and components/SearchModal
// is a form picker for the profile wizard, unrelated. The icon takes over the bar, the
// field takes the full width, and the SAME results list renders below. Behaviour is
// byte-identical to V1's; only the entry point moved.
//
// ─── EVERY TOP ELEMENT CARRIES ITS OWN CONTRAST ─────────────────────────────
// White circles with dark glyphs, and the wordmark on a white chip — not white marks on
// a scrim. That is a measurement, not a preference: two of the five hero photographs
// (Salamis, Kantara) have blown-out sky across the whole top edge, brightest-5%
// luminance 0.996 and 1.000. Making a white mark legible on that needs a black scrim at
// alpha 0.82, which blacks the photograph out. A white pill on any of the five is
// self-sufficient. See the scrim note in HomeHero.js.
//
// ⚠ THE LOGO IS A DARK ASSET. logonobg.png is 81% dark pixels (median luminance 0.081)
//   and contrasts at 1.19:1 against a dark scrim — it is INVISIBLE tinted onto a
//   darkened photo, and tinting it white loses nothing (its internal detail is knockout,
//   so the alpha channel carries the mark) but still fails over bright sky. The white
//   chip is what makes it work on all five, and it keeps the brand colours.
//
// ─── THE searchRef GOES ON THE ICON, AND THAT IS LOAD-BEARING ───────────────
// App.js measures searchRef at tutorial time (measureRef → coachSteps) and a ref that
// measures null SILENTLY DROPS that step — no error, one fewer coach mark, nobody
// notices for a release. It sits on the icon's WRAPPER, which survives the
// collapsed→expanded swap, rather than on the icon itself.
export default function HomeTopBar({
  lang,
  hideActions = false,   // profile gate: no bell, no drawer, no search — see HomeScreen
  hasUnread,
  searchOpen,
  query,
  onQueryChange,
  onOpenSearch,
  onCloseSearch,
  onShowNotifs,
  onOpenMenu,
  searchRef,
  hamburgerRef,
}) {
  const insets = useSafeAreaInsets()

  if (searchOpen) {
    return (
      <View style={[s.searchBar, { paddingTop: insets.top + 8 }]}>
        <View style={s.field}>
          <Feather name="search" size={16} color={colors.textSecondary} />
          <TextInput
            style={s.input}
            value={query}
            onChangeText={onQueryChange}
            placeholder={t('hubSearchPlaceholder', lang)}
            placeholderTextColor={colors.textSecondary}
            returnKeyType="search"
            autoFocus
            clearButtonMode="while-editing"
          />
        </View>
        <TouchableOpacity
          style={s.canvasAction}
          onPress={onCloseSearch}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t('back', lang)}
        >
          <Feather name="x" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>
    )
  }

  // On the hero. Absolutely positioned so it floats over the photograph without taking
  // part in the hero's own bottom-aligned content layout.
  return (
    <View style={[s.heroBar, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
      <View style={s.logoChip} pointerEvents="none">
        <Image source={require('../../assets/logonobg.png')} style={s.logo} resizeMode="contain" />
      </View>

      {!hideActions && (
        <View style={s.actions}>
          <View ref={searchRef} collapsable={false}>
            <TouchableOpacity
              style={s.heroAction}
              onPress={onOpenSearch}
              accessibilityRole="button"
              accessibilityLabel={t('homeSearchA11y', lang)}
            >
              <Feather name="search" size={18} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={s.heroAction} onPress={onShowNotifs} accessibilityRole="button">
            <Ionicons name="notifications-outline" size={18} color={colors.textPrimary} />
            {hasUnread && <View style={s.dot} />}
          </TouchableOpacity>

          <TouchableOpacity ref={hamburgerRef} style={s.heroAction} onPress={onOpenMenu} accessibilityRole="button">
            <Feather name="menu" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  // Absolute, so the hero's content can stay bottom-aligned without this pushing it.
  // pointerEvents box-none on the container: the empty space between the chip and the
  // buttons must fall THROUGH to the hero, or the top half of the photo stops being a
  // tappable deep-link.
  heroBar:     { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16,
                 flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  logoChip:    { backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 14,
                 paddingHorizontal: 12, paddingVertical: 6 },
  logo:        { width: 96, height: 34 },
  actions:     { flexDirection: 'row', gap: 8 },
  // White circles with dark glyphs — legible on any photograph without help from a scrim.
  heroAction:  { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.94)',
                 justifyContent: 'center', alignItems: 'center' },
  dot:         { position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4,
                 backgroundColor: colors.danger, borderWidth: 1.5, borderColor: '#fff' },

  // The search form, on the page canvas rather than on a photo.
  searchBar:   { flexDirection: 'row', alignItems: 'center', gap: 8,
                 paddingHorizontal: 16, paddingBottom: 10 },
  canvasAction:{ width: 38, height: 38, borderRadius: 12, backgroundColor: colors.cardBg,
                 justifyContent: 'center', alignItems: 'center' },
  field:       { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 38,
                 borderRadius: 12, backgroundColor: colors.cardBg, paddingHorizontal: 12,
                 borderWidth: 1, borderColor: colors.border },
  input:       { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, padding: 0 },
})

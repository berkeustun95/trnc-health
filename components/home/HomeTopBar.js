import { View, Image, TextInput, TouchableOpacity, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Feather, Ionicons } from '@expo/vector-icons'
import { colors } from '../../constants/theme'
import { t } from '../../constants/i18n'

const LOGO = require('../../assets/logonobg.png')

// Eight offsets at radius R, forming a continuous ring. Four would leave the diagonals
// thin at the corners of every stroke, which is where a mark like this is busiest.
const R = 2
const HALO = [
  [-R, -R], [0, -R], [R, -R],
  [-R,  0],          [R,  0],
  [-R,  R], [0,  R], [R,  R],
]

// The app bar. Two forms, one component.
//
//   onHero (default)  — rendered INSIDE the hero photograph: ADA wordmark centred and
//                       haloed, three white circular buttons top-right.
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
// White circles with dark glyphs, and a haloed wordmark — not bare marks on a scrim.
// That is a measurement, not a preference: two of the five hero photographs (Salamis,
// Kantara) have blown-out sky across the whole top edge, brightest-5% luminance 0.996
// and 1.000, and no tolerable scrim makes a white mark legible on that. See HomeHero.js.
//
// ⚠ THE WORDMARK IS A DARK ASSET AND BARE IT FAILS ON EVERY PHOTO. Measured per-pixel,
//   compositing the real logo at render size onto each background and scoring each of
//   its ink pixels against what sits behind it: the share of the mark falling under the
//   3:1 UI floor is 86.2% on Büyük Han, 83.0% on St. Hilarion, 62.6% on Salamis, 60.8%
//   on Golden Beach, 49.9% on Kantara and 31.6% on the generic fallback. The intuition
//   that a dark mark would do well against bright sky is right about the sky and wrong
//   about the photograph — the logo's footprint also covers a dome, a castle wall and a
//   headland, and it vanishes into those.
//
//   No light logo variant exists to use instead. assets/adalogo.png is the same mark on
//   an OPAQUE white background (worse over a photo) and android-icon-monochrome.png is a
//   solid black silhouette mask for Android themed icons.
//
//   So it gets the halo — the same idea as components/BackButton.js's HALO_LIGHT, which
//   is a zero-offset inverse-coloured glow. textShadow only applies to Text, so for an
//   Image the equivalent is a ring of white-tinted copies of the same asset behind the
//   real one. tintColor replaces every non-transparent pixel while preserving alpha, so
//   each copy is a white silhouette of the mark; eight of them at a small radius make a
//   continuous outline. No background plate, no chip.
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
  //
  // The wordmark is CENTRED on the hero, not laid out beside the buttons: it is a focal
  // element in the draft, and a flex row would push it off-centre by exactly the width
  // of the action cluster. Its own absolute layer, with pointerEvents none so it never
  // eats a tap meant for the hero's deep-link.
  return (
    <View style={[s.heroBar, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
      <View style={[s.logoWrap, { top: insets.top + 6 }]} pointerEvents="none">
        {HALO.map(([dx, dy]) => (
          <Image
            key={`${dx},${dy}`}
            source={LOGO}
            style={[s.logo, s.logoHalo, { transform: [{ translateX: dx }, { translateY: dy }] }]}
            resizeMode="contain"
          />
        ))}
        <Image source={LOGO} style={s.logo} resizeMode="contain" />
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
  // ─── flex-end, NOT space-between ──────────────────────────────────────────
  // This said `space-between`, which was correct while the logo was a FLEX CHILD sitting
  // at the start of the row. Round 3 made the logo absolutely positioned so it could be
  // centred on the screen rather than on the space the buttons leave — and that took it
  // out of the flex flow, leaving this row with exactly ONE in-flow child.
  //
  // `space-between` distributes free space BETWEEN items. With one item there is no
  // between, so it resolves to flex-start and the button cluster jumped to the left.
  //
  // ⚠ IT WAS NOT AN RTL BUG, AND IT RENDERED LEFT IN ENGLISH TOO. It surfaced in a
  //   Turkish device pass, which makes "the Arabic mirror leaked" the obvious first
  //   hypothesis and the wrong one — this app contains no RTL handling at all
  //   (`I18nManager` is referenced nowhere), so nothing locale-dependent could have
  //   moved it. When a layout looks mirrored, check the flex arithmetic before the
  //   locale: a container whose children changed from two to one is the cheaper
  //   explanation and was the true one.
  //
  // flex-end is also the direction-correct choice for the day RTL is added: under
  // `direction: rtl` Yoga reverses the row's main axis, so flex-end resolves to the
  // visual LEFT on its own. A hardcoded `justifyContent: 'flex-start'` plus a manual
  // flip would not.
  heroBar:     { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16,
                 flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'flex-end' },
  // Absolute and full-width so the wordmark's centre is the SCREEN's centre, not the
  // centre of whatever space the action cluster leaves. `top` is set inline from the
  // safe-area inset — absoluteFillObject would ignore the bar's own paddingTop and put
  // the logo under the status bar.
  logoWrap:    { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  // Substantially larger than the 96x34 chip version — a focal element, per the draft.
  logo:        { width: 168, height: 60 },
  logoHalo:    { position: 'absolute', top: 0, tintColor: 'rgba(255,255,255,0.92)' },
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

import { View, Text, Image, TextInput, TouchableOpacity, StyleSheet } from 'react-native'
import { Feather, Ionicons } from '@expo/vector-icons'
import { colors } from '../../constants/theme'
import { t } from '../../constants/i18n'

// ADA logo left; search, bell, hamburger right.
//
// ─── SEARCH EXPANDS IN PLACE ────────────────────────────────────────────────
// There is no full-screen search surface in this app — V1's global search is an inline
// bar inside the hub with its results rendered underneath it, and components/SearchModal
// is a form picker for the profile wizard, unrelated. Rather than invent a new surface
// inside a layout slice, the icon takes over this row: logo and actions step aside, the
// field takes the full width, and the SAME results list renders below. The search
// behaviour is byte-identical to V1's; only its entry point changed.
//
// ─── THE searchRef GOES ON THE ICON, AND THAT IS LOAD-BEARING ───────────────
// App.js measures searchRef at tutorial time (measureRef → coachSteps) and a ref that
// measures null SILENTLY DROPS that step — no error, one fewer coach mark, nobody
// notices for a release. V1 attached it to the search bar; here the equivalent target is
// the icon, so it must be attached to something that is always mounted. It is on the
// icon's wrapper rather than on the icon itself for exactly that reason: the wrapper
// survives the collapsed→expanded swap.
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
  // Logo only. Deliberately still renders the BAR, so the layout below it does not shift
  // between the gated and ungated states.
  if (hideActions) {
    return (
      <View style={s.bar}>
        <Image source={require('../../assets/logonobg.png')} style={s.logo} resizeMode="contain" />
      </View>
    )
  }

  if (searchOpen) {
    return (
      <View style={s.bar}>
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
          style={s.action}
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

  return (
    <View style={s.bar}>
      <Image source={require('../../assets/logonobg.png')} style={s.logo} resizeMode="contain" />
      <View style={{ flex: 1 }} />

      <View ref={searchRef} collapsable={false}>
        <TouchableOpacity
          style={s.action}
          onPress={onOpenSearch}
          accessibilityRole="button"
          accessibilityLabel={t('homeSearchA11y', lang)}
        >
          <Feather name="search" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={s.action} onPress={onShowNotifs} accessibilityRole="button">
        <Ionicons name="notifications-outline" size={18} color={colors.textPrimary} />
        {hasUnread && <View style={s.dot} />}
      </TouchableOpacity>

      <TouchableOpacity ref={hamburgerRef} style={s.action} onPress={onOpenMenu} accessibilityRole="button">
        <Feather name="menu" size={20} color={colors.textPrimary} />
      </TouchableOpacity>
    </View>
  )
}

const s = StyleSheet.create({
  // Height is fixed so the collapsed and expanded states are the same size — an
  // expanding search that also changes the bar's height shoves the hero down as the
  // keyboard comes up.
  bar:    { flexDirection: 'row', alignItems: 'center', height: 46, gap: 6, marginBottom: 12 },
  logo:   { width: 92, height: 40 },
  action: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.cardBg, justifyContent: 'center', alignItems: 'center' },
  dot:    { position: 'absolute', top: 7, right: 7, width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.danger, borderWidth: 1.5, borderColor: colors.cardBg },
  field:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 38, borderRadius: 12, backgroundColor: colors.cardBg, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border },
  input:  { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, padding: 0 },
})

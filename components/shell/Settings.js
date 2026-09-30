import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, type, radii, elevation } from '../../constants/theme'
import { t } from '../../constants/i18n'
import { ListRow, Button, CategoryIcon, useTabBarFootprint } from '../ui'

// ─── Profil: the ONE settings place (redesign Slice 2) ──────────────────────
// The drawer is gone; everything it held lives here, in four groups. Every row calls an
// App.js handler, so a setting behaves the same wherever else it might be reached.
// `a` = actions: { onLanguage, onCityWelcome, onNotifications, onContact, onRate, onShare,
//                  onTutorial, onLegal, onAbout, onSignOut, onDeleteAccount? }
function Group({ title, children }) {
  return (
    <View style={s.group}>
      <Text style={s.groupTitle} accessibilityRole="header">{title}</Text>
      <View style={[s.card, elevation.card]}>{children}</View>
    </View>
  )
}

export function SettingsGroups({ lang, a, isGuest = false }) {
  const row = (icon, category, labelKey, onPress, extra = {}) => (
    <ListRow key={labelKey} leading={{ icon, category }} title={t(labelKey, lang)} onPress={onPress} divider {...extra} />
  )
  return (
    <View>
      <Group title={t('hrSetPrefs', lang)}>
        {row('globe-outline', 'city', 'menuLanguage', a.onLanguage)}
        {row('location-outline', 'city', 'cwMenuCityWelcome', a.onCityWelcome)}
        {row('notifications-outline', 'city', 'notifications', a.onNotifications)}
      </Group>
      <Group title={t('hrSetSupport', lang)}>
        {row('mail-outline', 'homeLife', 'hrRowContact', a.onContact)}
        {row('star-outline', 'homeLife', 'hrRowRate', a.onRate)}
        {row('share-social-outline', 'homeLife', 'hrRowShare', a.onShare)}
        {row('compass-outline', 'homeLife', 'hrRowTutorial', a.onTutorial)}
      </Group>
      <Group title={t('hrSetLegal', lang)}>
        {row('document-text-outline', 'explore', 'hrRowLegal', a.onLegal)}
        {row('information-circle-outline', 'explore', 'menuAbout', a.onAbout)}
      </Group>
      <Group title={t('hrSetAccount', lang)}>
        {row('log-out-outline', 'health', 'signOut', a.onSignOut, { destructive: true, chevron: false })}
        {/* A guest has no account to delete — signing out IS the end of a guest account. */}
        {!isGuest && !!a.onDeleteAccount &&
          row('trash-outline', 'health', 'hrRowDelete', a.onDeleteAccount, { destructive: true, chevron: false })}
      </Group>
    </View>
  )
}

// ─── Guest Profil ───────────────────────────────────────────────────────────
// Guests could not open this tab before (the tab bar showed the account sheet instead), so
// language and sign-out lived only in the drawer. Now: a "Hesap oluştur" card where the
// name and email would be, then every Tercihler / Destek / Yasal row, working as for anyone.
export function GuestProfile({ lang, a, onCreateAccount }) {
  const pad = useTabBarFootprint()
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: pad + 16 }]} showsVerticalScrollIndicator={false}>
        <Text style={s.page} accessibilityRole="header">{t('tabProfile', lang)}</Text>
        <View style={[s.guestCard, elevation.card]}>
          <CategoryIcon icon="person-add-outline" category="city" size={48} />
          <Text style={s.guestTitle}>{t('hrGuestTitle', lang)}</Text>
          <Text style={s.guestBody}>{t('hrGuestBody', lang)}</Text>
          <Button title={t('hrGuestTitle', lang)} onPress={onCreateAccount} fullWidth style={{ marginTop: 12 }} />
        </View>
        <SettingsGroups lang={lang} a={a} isGuest />
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: colors.canvas },
  content:    { paddingHorizontal: 16, paddingTop: 8 },
  page:       { ...type.pageTitle, color: colors.textPrimary, marginBottom: 16 },
  group:      { marginTop: 20 },
  groupTitle: { ...type.meta, color: colors.textSecondary, marginBottom: 8, marginLeft: 4 },
  card:       { backgroundColor: colors.card, borderRadius: radii.card, paddingHorizontal: 14 },
  guestCard:  { backgroundColor: colors.card, borderRadius: radii.card, padding: 16, alignItems: 'flex-start' },
  guestTitle: { ...type.sectionHeading, color: colors.textPrimary, marginTop: 12 },
  guestBody:  { ...type.body, color: colors.textSecondary, marginTop: 4 },
})

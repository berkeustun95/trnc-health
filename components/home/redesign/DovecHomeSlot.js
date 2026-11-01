import { useState, useEffect } from 'react'
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../../../constants/i18n'
import { colors, press, radii, space, type, elevation } from '../../../constants/theme'
import { DOVEC } from '../../../constants/dovec'
import { loadDovecProjects } from '../../../utils/loadDovecProjects'

// ─── Home: Döveç partner slot ────────────────────────────────────────────────
// Shown only while DOVEC_PARTNER_LIVE is on (HomeScreen decides). A partner placement, so it is
// LABELLED as one ("ADA partner" tag) and never styled as ADA's own guidance (ada-ux-audit:
// a paid placement reads as distinct). The photo is the partner's first project cover, untouched.
// Renders nothing while loading, on a failed read, or with no visible project: an empty partner
// card on Home would read as broken.
export default function DovecHomeSlot({ lang, onPress }) {
  const [cover, setCover] = useState(null)
  const [count, setCount] = useState(0)

  useEffect(() => {
    let alive = true
    loadDovecProjects()
      .then(({ projects, error }) => {
        if (!alive || error || !projects.length) return
        setCover(projects[0].coverSource)
        setCount(projects.length)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  if (!count) return null
  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={press.card} accessibilityRole="button"
      accessibilityLabel={[t('dovecPartnerBadge', lang), DOVEC.name, t('dovecHomeSub', lang)].join(', ')}>
      <Image source={cover} style={s.photo} resizeMode="cover" />
      <View style={s.text}>
        <View style={s.tag}><Text style={s.tagText} numberOfLines={1}>{t('dovecPartnerBadge', lang)}</Text></View>
        <Text style={s.title} numberOfLines={1}>{DOVEC.name}</Text>
        <Text style={s.sub} numberOfLines={2}>{t('dovecHomeSub', lang)}</Text>
        <View style={s.cta}>
          <Text style={s.ctaText} numberOfLines={1}>{t('dovecHomeCta', lang)} · {count}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primaryDark} />
        </View>
      </View>
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  card:    { flexDirection: 'row', gap: space[12], backgroundColor: colors.card, borderRadius: radii.widget,
             padding: space[12], ...elevation.card },
  photo:   { width: 96, height: 96, borderRadius: radii.tile, backgroundColor: colors.soft },
  text:    { flex: 1, gap: 2, justifyContent: 'center' },
  tag:     { alignSelf: 'flex-start', backgroundColor: colors.primaryLight, borderRadius: radii.pill,
             paddingHorizontal: 8, paddingVertical: 2, marginBottom: 2 },
  tagText: { ...type.caption, color: colors.primaryDark },
  title:   { ...type.sheetTitle, color: colors.textPrimary },
  sub:     { ...type.small, color: colors.textSecondary },
  cta:     { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4 },
  ctaText: { ...type.meta, color: colors.primaryDark },
})

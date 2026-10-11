import { useState } from 'react'
import { View, Text, StyleSheet, Linking } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { t, tCount } from '../constants/i18n'
import { colors, category as CAT, type, radii } from '../constants/theme'
import { DetailScaffold, InfoRow, InfoBanner, Button, InlineAlert } from '../components/ui'
import { DUY_CATEGORY, DUY_REGION_TO_DISTRICT, KHK_INSTITUTION, daysLeft, formatDuyDate } from '../constants/duyurular'
import { REGION_LABEL_KEY } from '../constants/regions'

// ─── One announcement ───────────────────────────────────────────────────────
// Title, institution, category, dates, a short excerpt and the official link. The body is
// never stored or shown: applying, bidding and paying happen only on the institution's side.

// The deadline card: the date and how long is left, red-tinted in the last 3 days. A KHK item
// without a parsed deadline gets the same card saying where the date is.
function DeadlineCard({ item, lang, inText }) {
  if (inText) {
    return (
      <View style={[s.dl, { backgroundColor: CAT.city.bg }]}>
        <Ionicons name="document-text-outline" size={22} color={CAT.city.ink} />
        <View style={{ flex: 1 }}>
          <Text style={[s.dlTitle, { color: CAT.city.ink }]}>{t('duyDeadlineInText', lang)}</Text>
          <Text style={s.dlSub}>{t('duyDeadlineCheckSource', lang)}</Text>
        </View>
      </View>
    )
  }
  const d = daysLeft(item.deadline_at)
  const urgent = d >= 0 && d <= 3
  const c = urgent ? CAT.health : CAT.city
  return (
    <View style={[s.dl, { backgroundColor: c.bg }]}>
      <Ionicons name="time-outline" size={22} color={c.ink} />
      <View style={{ flex: 1 }}>
        <Text style={s.dlLabel}>{t('duyDeadline', lang)}</Text>
        <Text style={[s.dlTitle, { color: c.ink }]}>{formatDuyDate(item.deadline_at, lang)}</Text>
        {d >= 0 && <Text style={s.dlSub}>{d === 0 ? t('duyLastDay', lang) : tCount('duyDaysLeft', d, lang)}</Text>}
      </View>
    </View>
  )
}

export default function DuyuruDetailScreen({ item, lang, onBack }) {
  const [openFailed, setOpenFailed] = useState(false)
  const cat = DUY_CATEGORY[item.category]
  const region = item.region && item.region !== 'all'
    ? t(REGION_LABEL_KEY[DUY_REGION_TO_DISTRICT[item.region]], lang)
    : t('duyNationwide', lang)
  // KHK münhal deadlines live in PDFs the fetcher does not read (robots.txt, 2026-10-10).
  const deadlineInText = !item.deadline_at && item.kind === 'open' && item.institution === KHK_INSTITUTION

  const openSource = async () => {
    setOpenFailed(false)
    try { await Linking.openURL(item.official_url) } catch { setOpenFailed(true) }
  }

  return (
    <DetailScaffold
      icon={cat?.icon || 'megaphone-outline'}
      tag={{ label: t(cat?.labelKey || 'menuDuyurular', lang), icon: cat?.icon, category: 'city' }}
      title={item.title}
      subtitle={item.institution}
      onBack={onBack}
      lang={lang}
    >
      {lang !== 'Turkish' && (
        <View style={s.langNote}>
          <Ionicons name="language-outline" size={14} color={colors.textSecondary} />
          <Text style={s.langNoteText}>{t('duyInTurkish', lang)}</Text>
        </View>
      )}

      {(!!item.deadline_at || deadlineInText) && <DeadlineCard item={item} lang={lang} inText={deadlineInText} />}

      <View style={s.rows}>
        <InfoRow icon="calendar-outline" label={t('duyPublished', lang)} value={formatDuyDate(item.published_at, lang)} />
        <InfoRow icon="location-outline" label={t('ddDistrict', lang)} value={region} divider={false} />
      </View>

      {!!item.excerpt && <Text style={s.excerpt}>{item.excerpt}</Text>}

      <View style={s.ctaBlock}>
        <Button title={t('duyGoToSource', lang)} icon="open-outline" onPress={openSource} />
        {openFailed && <InlineAlert message={t('duyOpenFailed', lang)} />}
      </View>

      <InfoBanner icon="shield-checkmark-outline" category="city" message={t('duyDisclaimer', lang)} style={s.disclaimer} />
    </DetailScaffold>
  )
}

const s = StyleSheet.create({
  langNote:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  langNoteText: { ...type.meta, color: colors.textSecondary },
  rows:         { marginTop: 16 },
  excerpt:      { ...type.body, color: colors.textPrimary, marginTop: 16 },
  ctaBlock:     { marginTop: 20, gap: 10 },
  dl:           { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radii.card, padding: 14, marginTop: 16 },
  dlLabel:      { ...type.meta, color: colors.textSecondary },
  dlTitle:      { ...type.rowTitle },
  dlSub:        { ...type.small, color: colors.textSecondary, marginTop: 2 },
  disclaimer:   { marginTop: 20 },
})

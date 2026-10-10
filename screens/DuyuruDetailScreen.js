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

function deadlineValue(item, lang) {
  const date = formatDuyDate(item.deadline_at, lang)
  const d = daysLeft(item.deadline_at)
  if (d < 0) return date
  return `${date} · ${d === 0 ? t('duyLastDay', lang) : tCount('duyDaysLeft', d, lang)}`
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

      <View style={s.rows}>
        <InfoRow icon="calendar-outline" label={t('duyPublished', lang)} value={formatDuyDate(item.published_at, lang)} />
        {!!item.deadline_at && (
          <InfoRow icon="time-outline" label={t('duyDeadline', lang)} value={deadlineValue(item, lang)} />
        )}
        <InfoRow icon="location-outline" label={t('ddDistrict', lang)} value={region} divider={false} />
      </View>

      {!!item.excerpt && <Text style={s.excerpt}>{item.excerpt}</Text>}

      <View style={s.ctaBlock}>
        {deadlineInText && (
          <View style={s.inText}>
            <Ionicons name="information-circle-outline" size={16} color={CAT.city.ink} />
            <Text style={s.inTextText}>{t('duyDeadlineInText', lang)}</Text>
          </View>
        )}
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
  inText:       { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: CAT.city.bg,
                  borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6 },
  inTextText:   { ...type.small, fontFamily: 'Inter_600SemiBold', color: CAT.city.ink, flexShrink: 1 },
  disclaimer:   { marginTop: 20 },
})

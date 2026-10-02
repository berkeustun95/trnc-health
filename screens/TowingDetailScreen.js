import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import CoverageMap from '../components/CoverageMap'
import TowingLogo from '../components/TowingLogo'
import BackButton from '../components/BackButton'
import { colors, shadow, radius } from '../constants/theme'
import { t, LANG_CODES } from '../constants/i18n'
import { REGIONS, REGION_LABEL_KEY } from '../constants/regions'
import {
  VEHICLE_CLASSES, CAR_SUBTYPES, HEAVY_SUBTYPES, SERVICE_ORDER, serviceLabelKey,
} from '../constants/towing'
import { openState } from '../utils/towingHours'
import { logContactEvent } from '../utils/logContactEvent'
import { REDESIGN } from '../constants/redesign'
import { colors as C, category as CAT, type, radii, press } from '../constants/theme'
import { DetailScaffold, InfoRow } from '../components/ui'

// Firm detail. Secondary to the list by design — the call button is already ON the card,
// so nobody in an actual emergency needs to reach this screen. This is for the user who
// wants to check coverage or hours before deciding.

const DAYS = [
  ['mon', 'towingDayMon'], ['tue', 'towingDayTue'], ['wed', 'towingDayWed'],
  ['thu', 'towingDayThu'], ['fri', 'towingDayFri'], ['sat', 'towingDaySat'],
  ['sun', 'towingDaySun'],
]

function Block({ title, children }) {
  return (
    <View style={s.block}>
      <Text style={s.blockTitle}>{title}</Text>
      {children}
    </View>
  )
}

// Redesign section: title + content, Inter throughout (the legacy blocks set fontWeight only).
function RSection({ title, children }) {
  return (
    <View style={r.section}>
      <Text style={r.sectionTitle} accessibilityRole="header">{title}</Text>
      {children}
    </View>
  )
}

export default function TowingDetailScreen({ company, lang, region, onBack }) {
  const insets = useSafeAreaInsets()
  const st = openState(company)

  const phone     = company?.phone
  const phone2    = company?.phone_secondary
  const whatsapp  = company?.whatsapp
  // Stored E.164 with spaces for readability. tel: wants whitespace gone; wa.me wants
  // digits only (no '+').
  // Every contact surface on this screen funnels through these two, so the tap is
  // logged once, here, rather than at five onPress handlers. Logged BEFORE the link
  // fires and never awaited — see utils/logContactEvent.js.
  const dial      = (n, action) => {
    if (!n) return
    logContactEvent('towing', company?.id, action, region)
    Linking.openURL(`tel:${String(n).replace(/\s/g, '')}`)
  }
  const call      = () => dial(phone, 'call')
  const whatsApp  = () => {
    if (!whatsapp) return
    logContactEvent('towing', company?.id, 'whatsapp', region)
    Linking.openURL(`https://wa.me/${String(whatsapp).replace(/\D/g, '')}`)
  }

  const coverage = (company?.coverage_regions || []).filter(r => REGIONS.includes(r))
  const services = SERVICE_ORDER.filter(k => (company?.services || []).includes(k))
  const classes  = company?.vehicle_classes || []

  // Sub-types are display-only — they spell out what 'car' and 'heavy' actually include,
  // because "Otomobil" alone does not tell a motorcyclist they are covered.
  const subtypes = [
    ...(classes.includes('car')   ? CAR_SUBTYPES   : []),
    ...(classes.includes('heavy') ? HEAVY_SUBTYPES : []),
  ]

  if (REDESIGN) {
    const hours = st.state === 'open'  ? { text: t('towingOpenNow', lang), ok: true }
      : st.state === 'opens'           ? { text: t('towingOpensAt', lang).replace('{time}', st.at), warn: true }
      : st.unknown                     ? { text: t('towingHoursUnknownBadge', lang) }
      :                                  { text: t('towingClosedToday', lang), warn: true }
    return (
      <DetailScaffold
        icon="car-outline"
        tag={{ label: t('menuTowing', lang), category: 'homeLife', icon: 'car-outline' }}
        title={company?.name}
        onBack={onBack}
        lang={lang}
        actions={[
          { kind: 'call', label: t('towingCall', lang), onPress: call },
          whatsapp ? { kind: 'whatsapp', onPress: whatsApp, accessibilityLabel: `WhatsApp, ${company?.name}` } : null,
        ]}
      >
        <View style={r.identity}>
          <TowingLogo uri={company?.logo_url} name={company?.name} size={56} />
          <View style={r.chips}>
            <View style={[r.chip, hours.ok && r.chipOk, hours.warn && r.chipWarn]}>
              <Text style={[r.chipText, hours.ok && r.chipOkText, hours.warn && r.chipWarnText]}>{hours.text}</Text>
            </View>
            {!!company?.is_24_7 && (
              <View style={[r.chip, r.chipHome]}>
                <Text style={[r.chipText, r.chipHomeText]}>{t('towing247', lang)}</Text>
              </View>
            )}
          </View>
        </View>

        <RSection title={t('towingContactTitle', lang)}>
          <InfoRow icon="call-outline" category="homeLife" label={t('towingPhone', lang)} value={phone || '—'}
            onPress={phone ? call : undefined} />
          {!!whatsapp && (
            <InfoRow icon="logo-whatsapp" category="homeLife" label="WhatsApp" value={whatsapp} onPress={whatsApp} />
          )}
          {!!phone2 && (
            <TouchableOpacity style={r.secondNumBtn} onPress={() => dial(phone2, 'call_secondary')} activeOpacity={press.small} accessibilityRole="button">
              <Ionicons name="call-outline" size={16} color={C.primaryDark} />
              <Text style={r.secondNumText} numberOfLines={1}>
                {t('towingSecondNumberBtn', lang).replace('{number}', phone2)}
              </Text>
            </TouchableOpacity>
          )}
        </RSection>

        {services.length > 0 && (
          <RSection title={t('towingServicesTitle', lang)}>
            <View style={r.tagWrap}>
              {services.map(k => (
                <View key={k} style={r.tag}><Text style={r.tagText}>{t(serviceLabelKey(k), lang)}</Text></View>
              ))}
            </View>
          </RSection>
        )}

        {classes.length > 0 && (
          <RSection title={t('towingVehiclesTitle', lang)}>
            <View style={r.tagWrap}>
              {VEHICLE_CLASSES.filter(v => classes.includes(v.key)).map(v => (
                <View key={v.key} style={[r.tag, r.tagStrong]}><Text style={[r.tagText, r.tagStrongText]}>{t(v.labelKey, lang)}</Text></View>
              ))}
              {subtypes.map(k => (
                <View key={k} style={r.tag}><Text style={r.tagText}>{t(k, lang)}</Text></View>
              ))}
            </View>
          </RSection>
        )}

        <RSection title={t('towingCoverageTitle', lang)}>
          <CoverageMap regions={coverage} lang={lang} />
          <Text style={r.coverageLine}>{coverage.map(rg => t(REGION_LABEL_KEY[rg], lang)).join(' · ')}</Text>
        </RSection>

        <RSection title={t('towingHoursTitle', lang)}>
          {company?.is_24_7 ? (
            <View style={r.row}>
              <Text style={r.rowLabel}>{t('towingEveryDay', lang)}</Text>
              <Text style={r.rowValue}>{t('towing247Open', lang)}</Text>
            </View>
          ) : company?.opening_hours ? (
            DAYS.map(([key, labelKey]) => {
              const w = company.opening_hours?.[key]
              const open = w && typeof w === 'object' ? `${w.open} – ${w.close}` : t('towingClosed', lang)
              return (
                <View key={key} style={r.row}>
                  <Text style={r.rowLabel}>{t(labelKey, lang)}</Text>
                  <Text style={r.rowValue}>{open}</Text>
                </View>
              )
            })
          ) : (
            <Text style={r.rowLabel}>{t('towingHoursUnknown', lang)}</Text>
          )}
        </RSection>

        {company?.starting_price != null && (
          <RSection title={t('towingPriceTitle', lang)}>
            <InfoRow icon="pricetag-outline" category="homeLife" divider={false} label={t('towingStartingPrice', lang)}
              value={t('towingPriceFrom', lang).replace('{price}', String(company.starting_price))} />
            {!!company.price_updated_at && (
              <Text style={r.priceStamp}>
                {t('towingPriceUpdated', lang)
                  .replace('{date}', new Date(company.price_updated_at)
                    .toLocaleDateString(LANG_CODES[lang] || 'tr'))}
              </Text>
            )}
          </RSection>
        )}

        <Text style={r.disclaimer}>{t('towingDisclaimer', lang)}</Text>
      </DetailScaffold>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.navbar}>
        <BackButton lang={lang} onPress={onBack} />
        <Text style={s.navTitle} numberOfLines={1}>{company?.name}</Text>
        <View style={s.navSpacer} />
      </View>

      {/* 120 clears the absolute contact bar (12 top pad + ~48 button + bottom inset),
          same figure PropertyDetailScreen uses for its identical bar. At 24 the
          disclaimer scrolled underneath it and could never be read. */}
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: 120 + insets.bottom }]}>
        <View style={s.hero}>
          <TowingLogo uri={company?.logo_url} name={company?.name} size={72} />
          <View style={{ flex: 1 }}>
            <Text style={s.heroName}>{company?.name}</Text>
            <View style={s.badgeRow}>
              {st.state === 'open' ? (
                <View style={[s.badge, s.badgeOpen]}>
                  <Text style={[s.badgeText, s.badgeOpenText]}>{t('towingOpenNow', lang)}</Text>
                </View>
              ) : st.state === 'opens' ? (
                <View style={[s.badge, s.badgeShut]}>
                  <Text style={[s.badgeText, s.badgeShutText]}>
                    {t('towingOpensAt', lang).replace('{time}', st.at)}
                  </Text>
                </View>
              ) : st.unknown ? (
                <View style={[s.badge, s.badgeCls]}>
                  <Text style={[s.badgeText, s.badgeClsText]}>{t('towingHoursUnknownBadge', lang)}</Text>
                </View>
              ) : (
                <View style={[s.badge, s.badgeShut]}>
                  <Text style={[s.badgeText, s.badgeShutText]}>{t('towingClosedToday', lang)}</Text>
                </View>
              )}
              {!!company?.is_24_7 && (
                <View style={[s.badge, s.badgeDay]}>
                  <Text style={[s.badgeText, s.badgeDayText]}>{t('towing247', lang)}</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {services.length > 0 && (
          <Block title={t('towingServicesTitle', lang)}>
            <View style={s.tagWrap}>
              {services.map(k => (
                <View key={k} style={s.tag}>
                  <Text style={s.tagText}>{t(serviceLabelKey(k), lang)}</Text>
                </View>
              ))}
            </View>
          </Block>
        )}

        {classes.length > 0 && (
          <Block title={t('towingVehiclesTitle', lang)}>
            <View style={s.tagWrap}>
              {VEHICLE_CLASSES.filter(v => classes.includes(v.key)).map(v => (
                <View key={v.key} style={[s.tag, s.tagStrong]}>
                  <Text style={[s.tagText, s.tagStrongText]}>{t(v.labelKey, lang)}</Text>
                </View>
              ))}
              {subtypes.map(k => (
                <View key={k} style={s.tag}>
                  <Text style={s.tagText}>{t(k, lang)}</Text>
                </View>
              ))}
            </View>
          </Block>
        )}

        <Block title={t('towingCoverageTitle', lang)}>
          <CoverageMap regions={coverage} lang={lang} />
          <Text style={s.coverageLine}>
            {coverage.map(r => t(REGION_LABEL_KEY[r], lang)).join(' · ')}
          </Text>
        </Block>

        <Block title={t('towingHoursTitle', lang)}>
          {company?.is_24_7 ? (
            <View style={s.row}>
              <Text style={s.rowLabel}>{t('towingEveryDay', lang)}</Text>
              <Text style={s.rowValue}>{t('towing247Open', lang)}</Text>
            </View>
          ) : company?.opening_hours ? (
            DAYS.map(([key, labelKey]) => {
              const w = company.opening_hours?.[key]
              const open = w && typeof w === 'object' ? `${w.open} – ${w.close}` : t('towingClosed', lang)
              return (
                <View key={key} style={s.row}>
                  <Text style={s.rowLabel}>{t(labelKey, lang)}</Text>
                  <Text style={s.rowValue}>{open}</Text>
                </View>
              )
            })
          ) : (
            <Text style={s.rowLabel}>{t('towingHoursUnknown', lang)}</Text>
          )}
        </Block>

        {company?.starting_price != null && (
          <Block title={t('towingPriceTitle', lang)}>
            <View style={s.row}>
              <Text style={s.rowLabel}>{t('towingStartingPrice', lang)}</Text>
              <Text style={s.rowValue}>
                {t('towingPriceFrom', lang).replace('{price}', String(company.starting_price))}
              </Text>
            </View>
            {/* The stamp is shown, not hidden: a price with no date is worth less than
                no price. price_updated_at is maintained by trigger, never by hand. */}
            {!!company.price_updated_at && (
              <Text style={s.priceStamp}>
                {t('towingPriceUpdated', lang)
                  .replace('{date}', new Date(company.price_updated_at)
                    .toLocaleDateString(LANG_CODES[lang] || 'tr'))}
              </Text>
            )}
          </Block>
        )}

        {/* Every row here is TAPPABLE. They were plain <Text> until Slice 3 — a number
            that looks like a number and does nothing when pressed is worse than no
            number at all on an emergency screen. Both phone numbers dial; WhatsApp
            opens the chat. */}
        <Block title={t('towingContactTitle', lang)}>
          <TouchableOpacity style={s.row} onPress={call} activeOpacity={0.6} disabled={!phone}>
            <Text style={s.rowLabel}>{t('towingPhone', lang)}</Text>
            <View style={s.rowRight}>
              <Text style={[s.rowValue, !!phone && s.rowValueLink]}>{phone || '—'}</Text>
              {!!phone && <Ionicons name="call-outline" size={15} color={colors.primary} />}
            </View>
          </TouchableOpacity>


          {!!whatsapp && (
            <TouchableOpacity style={s.row} onPress={whatsApp} activeOpacity={0.6}>
              <Text style={s.rowLabel}>WhatsApp</Text>
              <View style={s.rowRight}>
                <Text style={[s.rowValue, s.rowValueLink]}>{whatsapp}</Text>
                <Ionicons name="logo-whatsapp" size={15} color={colors.primary} />
              </View>
            </TouchableOpacity>
          )}

          {/* Same treatment as the card: a full-width outlined button, not a row. The
              row form tested too weak, and this is the number someone reaches for when
              the first one rings out — it has to look like an action. */}
          {!!phone2 && (
            <TouchableOpacity style={s.secondNumBtn} onPress={() => dial(phone2, 'call_secondary')} activeOpacity={0.85}>
              <Ionicons name="call-outline" size={15} color={colors.primary} />
              <Text style={s.secondNumText} numberOfLines={1}>
                {t('towingSecondNumberBtn', lang).replace('{number}', phone2)}
              </Text>
            </TouchableOpacity>
          )}
        </Block>

        <Text style={s.disclaimer}>{t('towingDisclaimer', lang)}</Text>
      </ScrollView>

      {/* Fixed contact bar — same pattern as the accommodation detail screen. Always
          present, so the call is one tap from anywhere in the scroll. */}
      <View style={[s.contactBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TouchableOpacity style={s.callBtn} onPress={call} activeOpacity={0.85}>
          <Ionicons name="call" size={18} color="#FFFFFF" />
          <Text style={s.callText}>{t('towingCall', lang)}</Text>
        </TouchableOpacity>
        {!!whatsapp && (
          <TouchableOpacity style={s.waBtn} onPress={whatsApp} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="WhatsApp">
            <Ionicons name="logo-whatsapp" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.bg },
  navbar:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
                 paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
                 backgroundColor: colors.cardBg, gap: 10 },
  navTitle:    { flex: 1, fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  navSpacer:   { width: 24 },

  content:     { padding: 16 },

  hero:        { flexDirection: 'row', gap: 12, alignItems: 'center', paddingBottom: 14,
                 borderBottomWidth: 1, borderBottomColor: colors.border },
  heroName:    { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.textPrimary, lineHeight: 23 },

  badgeRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7 },
  badge:       { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  badgeText:   { fontSize: 10.5, fontFamily: 'Inter_700Bold' },
  badgeOpen:   { backgroundColor: colors.successLight },
  badgeOpenText: { color: colors.success },
  badgeShut:   { backgroundColor: colors.dangerLight },
  badgeShutText: { color: colors.danger },
  badgeDay:    { backgroundColor: colors.primaryLight },
  badgeDayText:{ color: colors.primary },
  badgeCls:    { backgroundColor: colors.sand },
  badgeClsText:{ color: colors.textSecondary },

  block:       { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: colors.border },
  blockTitle:  { fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
                 color: colors.textSecondary, fontFamily: 'Inter_700Bold', marginBottom: 10 },

  tagWrap:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag:         { paddingHorizontal: 9, paddingVertical: 6, borderRadius: radius.sm,
                 backgroundColor: colors.primaryLight },
  tagText:     { fontSize: 12, color: colors.primary },
  tagStrong:   { backgroundColor: colors.primary },
  tagStrongText: { color: '#FFFFFF', fontFamily: 'Inter_700Bold' },

  coverageLine:{ fontSize: 12.5, color: colors.textPrimary, marginTop: 10, textAlign: 'center' },

  row:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                 paddingVertical: 4, gap: 12 },
  rowLabel:    { fontSize: 13, color: colors.textSecondary, flexShrink: 1 },
  rowValue:    { fontSize: 13, color: colors.textPrimary, fontFamily: 'Inter_700Bold' },
  rowRight:    { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  // Mirrors the card's button exactly. 'transparent' is safe here — this is inside the
  // detail scroll on colors.bg, not over a PageBackground photo.
  secondNumBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                   gap: 7, marginTop: 10, paddingVertical: 11, borderRadius: radius.sm,
                   borderWidth: 1, borderColor: colors.primary, backgroundColor: 'transparent' },
  secondNumText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.primary, flexShrink: 1 },
  rowValueLink:{ color: colors.primary },
  priceStamp:  { fontSize: 11.5, color: colors.textSecondary, marginTop: 6 },

  disclaimer:  { fontSize: 11.5, lineHeight: 17, color: colors.textSecondary,
                 textAlign: 'center', marginTop: 18, paddingHorizontal: 8 },

  contactBar:  { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row',
                 alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 12,
                 backgroundColor: colors.cardBg, borderTopWidth: 1, borderTopColor: colors.border,
                 ...shadow },
  callBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                 gap: 8, backgroundColor: colors.primary, paddingVertical: 13, borderRadius: radius.sm },
  callText:    { color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_700Bold' },
  waBtn:       { width: 50, height: 48, alignItems: 'center', justifyContent: 'center',
                 borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
                 backgroundColor: 'transparent' },
})

const r = StyleSheet.create({
  identity:      { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  chips:         { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip:          { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: C.soft },
  chipText:      { ...type.meta, fontFamily: 'Inter_600SemiBold', color: C.textSecondary },
  chipOk:        { backgroundColor: C.primaryLight },
  chipOkText:    { color: C.primaryDark },
  chipWarn:      { backgroundColor: C.dangerLight },
  chipWarnText:  { color: C.dangerInk },
  chipHome:      { backgroundColor: CAT.homeLife.bg },
  chipHomeText:  { color: CAT.homeLife.ink },

  section:       { marginTop: 22 },
  sectionTitle:  { ...type.sectionHeading, color: C.textPrimary, marginBottom: 8 },

  tagWrap:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag:           { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: CAT.homeLife.bg },
  tagText:       { ...type.meta, color: CAT.homeLife.ink },
  tagStrong:     { backgroundColor: CAT.homeLife.ink },
  tagStrongText: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold' },

  coverageLine:  { ...type.small, color: C.textPrimary, marginTop: 10, textAlign: 'center' },

  row:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                   paddingVertical: 6, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.divider },
  rowLabel:      { ...type.body, color: C.textSecondary, flexShrink: 1 },
  rowValue:      { ...type.body, fontFamily: 'Inter_600SemiBold', color: C.textPrimary },

  secondNumBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
                   marginTop: 10, minHeight: 44, paddingHorizontal: 10, borderRadius: radii.md,
                   borderWidth: 1, borderColor: C.fieldBorder, backgroundColor: C.card },
  secondNumText: { ...type.small, fontFamily: 'Inter_600SemiBold', color: C.primaryDark, flexShrink: 1 },
  priceStamp:    { ...type.meta, color: C.textSecondary, marginTop: 6 },
  disclaimer:    { ...type.caption, fontFamily: 'Inter_400Regular', lineHeight: 17, color: C.textSecondary,
                   textAlign: 'center', marginTop: 24, paddingHorizontal: 8 },
})

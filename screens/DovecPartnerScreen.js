import { useState, useEffect, useCallback } from 'react'
import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet, Linking, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, type, radii, elevation, press } from '../constants/theme'
import { ScreenHeader, ContactBar, EmptyState, ErrorState, CardSkeleton } from '../components/ui'
import { t } from '../constants/i18n'
import { REGION_LABEL_KEY } from '../constants/regions'
import { areaName } from '../constants/areas'
import { DOVEC, DOVEC_STATUS, dovecLogsContacts, dovecTelUrl, dovecWhatsAppUrl, dovecDeliveryQuarter } from '../constants/dovec'
import { moneyText, propertyPriceText, formatAmount } from '../utils/money'
import { loadDovecProjects } from '../utils/loadDovecProjects'
import { logContactEvent } from '../utils/logContactEvent'

// The Döveç Construction partner page: its projects, each with build status and progress, and a
// project page with the available units and a tracked Call / WhatsApp bar.
//
// PARTNER-SCREEN RULE (ada-style §7): ADA owns the FRAME — header, ground, spacing, type, the status
// chip and progress bar that render the partner's own numbers. Project names, photos, descriptions,
// unit lists and their ORDER are Döveç's data, rendered as synced, never edited or re-ranked. Their
// logo is not delivered yet, so the name stands in as plain text (no ADA-drawn mark).
//
// LEADS: every Call / WhatsApp tap on a project page is logged as contact_events (module 'dovec',
// entity_id = the project id) on the line before the handoff; nothing is awaited (logContactEvent
// rule one). There is no contact bar on the list: a lead is always attributable to one project.

const HERO_ASPECT = 16 / 9

function placeOf(p, lang) {
  const region = REGION_LABEL_KEY[p.district] ? t(REGION_LABEL_KEY[p.district], lang) : null
  return [p.area ? areaName(p.area, p.district) : null, region].filter(Boolean).join(' · ')
}

function priceLine(p, lang) {
  if (p.price_on_request) return t('accomPriceOnRequest', lang)
  const from = moneyText(p.price_from, p.currency, lang)
  return from ? `${t('dovecFrom', lang)} ${from}` : null
}

function StatusChip({ status, lang }) {
  const meta = DOVEC_STATUS[status]
  if (!meta) return null
  const tone = status === 'delivered' ? s.chipDelivered : status === 'selling' ? s.chipSelling : s.chipBuilding
  const fg = status === 'delivered' ? colors.success : colors.primaryDark
  return (
    <View style={[s.chip, tone]}>
      <Ionicons name={meta.icon} size={13} color={fg} />
      <Text style={[s.chipText, { color: fg }]} numberOfLines={1}>{t(meta.labelKey, lang)}</Text>
    </View>
  )
}

// The partner's own percentage, drawn. Hidden when they publish none; a delivered project shows a
// full bar because the database holds 100 for it (property_projects_progress_check).
function Progress({ value, lang, compact }) {
  if (value == null) return null
  const pct = Math.max(0, Math.min(100, value))
  return (
    <View style={compact ? s.progressCompact : s.progress}
      accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}
      accessibilityLabel={`${t('dovecProgress', lang)} ${pct}%`}>
      <View style={s.progressHead}>
        <Text style={s.progressLabel}>{t('dovecProgress', lang)}</Text>
        <Text style={s.progressPct}>{pct}%</Text>
      </View>
      <View style={s.track}><View style={[s.fill, { width: `${pct}%` }]} /></View>
    </View>
  )
}

function ProjectCard({ project, lang, width, onPress }) {
  const place = placeOf(project, lang)
  const price = priceLine(project, lang)
  const quarter = dovecDeliveryQuarter(project.delivery_date)
  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={press.card}
      accessibilityRole="button" accessibilityLabel={project.name}>
      <Image source={project.coverSource} style={{ width, height: Math.round(width / HERO_ASPECT) }} resizeMode="cover" />
      <View style={s.cardBody}>
        <StatusChip status={project.project_status} lang={lang} />
        <Text style={s.cardTitle} numberOfLines={2}>{project.name}</Text>
        {!!place && <Text style={s.meta} numberOfLines={1}>{place}</Text>}
        {project.project_status !== 'delivered' && <Progress value={project.construction_progress} lang={lang} compact />}
        <View style={s.cardFoot}>
          {!!price && <Text style={s.price} numberOfLines={1}>{price}</Text>}
          {!!quarter && project.project_status !== 'delivered' && (
            <Text style={s.meta} numberOfLines={1}>{t('dovecDelivery', lang)} {quarter}</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  )
}

function Fact({ icon, label, value }) {
  if (!value) return null
  return (
    <View style={s.fact}>
      <Ionicons name={icon} size={18} color={colors.primaryDark} />
      <Text style={s.factLabel}>{label}</Text>
      <Text style={s.factValue} numberOfLines={2}>{value}</Text>
    </View>
  )
}

function UnitRow({ unit, lang }) {
  const price = propertyPriceText(unit, lang)
  const facts = [
    unit.area_sqm ? `${formatAmount(unit.area_sqm, lang)} m²` : null,
    unit.floor != null ? `${t('dovecFloor', lang)} ${unit.floor}` : null,
  ].filter(Boolean).join(' · ')
  return (
    <View style={s.unit}>
      <Image source={unit.photoSource} style={s.unitPhoto} resizeMode="cover" />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.unitTitle} numberOfLines={2}>{unit.title}</Text>
        {!!facts && <Text style={s.meta}>{facts}</Text>}
        {!!price && <Text style={s.unitPrice}>{price}</Text>}
      </View>
    </View>
  )
}

function ProjectPage({ project, lang, width, bottomInset }) {
  const place = placeOf(project, lang)
  const quarter = dovecDeliveryQuarter(project.delivery_date)
  const log = useCallback(action => {
    if (dovecLogsContacts(project.fromFixture)) logContactEvent('dovec', project.id, action)
  }, [project])
  const call = () => { log('call'); Linking.openURL(dovecTelUrl()).catch(() => {}) }
  const whatsapp = () => {
    log('whatsapp')
    Linking.openURL(dovecWhatsAppUrl(t('dovecWaMessage', lang).replace('{project}', project.name))).catch(() => {})
  }
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 + bottomInset }}>
        <Image source={project.coverSource} style={{ width, height: Math.round(width / HERO_ASPECT) }} resizeMode="cover" />
        <View style={s.page}>
          <StatusChip status={project.project_status} lang={lang} />
          <Text style={s.pageTitle}>{project.name}</Text>
          {!!place && (
            <View style={s.placeRow}>
              <Ionicons name="location-outline" size={15} color={colors.textSecondary} />
              <Text style={s.meta}>{place}</Text>
            </View>
          )}

          <View style={s.panel}>
            <Progress value={project.construction_progress} lang={lang} />
            <Fact icon="calendar-outline" label={t('dovecDelivery', lang)}
              value={project.project_status === 'delivered' ? t('dovecStatusDelivered', lang) : quarter} />
            <Fact icon="pricetag-outline" label={t('dovecPrice', lang)} value={priceLine(project, lang)} />
          </View>

          {!!project.unit_types?.length && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>{t('dovecUnitTypes', lang)}</Text>
              <View style={s.typeRow}>
                {project.unit_types.map(u => (
                  <View key={u} style={s.typePill}><Text style={s.typeText}>{u}</Text></View>
                ))}
              </View>
            </View>
          )}

          {!!project.description && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>{t('dovecAbout', lang)}</Text>
              <Text style={s.body}>{project.description}</Text>
            </View>
          )}

          <View style={s.section}>
            <Text style={s.sectionTitle}>{t('dovecAvailableUnits', lang)}</Text>
            {project.units?.length
              ? project.units.map(u => <UnitRow key={u.id} unit={u} lang={lang} />)
              : <Text style={s.body}>{t('dovecNoUnitsListed', lang)}</Text>}
          </View>
        </View>
      </ScrollView>
      <View style={[s.bar, { paddingBottom: Math.max(bottomInset, 12) }]}>
        <ContactBar lang={lang} actions={[
          { kind: 'call', onPress: call },
          { kind: 'whatsapp', onPress: whatsapp },
        ]} />
      </View>
    </View>
  )
}

export default function DovecPartnerScreen({ lang, onBack, backRef, openProjectId = null }) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const [projects, setProjects] = useState(null)
  const [error, setError] = useState(false)
  const [selectedId, setSelectedId] = useState(openProjectId)

  const load = useCallback(() => {
    setError(false)
    setProjects(null)
    loadDovecProjects({ withUnits: true })
      .then(({ projects: list, error: e }) => { if (e) setError(true); else setProjects(list) })
      .catch(() => setError(true))
  }, [])
  useEffect(() => { load() }, [load])

  // Back: project page -> list, unless the page was the entry point (a map pin), in which case the
  // whole screen closes and the user is back on the map in one press (ada-ux-audit).
  useEffect(() => {
    if (!backRef) return
    backRef.current = () => {
      if (selectedId && selectedId !== openProjectId) { setSelectedId(null); return true }
      return false
    }
    return () => { backRef.current = null }
  }, [backRef, selectedId, openProjectId])

  const selected = selectedId ? (projects || []).find(p => p.id === selectedId) : null
  const handleBack = () => {
    if (selectedId && selectedId !== openProjectId) setSelectedId(null)
    else onBack()
  }

  return (
    // Top inset from the provider's insets, not a native SafeAreaView: that one measured itself one frame
    // after mount when opened from the map, so the header sat under the status bar while loading. The
    // provider's insets are known before this screen mounts, so the first frame is already right.
    <View style={[s.safe, { paddingTop: insets.top }]}>
      <ScreenHeader title={selected ? selected.name : DOVEC.name} onBack={handleBack} lang={lang} />
      {error ? (
        <ErrorState message={t('dovecLoadError', lang)} onRetry={load} lang={lang} />
      ) : projects === null ? (
        <View style={s.list}><CardSkeleton height={260} /><CardSkeleton height={260} /></View>
      ) : selected ? (
        <ProjectPage project={selected} lang={lang} width={width} bottomInset={insets.bottom} />
      ) : (
        <ScrollView contentContainerStyle={[s.list, { paddingBottom: 32 + insets.bottom }]}>
          <View style={s.intro}>
            <View style={s.badge}>
              <Ionicons name="ribbon-outline" size={12} color={colors.primaryDark} />
              <Text style={s.badgeText}>{t('dovecPartnerBadge', lang)}</Text>
            </View>
            <Text style={s.partnerName}>{DOVEC.name}</Text>
            <Text style={s.meta}>{DOVEC.group}</Text>
          </View>
          <Text style={s.sectionTitle}>{t('dovecProjects', lang)}</Text>
          {projects.length
            ? projects.map(p => (
                <ProjectCard key={p.id} project={p} lang={lang} width={width - 32} onPress={() => setSelectedId(p.id)} />
              ))
            : <EmptyState icon="business-outline" title={t('dovecEmpty', lang)} />}
        </ScrollView>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  safe:        { flex: 1, backgroundColor: colors.canvas },
  list:        { padding: 16, gap: 16 },
  intro:       { gap: 4, marginBottom: 4 },
  badge:       { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: colors.primaryLight,
                 borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 6 },
  badgeText:   { ...type.caption, color: colors.primaryDark },
  partnerName: { ...type.pageTitle, color: colors.textPrimary },
  sectionTitle:{ ...type.sectionHeading, color: colors.textPrimary, marginBottom: 8 },
  card:        { backgroundColor: colors.card, borderRadius: radii.card, overflow: 'hidden', ...elevation.card },
  cardBody:    { padding: 16, gap: 6 },
  cardTitle:   { ...type.sheetTitle, color: colors.textPrimary },
  cardFoot:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  meta:        { ...type.small, color: colors.textSecondary },
  price:       { ...type.rowTitle, color: colors.primaryDark },
  chip:        { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', borderRadius: radii.pill,
                 paddingHorizontal: 10, paddingVertical: 4 },
  chipSelling: { backgroundColor: colors.accentLight },
  chipBuilding:{ backgroundColor: colors.primaryLight },
  chipDelivered:{ backgroundColor: colors.successLight },
  chipText:    { ...type.meta },
  progress:    { gap: 6 },
  progressCompact: { gap: 4, marginTop: 4 },
  progressHead:{ flexDirection: 'row', justifyContent: 'space-between' },
  progressLabel:{ ...type.meta, color: colors.textSecondary },
  progressPct: { ...type.meta, fontFamily: 'Inter_700Bold', color: colors.primaryDark },
  track:       { height: 8, borderRadius: radii.pill, backgroundColor: colors.primaryLight, overflow: 'hidden' },
  fill:        { height: 8, borderRadius: radii.pill, backgroundColor: colors.primary },
  page:        { padding: 16, gap: 8 },
  pageTitle:   { ...type.detailTitle, color: colors.textPrimary },
  placeRow:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  panel:       { backgroundColor: colors.card, borderRadius: radii.card, padding: 16, gap: 14, marginTop: 8, ...elevation.card },
  fact:        { flexDirection: 'row', alignItems: 'center', gap: 10 },
  factLabel:   { ...type.body, color: colors.textSecondary, flex: 1 },
  factValue:   { ...type.rowTitle, color: colors.textPrimary, flexShrink: 1, textAlign: 'right' },
  section:     { marginTop: 16 },
  typeRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typePill:    { backgroundColor: colors.card, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border,
                 paddingHorizontal: 12, paddingVertical: 6 },
  typeText:    { ...type.small, color: colors.textPrimary },
  body:        { ...type.body, color: colors.textPrimary },
  unit:        { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: colors.card, borderRadius: radii.md,
                 padding: 10, marginBottom: 10, ...elevation.card },
  unitPhoto:   { width: 84, height: 64, borderRadius: radii.sm },
  unitTitle:   { ...type.rowTitle, color: colors.textPrimary },
  unitPrice:   { ...type.rowTitle, color: colors.primaryDark },
  bar:         { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12,
                 backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
})

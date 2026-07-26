import { useState, useMemo } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, TextInput, Linking,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import PageBackground from '../components/PageBackground'
import ScreenHeader from '../components/ScreenHeader'
import ContentCard from '../components/ContentCard'
import MascotIntroCard from '../components/MascotIntroCard'
import { colors, shadow, radius } from '../constants/theme'
import { t } from '../constants/i18n'

// ─── LAUNCH GATE ─────────────────────────────────────────────────────────────
// Flip to true + OTA to launch the directory publicly. Until then, normal users
// see a Coming Soon screen (no uni names/portal links); admins always see the
// real hub for preview/testing. Same caution as eSIM pre-deal — no arrangements
// with the universities yet.
export const STUDENT_HUB_LIVE = false

// Factual directory — names/URLs are untranslated data (like CROSSINGS/OFFICES in
// NewcomerEssentials). portalUrl present ONLY where the login page was verified live.
// Berke signs off before ship.
const UNIVERSITIES = [
  { id: 'emu',      name: 'Eastern Mediterranean University',      nameTr: 'Doğu Akdeniz Üniversitesi',              district: 'gazimagusa', mainUrl: 'https://www.emu.edu.tr',   portalUrl: 'https://students.emu.edu.tr' },
  { id: 'neu',      name: 'Near East University',                  nameTr: 'Yakın Doğu Üniversitesi',                district: 'lefkosa',    mainUrl: 'https://neu.edu.tr' },
  { id: 'ciu',      name: 'Cyprus International University',        nameTr: 'Uluslararası Kıbrıs Üniversitesi',       district: 'lefkosa',    mainUrl: 'https://ciu.edu.tr',      portalUrl: 'https://sis.ciu.edu.tr' },
  { id: 'gau',      name: 'Girne American University',             nameTr: 'Girne Amerikan Üniversitesi',            district: 'girne',      mainUrl: 'https://www.gau.edu.tr',  portalUrl: 'https://student.gau.edu.tr' },
  { id: 'kyrenia',  name: 'University of Kyrenia',                  nameTr: 'Girne Üniversitesi',                     district: 'girne',      mainUrl: 'https://kyrenia.edu.tr' },
  { id: 'eul',      name: 'European University of Lefke',          nameTr: 'Lefke Avrupa Üniversitesi',              district: 'lefke',      mainUrl: 'https://www.eul.edu.tr',  portalUrl: 'https://moodle.eul.edu.tr' },
  { id: 'final',    name: 'Final International University',         nameTr: 'Uluslararası Final Üniversitesi',        district: 'girne',      mainUrl: 'https://final.edu.tr' },
  { id: 'metuncc',  name: 'METU Northern Cyprus Campus',           nameTr: 'ODTÜ Kuzey Kıbrıs Kampusu',              district: 'guzelyurt',  mainUrl: 'https://ncc.metu.edu.tr', portalUrl: 'https://student.metu.edu.tr' },
  { id: 'itukktc',  name: 'ITU–TRNC Education Research Campus',     nameTr: 'İTÜ–KKTC Eğitim Araştırma Kampüsü',      district: 'gazimagusa', mainUrl: 'https://kktc.itu.edu.tr' },
  { id: 'arucad',   name: 'Arkın University of Creative Arts & Design', nameTr: 'Arkın Yaratıcı Sanatlar ve Tasarım Üniversitesi', district: 'girne', mainUrl: 'https://arucad.edu.tr' },
  { id: 'bau',      name: 'Bahçeşehir Cyprus University',           nameTr: 'Bahçeşehir Kıbrıs Üniversitesi',         district: 'lefkosa',    mainUrl: 'https://baucyprus.edu.tr' },
  { id: 'kstu',     name: 'Cyprus Health & Social Sciences University', nameTr: 'Kıbrıs Sağlık ve Toplum Bilimleri Üniversitesi', district: 'guzelyurt', mainUrl: 'https://kstu.edu.tr' },
  { id: 'auc',      name: 'American University of Cyprus',          nameTr: 'Kıbrıs Amerikan Üniversitesi',           district: 'lefkosa',    mainUrl: 'https://auc.edu.tr' },
  { id: 'cwu',      name: 'Cyprus West University',                 nameTr: 'Kıbrıs Batı Üniversitesi',               district: 'gazimagusa', mainUrl: 'https://cwu.edu.tr' },
  { id: 'cau',      name: 'Cyprus Aydın University',                nameTr: 'Kıbrıs Aydın Üniversitesi',              district: 'girne',      mainUrl: 'https://cau.edu.tr' },
  { id: 'kisbu',    name: 'Cyprus Social Sciences University',      nameTr: 'Kıbrıs Sosyal Bilimler Üniversitesi',    district: 'lefkosa',    mainUrl: 'https://kisbu.edu.tr' },
  { id: 'elu',      name: 'European Leadership University',         nameTr: 'Avrupa Liderlik Üniversitesi',           district: 'gazimagusa', mainUrl: 'https://elu.edu.tr' },
  { id: 'adakent',  name: 'Ada Kent University',                    nameTr: 'Ada Kent Üniversitesi',                  district: 'gazimagusa', mainUrl: 'https://adakent.edu.tr' },
  { id: 'akun',     name: 'University of Mediterranean Karpasia',   nameTr: 'Akdeniz Karpaz Üniversitesi',            district: 'lefkosa',    mainUrl: 'https://akun.edu.tr' },
  { id: 'netkent',  name: 'Netkent Mediterranean Research & Science University', nameTr: 'Netkent Akdeniz Araştırma ve Bilim Üniversitesi', district: 'lefkosa', mainUrl: 'https://netkent.edu.tr' },
  { id: 'bms',      name: 'International Business Management School', nameTr: 'Uluslararası İşletme ve Yönetim Okulu',  district: 'lefkosa',    mainUrl: 'https://bms.edu.tr' },
  { id: 'aoa',      name: 'Atatürk Teacher Training Academy',       nameTr: 'Atatürk Öğretmen Akademisi',             district: 'lefkosa',    mainUrl: 'https://aoa.edu.tr' },
]

const DISTRICTS = ['all', 'lefkosa', 'gazimagusa', 'girne', 'guzelyurt', 'lefke']
const DISTRICT_LABEL = {
  all:        'studentDistAll',
  lefkosa:    'studentDistLefkosa',
  gazimagusa: 'studentDistGazimagusa',
  girne:      'studentDistGirne',
  guzelyurt:  'studentDistGuzelyurt',
  lefke:      'studentDistLefke',
}

const openUrl = (url) => { if (url) Linking.openURL(url).catch(() => {}) }

function SectionTitle({ text }) {
  return <Text style={s.sectionTitle}>{text}</Text>
}

function BulletRow({ iconName, iconColor, title, text }) {
  return (
    <View style={s.bulletRow}>
      <Ionicons name={iconName || 'checkmark-circle-outline'} size={18} color={iconColor || colors.primary} style={s.bulletIcon} />
      <View style={s.bulletBody}>
        {title ? <Text style={s.bulletTitle}>{title}</Text> : null}
        <Text style={s.bulletText}>{text}</Text>
      </View>
    </View>
  )
}

function UniversityRow({ uni, lang }) {
  const name = lang === 'tr' ? uni.nameTr : uni.name
  return (
    <View style={s.uniCard}>
      <Text style={s.uniName}>{name}</Text>
      <Text style={s.uniDistrict}>{t(DISTRICT_LABEL[uni.district], lang)}</Text>
      <View style={s.uniActions}>
        <TouchableOpacity style={[s.uniBtn, s.uniBtnPrimary]} onPress={() => openUrl(uni.mainUrl)} activeOpacity={0.8}>
          <Ionicons name="globe-outline" size={15} color={colors.surface} />
          <Text style={s.uniBtnPrimaryText}>{t('studentWebsiteBtn', lang)}</Text>
        </TouchableOpacity>
        {uni.portalUrl ? (
          <TouchableOpacity style={[s.uniBtn, s.uniBtnGhost]} onPress={() => openUrl(uni.portalUrl)} activeOpacity={0.8}>
            <Ionicons name="log-in-outline" size={15} color={colors.primary} />
            <Text style={s.uniBtnGhostText}>{t('studentPortalBtn', lang)}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  )
}

function UniversitiesTab({ lang }) {
  const [query, setQuery]       = useState('')
  const [district, setDistrict] = useState('all')

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return UNIVERSITIES.filter(u => {
      if (district !== 'all' && u.district !== district) return false
      if (!q) return true
      return u.name.toLowerCase().includes(q) || u.nameTr.toLowerCase().includes(q)
    })
  }, [query, district])

  return (
    <ScrollView style={s.tabScroll} contentContainerStyle={s.tabContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={s.searchBox}>
        <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder={t('studentSearchPlaceholder', lang)}
          placeholderTextColor={colors.textSecondary}
          returnKeyType="search"
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
        {DISTRICTS.map(d => {
          const active = d === district
          return (
            <TouchableOpacity
              key={d}
              style={[s.chip, active && s.chipActive]}
              onPress={() => setDistrict(d)}
              activeOpacity={0.8}
            >
              <Text style={[s.chipText, active && s.chipTextActive]}>{t(DISTRICT_LABEL[d], lang)}</Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>

      {results.length === 0 ? (
        <View style={s.emptyWrap}>
          <Ionicons name="school-outline" size={28} color={colors.textSecondary} />
          <Text style={s.emptyText}>{t('studentNoResults', lang)}</Text>
        </View>
      ) : (
        results.map(u => <UniversityRow key={u.id} uni={u} lang={lang} />)
      )}
    </ScrollView>
  )
}

function BasicsTab({ lang, onShowEsim, onShowNewcomerEssentials }) {
  return (
    <ScrollView style={s.tabScroll} contentContainerStyle={s.tabContent} showsVerticalScrollIndicator={false}>
      <ContentCard>
        <SectionTitle text={t('studentArrivalTitle', lang)} />
        <BulletRow iconName="card-outline"   iconColor="#185FA5"       title={t('studentPermitTitle', lang)} text={t('studentPermitBody', lang)} />
        <BulletRow iconName="wallet-outline"  iconColor={colors.accent} title={t('studentBankTitle', lang)}   text={t('studentBankBody', lang)} />
        <BulletRow iconName="cellular-outline" iconColor="#0E7C7B"      title={t('studentSimTitle', lang)}    text={t('studentSimBody', lang)} />

        <TouchableOpacity style={s.linkBtn} onPress={onShowEsim} activeOpacity={0.8}>
          <Ionicons name="cellular-outline" size={18} color={colors.surface} />
          <Text style={s.linkBtnText}>{t('studentSimBtn', lang)}</Text>
        </TouchableOpacity>
      </ContentCard>

      <ContentCard style={s.secondCard}>
        <SectionTitle text={t('studentNewcomerTitle', lang)} />
        <Text style={s.crossText}>{t('studentNewcomerBody', lang)}</Text>
        <TouchableOpacity style={s.linkBtnGhost} onPress={onShowNewcomerEssentials} activeOpacity={0.8}>
          <Ionicons name="compass-outline" size={18} color={colors.primary} />
          <Text style={s.linkBtnGhostText}>{t('studentNewcomerBtn', lang)}</Text>
        </TouchableOpacity>
      </ContentCard>
    </ScrollView>
  )
}

function ComingSoon({ lang, onBack }) {
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="newcomer_essentials" />
      <ScreenHeader onBack={onBack} lang={lang} title={t('menuStudentHub', lang)} />
      <View style={s.comingWrap}>
        <MascotIntroCard
          module="welcome_guide"
          title={t('studentComingSoonTitle', lang)}
          subtitle={t('studentComingSoonBody', lang)}
        />
      </View>
    </SafeAreaView>
  )
}

export default function StudentHubScreen({ lang, onBack, isAdmin, onShowEsim, onShowNewcomerEssentials }) {
  const [tab, setTab] = useState('universities')

  if (!STUDENT_HUB_LIVE && !isAdmin) {
    return <ComingSoon lang={lang} onBack={onBack} />
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <PageBackground topic="newcomer_essentials" />
      <ScreenHeader onBack={onBack} lang={lang} title={t('menuStudentHub', lang)} />

      <View style={s.introWrap}>
        <MascotIntroCard
          module="welcome_guide"
          title={t('studentHubTitle', lang)}
          subtitle={t('studentHubSubtitle', lang)}
        />
      </View>

      <View style={s.segment}>
        <TouchableOpacity
          style={[s.segmentBtn, tab === 'universities' && s.segmentBtnActive]}
          onPress={() => setTab('universities')}
          activeOpacity={0.9}
        >
          <Text style={[s.segmentText, tab === 'universities' && s.segmentTextActive]}>{t('studentTabUniversities', lang)}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.segmentBtn, tab === 'basics' && s.segmentBtnActive]}
          onPress={() => setTab('basics')}
          activeOpacity={0.9}
        >
          <Text style={[s.segmentText, tab === 'basics' && s.segmentTextActive]}>{t('studentTabBasics', lang)}</Text>
        </TouchableOpacity>
      </View>

      {tab === 'universities'
        ? <UniversitiesTab lang={lang} />
        : <BasicsTab lang={lang} onShowEsim={onShowEsim} onShowNewcomerEssentials={onShowNewcomerEssentials} />}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  introWrap: { paddingHorizontal: 16, marginBottom: 16 },
  comingWrap: { flex: 1, paddingHorizontal: 16, justifyContent: 'center', paddingBottom: 48 },

  segment: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  segmentBtnActive: { backgroundColor: colors.surface, ...shadow },
  segmentText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  segmentTextActive: { color: colors.primary },

  tabScroll: { flex: 1 },
  tabContent: { paddingHorizontal: 16, paddingBottom: 40 },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    ...shadow,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.textPrimary, padding: 0 },

  chipRow: { gap: 8, paddingRight: 8, paddingBottom: 4 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  chipTextActive: { color: colors.surface },

  uniCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 16,
    marginTop: 12,
    ...shadow,
  },
  uniName: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, lineHeight: 21 },
  uniDistrict: { fontSize: 13, color: colors.textSecondary, marginTop: 3, marginBottom: 12 },
  uniActions: { flexDirection: 'row', gap: 10 },
  uniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    flex: 1,
  },
  uniBtnPrimary: { backgroundColor: colors.primary },
  uniBtnPrimaryText: { fontSize: 14, fontWeight: '600', color: colors.surface },
  uniBtnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary },
  uniBtnGhostText: { fontSize: 14, fontWeight: '600', color: colors.primary },

  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: 10 },
  emptyText: { fontSize: 15, color: colors.textSecondary, textAlign: 'center' },

  secondCard: { marginTop: 16 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 14,
  },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16, gap: 10 },
  bulletIcon: { marginTop: 1, flexShrink: 0 },
  bulletBody: { flex: 1 },
  bulletTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 3 },
  bulletText: { fontSize: 14, color: colors.textPrimary, lineHeight: 21 },

  crossText: { fontSize: 14, color: colors.textPrimary, lineHeight: 21, marginBottom: 14 },

  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 13,
    marginTop: 8,
    gap: 8,
  },
  linkBtnText: { fontSize: 15, fontWeight: '600', color: colors.surface },
  linkBtnGhost: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 13,
    gap: 8,
  },
  linkBtnGhostText: { fontSize: 15, fontWeight: '600', color: colors.primary },
})

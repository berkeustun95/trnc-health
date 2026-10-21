import { useState, useEffect, useCallback, useMemo } from 'react'
import { View, Text, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { t } from '../constants/i18n'
import { loadEateryPartners } from '../utils/loadEateryPartners'
import { REGION_LABEL_KEY } from '../constants/regions'
import { EATERY_CATEGORY_KEY, eateryOpenStatus } from '../constants/eatery'
import { colors, type, space, listBottomPad } from '../constants/theme'
import { ScreenHeader, ErrorState, Card, CardSkeleton } from '../components/ui'
import { EateryLogo, PlaceholderTag, useReduceMotion } from '../components/EateryBits'
import { QuizEntryCard, QuizPage } from '../components/EateryQuiz'
import { quizHasMains } from '../constants/eateryQuiz'
import EateryPartnerScreen from './EateryPartnerScreen'

// ─── Yeme-İçme: the partner list ────────────────────────────────────────────
// Rows come from public.eatery_partners with their menu items and photos embedded; RLS returns
// active partners only. Built from rows, so restaurant #2 is data only.
// The table cannot legitimately be empty while the section is live: zero rows is an ERROR STATE.
// utils/loadEateryPartners.js fetches the rows, adds the Preview placeholder and applies the partner gates.

const COLS = 'id, slug, name, category, phone, whatsapp, website_url, menu_url, maps_url, region, address, opening_hours, logo_path, menu_verified_on, sort_order, is_active, order_requires_account, ' +
  'eatery_menu_items(id, section, section_order, name, description, price, currency, sort_order, is_available, photo_path, photo_width, photo_height, role, protein, spicy, portion), ' +
  'eatery_photos(id, kind, storage_path, width, height, sort_order)'

function PartnerCard({ partner, lang, onPress }) {
  const open = eateryOpenStatus(partner, lang)
  const regionKey = REGION_LABEL_KEY[partner.region]
  const category = t(EATERY_CATEGORY_KEY[partner.category] || 'eateryCatRestaurant', lang)
  return (
    <Card onPress={onPress} accessibilityLabel={[partner.name, category, open?.text].filter(Boolean).join(', ')}>
      <View style={s.row}>
        <EateryLogo partner={partner} width={64} height={64} lang={lang} />
        <View style={s.text}>
          <Text style={s.name} numberOfLines={2}>{partner.name}</Text>
          <Text style={s.cat} numberOfLines={1}>{category}</Text>
          <View style={s.meta}>
            {!!regionKey && (
              <View style={s.metaItem}>
                <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
                <Text style={s.metaText} numberOfLines={1}>{t(regionKey, lang)}</Text>
              </View>
            )}
            {!!open && (
              <Text style={[s.metaText, open.tone === 'ok' ? s.ok : open.tone === 'warn' ? s.warn : null]} numberOfLines={1}>{open.text}</Text>
            )}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </View>
      {!!partner.placeholder && <PlaceholderTag lang={lang} style={s.tag} />}
      {partner.is_active === false && <PlaceholderTag lang={lang} labelKey="eateryUnpublishedTag" style={s.tag} />}
    </Card>
  )
}

// openSlug: the Explore map pin hands a slug, not a row (the map selects no menu or contact columns);
// once the full rows are in, the matching partner opens and onOpenSlugDone clears the slug.
export default function EateryScreen({ lang, session, onRequireAccount, partner, onOpenPartner, onClosePartner, partnerBackRef, onBack, openSlug, onOpenSlugDone, listBackRef = null }) {
  const insets = useSafeAreaInsets()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)
  const [attempt, setAttempt] = useState(0)
  // "Ne yesem?": the page is a layer above the list. Its state lives in a component that stays mounted while a
  // partner page is open (the partner is drawn over the list, not instead of it), so back from the dish lands on the results.
  const [quizOpen, setQuizOpen]   = useState(false)
  const [quizShown, setQuizShown] = useState(false)
  const [focus, setFocus] = useState(null)   // { partnerId, itemId, basket }: scroll the partner page to this dish / open its Sepetim (only for that partner)
  const reduce = useReduceMotion()
  const showQuiz = useMemo(() => quizHasMains(rows), [rows])
  const openQuiz = () => { setQuizShown(true); setQuizOpen(true) }
  const openDish = (p, itemId) => { setFocus({ partnerId: p.id, itemId }); onOpenPartner(p) }
  const openMenu = p => openDish(p, null)
  const openBasket = p => { setFocus({ partnerId: p.id, itemId: null, basket: true }); onOpenPartner(p) }
  // After the server refuses an order for a stale price / item: reload the rows and swap the open partner for its fresh row.
  const refreshRows = useCallback(async () => {
    const { rows: list, error: err } = await loadEateryPartners(COLS)
    if (err || !list.length) return
    setRows(list)
    if (partner) { const fresh = list.find(r => r.id === partner.id); if (fresh) onOpenPartner(fresh) }
  }, [partner, onOpenPartner])
  const retry = useCallback(() => { setError(false); setLoading(true); setAttempt(a => a + 1) }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { rows: list, error: err } = await loadEateryPartners(COLS)
      if (!alive) return
      if (err) { setError(true); setLoading(false); return }
      if (!list.length) { setError(true); setLoading(false); return }
      setRows(list)
      setLoading(false)
      if (openSlug) {
        const hit = list.find(r => r.slug === openSlug)
        if (hit) { setFocus(null); onOpenPartner(hit) }
        onOpenSlugDone?.(!!hit)
      }
    })().catch(() => { if (alive) { setError(true); setLoading(false) } })
    return () => { alive = false }
  }, [attempt])

  const list = (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.shown} {...(quizOpen === true ? { importantForAccessibility: 'no-hide-descendants', accessibilityElementsHidden: true } : null)}>
      <ScreenHeader lang={lang} title={t('menuEatery', lang)} onBack={onBack} />
      {loading || (!!openSlug && !error) ? (
        <View style={s.content}><CardSkeleton height={96} /></View>
      ) : error ? (
        <ErrorState onRetry={retry} lang={lang} />
      ) : (
        <ScrollView contentContainerStyle={[s.content, { paddingBottom: listBottomPad(insets) }]} showsVerticalScrollIndicator={false}>
          {showQuiz && <QuizEntryCard lang={lang} onPress={openQuiz} />}
          {rows.map(p => <PartnerCard key={p.id} partner={p} lang={lang} onPress={() => { setFocus(null); onOpenPartner(p) }} />)}
        </ScrollView>
      )}
      </View>
      {quizShown === true && (
        <QuizPage lang={lang} open={quizOpen === true} rows={rows} reduce={reduce} backRef={listBackRef}
          onClose={() => setQuizOpen(false)} onClosed={() => setQuizShown(false)} onOpenDish={openDish} onOpenMenu={openMenu} onOpenBasket={openBasket} />
      )}
    </SafeAreaView>
  )

  // One stable tree: the list never remounts when a partner opens (its quiz state and scroll position survive).
  return (
    <View style={s.stack}>
      <View style={partner ? s.hidden : s.shown} pointerEvents={partner ? 'none' : 'auto'}>{list}</View>
      {!!partner && (
        <View style={StyleSheet.absoluteFill}>
          <EateryPartnerScreen partner={partner} lang={lang} onBack={onClosePartner} backRef={partnerBackRef} session={session} onRequireAccount={onRequireAccount} onRefresh={refreshRows}
            focusItemId={focus && focus.partnerId === partner.id ? focus.itemId : null} openBasket={!!focus && focus.partnerId === partner.id && focus.basket === true} />
        </View>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  stack:    { flex: 1, backgroundColor: colors.canvas },
  shown:    { flex: 1 },
  hidden:   { flex: 1, display: 'none' },
  safe:     { flex: 1, backgroundColor: colors.canvas },
  content:  { paddingHorizontal: 16, paddingTop: space[8], gap: 14 },
  row:      { flexDirection: 'row', alignItems: 'center', gap: space[12] },
  text:     { flex: 1 },
  name:     { ...type.rowTitle, color: colors.textPrimary },
  cat:      { ...type.small, color: colors.textSecondary, marginTop: 2 },
  meta:     { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space[12], rowGap: 2, marginTop: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  metaText: { ...type.meta, color: colors.textSecondary, flexShrink: 1 },
  ok:       { color: colors.primaryDark },
  warn:     { color: colors.dangerInk },
  tag:      { marginTop: space[12] },
})

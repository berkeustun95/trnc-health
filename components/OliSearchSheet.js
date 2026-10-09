import { useEffect, useRef, useState } from 'react'
import { Modal, View, Text, Image, TextInput, TouchableOpacity, FlatList, StyleSheet, Keyboard } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { colors, type, radii, elevation, press } from '../constants/theme'
import { t } from '../constants/i18n'
import { resolveOliQuery, getIntent } from '../constants/oliIntents'
import { coarseCoord } from '../utils/facilityUtils'
import { CHIPS } from './OliGuide'
import { IconButton, CategoryIcon, ErrorState, RowSkeleton } from './ui'
import { useVoiceInput, MicButton } from './OliMic'

// ─── Oli + search, one sheet (redesign) ──────────────────────────────────────
// Replaces OliGuide when REDESIGN is on, with the SAME interface (openRef / closeRef /
// onOpenChange / onNavigate), so App.js's back chain and oliSheetOpen keep working unchanged.
//
// Typing shows BOTH answers in one virtualised list: Oli's intent cards first (resolved
// locally, instantly), then search_content rows. The search half obeys the rules the audit
// found broken on Home search:
//   • an RPC failure is an ERROR with "Tekrar dene" — never "no results"
//   • a stale-response guard: only the latest request may write results
//   • skeleton rows while loading; FlatList, not ScrollView.map
// The input is at the TOP, so the keyboard can never cover it.
const DEBOUNCE_MS = 300

// search_content's `module` → category colour + icon.
const RESULT_META = {
  medical:      { icon: 'medkit-outline',    category: 'health' },
  events:       { icon: 'calendar-outline',  category: 'explore' },
  beach:        { icon: 'umbrella-outline',  category: 'explore' },
  landmark:     { icon: 'flag-outline',      category: 'explore' },
  homeServices: { icon: 'hammer-outline',    category: 'homeLife' },
  transport:    { icon: 'bus-outline',       category: 'city' },
  jobPostings:  { icon: 'briefcase-outline', category: 'city' },
  towing:       { icon: 'car-outline',       category: 'city' },
}

// Shown until ADA has its own mic (VOICE_INPUT), then kept as that mic's fallback when the
// recognizer lacks the language or the permission is denied. Conditional wording: iOS shows
// no keyboard mic with Dictation off, and some third-party keyboards have none.
function KeyboardMicHint({ lang }) {
  return <Text style={s.micHint}>{t('oliVoiceHint', lang)}</Text>
}

export default function OliSearchSheet({ lang, userLocation, onNavigate, onOpenResult, onOpenChange, openRef, closeRef }) {
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(null)            // an intent chosen from a chip
  const [search, setSearch] = useState({ status: 'idle', rows: [] })   // idle | loading | ok | error
  const reqId = useRef(0)
  const inputRef = useRef(null)
  const queryRef = useRef('')
  queryRef.current = query
  const voice = useVoiceInput({ lang, getText: () => queryRef.current, onText: setQuery })

  const openSheet = () => { setQuery(''); setPicked(null); setSearch({ status: 'idle', rows: [] }); setOpen(true) }
  const closeSheet = () => { Keyboard.dismiss(); voice.abort(); reqId.current++; setOpen(false) }
  if (openRef) openRef.current = openSheet
  if (closeRef) closeRef.current = closeSheet

  useEffect(() => { onOpenChange?.(open); return () => onOpenChange?.(false) }, [open])

  async function runSearch(q) {
    const id = ++reqId.current
    setSearch(prev => ({ status: 'loading', rows: prev.rows }))
    const { data, error } = await supabase.rpc('search_content', {
      query: q,
      user_lat: coarseCoord(userLocation?.latitude ?? null),
      user_lon: coarseCoord(userLocation?.longitude ?? null),
    })
    if (id !== reqId.current) return               // a newer keystroke owns the results now
    if (error) { setSearch({ status: 'error', rows: [] }); return }
    setSearch({ status: 'ok', rows: data ?? [] })
  }

  useEffect(() => {
    const q = query.trim()
    if (!q) { reqId.current++; setSearch({ status: 'idle', rows: [] }); return }
    setPicked(null)
    const timer = setTimeout(() => runSearch(q), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  const q = query.trim()
  const intents = picked ? [picked] : q ? resolveOliQuery(q) : []

  // One heterogeneous list: intents, then the search section.
  const items = []
  if (intents.length) {
    items.push({ kind: 'header', key: 'h-oli', label: 'Oli' })
    for (const i of intents) items.push({ kind: 'intent', key: `i-${i.id}`, intent: i })
  }
  // A search that came back empty under an Oli card is not "no results": Oli answered, so the
  // whole section (heading included) is left out. "No results" only when neither has anything.
  const searchEmpty = search.status === 'ok' && !search.rows.length
  if (q && !(searchEmpty && intents.length)) {
    items.push({ kind: 'header', key: 'h-res', label: t('hrSearchResults', lang) })
    if (search.status === 'loading' && !search.rows.length) items.push({ kind: 'skeleton', key: 'sk' })
    else if (search.status === 'error') items.push({ kind: 'error', key: 'err' })
    else if (searchEmpty) items.push({ kind: 'empty', key: 'empty' })
    else search.rows.forEach((r, n) => items.push({ kind: 'result', key: `r-${r.module}-${r.id}-${n}`, row: r }))
  }

  function renderItem({ item }) {
    switch (item.kind) {
      case 'header':
        return <Text style={s.section} accessibilityRole="header">{item.label}</Text>
      case 'intent':
        return (
          <View style={[s.intent, elevation.card]}>
            <Image source={require('../assets/oli-button.png')} style={s.intentAvatar} resizeMode="cover" />
            <View style={{ flex: 1 }}>
              <Text style={s.intentMsg}>{t(item.intent.msgKey, lang)}</Text>
              <TouchableOpacity style={s.goBtn} activeOpacity={press.small} accessibilityRole="button"
                onPress={() => { closeSheet(); onNavigate?.(item.intent.id) }}>
                <Text style={s.goText}>{t('oliTakeMeThere', lang)}</Text>
                <Ionicons name="arrow-forward" size={15} color={colors.onPrimary} />
              </TouchableOpacity>
            </View>
          </View>
        )
      case 'skeleton':
        return <View style={s.rowsBox}><RowSkeleton count={4} /></View>
      case 'error':
        return <ErrorState lang={lang} onRetry={() => runSearch(q)} />
      case 'empty':
        return <Text style={s.empty}>{t('noResultsTitle', lang)}</Text>
      case 'result': {
        const meta = RESULT_META[item.row.module] ?? { icon: 'search-outline', category: 'city' }
        return (
          <TouchableOpacity style={s.result} activeOpacity={press.small} accessibilityRole="button"
            accessibilityLabel={[item.row.title, item.row.subtitle].filter(Boolean).join(', ')}
            onPress={() => { closeSheet(); onOpenResult?.(item.row) }}>
            <CategoryIcon icon={meta.icon} category={meta.category} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={s.resTitle} numberOfLines={1}>{item.row.title}</Text>
              {!!item.row.subtitle && <Text style={s.resSub} numberOfLines={1}>{item.row.subtitle}</Text>}
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </TouchableOpacity>
        )
      }
    }
    return null
  }

  return (
    <Modal visible={open === true} transparent animationType="slide" statusBarTranslucent onRequestClose={closeSheet}
      onShow={() => setTimeout(() => inputRef.current?.focus(), 60)}>
      <View style={s.backdrop}>
      <View style={[s.sheet, { marginTop: insets.top + 8 }]} accessibilityViewIsModal>
        <View style={s.grabber} />
        <View style={s.head}>
          <Image source={require('../assets/oli-button.png')} style={s.headImg} resizeMode="cover" />
          <Text style={s.headTitle} accessibilityRole="header">{t('homeOliTitle', lang)}</Text>
          <IconButton icon="close" onPress={closeSheet} accessibilityLabel={t('uiClose', lang)} />
        </View>

        <View style={[s.field, elevation.floating]}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            ref={inputRef}
            style={s.input}
            value={query}
            onChangeText={setQuery}
            placeholder={t(voice.listening ? 'oliListening' : 'hrOliField', lang)}
            placeholderTextColor={colors.textSecondary}
            returnKeyType="search"
            accessibilityLabel={t('hrOliField', lang)}
          />
          {!!query && !voice.listening && (
            <IconButton icon="close-circle" iconSize={18} color={colors.textSecondary}
              onPress={() => setQuery('')} accessibilityLabel={t('uiClear', lang)} />
          )}
          {voice.available && <MicButton lang={lang} listening={voice.listening} onPress={voice.toggle} />}
        </View>

        {!q && !picked ? (
          <View style={s.home}>
            {!voice.available && <KeyboardMicHint lang={lang} />}
            <Text style={s.greeting}>{t('oliGreeting', lang)}</Text>
            <View style={s.chips}>
              {CHIPS.map(c => (
                <TouchableOpacity key={c.id} style={s.chip} activeOpacity={press.small} accessibilityRole="button"
                  onPress={() => { Keyboard.dismiss(); setPicked(getIntent(c.id)) }}>
                  <Text style={s.chipText}>{t(c.labelKey, lang)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={it => it.key}
            renderItem={renderItem}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}
            initialNumToRender={12}
            windowSize={7}
          />
        )}
      </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet:     { flex: 1, backgroundColor: colors.canvas, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet,
               overflow: 'hidden', ...elevation.tabBar },
  grabber:   { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginTop: 10 },
  head:      { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 6 },
  headImg:   { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryLight },
  headTitle: { ...type.sheetTitle, color: colors.textPrimary, flex: 1 },
  field:     { flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, borderRadius: radii.pill,
               backgroundColor: colors.card, paddingLeft: 18, paddingRight: 4, marginHorizontal: 16, marginVertical: 12 },
  input:     { ...type.body, fontSize: 15, color: colors.textPrimary, flex: 1, padding: 0 },
  home:      { paddingHorizontal: 20, paddingTop: 8, alignItems: 'center' },
  micHint:   { ...type.small, color: colors.textSecondary, textAlign: 'center', marginBottom: 16 },
  greeting:  { ...type.sectionHeading, color: colors.textPrimary, textAlign: 'center', marginBottom: 16 },
  chips:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  chip:      { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: radii.pill,
               backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  chipText:  { ...type.body, fontFamily: 'Inter_600SemiBold', color: colors.textPrimary },
  section:   { ...type.meta, color: colors.textSecondary, marginTop: 12, marginBottom: 8 },
  intent:    { flexDirection: 'row', gap: 12, backgroundColor: colors.card, borderRadius: radii.card, padding: 14, marginBottom: 10 },
  intentAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryLight },
  intentMsg: { ...type.body, color: colors.textPrimary },
  goBtn:     { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 44,
               marginTop: 10, paddingHorizontal: 16, borderRadius: radii.pill, backgroundColor: colors.primary },
  goText:    { ...type.small, fontFamily: 'Inter_600SemiBold', color: colors.onPrimary },
  rowsBox:   { backgroundColor: colors.card, borderRadius: radii.card, paddingHorizontal: 14 },
  result:    { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 14,
               backgroundColor: colors.card, borderRadius: radii.md, marginBottom: 8 },
  resTitle:  { ...type.rowTitle, color: colors.textPrimary },
  resSub:    { ...type.small, color: colors.textSecondary },
  empty:     { ...type.body, color: colors.textSecondary, textAlign: 'center', paddingVertical: 16 },
})

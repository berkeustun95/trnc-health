import { useState, useEffect, useCallback } from 'react'
import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { colors, shadow, readableOn } from '../constants/theme'
import { t } from '../constants/i18n'
import BackButton from '../components/BackButton'
import ConnectivityErrorState from '../components/ConnectivityErrorState'
import { fetchOperator, fetchLinks, openHandoff } from '../lib/connectivity'
import { logContactEvent } from '../utils/logContactEvent'
import { partnerAsset } from '../constants/partnerAssets'

// Bağlantı & eSIM — module landing (Berke, 2026-10-15): a partner card, three tiles and a
// support bar, each opening a KKTCELL page in the in-app browser.
//
// ⚠ EVERY BRAND VALUE AND EVERY URL COMES OFF THE DATABASE. Colours, logo and name from the
//   operator row; the four targets from connectivity_links (20261113), keyed by slug. Only the
//   artwork and the copy are in the app.
//
// The art is Oli & Maki in blue TURKCELL KUZEY KIBRIS caps (KKTCELL's request), resolved through
// constants/partnerAssets.js like every partner asset. The logo comes off the operator row's
// logo_key (20261129), the same pattern as driving_schools.logo_key.
//
// The previous landing linked to the operator / package / stores screens; nothing links to them
// now. Their code and App.js routes are kept.

const ART = {
  hero:    partnerAsset('kktcell/hero'),
  tasi:    partnerAsset('kktcell/tasi'),
  turist:  partnerAsset('kktcell/turist'),
  yenihat: partnerAsset('kktcell/yenihat'),
}

const TILES = [
  { slug: 'tasi',    titleKey: 'connTileTasiTitle',    subKey: 'connTileTasiSub',    tint: 'secondary' },
  { slug: 'turist',  titleKey: 'connTileTuristTitle',  subKey: 'connTileTuristSub',  tint: 'primary' },
  { slug: 'yenihat', titleKey: 'connTileYenihatTitle', subKey: 'connTileYenihatSub', tint: 'secondary' },
]
const REQUIRED_SLUGS = ['tasi', 'turist', 'yenihat', 'support']

const GUTTER = 16
const GAP = 12
const CARD_PAD = 18
const HERO_SHARE = 0.37        // of the card's inner width; keeps the card as tall as the earlier art did
const HERO_ASPECT = 647 / 700  // kktcell-hero.png
// The column never grows past a large phone: on a tablet the card, art and tiles keep their phone
// proportions, centred, instead of scaling up to a 490 pt hero and 390 pt tiles.
const MAX_COLUMN = 480

// Every size the layout derives from the window, in one place.
function landingGeometry(screenW) {
  const columnW = Math.min(screenW - GUTTER * 2, MAX_COLUMN)
  const tileW = Math.floor((columnW - GAP) / 2)
  const innerW = columnW - CARD_PAD * 2
  const heroW = Math.round(innerW * HERO_SHARE)
  const heroH = Math.round(heroW / HERO_ASPECT)
  return { columnW, tileW, innerW, heroW, heroH }
}

function withAlpha(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!m) return `rgba(0,0,0,${a})`
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

// White square for the partner's logo: the bundled asset named by logo_key first, then a remote
// logo_url, then (no key, no URL, or the image fails) a neutral icon in the brand colour, never a
// broken box. A row without logo_key (before 20261129 applies) therefore shows the icon.
function LogoSquare({ operator, brand }) {
  const [broken, setBroken] = useState(false)
  const bundled = partnerAsset(operator?.logo_key)
  const source = bundled ?? (operator?.logo_url ? { uri: operator.logo_url } : null)
  useEffect(() => { setBroken(false) }, [operator?.logo_key, operator?.logo_url])
  const showImage = !!source && !broken
  return (
    <View style={s.logoSquare}>
      {showImage ? (
        <Image source={source} style={s.logoImg} resizeMode="contain"
               onError={() => setBroken(true)} accessibilityLabel={operator?.name ?? ''} />
      ) : (
        <Ionicons name="cellular" size={22} color={brand} />
      )}
    </View>
  )
}

function Tile({ tile, width, lang, operatorName, tint, onPress }) {
  return (
    <TouchableOpacity
      style={[s.tile, { width }]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="link"
      accessibilityLabel={t(tile.titleKey, lang)}
    >
      <View style={[s.tileArt, { backgroundColor: tint }]}>
        <Image source={ART[tile.slug]} style={s.tileImg} resizeMode="contain" />
      </View>
      <Text style={s.tileTitle}>{t(tile.titleKey, lang)}</Text>
      <Text style={s.tileSub}>{t(tile.subKey, lang).replace('{operator}', operatorName)}</Text>
    </TouchableOpacity>
  )
}

export default function ConnectivityLandingScreen({ lang, onBack, onOperatorLoaded }) {
  const { width: screenW } = useWindowDimensions()
  const [operator, setOperator] = useState(null)
  const [links, setLinks]       = useState({})
  const [loading, setLoading]   = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [failed, setFailed]     = useState(false)
  const [opening, setOpening]   = useState(false)
  const [openFailed, setOpenFailed] = useState(false)

  const load = useCallback(async () => {
    const op = await fetchOperator()
    const ln = op.data ? await fetchLinks(op.data.id) : { data: {}, error: null }
    return { op, ln }
  }, [])

  const apply = useCallback(({ op, ln }) => {
    setFailed(!!op.error || !!ln.error)
    setOperator(op.data)
    setLinks(ln.data ?? {})
    if (op.data) onOperatorLoaded?.(op.data)
  }, [onOperatorLoaded])

  useEffect(() => {
    let active = true
    ;(async () => {
      const res = await load()
      if (!active) return
      apply(res)
      setLoading(false)
    })()
    return () => { active = false }
  }, [])

  const onRetry = useCallback(async () => {
    setRetrying(true)
    apply(await load())
    setRetrying(false)
  }, [load, apply])

  const primary     = operator?.brand_primary   || colors.primary
  const secondary   = operator?.brand_secondary || colors.textPrimary
  const onPrimary   = readableOn(primary)
  const onSecondary = readableOn(secondary)
  const operatorName = operator?.name ?? ''

  // ADA's own lead count: logged BEFORE the browser opens, entity_id = the link row (its slug is
  // the per-target label by join). Fire-and-forget; cannot throw.
  const openLink = useCallback(async (slug) => {
    const link = links[slug]
    if (!link?.url || opening) return
    logContactEvent('connectivity', link.id, 'website', null, lang)
    setOpening(true)
    setOpenFailed(false)
    const ok = await openHandoff(link.url, { secondary, onSecondary })
    setOpening(false)
    if (!ok) setOpenFailed(true)
  }, [links, opening, lang, secondary, onSecondary])

  function renderBody() {
    if (loading) {
      return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>
    }

    // No operator, a failed read, or a missing target all render the error state: a grid with a
    // hole is worse than a retry. conn:health guards that none of these reach a user.
    const complete = REQUIRED_SLUGS.every(sl => links[sl]?.url)
    if (failed || !operator || !complete) {
      return <ConnectivityErrorState lang={lang} onRetry={onRetry} retrying={retrying} />
    }

    // Copy and art sit side by side, never overlapping: the copy column ends where the art begins,
    // so a long locale wraps instead of running under the characters.
    const { columnW, tileW, innerW, heroW, heroH } = landingGeometry(screenW)
    const tints = { primary: withAlpha(primary, 0.22), secondary: withAlpha(secondary, 0.09) }

    return (
      <View style={{ width: columnW, alignSelf: 'center' }}>
        <View style={[s.card, { backgroundColor: secondary, minHeight: heroH + CARD_PAD }]}>
          <View style={{ width: innerW - heroW }}>
            <View style={s.brandRow}>
              <LogoSquare operator={operator} brand={secondary} />
              <Text style={[s.brandName, { color: onSecondary }]} numberOfLines={1}>{operatorName}</Text>
            </View>
            <View style={[s.pill, { backgroundColor: primary }]}>
              <Text style={[s.pillText, { color: onPrimary }]}>{t('connLandingPill', lang)}</Text>
            </View>
            <Text style={[s.cardBody, { color: onSecondary }]}>
              {t('connLandingBody', lang).replace('{operator}', operatorName)}
            </Text>
          </View>
          <Image source={ART.hero} style={[s.hero, { width: heroW, height: heroH }]} resizeMode="contain" />
        </View>

        <View style={s.tileRow}>
          {TILES.slice(0, 2).map(tile => (
            <Tile key={tile.slug} tile={tile} width={tileW} lang={lang} operatorName={operatorName}
                  tint={tints[tile.tint]} onPress={() => openLink(tile.slug)} />
          ))}
        </View>
        <View style={s.tileCentre}>
          <Tile tile={TILES[2]} width={tileW} lang={lang} operatorName={operatorName}
                tint={tints[TILES[2].tint]} onPress={() => openLink(TILES[2].slug)} />
        </View>

        <TouchableOpacity
          style={[s.bar, { backgroundColor: secondary }]}
          onPress={() => openLink('support')}
          activeOpacity={0.85}
          accessibilityRole="link"
          accessibilityLabel={t('connSupportTitle', lang)}
        >
          <View style={[s.chat, { backgroundColor: primary }]}>
            <Ionicons name="chatbubble-ellipses" size={20} color={onPrimary} />
          </View>
          <View style={s.barCopy}>
            <Text style={[s.barTitle, { color: onSecondary }]}>{t('connSupportTitle', lang)}</Text>
            <Text style={[s.barSub, { color: onSecondary }]}>
              {t('connSupportSub', lang).replace('{operator}', operatorName)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={onSecondary} />
        </TouchableOpacity>

        {/* ADA's own voice, so FIXED colours, never the operator's: in the partner's brand it would
            read as the partner warning you off competitors. Below the bar, small and flat (no
            shadow) so it never competes with the tiles. */}
        <View style={s.warn}>
          <Text style={s.warnText}>
            <Text style={s.warnStrong}>{t('connWarnTitle', lang)} </Text>
            {t('connWarnBody', lang)}
          </Text>
        </View>

        {opening && <ActivityIndicator style={s.opening} color={secondary} />}
        {openFailed && <Text style={s.failText}>{t('connOpenFailed', lang)}</Text>}
      </View>
    )
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <BackButton lang={lang} onPress={onBack} />
        <Text style={s.headerTitle}>{t('connTitle', lang)}</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
        {renderBody()}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: colors.bg },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.cardBg, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTitle:   { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  scroll:        { flex: 1 },
  scrollContent: { padding: GUTTER, paddingBottom: 48 },
  center:        { paddingVertical: 40, alignItems: 'center' },

  // overflow:hidden clips the hero art to the card radius; the art is sized from the screen width.
  card:          { borderRadius: 24, overflow: 'hidden', padding: CARD_PAD, ...shadow },
  brandRow:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoSquare:    { width: 44, height: 44, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logoImg:       { width: 36, height: 36 },
  brandName:     { flexShrink: 1, fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: 0.3 },
  pill:          { alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11, marginTop: 12 },
  pillText:      { fontSize: 11.5, fontFamily: 'Inter_700Bold' },
  cardBody:      { fontSize: 14, fontFamily: 'Inter_600SemiBold', lineHeight: 20, marginTop: 10 },
  hero:          { position: 'absolute', right: CARD_PAD - 6, bottom: 0 },

  tileRow:       { flexDirection: 'row', justifyContent: 'space-between', marginTop: GAP },
  tileCentre:    { alignItems: 'center', marginTop: GAP },
  tile:          { backgroundColor: colors.cardBg, borderRadius: 24, padding: 10, paddingBottom: 14, ...shadow },
  tileArt:       { width: '100%', aspectRatio: 1.25, borderRadius: 18, padding: 8, overflow: 'hidden' },
  tileImg:       { width: '100%', height: '100%' },
  tileTitle:     { fontSize: 14.5, fontFamily: 'Inter_700Bold', color: colors.textPrimary, marginTop: 10, paddingHorizontal: 4 },
  tileSub:       { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary, lineHeight: 16, marginTop: 3, paddingHorizontal: 4 },

  bar:           { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 24, paddingVertical: 14, paddingHorizontal: 16, marginTop: GAP, ...shadow },
  chat:          { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  barCopy:       { flex: 1 },
  barTitle:      { fontSize: 15, fontFamily: 'Inter_700Bold' },
  barSub:        { fontSize: 12.5, fontFamily: 'Inter_400Regular', lineHeight: 17, marginTop: 2, opacity: 0.88 },

  warn:          { marginTop: 18, backgroundColor: '#FFF8E8', borderWidth: 1, borderColor: '#F3E2B8', borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12 },
  warnText:      { fontSize: 11.5, fontFamily: 'Inter_400Regular', color: '#6B4E00', lineHeight: 16 },
  warnStrong:    { fontFamily: 'Inter_700Bold' },

  opening:       { marginTop: 14 },
  failText:      { marginTop: 10, fontSize: 12.5, fontFamily: 'Inter_400Regular', color: colors.danger, textAlign: 'center' },
})

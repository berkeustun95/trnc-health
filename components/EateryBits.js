import { useState } from 'react'
import { View, Text, FlatList, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../lib/supabase'
import { t } from '../constants/i18n'
import { colors, category, type, radii } from '../constants/theme'
import { EATERY_BUCKET } from '../constants/eatery'
import { RemoteImage } from './ui'

// Shared pieces of the two Yeme-İçme screens. Defined here, outside both screens, so a re-render
// of a screen never remounts them.

export const eateryImageUrl = path =>
  path ? supabase.storage.from(EATERY_BUCKET).getPublicUrl(path).data.publicUrl : null

// Marks anything built from the Preview fixture. Never shown for a real database row.
export function PlaceholderTag({ lang, style }) {
  return (
    <View style={[s.tag, style]}>
      <Ionicons name="construct-outline" size={12} color={colors.tileInk} />
      <Text style={s.tagText} numberOfLines={2}>{t('eateryPlaceholderTag', lang)}</Text>
    </View>
  )
}

// An ADA-theme frame standing in for a file that has not arrived: never a stock image.
export function PlaceholderFrame({ lang, icon = 'image-outline', style }) {
  return (
    <View style={[s.frame, style]}>
      <Ionicons name={icon} size={30} color={category.explore.ink} />
      <PlaceholderTag lang={lang} style={s.frameTag} />
    </View>
  )
}

// The partner's logo, contained (never cropped). No file: a labelled frame.
export function EateryLogo({ partner, width, height, lang, radius = radii.md }) {
  const uri = eateryImageUrl(partner.logo_path)
  return (
    <View style={[s.logo, { width, height, borderRadius: radius }]}>
      {uri
        ? <RemoteImage source={{ uri }} resizeMode="contain" style={s.fill} placeholderColor={colors.card}
            accessibilityIgnoresInvertColors accessibilityLabel={partner.name} />
        : <Ionicons name="restaurant-outline" size={Math.round(Math.min(width, height) * 0.5)} color={category.explore.ink} />}
    </View>
  )
}

// Swipeable pages with a dot indicator. path null renders a labelled frame.
// ratio = width / height of every page; fit 'cover' (gallery) or 'contain' (menu pages).
export function PhotoPager({ photos, width, ratio, fit, lang }) {
  const [page, setPage] = useState(0)
  const height = Math.round(width / ratio)
  return (
    <View>
      <View style={[s.pager, { width, height }]}>
        <FlatList
          horizontal
          pagingEnabled
          data={photos}
          keyExtractor={p => p.key}
          renderItem={({ item, index }) => {
            const uri = eateryImageUrl(item.path)
            return (
              <View style={{ width, height }}
                accessible accessibilityLabel={t('eateryPhotoCount', lang).replace('{n}', index + 1).replace('{total}', photos.length)}>
                {uri
                  ? <RemoteImage source={{ uri }} resizeMode={fit} style={s.fill}
                      placeholderColor={colors.card} accessibilityIgnoresInvertColors />
                  : <PlaceholderFrame lang={lang} style={s.fill} />}
              </View>
            )
          }}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          initialNumToRender={2}
          windowSize={3}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={e => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
        />
      </View>
      {photos.length > 1 && (
        <View style={s.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {photos.map((p, i) => <View key={p.key} style={[s.dot, i === page && s.dotOn]} />)}
        </View>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  tag:      { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, backgroundColor: colors.accentLight,
              borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  tagText:  { ...type.caption, color: colors.tileInk, flexShrink: 1 },
  frame:    { alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: category.explore.bg, padding: 12 },
  frameTag: { alignSelf: 'center' },
  logo:     { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, overflow: 'hidden' },
  fill:     { width: '100%', height: '100%' },
  pager:    { borderRadius: radii.card, overflow: 'hidden', backgroundColor: colors.card },
  dots:     { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 },
  dot:      { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.fieldBorder, opacity: 0.45 },
  dotOn:    { width: 18, backgroundColor: colors.primary, opacity: 1 },
})

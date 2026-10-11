import { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../../lib/supabase'
import { t, tCount } from '../../../constants/i18n'
import { press } from '../../../constants/theme'
import { closingSoonRange } from '../../../constants/duyurular'

// ─── Home: Duyurular banner (Berke 2026-10-11) ──────────────────────────────
// Full width, under the Nöbetçi Eczaneler + Acil Numaralar row. Shown only while DUYURULAR is
// on (HomeScreen decides): production users see nothing until the flag flips. The pill counts
// published, open items whose deadline falls in the next 7 TRNC days (RLS already limits the
// read to published, unexpired rows) and hides at 0 — and on a failed read, rather than
// showing a number it does not have.

const TEAL = '#0B4544'
const TEAL_LIGHT = '#A9D8D3'
const PEACH = '#FDE9DA'
const PEACH_INK = '#9A3A08'

export default function DuyurularBanner({ lang, onPress }) {
  const [closing, setClosing] = useState(0)

  useEffect(() => {
    let alive = true
    const { from, to } = closingSoonRange()
    supabase.from('announcements').select('id', { count: 'exact', head: true })
      .eq('kind', 'open').gte('deadline_at', from).lte('deadline_at', to)
      .then(({ count, error }) => { if (alive && !error) setClosing(count || 0) })
    return () => { alive = false }
  }, [])

  const pill = closing > 0 ? tCount('duyBannerSoon', closing, lang) : null
  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={press.card} accessibilityRole="button"
      accessibilityLabel={[t('menuDuyurular', lang), t('duyBannerSub', lang), pill].filter(Boolean).join(', ')}>
      <View style={s.icon}>
        <Ionicons name="megaphone-outline" size={24} color="#FFFFFF" />
      </View>
      <View style={s.text}>
        <Text style={s.title} numberOfLines={1}>{t('menuDuyurular', lang)}</Text>
        <Text style={s.sub} numberOfLines={2}>{t('duyBannerSub', lang)}</Text>
        {!!pill && (
          <View style={s.pill}>
            <Text style={s.pillText} numberOfLines={1}>{pill}</Text>
          </View>
        )}
      </View>
      <Ionicons name="chevron-forward" size={20} color={TEAL_LIGHT} />
    </TouchableOpacity>
  )
}

const s = StyleSheet.create({
  card:     { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: TEAL, borderRadius: 18,
              paddingHorizontal: 15, paddingVertical: 15 },
  icon:     { width: 48, height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.14)',
              alignItems: 'center', justifyContent: 'center' },
  text:     { flex: 1, gap: 2 },
  title:    { fontFamily: 'Inter_700Bold', fontSize: 16, lineHeight: 21, color: '#FFFFFF' },
  sub:      { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: TEAL_LIGHT },
  pill:     { alignSelf: 'flex-start', marginTop: 6, backgroundColor: PEACH, borderRadius: 999,
              paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontFamily: 'Inter_700Bold', fontSize: 12, lineHeight: 16, color: PEACH_INK },
})

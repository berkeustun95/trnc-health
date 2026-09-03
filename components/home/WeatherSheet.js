import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { colors, radius } from '../../constants/theme'
import { t } from '../../constants/i18n'
import { uvLevel, weatherIcon, weatherDesc } from '../../utils/facilityUtils'

// Everything the V1 weather card showed when expanded, moved behind the hero's
// temperature pill.
//
// ─── WHY THIS EXISTS AT ALL ─────────────────────────────────────────────────
// The V2 anatomy has no weather row. Left at that, the redesign would silently drop the
// UV index, the sunscreen warning and the four-day forecast — a real loss on an island
// where the summer UV index reaches 11, dressed up as a layout decision. So the hero
// shows the one number people glance at and this carries the rest. Nothing from the old
// card is gone; it moved one tap away.
//
// The 4-day slice, the UV thresholds and the icon/description mapping are the SAME
// helpers the old card used (utils/facilityUtils.js) — this is a re-housing, not a
// reimplementation, so there is no second copy of the UV bands to drift.
export default function WeatherSheet({ visible, weatherData, lang, locale, onClose }) {
  const cur = weatherData?.current
  const daily = weatherData?.daily
  const uv = cur ? uvLevel(cur.uv_index) : null
  const days = (daily?.time ?? []).slice(0, 4)

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose}>
        <View style={s.sheet} onStartShouldSetResponder={() => true}>
          <View style={s.header}>
            <Text style={s.title}>{t('homeWeatherTitle', lang)}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* No `cur` is a normal state, not an error: App.js swallows a failed
              open-meteo fetch and leaves weatherData null. The hero hides its
              temperature pill in that case, so this sheet is unreachable — but it
              renders a truthful empty rather than crashing if it is ever opened
              another way. */}
          {!cur ? (
            <Text style={s.empty}>{t('noResultsTitle', lang)}</Text>
          ) : (
            <>
              <View style={s.nowRow}>
                <Text style={s.nowEmoji}>{weatherIcon(cur.weather_code)}</Text>
                <Text style={s.nowTemp}>{Math.round(cur.temperature_2m)}°C</Text>
                <Text style={s.nowDesc} numberOfLines={1}>{weatherDesc(cur.weather_code)}</Text>
                <View style={{ flex: 1 }} />
                {uv && (
                  <View style={[s.uvBadge, { backgroundColor: uv.color }]}>
                    <Text style={s.uvBadgeText}>UV {Math.round(cur.uv_index)}</Text>
                  </View>
                )}
              </View>

              <View style={s.stats}>
                <Text style={s.stat}>💧 {cur.relative_humidity_2m}%</Text>
                <Text style={s.stat}>💨 {Math.round(cur.wind_speed_10m)} km/h</Text>
                <Text style={s.stat}>{t('feelsLike', lang)} {Math.round(cur.apparent_temperature)}°C</Text>
                {uv && <Text style={s.stat}>{t(uv.key, lang)}</Text>}
              </View>

              {uv?.warn && <Text style={s.warn}>🧴 {t('uvSunscreen', lang)}</Text>}

              {days.length > 0 && (
                <View style={s.forecast}>
                  {days.map((date, i) => {
                    const label = i === 0
                      ? t('todayLabel', lang)
                      : new Date(date + 'T12:00:00').toLocaleDateString(locale, { weekday: 'short' })
                    return (
                      <View key={date} style={s.day}>
                        <Text style={s.dayLabel}>{label}</Text>
                        <Text style={s.dayIcon}>{weatherIcon(daily.weather_code[i])}</Text>
                        <Text style={s.dayMax}>{Math.round(daily.temperature_2m_max[i])}°</Text>
                        <Text style={s.dayMin}>{Math.round(daily.temperature_2m_min[i])}°</Text>
                      </View>
                    )
                  })}
                </View>
              )}
            </>
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:      { backgroundColor: colors.cardBg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 20, paddingBottom: 34 },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title:      { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  empty:      { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textSecondary, textAlign: 'center', paddingVertical: 24 },
  nowRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nowEmoji:   { fontSize: 26 },
  nowTemp:    { fontSize: 22, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  nowDesc:    { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, flexShrink: 1 },
  uvBadge:    { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  uvBadgeText:{ fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },
  stats:      { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingTop: 14, marginTop: 14, borderTopWidth: 1, borderTopColor: colors.border },
  stat:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  warn:       { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, paddingTop: 10 },
  forecast:   { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 14, marginTop: 14, borderTopWidth: 1, borderTopColor: colors.border },
  day:        { flex: 1, alignItems: 'center', gap: 4 },
  dayLabel:   { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.textSecondary },
  dayIcon:    { fontSize: 18 },
  dayMax:     { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  dayMin:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
})

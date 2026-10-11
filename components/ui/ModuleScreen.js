import { View, Image, Text, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { type, radii } from '../../constants/theme'
import { OnPhotoContext } from './onPhoto'

// Module backgrounds, option B (Berke, 2026-10-01, for ALL modules): the module's own photo
// full-screen behind the content under a light dark tint, white cards at CARD_ALPHA, and white
// text wherever text sits straight on the photo — backed either by the HEADER scrim (the band
// under the status bar + the screen header) or by a dark pill (OnPhotoLabel, SectionHeader).
// check-hero-contrast bounds every one over a PURE WHITE photo pixel, so no photo can fail it:
//   header text  white over (1 − MODULE_TINT)·(1 − HEADER_SCRIM)
//   pill text    white over (1 − MODULE_TINT)·(1 − PILL_ALPHA)
//   card text    textPrimary / textSecondary over CARD_ALPHA white
export const MODULE_TINT = 0.25
export const HEADER_SCRIM = 0.5
export const HEADER_BAND = 60      // pt below the status bar: the screen header
export const SCRIM_FADE = 20      // short: the photo's upper part shows right below the header, as in the live app
export const PILL_ALPHA = 0.55
export const CARD_ALPHA = 0.93
export const CARD_BG = `rgba(255,255,255,${CARD_ALPHA})`
const DARK_FADE = require('../../assets/oli-scenes/dark-fade.png')   // black 0.6 → 0

// Each module's own photo (the legacy PageBackground set). Garages and towing have none of their
// own and take the road photo; grooming takes the pets photo.
export const MODULE_PHOTO = {
  medical:        require('../../assets/backgrounds/ada-bg-medical-facilities.jpg'),
  duty:           require('../../assets/backgrounds/ada-bg-duty-pharmacy.jpg'),
  events:         require('../../assets/backgrounds/ada-bg-events.jpg'),
  explore:        require('../../assets/backgrounds/ada-bg-beaches-landmarks.jpg'),
  accommodation:  require('../../assets/backgrounds/ada-bg-accommodation.jpg'),
  homeServices:   require('../../assets/backgrounds/ada-bg-home-services.jpg'),
  pets:           require('../../assets/backgrounds/ada-bg-pets.jpg'),
  newcomer:       require('../../assets/backgrounds/ada-bg-transportation.jpg'),
  exchange:       require('../../assets/backgrounds/ada-bg-exchange-rates.jpg'),
  transport:      require('../../assets/backgrounds/ada-bg-transportation.jpg'),
  towing:         require('../../assets/backgrounds/ada-bg-transportation.jpg'),
  garages:        require('../../assets/backgrounds/ada-bg-transportation.jpg'),
  grooming:       require('../../assets/backgrounds/ada-bg-pets.jpg'),
  // Wikimedia Commons, CC BY 4.0 (TorbeyCharbel, 2025): credited through the Duyurular header's
  // ℹ︎ button (DUY_PHOTO_CREDIT, constants/duyurular.js). Cropped to 1:2 around the Atatürk
  // monument and both flags (x 1200–2700 of 4000), resized to 1200×2400.
  duyurular:      require('../../assets/backgrounds/ada-bg-duyurular.jpg'),
  // PREVIEW-ONLY candidate B (Kyrenia Gate, Commons, ToprakM, CC BY 4.0), shown only through the
  // A/B chip (DUYURULAR_PHOTO_AB). Removed with the chip when Berke picks (2026-10-11).
  duyurularB:     require('../../assets/backgrounds/ada-bg-duyurular-b.jpg'),
}

// fullBleed: the photo from the very top, under the status bar — main's Sağlık facility list
// (HomeScreen) is the one PageBackground that sat OUTSIDE its SafeAreaView; every other module's
// started below the status bar.
export default function ModuleScreen({ topic, fullBleed = false, children, style }) {
  const insets = useSafeAreaInsets()
  const photo = MODULE_PHOTO[topic]
  return (
    <OnPhotoContext.Provider value={true}>
      <View style={[s.root, style]}>
        <StatusBar style="light" />
        {/* The live app's PageBackground, exactly: a frame from below the status bar (it sat in a
            top-edge SafeAreaView) to the bottom of the SCREEN — this root is the screen, never the
            list — and the photo filling it, cover, centred. width/height '100%' are REQUIRED: a
            require()d Image gets the asset's own size (704×1520) as its default width/height
            (RN Image.android.js / Image.ios.js), and absolute insets do not override it — that
            showed only the photo's top-left, enlarged (2026-10-01). */}
        {!!photo && (
          <View pointerEvents="none" style={[s.photoFrame, { top: fullBleed ? 0 : insets.top }]}>
            <Image source={photo} resizeMode="cover" style={s.photo} accessibilityIgnoresInvertColors />
          </View>
        )}
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${MODULE_TINT})` }]} />
        <View pointerEvents="none" style={[s.band, { top: 0, height: insets.top + HEADER_BAND, backgroundColor: `rgba(0,0,0,${HEADER_SCRIM})` }]} />
        <Image pointerEvents="none" source={DARK_FADE} resizeMode="stretch"
          style={[s.band, { top: insets.top + HEADER_BAND, height: SCRIM_FADE, opacity: HEADER_SCRIM / 0.6 }]} />
        {children}
      </View>
    </OnPhotoContext.Provider>
  )
}

// White text straight on the photo (a count, a date, a section label): on a dark pill.
export function OnPhotoLabel({ children, style, textStyle, numberOfLines = 1, accessibilityRole }) {
  return (
    <View style={[s.pill, style]}>
      <Text style={[s.pillText, textStyle]} numberOfLines={numberOfLines} accessibilityRole={accessibilityRole}>{children}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  root:     { flex: 1, backgroundColor: '#22313A' },
  band:     { position: 'absolute', left: 0, right: 0, width: '100%' },
  photoFrame: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  photo:    { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  pill:     { alignSelf: 'flex-start', backgroundColor: `rgba(0,0,0,${PILL_ALPHA})`, borderRadius: radii.pill,
              paddingHorizontal: 12, paddingVertical: 5 },
  pillText: { ...type.small, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },
})

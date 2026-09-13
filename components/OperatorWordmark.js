import { useState, useEffect } from 'react'
import { View, Text, Image, StyleSheet } from 'react-native'

// The operator's logo slot, with a text wordmark as the fallback.
//
// ⚠ IT SWITCHES BY ITSELF. connectivity_operators.logo_url is NULL today — KKTCELL's
//   vector logo has been requested but has not arrived — so this renders the operator's
//   NAME set as a wordmark. The moment somebody puts a URL in that column the Image takes
//   over, with no OTA and no code change. That is the whole reason this is a component and
//   not an `operator.logo_url ? ... : ...` ternary repeated on three screens.
//
// ⚠ AND IT FALLS BACK AGAIN IF THE IMAGE FAILS. A populated-but-broken logo_url (a typo, a
//   deleted asset, an expired signed URL) would otherwise render an invisible box on the
//   brand band — the partner's own screen with a hole where their logo goes, which is worse
//   than the wordmark it replaced. onError returns us to text.
//
// The wordmark colour is INJECTED (`onBrand`), never chosen here: the slot sits on
// brand_primary on the landing and on screen 2, and the caller is the one that has already
// computed a readable foreground for that background via readableOn().
export default function OperatorWordmark({ operator, onBrand, style }) {
  const [broken, setBroken] = useState(false)

  // A new logo_url deserves a fresh attempt — otherwise a URL corrected in SQL would stay
  // hidden behind a `broken` flag set for the PREVIOUS value until the app restarted.
  useEffect(() => { setBroken(false) }, [operator?.logo_url])

  const showImage = !!operator?.logo_url && !broken

  return (
    <View style={[s.slot, style]}>
      {showImage ? (
        <Image
          source={{ uri: operator.logo_url }}
          style={s.logo}
          resizeMode="contain"
          onError={() => setBroken(true)}
          accessibilityLabel={operator?.name ?? ''}
        />
      ) : (
        <Text
          style={[s.wordmark, { color: onBrand }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {operator?.name ?? ''}
        </Text>
      )}
    </View>
  )
}

const s = StyleSheet.create({
  // Fixed box so the band's height does not jump between the text and image states, and so
  // a tall logo cannot stretch the brand band.
  slot:     { width: 132, height: 34, flexShrink: 0, justifyContent: 'center' },
  logo:     { width: '100%', height: '100%' },
  wordmark: { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: 0.3 },
})

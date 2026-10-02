import { useState } from 'react'
import { Image as RNImage } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import { REDESIGN } from '../../constants/redesign'
import { colors } from '../../constants/theme'

// Remote images (posters, place/facility/partner photos, Home strip): expo-image — memory + disk
// cache, a soft placeholder colour while loading, a short fade-in.
// expo-image is NATIVE and was added after binaries carrying runtime 1.2.0 were built; its entry
// calls requireNativeModule('ExpoImage') at evaluation, which kills an older binary at launch. So
// it is require()d inside a function, and only when that binary has the module — otherwise (and
// on the legacy path) this is the plain RN Image with the same props (check-native-import-safety).
let ExpoImage
function loadExpoImage() {
  if (ExpoImage === undefined) {
    ExpoImage = REDESIGN && requireOptionalNativeModule('ExpoImage') ? require('expo-image').Image : null
  }
  return ExpoImage
}

const FIT = { cover: 'cover', contain: 'contain', stretch: 'fill', center: 'scale-down' }

export default function RemoteImage({ source, resizeMode = 'cover', style, placeholderColor = colors.soft, onLoad, ...rest }) {
  const [loadedUri, setLoadedUri] = useState(null)
  const Img = loadExpoImage()
  if (!Img) return <RNImage source={source} resizeMode={resizeMode} style={style} onLoad={onLoad} {...rest} />
  const uri = typeof source === 'object' ? source?.uri : undefined
  const loaded = loadedUri === (uri ?? source)   // per URI: a recycled list cell shows the placeholder again
  return (
    <Img
      source={source}
      contentFit={FIT[resizeMode] ?? 'cover'}
      transition={200}
      cachePolicy="memory-disk"
      recyclingKey={uri}
      style={[style, !loaded && { backgroundColor: placeholderColor }]}
      onLoad={e => { setLoadedUri(uri ?? source); onLoad?.(e) }}
      {...rest}
    />
  )
}

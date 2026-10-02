import Constants from 'expo-constants'
import { REDESIGN_LIVE } from './flags'

// The one switch every redesigned surface reads. On when:
//   • REDESIGN_LIVE is flipped (go-live, both files in one commit — the flag guard), or
//   • the bundle is a dev bundle (__DEV__: Expo Go on the redesign branch), or
//   • the binary is ADA Preview: app.config.js sets extra.appVariant = 'preview' ONLY when
//     APP_VARIANT=preview, so the production config carries no such key and a production
//     build or `npm run ota` can never switch this on by itself.
// Kept out of flags.js because node scripts import flags.js, and they cannot load expo-constants.
const IS_PREVIEW_BUILD = Constants.expoConfig?.extra?.appVariant === 'preview'

export const REDESIGN = REDESIGN_LIVE || (typeof __DEV__ !== 'undefined' && __DEV__) || IS_PREVIEW_BUILD

import { Text } from 'react-native'
import { t } from '../constants/i18n'

// One i18n template, two tappable document names.
//
// ⚠ THE LINKS ARE SEPARATE Text NODES SPLIT ON THE PLACEHOLDERS, NEVER POSITIONED. An
//   Arabic or Persian line reorders visually, so anything that assumed a left-to-right
//   offset — a prefix/suffix concat, an index into the string — would put the touch
//   target on the wrong phrase. Splitting on {terms} / {privacy} makes the target travel
//   with the word wherever the bidi algorithm puts it, in any of the nine locales.
//
// This was inlined at three call sites before it became a component: the signup notice,
// the signup checkbox and the wizard footer. Three copies of a bidi-critical split is how
// one of them eventually gets "simplified" into something that works in every language
// whoever simplified it happened to test.
//
// The link TEXT comes from the same keys the LegalScreen tab labels use, so the phrase a
// user taps and the title they land on cannot drift apart.
export default function LegalLinkedText({ templateKey, lang, style, linkStyle, onOpen }) {
  return (
    <Text style={style}>
      {t(templateKey, lang).split(/(\{terms\}|\{privacy\})/).map((part, i) => {
        if (part !== '{terms}' && part !== '{privacy}') return part
        const kind = part === '{terms}' ? 'terms' : 'privacy'
        return (
          <Text key={i} style={linkStyle} onPress={() => onOpen(kind)}>
            {t(kind === 'terms' ? 'termsOfService' : 'privacyPolicy', lang)}
          </Text>
        )
      })}
    </Text>
  )
}

import glyphs from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json'
import { SHORTCUTS, widgetText } from '../shortcuts'

// 2×2 Home V2 tiles: white card, category well, Inter Medium label (theme.js tileInk).
// Fonts are copied in by the react-native-android-widget plugin (app.config.js), named by file.
// require() inside the components: the package is native and only ever reached from the
// headless widget task (scripts/check-native-import-safety.mjs).
function Tile({ item, code }) {
  const { FlexWidget, IconWidget, TextWidget } = require('react-native-android-widget')
  const label = widgetText(code, item.labelKey)
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: item.url }}
      accessibilityLabel={label}
      style={{ flex: 1, height: 'match_parent', alignItems: 'center', justifyContent: 'center' }}
    >
      <FlexWidget style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: item.bg, alignItems: 'center', justifyContent: 'center' }}>
        <IconWidget font="Ionicons" icon={String.fromCharCode(glyphs[item.ionicon])} size={22} style={{ color: item.ink }} />
      </FlexWidget>
      <TextWidget
        text={label}
        maxLines={1}
        truncate="END"
        style={{ marginTop: 4, fontSize: 11, fontFamily: 'Inter_500Medium', color: '#3F4E57' }}
      />
    </FlexWidget>
  )
}

export function ShortcutsWidget({ code }) {
  const { FlexWidget } = require('react-native-android-widget')
  const [a, b, c, d] = SHORTCUTS
  return (
    <FlexWidget style={{ height: 'match_parent', width: 'match_parent', backgroundColor: '#FFFFFF', borderRadius: 24, padding: 8 }}>
      <FlexWidget style={{ flex: 1, width: 'match_parent', flexDirection: 'row' }}>
        <Tile item={a} code={code} />
        <Tile item={b} code={code} />
      </FlexWidget>
      <FlexWidget style={{ flex: 1, width: 'match_parent', flexDirection: 'row' }}>
        <Tile item={c} code={code} />
        <Tile item={d} code={code} />
      </FlexWidget>
    </FlexWidget>
  )
}

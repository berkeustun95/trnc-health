import glyphs from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json'
import { SHORTCUTS, widgetText } from '../shortcuts'

// Home V2 tiles: white card, category well, Inter Medium label (theme.js tileInk).
// Fonts are copied in by the react-native-android-widget plugin (app.config.js), named by file.
// require() inside the components: the package is native and only ever reached from the
// headless widget task (scripts/check-native-import-safety.mjs).

const PAD = 8
const ROW_GAP = 10
const LABEL = 18   // 4 dp gap + one line of 11 sp Inter
const LABEL_COL = 56   // narrower and "Yeme & İçme" is a few letters and an ellipsis

// One row of four (the 4×1 default, like iOS) unless the widget is narrow AND tall enough for two
// rows — then 2×2. Wells shrink before they overflow; labels go before the wells do. Tiles keep a
// fixed rhythm and the group is centred, so a tall cell no longer pushes the rows apart.
export function shortcutsLayout(width = 250, height = 110) {
  const cols = width >= 240 || height < 2 * 44 + ROW_GAP + 2 * PAD ? 4 : 2
  const rows = 4 / cols
  const well = Math.min(44, Math.floor((width - 2 * PAD) / cols) - 8)
  const labels = (width - 2 * PAD) / cols >= LABEL_COL
    && height - 2 * PAD >= rows * (well + LABEL) + (rows - 1) * ROW_GAP
  return { cols, rows, well, labels }
}

function Tile({ item, code, well, labels }) {
  const { FlexWidget, IconWidget, TextWidget } = require('react-native-android-widget')
  const label = widgetText(code, item.labelKey)
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: item.url }}
      accessibilityLabel={label}
      style={{ flex: 1, alignItems: 'center' }}
    >
      <FlexWidget style={{ width: well, height: well, borderRadius: Math.round(well * 0.32), backgroundColor: item.bg, alignItems: 'center', justifyContent: 'center' }}>
        <IconWidget font="Ionicons" icon={String.fromCharCode(glyphs[item.ionicon])} size={Math.round(well / 2)} style={{ color: item.ink }} />
      </FlexWidget>
      {labels && (
        <TextWidget
          text={label}
          maxLines={1}
          truncate="END"
          style={{ marginTop: 4, fontSize: 11, fontFamily: 'Inter_500Medium', color: '#3F4E57' }}
        />
      )}
    </FlexWidget>
  )
}

export function ShortcutsWidget({ code, width, height }) {
  const { FlexWidget } = require('react-native-android-widget')
  const { cols, well, labels } = shortcutsLayout(width, height)
  const rows = cols === 4 ? [SHORTCUTS] : [SHORTCUTS.slice(0, 2), SHORTCUTS.slice(2)]
  return (
    <FlexWidget style={{ height: 'match_parent', width: 'match_parent', backgroundColor: '#FFFFFF', borderRadius: 24, padding: PAD, justifyContent: 'center' }}>
      {rows.map((row, i) => (
        <FlexWidget key={i} style={{ width: 'match_parent', flexDirection: 'row', marginTop: i ? ROW_GAP : 0 }}>
          {row.map(item => <Tile key={item.key} item={item} code={code} well={well} labels={labels} />)}
        </FlexWidget>
      ))}
    </FlexWidget>
  )
}

import { buildWidgetTree } from 'react-native-android-widget/lib/commonjs/api/build-widget-tree'
import { ShortcutsWidget } from '../widgets/android/ShortcutsWidget'
import { SHORTCUTS, widgetText } from '../widgets/shortcuts'
import { parseAdaRoute } from '../utils/deepLinkRoutes'
import strings from '../widgets/strings.json'

const collect = (node, out = []) => {
  if (node && typeof node === 'object') {
    out.push(node)
    for (const c of node.children ?? []) collect(c, out)
  }
  return out
}

describe('Kısayollar (Android)', () => {
  test.each(Object.keys(strings))('%s renders four tappable tiles', code => {
    const nodes = collect(buildWidgetTree(<ShortcutsWidget code={code} />))
    const taps = nodes.filter(n => n.props?.clickAction === 'OPEN_URI')
    expect(taps.map(n => n.props.clickActionData.uri)).toEqual(SHORTCUTS.map(s => s.url))
    const texts = nodes.filter(n => n.type === 'TextWidget').map(n => n.props.text)
    expect(texts).toEqual(SHORTCUTS.map(s => strings[code][s.labelKey]))
    // Every glyph resolved: an unknown Ionicons name would render as an empty box.
    nodes.filter(n => n.type === 'IconWidget').forEach(n => expect(n.props.icon).toMatch(/^[-]$/))
  })

  test('every shortcut is a route the app opens', () => {
    for (const s of SHORTCUTS) expect(parseAdaRoute(s.url)?.route).toBe(s.key)
  })

  test('unknown language falls back to English', () => {
    expect(widgetText('xx', 'scDuty')).toBe(strings.en.scDuty)
  })
})

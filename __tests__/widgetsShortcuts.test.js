import { buildWidgetTree } from 'react-native-android-widget/lib/commonjs/api/build-widget-tree'
import { ShortcutsWidget, shortcutsLayout } from '../widgets/android/ShortcutsWidget'
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

  // Sizes in dp as Samsung One UI reports them on the S20+ (2×2 measured 169×242), plus the
  // 70n−30 grid the picker uses on stock launchers.
  const rowsOf = tree => tree.children.length
  test.each([
    ['4×1 default', 250, 110, 1, true],
    ['4×1 stock', 250, 40, 1, false],
    ['2×2', 169, 242, 2, true],
    ['2×1', 169, 110, 1, false],
    ['3×2', 250, 242, 1, true],
  ])('%s → %d row(s), labels %s', (_, width, height, rows, labels) => {
    const tree = buildWidgetTree(<ShortcutsWidget code="tr" width={width} height={height} />)
    expect(rowsOf(tree)).toBe(rows)
    const nodes = collect(tree)
    expect(nodes.filter(n => n.props?.clickAction === 'OPEN_URI')).toHaveLength(4)
    expect(nodes.some(n => n.type === 'TextWidget')).toBe(labels)
  })

  test('wells never overflow their column', () => {
    for (let width = 110; width <= 400; width += 10) {
      for (let height = 40; height <= 300; height += 10) {
        const { cols, well } = shortcutsLayout(width, height)
        expect(cols * (well + 8)).toBeLessThanOrEqual(width - 16)
      }
    }
  })

  test('every shortcut is a route the app opens', () => {
    for (const s of SHORTCUTS) expect(parseAdaRoute(s.url)?.route).toBe(s.key)
  })

  test('unknown language falls back to English', () => {
    expect(widgetText('xx', 'scDuty')).toBe(strings.en.scDuty)
  })
})

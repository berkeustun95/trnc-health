// Android widget picker: label + description in the PHONE's language (values-<lang>/strings.xml),
// from widgets/strings.json. English is the default `values/` copy. react-native-android-widget
// writes the default description itself (widget_<name>_description) and points android:label at
// app.config.js's '@string/widget_<name>_label', which this plugin defines.
const { withFinalizedMod, withStringsXml, AndroidConfig, XML } = require('expo/config-plugins')
const fs = require('fs')
const path = require('path')
const strings = require('../widgets/strings.json')

const WIDGETS = [{ name: 'shortcuts', label: 'shortcutsName', description: 'shortcutsDesc', minResize: ['110dp', '40dp'] }]

const escape = text => text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"')

async function writeStrings(file, items) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let xml = fs.existsSync(file) ? await XML.readXMLAsync({ path: file }) : { resources: {} }
  const entries = []
  for (const w of WIDGETS) {
    entries.push({ $: { name: `widget_${w.name}_label` }, _: escape(items[w.label]) })
    entries.push({ $: { name: `widget_${w.name}_description` }, _: escape(items[w.description]) })
  }
  xml = AndroidConfig.Strings.setStringItem(entries, xml)
  await XML.writeXMLAsync({ path: file, xml })
}

module.exports = function withWidgetStrings(config) {
  // Default `values/`: English label through the strings mod (react-native-android-widget writes
  // the default description there the same way); a raw file write would race that mod.
  config = withStringsXml(config, cfg => {
    cfg.modResults = AndroidConfig.Strings.setStringItem(
      WIDGETS.map(w => ({ $: { name: `widget_${w.name}_label` }, _: escape(strings.en[w.label]) })), cfg.modResults)
    return cfg
  })
  // FINALIZED, i.e. after every strings mod: that plugin marks the default description
  // translatable="false", and a values-<lang> copy of such a string is lint's fatal
  // ExtraTranslation in a release build. So the attribute is dropped here, then the copies written.
  return withFinalizedMod(config, ['android', async cfg => {
    const res = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res')
    const base = path.join(res, 'values/strings.xml')
    const xml = await XML.readXMLAsync({ path: base })
    for (const item of xml.resources.string ?? []) {
      if (/^widget_.+_description$/.test(item.$.name)) delete item.$.translatable
    }
    await XML.writeXMLAsync({ path: base, xml })
    // The resize floor, which react-native-android-widget cannot express: without it minWidth (the
    // 4×1 default) is also the smallest size, and the 2×2 shape would be unreachable.
    for (const w of WIDGETS.filter(w => w.minResize)) {
      const file = path.join(res, `xml/widgetprovider_${w.name}.xml`)
      const [width, height] = w.minResize
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('<appwidget-provider ',
        `<appwidget-provider android:minResizeWidth="${width}" android:minResizeHeight="${height}" `))
    }
    for (const [code, items] of Object.entries(strings)) {
      if (code === 'en') continue
      // Android qualifiers: Persian is 'fa', Greek 'el' — the same codes as strings.json.
      await writeStrings(path.join(res, `values-${code}/strings.xml`), items)
    }
    return cfg
  }])
}

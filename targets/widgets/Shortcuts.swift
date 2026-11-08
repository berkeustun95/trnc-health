import SwiftUI
import WidgetKit

// Kısayollar: four live sections (widgets/shortcuts.js — keep the two lists in step).
// Medium only: a systemSmall widget has ONE tap target on iOS (Link needs medium+), and four
// separate shortcuts are the point. One row of four, like the Home V2 grid.
struct Shortcut {
  let url: String
  let labelKey: String
  let symbol: String
  let bg: UInt32
  let ink: UInt32
}

let shortcuts = [
  Shortcut(url: "ada://duty",   labelKey: "scDuty",   symbol: "cross.case",  bg: 0xFBEAEC, ink: 0xB83246),
  Shortcut(url: "ada://kesfet", labelKey: "scKesfet", symbol: "safari",      bg: 0xF1EAFB, ink: 0x6B3FB0),
  Shortcut(url: "ada://eatery", labelKey: "scEatery", symbol: "fork.knife",  bg: 0xF1EAFB, ink: 0x6B3FB0),
  Shortcut(url: "ada://emlak",  labelKey: "scEmlak",  symbol: "house",       bg: 0xFBF0E0, ink: 0x92560C),
]

struct LangEntry: TimelineEntry {
  let date: Date
  let lang: String
}

// No data, so no schedule: the app reloads the timeline when ADA's language changes.
struct LangProvider: TimelineProvider {
  func placeholder(in context: Context) -> LangEntry { LangEntry(date: .now, lang: widgetLang()) }
  func getSnapshot(in context: Context, completion: @escaping (LangEntry) -> Void) {
    completion(LangEntry(date: .now, lang: widgetLang()))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<LangEntry>) -> Void) {
    completion(Timeline(entries: [LangEntry(date: .now, lang: widgetLang())], policy: .never))
  }
}

struct ShortcutsView: View {
  let entry: LangEntry

  var body: some View {
    HStack(spacing: 0) {
      ForEach(shortcuts, id: \.url) { item in
        Link(destination: URL(string: item.url)!) {
          VStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
              .fill(Color(hex: item.bg))
              .frame(width: 56, height: 56)
              .overlay(
                Image(systemName: item.symbol)
                  .font(.system(size: 24, weight: .regular))
                  .foregroundStyle(Color(hex: item.ink))
              )
            Text(wt(item.labelKey, entry.lang))
              .font(.system(size: 11, weight: .medium))
              .foregroundStyle(Color(hex: 0x3F4E57))
              .lineLimit(1)
              .minimumScaleFactor(0.8)
          }
          .frame(maxWidth: .infinity)
        }
        .accessibilityLabel(wt(item.labelKey, entry.lang))
      }
    }
    .containerBackground(for: .widget) { Color.white }
  }
}

struct ShortcutsWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "Shortcuts", provider: LangProvider()) { entry in
      ShortcutsView(entry: entry)
    }
    .configurationDisplayName(LocalizedStringKey("shortcutsName"))
    .description(LocalizedStringKey("shortcutsDesc"))
    .supportedFamilies([.systemMedium])
  }
}

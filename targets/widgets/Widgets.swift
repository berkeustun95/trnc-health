import SwiftUI
import WidgetKit

@main
struct ADAWidgets: WidgetBundle {
  var body: some Widget {
    ShortcutsWidget()
  }
}

// The App Group the app writes (utils/widgets.js): "group." + the app's bundle id, which is this
// extension's id without its last component (".widgets"). Derived, so ADA Preview reads its own.
let appGroup: String = {
  let parts = (Bundle.main.bundleIdentifier ?? "").split(separator: ".").dropLast()
  return "group." + parts.joined(separator: ".")
}()

// ADA's language (the app writes "lang" on every change). Before the app has written it: the
// phone's language if ADA has it, else English — the same codes as widgets/strings.json.
func widgetLang() -> String {
  if let code = UserDefaults(suiteName: appGroup)?.string(forKey: "lang"), widgetStrings[code] != nil {
    return code
  }
  let phone = Locale.preferredLanguages.first.map { String($0.prefix(2)) } ?? "en"
  return widgetStrings[phone] != nil ? phone : "en"
}

func wt(_ key: String, _ lang: String) -> String {
  widgetStrings[lang]?[key] ?? widgetStrings["en"]?[key] ?? key
}

extension Color {
  init(hex: UInt32) {
    self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
  }
}

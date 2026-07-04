import { Linking } from 'react-native'

// Single source of truth for the outbound ticket handoff.
// Slice 2 injects Gişe Kıbrıs commission / affiliate params HERE only.
// Currently uses Linking.openURL (OTA-safe). Upgrade to
// WebBrowser.openBrowserAsync once expo-web-browser ships in a native build.
export function buildTicketUrl(event) {
  return event?.ticket_url || null
}

export function openTicketUrl(event) {
  const url = buildTicketUrl(event)
  if (url) Linking.openURL(url)
}

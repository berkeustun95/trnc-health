// Döveç Construction (Döveç Group) — the partner's fixed contact + display rules.
//
// Projects and units are DATA (property_projects / properties, source 'dovec', synced by
// sync-dovec); this file holds only what is the same for every project: the sales line, how a
// contact tap is handed off and logged, and the status vocabulary the page renders.
//
// CONTACT: one sales line for Call and WhatsApp (Döveç, 2026-11). Every tap is logged per PROJECT as
// an anonymous contact event — module 'dovec', entity_id = property_projects.id — so the monthly
// per-project report to Döveç is `contact_events_monthly WHERE module = 'dovec'` (20261154). A count,
// never a person (utils/logContactEvent.js, rule two).
//
// LOGO: not delivered yet. The page shows the partner's NAME as text in ADA's frame until it is
// (partner-screen rule: their logo is their content; ADA does not draw a stand-in).

export const DOVEC = {
  name: 'Döveç Construction',
  group: 'Döveç Group',
  phone: '+905391050515',
  whatsapp: '905391050515',
}

// Fixture taps must never reach contact_events: a screenshot session would write rows into the
// production table and inflate the numbers reported to Döveç (constants/ehliyet.js precedent).
export const dovecLogsContacts = fromFixture => !fromFixture

export const dovecTelUrl = () => `tel:${DOVEC.phone}`

// The project name rides in the message so the sales team knows which site the lead is about.
export function dovecWhatsAppUrl(message) {
  return `https://wa.me/${DOVEC.whatsapp}?text=${encodeURIComponent(message)}`
}

// project_status (20261153 CHECK) -> label key + icon. Unknown values render nothing rather than a
// raw slug.
export const DOVEC_STATUS = {
  selling:            { labelKey: 'dovecStatusSelling',           icon: 'pricetag-outline' },
  under_construction: { labelKey: 'dovecStatusUnderConstruction', icon: 'construct-outline' },
  delivered:          { labelKey: 'dovecStatusDelivered',         icon: 'key-outline' },
}

// delivery_date is stored as a DATE but a quarter is what the partner publishes: a "2027-Q2" lands
// as 2027-04-01, so a day would be invented precision. Always rendered as a quarter.
export function dovecDeliveryQuarter(isoDate) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(isoDate || ''))
  if (!m) return null
  return `Q${Math.floor((Number(m[2]) - 1) / 3) + 1} ${m[1]}`
}

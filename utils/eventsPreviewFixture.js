// TEMPORARY — ADA Preview only, reverted in the next commit (Berke, 2026-11-01): no real event
// running since an earlier day existed to screenshot "Devam ediyor". Client-side on purpose: a
// DB seed would show to production users, who read the same database.
export function ongoingFixtureEvent(now = new Date()) {
  const start = new Date(now.getTime() - 2 * 24 * 3600 * 1000); start.setUTCHours(7, 0, 0, 0)   // 2 days ago, 09:00 Cyprus
  const end = new Date(now.getTime() + 3 * 24 * 3600 * 1000); end.setUTCHours(18, 0, 0, 0)      // in 3 days, 20:00 Cyprus
  return {
    id: 'preview-ongoing-fixture', title: 'ÖNİZLEME · Test festivali', description: null, images: [],
    source_image_url: null, start_date: start.toISOString(), end_date: end.toISOString(),
    location: 'Test, Lefkoşa', location_url: null, organizer_name: null, category: 'other', ticket_url: null,
    latitude: null, longitude: null, price_from: null, price_text: null,
  }
}

// Yeme-İçme placeholders — Crunchy Express in the DB row shape (eatery_partners + embedded
// eatery_menu_items / eatery_photos). Read ONLY through the guarded require in EateryScreen
// (scripts/check-eatery-partners.mjs rule (c)), and only while EATERY_PREVIEW_DATA is true and
// the database returned no row for the slug. Metro still bundles this file into production, so
// EVERY value here is obviously fake: no real phone, address, URL or price. The screens label
// anything built from it with eateryPlaceholderTag, and never log a contact tap for it.
// The real file (logo, photos, menu, hours, contacts) replaces all of it as data, not code.

const DAY = { open: '10:00', close: '23:00' }

export const EATERY_PREVIEW_PARTNERS = [
  {
    id: 'preview-crunchy-express',
    placeholder: true,
    slug: 'crunchy-express',
    name: 'Crunchy Express',
    category: 'fast_food',
    phone: '+90 000 000 00 00',
    whatsapp: '+90 000 000 00 00',
    website_url: 'https://example.com',
    menu_url: 'https://example.com/menu',
    maps_url: 'https://example.com/map',
    region: null,
    address: '0 Example Street, Example Town',
    lat: null,
    lng: null,
    opening_hours: { mon: DAY, tue: DAY, wed: DAY, thu: DAY, fri: DAY, sat: DAY, sun: DAY },
    logo_path: null,
    menu_verified_on: null,
    sort_order: 0,
    is_active: true,
    eatery_menu_items: [
      { id: -1, section: 'Sample section A', section_order: 0, name: 'Sample item 1', description: null, price: 100, currency: 'TRY', sort_order: 0, is_available: true },
      { id: -2, section: 'Sample section A', section_order: 0, name: 'Sample item 2', description: null, price: 150, currency: 'TRY', sort_order: 1, is_available: true },
      { id: -3, section: 'Sample section A', section_order: 0, name: 'Sample item 3', description: null, price: 200, currency: 'TRY', sort_order: 2, is_available: true },
      { id: -4, section: 'Sample section B', section_order: 1, name: 'Sample item 4', description: null, price: 50, currency: 'TRY', sort_order: 0, is_available: true },
      { id: -5, section: 'Sample section B', section_order: 1, name: 'Sample item 5', description: null, price: 75, currency: 'TRY', sort_order: 1, is_available: true },
      { id: -6, section: 'Sample section B', section_order: 1, name: 'Sample item 6', description: null, price: 120, currency: 'TRY', sort_order: 2, is_available: true },
    ],
    // storage_path null = no file yet: the screen draws a labelled ADA frame instead of an image.
    eatery_photos: [
      { id: -1, kind: 'gallery', storage_path: null, width: null, height: null, sort_order: 0 },
      { id: -2, kind: 'gallery', storage_path: null, width: null, height: null, sort_order: 1 },
      { id: -3, kind: 'gallery', storage_path: null, width: null, height: null, sort_order: 2 },
      { id: -4, kind: 'menu', storage_path: null, width: null, height: null, sort_order: 0 },
      { id: -5, kind: 'menu', storage_path: null, width: null, height: null, sort_order: 1 },
    ],
  },
]

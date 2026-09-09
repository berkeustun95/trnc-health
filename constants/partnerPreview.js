// ─── Dev-only partner preview fixture ───────────────────────────────────────
//
// ⚠ WHY A FIXTURE AND NOT A QUERY — the reason the first attempt could never work.
//
// PREVIEW_PENDING_PARTNERS originally just changed the client's WHERE clause from
// status='active' to status='pending'. It could not work, and not because of a bug: the
// SELECT policy on home_services is
//
//     USING (status = 'active' OR owner_id = auth.uid()
//            OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
//
// and the seeded partner row is status='pending' with owner_id NULL. It satisfies none of
// those arms for a customer or for anon. Measured against the live database with the
// repo's anon key: the pending query returned 0 rows, the active query returned 0 rows,
// and a query with NO status filter at all returned 0 rows — while a control asking for
// any active row returned 3. The client was asking the right question; RLS was refusing
// to answer it.
//
// The only role that CAN read a pending row is admin, and an admin never reaches this
// screen: App.js is role-first, so profile.role === 'admin' renders AdminScreen and
// short-circuits the whole module chain. There is no account that can both open Ev
// Hizmetleri and see a pending row. That is a structural fact, not a configuration one.
//
// So the preview stops asking the database. It supplies the row locally, and the
// components, the assets and the strings are all the real ones — only the source of the
// row differs. A preview that renders a different component proves nothing about the
// component that ships.
//
// ⚠ WHAT THIS DOES NOT DO, deliberately: it does not approve the seed row, and it does
//   not touch RLS. Approving would make the partner findable through global search
//   immediately — search_content gates on status='active' ALONE and has never heard of
//   MODULE_FLAGS — while the module is still dark for everyone else.

// ─── The fixture, and where every value comes from ──────────────────────────
//
// Mirrors the INSERT in supabase/migrations/20261011_seed_tadilart_cyprus.sql
// COLUMN FOR COLUMN. It is a second copy of that data, which is a real cost, so it is
// paid for by `npm run preview:check` — that script parses the migration and fails on any
// drift, field by field. Do not edit this object without running it.
//
// status stays 'pending' because that is what the row IS. The preview exists to show what
// the screen looks like BEFORE approval; a fixture claiming 'active' would be previewing
// a state the database is not in.
export const PREVIEW_PARTNER_ROWS = [
  {
    id:                 '0496fb4c-4e5d-4e35-a238-dd1fcb402541',
    owner_id:           null,
    name:               'TadilArt Cyprus',
    phone:              '+90 542 888 5505',
    whatsapp:           '+90 542 888 5505',
    contact_pref:       'both',
    district:           'nicosia',
    coverage_districts: ['nicosia', 'kyrenia'],
    service_types:      ['renovation', 'bathroom', 'kitchen', 'painter'],
    description:        null,
    status:             'pending',
    verified:           false,
  },
]

// The rows a category list would contain if the database could return them — the same two
// predicates the SQL applies, and nothing else. Kept to exactly those two so the mirror
// stays checkable by eye against loadProviders' query:
//   .contains('service_types', [category])  and  .contains('coverage_districts', [district])
// The status arm is not mirrored because these rows never travel any other path.
export function previewRowsMatching(category, district) {
  return PREVIEW_PARTNER_ROWS.filter(r =>
    (!category || (r.service_types || []).includes(category)) &&
    (!district || (r.coverage_districts || []).includes(district)))
}

// Prepends the matching fixture rows to a real result set, without duplicating a row the
// database already returned. The dedupe is not theoretical: the day the partner IS
// approved, the same id arrives from both sides, and two TadilArt cards in one list is a
// worse preview artefact than none.
export function withPreviewPartners(rows, category, district) {
  const fixture = previewRowsMatching(category, district)
  const have = new Set(rows.map(r => r.id))
  return [...fixture.filter(r => !have.has(r.id)), ...rows]
}

// ─── One honest caveat about "cannot ship" ──────────────────────────────────
//
// The BEHAVIOUR cannot ship: HomeServicesScreen reads the fixture only inside
// `__DEV__ && PREVIEW_PENDING_PARTNERS`, and a release transform folds that away —
// verified, the production output contains no reference to PREVIEW_PARTNER_ROWS or
// withPreviewPartners at all.
//
// The DATA still travels. The import statement survives the fold, so this module is
// still in the graph and its object literal is still bytes in the production bundle,
// read by nothing. Moving the require() inside the branch does not change that — Metro
// resolves require() statically and would include the module anyway.
//
// That is acceptable here and the reason is specific, not general: every value above is
// a firm's public trading information that renders publicly the day the row is approved.
// It would NOT be acceptable for a fixture containing anything private, and a future
// fixture that does must not follow this pattern.

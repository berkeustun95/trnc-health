# TRNC Health App — Spec

## What this is
A mobile health-access app for newcomers to North Cyprus (TRNC).
Customers find and reach trusted pharmacies, clinics, hospitals, and dentists.
Three user roles: customer, provider, admin.

---

## Phases completed

### Phase 1 + 2 — Core map & list
- Facility list sorted by Haversine distance from user location
- Open/closed badge parsed from `opening_hours`
- Duty pharmacy pinned at top via `duty_schedule` table
- Graceful degradation when location permission is denied

### Phase 3 — Admin, auth, push
- Auth screen (sign up / sign in via Supabase)
- Admin panel: dashboard, facilities CRUD, duty schedule, providers, users, bookings
- Push notification infrastructure (Expo push tokens stored on profile)
- EAS build setup

### Phase 4 — Search & map
- Search bar filtering by name/type
- Filter chips by facility type (pharmacy, clinic, hospital, dentist)
- Full map view via Google Maps (MapScreen)

### Phase 5 — Q&A
- Customers ask questions to a specific facility from the booking screen
- Providers reply per-facility in ProviderScreen
- Push notification sent to customer when answered

### Phase 6 — i18n
- 9 languages: English, Turkish, Arabic, Russian, Greek, French, Spanish, German, Farsi
- Instant language switching with native language names
- All UI strings go through `t(key, lang)` in `constants/i18n.js`

### Phase 7 — Supplement quiz
- Multi-step quiz flow for supplement recommendations
- AI-generated result stack
- Pharmacist picker: customer assigns result to a partner pharmacy
- Awaiting review screen with live status polling

### Phase 8 — Pharmacist review flow
- Pharmacist reviews quiz submission in ProviderScreen
- Approve/reject with final result stored on `quiz_submissions`
- Archived approved results visible to pharmacist
- Push notification to customer on approval
- FCM V1 integration for reliable delivery

### Phase 9 (in progress) — Security audit & duty list
- `duty_list` table: official TRNC duty pharmacy roster, multiple pharmacies per day by region
- DutyListScreen: regional SectionList, tap-to-call, shown via banner on home screen
- RLS audit: locked down `read questions` policy (was open to all authenticated users)
- Confirmed `provider read facility appointments` and `providers read customer push token` are correctly scoped

---

## Current screen inventory

| Screen | Role | Notes |
|---|---|---|
| AuthScreen | all | sign up / sign in |
| App.js (home) | customer | facility list + map, duty banner |
| MapScreen | customer | full map view |
| BookingScreen | customer | appointment + Q&A |
| ProfileScreen | customer | language picker, push token |
| ProviderScreen | provider | appointments, Q&A, quiz reviews |
| AdminScreen | admin | 6-tab management panel |
| DutyListScreen | customer | regional duty pharmacy directory |
| quiz/* | customer | 8-screen quiz + pharmacist assignment |

---

## Data model (key tables)

| Table | Purpose |
|---|---|
| `profiles` | id, role, preferred_language, push_token, full_name |
| `facilities` | name, type, address, lat/lng, opening_hours, provider_id, is_quiz_partner |
| `appointments` | customer_id, facility_id, requested_time, status |
| `questions` | customer_id, facility_id, body |
| `answers` | question_id, provider_id, body |
| `duty_schedule` | facility_id, date (one bookable facility per day) |
| `duty_list` | name, address, phone, region, duty_date, open_from, open_until |
| `quiz_submissions` | customer_id, assigned_facility_id, answers, generated_result, final_result, status |
| `pharmacist_scores` | facility scoring for quiz pharmacist picker |

---

## Phase 10 — Completed
- Ratings & reviews (reviews table, star picker in profile, avg on facility cards)
- Booking confirmation flow (My Bookings in profile, status badges, ref ID)
- Provider analytics (Stats tab in ProviderScreen)
- Admin user management (name + language shown in Users tab)
- Hardcoded string cleanup (BookingScreen Back/Ask/Done)
- Onboarding screen (language-first, 3 value points, AsyncStorage flag)

## Phase 11 — Completed
- AuthScreen fully i18n'd (login, signup, role picker, tagline)
- Push notifications in customer's language (appointment + quiz approval)

## Phase 12 candidates

### i18n completion
- **ProviderScreen i18n** — tabs (Requests, Q&A, Reviews, Archive, Stats), action buttons (Confirm, Decline), empty states all hardcoded English
- **Search bar placeholder** — "Search by name or address…" in App.js hardcoded

### Visual polish
- **Facility card redesign** — currently text-only; could add facility type icon, better hierarchy
- **Skeleton loading** — replace ActivityIndicator spinners with content-shaped skeletons
- **Empty states** — illustrated empty states for no results, no bookings, no questions
- **Map pin customisation** — pins on MapScreen are default; colour-code by type or duty status

### Features
- **Facility detail screen** — tap a facility to see full info (hours, languages spoken, photos) before booking
- **Appointment cancellation** — customers can cancel their own pending appointments
- **Review display on facility** — show individual reviews (not just avg) on the booking screen
- **Notification inbox** — in-app list of past notifications so customers don't miss confirmations

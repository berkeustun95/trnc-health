# ADA Architecture Notes

## NewcomerEssentialsScreen — CROSSINGS schema

`CROSSINGS` is a static JS array in `screens/NewcomerEssentialsScreen.js`. Each entry describes one Green Line border crossing.

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | ✓ | Unique key; used as React key |
| `north` | string | ✓ | TRNC/Turkish-side name (not i18n'd; use local official name) |
| `south` | string \| null | ✓ | RoC/Greek-side name, or `null` when no distinct south name |
| `region` | string | ✓ | Short geographic descriptor in English |
| `type` | `'pedestrian'` \| `'vehicle'` | ✓ | Controls badge colour and i18n label (`essBordersPedestrian` / `essBordersVehiclePed`) |
| `hours` | `'open24h'` \| `'limited'` | ✓ | Controls hours badge (`essBordersOpen24h` / `essBordersLimitedHours`) |
| `noteKey` | string | optional | i18n key for a per-crossing note rendered below the badge row. Use for crossings that need extra context (history, vehicle restrictions, caveats). Must exist in all 9 locales. |
| `lat` | number | optional | WGS-84 latitude. Direction button renders only when both `lat` and `lng` are present. |
| `lng` | number | optional | WGS-84 longitude. See `lat`. |

### noteKey convention
- Add the key adjacent to `essBordersOpen24h` / `essBordersPedestrian` in every language block of `constants/i18n.js`.
- Keep the note to 2–4 sentences. Use it for safety-critical info (access restrictions), brief history, or caveats not covered by the standard badges.
- Currently used by: `ledrapalace` → `essBordersLedrapalaceNote`

### Coordinate convention
- **Never guess or approximate coordinates** — wrong pin at a militarized crossing is worse than no button.
- Verify the pin lands on the actual gate/terminal, not the road approach or car park.
- Beyarmudu and Yeşilırmak: documented Google Maps labeling inaccuracy on the TRNC eastern/western crossings — take extra care when sourcing.
- Currently buttonless (no coords): `beyarmudu`, `yesilirmak`, `girne` (Yeni Liman unconfirmed).

## NewcomerEssentialsScreen — AIRPORTS / PORTS schema

`AIRPORTS` and `PORTS` are static JS arrays in `screens/NewcomerEssentialsScreen.js`, used by PortsCard.

### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | ✓ | Unique key; used as React key |
| `labelKey` | string | ✓ | i18n key for the entry's display text |
| `icon` | string | ✓ | Ionicons icon name |
| `iconColor` | string | ✓ | Icon colour (use `colors.*` token) |
| `lat` | number | optional | WGS-84 latitude. Direction button renders only when both present. |
| `lng` | number | optional | WGS-84 longitude. |

**Larnaca/Paphos** are kept as a combined informational `BulletRow` (`essPortsLarnacaNote`) — no data object, no button. They are secondary context ("fly via the south"), not primary TRNC entry points.

---

## Direction button — canonical location action

The **coordinate-based direction button** is the standard for all static location-bearing content in ADA. Two coexisting variants:

| Variant | Where | Deep link | Source |
|---------|-------|-----------|--------|
| Name/address query | Pharmacies (`DutyListScreen`), clinics (`FacilityProfileScreen`) | `https://maps.google.com/?q=${encodeURIComponent(name)}` | Live from Supabase |
| Coordinate directions | Border crossings, airports, seaports (`NewcomerEssentialsScreen`) | `https://www.google.com/maps/dir/?api=1&destination={lat},{lng}` | Static coords in JS data arrays |

The coordinate variant is preferred for TRNC-side locations where place-name labeling in Google Maps is unreliable. **Never use `?q=name` for border crossings** — it can resolve to the wrong pin.

### Shared UI elements (verbatim across both variants)
- i18n key: `getDirections` — present in all 9 locales
- Icon: `<Feather name="navigation" size={13} color={colors.primary} />`
- Styles: `directionsBtn` / `directionsBtnText` (inlined per screen, not a shared component)

---

## ContentCard component

`components/ContentCard.js` is the **de facto standard** for wrapping loose text content in NewcomerEssentials sub-cards. Use it whenever body text would otherwise sit directly on the `PageBackground` PNG motif wash.

### Usage

```jsx
import ContentCard from '../components/ContentCard'

<ContentCard style={{ marginTop: 8 }}>
  <Text style={s.someText}>…</Text>
</ContentCard>
```

### Props

| Prop | Type | Notes |
|------|------|-------|
| `children` | ReactNode | Content to render inside the card |
| `style` | ViewStyle | Optional override — typically used for `marginTop` only |

### Styling

| Token | Value |
|-------|-------|
| `backgroundColor` | `colors.surface` (`#FFFFFF`) |
| `borderRadius` | `radius.card` (16) |
| `padding` | 16 |
| shadow | `...shadow` token from `constants/theme.js` |

No `marginHorizontal` — each sub-screen's `cardContent` ScrollView already applies `paddingHorizontal: 16`. Do not add `marginHorizontal` to ContentCard itself.

### Card-in-card rule (non-negotiable)
Never wrap existing white-card elements inside a ContentCard:
- `crossingCard` (BordersCard crossing rows)
- `embassyBlock` (EmbassiesCard office blocks)
- `embassyCaveat` (EmbassiesCard footer)

These are already white-surface cards; nesting them would create a card-in-card visual.

### Current usage in NewcomerEssentialsScreen

| Sub-card | Scope | Notes |
|----------|-------|-------|
| DrivingCard | Full wrap | All bullet rows |
| CurrencyCard | Full wrap | Bullets + exchange rate link button |
| HolidaysCard | Full wrap | List + year-note row |
| PortsCard | Full wrap | All port bullet rows |
| BordersCard | Partial | `hoursNote` + insurance + documents; crossings and `LastReviewedTag` outside |
| EmbassiesCard | Partial | Only `essEmbOtherNote` body text; title, office blocks, caveat outside |

## Events module

Two coexisting event sources share one `events` table:
1. **Organizer-submitted** — users with `role: 'organizer'` post via `OrganizerScreen.js`, admin approves (`status`: draft → pending → approved → rejected). `organizer_id` set.
2. **Admin-curated Gişe Kıbrıs** (Slice 1) — flagship ticketed events seeded via SQL (`supabase/events_gisekibris_migration.sql`), `source = 'manual'`, `organizer_id` NULL, `status = 'approved'`. Funnels traffic to gisekibris.com; becomes the demo for the future commission partnership.

### Schema (extended columns)

| Column | Type | Notes |
|--------|------|-------|
| `category` | text | `concert` \| `festival` \| `nightlife` \| `other` (default). Legacy rows backfilled to `other` |
| `ticket_url` | text | gisekibris.com event URL — the Buy Ticket target |
| `latitude` / `longitude` | numeric | Coordinate-based Maps deep link (`destination={lat},{lng}`) — supersedes legacy `location_url` |
| `price_from` / `price_text` | numeric / text | `price_text` wins in UI; else `From ₺{price_from}` |
| `source` | text | `manual` (Slice 1) / `gisekibris_api` (Slice 2). Forward-compat |
| `external_id` | text | Partial-unique (non-null) — Slice 2 API upsert dedup |

`organizer_id` is now nullable (admin/API events have no organizer user). RLS unchanged: public reads approved+upcoming; only admins (or an event's own organizer) write.

### Screens & helpers

- `EventsScreen.js` — list (category chips All/Concerts/Festivals/Nightlife, client-side filter; `'other'` shows under All only) + `EventDetailScreen` (coord Maps link, price, Buy Ticket CTA).
- `utils/events.js` — `buildTicketUrl()` / `openTicketUrl()`. **Single injection point** for the outbound handoff. Currently `Linking.openURL` (OTA-safe); upgrade to `WebBrowser.openBrowserAsync` once `expo-web-browser` ships in a native build. Slice 2 commission params inject here only.
- Expiry: query filters `start_date >= now() - 1 day` (Job Postings pattern). Already registered in the `search_content` RPC and the home-hub `MODULES` tile.

### Slice 2 — Gişe Kıbrıs API sync (blocked on their API docs)

Automated API sync + commission/affiliate tracking, replacing manual SQL entry. `source` (`gisekibris_api`) and `external_id` (upsert dedup) already exist for this. Design decisions locked:

- **Ranking:** pure date sort (soonest first) across both lanes — no revenue bias. Current query already does this; no featured strip.
- **Overlap:** when the same event exists in both lanes, prefer the Gişe Kıbrıs (commissioned) row and hide the organizer duplicate. Match on title + date.
- **Source branding:** subtle "via Gişe Kıbrıs" badge on API-sourced cards + detail — co-brand for the partnership, trust cue on the Buy Ticket step.
- **Commission:** injected only in `utils/events.js` `openTicketUrl()`.
- **Extra fields (TBD — pending API schema):** likely price range + availability status; lineup optional. `featured` flag dropped for now (pure date sort has no featured strip to drive).

### Other pending

- **Follow-up slice**: add a category picker to `OrganizerScreen.js` so new organizer submissions are categorised instead of defaulting to `other`.
- Multi-language event *content* (title/description are admin data, not i18n keys) is a Slice 2+ question.

## Job Postings module

Free, self-post jobs board. Table `job_postings` (see `20260702_job_postings.sql`). Status enum: `pending → active → filled | expired`, plus `rejected`. `expires_at` is NULL until admin approval, then `now()+30d`.

### RLS model (post-lockdown, `20260705_job_postings_rls_lockdown.sql`)

- **SELECT (`jp_select`)**: anyone reads `active` + non-expired rows; a poster reads their own rows at any status; admin reads all.
- **INSERT (`jp_insert_self`)**: any authed user, `owner_id = auth.uid()`.
- **UPDATE (`jp_update_self`)**: row-level allows owner or admin; **column immutability is enforced by a `BEFORE UPDATE` trigger** (`jp_guard_owner_update`), not the policy.
- **DELETE (`jp_delete_admin`)**: admin only.

**RLS gotcha (the reason for the trigger):** an owner UPDATE policy that only checks the row (owner_id = auth.uid()) lets the owner rewrite *any column* — including `status` and `expires_at` — so an owner can self-approve (`status='active'`) and set their own expiry via a direct Supabase API call, bypassing moderation entirely. RLS policies **cannot** compare OLD vs NEW columns, and column GRANTs can't separate owner from admin (both are the `authenticated` role). The only clean fix is a `BEFORE UPDATE` trigger that:
  - short-circuits `RETURN NEW` for admins;
  - in **system context** (`auth.uid() IS NULL`, e.g. the auto-expire cron) allows **only** `active → expired`;
  - for owners, blocks changes to `owner_id`, `expires_at`, `rejection_reason`, and any status change **except** `active → filled` (the in-app "Mark Filled" flow, `JobPostingProfileScreen.js`).

Any future table with an owner-writable moderation column needs the same pattern — column-restrict `status`/`expires_at` in a trigger or moderation is bypassable via the API.

### Auto-expire (`20260705_job_postings_auto_expire.sql`)

`expire_job_postings()` (SECURITY DEFINER) flips `active → expired` where `expires_at < now()`, scheduled **hourly via pg_cron** (`cron.schedule('expire-job-postings', '0 * * * *', …)`). pg_cron is already used in this project (duty notifications). This **complements** the board's read filter (`status='active' AND expires_at > now()`) — it does not replace it; the public board was already correct, this just makes `status='expired'` real so the admin filter and any status-based tooling work.

### Global search

`search_content` RPC (`20260705_search_content_add_jobs.sql`) surfaces jobs as `module='jobPostings'`, filtered to `active` + non-expired (explicit filter, not just RLS, so an owner's own pending/filled rows never leak). `HomeScreen.js` routes that module to the jobs board (matches the events/transport "open the list" pattern, no deep-link).

## Ask Oli guide — global overlay mount

`components/OliGuide.js` is a floating mascot button + slide-up "Ask Oli" sheet that routes a user's question to an existing page. It is mounted **exactly once**, at the root return of `App.js`, above the `content` variable:

```jsx
return (
  <SafeAreaProvider>
    {content}
    {oliVisible && <OliGuide lang={lang} />}
  </SafeAreaProvider>
)
```

This is the canonical pattern for **any app-wide overlay** in ADA: mount at the root next to `content`, never per-screen. `content` is the app's whole navigation state machine (there is **no react-navigation** — navigation is `useState` booleans like `showEvents`, `showDutyList`, `activeTab`), so a single sibling render sits above every screen for free.

### `oliVisible` gate
Oli shows only in the **customer** app. It is hidden when:
- not signed in / onboarding / welcome / password-reset / loading (these paths never set a customer `profile`), and
- `profile.role` is `admin`, `provider`, `estate_agent`, `organizer`, or `home_service_provider` (their dashboards), and
- `showMenu` (side drawer — a `zIndex` View, not a Modal, so Oli would otherwise cover it) or `showCoachMarks` is open.

RN `Modal`s (emergency / language / municipal) render on the native layer **above** the root overlay, so they need no gate.

### Placement
`bottom: insets.bottom + 72` clears the `BottomTabBar` on the home tabs; full-screen sub-screens (no tab bar) get the same bottom-right corner at the safe-area edge — consistent across routes.

### Routing seam
Intent config lives in a **pure-data** module (`constants/oliIntents.js`): each intent is `{ id, keywords, msgKey }` where `id` is both the intent id and the navigation target. `App.js` owns the `oliNavigate(id)` dispatcher, which resets the open module sub-screens then sets the target's state flag (e.g. `pharmacy` → `setShowDutyList(true)`, `clinic` → `setActiveTab('home')`, `emergency` → `setShowEmergencyModal(true)`).

- `normalize(str)` — lowercase + NFD diacritic strip + Turkish `ı/İ/ş/ğ/ç/ö/ü` folding (dotless-ı doesn't decompose under NFD, so it's folded explicitly first). There was **no** pre-existing Turkish normalization util in the repo.
- `resolveOliQuery(text) → Intent[]` — the single resolver boundary; `[]` ⇒ the no-match fallback. Keyword matching is per-language: keywords ≤4 chars match whole words only (so short tokens like Turkish `iş`→`is` or German `geld` don't fire inside longer words across languages), 5+ char keywords allow prefix matching so Turkish suffixes (`eczaneye`, `doktora`, `otobüse`) still hit. Returns up to 3 intents.
- **LLM seam:** the future LLM fallback is invoked only where `resolveOliQuery()` returns `[]` — nothing else changes.

Chips carry an intent `id`; tapping one shows that intent's result card (Oli message + "Take me there") rather than navigating immediately, matching the typed-query flow. Chip labels reuse `oliChip*` i18n keys; result messages use `oliMsg*`.

## Asset gotcha — file extensions MUST match the actual image format

Android's `mergeReleaseResources` runs every bundled drawable through AAPT2, which PNG-crunches anything named `.png`. A file with a `.png` extension that is actually a **JPEG** fails to compile (`AAPT: error: file failed to compile`), and EAS surfaces it only as the generic "Gradle build failed with unknown error" — the real cause is buried in the `Run gradlew` log at `:app:mergeReleaseResources FAILED`.

This has bitten us **twice** on `assets/backgrounds/ada-bg-pets.png` (a JPEG saved with a `.png` name). It's a **coin-flip**: AAPT2 sometimes tolerates the mislabeled file (build passed) and sometimes rejects it (build failed) — identical bytes, identical toolchain. Fixed permanently by renaming to `ada-bg-pets.jpg` and updating the `require` in `PageBackground.js` (React Native / Metro / AAPT all handle `.jpg` fine).

**Rule:** every file under `assets/` must have an extension matching its real format. Before adding or replacing an image, verify with `file --mime-type <path>`. To audit the whole tree in one shot:

```bash
find assets -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' \) -print0 \
  | while IFS= read -r -d '' f; do
      ext=$(echo "${f##*.}" | tr 'A-Z' 'a-z'); mime=$(file -b --mime-type "$f")
      case "$mime/$ext" in
        image/png/png) ;;
        image/jpeg/jpg|image/jpeg/jpeg) ;;
        *) echo "MISMATCH: .$ext but $mime  <=  $f" ;;
      esac
    done
```

As of this note, `ada-bg-pets.jpg` is the only photographic-JPEG background; all other `ada-bg-*.png` files are genuine PNGs.

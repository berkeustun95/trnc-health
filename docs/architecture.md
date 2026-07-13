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

---

## Guest access — anonymous sessions, the account-required gate, and the write veto

Guests enter via **"Continue as guest"** on the entry screen (`WelcomeScreen`, shown after the onboarding carousel). Three durable patterns come out of this; treat them as conventions.

### 1. Guest = Supabase anonymous session (not a no-auth path)

`supabase.auth.signInAnonymously()` creates a **real `auth.users` row** and a real `auth.uid()`. An anonymous user is an **`authenticated`** user. This is the whole reason the model is cheap: every existing RLS policy keeps working untouched, and **nothing is ever granted to the `anon` role**.

Consequences, in both directions:

- **Reads:** a guest satisfies existing `TO authenticated` / `auth.uid()` read policies, so guests read everything by default. That's what we want.
- **Writes:** a guest *also* satisfies existing write policies (`auth.uid() = owner_id`). **This is the trap.** Without the veto below, a guest could insert job postings, reviews, questions and reports straight through the public API with the anon key. See §3.

**`is_anonymous` is the single source of truth.** Use `isGuest(session)` from `lib/supabase.js` (reads the `is_anonymous` JWT claim). **Never introduce a parallel local "is guest" flag** — the DB veto reads the same claim, so client and server agree by construction.

The `auth.users` trigger inserts `(id, role)` with a coalesce fallback to `'customer'`, so a guest gets a valid `profiles` row with no trigger change. This matters: App.js gates the whole render on `!profile` (skeleton), so a guest **without** a profiles row would hang forever.

### 2. Account-required gate

`App.requireAccount(messageKey)` + `components/AccountRequiredSheet.js` (mounted once, globally, next to `OliGuide`).

```js
if (requireAccount('gateJobPost')) return   // guest -> sheet opens, action aborts
setShowPostForm(true)                        // real user -> unchanged
```

`requireAccount` returns `true` **only** for guests, so signed-in behaviour is untouched at every site. `messageKey` is an i18n key so each site explains what signing up unlocks, rather than one generic string.

Wired at **9 sites**: post a job · home-service / transport / estate-agent onboarding · suggest a place · book an appointment · report/block content · profile tab · notifications. Screens receive it as an `onRequireAccount` prop.

**Gate the button that opens the form, not the submit at the end of it** — a guest should never fill a form and then be told no.

**Never gate a read.** Browsing is open, and so are **favourites** (AsyncStorage, device-local — guests keep them, and they survive the signup handoff).

**Sign-up from the gate discards the anon session and reuses the normal signup path.** Upgrade-in-place (identity linking) was evaluated and **deliberately rejected**: Supabase requires a two-step `updateUser({email})` → email-confirm → `updateUser({password})` flow, and it leaves the upgraded user **role-less** (the trigger reads `role` from metadata at `auth.users` insert, which a guest has none of), so an upgraded guest could never become a provider. It also carries nothing over that isn't already device-local.

### 3. Restrictive-policy write veto — the actual security boundary

`supabase/migrations/20260714_block_anonymous_writes.sql`. **The in-app gate is UI only. This migration is the boundary.**

Implemented as **`AS RESTRICTIVE`** policies, which Postgres **ANDs** with existing permissive policies rather than OR-ing. That means the veto is layered *on top* without reading, editing or dropping a single existing policy — correct by construction, additive, and trivially reversible (`DROP POLICY`; rollback block is in the file).

```sql
-- INSERT / UPDATE / DELETE only. No restrictive SELECT — guests must keep reading.
CREATE POLICY no_anon_insert_<t> ON public.<t> AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_anonymous_session());
```

`public.is_anonymous_session()` → `coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)` (absent claim ⇒ real user ⇒ `false`).

Covers **14 tables**. Real users, providers and admins are unaffected (`is_anonymous = false` ⇒ veto never fires).

**Rules going forward:**
- **Adding a user-writable table? Add it to this veto.** Otherwise guests can write to it.
- **Apply the veto BEFORE enabling the Anonymous provider**, or there is an exposure window.
- The Anonymous toggle lives at the *bottom* of Auth → Sign In/Providers (below the OAuth list) and has a **separate Save button that silently discards on navigate-away**. Ground truth is the API, not the dashboard UI:
  ```bash
  curl -s "$EXPO_PUBLIC_SUPABASE_URL/auth/v1/settings" \
    -H "apikey: $EXPO_PUBLIC_SUPABASE_ANON_KEY" | grep anonymous_users
  ```

### 4. Language before entry

The **entry screen carries a language pill** (native names — `Türkçe`, `العربية` — not 2-letter codes). This is load-bearing, not decoration: **the guest path never visits `AuthScreen`**, which after first launch was the only pre-hub language control (the carousel picker shows once). Without the pill, a returning newcomer in the wrong language had no way out of the first screen.

### Known follow-ups (deferred, both intentional)

- **Device-locale default — needs a native build.** The app **never reads device locale**; `expo-localization` is not a dependency. Default is a hardcoded `'English'` (`App.js` `pendingLang`, `OnboardingScreen` `lang`). `expo-localization` is a native module and **cannot ride an OTA**. The entry-screen language pill is the OTA-safe mitigation, not the fix.
- **`view_count` → `SECURITY DEFINER` RPC.** `PropertyDetailScreen` increments `properties.view_count` **from the client** — a write on a browse path. The veto now 403s it for guests, so guest views silently stop counting. The RPC fix also closes the fact that this counter is currently client-incrementable and therefore **spoofable by any authenticated user**. Schema change → not an OTA.
- **Abandoned-guest cleanup** is not built. Anonymous users accumulate in `auth.users`; treat as a monthly-maintenance job.

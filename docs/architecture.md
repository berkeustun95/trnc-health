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
2. **Gişe Kıbrıs feed import** — the partner's catalogue, imported idempotently by `scripts/import-gisekibris-events.mjs`, `source = 'gisekibris'`, `organizer_id` NULL, `status = 'approved'`. Funnels traffic to gisekibris.com; the demo for the future commission partnership. The original hand-seeded `source = 'manual'` rows (`supabase/events_gisekibris_migration.sql`) have since been deleted — verified 19 Aug 2026, `gisekibris` is the only non-null source in the table. See "Gişe Kıbrıs feed pipeline" below.

### Schema (extended columns)

| Column | Type | Notes |
|--------|------|-------|
| `category` | text | `music` \| `nightlife` \| `sports` \| `arts` \| `family` \| `other` (default). Set by the organizer on submit, editable by admin. See "Category taxonomy" below |
| `ticket_url` | text | Partner event page — the Buy Ticket target. NULL hides the button ([EventsScreen.js:470](../screens/EventsScreen.js#L470)) |
| `latitude` / `longitude` | numeric | Coordinate-based Maps deep link (`destination={lat},{lng}`) — supersedes legacy `location_url` |
| `price_from` / `price_text` | numeric / text | `price_text` wins in UI; else `From ₺{price_from}` |
| `source` | text | `manual` (legacy hand-seeded) / `gisekibris` (feed import) / NULL (organizer-submitted) |
| `external_id` | text | UNIQUE (`events_external_id_unique`, nulls unlimited). For `source='gisekibris'` this is `gk-` + **the partner's own event id** — see "Gişe Kıbrıs feed pipeline" |
| `description_i18n` | jsonb | `{tr, en}`, additive. Populated by the import; **not yet read by the UI** — `EventsScreen` still renders the legacy `description` text column |
| `source_image_url` | text | The partner's original Firebase URL (tokenised), kept so a mirrored image can be re-fetched |

`organizer_id` is now nullable (admin/API events have no organizer user). RLS unchanged: public reads approved+upcoming; only admins (or an event's own organizer) write.

### Gişe Kıbrıs feed pipeline

Weekly drop → three scripts, in order. Each refuses to run on bad input rather than
degrading silently.

```
raw feed (their export)
  └─ scripts/prepare-gisekibris-feed.mjs   pure transform, no network
       └─ supabase/seed/gisekibris-events-clean.json   (committed, tokens stripped)
            └─ scripts/check-gisekibris-urls.mjs --apply   probes every ticket_url
                 └─ scripts/import-gisekibris-events.mjs   upsert + image mirror
```

**Identity — `external_id` = `gk-` + the partner's own event id.** Their id appears in
two independent places and the prepare script cross-checks them on every row:
`.../etkinlikler/<slug>--<ID>` and `.../o/events-v2%2F<ID>%2Fbanner.png`. Ids are
**not fixed-width** (20-char Firestore, one 25-char cuid), so extraction splits on the
*last* `--` and assumes no length. A disagreement or a failed extraction is a hard
error — never a fallback.

Superseded (`20260831_events_external_id_remap.sql`): `gk-` + sha1(title|start_date)[:12].
A content hash re-hashes whenever the partner fixes a typo, silently orphaning the row
and inserting a duplicate. That migration is a pure data change creating no named
object, so `verify_schema.sql` carries an H-section token for it and the import script
aborts if it finds a synthetic key.

**Only the id half of a ticket URL routes** — a wrong slug still resolves 200 — so a
title edit on their side cannot break a stored `ticket_url`.

**Title whitespace is load-bearing.** 20 of 72 raw names carry doubled or trailing
spaces; the prepare script NFC-normalises and collapses internal runs. A byte-exact
matcher against the raw feed mismatches 10 rows.

**Storage paths** are `events/gisekibris/{external_id}.{ext}` in the `event-images`
bucket, writable only by service_role. They are not derived at read time — `images[0]`
holds the full public URL — so a path whose filename lags the current `external_id` is
cosmetic. `--remirror` re-keys them.

`ev_guard_write()` does **not** police `category` — an organizer may set and change it freely on their own rows. The CHECK constraint is the only validation.

### Category taxonomy

Six values, fixed by `events_category_check`: `music`, `nightlife`, `sports`, `arts`, `family`, `other` (default).

Retired in July 2026: `concert` and `festival`, both folded into `music`. The swap shipped as a **two-file migration straddling the OTA** — `20260724_events_category_widen.sql` (superset accepting old + new) before the update, `20260724_events_category_narrow.sql` (fold legacy values, narrow to the final six) after.

**The ordering rule, stated precisely, because the original write-up got it backwards:** the constraint must be widened *before* the OTA because the **new** bundle writes values the old constraint rejects. The reverse hazard does not exist — the pre-`6fd49d9` bundle had no category picker and never sent the column at all, so it could not violate a narrowed constraint. Narrowing late is a cosmetic courtesy to stale clients (they render unknown values as "Other"), not a correctness requirement.

`EventsScreen.js` keeps a `LEGACY_MUSIC` alias so the Music chip also matches `concert`/`festival` while any un-migrated rows remain. Dead once the narrow migration is applied; safe to delete.

**Data-entry rule for admin-curated rows:** `start_date` is `timestamptz`, so always write an explicit offset — `'2026-08-01 21:00+03'`, never a bare `'2026-08-01 21:00'`. A bare timestamp is read in the DB session zone (UTC), landing the event at 00:00 the *next* day on a TRNC phone. Cards display the start time, so this is user-visible.

### Screens & helpers

- `EventsScreen.js` — list + `EventDetailScreen` (coord Maps link, price, Buy Ticket CTA). Two stacked filter rows, both horizontal `ScrollView`s with a `marginHorizontal: -16` edge-bleed so the half-cut chip signals scrollability:
  - **Category** — All + the six categories.
  - **Date** — All / Today / This weekend / This week / This month / Pick a date.

  Category, date and district compose client-side over one fetch. Date windows anchor at **today 00:00**, not `now`, so an event already underway today still matches (consistent with the 24h expiry grace). "This weekend" is the *remainder* of the current weekend when it is already Sat/Sun — on a Sunday that is Sunday alone, never spilling into Monday. "This week" is Monday-start (TR convention), running to the upcoming Sunday, and is a strict superset of the weekend window.

  Cards show the start time (`21:00`, or `21:00 – 23:30` for same-day ends). **No all-day heuristic on `00:00`** — a midnight start is real for nightlife, and suppressing it would blank the time on exactly the events where it matters most. An accidental midnight comes from the data-entry rule above, and is fixed there.
- `OrganizerScreen.js` — submit/edit form. Category is a wrapped chip row (not a horizontal scroll — the form is already inside a vertical `ScrollView`) between Description and Start date. Four touchpoints to keep in sync when adding any field: `useState` init, the visible-reset block, the `fields` payload, **and the `load()` `.select()`** — omitting the last silently resets the value on every save.
- `AdminScreen.js` `EventsTab` — category on the moderation card sub-line, and an editable chip row in the review modal so a miscategorised submission can be fixed without raw SQL. English-only, like the rest of the admin UI.
- `utils/events.js` — `buildTicketUrl()` / `openTicketUrl()`. **Single injection point** for the outbound handoff. Currently `Linking.openURL` (OTA-safe); upgrade to `WebBrowser.openBrowserAsync` once `expo-web-browser` ships in a native build. Slice 2 commission params inject here only.
- Expiry: query filters `start_date >= now() - 1 day` (Job Postings pattern). Already registered in the `search_content` RPC and the home-hub `MODULES` tile.

**Date picker convention** (`@react-native-community/datetimepicker`, already in the native binary — importing it anywhere is OTA-safe). Two deliberately different shapes:
- **Datetime capture** (`OrganizerScreen`) — Android has no combined picker, so `DateTimePickerAndroid.open` is chained date → time and recomposed; iOS uses one inline `mode="datetime"` sheet.
- **Date-only filtering** (`EventsScreen`) — single step, `mode="date"`, no chain. Filtering to a day has no time component.

### Slice 2 — Gişe Kıbrıs API sync (blocked on their API docs)

Automated API sync + commission/affiliate tracking, replacing the weekly file drop. The
feed pipeline above already settled identity (`external_id` = partner id), category
mapping, and image mirroring, so Slice 2 is the transport layer only. Design decisions locked:

- **Ranking:** pure date sort (soonest first) across both lanes — no revenue bias. Current query already does this; no featured strip.
- **Overlap:** when the same event exists in both lanes, prefer the Gişe Kıbrıs (commissioned) row and hide the organizer duplicate. Match on title + date.
- **Source branding:** subtle "via Gişe Kıbrıs" badge on API-sourced cards + detail — co-brand for the partnership, trust cue on the Buy Ticket step.
- **Commission:** injected only in `utils/events.js` `openTicketUrl()`.
- **Extra fields (TBD — pending API schema):** likely price range + availability status; lineup optional. `featured` flag dropped for now (pure date sort has no featured strip to drive).
- **Category mapping — SETTLED, live in `scripts/prepare-gisekibris-feed.mjs`:** `Club & Lounge & Bar`/`Elektronik Müzik`/`Plaj Partisi → nightlife`, `Konser`/`Hotel Konseri → music`, `Sahne → arts`. An unmapped value is a hard error, deliberately *not* an `other` sink — a silent sink buries a whole new category under a chip nobody filters by.
- **⚠️ The sync job writes as service-role, so `auth.uid()` is NULL and `ev_guard_write()` returns early — it bypasses every trigger guard.** The CHECK constraint is the only thing validating an API-supplied category. Keep it strict, and validate in the sync job too.
- **Timestamps:** the API's times must be normalised to an explicit offset before insert, same rule as manual entry (`+03`). A naive timestamp from their feed lands at the wrong hour and possibly the wrong day.

### Other pending

- Multi-language event *content* (title/description are admin data, not i18n keys) is a Slice 2+ question.
- Date filtering is client-side over one unpaginated fetch. Fine at current volume; if the event count grows past a few hundred, move the date window into the Supabase query.

## Job Postings module

Self-post jobs board. Table `job_postings` (see `20260702_job_postings.sql`). Status enum: `pending → active → filled | expired`, plus `rejected`. `expires_at` is NULL until admin approval, then `now()+30d`.

Individuals post free; businesses pay (`poster_type`, see **Monetization** below). Payment is entirely **off-app** — bank transfer, manual admin activation. There is no payment SDK and no in-app purchase anywhere in the project.

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

### Monetization — Bucket A, business paid postings (`20260722_job_postings_business_paid_tier.sql`)

Four columns on `job_postings`:

| Column | Values | Written by |
|---|---|---|
| `poster_type` | `individual` (default) \| `business` | client, at insert only — immutable after |
| `payment_status` | `not_required` (default) \| `awaiting_payment` \| `paid` | **derived server-side**, then admin-only |
| `paid_at` | timestamptz | admin only |
| `payment_ref` | text — bank transfer reference | admin only, optional |

**Two axes, deliberately separate:** `status` is content moderation, `payment_status` is money. There is intentionally **no** "content approved but unpaid" state — admin reviews content at activation time, and reject stays available independent of payment as the safety valve.

**No RLS change was needed.** `jp_select` already requires `status='active' AND expires_at > now()` for public reads, so an unpaid business post is invisible to the public for free.

The monetization columns are **derived, not accepted**. Both guards from the RLS section above are extended:
  - `jp_guard_insert` overwrites `payment_status` from `poster_type` (`business → awaiting_payment`, else `not_required`) and nulls `paid_at`/`payment_ref`. A poster who sends `payment_status='paid'` has it silently discarded.
  - `jp_guard_owner_update` rejects owner writes to all four columns. Without it an owner could flip their own post to `paid` with one direct Supabase API call.

**Admin Activate/Renew path** (`AdminScreen.js`, `JobPostingsTab`): business posts do **not** use the free `Approve` button — that renders only for `poster_type='individual'`. They publish through `Activate`, which confirms the off-app transfer landed and sets `status='active'`, `payment_status='paid'`, `paid_at=now()`, optional `payment_ref`, and `expires_at=now()+30d` in one update. `Renew` is the same call on an already-active or expired post, extending from the current expiry when it is still in the future, else from now — same semantics as `extendSubscription()` for estate agents. An `Awaiting payment` filter chip lists what is owed.

**Free-period caveat:** `Activate` always writes `payment_status='paid'`, so there is no way in the admin UI to publish a business post without marking it paid. During a free launch, type a sentinel (e.g. `FREE-LAUNCH`) into the bank-reference box — otherwise the only way to tell comped rows from genuinely paid ones later is `paid_at` against the free-period cutoff date, and `payment_ref` is optional so a blank ref proves nothing.

### Anti-steering rule (iOS 3.1.1) — applies to every consumer screen

`payment_status` is a **backend/admin concept**. It must never be rendered in the consumer app, and no consumer screen may carry pricing, payment, bank-transfer, or "contact us to renew/pay" copy. Apple rejects apps that direct users to a purchase mechanism outside the app.

This is enforced **structurally, not by discipline**: `MyJobPostingsScreen.js` does not even select `payment_status`, so a business post awaiting payment has `status='pending'` and renders as "Under review" — identical to a post awaiting content review. Keep it that way; do not add the column to that query.

The same rule binds every other paid surface. `EstateAgentDashboardScreen.js` violated it until `d4939f6` — its expired-subscription banner read "Contact admin to renew" — and now states listing visibility only (`agentSubExpired` / `agentSubExpiringSoon` / `agentSubActive` in `i18n.js`). Note `ProviderOnboardingScreen.js` still carries "Both plans include a 5-day free trial. No payment until you're verified and live." on the tier-selection step; the tier cards themselves show no prices.

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

### Placement — draggable, edge-snapped, persisted (no longer a fixed FAB)
The button is **not** a static bottom-right FAB. It is an `Animated.View` with `PanResponder` handlers that the user drags; on release it **springs to whichever side edge its centre is nearer** (never rests mid-screen), and the resting spot **persists across launches** (`@trnc_oli_pos`, see below). First launch defaults to the old bottom-right position, so nothing moved for existing users.

All of this lives **inside `OliGuide.js`** — the root mount in `App.js` was not touched. That is the point of the global-overlay pattern: the overlay owns its own placement.

**Core `Animated` + `PanResponder` only.** Reanimated / gesture-handler are native deps — they'd force a native build and break OTA safety. Do not "upgrade" this to them without a native release.

Three non-obvious constraints, each of which will bite anyone editing this:

- **The drag is driven by imperative `pos.setValue()`, not `Animated.event`.** Mixing a JS-driven `Animated.event` with a native-driven spring on the *same* value makes RN throw *"node has been moved to native"*. `setValue` on a native node is supported, so the snap spring keeps `useNativeDriver: true`. Movement is therefore `transform: translateX/translateY` only — **never** `left`/`top`/`bottom`, which can't use the native driver.
- **Position state of record is JS refs (`restRef {edge, y}`), never `pos._value`.** A native-driven `Animated.Value`'s JS-side `_value` is not guaranteed to be in sync (native only reports back when a listener is attached). Reading it back would be a latent bug.
- **Tap vs drag is hand-rolled.** The PanResponder claims the touch on start, so there is no `TouchableOpacity` and no `onPress`. Under `TAP_SLOP` (10px) of movement on release ⇒ open the sheet; anything more ⇒ drag, sheet does **not** open. Because a screen reader never fires a PanResponder, `accessibilityRole="button"` + `onAccessibilityTap` carry the VoiceOver path — **do not remove them**, or Ask Oli becomes unreachable with VoiceOver on.

**Safe bounds** are clamped *during* the drag, not just on release, so the button can't be pushed under the notch, under the `BottomTabBar`, or over the global search entry. Vertical range is `[insets.top + TOP_CLEARANCE, height − (TAB_BAR_H + insets.bottom) − TAB_BAR_GAP − FAB_SIZE]`.

- `TAB_BAR_H = 52` / `TAB_BAR_GAP = 20` are **derived** from the real `BottomTabBar` layout in `App.js` (`borderTop 1 + paddingTop 10 + icon 24 + gap 3 + label ~14`, plus `insets.bottom`). The resulting lower bound lands on *exactly* the pixel the old fixed FAB occupied — that coincidence is the check that confirms them. **They go stale silently if that tab bar's padding or labels ever change.**
- `TOP_CLEARANCE = 112` is an **estimate** of header (~68) + global search entry (~44), not a measured value. It is the one number here likely to need tuning.
- The lower bound assumes a tab bar exists. Full-screen sub-screens (no tab bar) simply float a little higher than strictly necessary — same as the old hardcoded behaviour, so no regression.

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

## AsyncStorage keys — device-local state

Every key the app reads or writes. **Device-local, never synced** — nothing here survives a reinstall, and none of it is per-account (a guest and a signed-in user on the same phone share these).

| Key | Written by | Value | Notes |
|---|---|---|---|
| `@trnc_lang` | `App.js`, `AuthScreen`, `WelcomeScreen` | language name, e.g. `'English'` | Selected UI language. |
| `@trnc_onboarded` | `App.js` | `'true'` | Carousel/onboarding completed. Gates the welcome path. |
| `@trnc_coach_v2` | `App.js` | `'true'` | Coach marks shown once. `_v2` suffix is how the deck was re-shown after a redesign — **bump the suffix, don't clear the key**, if the coach marks change again. |
| `@trnc_oli_pos` | `components/OliGuide.js` | `JSON.stringify({ edge: 'left'\|'right', y: <px> })` | Resting spot of the draggable Ask Oli button. See the Ask Oli section. |
| `ada_favorites` | `App.js` | JSON array of facility ids | **Prefix inconsistency is pre-existing** (`ada_`, not `@trnc_`). Left alone deliberately: renaming it would silently drop every existing user's favourites. New keys use `@trnc_`. |

Supabase auth additionally uses AsyncStorage as its session store (`lib/supabase.js`, `storage: AsyncStorage`), which owns its own `sb-*` keys — don't hand-edit or clear those.

**`ada_favorites` is deliberately not gated for guests** — see the guest-access section. It is the one piece of user state that survives the guest → signup handoff, precisely because it's device-local rather than server-side.

### `@trnc_oli_pos` read/write contract
- **Write:** once per drag, in `onPanResponderRelease` (never per frame, never on a tap). Fire-and-forget; errors swallowed, because a storage failure should cost a remembered position, not break the button.
- **Read:** once on mount. Validates `edge ∈ {left, right}` and `Number.isFinite(y)`, then **re-clamps `y` to current bounds** before applying — so a stale entry (different device, changed insets, hand-edited value) falls back to the default instead of parking the button off-screen.
- `x` is deliberately **not** stored: the button always snaps to an edge, so the edge plus a `y` is the whole state.
- The button renders at `opacity: 0` (and `pointerEvents: 'none'`) until that read resolves, so a saved left-edge position doesn't flash in at bottom-right first. A `null` read (first launch) is the legacy bottom-right corner.

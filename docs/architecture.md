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

### Pending

- **Slice 2** (blocked on Gişe Kıbrıs API docs): automated API sync + commission/affiliate tracking, replacing manual SQL entry. `source`/`external_id` exist for this.
- **Follow-up slice**: add a category picker to `OrganizerScreen.js` so new organizer submissions are categorised instead of defaulting to `other`.
- Multi-language event *content* (title/description are admin data, not i18n keys) is a Slice 2+ question.

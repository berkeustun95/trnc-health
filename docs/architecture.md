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

### noteKey convention
- Add the key adjacent to `essBordersOpen24h` / `essBordersPedestrian` in every language block of `constants/i18n.js`.
- Keep the note to 2–4 sentences. Use it for safety-critical info (access restrictions), brief history, or caveats not covered by the standard badges.
- Currently used by: `ledrapalace` → `essBordersLedrapalaceNote`

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

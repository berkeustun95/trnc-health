# Ada Health — Project Context Snapshot
> Generated 2026-06-08. Paste this into claude.ai for full project context.

---

## What this project is

A mobile health-access app for newcomers to North Cyprus (TRNC). Users can find and contact pharmacies, clinics, hospitals, and dentists. Three roles: **customer**, **provider**, **admin**.

---

## Stack

- **React Native + Expo SDK 54** (managed workflow) — do NOT upgrade or change package versions; use `npx expo install <pkg>` only
- **Supabase** — Postgres, Auth, Storage
- **Entry:** `index.js` → `App.js`
- **Supabase client:** `lib/supabase.js`
- **No navigation library** — all screen transitions are manual conditional renders in `App.js` driven by `currentScreen` state
- **Fonts:** Inter_400Regular + Inter_700Bold from `@expo-google-fonts/inter` everywhere
- **Icons:** `@expo/vector-icons` (Feather + Ionicons)

---

## File structure

```
trnc-health/
├── App.js                          # Root: navigation state + main facility list screen
├── index.js
├── app.config.js / eas.json
├── assets/                         # Icons, splash, logos, bg images
├── constants/
│   ├── avatars.js                  # Preset emoji avatars
│   ├── i18n.js                     # All translations (9 languages)
│   ├── specialties.js
│   ├── theme.js                    # Design tokens (colors, shadow, spacing, radius)
│   └── quizTimeout.ts
├── lib/
│   └── supabase.js                 # Supabase client init
├── screens/
│   ├── AdminScreen.js
│   ├── AuthScreen.js
│   ├── BookingScreen.js
│   ├── DutyListScreen.js
│   ├── LegalScreen.js
│   ├── MapScreen.js
│   ├── NotificationsScreen.js
│   ├── OnboardingScreen.js
│   ├── ProfileScreen.js
│   ├── ProviderOnboardingScreen.js
│   ├── ProviderScreen.js
│   ├── ResetPasswordScreen.js
│   ├── ReviewsScreen.js
│   └── quiz/                       # Standalone quiz feature (TypeScript)
│       ├── QuizNavigator.tsx
│       ├── QuizScreen.tsx
│       ├── ResultsScreen.tsx
│       ├── PharmacistPickerScreen.tsx
│       ├── QuizReviewScreen.tsx
│       ├── AwaitingReviewScreen.tsx
│       ├── LandingScreen.tsx
│       ├── LoadingScreen.tsx
│       └── reviewStore.ts
└── src/
    ├── data/quiz/                  # Questions, supplements, affiliate links, translations
    └── lib/quiz/                  # Engine, store, PDF generation, currency utils
```

---

## Design tokens (`constants/theme.js`)

```js
export const colors = {
  primary:       '#0E7C7B',
  primaryLight:  '#E6F4F4',
  accent:        '#FF8552',
  accentLight:   '#FFF0EB',
  bg:            '#F7F8FA',
  cardBg:        '#FFFFFF',
  surface:       '#FFFFFF',
  border:        '#E8EDF2',
  textPrimary:   '#1A2B33',
  textSecondary: '#64748B',
  success:       '#2E9E5B',
  successLight:  '#E6F5ED',
  danger:        '#D1495B',
  dangerLight:   '#FAEAEC',
}

export const typeColors = {
  pharmacy: { bg: '#F3E8FF', text: '#7C3AED' },
  clinic:   { bg: '#E6F4F4', text: '#0E7C7B' },
  hospital: { bg: '#FAEAEC', text: '#D1495B' },
  dentist:  { bg: '#E6F5ED', text: '#2E9E5B' },
}

export const shadow = {
  shadowColor: '#1A2B33', shadowOpacity: 0.07,
  shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 3,
}

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 }
export const fontSize = { sm: 13, md: 16, lg: 20, xl: 26 }
export const radius   = { sm: 8, md: 12, card: 16, lg: 20, xl: 28 }
```

---

## Supabase client (`lib/supabase.js`)

```js
import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
```

---

## Data-fetching pattern

No React Query or SWR. Plain `useEffect` with inline async functions + `useState`. Direct Supabase calls, state updated immediately on success — no refetch.

```js
useEffect(() => {
  async function loadProfile() {
    const { data, error } = await supabase
      .from('profiles')
      .select('full_name, phone, nationality, preferred_language, role, avatar_url')
      .eq('id', session.user.id)
      .single()
    if (error) { setLoadError(true); return }
    if (data) { setProfile(data); setForm({ ...data }) }
  }
  loadProfile()
}, [])

// Mutation pattern — update then patch local state:
async function cancelBooking(bookingId) {
  const { error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', bookingId)
    .eq('customer_id', session.user.id)
  if (!error) setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'cancelled' } : b))
}
```

---

## Code conventions

- **Components** that re-render are defined at **module top level**, never inside their parent component — prevents remount bugs.
- **StyleSheet.create** at the bottom of each file, aliased as `s` for brevity.
- **i18n:** every user-facing string uses `t(key, lang)` from `constants/i18n.js`. `lang` is passed as a prop down through the tree.
- **SafeAreaView** from `react-native-safe-area-context` with `edges={['top']}` on scroll screens.
- **KeyboardAvoidingView** with `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`.
- **Facility types** are fixed: `pharmacy`, `clinic`, `hospital`, `dentist` — no others.
- No hardcoded color values except `#fff` and occasional `rgba(...)` tints; everything else from `colors` token.
- No analytics, no third-party SDKs beyond what's already installed.

---

## Screen component skeleton (for reference)

```jsx
import { useState, useEffect } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { colors, shadow } from '../constants/theme'
import { t } from '../constants/i18n'

// Sub-components defined at module level (not inside parent)
function SomeCard({ item }) {
  return <View style={s.card}><Text style={s.title}>{item.name}</Text></View>
}

export default function SomeScreen({ session, lang, onBack }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('table').select('*')
      if (data) setData(data)
      setLoading(false)
    }
    load()
  }, [])

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.container}>
        {data.map(item => <SomeCard key={item.id} item={item} />)}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: colors.bg },
  container: { paddingHorizontal: 20, paddingBottom: 48 },
  card:      { backgroundColor: colors.cardBg, borderRadius: 16, padding: 14, marginBottom: 10, ...shadow },
  title:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
})
```

---

## Supabase tables (known)

| Table | Key columns | Notes |
|---|---|---|
| `profiles` | `id`, `full_name`, `phone`, `nationality`, `preferred_language`, `role`, `avatar_url` | role: customer/provider/admin |
| `facilities` | `id`, `name`, `type`, `address`, `phone`, `opening_hours`, `latitude`, `longitude`, `verified`, `cover_photo_url`, `logo_url`, `specialties` (text[]) | type: pharmacy/clinic/hospital/dentist |
| `appointments` | `id`, `customer_id`, `facility_id`, `requested_time`, `status` | status: pending/confirmed/cancelled |
| `reviews` | `id`, `customer_id`, `facility_id`, `appointment_id`, `rating`, `comment` | |

**Security:** RLS is the security boundary. Every user-data table has RLS enabled. Customers cannot read each other's data. Service role key is never in app code — only the anon public key in `lib/supabase.js`.

---

## Recent git history

```
928ba69 Support multiple specialties per facility (text[] column)
fd60128 Add facility specializations with specialty filter chips
931f03e Add facility cover photo and logo upload for providers
fe4b5e6 Fix map facility selection on Android
30563b0 Remove unused adalogobgremoved.png asset
32141b7 Add profile avatar picker: preset emojis and photo upload
f37c08d Move map/list toggle to left, center logo in main header
3615945 Visual polish: auth form card, photo bg on main, card visibility fixes
9c72048 Visual polish: backgrounds, logos, filter chips, quiz promo card
9bd9404 Add Play Store assets and update launcher icon to ADA logo
```

Branch: `main` (direct commits, no feature branches).

---

## Known issues / things to watch

- No tracked `TODO`/`FIXME` comments in source — no open code-level bugs found.
- A few hardcoded English strings in the avatar picker modal bypass the `t()` i18n system (`"Upload photo"`, `"Or pick an avatar"`, `"Choose avatar"`).
- No navigation library — Android hardware back button and deep-link handling are entirely manual; potential fragility point.
- Quiz feature (`screens/quiz/`) is TypeScript; rest of app is JS — mixed, but Expo handles it.
- `verified: true` on a facility is never set in code — it's a manual step done in Supabase dashboard.

---

## Dev commands

```bash
npx expo start -c        # start dev server (cleared cache)
npx expo install <pkg>   # add package at SDK-54-compatible version
```

# TRNC Health App

## What this is
A mobile health-access app for newcomers to North Cyprus (TRNC): find and reach
trusted pharmacies, clinics, hospitals, dentists. Three user roles: customer,
provider, admin. I (the project owner) am the architect; you are my fast hands.
I review everything you produce.

## Stack
- React Native + Expo, **SDK 54** (managed workflow)
- Supabase (Postgres) for database, auth, and storage
- Entry: index.js -> App.js
- Supabase client lives in lib/supabase.js

## CRITICAL: never change package versions
We are pinned to Expo SDK 54 to match the Expo Go app on the test phone.
- Do NOT upgrade expo, react, or react-native, and do NOT run `npm install <pkg>`
  to add versions. Use `npx expo install <pkg>` so versions stay SDK-54 compatible.
- If a task seems to need a version bump, STOP and ask me first.

## Commands
- `npx expo start -c` — start dev server with cleared cache
- `npx expo install <pkg>` — add a package at SDK-54-compatible version

## Release & Update Flow
**JS-only fix** (UI, logic, styles, bug fixes — anything in .js files):
```bash
eas update --channel production --message "description"
```
Users get it on next launch. No Play Store involved.

**New native build required** only when changing: `app.config.js`, native dependencies, permissions, icons, SDK version.
```bash
eas build --platform android --profile production
# then submit new AAB to Play Store closed testing track
```

**Never use** `process.env.EAS_BUILD` conditionals in `app.config.js` — it caused `checkAutomatically: 'NEVER'` to bake into a production build, breaking OTA entirely. Always hardcode `'ON_LOAD'`.

**OTA only reaches the production build.** A preview APK (`eas build --profile preview`) does not have `channel: "production"` baked in and will never receive OTA updates. Always test OTA on the Play Store install, not a sideloaded APK.

**EAS environment variables:** Use `eas env:create` (not `eas secret:create` — deprecated). `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` is set for the production environment. Changes to env vars require a new native build to take effect.

**facility_change_requests.proposed_changes:** The `languages` field is stored as a comma-separated string (e.g. `"English, Turkish"`). When approving and writing to `facilities.languages` (which is `text[]`), split it first: `changes.languages.split(',').map(l => l.trim())`.

## How I want you to work
- Make MINIMAL changes. Do not refactor unrelated code.
- Make the changes according to the prompt then say its done and explain shortly. so dont ask to proceed everytime
- One bounded task at a time. If scope is unclear, ask.
- Match the existing data-fetch pattern: query Supabase -> useState -> render.

## Security (non-negotiable — this is a health app)
- Row Level Security (RLS) is the security boundary. Every table with user data
  MUST have RLS enabled with role-appropriate policies.
- When you write or change an RLS policy, explain in plain English exactly who
  can read/write what, so I can verify it myself.
- A customer must NEVER be able to read another customer's data.
- Never put the Supabase service_role key or the database password in app code.
  Only the anon public key belongs in lib/supabase.js.

## Conventions
- Functional React components with hooks.
- Keep components small; one screen per file.
- Facility types are limited to: pharmacy, clinic, hospital, dentist.

## Android Gotchas
- Views with `borderRadius` + `borderWidth` on Android may render an opaque background unless `backgroundColor: 'transparent'` is set explicitly.
- Never cache element positions in `onLayout` for later use — layout can shift (e.g. async data loading) and the cached value goes stale. Always measure with `measureRef()` at the moment you need the position.

## Don't
- Don't add analytics, tracking, or third-party SDKs without asking.
- Don't generate large files of placeholder/sample code — ask what's real.
- Don't mark a provider `verified: true` in code; verification is a manual step I do.
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

**Google Maps key is RESTRICTED in Cloud Console** (Android apps: `com.berkeustun95.ada` + upload SHA-1; API: Maps SDK for Android only), so a blank Android map with **no error** = a SHA-1 mismatch. After the first Play release, the **Play App Signing SHA-1 must be ADDED** as a 2nd entry (keep the upload one). Detail + checklist: `~/ObsidianVault/10-ada/play-console-status.md`.

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

## Migrations (manual-apply — no CI)
Migrations are applied by hand (SQL editor, Role → postgres), so nothing catches a
file that was committed but never applied (this is how `facilities.area` silently
went missing). Two mandatory rules:
- **Register every new object in `supabase/verify_schema.sql`.** When a migration
  adds a table/column/function/trigger/constraint/index/cron/policy, add it to the
  matching section of that drift-check script. Behavior-only `CREATE OR REPLACE`
  (no new named object) needs an H-section token. An unlisted object is invisible
  to the check. Run the script after applying to confirm the DB matches the repo.
- **Every ADD COLUMN migration ends with `NOTIFY pgrst, 'reload schema';`** (after
  `RESET ROLE;`). Without it, a stale PostgREST cache reports 42703 "column does
  not exist" through the REST API even though the column exists in Postgres.

## Conventions
- Functional React components with hooks.
- Keep components small; one screen per file.
- Facility types are limited to: pharmacy, clinic, hospital, dentist.
- Admins never reach HomeScreen or the customer module chain — the App.js content
  selector is role-first (`profile.role === 'admin'` renders AdminScreen and short-
  circuits everything below). Any admin preview surface must be entered from
  AdminScreen via the `adminPreview` state, never from a HomeScreen tile gated on
  `isAdmin` (that tile is unreachable for admins and hidden for customers).
- Turkish diacritics (ü ö ş ğ ı ç) extend above cap-height and below the baseline.
  Any Text style with an explicit `fontSize` MUST set `lineHeight` to ~1.4-1.5x
  fontSize, or glyphs clip on Android. This is invisible when testing in English —
  always spot-check new UI in Turkish before declaring it done.

## Android Gotchas
- Views with `borderRadius` + `borderWidth` on Android may render an opaque background unless `backgroundColor: 'transparent'` is set explicitly.
- Never cache element positions in `onLayout` for later use — layout can shift (e.g. async data loading) and the cached value goes stale. Always measure with `measureRef()` at the moment you need the position.

## Advisor

Consult the advisor before writing any Supabase migration, RLS policy, or module flag change, and before declaring a task done.

## Don't
- Don't add analytics, tracking, or third-party SDKs without asking.
- Don't generate large files of placeholder/sample code — ask what's real.
- Don't mark a provider `verified: true` in code; verification is a manual step I do.

## Dev journal summaries

When I ask for a summary for the dev journal, follow this format:
- Headline + type (OTA / native / hotfix / refactor)
- "What changed" grouped by feature/area
- "Why" — 1-2 sentences if not self-evident
- "Watch out for" — gotchas, deferred TODOs, things future-me needs to remember
- **When more than one reasonable approach existed for a decision, include an options table with tradeoffs — not just the choice.**
- "→ architecture.md updates needed" if structural (new tables, screens, conventions)


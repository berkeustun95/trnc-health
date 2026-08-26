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

**Publish OTA with `npm run ota`, NEVER `eas update` directly.** The wrapper runs
`scripts/check-module-flags.mjs` first, which blocks the publish if a dark-launch flag is
flipped. This matters because **`eas update` bundles the WORKING TREE, not git HEAD** — an
uncommitted `MODULE_FLAGS.x: true` left over from previewing a gated screen ships to every
user immediately, and no git hook can see it. EAS Update has no lifecycle hook, so the
wrapper plus `npm run check:flags` is the only guard that exists. `git push` and
`eas build` are covered automatically (`.githooks/pre-push`, `eas-build-pre-install`).
Fresh clone: `npm run setup:hooks` once.

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
- A filter row (or any fixed-height View) placed as a flex sibling ABOVE a scrollable
  list in a `flex:1` column MUST set `flexShrink: 0` — otherwise it gets vertically
  compressed when the list overflows, cropping its text top and bottom. It only
  reproduces once there are enough results to make the list scroll, so it is invisible
  with short or empty lists. (Not a lineHeight/font issue — that was a wrong early guess.)
- **`MODULE_FLAGS` does not gate search.** `search_content` returns rows straight from
  the tables, so a module flag only hides the SCREEN — anything a module's table exposes
  publicly is findable through global search while the module is still dark. Any content
  seeded before launch must therefore be seeded in whatever state its own RLS treats as
  unpublished (`is_active = false`, `status <> 'active'`), and flipped to published in
  the same step as the flag. A user who finds a real listing and lands on Coming Soon
  learns that ADA cannot help with that thing — which is the opposite of what a
  pre-launch seed is for.
- **A pre-launch table should DEFAULT to unpublished.** `towing_companies.is_active`
  DEFAULTs to `false` (`20260907`) — a deliberate inversion of the usual `true`, so an
  INSERT that omits the column lands invisible instead of publishing itself. Prefer this
  for any new admin-seeded directory: a banner in a seed file protects the one path
  somebody wrote, while the default protects every path nobody has written yet — a future
  CRUD screen, a hand-typed row, an import script. Going live then has to be an explicit
  act. Register the default as an H-section token in `verify_schema.sql`; a reverted
  DEFAULT creates no named object and is otherwise undetectable.
- **A green check is only evidence if you have seen it go red.** A check you have never
  watched fail is not a check, it is a decoration — and it is worse than nothing, because
  it buys confidence it has not earned. Before trusting one, break the thing it guards and
  confirm it complains, then put it back. Three checks written for the towing module were
  each green while checking nothing: a seed validator that reported "all 4 rows valid"
  having parsed **zero** rows (its slice ran to a terminator that appeared earlier in the
  file); an i18n completeness checker that matched only literal `t('key')` and silently
  skipped every key looked up through a variable; and a clip assertion that compared a
  coordinate against the pixel *containing* it and so fired on its own rounding.
  That last one is the instructive case — the tempting fix was to widen the tolerance
  until it went green, which would have left a test that cries wolf, and a test that cries
  wolf teaches you to ignore it. Fix what the test measures, not what it reports.
- **Comments that cite a measured number must be regenerated, not remembered.** A header
  saying "207 m of headroom" goes stale silently the moment the measurement changes. Where
  it matters, have the tool print the real figure on every run so the comment can be
  checked against it — and correct the comment when they disagree, even by 2 m.
- **Check whether the grouping you chose is the one the domain uses.** 387 pharmacies with
  NULL coordinates looked like an obvious data gap, and a bulk geocoding project was
  scoped to close it. Grouped by `type` it read as 387 missing rows. Grouped by
  **commercial relationship** — the axis the policy was actually written on — not one row
  contradicted it: every facility with coordinates is either public infrastructure (6
  state hospitals) or a subscriber who placed their own pin (1 clinic, `provider_id` set),
  and every facility without them is a private business with no relationship to ADA.
  Nothing had drifted; the policy was working.
  **A policy and an omission are indistinguishable until you find the axis the policy was
  written on.** So when data looks uniformly missing along one axis, group it along a
  different one before proposing to fill it — and prefer the axis the business uses
  (who pays, who is public, who signed) over the one the schema happens to offer.
- **Every check here asks whether a column EXISTS. None asked whether the content is
  CURRENT — and that is the failure that reached users.** `verify_schema.sql`,
  `schema_drift_audit.sql` and `migration_ledger_check.sql` all verify *shape*. The duty
  pharmacy roster (`duty_list`) ran out on 2026-06-30 and nobody noticed for two months,
  while passing every one of them, because an empty table has a perfectly correct schema.
  It reached users as the worst possible form: the app told people there was no duty
  pharmacy tonight, when the truth was that we had lost the list. There is ALWAYS a duty
  pharmacy in the TRNC, so that message was never describing the world.
  Schema drift was the failure class we had tooling for. **Content expiry was not.**
  So: any feature backed by content that EXPIRES — a roster, a schedule, a feed, a seasonal
  list — needs a staleness check as a matter of course, written at the same time as the
  feature, not after it fails. `check-novest-staleness.mjs` and `check-duty-staleness.mjs`
  are the pattern: ask a CONTENT question, exit 1, run by hand or by cron.
  Not in pre-push — a push must not be blocked because a roster is running low; that is
  data operations, and a guard that blocks unrelated work gets disabled.
  Corollary for the UI: if a table can legitimately be empty, say so; **if it cannot, an
  empty result is an ERROR STATE and must not be rendered as a normal one.**
- **When a retry-tuned fix stops working, check whether you are tuning the wrong verb.**
  A number you keep raising is a number that is not the answer. `seed-explore-photos.mjs`
  hit Wikimedia 429s five times; the spacing went 120 → 350 → 1000 ms and each raise was
  reasoned, plausible and wrong. The measurement that ended it was free and already in the
  output: **19 of 20 HEAD requests succeeded and one 429'd, while ALL 20 GETs of those
  identical URLs succeeded in the same run, pulling 133 MB without a single rejection** —
  a different URL failing each attempt. upload.wikimedia.org throttles HEAD far harder
  than GET. The stage was being rate-limited for making CHEAP requests while the expensive
  ones sailed through, and no amount of backoff addresses that.
  Generalises past this script: before tuning a retry, get the measurement that says
  *which* request is being rejected and *why*. Compare the failing call against a
  neighbouring call that succeeds — different verb, different endpoint, different header —
  because "it fails sometimes" and "it fails when we use HEAD" look identical from a
  distance and only one of them tells you what to change. Related, and the reason this
  matters at all: **an intermittent guard failure is worse than a consistent one** — it
  teaches you to re-run until it passes, which is exactly how a genuinely dead link gets
  waved through.

## Module go-live SOP (ordered — the order is the point)

Flipping a module on is not one step, it is nine, and several of them are only correct
in this sequence. Deviations that look harmless are how modules ship half-launched.

1. **Seed inactive.** Rows land with the table's unpublished value (`is_active = false`).
   Nothing is visible or searchable yet.
2. **Verify the data while it is still invisible.** Dial every phone number. Check every
   image URL returns bytes. This is the last moment a mistake is free.
3. **Activate the rows.** This OPENS a window: the content is now publicly searchable
   (`search_content` ignores `MODULE_FLAGS`) while the screen is still gated. Keep the
   window short and never end a session inside it.
4. **Spot-check in Turkish**, on device, with the flag flipped LOCALLY and uncommitted.
   Turkish strings are longer than English and surface layout bugs nothing else does.
   If you needed temporary fixtures to exercise states real data does not cover, this is
   where they live.
5. **Revert the fixtures.** Before anything else. Fake data outlives the session it was
   created for otherwise.
6. **Flip the flag in BOTH files, in ONE commit** — `constants/flags.js` and
   `scripts/check-module-flags.mjs`. Either alone fails the guard, which is the design.
7. **Stash check, then clean tree.** `eas update` bundles the WORKING TREE, not HEAD. A
   long-lived stash is not a blocker and must stay stashed.
8. **`npm run ota -- --message "..."`** — never `eas update` directly, and note the `--`:
   the wrapper takes no message of its own and EAS errors without one non-interactively.
   Args after `--` land past the `&&`, so the flag guard still runs.
9. **Verify the OTA on device across two full open → wait → kill → reopen cycles**, on
   the Play Store build. A preview APK has no production channel and never receives OTA.
10. **THEN `notify_module_waitlist('<module>')`.** Last, and only after step 9 is
    confirmed. Notifying before the OTA has landed sends people to a screen that has not
    updated yet — the one thing worse than not notifying them. Then add the module to
    `WAITLIST_BLAST_DONE` in `scripts/check-module-flags.mjs`; the guard blocks the next
    push until you do.

Steps 6 and 10 are enforced mechanically by `check-module-flags.mjs`. The rest are not,
and rely on this list.

- Always spot-check new UI in Turkish before declaring it done. Turkish labels are longer
  than English, so they routinely push lists past the viewport (hitting bugs like the one
  above) where English never did.

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


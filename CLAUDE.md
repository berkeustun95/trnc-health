# ADA — North Cyprus assistant

## What this is
ADA is a TRNC super-app for residents and newcomers: facilities directory and duty roster,
Explore (places, walking routes), events, accommodation, towing, home services, pets, Student
Hub and more, each module behind `MODULE_FLAGS` (`constants/flags.js`). Expo SDK 54 + Supabase,
9-language i18n (`constants/i18n.js`). Roles: customer, provider, admin (guests via
`signInAnonymously()`). I am the architect, you are my fast hands; I review everything.
Incident backstories for the rules below: `~/ObsidianVault/10-ada/claude-md-lessons.md`.

**Touching supabase/, SQL, RLS or migrations? Read supabase/CLAUDE.md first.**

## Stack & versions
- React Native + Expo **SDK 54** (managed). `index.js` → `App.js`. `lib/supabase.js`. Dev: `npx expo start -c`.
- ⚠ **Never change package versions.** Pinned to SDK 54 to match the test phone's Expo Go. Never
  upgrade expo/react/react-native; add packages with `npx expo install <pkg>`, never `npm install`.
  If a task seems to need a version bump, STOP and ask.

## ⚠ Standing warnings
- ⚠ **Play: ADA is NOT a health app — deliberate, tested; do not "correct" it.** See Compliance.
- ⚠ **`expo.locales` must never gain `ar` or `fa`.** An Arabic/Persian `.lproj` makes RN mirror the
  whole iOS layout (`allowRTL` defaults YES, read at bridge init). RTL is a separate app-wide decision.
- ⚠ **Image messaging is blocked on a safety scope.** No attachment column, bucket or upload path
  until `~/ObsidianVault/10-ada/2026-09-20_image-messaging-safety-scope-PARKED.md` is answered:
  it is private between minors, `contains_blocked_term` cannot see an image, and auto-hide has no
  messages branch. Message images must never sit in a public bucket (a guessable URL); only
  `avatars` is private (signed URLs, `components/Avatar.js`); the other buckets are public.
- ⚠ **Never raise `min_supported_version` above `'1.0.0'`** without the force-tier device pass. See below.
- ⚠ **OTA only via `npm run ota`; web only via `npm run web:deploy`.** Both raw tools bundle the
  WORKING TREE and have no hook, so the wrapper is the only guard.
- ⚠ **`eas-cli@24.7.0` pin in the iOS wrappers is load-bearing** — never swap back to bare `eas`.
- ⚠ **No RLS or storage policy changes through the Supabase dashboard. Migrations only.**
- ⚠ **Live-strip notice card is DORMANT, not dead** (`kind='notice'`, `LiveStrip.js`, rank 3b, row
  `is_active=false` by product decision). Don't delete or repurpose it; re-enable = one
  `UPDATE … SET is_active = true`. Same for the `showAgentOnboarding` branch in App.js.

## Release & deploy
- **JS-only change:** `npm run ota -- --message "…"` (note the `--`). Pre-flight: stash check, then
  clean tree (a long-lived stash is not a blocker and stays stashed). Never `eas update` directly:
  it bundles the WORKING TREE, so an uncommitted `MODULE_FLAGS.x: true` ships to every user. The
  wrapper runs `check-module-flags.mjs` (also `npm run check:flags`); `git push` and `eas build` are
  covered by `.githooks/pre-push` and `eas-build-pre-install`. Fresh clone: `npm run setup:hooks`.
- **OTA only reaches the production build** — never a preview APK; test OTA on the Play Store install.
- **Native build** only for `app.config.js`, native dependencies, permissions, icons, SDK version:
  `eas build --platform android --profile production`, then upload the AAB to Play closed testing
  by hand (the Play service-account key here is used for the store listing only).
- **iOS:** `npm run ios:build` / `ios:submit`, no Apple login; they source `~/.appstoreconnect/ada-eas.env`
  (outside repo) → ASC key "EAS Build" (`WYJ38BNP8L`, Admin, team MAQ8XPJ8Z6). Only a key passed via
  `EXPO_ASC_API_KEY_PATH`/`_KEY_ID`/`_ISSUER_ID` (+ `EXPO_APPLE_TEAM_ID`/`_TYPE`) regenerates profiles;
  an EAS-stored key never does. Never commit/print/copy the key; lost Mac → revoke in ASC → Users and Access.
- **Never use `process.env.EAS_BUILD` in `app.config.js`.** Hardcode `checkAutomatically: 'ON_LOAD'`.
- **Permission strings:** ONE source per usage description, its plugin option (`ios.infoPlist` is inert).
  `RECORD_AUDIO` off, camera kept (accepted review risk), background location off. Verify with
  `npx expo config --type introspect`, never by reading `app.config.js`.
- **EAS env vars:** `eas env:create` (not `secret:create`); changes need a native build. Maps key set for prod.
- **Maps key is restricted** (`com.berkeustun95.ada` + SHA-1). Blank map, no error = SHA-1 mismatch;
  ADD the Play App Signing SHA-1 as a 2nd entry. Checklist: vault `play-console-status.md`.
- **`web/` publishes** `getadaapp.com/privacy` and `/support` (Cloudflare Worker `getadaapp`, root
  `wrangler.jsonc`); both URLs are registered with the stores. `npm run web:deploy`, never
  `npx wrangler deploy`: it runs `check-web-assets.mjs`, and wrangler REPLACES the asset manifest, so
  a missing `support.html` silently 404s. `git push` does not publish `web/` (`docs/` is GitHub Pages).

## Store-update popup
`app_versions` (20261051): `latest_version` = dismissible, `min_supported_version` BLOCKS. Raising it
above `'1.0.0'` on either platform needs a force-tier device pass on BOTH Android and iOS first (never
run on either; iOS alone tests the native Modal vs the emergency root overlay, no hardware back, and
`itms-apps://`). iOS test = new build from **main**, never `release/1.1`. `verify_schema.sql` QUERY 5
goes red when raised; that is the review moment. Pass criteria: vault "Store-update popup force tier".

## Play listing
- Text lives in `fastlane/metadata/android/<lang>/` (tr-TR, en-GB default, ru-RU, ar, el-GR, fr-FR,
  es-ES, de-DE, fa). Play is downstream: Console hand edits are overwritten. No images/binaries there.
- Titles match the ad: `ADA – North Cyprus Assistant` / `ADA – Kuzey Kıbrıs Asistanı`, "ADA" first
  in all; es-ES uses `ADA: …` (length). Never "Guide". Paragraph 2 says "assistant" once.
- Limits: title ≤ 30, short ≤ 80, full ≤ 4000 code points. Title files have NO trailing newline.
- No health, pharmacy, duty, clinic or doctor wording in any language; no "eSIM" while
  `CONNECTIVITY_LIVE` is false (remove that guard pattern the day Connectivity goes live).
- Paragraph 1 = independence disclaimer; description carries official source links. The guard reads
  URLs from `fastlane/metadata-backup/android/en-GB`. el-GR names no state. Bullets name LIVE modules only.
- `npm run store:check` enforces all of the above on every folder. `npm run store:listing` = check +
  text-only `fastlane supply`; dry run `-- --validate_only true`. Needs
  `./google-play-service-account.json` (gitignored, mode 600, never committed or printed).
- ⚠ A real push joins whatever Play is reviewing: wait for pending reviews; if refused, use
  `--changes_not_sent_for_review true` and send from Console.
- ⚠ `fastlane supply init` overwrites the folder; snapshot into `fastlane/metadata-backup/android` only.
- System Ruby 2.6, gems in `vendor/bundle`; `bundle install` once. Ruby compares of listing files
  need `encoding: "UTF-8"` or `LC_ALL=en_US.UTF-8`, else every language falsely "differs".

## Compliance (Google Play, declared mixed-audience app)
- ⚠ **Category Travel & Local, Health declaration "no health features" — do not re-tick it,** even
  though Google's category text reads otherwise. Declaring health forces an Organization account; ADA
  is individual (the 2026-07-06 rejection). Directory + duty roster stay as a local directory. The
  unlock is an Organization account. Record: vault `play-console-status.md`.
- Target ages 13-15 / 16-17 / 18+: under-18s (`date_of_birth`) get NON-PERSONALIZED ads from day one of any ad SDK.
- Never add an SDK disqualified under Play Families policy without flagging it (one bad SDK makes
  the whole app ineligible — analytics included).
- Account age and content visibility are separate: the future kids module runs as guest or under a
  parent account; no coupling beyond `GATE_EXEMPT_MODULES`.
- `MIN_SIGNUP_AGE` lives in `constants/profileGate.js`, mirrored as `interval '13 years'` in the
  20261001 trigger (cannot be a CHECK); `npm run profile:check` compares them. Never inline it.
- The DOB screen is a neutral age screen (no stated minimum, no preset date, free entry; year list
  stops at `currentYear - MIN_SIGNUP_AGE`). Settled — do not re-litigate.

## How I want you to work
- Make MINIMAL changes; don't refactor unrelated code. Say it's done, explain shortly — don't ask to proceed.
- One bounded task at a time. If scope is unclear, ask.
- Match the data-fetch pattern: query Supabase → useState → render.
- **Ask for ONE item per message** (an ID, a query result, a decision) and wait.
- **Push the working branch after EVERY slice**, feature branches too ("push to git" still = main).
- **Device tests are served from `~/trnc-health-swipe`, never `~/trnc-health`** (shared with other
  sessions; Metro bundles its folder's working tree). `git -C ~/trnc-health-swipe checkout <branch>`,
  then `NODE_PATH=~/.npm-global/lib/node_modules npx expo start -c --tunnel` there; URL from
  `curl 127.0.0.1:4040/api/tunnels`. iOS uses TestFlight "My Expo Go" (SDK 54), not App Store Expo Go.

## Security (non-negotiable)
Why: profiles, reviews and messages are personal data, much of it from minors, and a name joined
to a clinic review is a health disclosure about an identified person.
- RLS is the security boundary. Every table with user data has RLS on with role-appropriate policies.
- When you write or change a policy, explain in plain English who can read/write what.
- A customer must NEVER be able to read another customer's data.
- Never put the service_role key or DB password in app code; only the anon key in `lib/supabase.js`.
- Policies change through migrations only, never the Supabase dashboard. `TO authenticated` includes
  guests — only `NOT is_anonymous_session()` excludes them. Every denial check needs a positive
  control beside it. Details: supabase/CLAUDE.md.

## Conventions
- Functional components with hooks; small components; one screen per file. `maybeSingle()` returns
  `{data: null, error: null}` on zero rows; it does not throw.
- `facilities.type` is limited by `facilities_type_check`: pharmacy, clinic, hospital, dentist, vet,
  grooming, garage (repo migrations; confirm live with `pg_get_constraintdef`).
- **Languages are stored as FULL ENGLISH NAMES** (`'Turkish'`), never ISO codes — the `LANGUAGES`
  keys in `constants/i18n.js`, through `preferred_language`, `lang`, `t()`, `*_i18n.lang`,
  `module_notif_text`. An ISO comparison never errors, it matches nothing. Any new per-language
  column gets a CHECK rejecting `'tr'`/`'en'`.
- `facility_change_requests.proposed_changes.languages` is a comma string; split before writing
  `facilities.languages` (`text[]`): `changes.languages.split(',').map(l => l.trim())`.
- Admins never reach HomeScreen (selector is role-first); admin previews enter via `adminPreview`.
- **Never use an admin as a test identity**: `|| isAdmin` unlocks dark modules and swaps the
  deterministic featured sort for a random shuffle (`utils/featured.js`). Use a guest or a real
  customer; reach dark modules by flipping the flag locally, uncommitted.
- A fixed-height sibling above a scrollable list in a `flex:1` column needs `flexShrink: 0`.
- **`MODULE_FLAGS` does not gate search** (`search_content`). Pre-launch content is seeded in its
  table's unpublished state and published in the same step as the flag.
- New admin-seeded directories DEFAULT to unpublished (`is_active DEFAULT false`), with an H token.
- Content that EXPIRES ships with a staleness check (`check-*-staleness.mjs`; by hand/cron, never
  pre-push). If a table cannot legitimately be empty, render empty as an ERROR STATE.
- All back handlers register via `addBackListener` (`utils/backHandler.js`), never
  `BackHandler.addEventListener` directly (iOS edge swipe skips it). `npm run backlistener:check` and
  `npm run backchain:check` run in `npm run ota`; add a backchain case when a layer joins the chain.
- Spot-check new UI in Turkish before declaring it done (longer strings surface layout bugs).

## Verification principles
1. A green check is evidence only once you have seen it go red. Fix what the test measures, never
   widen a tolerance until it passes.
2. A red-first run asserts TWO things: the break landed (`python3` `assert anchor in text`, not
   silent `sed`) and the probe noticed. A slice between markers asserts it contains what it must.
3. Derive, never hardcode: assert `count(*)` and PRINT the rows, never a remembered name list. If a
   legitimate object moves the count, bump it in the same commit and say why.
4. Before a run, ask what a PERFECT system would print. If a broken one prints the same, it is not a
   probe. Run a positive control where it is cheap.
5. Check and checked must be in the same frame of reference (file, URL, encoding, role). Print the raw
   value beside the expectation, and put it in the failure message.
6. When a check fails, the first hypothesis is the check. Ask what it would forbid a CORRECT system
   from doing. Prefer a reading that needs no decoding.
7. A migration file, a comment or a doc is a statement of intent. The live catalogs are the authority:
   quote which one you read.
8. When re-verifying, name the surfaces covered (client, RPCs, INVOKER/DEFINER, views, edge fns).
9. When a guard goes green, say which question it answered ("the file exists" ≠ "it works in prod").
10. Never verify a write from a role that is not allowed to read it.
11. Use `IS DISTINCT FROM` / `IS NOT DISTINCT FROM` wherever NULL is reachable (`<>`/`=` go silent).
12. Truncation guards compare `count: 'exact'` to what arrived; never `rows >= cap` (server
    `max-rows` overrides the client limit).
13. Look at what sample rows ARE before they overturn anything; structural proof first, data sizes.
14. Group missing data along the axis the business uses (who pays, who is public) before calling it a
    gap. Before a column becomes a denominator, ask: fact about now, or about then? Undatable =
    "unverifiable", excluded and printed.
15. When a retry tuning stops working, find WHICH request is rejected (verb, endpoint, header) before
    changing numbers. An intermittent guard failure is worse than a consistent one.
16. A comment citing a measured number is regenerated from the tool's printed figure.

## Android gotchas
- App.js `content` may only read values defined ABOVE the selector (Hermes has no TDZ: below reads
  `undefined`). Pass Modals `visible={x === true}` (RN shows `undefined`). Late-state overlays go in
  App's final return. `check-policy-notice.mjs` guards the notice.
- `borderRadius` + `borderWidth` may render opaque: set `backgroundColor: 'transparent'`. Never cache
  `onLayout` positions; measure with `measureRef()` when needed.
- Reinstall does NOT reset first-run state (Auto Backup restores AsyncStorage) — a test artifact, not
  a bug. Use Clear storage or `adb shell pm clear com.berkeustun95.ada`; `EXPO_PUBLIC_DEV_ONBOARDED`.

## Social sign-in (Google + Apple, native, from 1.2.0)
Plan: `~/ObsidianVault/10-ada/2026-09-21_social-auth.md`.
- Runtime 1.2.0 is the fence (`runtimeVersion` = `appVersion`). 1.1.0 fixes ship from `release/1.1`.
- Every social branch keys on `app_metadata.provider` (`socialProvider()`, first identity only).
- `revokeGoogle()` runs BEFORE anything signs out of Supabase (after, `revokeAccess()` no-ops).
- Under 13: Google/Apple accounts are DELETED, email accounts are FLAGGED.
- A name the provider gave is never asked for again (App Store 4.0); Apple sends it once.
- `display_name` is labelled "Username" in all nine locales, never "name".
- The three native modules are `require()`d inside functions (`check-native-import-safety.mjs`).
- Deleting an Apple user outside the app: `node scripts/revoke-apple-token.mjs <user-id>` FIRST,
  confirm revoked, THEN delete (`apple_refresh_tokens` cascades with `auth.users`).
- `handle_new_user` reads no metadata; names reach `profiles` from the client only.

## Module go-live SOP (ordered — the order is the point)
1. **Seed inactive** (`is_active = false`). Nothing visible or searchable.
2. **Verify the data while it is still invisible.** Dial every number; every image URL returns bytes.
3. **Activate the rows.** Opens a window (searchable, screen gated): keep it short, never end a
   session inside it.
4. **Spot-check in Turkish** on device, flag flipped LOCALLY and uncommitted; fixtures live here.
5. **Revert the fixtures.** Before anything else.
6. **Flip the flag in BOTH files in ONE commit** — `constants/flags.js` and
   `scripts/check-module-flags.mjs`. ⚠ Student Hub only: decide re-asking accounts on older terms
   here: `SELECT id, terms_accepted_at FROM profiles WHERE terms_version IS NULL OR terms_version < '2026-09-20';`
7. **Stash check, then clean tree.** A long-lived stash stays stashed.
8. **`npm run ota -- --message "..."`** — never `eas update`; args after `--` keep the guard running.
9. **Verify on device across two full open → wait → kill → reopen cycles**, on the Play Store build.
10. **THEN `notify_module_waitlist('<module>')`.** ⚠ A burnt list and an empty list both return 0,
    so read the list BEFORE (expect `0/n`) and AFTER (expect `n/n`, stamped today):
    ```sql
    select module, count(*) filter (where notified_at is not null) as notified, count(*) as total,
           min(notified_at) as first_stamp, max(notified_at) as last_stamp
    from module_waitlist group by module order by module;
    ```
    Any stamp on a never-launched module = the list was consumed. Then add the module to
    `WAITLIST_BLAST_DONE` in `check-module-flags.mjs`.
Steps 6 and 10 are enforced by `check-module-flags.mjs`; the rest rely on this list.

## Advisor

Consult the advisor before writing any Supabase migration, RLS policy, or module flag change, and before declaring a task done.

## Don't
- Don't add analytics, tracking, or third-party SDKs without asking.
- Don't generate large files of placeholder/sample code — ask what's real.
- Don't mark a provider `verified: true` in code; verification is a manual step I do.

## Dev journal summaries (when I ask)
Headline + type (OTA / native / hotfix / refactor) · "What changed" by area · "Why" (1-2 sentences)
· "Watch out for" · an options table with tradeoffs when more than one approach existed ·
"→ architecture.md updates needed" if structural.

## Open windows / pending (vault = `~/ObsidianVault/10-ada/`)
- 1.2.0 permission strings (live only once 1.2.0 installs; Play health declaration drafted when the
  build is scheduled) + Android RTL-mirroring device check → `2026-09-20_native-permission-strings-PARKED.md`.
- Store-update force tier untested on both platforms → vault `claude-md-lessons.md`.
- Play listing pushed 2026-09-28: check Console for the review verdict.
- Student Hub stale-affiliation recovery path (window: Hub OTA → `20261027`; applied? check
  `schema_migrations_applied`) → `claude-md-lessons.md` "Student Hub recovery path".
- Student Hub message push deep link, WARM and COLD, on the Play Store build → same file.
- Student Hub terms re-ask (SOP step 6): `studentHub` is `true` in flags.js; decision unrecorded.
- Image messaging safety scope → `2026-09-20_image-messaging-safety-scope-PARKED.md`.

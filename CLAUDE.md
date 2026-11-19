# ADA — North Cyprus assistant

## What this is
ADA is a TRNC super-app for residents and newcomers: facilities directory and duty roster, Explore
(places, walking routes), events, accommodation, hotels, towing, home services, pets, Student Hub and
more, each module behind `MODULE_FLAGS` (`constants/flags.js`). Expo SDK 54 + Supabase, 9-language
i18n (`constants/i18n.js`). Roles: customer, provider, admin; guests via `signInAnonymously()`.
I am the architect, you are my fast hands; I review everything.
Incident backstories for the rules below: `~/ObsidianVault/10-ada/claude-md-lessons.md`.

**Touching supabase/, SQL, RLS or migrations? Read supabase/CLAUDE.md first.**

## Stack & versions
- React Native + Expo **SDK 54** (managed). `index.js` → `App.js`; client `lib/supabase.js`;
  dev server `npx expo start -c`.
- ⚠ **Never change package versions.** Pinned to SDK 54 to match the test phone's Expo Go. Never
  upgrade expo/react/react-native; add packages with `npx expo install <pkg>`, never `npm install`.
  If a task seems to need a version bump, STOP and ask.

## ⚠ Standing warnings
- ⚠ **1.4.3 store lane (Berke, 2026-11-16): `feat/store-1.4.3`** = version 1.4.3 + changelogs 28 on top of main; main
  stays the 1.4.2 OTA lane; 1.4.3 builds come from the lane; it merges into main only when 1.4.3 is live in BOTH
  stores. **1.4.3 fixes (Berke, 2026-11-19):** fix PR to main first → sync PR main → lane → `npm run ota:preview`
  from the lane → Berke's device check → his go on the exact lane SHA → `npm run ota` from that SHA, detached (the
  `feat/store-*` exemption below). Lane-direct PRs only for code that exists only on the lane (the age-tick screens).
  1.4.3 production OTAs are HELD while iOS 1.4.3 (29) is in App Review (see Release holds).
- ⚠ **Play: ADA is NOT a health app — deliberate, tested; do not "correct" it.** See Compliance.
- ⚠ **`expo.locales` must never gain `ar` or `fa`.** An Arabic/Persian `.lproj` makes RN mirror the
  whole iOS layout (`allowRTL` defaults YES, read at bridge init). RTL is a separate app-wide decision.
- ⚠ **Image messaging is blocked on a safety scope** (vault `…image-messaging-safety-scope-PARKED.md`):
  no attachment column, bucket or upload path until it is answered. Private between minors, the word
  filter cannot see an image, no auto-hide for messages. Never a public bucket (guessable URL); image
  buckets are public today, only `avatars` is private (signed URLs, `Avatar.js`).
- ⚠ **Never raise `min_supported_version` above `'1.0.0'`** without the force-tier device pass.
- ⚠ **OTA only via `npm run ota`; web only via `npm run web:deploy`** — the wrappers are the only guard.
- ⚠ **Production DATA is written only from GitHub Actions** (see "Production operations"). The service
  key and ORS key live only in the GitHub `production` environment (deployable from
  `main` only; since 2026-10-12), plus `production-storage`'s OWN secret key (below) — never repo-level, never on this Mac, never in the Keychain. Every writer calls `prodWriteGuard()` first (`npm run check:prod-writes`, pre-push). New
  writer = new `workflow_dispatch` workflow, dry by default.
- ⚠ **Supabase CLI on this Mac (Berke, 2026-10-07; replaces the 2026-10-01 "never `supabase login`").**
  Long-term login in the Keychain ("Supabase CLI"); since 2026-11-19 the token "ADA Mac – Claude Code (logs)",
  scoped to trnc-health only: Project Settings read; Database, Edge Functions, Edge Function Secrets read-write;
  Logs read (`analytics_logs_read`: read-only `GET /v1/projects/<ref>/analytics/endpoints/logs`, ClickHouse SQL on one
  `logs` table; `logs.all` is removed); NO API-keys read (so `supabase link`
  fails — not needed, and it keeps the service key unreadable). Always through `scripts/sb.sh` (token +
  `--project-ref`; CLI 2.104.0's `secrets` ignores the Keychain; allowlist: `functions`/`secrets` only).
  Claude sets function secrets itself
  (`scripts/sb.sh secrets set --env-file <600 file>`, never the value on a command line; check by digest:
  `secrets list` value = sha256) and deploys functions itself with `scripts/fn-deploy.sh <fn> --go`
  (verify_jwt from deploy-config.json) — **only after Berke's go**, like every migration and OTA.
  Still never from the CLI: `db push`, `db reset`, `db query`/SQL against prod — migrations only via
  `supabase-migrate`. Fallback without this Mac: `supabase-function-secrets` + `supabase-functions-deploy`.
  Lost Mac → revoke the token (Supabase → Account → Access Tokens).
- ⚠ **GCP / Maps / Places keys:** before ANY `gcloud`, API-key, Maps-key or EAS-env key work, read
  `.claude/reference/gcp-and-maps-keys.md`. Never `gcloud … get-key-string`.
- ⚠ **`eas-cli@24.7.0` pin in the iOS wrappers is load-bearing** — never swap back to bare `eas`.
- ⚠ **No RLS or storage policy changes through the Supabase dashboard. Migrations only.**
- ⚠ **`production-db` keeps its required reviewer (Berke) — never remove it** (Berke, 2026-10-14; removal
  cancelled). It is the ONLY lock on a migration apply that holds against `ada-hermes-bot` (repo WRITE, can
  dispatch workflows; `main` needs 0 approvals, so it could also merge away an actor check in the workflow)
  and against local Claude sessions. Main-only on `production` stays too. Since 2026-10-18: **Berke is the
  only approver**, `prevent_self_review` ON, admin bypass OFF — so **production runs are started by Code**
  (a run Berke starts himself cannot be approved by him). Code never approves a deployment (PreToolUse hook
  `.claude/hooks/deny-deploy-approval.sh`, also in `~/.claude/settings.json`; keep it).
  **Image uploads no longer sit behind it** (Berke, 2026-10-31): an `eatery-images` upload apply runs on its own
  after a clean dry, from the `production-storage` environment (main only, no reviewers, service key + URL only).
  **`production-storage` holds its OWN Supabase secret key** (`sb_secret_…`, Berke 2026-10-31), deliberately
  NOT production's: its fingerprint differs from `production`'s by design. The check is "an eatery-images dry
  run passes", not "fingerprint matches production". Revoke it in Supabase → API keys without touching any
  other lane (then the image lane fails until a new key is set there).
  Accepted consequence: an image committed to `data/eatery/` on main can be uploaded and rows repointed with no
  human gate. A prune (deletes) still waits for `production-db`.
- ⚠ **Local Claude sessions act on GitHub as the App `ada-claude-code[bot]`, never as `berkeustun95`**
  (2026-10-18; App 5372493, installation 172817185, `trnc-health` only). `gh` = wrapper `~/.local/bin/gh`,
  git over https = credential helper, both minting a 1-hour token from `~/.config/ada-claude-code/` (private
  key 600, never in the repo); commits authored as the bot via `env` in `~/.claude/settings.json`. Berke is
  logged out of `gh` on this Mac and has no SSH key on GitHub. A 401/403 means the App lacks a permission —
  ask Berke; never work around it with his credentials. The App cannot change environments (403 by design).
  Vault `2026-10-18_claude-code-github-identity.md`.
- ⚠ **Live-strip notice card is DORMANT, not dead** (`kind='notice'`, `NOTICE_FALLBACK` in `LiveStrip.js`, rank 3b
  in `homeStripResolver.js`, `stripNoticeTitle`, `utils/stripDismissals.js`). Don't delete or repurpose it;
  re-enable = one `UPDATE … SET is_active = true`. Same for the `showAgentOnboarding` branch in App.js.
  It is OFF by product decision ("Bugün ADA'da" = events + duty, no announcements): never repurpose it
  for announcements; re-enabling = one UPDATE on the existing row.

## Release & deploy
- **JS-only change:** `npm run ota -- --message "…"` (note the `--`). Pre-flight: stash check, then
  clean tree (a long-lived stash is not a blocker and stays stashed). Never `eas update` directly:
  it bundles the WORKING TREE, so an uncommitted `MODULE_FLAGS.x: true` ships to every user. The
  wrapper runs `check-module-flags.mjs` (also `npm run check:flags`); `git push` and `eas build` are
  covered by `.githooks/pre-push` and `eas-build-pre-install`. Fresh clone: `npm run setup:hooks`.
- **`release/*` lane exemption** (`scripts/lib/release-lane.mjs`, `npm run release-lane:test`): `ota:preview`'s "contains origin/main" and the Preview-lineage check are waived only on a `release/*` branch of a DIFFERENT runtime than main whose every non-merge commit is a `cherry-pick -x` of a commit on main touching the same paths (merge originals via `-m 1`): an exact blob match where the pre-image matches main's; where a file diverged, a verbatim `git patch-id` (diff pinned to -U3, no `GIT_DIFF_OPTS`) plus each hunk's pre-image occurring exactly once in the lane file, printed as "file diverged"; clean tree, merges only as PR merges whose tree equals the PR head; read from git, no flag, picks printed. Anything else still needs HEAD ⊇ main.
- **Preview-lineage and `release/*` Previews:** from a non-release HEAD (main), a Preview built on an `origin/release/*` lane counts as contained only if every commit in `preview --not HEAD` is a PR merge or a `cherry-pick -x` copy of a commit in HEAD, proven by the same `provePick` as above (printed copy → original); anything else refuses and names the commit.
- **`feat/store-*` lane exemption** (`scripts/lib/store-lane.mjs`, `npm run store-lane:test`, Berke 2026-11-19): a HEAD
  whose runtime differs from main's may publish (Preview and production) only as a store lane, all read from git/GitHub,
  no flag: L1 HEAD's version V ≠ main's, branch (if named) is `feat/store-V`, HEAD is on the pushed `origin/feat/store-V`;
  L2 main's runtime is below V (main reaching V = "lane closed", the automatic end); L3 GitHub's rules for the lane show
  pull_request + non_fast_forward + deletion (refuses until `refs/heads/feat/store-*` is in `protect-release-lanes`);
  L4 clean tree. `ota:preview` still needs HEAD ⊇ origin/main (sync first) and prints the lane-only commits; any other
  version mismatch is refused unless a proven `release/*` lane. Lane `npm run ota`: lineage checks only Previews on exactly
  V and needs one built from a commit with HEAD's exact tree; preflight needs HEAD ⊇ main's live production commit and ⊇
  the newest finished production store build per platform of V (every runtime, main included). From main, a Preview is
  excused only if its runtime is newer than main's and it sits on `origin/feat/store-<its runtime>` (printed).
- **ONE session at a time on the Preview channel and the test phone — the preview lock** (Berke, 2026-11-01:
  a Preview published minutes after another's replaced it on the phone mid-check, and an Expo Go session took the
  phone mid-run). Before `ota:preview` or ANY phone use (adb, screenshots, Expo Go):
  `node scripts/preview-lock.mjs take <holder> "<what for>"`, publish with `ADA_PREVIEW_HOLDER=<holder> npm run
  ota:preview` (refuses unless you hold it, naming who does and since when), and `release <holder>` after your phone
  check. Held by someone else → wait or ask; never `--force` without Berke's word (log it). `status` shows the holder.
  Lock file: vault `locks/preview-phone.lock.json` (exclusive create; no expiry). `screenshot-android.sh` checks it too.
  **Expo Go and dev bundles count as phone use** (Berke, 2026-11-01, after Expo Go sat in front of ADA Preview with the
  lock held by another session): take the lock BEFORE `screenshot-android.sh --prep` (the Metro link), `npm start` /
  `npm run android` aimed at the phone, or opening any project in Expo Go or a dev client on it — and when you
  release, leave ADA Preview in front (`am force-stop host.exp.exponent`), not your dev bundle.
  `npm start` / `npm run android` enforce it (`preview-lock.mjs check --if-phone`) while the test phone (serial
  R58N602DHYT) is attached over adb: run them as `ADA_PREVIEW_HOLDER=<holder> npm start`. Expo Go by QR with no adb
  link cannot be seen by any script — the rule still applies.
- **ONE production publish at a time — the production lock** (Berke, 2026-11-01: two sessions each had a production go;
  both preflights read production before either update landed, and the slower one replaced the other a minute later,
  dropping the map chip). Before `npm run ota`: `node scripts/preview-lock.mjs --production take <holder> "<what for>"`,
  publish with `ADA_PRODUCTION_HOLDER=<holder> npm run ota` (refuses unless you hold it), keep it until the IDs are read
  back with `eas update:view`, then `--production release <holder>`. Held by someone else → wait, then re-read what
  production runs: your HEAD must contain it (the preflight refuses otherwise). Never `--force` without Berke's word.
  Separate file (vault `locks/production-ota.lock.json`) from the preview lock; one session may hold both.
- **OTA only reaches the production build** — never a preview APK; test OTA on the Play Store install.
- **Every production OTA goes to PREVIEW first** (`npm run ota:preview`) and gets Berke's device check
  there before `npm run ota` (standing rule since the 2026-10-06 unfreeze). A freeze, when on, is
  `release-freeze.json` `"frozen": true` — `npm run ota` then refuses (`FREEZE_OVERRIDE=1` from Berke only).
- **Release holds** (`release-holds.json`, `scripts/check-release-holds.mjs`, Berke 2026-11-08): a merge on main
  that is NOT cleared for production. `npm run ota` refuses while HEAD contains an uncleared hold; no env override.
  Clearing = `"cleared": true` in a PR, only after Berke's go in chat. A hold may also name a store-lane-only commit:
  it then blocks that lane's production OTAs and never main's (main lacks the commit; holds are by ancestry, nothing
  requires a main merge). **Held now: the 1.4.3 lane** (commit `03e738a0`, the lane's 1.4.3 version bump, its first
  lane-only commit, so every lane HEAD carries it) while iOS 1.4.3 (29) is in App Review. Lift: after Apple approves 29
  and Berke says go, a PR to main sets `"cleared": true`, then a sync PR carries it into the lane. Preview is unaffected.
- **Nothing Previewed stays off main.** Publish Preview only from a branch that contains main. `npm run ota`
  refuses while any Preview update on this runtime's major.minor was built from work HEAD lacks
  (`scripts/check-preview-lineage.mjs`); a Preview Berke explicitly dropped: `PREVIEW_LINEAGE_OVERRIDE=1`
  (he hands it over; log it). 2026-10-06: a Previewed Profile fix lived only on `fix/open-now-json`.
- ⚠ **One publisher at a time; Berke's go names the commit** (Berke, 2026-10-24). (1) Only ONE session publishes
  production OTAs at a time: before `npm run ota`, read the latest production update per runtime
  (`npx -y eas-cli@24.7.0 update:list --branch production --limit 5 --json --non-interactive`) and which session
  made it; coordinate first if another session published recently or is mid-release. Every production `--message`
  starts with the publishing session's name in brackets (`npm run ota -- --message "[trnc-health-79] …"`): EAS shows
  `berkeustun95` for every session, so the tag is the only way `update:list` tells them apart. (2) No production OTA without
  Berke's explicit go for THAT EXACT commit: `git log <previewed-commit>..HEAD` must show only approved release steps
  (other sessions merge into main in between); publish a pinned detached SHA; quote his go + SHA in
  the vault log. 2026-10-24: Logo v2 #172 rode along in OTA 01a16de1 unpreviewed; two sessions published the same
  runtimes within an hour.
- **Native build** only for `app.config.js`, native deps, permissions, icons, SDK: `eas build --platform
  android --profile production`. **Play releases go through Code** (since 2026-10-09; the service account has
  "Release to production"): `fastlane supply --aab <aab> --track production` with `changelogs/<versionCode>.txt` in all 9
  folders (`store:check` covers them), skipping metadata/images; `--validate_only true` first, then read the track back
  (`google_play_track_version_codes`). Production updates go through Google's review. No more manual AAB uploads.
- **iOS:** `npm run ios:build` / `ios:submit`, no Apple login; they source `~/.appstoreconnect/ada-eas.env`
  (outside repo) → ASC key "EAS Build" (`WYJ38BNP8L`, Admin, team MAQ8XPJ8Z6). Only a key passed via
  `EXPO_ASC_API_KEY_PATH`/`_KEY_ID`/`_ISSUER_ID` (+ `EXPO_APPLE_TEAM_ID`/`_TYPE`) regenerates profiles;
  an EAS-stored key never does. Never commit/print/copy the key; lost Mac → revoke in ASC → Users and Access.
- **Never use `process.env.EAS_BUILD` in `app.config.js`.** Hardcode `checkAutomatically: 'ON_LOAD'`.
- **Permission strings:** ONE source each, its plugin option (`ios.infoPlist` is inert). Mic off, camera
  kept (accepted review risk), background location off. Verify: `npx expo config --type introspect`.
- **EAS env vars:** `eas env:create` (not `secret:create`); changes need a native build.
- **Maps / Google keys per build and per project:** `.claude/reference/gcp-and-maps-keys.md`.
- **`web/` publishes** `getadaapp.com/privacy` and `/support` (Cloudflare Worker `getadaapp`, root
  `wrangler.jsonc`); both URLs are registered with the stores. `npm run web:deploy`, never
  `npx wrangler deploy`: it runs `check-web-assets.mjs`, and wrangler REPLACES the asset manifest, so
  a missing `support.html` silently 404s. `git push` does not publish `web/` (`docs/` is GitHub Pages).

## Production operations (`gh workflow run <name>`, then `gh run watch`)
Every one is manual (`workflow_dispatch`) and dry unless `-f apply=true`; its secrets come from the `production`
environment, so it runs only from `main` (a job on any other branch is refused). A job that needs one of them
adds `environment: production`. Check a secret's identity with `key-fingerprint` (sha256 prefix, never the value).
- Gişe Kıbrıs sync: `gisekibris-feed` (also daily 04:15 UTC). Health: its Content health step.
- Hotels: `hotels-import -f file=data/kitob/<f>.csv -f list_date=YYYY-MM-DD`, `hotels-window -f mode=--apply|--rollback`,
  geocoding `hotels-geocode -f limit=N` (Places calls are billed; an apply commits google-pins.csv back).
  **No standing Places key** (server-geocode-temp deleted 2026-10-31): create a fresh Places-only key in ada-app-499617
  for the run, set it as `production` secret `GOOGLE_PLACES_API_KEY`, then delete key + secret after.
  HotelRunner links: `hotelrunner-links -f mode=--apply` (writes `data/kitob/hotelrunner-links.json`, clears unlisted hotels).
- Walking legs: `walking-legs` (a flagged leg exits 1 by design; it is never written).
- Eatery images: `eatery-images -f slug=<slug>` (dry), `-f apply=true` applies with NO approval once the dry is
  clean (adds objects / repoints rows only); `-f prune=true -f apply=true` deletes and waits for `production-db`.
- Novest: `novest-import`, `novest-images` (metadata also syncs on cron via the sync-novest function).
  `novest-images` also runs on schedule at 05:20 / 15:20 UTC and APPLIES (approved 2026-10-11): add-only,
  a no-op when nothing is due, red on any failed image. Until it runs, a new listing stays hidden.
- Apple user deletion: `revoke-apple-token -f user_id=<uuid>` BEFORE deleting the user.
- Edge functions: `scripts/fn-deploy.sh <name> --go` from this Mac, or `supabase-functions-deploy -f
  function=<name>|all`. verify_jwt comes from `supabase/functions/deploy-config.json` (read from prod);
  a new function is added there first (and to the workflow's choice list). Secrets: `scripts/sb.sh
  secrets …` or `supabase-function-secrets -f name=<NAME>` (from the repo secret of that name).
- Health: `daily-health` (05:00 UTC daily: hotels, novest health, novest photos (fails > 10% of live
  listings photo-less), notify). A red run emails. `npm run novest:verify` is post-import only, by hand in CI.
- Migrations: `supabase-migrate -f file=<FULL name>.sql` (dry: SQL + ledger check), then `-f apply=true`, which
  WAITS until Berke approves the `production-db` environment in GitHub (Actions → the run → Review deployments).
  **A release's migrations go in ONE run** (one approval): `-f files="<a>.sql <b>.sql"`, the explicit list of
  that release's pending files in name order (never "whatever the ledger lacks": some files stay unapplied on
  purpose). Each file is its own transaction; the first failure stops the run and names what committed.
  Stamp first (`node scripts/migration-ledger.mjs --stamp <file>`; `--verify` checks it). Never `db push`:
  prod has no CLI ledger and 13 prefixes repeat. Details: supabase/CLAUDE.md.

## Store-update popup
Before touching `app_versions` or `min_supported_version`: read `.claude/reference/store-update-popup.md`.

## Play listing
Before editing `fastlane/metadata/`, running `store:listing` or reading Play reports: read
`.claude/reference/play-listing.md`. `npm run store:check` enforces the listing rules.

## Compliance (Google Play, declared mixed-audience app)
- ⚠ **Category Travel & Local, Health declaration "no health features" — do not re-tick it,** even
  though Google's category text reads otherwise. Declaring health forces an Organization account; ADA
  is individual (the 2026-07-06 rejection). Directory + duty roster stay as a local directory. The
  unlock is an Organization account. Record: vault `play-console-status.md`.
- Ages 13-15 / 16-17 / 18+: under-18s (by DOB), AND anyone without a DOB, get NON-PERSONALIZED ads and no promos from day one of any ad SDK.
- Never add an SDK disqualified under Play Families policy without flagging it (one bad SDK makes
  the whole app ineligible — analytics included).
- Account age and content visibility are separate: the future kids module runs as guest or under a
  parent account; no coupling beyond `GATE_EXEMPT_MODULES`.
- `MIN_SIGNUP_AGE` lives in `constants/profileGate.js`, mirrored as `interval '13 years'` in the
  20261001 trigger (cannot be a CHECK); `npm run profile:check` compares them. Never inline it.
- Since 2026-11-18 (Apple 5.1.1(v), Berke) sign-up asks a required "{MIN_SIGNUP_AGE} or older" tick
  (`profiles.age_confirmed_at`, server-stamped; completion CHECK = DOB OR tick). DOB and nationality are
  optional; a DOB given + under 13 → the age-ineligible block as before; the year list still stops at
  `currentYear - MIN_SIGNUP_AGE`.

## How I want you to work
- Make MINIMAL changes; no unrelated refactors. Say it's done, explain shortly — don't ask to proceed.
- One bounded task at a time. If scope is unclear, ask.
- **One task per session** (Berke, 2026-11-16). When a task is done, or context passes ~200k, end the reply with
  the line "✅ Task done, run /clear now" so Berke clears before the next task.
- **Provider accounts are out of scope** (provider, home_service_provider and every other non-customer provider
  role): never change how they look or behave without Berke's explicit ask (Berke, 2026-10-26).
- Match the data-fetch pattern: query Supabase → useState → render.
- **Ask for ONE item per message** (an ID, a query result, a decision) and wait.
- **Push the working branch after EVERY slice**, feature branches too ("push to git" still = main).
- **Device tests never run from `~/trnc-health`** (shared with other sessions; Metro bundles its
  folder's working tree). **Create a fresh worktree from current main when needed (redesign Expo
  server, tunnel tests):** `git -C ~/trnc-health worktree add ../trnc-health-<task> origin/main`, then
  LAN `EXPO_NO_REDIRECT_PAGE=1 npx expo start --lan --go` or tunnel
  `EXPO_NO_REDIRECT_PAGE=1 NODE_PATH=~/.npm-global/lib/node_modules npx expo start -c --tunnel` there.
  Without the env var the QR is an http `/_expo/loading` chooser (expo-dev-client is installed), which
  the iOS camera opens in Safari.
- **iOS devices use TestFlight "My Expo Go (11d951)" (SDK 54).** Delete the App Store Expo Go from the
  device (both claim `exp://`; iOS may pick the wrong one), allow Local Network on first open, then
  scan the terminal QR with the Camera → "Open in My Expo Go". Never hardcode the Mac's IP (DHCP).

## Security (non-negotiable)
Why: profiles, reviews and messages are personal data on a declared 13+ mixed-audience app, and a
name joined to a clinic review is a health disclosure about an identified person.
- RLS is the security boundary. Every table with user data has RLS on with role-appropriate policies.
- When you write or change a policy, explain in plain English who can read/write what.
- A customer must NEVER be able to read another customer's data.
- Never put the service_role key or DB password in app code; only the anon key in `lib/supabase.js`.
- Policies change through migrations only. `TO authenticated` includes guests (only
  `NOT is_anonymous_session()` excludes them); every denial check needs a positive control. See supabase/CLAUDE.md.

## Conventions
- Functional components with hooks; small components; one screen per file. `maybeSingle()` returns
  `{data: null, error: null}` on zero rows; it does not throw.
- `facilities.type` is limited by `facilities_type_check`: pharmacy, clinic, hospital, dentist, vet,
  grooming, garage (repo migrations; confirm live with `pg_get_constraintdef`).
- **Languages are stored as FULL ENGLISH NAMES** (`'Turkish'`), never ISO codes: the `LANGUAGES` keys in
  `constants/i18n.js`, through `preferred_language`, `lang`, `t()`, `*_i18n.lang`, `module_notif_text`.
  An ISO comparison matches nothing, silently. New per-language columns get a CHECK rejecting `'tr'`/`'en'`.
- `facility_change_requests.proposed_changes.languages` is a comma string; split before writing
  `facilities.languages` (`text[]`): `changes.languages.split(',').map(l => l.trim())`.
- Admins never reach HomeScreen (role-first selector): previews enter via AdminScreen's `adminPreview`, never an `isAdmin` Home tile.
- **Never use an admin as a test identity**: `|| isAdmin` unlocks dark modules and swaps the
  deterministic featured sort for a random shuffle (`utils/featured.js`). Use a guest or a real
  customer; reach dark modules by flipping the flag locally, uncommitted.
- A fixed-height sibling above a scrollable list in a `flex:1` column needs `flexShrink: 0`.
- **`MODULE_FLAGS` does not gate search** (`search_content`). Pre-launch content is seeded in its
  table's unpublished state and published in the same step as the flag.
- New admin-seeded directories DEFAULT to unpublished (`is_active DEFAULT false`), with an H token.
- **A live Novest listing with no `property_images` row is hidden from app users** by the RESTRICTIVE
  policy `props_hide_photoless_novest` (20261068) and reappears on the next read once a photo row exists:
  no flag, no job, no OTA. Never delete or delist a listing to hide it. `daily-health` lists the hidden ones.
- EXPIRING content ships with a staleness check (`check-*-staleness.mjs`, hand/cron, not pre-push); a
  table that cannot legitimately be empty renders empty as an ERROR STATE.
- All back handlers register via `addBackListener` (`utils/backHandler.js`), never
  `BackHandler.addEventListener` directly (iOS edge swipe skips it). `npm run backlistener:check` and
  `npm run backchain:check` run in `npm run ota`; add a backchain case when a layer joins the chain.
- Spot-check new UI in Turkish before declaring it done (longer strings surface layout bugs).

## Verification principles
1. A green check is evidence only once seen red. Fix what the test measures; never widen a tolerance.
2. A red-first run asserts TWO things: the break landed (`python3` `assert anchor in text`, not
   silent `sed`) and the probe noticed. A slice between markers asserts it contains what it must.
3. Derive, never hardcode: assert `count(*)` and PRINT the rows, never a remembered name list
   (policies, triggers, constraints, grants, cron). Bump a count in the same commit, saying why.
4. Before a run, ask what a PERFECT system would print. If a broken one prints the same, it is not a
   probe. Run a positive control where it is cheap.
5. Check and checked must be in the same frame of reference (file, URL, encoding, role). Print the raw
   value beside the expectation, and put it in the failure message.
6. When a check fails, the first hypothesis is the check. Ask what it would forbid a CORRECT system
   from doing. Prefer a reading that needs no decoding.
7. A migration file, comment or doc is intent; the live catalogs are the authority. Quote which you read.
8. When re-verifying, name the surfaces covered (client, RPCs, INVOKER/DEFINER, views, edge fns).
9. When a guard goes green, say which question it answered ("the file exists" ≠ "it works in prod").
10. Never verify a write from a role that is not allowed to read it.
11. Use `IS DISTINCT FROM` / `IS NOT DISTINCT FROM` wherever NULL is reachable (`<>`/`=` go silent).
12. Truncation guards compare `count: 'exact'` to rows received, never `rows >= cap` (server `max-rows` wins).
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

## Geocoding — storage policy (revised 2026-09-29)
- **Google Places pins are an ACCEPTED KNOWN RISK for pharmacies and hotels** (breaks Places' 30-day
  cache limit and, on iOS Apple Maps, display terms; risk = key suspension). No deadline. Every
  Google pin has a row in `data/geocode-exceptions/google-pins.csv` (`kind;id;name;place;address;reason`,
  never coordinates): add the row in the same commit as the pin; an OSM replacement removes it.
- Map links: the Apple Maps risk applies to pharmacies only; hotels deliberately open in Google Maps
  (Harita). Do not unify them.
- **Prefer OSM where it agrees:** `geocode_source` `osm` (tier 1, `google_places` in corroboration);
  `components/OsmAttribution.js` on every map/card showing an `osm` pin (ODbL). OSM data only via
  `scripts/lib/osm-snapshot.mjs` (main Overpass, ≤ 72 h; a mirror served stale data).
- A Google pin is saved only when corroborated: region + address town, plus phone, name or OSM. A
  hotel that fails gets NO pin; its Harita button searches "<name>, <town>, North Cyprus".
- `geocode-pharmacies-tier2.mjs` is retired. OSM hand placement (`npm run place`) is SHELVED: no OSM editing.

## Social sign-in (Google + Apple)
Before touching sign-in, `utils/socialAuth.js`, account deletion or Apple tokens: read
`.claude/reference/social-sign-in.md`.

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
10. **THEN `notify_module_waitlist('<module>')`** (earlier sends people to a stale screen). ⚠ A burnt list and an empty list both return 0,
    so read the list BEFORE (expect `0/n`) and AFTER (expect `n/n`, stamped today):
    ```sql
    select module, count(*) filter (where notified_at is not null) as notified, count(*) as total,
           min(notified_at) as first_stamp, max(notified_at) as last_stamp
    from module_waitlist group by module order by module;
    ```
    Any stamp on a never-launched module = the list was consumed. Then add the module to
    `WAITLIST_BLAST_DONE` in `check-module-flags.mjs`.
Steps 6 and 10 are enforced by `check-module-flags.mjs`; the rest rely on this list.

## Check-ins (LIVE 2026-10-09)
Launched: flag flip `843c01a`, production OTA `27cdaa7d` (Android `01a1201f`), waitlist 3/3 notified (20261100).
DB `20261092` + `20261093` (+ `20261094` test-data cleanup); `google-places` Edge Function; policy 2026-10-08.
- Feeds only: no per-person check-in history anywhere (decided 2026-10-02). EEA Maps terms apply (billing Cyprus):
  no Google place name on or next to a map. Google calls stay anonymous + 4-dp rounded (pre-push guard
  `check-google-calls-anonymous.mjs`; Maps ToS §4.4 closed on exactly that).
- iPhones show Google pins only from a build carrying the Google Maps SDK (`GOOGLE_MAPS_IOS_API_KEY`, every iOS build
  from 2026-10-07); App Store privacy must add the SDK's data types (vault store-forms file) with that build.
- ⚠ Never dispatch `20261078`/`20261069` check-ins files from old branches (deleted 2026-10-08).
- Watch: `gh workflow run supabase-readonly -f file=supabase/readonly/checkins_launch_watch.sql` (calls vs caps,
  check-ins, pins, notices, submissions; sealed, open with `node scripts/readonly-results.mjs <run-id>`). Function errors: Dashboard → Edge Functions → google-places → Logs.

## Team workflow (`.claude/agents/`)
**Routing** (Berke, 2026-11-12): hard work goes to **principal-engineer** (Opus) first, without asking: planning
a new feature or module; a bug still unfixed after one attempt; schema, RLS or migration design; multi-file
refactors or architecture choices; auth, payments or security-sensitive code (also **security-code-reviewer**);
deciding whether something is ready for production. Everyday work stays in the main chat: running tests,
on-device screenshots, small fixes, i18n edits, commits, OTAs.
Main-chat work still gets a check before it ships: **once per branch, on its finished head, before merge** (not
once per slice or per commit), run **qa-tester**; if i18n files changed, also **translation-reviewer**; if auth,
RLS, payments or secrets are touched, also **security-code-reviewer**. Fix every FAIL, then re-run only the check
that failed (Berke, 2026-11-16: 53 security reviews and 31 QA runs in 3 days).
**Never pass `model: opus` (or any `model`) to a subagent. Use the model in its agent file** (Berke, 2026-11-16).
Flow for the work principal-engineer owns: Principal → senior-app-engineer /
senior-backend-engineer / data-content-engineer → security-code-reviewer + translation-reviewer (every branch)
+ ui-ux-designer (any UI change) → qa-tester → (FAIL: back to the senior, repeat until PASS) → release-engineer.
The three reviewers are read-only.
ui-ux-designer preloads `.claude/skills/` ada-style + frontend-design + ada-*-audit; its eyes are
`scripts/screenshot-android.sh` on Berke's Android phone over USB, the only device (`--prep` … `--shutdown`);
no emulator on this Mac, no device on Hermes. One screen per polish PR. Parked
backlog: `~/trnc-health/.designer/backlog.md` (local, git-excluded).
Principal never ships its own unreviewed code; release-engineer never runs without a QA PASS.
**Test runs on this Mac (Berke, 2026-11-15; load average 293 and 8 jest timeouts when a review fan-out and a
pre-merge suite ran at once on 4 cores).** (1) Only **qa-tester** runs jest and the full guard suite; reviewers
(security, translation, design) only read code, and seniors leave the suite to QA. The main chat runs it only for
its own pre-merge check. (2) jest is capped at 2 workers (`"maxWorkers": 2` in package.json); never pass a higher
`--maxWorkers`. (3) One full suite at a time across sessions: `node scripts/preview-lock.mjs --suite take <holder>
"<what for>"`, run `ADA_SUITE_HOLDER=<holder> npm test` (refused without the lock) plus the guards, then
`--suite release <holder>` right away. Held by someone else: wait. **Heavy single checks take the same lock**
(Berke, 2026-11-15; the npm scripts refuse without it): `ads:selftest` (~86 s CPU),
`release-lane:test` (~31 s), `check:migration-numbers` (~21 s), `ads:check` (~6 s). Measured 2026-11-15; heavy =
5 s CPU or more. Every other check is light (under 2 s, `labels:check` included) and free to run, reviewers included. The small jest files in `ota`/`ota:preview` run
under the publish locks instead. Hermes has no vault, so the check passes there and says so.
Berke's gates are unchanged and stop the loop: migration apply, edge-function deploy, Preview device check
before every production OTA, web deploy, flag flips, version bumps. One question per message.

**Branch ruleset `protect-release-lanes`** (2026-10-12): `main`, `feat/voice-input`, `release/**` (and `feat/store-*`, added by
Berke for the store-lane exemption; L3 refuses until GitHub shows it) need a pull
request, no force-push, no deletion; only Berke's admin role bypasses (a Mac push prints "Bypassed rule
violations" — expected). ⚠ Never add a write DEPLOY KEY: on this personal repo it counts as admin and bypasses.
**Who merges** (Berke, 2026-10-23): Code on this Mac (`ada-claude-code[bot]`) merges its OWN PRs to `main`
(`gh pr merge`, allowed in the Mac-only `.claude/settings.local.json`; no ruleset bypass, the
0-approval PR rule already lets it). `ada-hermes-bot` PRs are merged by Berke only. A live migration still needs
Berke's `production-db` approval.
Sync PRs from `main` into a release branch (`release/**`) count as Mac Code's own PRs.
**Never merge a PR whose title contains DRAFT or WIP** (any case, any brackets), even when GitHub does not mark it
draft (Berke, 2026-11-14; #401 merged as "[DRAFT] …"). Retitle it first, and only once it is really ready.
**Draft → ready is Code's job** (Berke, 2026-10-31): when a PR is ready (reviews/QA passed, checks green), Code
runs `gh pr ready <n>` itself and tells Berke "ready to merge" with the PR link; he never has to undraft it.

**Hermes server** (`ada-hermes-bot`, Telegram team): before any Hermes, `ops/hermes/` or `agent/*` work, read
`.claude/reference/hermes-server.md`.

## Advisor
Main chat only. Consult the advisor before writing any Supabase migration, RLS policy, or module flag change, and
before declaring a task done. Some sessions have no advisor tool; when absent, skip this step. **Subagents never
call the advisor** (each call sends the whole transcript uncached; 130 of 145 calls came from subagents, 2026-11-16).

## Don't
- Don't add analytics, tracking, or third-party SDKs without asking.
- Don't generate large files of placeholder/sample code — ask what's real.
- Don't mark a provider `verified: true` in code; verification is a manual step I do.

## Dev journal summaries (when I ask)
Headline + type (OTA / native / hotfix / refactor) · "What changed" by area · "Why" (1-2 sentences)
· "Watch out for" · an options table with tradeoffs when more than one approach existed ·
"→ architecture.md updates needed" if structural.

## Open windows / pending (vault = `~/ObsidianVault/10-ada/`)
- **Next store release (not before "unfreeze") — Play Console warnings, 2026-10-05:**
  - **DEX code optimization below threshold** (Play deadline **Feb 2027**): enable R8 minify/obfuscation for
    Android release builds and upload the deobfuscation mapping file with each AAB. Native change → device pass.
  - **Deprecated edge-to-edge APIs** → address with the next Expo SDK upgrade (SDK bump = ask first).
  - **Large-screen orientation/resizability** → part of the tablet backlog (`supportsTablet: false`, portrait-only today).
- **Store builds (Berke, 2026-11-16):** **1.4.3** = Onboarding v2 in the embedded bundle; NO Sentry, widgets, R8,
  map-marker fix or edge-to-edge. **1.4.4** = Sentry on its own build: EU region, crash reporting only (no IP, no user ID,
  no session replay), **ON by default with a "Send crash reports" switch in Settings** users can turn off; ships with
  the privacy policy update and the Apple/Play form changes. Widgets (`feat/widgets-1.4.3`) come after.
  Vault `2026-10-25_store-release-readiness.md`, `2026-11-14_crash-analytics-options.md`.
- 1.2.0 permission strings (Play health declaration drafted when the build is scheduled; Android RTL device check) → `2026-09-20_native-permission-strings-PARKED.md`.
- Store-update force tier untested on both platforms → vault `claude-md-lessons.md`.
- Play listing pushed 2026-09-28: check Console for the review verdict.
- Student Hub stale-affiliation recovery test (window closes when `20261027` applies) → `claude-md-lessons.md`.
- Student Hub message push deep link, WARM and COLD, on the Play Store build → same file.
- Student Hub terms re-ask (SOP step 6): DECIDED + shipped in 1.3.0 — `StudentHubTermsGate` for signed-in
  non-guest accounts on terms < `STUDENT_HUB_TERMS_MIN` (2026-09-20); vault `redesign-go-live-runbook.md`.
- Image messaging safety scope → `2026-09-20_image-messaging-safety-scope-PARKED.md`.

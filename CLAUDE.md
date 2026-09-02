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

**`web/` PUBLISHES NOW. This reversed on 2026-08-30 — do not trust an older note.**
`web/privacy.html` and `web/support.html` are the LIVE assets behind
`getadaapp.com/privacy` and `getadaapp.com/support`, served by the Cloudflare
static-assets Worker `getadaapp` (root `wrangler.jsonc`). **Both URLs are registered with
the app stores** — /privacy is the Privacy URL, /support is the Support URL.
Publish with **`npm run web:deploy`, never `npx wrangler deploy`**: the wrapper runs
`scripts/check-web-assets.mjs` first, and like `eas update`, `wrangler deploy` bundles the
WORKING TREE and has no lifecycle hook, so the wrapper is the only place a guard can stand.
It is worse than the OTA case in one respect — **`wrangler deploy` REPLACES the asset
manifest rather than merging it**, so deploying a `web/` that is missing `support.html`
silently drops that page, and `not_found_handling: "none"` makes it fall through to Vercel
and 404. A store-listing outage that looks like an ordinary 404.
Until 2026-08-30 this folder deployed nothing and was documented as inert; it lived in
`~/ada-worker-support`, on one laptop, with no git — which is how it became unfindable.
`git push` does NOT publish it (that is `docs/`, via GitHub Pages).

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
- **Changing `normalize_for_moderation()` now also changes the display-name uniqueness
  key.** `normalize_display_name()` wraps it, and `profiles.display_name_normalized` is
  a STORED column filled by `check_profile_name_content()` — so a redefinition leaves
  every existing row carrying the OLD normalized value while new rows carry the new one,
  and the unique index stops comparing like with like. Recompute in the same migration:
  `UPDATE profiles SET display_name = display_name WHERE display_name IS NOT NULL;`
  (the trigger recomputes on write). This coupling is the price of enforcing uniqueness
  on the normalized form, and it was chosen over an expression index precisely because
  this failure is VISIBLE — an expression index on an IMMUTABLE-declared function would
  have gone silently corrupt instead, with no error at any point.

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
- **A verification block must DERIVE what it asserts, never hardcode a set it did not query.**
  `20260821` dropped one of the two `profiles` over-share policies and shipped this
  verification comment: *"Remaining SELECT policies: owner read, admin read all, admin read
  profiles."* **There were four.** The fourth — `owner read booking customer profile`
  (`20260726`) — has the same EXISTS predicate, lacks the `get_my_role() = 'provider'`
  prefix so it is WIDER, and granted every facility owner the full profile row (phone,
  nationality, push_token, strikes, ban timestamps) of anyone who booked with them. It
  survived six weeks unnoticed and was still LIVE in production when found (confirmed via
  `pg_policies`, 2026-08-27). Dropped by `20260922`, applied and verified the same day.
  The list was written from what the author had in mind, not from `pg_policies`. **A check
  that hardcodes an expected set cannot fail correctly**: it goes green when the one thing
  it names is absent and stays silent about everything it forgot to name — so it is
  strictly worse than no check, because it certifies the blind spot. Sibling of the green-
  check rule above, and the sharper form of it: that rule says watch a check go red; this
  one says a check phrased as a remembered list has no red to go to.
  So: assert `count(*) = 3` and PRINT the rows, not `NOT EXISTS(policyname = 'the one I
  remember')`. Register the count, not the name. If a legitimate new object takes the count
  to 4, bump it in the same commit and say why — that edit is the review moment the name
  list never creates. Applies to any enumerable set a migration touches: policies, triggers,
  constraints, grants, cron jobs.
  Corollary, learned the same day: **when you re-verify a claim, state which surfaces you
  actually covered.** "Nothing reads it" from a client-code grep is not the same claim as
  "nothing reads it" — RPCs, SECURITY INVOKER functions, views and edge functions each obey
  RLS differently (DEFINER and service_role bypass it; INVOKER does not), and only the
  INVOKER surfaces can be load-bearing for a policy. Name the surfaces or the claim is
  unfalsifiable.

- **A migration file is not evidence of what the database does. Assert against `pg_proc`
  and `pg_policies`, never against the file that claims to have created them.** The rule
  above covers derived COUNTS; this is the same rule for BEHAVIOUR, and it was learned the
  expensive way — one investigation, three conclusions, two of them wrong:
    * `20260821`'s verification **comment** said three SELECT policies remained on
      `profiles`. There were four. The fourth was a live full-row over-share
      (phone, nationality, push_token, strikes, ban timestamps) that survived six weeks.
    * `20260726`'s **file** says branch 3 of `insert_notification` makes new appointments
      notify their provider. I read it and repeated it as fact in an audit.
  A migration is a statement of INTENT. Between intent and the database sit a manual paste,
  a partial selection, a later `CREATE OR REPLACE`, and a ledger row that may only say
  `baseline` — which asserts in bulk and verifies nothing. `pg_get_functiondef`,
  `pg_get_constraintdef`, `pg_policies` and `information_schema` are the authority. Quote
  them, not the file, and say which one you read.
  **And the correction has its own failure mode, which is the third wrong conclusion:**
  having caught the file lying twice, I then declared a code path dead on the strength of
  **two** production rows — both at a junk test facility, one of them a self-booking. A
  sample is only an authority when it is big enough and clean enough to be one; two rows
  of somebody's test data is not a measurement, it is an anecdote with a timestamp.
  **Before a sample overturns anything, look at what the rows actually ARE** — who created
  them, at which facility, in what state. The structural proof (no policy permits this
  read) needed no sample at all and was right the whole time; reach for that first, and use
  data to size a problem rather than to discover one.
  Practical test when behaviour is in question: impersonate inside a transaction and roll
  back — `BEGIN; SET LOCAL role authenticated; SET LOCAL request.jwt.claims = '{"sub":…}';
  <call>; ROLLBACK;`. It answers against the live database and writes nothing.

- **Before trusting a probe, ask what it would return if the thing under test were
  PERFECT. If the answer is the same, it is not a probe.** Third face of the two rules
  above: they say a check must derive what it asserts and assert against the database
  rather than the file. This one says the check itself can be the thing that is broken —
  and a broken instrument does not look broken, it looks like a result. Three in one night:
    * **`overpass.osm.ch` returned `200 OK` and `total: 0` for all of Cyprus.** It is a
      Switzerland-only extract. The headline would have been "OSM has zero TRNC coverage."
    * **A `.limit(5000)` truncation guard testing `rows >= 5000`.** The server's `max-rows`
      is 1000 and OVERRIDES a larger client limit, so the guard could never fire — a
      truncation guard defeated by truncation. Fixed by asking for `count: 'exact'` and
      comparing the total to what arrived, which works at any cap.
    * **A write verified by a count run under the policy that forbids seeing the write.**
      `SET LOCAL role authenticated` as the CUSTOMER, then counting a notification
      addressed to the PROVIDER, under `users read own notifications
      USING (user_id = auth.uid())`. Structurally pinned to 0 whether or not the insert
      happened. It read as a silent no-op in the function; the function was fine.
  The cheap defence is one question asked BEFORE the run, not after a surprising result:
  *what does a healthy system print here?* Then make sure a broken one prints something
  else. Where it costs nothing, run the positive control too — a dense-area query on a
  new Overpass mirror, a known-good row through the same path — because a zero from a
  working instrument and a zero from a dead one are the same character on the screen.
  Corollary for RLS specifically: **never verify a write from inside the role that is not
  allowed to read it.** `RESET ROLE` before counting, or count as `postgres`.

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
  **Second instance, 2026-08-27, and it generalises past grouping to any DENOMINATOR.**
  `check-notify-health.mjs` scored "was this provider notified?" using
  `facilities.provider_id` — which is who owns a facility **now**. The question needed who
  owned it **then**: `notifyProvider` returns early when `provider_id` is null, so a booking
  at a then-unclaimed facility is CORRECTLY silent, and scoring it as a miss blames the code
  for behaving properly. It reported 10% and nearly convicted a working code path. Of 5
  facilities carrying a `provider_id`, only 2 had a `claim_requests` row — the rest were
  claimed by hand, so their ownership date is unknowable and those events must be EXCLUDED
  and the exclusion PRINTED, not scored.
  The schema offers a current-state column; the question is almost always about state at an
  event time. **Before a column becomes a denominator, ask whether it is a fact about now or
  a fact about then**, and whether anything in the database dates it. If nothing does, the
  honest answer is "unverifiable", not a percentage.
  Related code-reading correction from the same session: **`maybeSingle()` returns
  `{data: null, error: null}` on zero rows — it does NOT throw.** An RLS-emptied read
  therefore does not abort the function around it; execution continues with `null`. Do not
  reason about a control flow without checking which call actually raises.
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

- **The word filter has two halves and they must agree character-for-character.**
  `contains_blocked_term()` in the database is the boundary; `utils/profanity.js` is an
  inline preview that runs the SAME matcher client-side via `utils/moderationNormalize.js`.
  Change one, change the other **in the same commit**, then run `npm run moderation:check`
  — it puts every case through both and fails on any disagreement. Drift is not a cosmetic
  bug: the user is told "looks fine" as they type and rejected on submit, and because the
  error names no term (Phase B), the rejection is indistinguishable from the app being
  broken. `20260925_moderation_normalization.sql` is the SQL half.
  What that normalization does, and the three live defects it closed — all measured
  through `/rpc/contains_blocked_term`, not read off a migration file:
  Turkish capital **İ** lowercases to `i` + U+0307, a combining mark, so `SİKİK` and `PİÇ`
  matched nothing at all — the filter was defeated by the shift key. **Zero-width and
  format characters** (ZWNJ/ZWJ/soft hyphen) split a word into two tokens, so `f<ZWNJ>uck`
  passed AND `the<ZWNJ>rapist` was blocked as `rapist`. **Arabic tatweel** (U+0640) is a
  *word* character, so `كـس` was simply a different string from `كس`.
  Two things it deliberately does NOT do, both of which are tempting and both of which
  block ordinary words: no accent folding (NFC only — folding `ö→o` makes the Turkish term
  `göt` match the English "got"), and no `ı→i` folding (it makes `sık sık`, "often", match
  `sik`). Turkish's two i's are different letters, not a case pair.

- **`terms:check` passing means A MIGRATION FILE EXISTS — not that it has been applied.**
  `scripts/check-terms-commitment.mjs` scans `supabase/migrations/` as TEXT. It cannot see
  git and it cannot see the database: only the anon key is in the repo and `pg_policies` is
  unreachable through PostgREST as `anon`. So the guard answers *"has the fix been
  written"*, and the moment a file with a permissive `FOR UPDATE` on all three UGC tables
  lands on disk, exit 1 becomes exit 0 and the pre-push block lifts — applied or not,
  committed or not, correct or not.
  That is deliberate (a repo-side guard has nothing better to check), and it is a real gap,
  because the thing being gated is a commitment published to users in both terms copies.
  **`supabase/verify_schema.sql` is the only thing that closes it — and only if somebody
  runs it.** Nothing automated bridges the two, and this repo's own history is the argument
  for why that is not theoretical: `facilities.area` was committed and never applied, and
  `20260802`'s `DROP COLUMN` half-applied without anything noticing.
  So when a guard goes green, say which question it answered. "The Tier 1 migration is
  written" and "admin Remove works in production" are different claims, and only the second
  one is what the Terms promise. Applies to every repo-side guard here, not just this one.

- **You cannot log a rejection from the transaction you are about to abort.** The obvious
  design for "record which blocked term matched" is a table written by the trigger. It
  cannot work: `RAISE EXCEPTION` aborts the transaction and takes the log row with it —
  always, not usually. The result is a logger that looks correct, runs on every rejection,
  and is empty forever, which is *worse* than having none, because an empty table reads as
  "no false positives" rather than "no instrumentation". Same family as the green-check and
  hardcoded-set rules: the thing reporting the answer is the thing that is broken.
  Postgres has exactly one rollback-surviving sink without an extension — the **server
  log** (`RAISE LOG`); a table, `pg_net`'s queue and `LISTEN/NOTIFY` are all transactional
  and die with the abort. `dblink` would give a true autonomous transaction and on Supabase
  needs a stored database password, which is not a price worth paying for logging.
  So `20260926` splits it: a `RAISE LOG` breadcrumb that always fires (term + user, never
  the text — the server log is outside RLS), plus `moderation_rejections`, **self-reported
  by the client in a second transaction that commits**. Self-report misses evaders, and
  that is fine — the log exists to find FALSE POSITIVES, and those happen to honest users
  running our own client.
  Generalises: **before designing any "record what happened when we rejected it", ask
  which transaction the write lands in.** Audit trails for refusals, failed-validation
  logs, quota-denial records — all have this shape, and all fail silently.
  Corollary for verifying one: `moderation_rejections` denies SELECT to its own author, so
  reading the row back as the submitting user returns 0 whether or not the insert worked —
  pinned by RLS, not by truth. `check-moderation-log.mjs` proves the write through
  `blocked_terms.hit_count` instead, a surface it is allowed to read.

- **`utils/profanity.js` reads the WHOLE `blocked_terms` table, and PostgREST caps a
  response at `max-rows` = 1000.** Past that cap the client filters against a partial list
  and the body looks completely normal — a short, valid array, no error, no flag. The
  count is in the `Content-Range` header and nowhere else. Both the loader and
  `check-moderation-normalization.mjs` now ask for `count: 'exact'` and compare the total
  against what arrived, which is the only form of the check that works **at any cap**;
  testing `rows >= 1000` is a truncation guard defeated by truncation, and this repo has
  already shipped that exact bug once. The table is 54 rows today and the curated
  9-language import takes it to roughly 510, so the headroom is real but finite — and it
  is the kind of limit that is crossed by someone adding words through an admin screen,
  not by anyone thinking about PostgREST. The probe prints the live figure on every run;
  trust the printed number, not this sentence.

- **An assertion that cannot fail on the case it exists to detect is worse than no
  assertion — and `<>` is how you write one by accident.** `NULL <> 'x'` evaluates to
  NULL, and `IF NULL THEN` does not fire. So every one of these, written in the
  `20261001` DO block and green on first draft, would have PASSED on precisely the
  failure it was there to catch:
    * `IF normalize_display_name('Merhaba 123') <> 'merhaba 123'` — passes if the
      function returns NULL, i.e. if it is completely broken.
    * `IF (SELECT display_name_normalized FROM profiles WHERE id = v_a) <> 'zzprobename'`
      — passes if the trigger never filled the column at all, which is exactly the state
      that would let duplicate display names through the unique index.
  Use `IS DISTINCT FROM` in every assertion, and `IS NOT DISTINCT FROM` for the control
  (`a = b` is NULL when both are NULL, so a "these must differ" control written with `=`
  is silent when they are both nothing). This is the same family as the green-check and
  hardcoded-set rules, but sharper: those checks CAN go red and nobody watched them; this
  one has no red to go to for the one input that matters. Note it is not general — `<>`
  is correct where the operand cannot be NULL (`SQLERRM`, a `count(*)`, a `coalesce`d
  expression), and rewriting those adds noise. The test is whether NULL is reachable.

- **A verification block that mutates real rows must pick rows it cannot damage, and
  restore what it captured — not what it assumes.** The same DO block first took the two
  lowest `profiles` ids, wrote probe display names onto them, and then set
  `display_name = NULL, date_of_birth = NULL` to clean up. Correct on the first apply,
  when every row is nameless. **Destructive on a RE-APPLY** once the wizard ships: it
  would overwrite a real user's display name and erase a real date of birth, and the
  file is written re-runnable (`IF NOT EXISTS` throughout) precisely so it can be
  re-applied. Fixed by selecting only rows `WHERE display_name IS NULL`, capturing
  `date_of_birth` into a variable and restoring THAT, and scoping the leftover check to
  the probe's own two names rather than to "any display name anywhere" — the latter
  reads as a leak the first time a real user has finished the wizard. Same lesson
  `20260926` already applied when it restored `last_hit_at` captured rather than NULLed;
  it generalises to every in-migration probe that writes.

- **A scripted edit to a large SQL file needs a STRUCTURAL check, not an eyeball.** Eight
  anchored inserts were made into `verify_schema.sql` by script; seven were checked by
  reading the surrounding lines and one was not. That one left `)    'contact_events'`
  in the RLS-enabled list — QUERY 1 would have died with a syntax error, and the drift
  report is the thing you run FIRST on a database you are unsure about, so the failure
  lands at the worst moment. The check that would have caught it costs nothing: strip
  comments and string literals, count parens, and scan for a closing paren followed by
  content or two adjacent tuple lines without a comma. Run it over the whole file after
  any scripted edit, and expect one false positive per line whose trailing comment ends
  in `)`.

- **THE CHECK AND THE THING CHECKED MUST BE IN THE SAME FRAME OF REFERENCE. This is now
  one standing hazard, not a shelf of anecdotes — five instances between 2026-08-30 and
  2026-09-02, every one of them a check that was WRONG while the thing it checked was
  RIGHT.**
    * **A `sed` break that never landed.** Written against one file's indentation, run
      against another's. The probe then printed no failure and the honest-looking
      conclusion was "that check is dead". The check was fine; the *break* was.
    * **A forged-term assertion that compared a value to itself.** Structurally incapable
      of returning anything but pass.
    * **`?cb=$(date +%s)` on `getadaapp.com/privacy`.** A query string sends that route
      past the Worker to Vercel, so the probe reported `404` for BOTH store-registered
      URLs against a deploy that was completely healthy. The ritual's stated pass
      condition was "anything other than 200 and we roll back" — so the check would have
      rolled back a good deploy, and the rollback would have "fixed" it, confirming the
      wrong diagnosis.
    * **`position('comment' in pg_trigger.tgargs::text)`.** `tgargs` is BYTEA holding
      NULL-TERMINATED arguments, so `::text` renders `\x636f6d6d656e7400`. The literal
      substring `comment` is not in a hex string and never will be. It aborted a
      migration whose trigger was perfect.
    * **`NOT ILIKE '%appointments%'` over `pg_get_functiondef()`.** `pg_get_functiondef`
      returns the COMMENTS, so a token asserting three functions no longer query a
      dropped table was in fact forbidding the WORD from their prose — and all three
      correct bodies carry a comment saying which appointment branch they lost. The only
      way to make it green was to delete the comments that tell the next reader not to
      re-add a branch. **This one is the sharpest of the five, because the tempting fix
      was to edit the SYSTEM.** The other four merely wasted time; this one would have
      destroyed the most valuable thing in the function. And the file that carried the
      token documents this exact trap twice, in the 0827 note and the 0924 note, which
      is the real lesson: a hazard written down is not a hazard defended against.
      Fixed by anchoring the negative to a code SHAPE (`FROM appointments`, which no
      comment contains) and pairing it with a positive per function.
  **They look like five different bugs and they are one.** In each case the check reads
  the value in one frame and compares it in another — a different file, a different URL,
  a different encoding, or (worst) the same value on both sides. The *system* is never
  what these tests report on; the *instrument* is. And an instrument that is broken does
  not look broken. It looks like a result.
  **The defence is one question, asked BEFORE the run, not after a surprising answer:**
  *what exactly am I reading, and is it the same kind of thing I am comparing it to?*
  Print the raw value next to the expectation once and the mismatch is obvious. This is
  the same question as *"what would this print if the system were perfect?"* — that rule
  catches an instrument that cannot fail; this one catches an instrument that cannot pass.
  **Two corollaries earned the hard way:**
  **(1) Put the raw value in the failure message.** The `tgargs` bug was diagnosed in
  seconds because the assertion printed `args=\x636f6d6d656e7400` — the proof it was
  wrong was inside its own error. An assertion that fails without showing what it read is
  a dead end, and you will suspect the system before you suspect the test.
  **(2) When a check fails, the FIRST hypothesis is the check.** Not the system. Three of
  the five above cost real time to a wrong first hypothesis, one of them nearly caused
  an unnecessary production rollback, and the fifth nearly deleted a load-bearing comment
  to satisfy an instrument. **Ask what the check would forbid a CORRECT system from
  doing** — that question catches the whole family before it costs anything. Reach for the system only once the instrument has
  been cleared.
  **And prefer the reading that needs no decoding at all.** `pg_get_triggerdef()` renders
  canonical SQL; decoding `tgargs` by hand means `encode(...,'escape')` plus stripping a
  terminator — more encoding handling in exactly the layer that just failed. When a check
  breaks on a representation, the fix is usually to stop handling representations, not to
  handle them more carefully.
  Related, and the reason this cost nothing: **the migration rolled back cleanly.** A false
  alarm inside `BEGIN … COMMIT` is free — nothing half-applied, no cleanup, re-runnable
  after the fix. That is the argument for wrapping every manual-apply migration in an
  explicit transaction with its assertions INSIDE it, even when the change is one line.

- **Confirm the BREAK landed before you trust the RED — a break that does not break
  looks exactly like a dead check.** Red-first testing has its own failure mode, met
  head-on while probing the profile gate: a `sed` written against `constants/flags.js`
  indentation was run against `check-module-flags.mjs`, which indents differently, so it
  changed nothing. The probe then printed no failure, and the honest-looking conclusion
  was "that check is dead". It was not; the test was. Ten minutes went into diagnosing a
  working check.
  So a red-first run has TWO assertions, not one: *the file changed*, and *the probe
  noticed*. Print evidence of the mutation (`assert old in s` before replacing, or diff
  the file) rather than assuming `sed` matched. This is the same shape as the rule above
  it — an instrument that reports nothing is not the same as a system with nothing to
  report — and it argues for `python3` with an explicit `assert anchor in text` over
  `sed`, which fails silently by design.
  The check that survived this then gained the control it was missing: a slice between
  two markers now asserts it contains a key it must, because a slice whose end marker
  precedes its start returns `''` and passes on everything.

- **When a migration changes a count another migration's token asserts, RETIRE that token
  in the same commit — do not leave it to go red later, and do not bump it.** `20260927`
  registered "reviews/questions/answers carry 6 policies each". `20260928` then added the
  owner soft-delete policy, taking two of them to 7, and registered its own
  "policy counts are 7 / 7 / 6". Both tokens now counted the same set; the older one went
  STALE/MISSING against a database that was exactly right, and sat red in the drift report
  until somebody read it carefully.
  Bumping 6 to 7 would have been the wrong fix — **two tokens counting the same thing is
  what created the staleness**, and the duplicate would drift again at the next policy
  change. One count, one owner. Keep the half of the old token that is genuinely its own
  (here: that the UPDATE policy is PERMISSIVE, which no count can see) and delete the rest.
  This matters more than a tidy report: a drift checker carrying a known-stale row teaches
  the reader to skim, and the next real MISSING is skimmed with it. The file already warns
  about that twice — for `claim_requests.kteb_confirmed` and for the 0925 matcher token —
  and it happened anyway, because those warnings were about rows somebody might ADD, not
  about a row that goes stale on its own when a LATER migration moves the number.

## Compliance (Google Play — declared mixed-audience app)

Target age groups were set to **13-15 / 16-17 / 18 and over** on 2026-08-29, which makes
ADA a declared mixed-audience app. Three standing consequences:

- **Users whose `date_of_birth` indicates UNDER 18 must receive NON-PERSONALIZED ADS.**
  No ad SDK is integrated today. When one is, the age branch is a launch requirement, not
  a follow-up — shipping personalized ads to a 15-year-old is a policy violation on day
  one, and the DOB to make the distinction is already in `profiles`.
- **Do not add any SDK that is disqualified under Google Play Families policy without
  flagging it first.** Self-certification is per-SDK and ONE non-compliant SDK makes the
  whole app ineligible. This includes anything added "just for analytics".
- **Account-holder age and content visibility are SEPARATE CONCERNS.** The future
  MEKB-approved kids module is served in guest mode or under a parent account, never via
  a child-held account, and module access is not coupled to account age beyond
  `GATE_EXEMPT_MODULES`. Keep them separate; coupling them is easy to do by accident and
  expensive to unpick.

`MIN_SIGNUP_AGE` lives in `constants/profileGate.js` and is mirrored as
`interval '13 years'` in `20261001`'s trigger. It CANNOT be a CHECK constraint —
`CURRENT_DATE` is STABLE and a CHECK requires IMMUTABLE — so the trigger is the only
place it exists, and `npm run profile:check` fails if the two halves disagree. Never
inline the number anywhere else.

The DOB screen is a **neutral age screen**: no text stating a minimum, no pre-set date,
free entry of day/month/year. The year range stops at `currentYear - MIN_SIGNUP_AGE`,
and that tension has been considered and settled — Google's rule is about the SCREEN,
not the picker bounds; a pre-set date or "you must be 13+" tells the user what to type,
a bounded year list does not, and neither bound is singled out. **Do not re-litigate it.**

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


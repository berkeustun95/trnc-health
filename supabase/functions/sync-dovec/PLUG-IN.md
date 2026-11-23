# Döveç projects — going live

Döveç's partner API is real (`https://atlas.dovecgroup.com`, Bearer key `DOVEC_PARTNER_KEY`, already a production
secret). This replaces the old guess-the-API checklist. Nothing here has been applied or deployed: every step below
waits for Berke's go, one at a time.

- `GET /api/partner/projects` (60/min) → `sync-dovec` → `dovec_projects` (read by the app; RLS: `listed` AND a good
  sync within 24 h AND not suspended).
- `POST /api/partner/leads` (30/min) ← `dovec-lead` ← the app. `dovec_leads` has RLS on and zero policies: the app
  never reads it, only the service role does.
- A partner field Döveç leaves empty stays empty (a null `from_price` is valid; the app shows its "ask" label).

## Production steps, in this order

Each step waits for Berke's go, one at a time. Nothing needs a vault SQL from Berke: the cron reads the Vault secret
`novest_sync_key` that the weekend-digest, duty-push and marketplace jobs already use (20261177, 20261185), and both functions
accept it through the same `serviceCaller` (`_shared/caller-auth.mjs`: the bearer equals the runtime service key).

1. **DB-only PR to main** (file list below). The migration dry run refuses a feature-branch ref, so no dry run exists until it is merged.
2. **Dry run, then apply `20261229_dovec_projects.sql`** (`gh workflow run supabase-migrate -f file=20261229_dovec_projects.sql`;
   apply waits for the `production-db` approval). Creates the tables (settings, projects, leads, project coords), the read policy,
   the helpers, the account-deletion trigger, the 90-day wipe, the pin functions, the `is_test` columns and checks, and lets
   `contact_events_module_check` accept `'dovec'`. `dovec_settings.published` starts `false` and the WhatsApp line is set to Döveç's
   public sales line; nothing is visible yet.
3. **Deploy both functions** (`scripts/fn-deploy.sh sync-dovec --go`, `scripts/fn-deploy.sh dovec-lead --go`; verify_jwt true).
   `scripts/fn-deploy.sh` deploys the WORKING TREE, reads verify_jwt from the working tree's `deploy-config.json`, refuses a dirty
   `supabase/functions/<fn>` or `_shared`, and needs the function folder present. It therefore does not require the code to be on main,
   but deploying code that is not on main would leave production running something no reviewed history contains. Preferred: a small
   functions PR first (function folders, the two `_shared` modules, `deploy-config.json`, the workflow choice list), merge, then deploy
   from main. `dovec-lead` starts in mock mode: no request ever leaves for Döveç.
4. **Dry run, then apply `20261230_dovec_cron.sql`.** It refuses unless 20261229 is applied and the Vault secret `novest_sync_key`
   exists exactly once. Schedules `dovec-sync` (every 10 min), `dovec-lead-retry` (every 10 min, only when a real lead is waiting;
   the test enquiry is never picked up) and `dovec-leads-wipe` (03:30 UTC), with one `data_jobs` row each.
5. **First sync, then read the pin status.** After the first run, `dovec_settings.last_run_at` is set. The sync response carries
   `coords` (seeded pins not attached with a reason, attached projects renamed since, live projects without a pin; public project
   names and Döveç ids only). The same lists are printed by `scripts/check-dovec-health.mjs`. Nothing there is red: it is a report
   for Berke, who checks that all five seeds say `matched` and no live project lacks a pin that should have one.
6. **`dovec-health` PR** (hourly monitor, own PR after the first good sync): `.github/workflows/dovec-health.yml`,
   `scripts/check-dovec-health.mjs`, the heartbeat exemption in `scripts/check-data-job-heartbeats.mjs`. It stays green and idle while
   `last_run_at` is null; after the first run it goes red on: suspended, a last status other than `ok`, a good sync older than
   30 min, a lead stuck over 1 h, or a rejected or failed lead in the last 24 h (the test enquiry is excluded).
7. **Check what the sync wrote** from the admin screen or a read-only probe (print counts only). Do NOT go live yet.
8. **The test enquiry (later, separately; see below), then both lead locks.** Go-live needs Berke's explicit go on each.
   Two locks for user leads, both needed: the code constant `LEADS_LIVE_ALLOWED` in `_shared/dovec-lead.mjs` (a reviewed commit + a
   deploy of `dovec-lead`) AND the secret `DOVEC_LEADS_MODE=live` (`scripts/sb.sh secrets set --env-file <600 file>`, checked by
   digest). Until both are open every enquiry is stored with status `mock`, and the user still sees the thank-you screen while
   nothing reaches Döveç.
9. **Only then go live: `dovec_settings.published` (a migration, never the dashboard) and `DOVEC_PARTNER_LIVE` (flag).**
   Never before step 8: with the locks shut, a visible module accepts enquiries from real people and sends nothing.

### DB-only PR to main: exact file list (no app code)

- `supabase/migrations/20261229_dovec_projects.sql`
- `supabase/migrations/20261230_dovec_cron.sql`
- `supabase/verify_schema.sql`
- `supabase/migration_ledger_check.sql` (regenerate on the branch: `node scripts/migration-ledger.mjs`)
- `supabase/schema_drift_audit.sql` (regenerate: `npm run drift:regen`)

Checked in a scratch worktree from `origin/main` with only those five files taken from the feature branch (main had not changed the
three shared files since the branch point, so whole-file checkout was clean; if main moves them first, merge instead). With no
function code, no `deploy-config.json` entry and no app code, these light guards were green: `migration-ledger --verify` on both files,
`drift:check`, `check-prod-write-guard`, `check-push-fn-auth`, `check-contact-events-vocab`, `check-data-job-heartbeats`,
`check-push-no-vault-files`, `check-secrets`, `check-dispatcher-actor`, `check-sync-novest-auth`, `check-admin-push-auth`,
`check-unpaged-reads`, `check-module-flags`. Not run (heavy or suite): `check-migration-numbers`, jest, `dovec:test`. Main's own
highest prefix was 20261228 at the check, so 20261229 / 20261230 were free.
The ledger check lists both files as never-applied until the apply runs: by design.

Left out on purpose: the function code, `deploy-config.json` and the `supabase-functions-deploy.yml` choice list (functions PR),
`scripts/test-dovec-*.mjs` and the `dovec:test` script (the SQL test reads the function sources, so it goes with the functions PR),
the two workflows and their scripts, and all app files.

## Map pins (coordinates)

The Döveç feed carries no coordinates. `dovec_project_coords` is seeded with exactly five pins: D-Point, Natulux, Courtyard Platinum,
Querencia Long Beach, Long Beach Panorama. After each good sync, `dovec_sync_coords()` attaches a seed to a project only when exactly one
listed project has `name = seed_name` BYTE FOR BYTE (`COLLATE "C"`: no trim, no case folding, no Unicode normalisation; 'D-point' and
'D-Point ' do not match). Zero matches (`no_match`), two or more (`ambiguous`) or a project already pinned by another seed (`claimed`)
attach nothing and are reported. Once attached, the pin stays with that project id; if the project is later renamed the pin stays and
is reported as `renamed`. The pin is copied to `dovec_projects.latitude` / `longitude` for attached ids only (the app reads those);
the feed upsert never names those columns, so a sync cannot clear a pin.
Caveat: `mapProject` trims the feed's name before storing it, so the comparison is against the STORED (trimmed) name: a feed name with
stray outer spaces still attaches. Spelling, case or inner differences never do.
Readable by: `dovec_coord_status()` is executable by anon, authenticated and the service role (read-only; it returns only seed names, Döveç
project names and ids, and a status word: no lead, user or count data). The seed table itself and `dovec_sync_coords()` stay service-role only.
After the first sync, read the match with `select * from dovec_coord_status();` in the SQL editor, or a REST rpc call
(`POST /rest/v1/rpc/dovec_coord_status` with the anon key as `apikey`). Empty `unmatched`, `renamed` and `live_without_coords` = all five pinned.

## The test enquiry (prepared here, never sent by any of these steps)

Döveç asked for exactly one agreed test enquiry: name "ADA TEST", external id `TEST-1`, message "Test talebidir, işlem yapmayın",
consent true, language `tr`, no project. The phone comes from a function secret, never from an input or a file.

- **Schema (20261229):** `dovec_leads.is_test`; `external_id` must be `ADA-<n>` unless `is_test` and then exactly `TEST-1`; a project is
  required unless `is_test`; at most one `is_test` row ever; `dovec_lead_counts()` and the rate-limit trigger ignore it.
- **Function:** `dovec-lead` accepts `{ "mode": "test_lead", "dry": true|false }` from the service key only (dry unless `dry` is
  literally `false`). Two locks, separate from the user-lead locks: the code constant `TEST_LEAD_ALLOWED` (ships `false`) AND the secret
  `DOVEC_LEADS_MODE === 'test_once'`. Under `test_once` every user enquiry stays `mock`, `LEADS_LIVE_ALLOWED` stays false, and the retry
  path sends nothing for user leads. The phone is `DOVEC_TEST_LEAD_PHONE` (E.164, never logged); missing or invalid refuses.
- **Exactly once:** an existing `TEST-1` in `sent`, `rejected`, `failed` or `mock` refuses. A `TEST-1` still `pending` or `retry` is resent
  only through the normal claimed retry path with the stored payload. Insert first, then send.
- **Trigger:** `.github/workflows/dovec-test-lead.yml` (`workflow_dispatch`, `environment: production`, dry by default;
  `-f apply=true` sends; `prodWriteGuard`; the production service key like the other workflows; engine `scripts/dovec-test-lead.mjs`).
  Why a workflow: this Mac has no service key and production secrets live only in the GitHub production environment, which runs from
  main, so it is a separate, later PR. The dry run reports lock states, phone set/missing, the earlier row's status word and what it
  would send, never a secret value. The log is public: status words only.
- **Needs, each with Berke's explicit go:** the code (set `TEST_LEAD_ALLOWED = true` in a reviewed commit and deploy `dovec-lead`), the
  secrets `DOVEC_LEADS_MODE=test_once` and `DOVEC_TEST_LEAD_PHONE` (set by digest), the phone number, and the time (Döveç must expect it).
  Afterwards close both locks again (constant false + redeploy, mode secret back to its previous value).

## `dovec-lead` response contract

`POST { client_request_id, project_id, unit_type?, name, phone, email?, message?, consent: true, consent_text_version, language }`
from a signed-in, non-guest user.

| Status | Body | Meaning |
| --- | --- | --- |
| 200 | `{ ok: true, external_id, status }` | stored (`mock`, `sent`, `retry`, `pending`); a replay of the same request returns the same row |
| 200 | `{ ok: false, error: 'rejected', external_id }` | Döveç rejected the enquiry (4xx) |
| 400 | `{ error: 'invalid_request', field }` / `{ error: 'consent_required' }` | validation (field name only, never a value) |
| 403 | `{ error: 'sign_in_required' }` | guest or unknown caller |
| 403 | `{ error: 'under_18' }` | the profile's date of birth, when one is on file, says under 18 today (the 18th birthday itself is allowed); nothing is saved. With no date of birth on file the 18+ consent tick stands. |
| 404 | `{ error: 'project_unavailable' }` | unlisted, suspended or stale feed |
| 409 | `{ error: 'request_changed' }` | same `client_request_id`, different payload |
| 429 | `{ error: 'rate_limited' }` | 3 an hour and 10 a day per user, 200 a day overall; enforced atomically by the BEFORE INSERT trigger on `dovec_leads` (SQLSTATE `DV429`) |
| 500 | `{ error: 'server_error' }` | unexpected |

Service-key-only bodies: `{ mode: 'retry' }` (cron; real leads only) and `{ mode: 'test_lead', dry? }` (see "The test enquiry"). A user caller sending `mode` gets 403.

The outgoing host is the fixed constant `https://atlas.dovecgroup.com` in both shared modules; there is no environment
override, so the partner key cannot be redirected by changing a secret.

## Behaviour worth knowing

- **Suspension.** A 401 from Döveç sets `dovec_settings.suspended = true`: the projects disappear from the app at once
  (the read policy checks it) and `dovec-health` goes red. The next good sync clears it. A 503 `not_provisioned` is a
  refused run, not a suspension.
- **Mass-delist refusal.** A sync that would delist more than half of the listed projects (or all of them) is refused
  (`refused_mass_delist`) and changes nothing, as are an empty feed (`refused_empty`) and a count that does not match
  the list (`refused_count_mismatch`). If Döveç really did remove most projects, that is a manual step: ask Berke.
  Projects are never deleted, only delisted.
- **A bad project does not delist itself.** One that fails validation is skipped and counted; if it was already listed
  it stays as it was.
- **Account deletion.** `dovec_leads.user_id` has no foreign key on purpose. Deleting a profile wipes that user's
  name, phone, email, message and `user_id` (pending or retrying leads become `failed`) and keeps the row for counts.
  Every lead's PII is wiped after 90 days anyway.
- **Stale feed.** 24 hours after the last good sync the projects stop being readable. By design; the cron's
  rollback (`cron.unschedule`) therefore also empties the app after a day.
- **Logs and probes** carry counts and status words only: the repo and its Actions logs are public.

## Tests (by hand, not CI)

`npm run dovec:test` runs the feed test, the lead test and the SQL test against fixtures with a mocked `fetch`.
No test or script ever calls `atlas.dovecgroup.com`. The SQL test needs the PGlite package; when the checkout has no
`node_modules/@electric-sql/pglite`, run it from a directory that links one.

## Later work (not dropped)

The earlier partner slice lives on branch `feat/dovec-partner` (PR #262), written against the guessed schema. It is
not merged; these three pieces are wanted on top of the real feed once projects are live:

- **Explore map pins:** `assets/map-pins/dovec@2x.png` and `dovec@3x.png`, added in `f8459510`
  ("Prices follow the app language; "Call for price" in Konaklama; Döveç pin + header fixes").
- **A Home slot:** `components/home/redesign/DovecHomeSlot.js`, added in `8d5e4218`
  ("Döveç partner, slice 2: partner page, map pins, Home slot, tracked contact (flag OFF)").
- **The partner page:** `screens/DovecPartnerScreen.js`, added in `8d5e4218`, later changed in `f8459510`.

They need rework to read `dovec_projects` / `dovec_settings` (column names and statuses changed) and to go through the
module go-live SOP (seed inactive, spot-check in Turkish, flag in both files, Preview before production).

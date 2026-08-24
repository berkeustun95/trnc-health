-- ─── One-time: move the sync-novest cron jobs off an inline key, onto Vault ──
--
-- Jobs 9 and 10 were registered with the service_role JWT written directly into the
-- `headers` literal. That puts the key in plaintext in `cron.job.command`, which any
-- Postgres role with read access can select. This replaces both jobs with a form that
-- reads the key from Vault at call time, so nothing sensitive is stored in cron.job.
--
-- ⚠ THERE IS NO KEY IN THIS FILE AND NONE MAY BE ADDED. Step 1 is the only place the key
--   is handled, and it is typed straight into the SQL editor — never saved here.
--   scripts/check-secrets.mjs blocks a push if that rule is broken.
--
-- Run in the SQL editor, Role = postgres. STEP AT A TIME — each step's verification must
-- pass before the next. This is not a migration; it is not in the ledger and must not be.

-- ─── 1. Store the key in Vault (ONCE) ───────────────────────────────────────
-- Replace the placeholder inline in the editor, run the line, then clear the editor.
-- Do not save this line anywhere.

select vault.create_secret('PASTE_SERVICE_ROLE_KEY_HERE', 'novest_sync_key');

-- ─── 2. Confirm it landed, WITHOUT printing it ──────────────────────────────
-- Selects the name only. Never `select decrypted_secret` at the console — it puts the
-- key in your query history.

select name, created_at from vault.secrets where name = 'novest_sync_key';
-- expect: exactly 1 row

-- Confirm the job's own lookup resolves, still without revealing the value:
select length(decrypted_secret) > 100 as key_looks_present
  from vault.decrypted_secrets where name = 'novest_sync_key';
-- expect: t

-- ─── 3. Remove the two jobs that carry the inline key ───────────────────────

select cron.unschedule('sync-novest-morning');
select cron.unschedule('sync-novest-evening');

-- ─── 4. Re-create both, reading from Vault ──────────────────────────────────
-- 05:00 UTC = 08:00 TRNC (before the working day) · 15:00 UTC = 18:00 TRNC (after it).
-- Twice daily, not hourly: the staleness banner trips at 36h, so two runs leave more than
-- a full cycle of margin before one missed run raises an alarm — and their box is a
-- single shared LiteSpeed host.

select cron.schedule('sync-novest-morning', '0 5 * * *', $$
  select net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/sync-novest',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret
                                                  from vault.decrypted_secrets
                                                 where name = 'novest_sync_key')),
    body    := '{}'::jsonb
  );
$$);

select cron.schedule('sync-novest-evening', '0 15 * * *', $$
  select net.http_post(
    url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/sync-novest',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || (select decrypted_secret
                                                  from vault.decrypted_secrets
                                                 where name = 'novest_sync_key')),
    body    := '{}'::jsonb
  );
$$);

-- ─── 5. THE CHECK THIS WHOLE FILE EXISTS FOR ────────────────────────────────

select jobid, jobname, active, command like '%eyJ%' as has_inline_key
  from cron.job where jobname like '%novest%' order by jobid;
-- expect: 2 rows, active = t, has_inline_key = f FOR BOTH.
-- If has_inline_key is true, the old job is still there — step 3 did not take.

-- ─── 6. Fire it once by hand, rather than waiting until 05:00 ───────────────
-- The job body is only proven when it has actually run. Note the timestamp first:

select max(last_seen_at) as before from properties where source = 'novest';

-- Run the same statement the job runs:
select net.http_post(
  url     := 'https://jeihxnwqytnxtytgkzgf.supabase.co/functions/v1/sync-novest',
  headers := jsonb_build_object(
               'Content-Type', 'application/json',
               'Authorization', 'Bearer ' || (select decrypted_secret
                                                from vault.decrypted_secrets
                                               where name = 'novest_sync_key')),
  body    := '{}'::jsonb
);

-- Wait ~30s (the sync fetches 91 listings), then:
select max(last_seen_at) as after_run from properties where source = 'novest';
-- expect: NEWER than `before`. If unchanged, the function did not complete — check the
-- Edge Function logs. net.http_post returns a request id whether or not anything worked,
-- so the returned id is NOT evidence. The timestamp is.

-- ─── ROTATION WAS CONSIDERED AND REJECTED — DO NOT ROTATE ───────────────────
--
-- This section used to say the key "should be considered spent" and to rotate it. That
-- advice was WRONG FOR THIS PROJECT and has been removed, because a future reader would
-- have followed it and pulled the JWT secret on a live app.
--
-- WHY IT IS WRONG HERE. Supabase has no service_role rotate button. The legacy API keys
-- tab offers only "Re-enable JWT-based API keys". Rotating service_role means
-- REGENERATING THE PROJECT JWT SECRET, which also invalidates the ANON key — which is
-- compiled into the shipped app. That breaks:
--   • the live iOS build
--   • the Play closed-testing track
--   • every logged-in session, on every device
--
-- WHAT THE ACTUAL EXPOSURE WAS. The key was pasted into schedule.sql while substituting
-- the cron placeholders. That file was UNTRACKED for its whole life: never committed,
-- never pushed, never off this machine. `git log -S` on the service_role payload finds
-- nothing. The second and more real copy was cron.job.command, readable by any role with
-- database read access — AND THAT IS WHAT THIS FILE CLOSED. Jobs 9 and 10 are gone;
-- 11 and 12 carry no key.
--
-- So: a contained, local, closed exposure against an outage for every user of a shipped
-- app. Rotating would be the more damaging act, by a wide margin. This is a decision,
-- not an omission — it is written down so nobody re-opens it as unfinished work.
--
-- ⚠ WHAT WOULD CHANGE THE ANSWER: the key appearing in a commit, a push, a CI log, a
--   screenshot, a support ticket, or any machine that is not this one. Then the calculus
--   inverts and the outage is worth it. The procedure below is for THAT day.
--
-- ─── PROCEDURE FOR A GENUINE COMPROMISE, OR A PLANNED KEY MIGRATION ─────────
--
-- Not an outstanding task. This is the runbook if the trigger above ever fires, or when
-- the module moves to publishable/secret keys (see the note at the foot of this file).
--
-- New credentials break these jobs until Vault is updated, so do both in one sitting:
--
--   select vault.update_secret(
--            (select id from vault.secrets where name = 'novest_sync_key'),
--            'PASTE_NEW_KEY_HERE');
--
-- Then re-run step 6. The jobs themselves need no change — that is the point of Vault,
-- and the reason this is now a five-minute operation rather than an edit to two cron
-- definitions carrying an embedded secret.
--
-- Also update, in the same sitting:
--   • the macOS Keychain entry used by the local scripts:
--       security add-generic-password -U -a "$USER" -s ada-supabase-service-role -w "$(pbpaste)"
--   • the Edge Function environment, if SUPABASE_SERVICE_ROLE_KEY is set explicitly there
--     (it is injected automatically by default, in which case there is nothing to do).
--
-- ─── LATER SLICE: publishable / secret API keys ─────────────────────────────
--
-- Supabase is moving projects from anon/service_role JWTs to publishable (sb_publishable_)
-- and secret (sb_secret_) keys. THAT is the real fix for the problem this file works
-- around: secret keys are individually revocable and rotatable WITHOUT touching the JWT
-- secret, so a leaked one can be killed without logging out a single user.
--
-- Logged, not actioned. It touches lib/supabase.js, every Edge Function, the Keychain
-- entry and this Vault secret, and it needs a native build to ship the new publishable
-- key — so it is its own slice, not a footnote to this one.
-- (scripts/check-secrets.mjs already blocks sb_secret_ keys, so the guard is ready.)

-- ─── If vault.create_secret errors with "schema vault does not exist" ───────
--   create extension if not exists supabase_vault with schema vault;
-- Then start again at step 1.
--
-- pg_cron runs a job as the role that scheduled it. Scheduling as postgres (as above)
-- means the job can read vault.decrypted_secrets. Scheduling as a lesser role would fail
-- at call time, not at schedule time — which would look exactly like the function being
-- broken. Step 6 is what distinguishes the two.

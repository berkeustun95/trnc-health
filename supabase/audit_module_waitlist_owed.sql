-- ─── Who is still waiting for a module that already shipped? ─────────────────
-- SQL editor, Role = postgres. Read-only until you choose to run the blast at the end.
--
-- WHY THIS EXISTS: notify_module_waitlist() is NEVER called automatically. Nothing in
-- the OTA path, no trigger, no cron. It is a manual step at go-live, and a manual step
-- is one that can be missed — silently, because the people affected simply keep waiting
-- and never complain about a notification they do not know was due.
--
-- module_waitlist DOES carry notified_at, so this is answerable. (Had it not, the
-- absence would itself have been the finding — there would be no way to know.)

-- ── 1. Every module, and what is owed ────────────────────────────────────────
SELECT module,
       count(*)                                      AS signups,
       count(*) FILTER (WHERE notified_at IS NULL)   AS never_notified,
       count(*) FILTER (WHERE notified_at IS NOT NULL) AS notified,
       min(created_at)::date                         AS first_signup,
       max(created_at)::date                         AS last_signup
FROM public.module_waitlist
GROUP BY module
ORDER BY never_notified DESC, module;

-- ── 2. The rows that actually matter: owed on a module that is ALREADY LIVE ──
-- Keep this IN-list in step with MODULE_FLAGS === true in constants/flags.js.
-- Live as of 2026-08-23: pets, events, towing.
SELECT module,
       count(*) AS people_still_waiting,
       min(created_at)::date AS waiting_since
FROM public.module_waitlist
WHERE notified_at IS NULL
  AND module IN ('pets', 'events', 'towing')
GROUP BY module
ORDER BY module;

-- ── 3. Send what is owed ─────────────────────────────────────────────────────
-- Re-run safe: the loop only touches notified_at IS NULL rows and stamps as it goes,
-- so running these twice notifies zero the second time. Returns the count sent.
--
-- ⚠ APPLY 20260909_notify_waitlist_add_modules.sql FIRST if any owed module is
--   explore, studentHub or towing — before that migration the RPC rejects those keys.
--
--   SELECT notify_module_waitlist('pets')   AS sent_pets;
--   SELECT notify_module_waitlist('events') AS sent_events;
--   SELECT notify_module_waitlist('towing') AS sent_towing;   -- expect 0, nobody could sign up
--
-- Then re-run query 2 — expect no rows.

-- ── 4. Keys nobody expects ───────────────────────────────────────────────────
-- module_waitlist's CHECK is only a shape guard (^[a-zA-Z]{2,40}$ since 20260814), so a
-- typo'd or retired moduleKey lands silently and would never be notifiable. Expect no rows.
SELECT DISTINCT module
FROM public.module_waitlist
WHERE module NOT IN ('homeServices','grooming','garages','transport','insurance',
                     'pets','events','jobs','accommodation','explore','studentHub','towing');

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

-- ── 2. Everything still owed, most-overdue first ─────────────────────────────
--
-- ⚠ THIS QUERY USED TO CARRY A HARDCODED LIST OF LIVE MODULES —
--     AND module IN ('pets', 'events', 'towing')
--   with a comment telling the reader to keep it in step with MODULE_FLAGS. It was
--   written 2026-08-23 and nobody did. By 2026-09-09 accommodation, explore and
--   homeServices had gone live and the query silently omitted three of six live
--   modules — answering "nothing owed" for a module with three people waiting a month.
--
--   THE FILTER IS GONE RATHER THAN REFRESHED, because refreshing it just resets the
--   clock on the same failure. SQL cannot see constants/flags.js, so a list of live
--   modules in this file can only ever be a remembered one — and a remembered list in a
--   WHERE clause fails SILENTLY, which is strictly worse than no query. The same list in
--   a COMMENT fails visibly: it is prose, and prose that disagrees with reality is
--   something a reader can notice.
--
--   So: this shows everything owed, and YOU cross-reference the module column against
--   MODULE_FLAGS === true in constants/flags.js. That is one lookup, and it cannot go
--   stale on your behalf.
SELECT module,
       count(*)              AS people_still_waiting,
       min(created_at)::date AS waiting_since,
       (CURRENT_DATE - min(created_at)::date) AS days_oldest_has_waited
FROM public.module_waitlist
WHERE notified_at IS NULL
GROUP BY module
ORDER BY min(created_at), module;

-- Observed 2026-09-09 (dated because it is a measurement, not a rule):
--   homeServices   3 signups, 3 never notified, oldest 2026-08-12   <- owed at launch
--   accommodation  7 signups, 0 never notified
--   pets           4 signups, 0 never notified
--   explore        2 signups, 0 never notified
--   events         1 signup,  0 never notified
-- Live modules at that date: pets, events, accommodation, explore, towing, homeServices.

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
--
-- ⚠ 'checkins' WAS MISSING FROM THIS LIST until 2026-09-09, and it is the one key most
--   likely to be here: MODULE_FLAGS.checkins gates the FEATURE, not the signup, and its
--   entry point is deliberately UNGATED (see constants/flags.js) precisely so demand
--   accumulates before launch. So every real check-in signup was being reported as an
--   unexpected key.
--
-- ⚠ THIS LIST IS ALSO HARDCODED, AND UNLIKE QUERY 2's IT IS TOLERABLE — the difference
--   is the direction it fails in, and that is worth understanding before anyone "fixes"
--   it the same way. Query 2's list was a LIVENESS filter: stale, it silently omitted
--   modules and answered "nothing owed" for people who were owed. This one is a
--   VOCABULARY: stale, it reports a legitimate key as unexpected — a FALSE POSITIVE,
--   which announces itself the moment you read the output. Noisy beats silent.
--
--   It must still track the keys in constants/flags.js MODULE_FLAGS. Add a module there,
--   add it here.
SELECT DISTINCT module
FROM public.module_waitlist
WHERE module NOT IN ('homeServices','grooming','garages','transport','insurance',
                     'pets','events','jobs','accommodation','explore','studentHub',
                     'towing','checkins');

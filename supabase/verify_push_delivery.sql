-- ─── Did the pets blast actually REACH anyone? ───────────────────────────────
-- SQL editor, Role = postgres. Read-only.
--
-- THE QUESTION: notify_module_waitlist('pets') returned 4. That proves it wrote four
-- `notifications` rows and stamped four `notified_at`. It does NOT prove four devices
-- buzzed. Those are two different delivery paths and only one of them is reliable.
--
-- WHAT THE RPC ACTUALLY DOES, per user:
--   1. INSERT INTO notifications (...)        ← in-app. Synchronous, transactional.
--   2. IF push_token IS NOT NULL THEN
--        PERFORM net.http_post(exp.host ...)  ← push. Asynchronous, FIRE AND FORGET.
--
-- Path 1 is sound: App.js:635 reads `notifications` into the bell screen, so those four
-- rows WILL be seen next time each user opens the app. This is not a table nothing reads.
--
-- Path 2 has three ways to evaporate silently, and NOTHING in this project has ever
-- checked any of them:
--   (a) push_token IS NULL  → no push was even attempted. Expected for guests, who are
--       a large share of Coming Soon signups (anonymous sessions can join the waitlist).
--   (b) pg_net is async. `PERFORM` DISCARDS the returned request_id, so there is no
--       stored correlation between a notification row and its HTTP call. You can only
--       match by time and URL.
--   (c) Expo returns HTTP 200 even when a ticket failed. A body of
--       {"data":[{"status":"error","details":{"error":"DeviceNotRegistered"}}]} is a 200.
--
-- ⚠ TIME LIMIT: Supabase prunes net._http_response (a few hours by default). If the
--   blast was long enough ago, query 3 returns nothing — and that is NOT evidence of
--   failure, just of expiry. Queries 1 and 2 remain valid whenever you run them.


-- ── 1. How many of the four could have received a push at all? ───────────────
-- push_token comes from App.js:711 and only exists for a signed-in device that granted
-- notification permission. never_had_token rows got in-app only, by design.
SELECT w.module,
       count(*)                                            AS notified_rows,
       count(*) FILTER (WHERE p.push_token IS NOT NULL)    AS push_attempted,
       count(*) FILTER (WHERE p.push_token IS NULL)        AS in_app_only,
       count(*) FILTER (WHERE p.id IS NULL)                AS missing_profile   -- expect 0
FROM public.module_waitlist w
LEFT JOIN public.profiles p ON p.id = w.user_id
WHERE w.module = 'pets' AND w.notified_at IS NOT NULL
GROUP BY w.module;


-- ── 2. Did the in-app notifications actually land, and have they been seen? ──
-- `read` flips when the user opens the bell screen (App.js:1022), so read = true is
-- positive proof a human saw it.
SELECT n.title,
       count(*)                                  AS rows_written,
       count(*) FILTER (WHERE n.read)            AS opened_by_user,
       min(n.created_at)                         AS sent_at
FROM public.notifications n
WHERE n.created_at >= (SELECT min(notified_at) FROM public.module_waitlist WHERE module='pets')
  AND n.title ILIKE '%ADA%'
GROUP BY n.title
ORDER BY sent_at DESC;


-- ── 3. Did the Expo HTTP calls succeed? (only if still within pg_net's TTL) ──
-- 200 with '"status":"ok"' is a genuine delivery to Expo.
-- 200 with '"status":"error"' is a FAILED push wearing a success code.
SELECT r.status_code,
       CASE
         WHEN r.content ILIKE '%"status":"ok"%'    THEN 'delivered to Expo'
         WHEN r.content ILIKE '%DeviceNotRegistered%' THEN 'FAILED — stale token, user reinstalled or revoked'
         WHEN r.content ILIKE '%"status":"error"%' THEN 'FAILED — Expo rejected the ticket'
         ELSE 'unrecognised response'
       END                                        AS verdict,
       count(*)                                   AS calls,
       min(r.created)                             AS first_call,
       max(r.created)                             AS last_call
FROM net._http_response r
WHERE r.created >= now() - interval '24 hours'
GROUP BY r.status_code, 2
ORDER BY first_call DESC;
-- No rows = pg_net has already pruned that window. Not a failure signal.


-- ─── RECOMMENDATION (not applied — Berke's call) ─────────────────────────────
-- Every push in this project is `PERFORM net.http_post(...)`, in five separate
-- processors, and every one throws away the request_id. That is why question 3 above
-- has to guess by timestamp instead of joining on a key.
--
-- Capturing it would make delivery answerable rather than inferable:
--   INSERT INTO push_log (user_id, request_id, sent_at)
--   VALUES (r.user_id, net.http_post(...), now());
-- then join push_log → net._http_response on request_id before the TTL expires.
--
-- Worth doing before the next module launch, and it is a change to all five processors,
-- so it deserves its own slice rather than being smuggled into this one.

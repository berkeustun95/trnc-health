-- Read-only. Check-ins TEST DATA from preview testing (DB live since 2026-10-07, flag off), to review
-- and remove before MODULE_FLAGS.checkins flips. Until the flip, EVERY row below is test data:
-- no production bundle can create any of it.
--   gh workflow run supabase-readonly -f file=supabase/readonly/checkins_test_data.sql
-- Not removable this way and deliberately kept: a tester's display_name (a profile field).
-- Removal (at go-live, by Berke's go): check-ins → the owner deletes them in Profile → Check-in'lerim,
-- or one migration; places → Admin → reject/delete; pins vanish with their check-ins (nightly purge);
-- usage rows purge themselves after 2 days; notice stamps → one UPDATE in that migration.
SELECT 'checkin' AS what,
       format('%s · by %s (%s) · %s · %s', c.id, left(c.user_id::text, 8), c.display_name_snapshot,
              coalesce('ADA ' || pl.name, 'Google ' || c.google_place_id), c.created_at) AS detail
  FROM checkins c LEFT JOIN places pl ON pl.id = c.place_id
UNION ALL
SELECT 'google pin', format('%s · fetched %s', gp.google_place_id, gp.fetched_at) FROM google_place_pins gp
UNION ALL
SELECT 'place submitted since 2026-10-07', format('%s · %s · %s · %s · by %s · %s',
       p.id, p.status, p.category, p.name, left(p.submitted_by::text, 8), p.created_at)
  FROM places p WHERE p.created_at >= '2026-10-07' AND p.submitted_by IS NOT NULL
UNION ALL
SELECT 'google calls', format('%s · %s · %s · n=%s', u.day,
       CASE WHEN u.user_id = '00000000-0000-0000-0000-000000000000' THEN 'GLOBAL' ELSE left(u.user_id::text, 8) END, u.kind, u.n)
  FROM google_places_usage u
UNION ALL
SELECT 'notice accepted', format('%s · %s · notice %s v%s · checkins_public %s',
       left(pr.id::text, 8), pr.display_name, pr.checkins_notice_at, pr.checkins_notice_version, pr.checkins_public)
  FROM profiles pr WHERE pr.checkins_notice_at IS NOT NULL
ORDER BY 1, 2;

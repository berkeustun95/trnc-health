-- Ehliyet go-live readback (read-only). Waitlist rows for 'ehliyet' (expected 0: no waitlist UI,
-- but module_waitlist's CHECK is only a shape guard, so read the list rather than assume it),
-- and the activated school + branches (20261110).
SELECT
  (SELECT count(*) FROM module_waitlist WHERE module = 'ehliyet')                              AS waitlist_total,
  (SELECT count(*) FROM module_waitlist WHERE module = 'ehliyet' AND notified_at IS NULL)      AS waitlist_owed,
  (SELECT count(*) FROM driving_schools)                                                       AS schools_total,
  (SELECT count(*) FROM driving_schools WHERE is_active)                                       AS schools_active,
  (SELECT string_agg(name, ', ') FROM driving_schools WHERE is_active)                         AS active_names,
  (SELECT count(*) FROM driving_school_branches b JOIN driving_schools s ON s.id = b.school_id
     WHERE s.is_active)                                                                        AS branches_of_active,
  (SELECT string_agg(region || coalesce(' @' || lat || ',' || lng, ''), ', ' ORDER BY sort_order)
     FROM driving_school_branches)                                                             AS branches;

-- Duyurular go-live readback (read-only). Waitlist before/after the blast (a burnt list and an
-- empty list both return 0 from notify_module_waitlist, so the list itself is read), published
-- and visible counts, and source health.
SELECT
  (SELECT count(*) FROM module_waitlist WHERE module = 'duyurular')                              AS waitlist_total,
  (SELECT count(*) FROM module_waitlist WHERE module = 'duyurular' AND notified_at IS NOT NULL)  AS waitlist_notified,
  (SELECT max(notified_at) FROM module_waitlist WHERE module = 'duyurular')                      AS waitlist_last_stamp,
  (SELECT count(*) FROM announcements)                                                            AS rows_total,
  (SELECT count(*) FROM announcements WHERE is_published AND expires_at > now())                  AS rows_visible,
  (SELECT count(*) FROM announcement_sources WHERE NOT publish)                                   AS sources_unpublished,
  (SELECT count(*) FROM announcement_sources WHERE consecutive_failures > 0)                      AS sources_with_failures,
  (SELECT max(last_fetch_at) FROM announcement_sources)                                          AS last_fetch_at;

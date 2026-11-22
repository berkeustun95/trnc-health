-- Bandabuliya going dark (Berke, 2026-11-22): what is live right before the flag flips off.
-- READ-ONLY: SELECTs only. Results are sealed (open with scripts/readonly-results.mjs → vault).
-- Counts and timestamps only: no row ids, no user ids, no titles, no message bodies, no storage paths.
SELECT 'active listings (live, not hidden, not sold, not expired)' AS what,
       (SELECT count(*) FROM marketplace_listings
         WHERE deleted_at IS NULL AND hidden_at IS NULL AND status = 'active' AND expires_at > now())::text AS value
UNION ALL
SELECT 'active listings expiring within 30 days',
       (SELECT count(*) FROM marketplace_listings
         WHERE deleted_at IS NULL AND hidden_at IS NULL AND status = 'active'
           AND expires_at > now() AND expires_at <= now() + interval '30 days')::text
UNION ALL
SELECT 'listings by state (all rows)',
       (SELECT format('live %s · sold %s · expired %s · hidden %s · deleted %s',
                      count(*) FILTER (WHERE deleted_at IS NULL AND hidden_at IS NULL AND status = 'active' AND expires_at > now()),
                      count(*) FILTER (WHERE deleted_at IS NULL AND status = 'sold'),
                      count(*) FILTER (WHERE deleted_at IS NULL AND hidden_at IS NULL AND status = 'active' AND expires_at <= now()),
                      count(*) FILTER (WHERE deleted_at IS NULL AND hidden_at IS NOT NULL),
                      count(*) FILTER (WHERE deleted_at IS NOT NULL))
          FROM marketplace_listings)
UNION ALL
SELECT 'sellers with an active listing',
       (SELECT count(DISTINCT owner_id) FROM marketplace_listings
         WHERE deleted_at IS NULL AND hidden_at IS NULL AND status = 'active' AND expires_at > now())::text
UNION ALL
SELECT 'sellers ever (any listing row)',
       (SELECT count(DISTINCT owner_id) FROM marketplace_listings)::text
UNION ALL
SELECT 'open listing chats (not declined, not closed)',
       (SELECT count(*) FROM conversations
         WHERE kind = 'listing' AND declined_at IS NULL AND closed_at IS NULL)::text
UNION ALL
SELECT 'open listing chats with a message in the last 7 days',
       (SELECT count(*) FROM conversations
         WHERE kind = 'listing' AND declined_at IS NULL AND closed_at IS NULL
           AND last_message_at > now() - interval '7 days')::text
UNION ALL
SELECT 'listing chats, all states',
       (SELECT format('total %s · accepted %s · declined %s · closed %s',
                      count(*), count(*) FILTER (WHERE accepted_at IS NOT NULL),
                      count(*) FILTER (WHERE declined_at IS NOT NULL), count(*) FILTER (WHERE closed_at IS NOT NULL))
          FROM conversations WHERE kind = 'listing')
UNION ALL
SELECT 'photos waiting for approval',
       (SELECT count(*) FROM marketplace_photos WHERE status = 'pending')::text
UNION ALL
SELECT 'oldest pending photo (hours)',
       coalesce((SELECT round(extract(epoch FROM now() - min(created_at)) / 3600)::text
                   FROM marketplace_photos WHERE status = 'pending'), 'none')
UNION ALL
SELECT 'photos by status',
       (SELECT format('pending %s · approved %s · rejected %s',
                      count(*) FILTER (WHERE status = 'pending'), count(*) FILTER (WHERE status = 'approved'),
                      count(*) FILTER (WHERE status = 'rejected'))
          FROM marketplace_photos)
UNION ALL
SELECT 'pending listing reports',
       (SELECT count(*) FROM content_reports WHERE content_type = 'listing' AND status = 'pending')::text
UNION ALL
SELECT 'cleanup job',
       coalesce((SELECT format('active=%s schedule=%s', active, schedule) FROM cron.job
                  WHERE jobname = 'marketplace-maintenance'), 'missing');

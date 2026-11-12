-- Bandabuliya nightly cleanup (20261185, job 'marketplace-maintenance', 01:23 UTC, applies): what it has done and
-- what it would do now. READ-ONLY: SELECTs only. Results are sealed (open with scripts/readonly-results.mjs);
-- no row ids, no user ids, no titles, no storage paths: counts and timestamps only.
--
-- "Would do now" mirrors marketplace_maintenance(apply) and marketplace_orphan_objects() exactly
-- (same predicates, same 500 cap) because supabase_read_only_user cannot EXECUTE them (service_role only).
SELECT 'job' AS what,
       format('active=%s schedule=%s', j.active, j.schedule) AS value
  FROM cron.job j WHERE j.jobname = 'marketplace-maintenance'
UNION ALL
SELECT 'run', format('%s · %s · %s', to_char(d.start_time AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI'), d.status,
                     left(coalesce(d.return_message, ''), 60))
  FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
 WHERE j.jobname = 'marketplace-maintenance'
UNION ALL
SELECT 'function reply', format('%s · %s · %s', to_char(r.created AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI'),
                                r.status_code, left(r.content, 300))
  FROM net._http_response r
 WHERE r.content LIKE '%purge_held_by_report%'
UNION ALL
SELECT 'would hide now (expired > 90 days)',
       (SELECT count(*) FROM (SELECT 1 FROM marketplace_listings
                                WHERE deleted_at IS NULL AND expires_at < now() - interval '90 days' LIMIT 500) x)::text
UNION ALL
SELECT 'would purge now (deleted > 30 days, no pending report)',
       (SELECT count(*) FROM (SELECT 1 FROM marketplace_listings l
                                WHERE l.deleted_at < now() - interval '30 days'
                                  AND NOT EXISTS (SELECT 1 FROM content_reports r
                                                   WHERE r.content_type = 'listing' AND r.content_id = l.id
                                                     AND r.status = 'pending')
                                LIMIT 500) x)::text
UNION ALL
SELECT 'purge held by a pending report',
       (SELECT count(*) FROM marketplace_listings l
         WHERE l.deleted_at < now() - interval '30 days'
           AND EXISTS (SELECT 1 FROM content_reports r WHERE r.content_type = 'listing' AND r.content_id = l.id
                         AND r.status = 'pending'))::text
UNION ALL
SELECT 'would remove now (photo files > 24 h with no live photo row)',
       (SELECT count(*) FROM (SELECT 1 FROM storage.objects o
                                WHERE o.bucket_id = 'marketplace-photos'
                                  AND o.created_at < now() - interval '24 hours'
                                  AND NOT EXISTS (SELECT 1 FROM public.marketplace_photos p
                                                   WHERE p.storage_path = o.name AND p.status <> 'rejected')
                                LIMIT 500) x)::text
UNION ALL
SELECT 'next due in that list (file age, hours)',
       coalesce((SELECT string_agg(round(extract(epoch FROM now() - o.created_at) / 3600)::text, ', ' ORDER BY o.created_at)
                   FROM storage.objects o
                  WHERE o.bucket_id = 'marketplace-photos'
                    AND NOT EXISTS (SELECT 1 FROM public.marketplace_photos p
                                     WHERE p.storage_path = o.name AND p.status <> 'rejected')), 'none')
UNION ALL
SELECT 'listings by state (all rows)',
       (SELECT format('live %s · deleted %s · hidden %s',
                      count(*) FILTER (WHERE deleted_at IS NULL), count(*) FILTER (WHERE deleted_at IS NOT NULL),
                      count(*) FILTER (WHERE hidden_at IS NOT NULL AND deleted_at IS NULL))
          FROM marketplace_listings);

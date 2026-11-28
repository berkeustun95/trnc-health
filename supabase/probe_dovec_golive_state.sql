-- Read-only probe (2026-11-28): Döveç state before go-live. Booleans only: no counts, no ids, no personal data.
SELECT
  (SELECT published FROM public.dovec_settings WHERE id = 1)                                        AS published,
  (SELECT suspended FROM public.dovec_settings WHERE id = 1)                                        AS suspended,
  EXISTS (SELECT 1 FROM public.dovec_leads WHERE NOT is_test)                                       AS any_user_lead_rows,
  EXISTS (SELECT 1 FROM public.dovec_leads WHERE NOT is_test AND status = 'mock')                   AS any_mock_rows,
  EXISTS (SELECT 1 FROM public.dovec_leads WHERE NOT is_test AND status <> 'mock')                  AS any_non_mock_user_rows,
  EXISTS (SELECT 1 FROM public.dovec_leads WHERE NOT is_test AND sent_at IS NOT NULL)               AS any_user_lead_sent,
  EXISTS (SELECT 1 FROM public.dovec_leads WHERE is_test)                                           AS test_row_exists,
  EXISTS (SELECT 1 FROM public.dovec_leads WHERE is_test AND status = 'sent')                       AS test_row_sent,
  EXISTS (SELECT 1 FROM public.dovec_leads WHERE is_test AND pii_wiped_at IS NULL)                  AS test_row_still_has_contact,
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dovec-leads-wipe' AND active
            AND command LIKE '%public.dovec_leads_wipe_pii()%')                                    AS wipe_job_active,
  EXISTS (SELECT 1 FROM cron.job j JOIN cron.job_run_details d ON d.jobid = j.jobid
           WHERE j.jobname = 'dovec-leads-wipe' AND d.status = 'succeeded'
             AND d.start_time > now() - interval '36 hours')                                       AS wipe_ran_ok_last_36h,
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dovec-sync' AND active)                           AS sync_job_active,
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dovec-lead-retry' AND active)                     AS retry_job_active,
  (SELECT last_good_sync_at > now() - interval '30 minutes' FROM public.dovec_settings WHERE id = 1) AS sync_fresh_30m;

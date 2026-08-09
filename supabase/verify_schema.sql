-- ═══════════════════════════════════════════════════════════════════════════
-- ADA schema drift audit — "committed but never applied" gap detector.
-- Manual-apply workflow has no CI, so this checks the LIVE DB against every
-- object the repo migrations claim to create. Run in Supabase SQL editor
-- (Role → postgres). Scan for status <> 'OK'. The `migration` column tells you
-- which file to apply. `area` will show MISSING until 20260806 is applied.
--
-- CONVENTION (keep this file the source of truth for schema drift):
--   • Every new migration MUST register the objects it creates into the relevant
--     section below (A tables · B columns · C functions · D triggers ·
--     E constraints · F indexes · G RPC grants · H behavior/version tokens ·
--     Q2 cron · Q3 policies). A migration whose objects aren't listed here is
--     invisible to the drift check.
--   • For a CREATE OR REPLACE that changes behavior without adding a new named
--     object, add an H-section token (a body/constraint substring) — existence
--     alone can't tell an old body from the new one.
--   • Every ADD COLUMN migration ends with `NOTIFY pgrst, 'reload schema';` so a
--     stale PostgREST cache can't mask a missing column as a 42703 query error.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── QUERY 1 — MAIN REPORT (tables, columns, functions, triggers, constraints,
--              grants, behavior-version tokens, RLS-enabled). One query. ──────
WITH report AS (

  -- ── A. TABLES ─────────────────────────────────────────────────────────────
  SELECT 'A-table' section, e.m migration, e.o object,
         CASE WHEN to_regclass('public.'||e.o) IS NOT NULL THEN 'OK' ELSE 'MISSING' END status
  FROM (VALUES
    ('capture_1','profiles'),('capture_1','facilities'),('capture_1','appointments'),
    ('capture_1','reviews'),('capture_1','questions'),('capture_1','answers'),
    ('capture_1','notifications'),('capture_1','claim_requests'),
    ('capture_1','facility_change_requests'),('capture_1','duty_list'),
    ('capture_1','duty_schedule'),('capture_1','pharmacist_scores'),
    ('capture_1','quiz_submissions'),
    ('0621_provider_verification','provider_documents'),
    ('0621_provider_verification','provider_credentials'),
    ('0702_job_postings','job_postings'),
    ('0712_ugc_moderation','blocks'),('0712_ugc_moderation','content_reports'),
    ('0712_ugc_moderation','blocked_terms'),
    ('0723_insurance_companies','insurance_companies'),
    ('0725_esim_waitlist','esim_waitlist'),
    ('0812_module_waitlist','module_waitlist'),
    -- referenced by capture_2 constraints; created in earlier/other migrations:
    ('pre-repo','events'),('pre-repo','home_services'),('pre-repo','transport_providers'),
    ('pre-repo','properties'),('pre-repo','beaches'),('pre-repo','landmarks'),
    ('pre-repo','bus_routes'),('pre-repo','estate_agencies'),('pre-repo','estate_agents')
  ) e(m,o)

  UNION ALL
  -- ── B. COLUMNS (the `area`-class risk — post-capture ALTERs) ───────────────
  SELECT 'B-column', e.m, e.t||'.'||e.c,
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns ic
                WHERE ic.table_schema='public' AND ic.table_name=e.t AND ic.column_name=e.c)
              THEN 'OK' ELSE 'MISSING' END
  FROM (VALUES
    ('0621_provider_verification','facility_change_requests','rejection_reason'),
    ('0621_provider_verification','claim_requests','rejection_reason'),
    ('0712_ugc_moderation','reviews','hidden_at'),
    ('0712_ugc_moderation','reviews','hidden_reason'),
    ('0712_ugc_moderation','questions','hidden_at'),
    ('0712_ugc_moderation','answers','hidden_at'),
    ('0712_ugc_moderation','profiles','ugc_banned_until'),
    ('0719_claim_evidence_and_guard','claim_requests','verified_by'),
    ('0719_claim_evidence_and_guard','claim_requests','verified_at'),
    ('0719_claim_evidence_and_guard','claim_requests','kteb_confirmed'),
    ('0719_claim_rename_and_tax_no','claim_requests','tax_registration_no'),
    ('0722_job_postings_business_paid_tier','job_postings','poster_type'),
    ('0722_job_postings_business_paid_tier','job_postings','payment_status'),
    ('0722_job_postings_business_paid_tier','job_postings','paid_at'),
    ('0722_job_postings_business_paid_tier','job_postings','payment_ref'),
    ('0723_place_photo_credits','landmarks','photo_credits'),
    ('0723_place_photo_credits','beaches','photo_credits'),
    ('0725_grooming_directory','facilities','category'),
    ('0726_grooming_booking_lifecycle','appointments','reminded_at'),
    ('0731_garages_directory','facilities','service_types'),
    ('0801_appointments_service_type','appointments','service_type'),
    ('0802_garage_booking_details','appointments','garage_booking_details'),
    ('0803_facility_report_moderation','facilities','hidden_at'),
    ('0803_facility_report_moderation','facilities','hidden_reason'),
    ('0805_facilities_city','facilities','city'),
    ('0806_facilities_area','facilities','area'),                 -- known gap
    ('0808_facility_featured_tier','facilities','featured_until'),
    ('0808_facility_featured_tier','facilities','featured_requested_at'),
    ('0809_featured_expiry_reminder','facilities','featured_reminded_at'),
    ('0811_facilities_service_prices','facilities','service_prices'),
    ('0812_module_waitlist','module_waitlist','notified_at')
  ) e(m,t,c)

  UNION ALL
  -- ── C. FUNCTIONS (existence by name; overloads collapse) ───────────────────
  SELECT 'C-function', e.m, e.o,
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname='public' AND p.proname=e.o)
              THEN 'OK' ELSE 'MISSING' END
  FROM (VALUES
    ('0623_cross_user_notifications','insert_notification'),
    ('0628/0705_search_content','search_content'),
    ('0714_block_anonymous_writes','is_anonymous_session'),
    ('capture_3_functions','auto_hide_reported_content'),
    ('capture_3_functions','block_content_author'),
    ('capture_3_functions','check_pending_appointment_limit'),
    ('capture_3_functions','check_question_limit'),
    ('capture_3_functions','check_report_rate_limit'),
    ('capture_3_functions','check_ugc_on_insert'),
    ('capture_3_functions','contains_blocked_term'),
    ('capture_3_functions','delete_own_account'),
    ('capture_3_functions','ev_guard_write'),
    ('capture_3_functions','expire_job_postings'),
    ('capture_3_functions','get_my_role'),
    ('capture_3_functions','guard_moderation_columns'),
    ('capture_3_functions','guard_profile_ban_column'),
    ('capture_3_functions','handle_new_user'),
    ('capture_3_functions','hs_guard_insert'),
    ('capture_3_functions','hs_guard_owner_update'),
    ('capture_3_functions','is_admin'),
    ('capture_3_functions','is_customer_blocked'),
    ('capture_3_functions','jp_guard_insert'),
    ('capture_3_functions','jp_guard_owner_update'),
    ('capture_3_functions','my_provider_facility_ids'),
    ('capture_3_functions','record_no_show'),
    ('capture_3_functions','tp_guard_write'),
    ('capture_3_functions','update_pharmacist_score'),
    ('0723_insurance_companies','ins_guard_write'),
    ('0719_create_facility_claim_rpc','create_facility_claim'),
    ('0719_fix_appointment_time_check','appointments_guard_requested_time'),
    ('0725_grooming_directory','create_grooming_facility'),
    ('0725_grooming_directory','facilities_guard_insert'),
    ('0726_grooming_booking_lifecycle','grooming_notif_text'),
    ('0726_grooming_booking_lifecycle','process_grooming_pending'),
    ('0731_garages_directory','create_garage_facility'),
    ('0802_update_garage_facility','update_garage_facility'),
    ('0803_grooming_owner_edit','update_grooming_facility'),
    ('0803_garage_booking_lifecycle','process_garage_pending'),
    ('0803_facility_report_moderation','auto_hide_reported_content'),
    ('0807_facility_content_filter','contains_payment_solicitation'),
    ('0807_facility_content_filter','check_facility_content'),
    ('0808_facility_featured_tier','request_featured_facility'),
    ('0808/0809_facilities_guard_update','facilities_guard_update'),
    ('0809_featured_expiry_reminder','featured_notif_text'),
    ('0809_featured_expiry_reminder','process_featured_expiring'),
    ('0810_change_request_content_filter','check_change_request_content'),
    ('0813_notify_module_waitlist','module_notif_text'),
    ('0813_notify_module_waitlist','notify_module_waitlist')
  ) e(m,o)

  UNION ALL
  -- ── D. TRIGGERS (existence by name) ────────────────────────────────────────
  SELECT 'D-trigger', e.m, e.o,
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger tg WHERE NOT tg.tgisinternal AND tg.tgname=e.o)
              THEN 'OK' ELSE 'MISSING' END
  FROM (VALUES
    ('0701_rate_limits','enforce_pending_appointment_limit'),
    ('0701_rate_limits','enforce_question_limit'),
    ('capture_4/0712','enforce_report_rate_limit'),
    ('capture_4/0712','guard_profile_ban'),
    ('capture_4/0712','guard_review_moderation'),
    ('capture_4/0712','guard_question_moderation'),
    ('capture_4/0712','guard_answer_moderation'),
    ('capture_4/0712','check_review_content'),
    ('capture_4/0712','check_question_content'),
    ('capture_4/0712','check_answer_content'),
    ('capture_4/0712','auto_hide_on_report'),
    ('capture_4','ev_guard_write'),
    ('capture_4','hs_guard_insert'),
    ('capture_4','hs_guard_owner_update'),
    ('capture_4','jp_guard_insert'),
    ('capture_4','jp_guard_owner_update'),
    ('capture_4','tp_guard_write'),
    ('capture_4','on_auth_user_created'),
    ('capture_4','on_submission_status_change'),
    ('0719_fix_appointment_time_check','appointments_guard_requested_time'),
    ('0723_insurance_companies','ins_guard_write'),
    ('0803_facility_report_moderation','guard_facility_moderation'),
    ('0807_facility_content_filter','check_facility_content'),
    ('0810_change_request_content_filter','check_change_request_content'),
    ('0719_claim_evidence_and_guard','claim_requests_guard_insert'),
    ('facilities_guard(0718→0809)','facilities_guard_update'),
    ('facilities_guard(0718→0731)','facilities_guard_insert')
  ) e(m,o)

  UNION ALL
  -- ── E. CHECK CONSTRAINTS (existence by name) ───────────────────────────────
  SELECT 'E-constraint', e.m, e.o,
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname=e.o)
              THEN 'OK' ELSE 'MISSING' END
  FROM (VALUES
    ('0731_garages_directory','facilities_type_check'),
    ('0731_garages_directory','facilities_service_types_values_check'),
    ('0804_grooming_multi_category','facilities_service_types_type_check'),
    ('0725_grooming_directory','facilities_category_check'),
    -- NB: facilities_grooming_category_check is intentionally DROPPED by
    -- 0804_grooming_multi_category (grooming moved to service_types[]; grooming rows
    -- now have category=NULL). Its absence is correct — do NOT re-add it.
    ('0805_facilities_city','facilities_city_check'),
    ('0724_events_category','events_category_check'),
    ('0701_security_fixes','reviews_customer_facility_unique'),
    ('capture_2','facilities_status_check'),
    ('capture_2','facilities_membership_tier_check'),
    ('0719_fix_signup','profiles_role_check'),
    ('0803_facility_report_moderation','content_reports_content_type_check'),
    ('0723_insurance_companies','insurance_companies_status_check'),
    ('0812_module_waitlist','module_waitlist_module_check')
  ) e(m,o)

  UNION ALL
  -- ── F. INDEXES (perf + the double-booking UNIQUE correctness guard) ────────
  SELECT 'F-index', e.m, e.o,
         CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=e.o)
              THEN 'OK' ELSE 'MISSING' END
  FROM (VALUES
    ('0725_appointments_double_booking_guard','appointments_active_slot_unique'), -- UNIQUE: correctness
    ('0702_job_postings','job_postings_owner_idx'),
    ('0702_job_postings','job_postings_board_idx'),
    ('0712_ugc_moderation','content_reports_pending_idx'),
    ('0712_ugc_moderation','content_reports_content_idx'),
    ('0712_ugc_moderation','reviews_customer_id_idx'),
    ('0723_insurance_companies','idx_insurance_companies_owner_id'),
    ('0719_add_missing_indexes','idx_facilities_provider_id'),
    ('0719_add_missing_indexes','idx_appointments_customer_id'),
    ('0719_add_missing_indexes','idx_appointments_facility_id'),
    ('0719_add_missing_indexes','idx_claim_requests_facility_id'),
    ('0719_add_missing_indexes','idx_claim_requests_requester_id'),
    ('0719_add_missing_indexes','idx_facility_change_requests_facility_id'),
    ('0719_add_missing_indexes','idx_facility_change_requests_provider_id'),
    ('0719_add_missing_indexes','idx_reviews_facility_id'),
    ('0719_add_missing_indexes','idx_questions_facility_id'),
    ('0719_add_missing_indexes','idx_questions_customer_id'),
    ('0719_add_missing_indexes','idx_answers_question_id'),
    ('0719_add_missing_indexes','idx_quiz_submissions_customer_id'),
    ('0719_add_missing_indexes','idx_quiz_submissions_assigned_facility_id'),
    ('0719_add_missing_indexes','idx_notifications_user_id'),
    ('0719_add_missing_indexes','idx_duty_schedule_facility_id'),
    ('0719_add_missing_indexes','idx_home_services_owner_id'),
    ('0719_add_missing_indexes','idx_events_organizer_id')
  ) e(m,o)

  UNION ALL
  -- ── G. RPC EXECUTE grants to `authenticated` (function exists but app can't
  --       call it = silent gap the client sees as a permission error) ─────────
  SELECT 'G-grant', e.m, e.o||'()→authenticated EXECUTE',
         CASE WHEN EXISTS (
                SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                LEFT JOIN LATERAL aclexplode(p.proacl) a ON TRUE
                LEFT JOIN pg_roles r ON r.oid=a.grantee
                WHERE n.nspname='public' AND p.proname=e.o
                  AND a.privilege_type='EXECUTE' AND r.rolname='authenticated')
              THEN 'OK' ELSE 'CHECK (no explicit grant)' END
  FROM (VALUES
    ('0731_garages_directory','create_garage_facility'),
    ('0802_update_garage_facility','update_garage_facility'),
    ('0725_grooming_directory','create_grooming_facility'),
    ('0803_grooming_owner_edit','update_grooming_facility'),
    ('0719_create_facility_claim_rpc','create_facility_claim'),
    ('0813_notify_module_waitlist','notify_module_waitlist')
  ) e(m,o)

  UNION ALL
  -- ── H. BEHAVIOR / VERSION TOKENS — catches a CREATE OR REPLACE that never
  --       ran, leaving an older body/constraint (existence alone can't see it) ─
  SELECT 'H-version', z.m, z.label, CASE WHEN z.ok THEN 'OK' ELSE 'STALE/MISSING' END
  FROM (
    SELECT '0705_search_content_add_jobs' m, 'search_content covers job_postings' label,
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='search_content'
          AND pg_get_functiondef(p.oid) ILIKE '%job_postings%') ok
    UNION ALL SELECT '0724_events_category_widen','events_category_check = final vocab (music+concert)',
      EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conname='events_category_check'
        AND pg_get_constraintdef(c.oid) ILIKE '%music%'
        AND pg_get_constraintdef(c.oid) ILIKE '%concert%')
    UNION ALL SELECT '0719_fix_signup','profiles_role_check allows home_service_provider',
      EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conname='profiles_role_check'
        AND pg_get_constraintdef(c.oid) ILIKE '%home_service_provider%')
    UNION ALL SELECT '0731_garages_directory','facilities_type_check allows garage',
      EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conname='facilities_type_check'
        AND pg_get_constraintdef(c.oid) ILIKE '%garage%')
    UNION ALL SELECT '0804_grooming_multi_category','service_types_values_check has grooming arm',
      EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conname='facilities_service_types_values_check'
        AND pg_get_constraintdef(c.oid) ILIKE '%grooming%')
    UNION ALL SELECT '0802_facilities_guard_garage_edit','facilities_guard_update has garage material lock',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='facilities_guard_update'
          AND pg_get_functiondef(p.oid) ILIKE '%update_garage_facility%')
    UNION ALL SELECT '0808_facility_featured_tier','facilities_guard_update knows featured_requested_at',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='facilities_guard_update'
          AND pg_get_functiondef(p.oid) ILIKE '%featured%')
    UNION ALL SELECT '0719_pin_definer_search_path','is_customer_blocked pinned search_path',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='is_customer_blocked'
          AND array_to_string(p.proconfig,',') ILIKE '%search_path%')
    UNION ALL SELECT '0719_pin_definer_search_path','record_no_show pinned search_path',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='record_no_show'
          AND array_to_string(p.proconfig,',') ILIKE '%search_path%')
    UNION ALL SELECT '0810_change_request_content_filter','filter reuses contains_payment_solicitation',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='check_change_request_content'
          AND pg_get_functiondef(p.oid) ILIKE '%contains_payment_solicitation%')
    UNION ALL SELECT '0814_module_waitlist_generalize_check','module_waitlist_module_check is shape guard (not enum)',
      EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conname='module_waitlist_module_check'
        AND pg_get_constraintdef(c.oid) NOT ILIKE '%homeServices%')
    UNION ALL SELECT '0815_questions_block_blocked_customers','insert questions policy blocks is_customer_blocked',
      EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='questions'
        AND policyname='insert questions'
        AND with_check ILIKE '%is_customer_blocked%')
    UNION ALL SELECT '0818_preferred_language_nullable','profiles.preferred_language nullable + no default (unset = NULL, not code ''en'')',
      (SELECT is_nullable='YES' AND column_default IS NULL
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='profiles' AND column_name='preferred_language')
  ) z

  UNION ALL
  -- ── I. RLS ENABLED on user-data tables (health app — must be ON) ───────────
  SELECT 'I-rls-enabled', '-', c.relname,
         CASE WHEN c.relrowsecurity THEN 'ON' ELSE 'OFF ← FIX' END
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN (
    'profiles','facilities','appointments','reviews','questions','answers',
    'notifications','claim_requests','facility_change_requests','job_postings',
    'content_reports','blocks','insurance_companies','esim_waitlist','module_waitlist',
    'provider_documents','provider_credentials','quiz_submissions','pharmacist_scores'
  )
)
SELECT * FROM report
ORDER BY (status IN ('OK','ON')) ASC, section, migration, object;   -- problems float to top


-- ── QUERY 2 — CRON JOBS (separate: errors if pg_cron isn't installed, which is
--              itself the finding). Expect 4 rows, all present. ───────────────
SELECT e.m migration, e.o job,
       CASE WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname=e.o) THEN 'OK' ELSE 'MISSING' END status
FROM (VALUES
  ('0705_job_postings_auto_expire','expire-job-postings'),
  ('0726_grooming_booking_lifecycle','grooming-pending-processor'),
  ('0803_garage_booking_lifecycle','garage-pending-processor'),
  ('0809_featured_expiry_reminder','featured-expiry-reminder')
) e(m,o)
ORDER BY status ASC, migration;


-- ── QUERY 3 — RLS POLICY COUNT per table (sanity vs capture_5's 172 policies).
--              A table that should be locked down showing 0 = a gap. ──────────
SELECT tablename, count(*) AS policies
FROM pg_policies WHERE schemaname='public'
GROUP BY tablename ORDER BY tablename;

-- ═══════════════════════════════════════════════════════════════════════════
-- ADA schema drift audit — "committed but never applied" gap detector.
-- Manual-apply workflow has no CI, so this checks the LIVE DB against every
-- object the repo migrations claim to create. Run in Supabase SQL editor
-- (Role → postgres). Scan for status <> 'OK'. The `migration` column tells you
-- which file to apply.
--
-- ▶ HOW TO RUN — the SQL editor shows only the LAST result set, so run the four
--   queries ONE AT A TIME. Each is a standalone statement under a
--   `═══ QUERY n / 4 ═══` banner: select from a banner down to the next banner
--   (or end of file) and run just that block.  1 = main report · 2 = cron ·
--   3 = RLS policy counts · 4 = storage.objects policies.
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

-- ═══════════════════════════════════════════════════════════════════════════
-- ═══ QUERY 1 / 4 — MAIN REPORT — run alone (select down to the QUERY 2 banner) ═══
-- ═══════════════════════════════════════════════════════════════════════════
-- tables · columns · functions · triggers · constraints · indexes · grants ·
-- behavior/version tokens · RLS-enabled. One big statement.
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
    ('0822_places_consolidation','places'),
    ('0826_place_claims','place_claims'),
    ('0905_towing_companies','towing_companies'),
    ('0910_contact_events','contact_events'),
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
    ('0719_claim_rename_and_tax_no','claim_requests','tax_registration_no'),
    -- DELIBERATELY ABSENT: claim_requests.kteb_confirmed and appointments.service_type.
    -- Both columns were DROPPED on purpose by 0902_capture_schema_drift, so listing them
    -- here reported MISSING forever. The H-version section already asserts their absence
    -- as the PASSING state. Do not re-add them: a drift checker carrying known-false
    -- positives teaches the reader to skim, and the next real MISSING gets skimmed too.
    ('0722_job_postings_business_paid_tier','job_postings','poster_type'),
    ('0722_job_postings_business_paid_tier','job_postings','payment_status'),
    ('0722_job_postings_business_paid_tier','job_postings','paid_at'),
    ('0722_job_postings_business_paid_tier','job_postings','payment_ref'),
    ('0723_place_photo_credits','landmarks','photo_credits'),
    ('0723_place_photo_credits','beaches','photo_credits'),
    ('0725_grooming_directory','facilities','category'),
    ('0726_grooming_booking_lifecycle','appointments','reminded_at'),
    ('0731_garages_directory','facilities','service_types'),
    ('0802_garage_booking_details','appointments','garage_booking_details'),
    ('0803_facility_report_moderation','facilities','hidden_at'),
    ('0803_facility_report_moderation','facilities','hidden_reason'),
    ('0805_facilities_city','facilities','city'),
    ('0806_facilities_area','facilities','area'),                 -- known gap
    ('0808_facility_featured_tier','facilities','featured_until'),
    ('0808_facility_featured_tier','facilities','featured_requested_at'),
    ('0809_featured_expiry_reminder','facilities','featured_reminded_at'),
    ('0811_facilities_service_prices','facilities','service_prices'),
    -- ── Slice 1: public health facilities. `sector` is the one that matters most
    --    here: facilities_public_type_sector_check and the claim guard both read it,
    --    so if it reads MISSING the guard is silently passing every claim.
    ('0911_facilities_public_health','facilities','sector'),
    ('0911_facilities_public_health','facilities','public_facility_type'),
    ('0911_facilities_public_health','facilities','tier'),
    ('0911_facilities_public_health','facilities','parent_facility_id'),
    ('0911_facilities_public_health','facilities','name_official'),
    -- ── Explore photo attribution. The column was applied BY HAND before its migration
    --    file existed, which is exactly the `area`-class failure this section is for:
    --    unregistered, so invisible to the check. Registered retroactively by 0917.
    ('0917_place_photo_attribution','places','photo_attribution'),
    ('0919_facilities_geocode_provenance','facilities','geocode_source'),
    ('0919_facilities_geocode_provenance','facilities','geocode_tier'),
    ('0919_facilities_geocode_provenance','facilities','geocode_corroboration'),
    ('0919_facilities_geocode_provenance','facilities','geocoded_at'),
    ('0917_place_photo_attribution','beaches','photo_attribution'),
    ('0917_place_photo_attribution','landmarks','photo_attribution'),
    ('0812_module_waitlist','module_waitlist','notified_at'),
    ('0824_place_moderation','places','hidden_at'),
    ('0824_place_moderation','places','hidden_reason'),
    ('0825_places_column_guards','places','featured_until'),
    ('0825_places_column_guards','places','featured_requested_at'),
    ('0829_place_resubmit','places','resubmit_count'),
    ('0830_events_gisekibris_import','events','source_image_url'),
    ('0830_events_gisekibris_import','events','description_i18n'),
    -- ── Slice 1: accommodation partner feed ──
    ('0904_accommodation_partner_feed','properties','source'),
    ('0904_accommodation_partner_feed','properties','external_id'),
    ('0904_accommodation_partner_feed','properties','source_url'),
    ('0904_accommodation_partner_feed','properties','last_seen_at'),
    ('0904_accommodation_partner_feed','properties','content_hash'),
    ('0904_accommodation_partner_feed','properties','updated_at'),
    ('0904_accommodation_partner_feed','properties','published_at'),
    ('0904_accommodation_partner_feed','properties','deed_type'),
    ('0904_accommodation_partner_feed','properties','net_area_sqm'),
    ('0904_accommodation_partner_feed','properties','plot_sqm'),
    ('0904_accommodation_partner_feed','properties','covered_area_sqm'),
    ('0904_accommodation_partner_feed','properties','floor'),
    ('0904_accommodation_partner_feed','properties','total_floors'),
    ('0904_accommodation_partner_feed','properties','building_age_band'),
    ('0904_accommodation_partner_feed','properties','living_rooms'),
    ('0904_accommodation_partner_feed','properties','ensuite_count'),
    ('0904_accommodation_partner_feed','properties','deposit'),
    ('0904_accommodation_partner_feed','properties','deposit_currency'),
    ('0904_accommodation_partner_feed','properties','min_term_months'),
    ('0904_accommodation_partner_feed','properties','bills_included'),
    ('0904_accommodation_partner_feed','properties','amenities'),
    ('0904_accommodation_partner_feed','properties','area'),
    ('0904_accommodation_partner_feed','properties','development_name'),
    ('0904_accommodation_partner_feed','properties','swap_available'),
    ('0904_accommodation_partner_feed','properties','gated_community'),
    ('0904_accommodation_partner_feed','properties','location_precision'),
    ('0904_accommodation_partner_feed','property_images','source_url'),
    ('0904_accommodation_partner_feed','property_images','content_hash'),
    ('0904_accommodation_partner_feed','property_images','is_primary'),
    ('0904_accommodation_partner_feed','estate_agencies','contact_name'),
    ('0904_accommodation_partner_feed','estate_agencies','contact_phone'),
    ('0904_accommodation_partner_feed','estate_agencies','contact_whatsapp'),
    -- Fallback number for a towing firm. The list query selects *, so a missing column
    -- here is not a cosmetic gap — PostgREST 42703s and the whole directory fails to load.
    ('0908_towing_phone_secondary','towing_companies','phone_secondary')

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
    ('0813_notify_module_waitlist','notify_module_waitlist'),
    ('0819_get_customer_contacts_rpc','get_customer_contacts'),
    ('0824_place_moderation','check_place_content'),
    ('0824_place_moderation','explore_category_counts'),
    ('0825_places_column_guards','places_guard_insert'),
    ('0825_places_column_guards','places_guard_update'),
    ('0826_place_claims','place_claims_guard_insert'),
    ('0826_place_claims','approve_place_claim'),
    ('0827_places_featured_tier','request_featured_place'),
    ('0829_place_resubmit','resubmit_place'),
    ('0904_accommodation_partner_feed','properties_touch_updated_at'),
    -- towing: hours validator is called from a CHECK, so if it goes missing every
    -- INSERT on towing_companies fails outright, not just the malformed ones.
    ('0905_towing_companies','towing_hours_valid'),
    ('0905_towing_companies','towing_touch_updated_at'),
    -- Search tokeniser. These three are not decoration: search_content calls all of them
    -- from every arm, so a missing one is a hard error on EVERY global search, for every
    -- user, signed in or not.
    ('0912_search_tokenised','search_fold'),
    ('0912_search_tokenised','search_all_tokens'),
    ('0912_search_tokenised','search_token_hits')
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
    ('facilities_guard(0718→0731)','facilities_guard_insert'),
    ('0824_place_moderation','guard_place_moderation'),
    ('0824_place_moderation','check_place_content'),
    ('0825_places_column_guards','places_guard_insert'),
    ('0825_places_column_guards','places_guard_update'),
    ('0826_place_claims','place_claims_guard_insert'),
    ('0904_accommodation_partner_feed','properties_touch_updated_at'),
    ('0905_towing_companies','towing_touch_updated_at')

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
    ('0911_facilities_public_health','facilities_sector_check'),
    ('0911_facilities_public_health','facilities_public_facility_type_check'),
    ('0911_facilities_public_health','facilities_public_type_sector_check'),
    ('0911_facilities_public_health','facilities_tier_check'),
    ('0911_facilities_public_health','facilities_public_tier_required_check'),
    ('0911_facilities_public_health','facilities_parent_not_self_check'),
    ('0911_facilities_public_health','facilities_parent_facility_id_fkey'),
    ('0724_events_category','events_category_check'),
    ('0701_security_fixes','reviews_customer_facility_unique'),
    ('capture_2','facilities_status_check'),
    ('capture_2','facilities_membership_tier_check'),
    ('0719_fix_signup','profiles_role_check'),
    ('0803_facility_report_moderation','content_reports_content_type_check'),
    ('0723_insurance_companies','insurance_companies_status_check'),
    ('0812_module_waitlist','module_waitlist_module_check'),
    ('0822_places_consolidation','places_category_check'),
    ('0822_places_consolidation','places_region_check'),
    ('0822_places_consolidation','places_status_check'),
    ('0822_places_consolidation','places_access_type_check'),
    ('0826_place_claims','place_claims_status_check'),
    ('0830_events_gisekibris_import','events_description_i18n_check'),
    -- ── Slice 1. The XOR is a SECURITY control: props_select_public treats
    --    source IS NOT NULL as a bypass of the agent-subscription paywall, and
    --    this constraint is the only thing stopping an agent setting source on
    --    their own row to buy it. If this reads MISSING, that bypass is OPEN.
    ('0904_accommodation_partner_feed','properties_source_agent_xor_check'),
    ('0904_accommodation_partner_feed','properties_deed_type_check'),
    ('0904_accommodation_partner_feed','properties_deposit_currency_check'),
    ('0904_accommodation_partner_feed','properties_amenities_shape_check'),
    ('0904_accommodation_partner_feed','properties_structure_range_check'),
    ('0904_accommodation_partner_feed','properties_location_precision_check'),
    -- Coordinates may not exist without a declared precision. This is what makes an
    -- 'area' centroid safe to store: no row can carry coordinates whose
    -- trustworthiness is unstated. If MISSING, approximate pins read as exact.
    ('0904_accommodation_partner_feed','properties_coords_precision_check'),
    -- Forces every FEED row to declare 'area'. Without it a partner row that omits
    -- location_precision inherits the 'exact' DEFAULT and lands as trustworthy.
    ('0904_accommodation_partner_feed','properties_feed_precision_check'),
    -- UNIQUE: correctness. The ON CONFLICT arbiter for the partner-feed upsert;
    -- a partial index cannot serve that role (the 20260830 lesson).
    ('0904_accommodation_partner_feed','properties_external_id_unique'),
    -- ── towing (0905). The region/domain checks are the load-bearing ones: they are
    --    what keeps the seven canonical region keys and the TWO vehicle classes from
    --    drifting away from constants/regions.js and the coverage-map polygon keys.
    ('0905_towing_companies','towing_slug_check'),
    ('0905_towing_companies','towing_base_region_check'),
    ('0905_towing_companies','towing_coverage_regions_check'),
    -- A firm that does not cover its own base region is invisible where it lives.
    ('0905_towing_companies','towing_base_in_coverage_check'),
    ('0905_towing_companies','towing_vehicle_classes_check'),
    ('0905_towing_companies','towing_services_check'),
    ('0905_towing_companies','towing_starting_price_check'),
    ('0905_towing_companies','towing_opening_hours_check'),
    -- UNIQUE: correctness. slug is the stable external handle for a firm.
    ('0905_towing_companies','towing_companies_slug_key'),
    -- contact_events. These CHECKs are not an anti-attacker measure — they catch typos
    -- in OUR OWN call sites. Without the action one, 'whatsApp' inserts happily and a
    -- firm's contacts split across two values that never add up, so the figure quoted
    -- to that firm is quietly too low forever.
    ('0910_contact_events','contact_events_module_check'),
    ('0910_contact_events','contact_events_action_check'),
    ('0910_contact_events','contact_events_region_check')

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
    ('0911_facilities_public_health','idx_facilities_parent_facility_id'),
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
    ('0719_add_missing_indexes','idx_events_organizer_id'),
    ('0822_places_consolidation','idx_places_status'),
    ('0822_places_consolidation','idx_places_region'),
    ('0822_places_consolidation','idx_places_category'),
    ('0822_places_consolidation','idx_places_provider'),
    ('0822_places_consolidation','idx_places_submitted_by'),
    ('0826_place_claims','idx_place_claims_place_id'),
    ('0826_place_claims','idx_place_claims_requester_id'),
    -- UNIQUE: correctness. Replaces the partial index events_external_id_key
    -- (never registered here), which ON CONFLICT could not infer.
    ('0830_events_gisekibris_import','events_external_id_unique'),
    -- ── Slice 1. Four only; every other Slice 3 filter column was argued down
    --    for lack of evidence of use — see the migration header.
    ('0904_accommodation_partner_feed','properties_browse_idx'),
    ('0904_accommodation_partner_feed','property_images_property_id_idx'),
    -- UNIQUE: correctness — at most one primary image per property.
    ('0904_accommodation_partner_feed','property_images_primary_unique'),
    -- towing: ONE index by design. vehicle_classes is a two-value domain and can
    -- never be selective, so it deliberately has none — see the migration header.
    ('0905_towing_companies','idx_towing_companies_coverage'),
    -- contact_events: taps for one firm over a date range — the only query that runs,
    -- and what contact_events_monthly groups by.
    ('0910_contact_events','idx_contact_events_module_entity_time')

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
    ('0813_notify_module_waitlist','notify_module_waitlist'),
    ('0819_get_customer_contacts_rpc','get_customer_contacts'),
    ('0824_place_moderation','explore_category_counts'),  -- also GRANTed to anon (public tile counts)
    ('0826_place_claims','approve_place_claim'),
    ('0829_place_resubmit','resubmit_place'),
    -- search_content is SECURITY INVOKER, so a signed-out visitor's call is permission-
    -- checked against these three too. Without the grants the RPC exists and every
    -- search returns a permission error, with nothing in the app to explain it.
    ('0912_search_tokenised','search_fold'),
    ('0912_search_tokenised','search_all_tokens'),
    ('0912_search_tokenised','search_token_hits')
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
    -- The widening keeps the constraint NAME, so E-constraint existence cannot see
    -- it. Without this token a DB still on the 500-char limit reads as OK, and the
    -- Gişe Kıbrıs import (longest row 2039 chars) fails at insert time.
    UNION ALL SELECT '0830_events_gisekibris_import','events_description_check widened to 2500',
      EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conname='events_description_check'
        AND pg_get_constraintdef(c.oid) ILIKE '%2500%')
    -- Data migration, so it creates no named object at all and every other section
    -- is blind to it. If it was committed but never applied, the next Gişe Kıbrıs
    -- import matches nothing on the real key and INSERTS a duplicate of all 69 rows
    -- alongside the originals. import-gisekibris-events.mjs aborts on the same
    -- condition at runtime; this is the audit-time half of that guard.
    UNION ALL SELECT '0831_events_external_id_remap','zero synthetic gisekibris external_ids remain',
      NOT EXISTS(SELECT 1 FROM public.events
        WHERE source='gisekibris' AND external_id ~ '^gk-[0-9a-f]{12}$')
    -- NOT NULL is not a named constraint, so the E-constraint section is blind to it.
    -- Without this token a DB that never got the migration reads as OK, and a ragged
    -- upsert can silently NULL status again — which hides rows from every user,
    -- because the read policy is status='approved'. Default must stay 'draft':
    -- ev_guard_write rejects any non-admin INSERT whose status is not draft.
    UNION ALL SELECT '0901_events_status_not_null','events.status is NOT NULL, default still draft',
      EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='events' AND column_name='status'
          AND is_nullable='NO' AND column_default LIKE '%draft%')
    -- ── 0902 capture. Three drift items this register could not see before, because
    -- it only checks what somebody remembered to add to it. All three are ABSENCE
    -- facts, which no existence section can express.
    -- 20260802 replaced this with garage_booking_details jsonb; its DROP never ran.
    UNION ALL SELECT '0902_capture_schema_drift','appointments.service_type is GONE',
      NOT EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='appointments' AND column_name='service_type')
    -- Resurrected by re-running 20260719_claim_evidence_and_guard AFTER the rename to
    -- business_verified. ADD COLUMN IF NOT EXISTS is not re-run-safe across a RENAME.
    UNION ALL SELECT '0902_capture_schema_drift','claim_requests.kteb_confirmed is GONE',
      NOT EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='claim_requests' AND column_name='kteb_confirmed')
    -- A 411-row snapshot of facilities with no CREATE anywhere in the repo. Unreachable
    -- only because RLS is on with zero policies — assert both halves of that.
    -- to_regclass, NOT ::regclass — the cast RAISES on a missing relation, and absence
    -- is the PASSING state here, so the cast would turn the whole drift check into a
    -- hard error the moment the migration succeeds.
    UNION ALL SELECT '0902_capture_schema_drift','facilities_backup_20260718 is gone',
      to_regclass('public.facilities_backup_20260718') IS NULL
    UNION ALL SELECT '0719_fix_signup','profiles_role_check allows home_service_provider',
      EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conname='profiles_role_check'
        AND pg_get_constraintdef(c.oid) ILIKE '%home_service_provider%')
    UNION ALL SELECT '0731_garages_directory','facilities_type_check allows garage',
      EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conname='facilities_type_check'
        AND pg_get_constraintdef(c.oid) ILIKE '%garage%')
    -- ── 0911 public health facilities. THREE tokens, all for the same reason: each
    -- one is a same-name DROP/ADD or a behaviour-only CREATE OR REPLACE, so the
    -- E-constraint and C-function sections see the NAME and cannot see the CHANGE.
    -- Without these, a database that never received this migration reads 100% OK.
    --
    -- (1) The 'draft' value. If this is missing, every seeded public-health row was
    -- rejected on insert — or, worse, somebody "fixed" the rejection by seeding
    -- 'pending' instead and quietly parked ~36 rows on the admin approval badge.
    UNION ALL SELECT '0911_facilities_public_health','facilities_status_check allows draft',
      EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conname='facilities_status_check'
        AND pg_get_constraintdef(c.oid) ILIKE '%draft%')
    -- (2) The claim guard's sector branch. A public facility has no owner to verify and
    -- nothing to sell; this is the only thing standing between a provider account with a
    -- tax number and ownership of Dr. Burhan Nalbantoğlu Devlet Hastanesi. It is invisible
    -- to the D-trigger section, which only checks that a trigger of that NAME exists.
    UNION ALL SELECT '0911_facilities_public_health','claim_requests_guard_insert refuses sector=public',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='claim_requests_guard_insert'
          AND pg_get_functiondef(p.oid) ILIKE '%public health facilities cannot be claimed%')
    -- (3) search_content matching name_official. Nobody local types the eponym, but the
    -- eponym is what is on the building and on the paperwork a newcomer is holding. If
    -- this reads false, searching "Dr Engin Arkan" returns nothing and the facility
    -- looks absent from ADA. Note this ALSO catches the towing arm being clobbered: a
    -- re-apply of the pre-0906 body would drop both at once.
    UNION ALL SELECT '0911_facilities_public_health','search_content matches facilities.name_official',
      (SELECT pg_get_functiondef('public.search_content(text,double precision,double precision)'::regprocedure)
         ILIKE '%f.name_official%')
    -- (4) The update guard's five new locks. facilities_guard_update is a DENY-LIST, so
    -- a new column is owner-writable the moment it is added. If this reads false, any
    -- provider can UPDATE their own row to sector='public' + a tier and become, as far
    -- as the routing screen is concerned, a state health facility. `sector` is checked
    -- as the sentinel — the five branches ship and are reverted together.
    UNION ALL SELECT '0911_facilities_public_health','facilities_guard_update locks sector/tier/parent/name_official',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='facilities_guard_update'
          AND pg_get_functiondef(p.oid) ILIKE '%sector is admin-only%'
          AND pg_get_functiondef(p.oid) ILIKE '%parent_facility_id is admin-only%')
    -- And that the 0809 reminder lock SURVIVED the 0911 rewrite — the clobber this
    -- register exists to catch. Duplicated deliberately: 0809 has no token of its own.
    UNION ALL SELECT '0911_facilities_public_health','facilities_guard_update still locks featured_reminded_at',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='facilities_guard_update'
          AND pg_get_functiondef(p.oid) ILIKE '%featured_reminded_at is admin-only%')
    -- (6) The seven live state hospitals are sector='public'. A DATA fact, not a schema
    -- one, so no existence section can see it — and it is the one that closes a hole that
    -- was open in production: all seven are status='active' with provider_id NULL, i.e.
    -- claimable by any provider account until claim_requests_guard_insert had a `sector`
    -- to key on. If this reads MISSING, section 6b of the migration never ran (or the
    -- rows were renamed) and TRNC's state hospitals are claim targets again.
    UNION ALL SELECT '0911_facilities_public_health','7 live state hospitals carry sector=public',
      (SELECT count(*) = 7 FROM public.facilities WHERE sector = 'public'
        AND name IN ('Dr. Burhan Nalbantoğlu Devlet Hastanesi','Gazimağusa Devlet Hastanesi',
                     'Girne Dr. Akçiçek Devlet Hastanesi','Girne Devlet Hastanesi',
                     'Lefke Cengiz Topel Hastanesi','Barış Ruh ve Sinir Hastalıkları Hastanesi',
                     'Acil Durum Hastanesi'))
    -- (7) The tier guarantee is exempted for ONE named row, not relaxed for all. Acil
    -- Durum Hastanesi has no published basamak (ministry page carries only a link; the
    -- hospital's own site states none), so its tier is honestly NULL. The exemption is
    -- written into the constraint definition as a literal id, which makes it visible to
    -- anyone reading \d facilities. If the `id = ` clause is gone while `tier IS NOT
    -- NULL` remains, someone either supplied the tier (fine — retire this token) or
    -- dropped the exemption and the row (not fine). If BOTH are gone, the guarantee was
    -- relaxed globally and every future public row may be tierless.
    -- (7) The tier enum carries 'unknown'. Acil Durum Hastanesi has no published basamak
    -- (ministry page carries only a link; the hospital's own site states none), so it is
    -- stored as a REAL value rather than NULL — NULL would be ambiguous between "never
    -- set", "not applicable" and "genuinely unknown", and this column feeds tier routing.
    -- A row-scoped CHECK exemption naming its uuid was considered and REJECTED: it would
    -- encode a data accident in the schema.
    UNION ALL SELECT '0911_facilities_public_health','facilities_tier_check allows unknown',
      EXISTS(SELECT 1 FROM pg_constraint WHERE conname='facilities_tier_check'
        AND pg_get_constraintdef(oid) ILIKE '%unknown%')
    -- (8) …and the half-coupling stayed GLOBAL. If a literal id ever appears in this
    -- constraint, the rejected carve-out idea came back.
    UNION ALL SELECT '0911_facilities_public_health','public tier requirement is global, no uuid carve-out',
      EXISTS(SELECT 1 FROM pg_constraint WHERE conname='facilities_public_tier_required_check'
        AND pg_get_constraintdef(oid) ILIKE '%tier IS NOT NULL%'
        AND pg_get_constraintdef(oid) NOT ILIKE '%id =%')
    -- (9) 'unknown' has not spread. EXACTLY ONE row may carry it, and Slice 2 reconciles
    -- ten more hospital-tier rows for which it is the easiest thing to type. No CHECK can
    -- express "at most one"; this token is the only thing that will notice.
    UNION ALL SELECT '0911_facilities_public_health','tier=unknown is still a one-off (exactly 1 row)',
      (SELECT count(*) = 1 FROM public.facilities WHERE tier = 'unknown')
    -- (10) The Girne duplicate stays HIDDEN. 91338177 and 7a1c598d are the same hospital;
    -- the duplicate is status='draft' (invisible, unclaimable, nothing destroyed) pending
    -- its own reviewed merge slice. If this reads false, two Girne hospitals are rendering
    -- in the directory again — or the row was deleted, which was explicitly not the plan.
    UNION ALL SELECT '0911_facilities_public_health','Girne duplicate 91338177 is still draft',
      (SELECT count(*) = 1 FROM public.facilities
        WHERE id = '91338177-85d8-4f38-8b0f-2c395638d2d4' AND status = 'draft')
    -- ── 0912 tokenised search + Slice 2. Same-name DROP/ADD and behaviour-only
    -- CREATE OR REPLACE throughout, so section E and C see the NAMES and not the CHANGES.
    UNION ALL SELECT '0912_search_tokenised','facilities_tier_check allows not_applicable',
      EXISTS(SELECT 1 FROM pg_constraint WHERE conname='facilities_tier_check'
        AND pg_get_constraintdef(oid) ILIKE '%not_applicable%')
    -- THE alarm for this slice. If search_content reverted to substring matching, the
    -- function still exists, still runs, still returns rows — and quietly stops finding
    -- "Girne Devlet Hastanesi" and "Lefkoşa Devlet Hastanesi" again. Nothing else notices.
    UNION ALL SELECT '0912_search_tokenised','search_content matches by TOKEN, not substring',
      (SELECT pg_get_functiondef('public.search_content(text,double precision,double precision)'::regprocedure)
         ILIKE '%search_all_tokens%')
    -- Title-first ordering. Without it a pharmacy 49 km away outranks every hospital in
    -- the country, because unplaced rows sort last under distance-first.
    UNION ALL SELECT '0912_search_tokenised','search_content ranks title relevance above distance',
      (SELECT pg_get_functiondef('public.search_content(text,double precision,double precision)'::regprocedure)
         ILIKE '%search_token_hits(title, query) DESC%')
    -- The Turkish fold must cover the circumflex letters too (kâğıt, âlem) or the server
    -- and the client disagree on ordinary Turkish words.
    UNION ALL SELECT '0912_search_tokenised','search_fold covers Â Î Û as well as the base set',
      (SELECT public.search_fold('Kâğıt Îhsan Ûlker Çağla Gökçe İzmir ılık')
              = 'kagit ihsan ulker cagla gokce izmir ilik')
    -- Both placeholder tiers are one-offs. No CHECK can express "at most one row"; Slices
    -- 3 and 4 reconcile ~27 more rows for which both values are the easiest thing to type.
    UNION ALL SELECT '0912_search_tokenised','tier=not_applicable is still exactly 1 row (Kronik)',
      (SELECT count(*) = 1 FROM public.facilities
        WHERE tier = 'not_applicable' AND id = 'a1b2c3d4-0001-4000-8000-000000000003')
    -- The two BNDH units keep their parent. If parent_facility_id is ever nulled they
    -- render as two more standalone hospitals in every list.
    UNION ALL SELECT '0912_search_tokenised','Thalassaemia + Radyasyon Onkoloji are parented to BNDH',
      (SELECT count(*) = 2 FROM public.facilities
        WHERE parent_facility_id = 'e83f3d1d-c0c0-4e68-993c-03a8164286c1')
    -- ── 0915 deed_type comment. A COMMENT creates no named object, so EVERY other
    -- section of this script is blind to it — this token is the only thing that can see
    -- whether the migration ran. It matters because the SUPERSEDED text tells the reader
    -- that parsing deed_type is "heuristic and unreliable", which was true of 101evler
    -- and is false of the Novest feed. A stale comment here does not fail loudly; it
    -- quietly talks the next person out of a rule that works.
    UNION ALL SELECT '0915_properties_deed_type_comment','properties.deed_type comment documents the anchored rule',
      (SELECT col_description(c.oid, a.attnum) ILIKE '%ANCHORED WHOLE-<li> MATCH%'
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = 'public' AND c.relname = 'properties'
          AND a.attname = 'deed_type' AND NOT a.attisdropped)
    -- ── 0916 Novest agency + seed teardown. Pure data: no named object anywhere, so
    -- nothing else in this script can see whether it ran. Two tokens because the two
    -- halves fail differently and both are silent.
    --
    -- (1) The agency row. If it is missing, the importer either aborts or writes
    -- agency_id NULL on all 88 rows — and a NULL agency_id renders a listing with no
    -- agency name, which is the one attribution the partner relationship requires.
    UNION ALL SELECT '0916_novest_agency_and_seed_teardown','Coldwell Banker Novest agency row exists and is active',
      (SELECT count(*) = 1 FROM public.estate_agencies
        WHERE id = '00000000-0000-4000-9000-000000000002' AND status = 'active')
    -- (2) The teardown. Seed rows carry source='seed-slice3', which props_select_public
    -- treats as a partner-feed bypass of the subscription paywall — so a surviving seed
    -- row is PUBLICLY READABLE fake data sitting alongside real listings, and it is
    -- invisible today only because the module flag is false. If this ever reads false
    -- after the flag flips, ten Unsplash listings are live in the app.
    UNION ALL SELECT '0916_novest_agency_and_seed_teardown','zero seed-slice3 listings remain',
      NOT EXISTS(SELECT 1 FROM public.properties
        WHERE source = 'seed-slice3' OR external_id LIKE 'SEED3-%')
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
    -- The three below close the drift-check gap on this session's most critical fixes:
    -- the two remaining unpinned SECURITY DEFINER functions, and the S1 signup
    -- allow-list (the token above only checks the unrelated home_service_provider role).
    UNION ALL SELECT '0719_pin_definer_search_path','my_provider_facility_ids pinned search_path',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='my_provider_facility_ids'
          AND array_to_string(p.proconfig,',') ILIKE '%search_path%')
    UNION ALL SELECT '0719_pin_definer_search_path','update_pharmacist_score pinned search_path',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='update_pharmacist_score'
          AND array_to_string(p.proconfig,',') ILIKE '%search_path%')
    UNION ALL SELECT '0719_fix_signup','handle_new_user sanitizes signup role to allow-list (NOT IN customer/provider/organizer)',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='handle_new_user'
          AND pg_get_functiondef(p.oid) ILIKE '%not in%organizer%')
    UNION ALL SELECT '0819_record_no_show_time_guard','record_no_show requires requested_time < now()',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='record_no_show'
          AND pg_get_functiondef(p.oid) ILIKE '%requested_time < now()%')
    UNION ALL SELECT '0820_facilities_moderation_read_policy','facilities public read is moderation-gated (no USING(true))',
      (EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='facilities'
                AND policyname='public read live facilities'
                AND qual ILIKE '%hidden_at%' AND qual ILIKE '%active%')
       AND NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='facilities'
                AND policyname='Anyone can read facilities'))
    UNION ALL SELECT '0820_search_content_gate_facilities','search_content facilities arm filters status/hidden_at',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='search_content'
          AND pg_get_functiondef(p.oid) ILIKE '%f.hidden_at is null%')
    UNION ALL SELECT '0821_drop_providers_read_customer','profiles over-share policy removed (providers use get_customer_contacts RPC)',
      NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles'
                AND policyname='providers read customer push token')
    UNION ALL SELECT '0824_place_moderation','content_reports_content_type_check admits place',
      EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conname='content_reports_content_type_check'
        AND pg_get_constraintdef(c.oid) ILIKE '%place%')
    UNION ALL SELECT '0824_place_moderation','auto_hide_reported_content has place branch',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='auto_hide_reported_content'
          AND pg_get_functiondef(p.oid) ILIKE '%UPDATE places%')
    UNION ALL SELECT '0824_place_moderation','check_place_content reuses contains_payment_solicitation',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='check_place_content'
          AND pg_get_functiondef(p.oid) ILIKE '%contains_payment_solicitation%')
    UNION ALL SELECT '0825_places_column_guards','places_guard_update locks featured_requested_at (4-column body)',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='places_guard_update'
          AND pg_get_functiondef(p.oid) ILIKE '%featured_requested_at%')
    UNION ALL SELECT '0826_place_claims','approve_place_claim is race-hardened (FOR UPDATE)',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='approve_place_claim'
          AND pg_get_functiondef(p.oid) ILIKE '%FOR UPDATE%')
    UNION ALL SELECT '0827_places_featured_tier','places_guard_update trusted-write scoped to featured_requested_at only',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='places_guard_update'
          AND pg_get_functiondef(p.oid) ILIKE '%trusted write may only%')
    -- Anchored on 'studentHub' (an identifier absent from both bodies pre-apply), NOT on
    -- 'explore' — the English/Spanish body templates already contain "explore"/"explorar",
    -- so an '%explore%' token would pass before the migration is applied (drift-blind).
    UNION ALL SELECT '0828_explore_waitlist','notify_module_waitlist allow-list has explore+studentHub',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='notify_module_waitlist'
          AND pg_get_functiondef(p.oid) ILIKE '%studentHub%')
    UNION ALL SELECT '0828_explore_waitlist','module_notif_text name-map has explore+studentHub',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='module_notif_text'
          AND pg_get_functiondef(p.oid) ILIKE '%studentHub%')
    UNION ALL SELECT '0829_place_resubmit','places_guard_update honors the trusted_place_resubmit GUC',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='places_guard_update'
          AND pg_get_functiondef(p.oid) ILIKE '%trusted_place_resubmit%')

    -- ══ Slice 1: accommodation partner feed ═════════════════════════════════
    -- The four widened CHECKs KEEP THEIR NAMES, so section E (existence by name)
    -- cannot see the widening — a DB still on the old vocabulary reads as OK there.
    -- Each token below asserts the NEW value is actually in the constraint body.
    UNION ALL SELECT '0904_accommodation_partner_feed','properties_status_check widened (+delisted)',
      EXISTS(SELECT 1 FROM pg_constraint WHERE conname='properties_status_check'
        AND pg_get_constraintdef(oid) ILIKE '%delisted%')
    -- Without this, a partner listing priced in USD fails at INSERT time.
    UNION ALL SELECT '0904_accommodation_partner_feed','properties_currency_check widened (+USD)',
      EXISTS(SELECT 1 FROM pg_constraint WHERE conname='properties_currency_check'
        AND pg_get_constraintdef(oid) ILIKE '%USD%')
    -- Was a LIVE BUG: the CHECK allowed 5 regions while constants/regions.js REGIONS
    -- defines 7. A Novest listing in Lefke or Karpaz could not be inserted at all.
    UNION ALL SELECT '0904_accommodation_partner_feed','properties_district_check widened (+lefke,+karpaz)',
      EXISTS(SELECT 1 FROM pg_constraint WHERE conname='properties_district_check'
        AND pg_get_constraintdef(oid) ILIKE '%lefke%'
        AND pg_get_constraintdef(oid) ILIKE '%karpaz%')
    UNION ALL SELECT '0904_accommodation_partner_feed','properties_price_period_check widened (+weekly,+yearly)',
      EXISTS(SELECT 1 FROM pg_constraint WHERE conname='properties_price_period_check'
        AND pg_get_constraintdef(oid) ILIKE '%weekly%'
        AND pg_get_constraintdef(oid) ILIKE '%yearly%')

    -- agent_id must be NULLABLE — a partner listing has no agent. Section B only
    -- checks that a column EXISTS, so it is blind to the nullability change, and the
    -- whole feed import fails at INSERT without it.
    UNION ALL SELECT '0904_accommodation_partner_feed','properties.agent_id is nullable',
      EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='properties'
          AND column_name='agent_id' AND is_nullable='YES')

    -- ── POLICY BODIES. Q3 counts policies; it cannot see what one SAYS. ──
    -- If this token is STALE, every partner listing is invisible to every user.
    UNION ALL SELECT '0904_accommodation_partner_feed','props_select_public has the partner-feed branch',
      EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='properties'
        AND policyname='props_select_public' AND qual ILIKE '%source IS NOT NULL%')
    -- The LEFT JOIN is load-bearing: the previous INNER JOIN to estate_agents discards
    -- every feed row (agent_id IS NULL) BEFORE the source test runs. Mirroring the
    -- condition without the join change yields zero visible images and a blank gallery.
    UNION ALL SELECT '0904_accommodation_partner_feed','images_select_public uses LEFT JOIN (not INNER)',
      EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='property_images'
        AND policyname='images_select_public' AND qual ILIKE '%LEFT JOIN%')
    -- Behaviour is identical with or without it (Postgres applies USING to the new row
    -- when WITH CHECK is absent). Registered so the protection stops being IMPLICIT:
    -- anyone later adding a WITH CHECK here for an unrelated reason would silently
    -- remove the guard that rejects agent_id=NULL laundering.
    UNION ALL SELECT '0904_accommodation_partner_feed','props_update_agent has an explicit WITH CHECK',
      EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='properties'
        AND policyname='props_update_agent' AND with_check IS NOT NULL)
    -- Without this predicate ANY authenticated user can write under the partner/ prefix
    -- that is supposed to be service_role-only.
    UNION ALL SELECT '0904_accommodation_partner_feed','storage property_images_upload excludes partner/',
      EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
        AND policyname='property_images_upload' AND with_check ILIKE '%partner%')

    -- The trigger must IGNORE last_seen_at (stamped on every row every sync run) and
    -- view_count. Section D only proves the trigger EXISTS; an unconditional body would
    -- pass there while making updated_at meaningless.
    -- building_age_band is a TEXT BAND ("6 - 10"), not an int — 101evler exposes a dropdown
    -- of ranges. Section B only proves the column EXISTS, so an earlier int version
    -- passes there while rejecting every real value the feed sends.
    UNION ALL SELECT '0904_accommodation_partner_feed','properties.building_age_band is text (a band, not a number)',
      EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='properties'
          AND column_name='building_age_band' AND data_type='text')
    UNION ALL SELECT '0904_accommodation_partner_feed','structure_range_check excludes building_age_band',
      NOT EXISTS(SELECT 1 FROM pg_constraint
        WHERE conname='properties_structure_range_check'
          AND pg_get_constraintdef(oid) ILIKE '%building_age_band%')
    -- The DEFAULT is load-bearing twice over: it keeps the parked PropertySubmitScreen
    -- INSERT legal, AND it is what makes properties_feed_precision_check bite on an
    -- import that omits the column. If the default is missing, that trap never springs.
    UNION ALL SELECT '0904_accommodation_partner_feed','location_precision DEFAULT is ''exact''',
      EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='properties'
          AND column_name='location_precision' AND column_default LIKE '%exact%')
    -- NULL-SAFETY. `location_precision = ''area''` alone evaluates to UNKNOWN on a NULL,
    -- and a CHECK PASSES on UNKNOWN — admitting the exact row it exists to reject. The
    -- IS NOT NULL guard is what makes it bite; assert the guard is really in the body.
    UNION ALL SELECT '0904_accommodation_partner_feed','feed_precision_check is NULL-safe',
      EXISTS(SELECT 1 FROM pg_constraint WHERE conname='properties_feed_precision_check'
        AND pg_get_constraintdef(oid) ILIKE '%IS NOT NULL%')
    -- duty_list's natural key. Without it a chunked year-sized load (~5,100 rows) that
    -- gets re-run duplicates a year of health data SILENTLY, and duplicates render as
    -- separate pharmacies. If this goes red, the next roster load is unsafe to repeat.
    UNION ALL SELECT '0920_duty_list_idempotent_load','duty_list (duty_date, name) unique',
      EXISTS(SELECT 1 FROM pg_constraint WHERE conname='duty_list_date_name_unique')
    -- Coordinates may not exist without recorded provenance. This is the "unverified
    -- stays NULL" rule made structural, so a tired hand cannot write shaky coordinates
    -- "to be tidied later". If it goes red, pins can be written from nowhere again —
    -- and the 387-row Nominatim seed becomes appliable, which is the whole hazard.
    UNION ALL SELECT '0919_facilities_geocode_provenance','coords require provenance',
      EXISTS(SELECT 1 FROM pg_constraint WHERE conname='facilities_coords_need_provenance')
      AND EXISTS(SELECT 1 FROM pg_constraint WHERE conname='facilities_coords_both_or_neither')
    -- checkins joined the notify path. Its ENTRY POINT is ungated (the Check-in button
    -- sits on a live place profile), so signups accumulate from the next OTA onward
    -- whether or not this migration was ever applied — the module_waitlist CHECK is only
    -- a shape guard. If this goes red, those signups are silently un-notifiable, and the
    -- failure surfaces on the one day it matters: launch day.
    UNION ALL SELECT '0918_notify_waitlist_add_checkins','notify path covers checkins',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='notify_module_waitlist'
          AND pg_get_functiondef(p.oid) ILIKE '%checkins%')
      AND EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='module_notif_text'
          -- BOTH tables, deliberately: the whitelist alone yields a NULL title and a blast
          -- that dies on notifications.title NOT NULL. Buradayım proves the per-language
          -- row, Check-ins proves the English fallback the other 7 locales resolve to.
          AND pg_get_functiondef(p.oid) ILIKE '%Buradayım%'
          AND pg_get_functiondef(p.oid) ILIKE '%Check-ins%')
    -- The notify path must know every module that can collect signups. CREATE OR REPLACE
    -- adds no named object, so only a body token can tell the new lists from the old.
    -- If this goes red, a module's waitlist can be filled but never notified.
    UNION ALL SELECT '0909_notify_waitlist_add_modules','notify path covers explore/studentHub/towing',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='notify_module_waitlist'
          AND pg_get_functiondef(p.oid) ILIKE '%studentHub%'
          AND pg_get_functiondef(p.oid) ILIKE '%towing%')
      AND EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='module_notif_text'
          AND pg_get_functiondef(p.oid) ILIKE '%Çekici%')
    -- towing_companies.is_active DEFAULTs to FALSE — a deliberate inversion (see the
    -- migration header). No new named object, so nothing but the default value itself
    -- can detect a revert. If this goes red, rows will start publishing themselves on
    -- omission and become publicly searchable before the module launches.
    UNION ALL SELECT '0907_towing_is_active_default_false','towing_companies.is_active DEFAULT false',
      EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='towing_companies'
          AND column_name='is_active' AND column_default = 'false')
    -- search_content gained a towing_companies arm. CREATE OR REPLACE adds no new named
    -- object, so only a body token can tell the new definition from the old one.
    UNION ALL SELECT '0906_search_content_add_towing','search_content covers towing_companies',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='search_content'
          AND pg_get_functiondef(p.oid) ILIKE '%towing_companies%')
    UNION ALL SELECT '0904_accommodation_partner_feed','properties_touch_updated_at is conditional',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='properties_touch_updated_at'
          AND pg_get_functiondef(p.oid) ILIKE '%last_seen_at%'
          AND pg_get_functiondef(p.oid) ILIKE '%view_count%')
    -- ── 0910 contact_events. FIVE tokens, because almost nothing that makes this
    -- table safe is a named object: a view, a view OPTION, two absences and a
    -- column-level grant. Sections A-I are blind to every one of them.
    --
    -- The reporting view. No section of this register covers views at all, so without
    -- this token a DB that never got the migration reads as fully OK while the only
    -- deduped, spam-resistant number in the system does not exist.
    UNION ALL SELECT '0910_contact_events','contact_events_monthly view exists',
      to_regclass('public.contact_events_monthly') IS NOT NULL
    -- security_invoker=true is the ONLY thing stopping the view from leaking the whole
    -- contact log to every signed-in customer: a view runs as its OWNER unless the
    -- option is set, this one is owned by postgres, and postgres bypasses RLS. It is a
    -- reloption, not an object — a CREATE OR REPLACE VIEW that drops it is invisible to
    -- every other check here and produces no error at any point.
    UNION ALL SELECT '0910_contact_events','contact_events_monthly is security_invoker',
      COALESCE((SELECT reloptions FROM pg_class WHERE oid = to_regclass('public.contact_events_monthly'))
               @> ARRAY['security_invoker=true'], false)
    -- THE ANONYMITY CONTRACT, as an absence. No user_id / device id / session id / IP /
    -- dedup key, ever — see the migration header on why a recurring key, not `region`,
    -- is what would turn this counter into a log of individuals. An absence cannot be
    -- expressed by any existence section, and adding such a column raises no error.
    UNION ALL SELECT '0910_contact_events','contact_events carries NO identifier column',
      to_regclass('public.contact_events') IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='contact_events'
          AND column_name IN ('user_id','device_id','session_id','install_id','ip','ip_address','dedup_key'))
    -- created_at is unforgeable ONLY because it is not in the column-level INSERT grant
    -- — there is no trigger behind it. A stray `GRANT ALL ON contact_events TO anon`
    -- (or a re-run of Supabase's default privileges) silently restores the ability to
    -- backdate a tap into last month's invoice period. Also asserts anon has no read.
    -- ⚠ The privilege calls take the table's OID from a subquery on to_regclass, NOT a
    -- literal table name. has_column_privilege('anon','public.contact_events',...) RAISES
    -- when the table is absent, and PostgreSQL does not promise AND evaluates left to
    -- right — so a name-literal guard would turn this whole drift report into a hard
    -- error on every DB that has not applied 0910 yet. No match here yields NULL, which
    -- COALESCE turns into a normal STALE/MISSING row. Same class of trap as the
    -- to_regclass-not-::regclass note in the 0902 tokens above.
    UNION ALL SELECT '0910_contact_events','contact_events grants: created_at unwritable, anon unreadable',
      COALESCE((SELECT has_column_privilege('anon', c.oid, 'module', 'INSERT')
                   AND NOT has_column_privilege('anon', c.oid, 'created_at', 'INSERT')
                   AND NOT has_column_privilege('authenticated', c.oid, 'created_at', 'INSERT')
                   AND NOT has_table_privilege('anon', c.oid, 'SELECT')
                FROM pg_class c WHERE c.oid = to_regclass('public.contact_events')), false)
    -- No FK on entity_id, deliberately: the key is polymorphic (towing_companies.id
    -- today, facilities.id / home_services.id later). An FK added later points at one
    -- table and starts silently rejecting every other module's taps.
    UNION ALL SELECT '0910_contact_events','contact_events.entity_id has NO foreign key',
      to_regclass('public.contact_events') IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM pg_constraint
        WHERE conrelid = to_regclass('public.contact_events') AND contype='f')
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
    'provider_documents','provider_credentials','quiz_submissions','pharmacist_scores',
    -- directory / UGC tables (Slice 5 — user-writable rows, so RLS must be ON here too)
    'beaches','landmarks','places','place_claims','events','home_services','transport_providers',
    'estate_agencies','estate_agents','properties','property_images',
    'duty_list','duty_schedule','blocked_terms','bus_routes',
    -- admin-seeded directory: no user data, but public-read + admin-write only
    -- works solely because RLS is ON. OFF here = world-writable firm listings.
    'towing_companies',
    -- contact_events is world-INSERTABLE by design (the inverse of towing_companies).
    -- RLS is the ONLY thing making it not also world-READABLE, and `authenticated`
    -- holds a table-level SELECT grant so the future admin screen needs no migration.
    -- OFF here = every customer can read the whole contact log.
    'contact_events'
  )
)
SELECT * FROM report
ORDER BY (status IN ('OK','ON')) ASC, section, migration, object;   -- problems float to top


-- ═══════════════════════════════════════════════════════════════════════════
-- ═══ QUERY 2 / 4 — CRON JOBS — run alone ═══
-- ═══════════════════════════════════════════════════════════════════════════
-- Errors if pg_cron isn't installed (itself the finding). Expect 4 rows present.
SELECT e.m migration, e.o job,
       CASE WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname=e.o) THEN 'OK' ELSE 'MISSING' END status
FROM (VALUES
  ('0705_job_postings_auto_expire','expire-job-postings'),
  ('0726_grooming_booking_lifecycle','grooming-pending-processor'),
  ('0803_garage_booking_lifecycle','garage-pending-processor'),
  ('0809_featured_expiry_reminder','featured-expiry-reminder')
) e(m,o)
ORDER BY status ASC, migration;


-- ═══════════════════════════════════════════════════════════════════════════
-- ═══ QUERY 3 / 4 — RLS POLICY COUNT per table — run alone ═══
-- ═══════════════════════════════════════════════════════════════════════════
-- Sanity vs capture_5's 172 policies. A table that should be locked down but
-- shows 0 = a gap.
SELECT tablename, count(*) AS policies
FROM pg_policies WHERE schemaname='public'
GROUP BY tablename ORDER BY tablename;


-- ═══════════════════════════════════════════════════════════════════════════
-- ═══ QUERY 4 / 4 — STORAGE.OBJECTS POLICIES — run alone (to end of file) ═══
-- ═══════════════════════════════════════════════════════════════════════════
-- Bucket ACLs live OUTSIDE migrations/ (dashboard / Slices 1-2), so nothing else
-- catches drift on them. Listing, not pass/fail — eyeball each policy's
-- cmd / roles / qual / with_check. Reference after Slices 1-2:
--                • provider-documents / provider-credentials: *_owner_{insert,select,
--                  update,delete} (writes carry NOT is_anonymous_session()) + the
--                  pre-existing *_admin_read SELECT. No public/anon rows.
--                • estate-agent-documents INSERT + event-images INSERT pin the
--                  uploader UID by folder segment ([1] and [2] respectively).
--                • public image buckets (avatars/facility-images/property-images/
--                  event-images) keep their broad `USING (bucket_id=…)` SELECT —
--                  known follow-up (anon object enumeration), not changed here.
--                  ⚠ AND NOTE (measured 2026-08-23 against towing-logos): for a bucket
--                  with public = true, Storage serves reads WITHOUT evaluating RLS at
--                  all — a request with no apikey and no Authorization header still
--                  returns 200 and the bytes. So those broad SELECT policies are not
--                  what grants anon read, and TIGHTENING THEM WOULD NOT CLOSE THE
--                  ENUMERATION FOLLOW-UP. Only flipping a bucket to private makes its
--                  SELECT policy load-bearing. Do not mistake a green public-URL fetch
--                  for evidence that a bucket's read policy works.
--                • place-photos (0823): place_photos_public (SELECT, bucket-scoped) +
--                  place_photos_upload (INSERT authenticated, bucket-scoped, anon-guarded) +
--                  place_photos_delete (DELETE, foldername[1]=uid OR is_admin(), anon-guarded).
--                  Expect exactly these 3 (no UPDATE — uploads are upsert:false).
--                • towing-logos (0905): towing_logos_public_read (SELECT, bucket-scoped)
--                  + towing_logos_admin_{insert,update,delete} (authenticated, is_admin(),
--                  anon-guarded). Expect exactly these 4. This bucket is created BY the
--                  migration, not by hand — the provider-documents/estate-agent-documents
--                  lesson was that a dashboard-made bucket with un-applied policies looks
--                  identical to a working one until somebody tries to upload. ─────
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname='storage' AND tablename='objects'
ORDER BY policyname;

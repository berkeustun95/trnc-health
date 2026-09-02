-- ═══════════════════════════════════════════════════════════════════════════
-- ADA schema drift audit — "committed but never applied" gap detector.
-- Manual-apply workflow has no CI, so this checks the LIVE DB against every
-- object the repo migrations claim to create. Run in Supabase SQL editor
-- (Role → postgres). Scan for status <> 'OK'. The `migration` column tells you
-- which file to apply.
--
-- ▶ THE ANSWER IS THE FIRST ROW OF QUERY 1. It reads either "ALL n CHECKS PASS" or
--   "k PROBLEM(S) of n", derived from the report itself. Anything else — a count of
--   rows that changed state, a scan by eye — is not the assertion.
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
    ('capture_1','profiles'),('capture_1','facilities'),
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
    ('0923_server_side_notifications','push_log'),
    ('1001_profile_completion','institutions'),
    ('1001_profile_completion','reserved_names'),
    ('0926_moderation_rejection_log','moderation_rejections'),
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
    ('0926_moderation_rejection_log','blocked_terms','hit_count'),
    ('0928_ugc_soft_delete','reviews','deleted_at'),
    ('0928_ugc_soft_delete','questions','deleted_at'),
    ('0926_moderation_rejection_log','blocked_terms','last_hit_at'),
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
    ('0731_garages_directory','facilities','service_types'),
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
    ('0908_towing_phone_secondary','towing_companies','phone_secondary'),
    -- ── Profile completion gate (Slice 1). The wizard writes every one of these on a
    --    single screen, so ONE missing column is a 42703 that kills the whole gate for
    --    every user — and the gate is a HARD BLOCK, so the app becomes unusable rather
    --    than degraded. display_name_normalized is the load-bearing one: it is the key
    --    the unique index is built on, so if it reads MISSING while display_name exists,
    --    duplicate names are being accepted right now.
    ('1001_profile_completion','profiles','first_name'),
    ('1001_profile_completion','profiles','last_name'),
    ('1001_profile_completion','profiles','display_name'),
    ('1001_profile_completion','profiles','display_name_normalized'),
    ('1001_profile_completion','profiles','date_of_birth'),
    ('1001_profile_completion','profiles','region'),
    ('1001_profile_completion','profiles','resident_status'),
    ('1001_profile_completion','profiles','resident_status_updated_at'),
    ('1001_profile_completion','profiles','student_level'),
    ('1001_profile_completion','profiles','institution_id'),
    ('1001_profile_completion','profiles','display_preference'),
    ('1001_profile_completion','profiles','profile_completed_at'),
    ('1001_profile_completion','profiles','profile_schema_version'),
    ('1001_profile_completion','profiles','age_ineligible'),
    ('1001_profile_completion','profiles','nationality_code')

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
    ('capture_3_functions','check_question_limit'),
    ('capture_3_functions','check_report_rate_limit'),
    ('capture_3_functions','check_ugc_on_insert'),
    ('capture_3_functions','contains_blocked_term'),
    ('0925_moderation_normalization','normalize_for_moderation'),
    ('0926_moderation_rejection_log','blocked_term_hit'),
    ('0928_ugc_soft_delete','guard_owner_soft_delete'),
    ('0926_moderation_rejection_log','record_moderation_rejection'),
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
    ('capture_3_functions','tp_guard_write'),
    ('capture_3_functions','update_pharmacist_score'),
    ('0723_insurance_companies','ins_guard_write'),
    ('0719_create_facility_claim_rpc','create_facility_claim'),
    ('0725_grooming_directory','create_grooming_facility'),
    ('0725_grooming_directory','facilities_guard_insert'),
    ('0726_grooming_booking_lifecycle','grooming_notif_text'),
    ('0731_garages_directory','create_garage_facility'),
    ('0802_update_garage_facility','update_garage_facility'),
    ('0803_grooming_owner_edit','update_grooming_facility'),
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
    ('0912_search_tokenised','search_token_hits'),
    -- Provider/admin notifications. notify_facility_owner is the ONLY path that tells a
    -- provider a booking or question arrived; if it goes MISSING the client's rpc() call
    -- errors into a bare catch{} and providers go silent again, exactly as before 0923.
    ('0923_server_side_notifications','notify_owner_text'),
    ('0923_server_side_notifications','notify_facility_owner'),
    ('0923_server_side_notifications','notify_admins'),
    -- Profile gate. check_profile_name_content is the ONLY content filter profiles has
    -- ever had — before it, display_name and full_name were completely unfiltered, and
    -- display_name renders publicly on reviews. normalize_display_name computes the key
    -- the unique index is built on: if it goes MISSING the trigger raises on every
    -- profile write and the wizard cannot be completed by anyone.
    ('1001_profile_completion','normalize_display_name'),
    ('1001_profile_completion','is_reserved_display_name'),
    ('1001_profile_completion','check_profile_name_content'),
    ('1002_display_name_rpc','display_name_available')
  ) e(m,o)

  UNION ALL
  -- ── D. TRIGGERS (existence by name) ────────────────────────────────────────
  SELECT 'D-trigger', e.m, e.o,
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger tg WHERE NOT tg.tgisinternal AND tg.tgname=e.o)
              THEN 'OK' ELSE 'MISSING' END
  FROM (VALUES
    ('0701_rate_limits','enforce_question_limit'),
    ('capture_4/0712','enforce_report_rate_limit'),
    ('capture_4/0712','guard_profile_ban'),
    ('capture_4/0712','guard_review_moderation'),
    ('capture_4/0712','guard_question_moderation'),
    ('capture_4/0712','guard_answer_moderation'),
    ('0926_moderation_rejection_log','record_moderation_rejection'),
    ('0928_ugc_soft_delete','guard_review_soft_delete'),
    ('0928_ugc_soft_delete','guard_question_soft_delete'),
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
    ('0905_towing_companies','towing_touch_updated_at'),
    ('1001_profile_completion','check_profile_name_content')

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
    -- Registered 2026-09-02. These two shipped with 20260919 and were never listed
    -- here, so DROPPING either was invisible to every section of this report — the
    -- coords_need_provenance token below covers its own two constraints and says
    -- nothing about these. The H-tokens further down assert their CONTENT; these two
    -- rows assert they exist at all.
    ('0919_facilities_geocode_provenance','facilities_geocode_source_check'),
    ('0919_facilities_geocode_provenance','facilities_geocode_tier_check'),
    ('0724_events_category','events_category_check'),
    -- reviews_customer_facility_unique was REMOVED here by 0928: it is no longer a
    -- constraint but a PARTIAL UNIQUE INDEX, and its absence as a constraint is
    -- asserted in H. Listing it here would report MISSING forever.
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
    ('0910_contact_events','contact_events_region_check'),
    -- ── Profile gate. profiles_completion_requires_fields_check is the one that makes
    --    profile_completed_at MEAN something: without it the flag can be set on an empty
    --    row and the gate is decoration a modified client walks straight past.
    ('1001_profile_completion','profiles_region_check'),
    ('1001_profile_completion','profiles_resident_status_check'),
    ('1001_profile_completion','profiles_student_level_check'),
    ('1001_profile_completion','profiles_student_level_coupling_check'),
    ('1001_profile_completion','profiles_institution_coupling_check'),
    ('1001_profile_completion','profiles_display_preference_check'),
    ('1001_profile_completion','profiles_display_name_length_check'),
    ('1001_profile_completion','profiles_dob_range_check'),
    ('1001_profile_completion','profiles_age_ineligible_no_dob_check'),
    ('1001_profile_completion','profiles_nationality_code_check'),
    ('1001_profile_completion','profiles_schema_version_check'),
    ('1001_profile_completion','profiles_completion_requires_fields_check'),
    ('1001_profile_completion','profiles_institution_id_fkey'),
    -- UNIQUE: correctness. institutions.name is what the seed's ON CONFLICT and any
    -- future admin add both key on.
    ('1001_profile_completion','institutions_name_unique'),
    ('1001_profile_completion','institutions_city_check')

  ) e(m,o)

  UNION ALL
  -- ── F. INDEXES (perf + the double-booking UNIQUE correctness guard) ────────
  SELECT 'F-index', e.m, e.o,
         CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=e.o)
              THEN 'OK' ELSE 'MISSING' END
  FROM (VALUES
    ('0702_job_postings','job_postings_owner_idx'),
    ('0702_job_postings','job_postings_board_idx'),
    ('0712_ugc_moderation','content_reports_pending_idx'),
    ('0712_ugc_moderation','content_reports_content_idx'),
    ('0712_ugc_moderation','reviews_customer_id_idx'),
    ('0723_insurance_companies','idx_insurance_companies_owner_id'),
    ('0719_add_missing_indexes','idx_facilities_provider_id'),
    ('0911_facilities_public_health','idx_facilities_parent_facility_id'),
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
    ('0910_contact_events','idx_contact_events_module_entity_time'),
    ('0923_server_side_notifications','idx_push_log_sent_at'),
    ('0923_server_side_notifications','idx_push_log_user_kind'),
    -- UNIQUE: correctness. display_name renders publicly on reviews, so a duplicate is
    -- an impersonation vector. See the H-token below for the half that matters more:
    -- that it is built on the NORMALIZED column and not the raw string.
    ('1001_profile_completion','profiles_display_name_norm_uniq'),
    ('1001_profile_completion','idx_profiles_institution_id')

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
    ('0824_place_moderation','explore_category_counts'),  -- also GRANTed to anon (public tile counts)
    ('0826_place_claims','approve_place_claim'),
    ('0829_place_resubmit','resubmit_place'),
    -- search_content is SECURITY INVOKER, so a signed-out visitor's call is permission-
    -- checked against these three too. Without the grants the RPC exists and every
    -- search returns a permission error, with nothing in the app to explain it.
    ('0912_search_tokenised','search_fold'),
    ('0912_search_tokenised','search_all_tokens'),
    ('0912_search_tokenised','search_token_hits'),
    -- Without these grants the functions exist and every booking/question notification
    -- fails with a permission error the client swallows — indistinguishable from the
    -- silent failure 0923 exists to end.
    ('0923_server_side_notifications','notify_facility_owner'),
    ('0923_server_side_notifications','notify_admins'),
    -- The ONE new RPC. Without the grant it exists and every keystroke in the wizard's
    -- display-name field returns a permission error the user cannot act on — inside a
    -- hard block, on the step people abandon on.
    ('1002_display_name_rpc','display_name_available')
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
    -- ⚠ 'appointments.service_type is GONE' RETIRED 2026-08-31 by 20261004. It would
    -- have stayed GREEN forever — the column is absent because the whole TABLE is — and
    -- a token that can no longer fail is a decoration certifying nothing while looking
    -- like coverage. Removed rather than left to reassure.
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
    -- Signup is customer-only (0827). Supersedes the 0719 allow-list token, which asserted
    -- ILIKE '%not in%organizer%' — that allow-list no longer exists, so it was permanently
    -- red against a function whose behaviour is exactly right.
    --
    -- ⚠ THESE CLAUSES SEE THE COMMENTS TOO. pg_get_functiondef() returns the ENTIRE
    -- definition, prose included, so a NOT ILIKE here forbids a word from the function's
    -- COMMENTS as much as from its code. The first version of 20260827 explained itself by
    -- naming the allow-list it replaced, putting "organizer" and "raw_user_meta_data" in its
    -- prose while both were absent from its code — and both clauses below read false on a
    -- correct function. It was re-applied with prose that avoids both words. If this token
    -- ever goes red, read the BODY before assuming the behaviour regressed: a reworded
    -- comment fails it identically to a reverted allow-list.
    --
    -- Three clauses, because no one of them is sufficient: 'customer' alone was true of the
    -- old version too; the absence of 'organizer' alone would pass on an empty function.
    -- Together they say: still writes customer, no longer knows the old roles, no longer
    -- reads client metadata at all.
    UNION ALL SELECT '0827_signup_customer_only','handle_new_user always inserts customer; role metadata is ignored entirely',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='handle_new_user'
          AND pg_get_functiondef(p.oid) ILIKE '%''customer''%'
          AND pg_get_functiondef(p.oid) NOT ILIKE '%organizer%'
          AND pg_get_functiondef(p.oid) NOT ILIKE '%raw_user_meta_data%')
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
    UNION ALL SELECT '0922_drop_grooming_profile_overshare','profiles grooming over-share policy removed (twin of 0821; full-row read for any facility owner)',
      NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles'
                AND policyname='owner read booking customer profile')
    -- DERIVED, not a name list. The 0821 drop shipped with a verification comment naming
    -- three expected SELECT policies when there were four, so the fourth (the grooming
    -- over-share) survived unnoticed for six weeks and was still live when found.
    -- Verified green 2026-08-27, immediately after 20260922 was applied: the live set is
    -- exactly owner read / admin read all / admin read profiles. Before the drop this
    -- token read 4 and went red, so it has been WATCHED failing and passing on real data —
    -- it is a check, not a decoration.
    -- A name check only ever catches the
    -- policy you already thought of; this counts what is actually there, so ANY new or
    -- returning SELECT policy on profiles fails the check and has to be looked at.
    -- Expected set: owner read, admin read all, admin read profiles.
    -- If you add a legitimate fourth, bump this number IN THE SAME COMMIT and say why.
    UNION ALL SELECT '0922_drop_grooming_profile_overshare','profiles has exactly 3 SELECT policies (derived count, not a name list)',
      (SELECT count(*) FROM pg_policies
        WHERE schemaname='public' AND tablename='profiles' AND cmd='SELECT') = 3
    -- ── 0923 server-side notifications. FOUR tokens. The functions' EXISTENCE is section
    -- C's job; none of what makes them SAFE is visible there.
    --
    -- (1) THE INJECTION CLOSURE, as a signature assertion. This is the point of 0923:
    -- insert_notification takes client-written p_title/p_body, so a customer with one
    -- appointment could write "ADA: your account is suspended, tap here" into a provider's
    -- inbox. notify_facility_owner takes an ENUM the server interprets. If anyone ever
    -- "helpfully" adds a p_title/p_body overload for flexibility, the channel reopens and
    -- every other check here still reads OK.
    UNION ALL SELECT '0923_server_side_notifications','notify_facility_owner takes p_kind, NOT client title/body',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='notify_facility_owner'
          AND pg_get_function_arguments(p.oid) ILIKE '%p_kind%')
      AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='notify_facility_owner'
          AND pg_get_function_arguments(p.oid) ILIKE '%p_title%')
    -- (2) The nine locales are real. A VALUES table of nine English rows would pass every
    -- existence check and silently un-localise every provider notification — which is
    -- exactly bug 3 (the client's dead read always fell back to English) coming back by
    -- another route. Two languages sampled, plus the unknown-language fallback.
    -- ⚠ Asserted by reading the function BODY, not by CALLING it. A direct
    -- `public.notify_owner_text(...)` here is resolved at parse time, so on any database
    -- that has not applied 0923 the whole of QUERY 1 dies with 42883 and every other
    -- migration's status becomes unreadable — while the likeliest run order is exactly
    -- "run verify_schema, see what is missing, then apply it." Same trap the 0910 tokens
    -- above document for has_column_privilege. The live call-and-compare version of this
    -- test lives in the migration's own verification block, which only ever runs after
    -- the apply, where it is safe.
    UNION ALL SELECT '0923_server_side_notifications','notify_owner_text is really localised (not English x9)',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='notify_owner_text'
          AND pg_get_functiondef(p.oid) ILIKE '%Yeni Randevu Talebi%'
          AND pg_get_functiondef(p.oid) ILIKE '%Neue Frage%'
          AND pg_get_functiondef(p.oid) ILIKE '%Νέα Ερώτηση%')
    -- (3) push_log is admin-read-only and has NO write policy — writes come only from the
    -- DEFINER functions, which bypass RLS. A stray INSERT policy would let any client
    -- forge delivery evidence, which is worse than having no log at all.
    UNION ALL SELECT '0923_server_side_notifications','push_log: RLS on, exactly 1 policy, admin SELECT only',
      COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.push_log')), false)
      AND (SELECT count(*) FROM pg_policies
            WHERE schemaname='public' AND tablename='push_log') = 1
      AND EXISTS(SELECT 1 FROM pg_policies
            WHERE schemaname='public' AND tablename='push_log'
              AND cmd='SELECT' AND qual ILIKE '%is_admin%')
    -- (4) The senders actually RECORD. push_log is what check-notify-health.mjs and any
    -- future delivery join read; a body that pushes without logging leaves the same blind
    -- spot 0923 exists to close, while sections A/C/F all still read OK.
    UNION ALL SELECT '0923_server_side_notifications','notify_facility_owner + notify_admins write push_log',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='notify_facility_owner'
          AND pg_get_functiondef(p.oid) ILIKE '%INSERT INTO push_log%')
      AND EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='notify_admins'
          AND pg_get_functiondef(p.oid) ILIKE '%INSERT INTO push_log%')
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
    -- Nature and heritage places cannot be claimed. CREATE OR REPLACE adds no named
    -- object, so only a body token distinguishes the new definition from 20260826's.
    -- If this goes red the DB path is open again while the button stays hidden — the
    -- silent half of the asymmetry, which is the one that does not get reported.
    UNION ALL SELECT '0921_place_claims_category_guard','place claims refuse nature/heritage',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='place_claims_guard_insert'
          AND pg_get_functiondef(p.oid) ILIKE '%nature and heritage places cannot be claimed%')
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
    -- The geocode_source VOCABULARY. Section E now proves the constraint exists; only a
    -- body token can see whether it still admits the five values, because a widening is a
    -- same-name DROP/ADD. If a sixth value were slipped in — 'nominatim', say — the 387-row
    -- seed this whole provenance scheme exists to keep out becomes writable again.
    -- 'partner' and 'google_places' are the sentinels: the first and last added, so a
    -- truncated ARRAY loses one of them.
    -- Live rendering as postgres, 2026-09-02:
    --   CHECK (((geocode_source IS NULL) OR (geocode_source = ANY (ARRAY['osm'::text,
    --   'google_places'::text, 'manual'::text, 'provider'::text, 'partner'::text]))))
    UNION ALL SELECT '0919_facilities_geocode_provenance','geocode_source_check still admits all 5 values',
      EXISTS(SELECT 1 FROM pg_constraint WHERE conname='facilities_geocode_source_check'
        AND pg_get_constraintdef(oid) ILIKE '%partner%'
        AND pg_get_constraintdef(oid) ILIKE '%google_places%'
        AND pg_get_constraintdef(oid) ILIKE '%provider%')
    -- The geocode_tier RANGE.
    -- ⚠ MATCHED ON '>= 1' AND '<= 3', NEVER ON 'BETWEEN'. The migration writes
    --   `geocode_tier BETWEEN 1 AND 3`, but Postgres NORMALISES that away — the live
    --   rendering read as postgres on 2026-09-02 is:
    --     CHECK (((geocode_tier IS NULL) OR ((geocode_tier >= 1) AND (geocode_tier <= 3))))
    --   A token phrased from the migration FILE would look correct, ship, and sit
    --   permanently red against a perfectly healthy database — the same
    --   frame-of-reference failure as the tgargs token this file already documents.
    --   Written from the rendering, not the file.
    UNION ALL SELECT '0919_facilities_geocode_provenance','geocode_tier_check is still 1..3',
      EXISTS(SELECT 1 FROM pg_constraint WHERE conname='facilities_geocode_tier_check'
        AND pg_get_constraintdef(oid) ILIKE '%>= 1%'
        AND pg_get_constraintdef(oid) ILIKE '%<= 3%')
    -- The geocode_corroboration VOCABULARY. This column has NO CHECK — the vocabulary has
    -- only ever been prose in a COMMENT — so there is no constraint to read and
    -- col_description is the only surface that can see it. A COMMENT creates no named
    -- object, so every other section of this file is blind to it.
    -- Deliberately asserts values present in BOTH 20260919's text and 20261005's, so it is
    -- green whether or not 1005 has been applied; the 1005 token below owns 'name_match'.
    -- visual_satellite is the sentinel that matters: it carries the MANDATORY-for-tier-3
    -- rule, which is the half a careless rewrite drops.
    UNION ALL SELECT '0919_facilities_geocode_provenance','geocode_corroboration vocabulary is documented',
      (SELECT col_description(c.oid, a.attnum) ILIKE '%visual_satellite%'
          AND col_description(c.oid, a.attnum) ILIKE '%address_town%'
          AND col_description(c.oid, a.attnum) ILIKE '%phone_exchange%'
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = 'public' AND c.relname = 'facilities'
          AND a.attname = 'geocode_corroboration' AND NOT a.attisdropped)
    -- 20261005 adds name_match to that vocabulary. EXPECTED RED until the migration is
    -- applied — that is the point of registering it, not a defect.
    UNION ALL SELECT '1005_geocode_corroboration_name_match','geocode_corroboration documents name_match',
      (SELECT col_description(c.oid, a.attnum) ILIKE '%name_match%'
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = 'public' AND c.relname = 'facilities'
          AND a.attname = 'geocode_corroboration' AND NOT a.attisdropped)
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
    -- Unclaimed pharmacies leave the search index (0924). CREATE OR REPLACE adds no named
    -- object, so section C sees the NAME and cannot see the CHANGE — and the failure is the
    -- silent kind: search_content keeps existing, keeps running, keeps returning rows, and
    -- quietly starts returning all 387 unclaimed pharmacies again while the client still
    -- hides them from every list. That asymmetry is the whole thing this slice removed.
    --
    -- POSITIVE ILIKE, deliberately. `provider_id` appeared ZERO times in the pre-0924 body,
    -- so its presence is a clean signal that the new definition is deployed. A NOT ILIKE
    -- companion is NOT added here on purpose: pg_get_functiondef() returns the comments too
    -- (see the 0827 token), and the predicate's own explanatory comment names the words a
    -- negative clause would forbid. Assert what must BE there, not what must be absent.
    UNION ALL SELECT '0924_search_content_hide_unclaimed_pharmacies','search_content excludes unclaimed pharmacies',
      (SELECT pg_get_functiondef('public.search_content(text,double precision,double precision)'::regprocedure)
         ILIKE '%provider_id%')
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
    -- ── 0925 moderation normalization. Behaviour-only CREATE OR REPLACE on
    -- contains_blocked_term(), so section C sees the NAME and cannot see the CHANGE.
    -- Without these tokens a database still on the old body reads 100% OK while the
    -- word filter is walked around by typing in Turkish capitals — measured live on
    -- 2026-08-29: contains_blocked_term('SİKİK') returned false.
    --
    -- (1) The matcher calls the normalizer at all. If this is false, the whole slice
    -- never ran, and — worse than not running — utils/moderationNormalize.js on the
    -- client DID ship, so the inline preview now blocks text the server accepts and
    -- accepts text the server blocks. Divergence, in both directions at once.
    -- Either function may hold the call: 0925 put it in contains_blocked_term, and 0926
    -- moved the lookup into blocked_term_hit and left a thin wrapper behind. Naming only
    -- the first would report STALE forever the moment 0926 applied — a drift checker
    -- carrying a known-false positive teaches the reader to skim, and the next real
    -- MISSING gets skimmed with it.
    UNION ALL SELECT '0925_moderation_normalization','the matcher normalizes before matching',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname IN ('contains_blocked_term','blocked_term_hit')
          AND pg_get_functiondef(p.oid) ILIKE '%normalize_for_moderation%')
    -- (2) The normalizer's body is the FULL one. A partial paste, or an older draft,
    -- can define the function and cover only some of the class — which is invisible to
    -- (1) and to section C alike. Assert the three characters that each stand for one
    -- of the three separate defects, and the NFC that keeps accents intact.
    -- Asserted through pg_get_functiondef, not by reading the migration file: a
    -- migration is a statement of intent, and between it and the database sit a manual
    -- paste and a later CREATE OR REPLACE.
    UNION ALL SELECT '0925_moderation_normalization','normalize_for_moderation covers İ + zero-width + tatweel',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='normalize_for_moderation'
          AND pg_get_functiondef(p.oid) LIKE '%0130%'        -- Turkish capital İ
          AND pg_get_functiondef(p.oid) LIKE '%200B%'        -- zero-width range
          AND pg_get_functiondef(p.oid) LIKE '%0640%'        -- Arabic tatweel
          AND pg_get_functiondef(p.oid) ILIKE '%NFC%')       -- NOT NFD/NFKD: no accent folding
    -- (3) Still not an RPC. Every public function is exposed by PostgREST unless EXECUTE
    -- is revoked, and the standing constraint on this work is that no new RPC appears.
    -- A later GRANT, or a restore that reinstated the default PUBLIC execute, is
    -- otherwise undetectable — the function keeps working either way.
    -- aclexplode, NOT has_function_privilege(): the latter RAISES on a function that does
    -- not exist, and absence is precisely the state this token has to be able to REPORT.
    -- A never-applied migration would otherwise turn the whole drift check into a hard
    -- error — the same trap the to_regclass note above records.
    -- proacl IS NOT NULL is load-bearing: a NULL ACL means DEFAULT privileges, and the
    -- default for a function is EXECUTE to PUBLIC. Here, no ACL is the FAILING state.
    UNION ALL SELECT '0925_moderation_normalization','normalize_for_moderation is NOT callable by anon/authenticated',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='normalize_for_moderation'
          AND p.proacl IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM aclexplode(p.proacl) a
                         LEFT JOIN pg_roles r ON r.oid = a.grantee
                         WHERE a.privilege_type='EXECUTE'
                           AND (a.grantee = 0 OR r.rolname IN ('anon','authenticated'))))
    -- (4) The one assertion here about CONTENT rather than shape. Every term must still
    -- match itself; normalization that quietly broke `piç` or `şerefsiz` would leave
    -- tokens 1-3 green and the filter half dead. DERIVED — it counts the rows that fail,
    -- so it cannot go green by forgetting one, and it keeps working as Phase C grows the
    -- table from 54 rows to ~510.
    UNION ALL SELECT '0925_moderation_normalization','every blocked_terms row still matches itself',
      NOT EXISTS(SELECT 1 FROM public.blocked_terms WHERE NOT public.contains_blocked_term(term))
    -- ── 0926 rejection log. contains_blocked_term was REDEFINED again (into a wrapper),
    -- so 0925's token above stays true while saying nothing about this slice.
    --
    -- (1) The wrapper is installed. If false, the six triggers still work but nothing is
    -- ever logged — and the AdminScreen Moderation tab reads an empty table and reports
    -- "no false positives", which is the most confident wrong answer available.
    UNION ALL SELECT '0926_moderation_rejection_log','contains_blocked_term delegates to blocked_term_hit',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='contains_blocked_term'
          AND pg_get_functiondef(p.oid) ILIKE '%blocked_term_hit%')
    -- (2) The breadcrumb. This is the ONLY record of a rejection from a client that does
    -- not self-report, and it is one line in a function body — trivially lost to a later
    -- CREATE OR REPLACE by someone who did not know it was load-bearing.
    UNION ALL SELECT '0926_moderation_rejection_log','blocked_term_hit still writes the RAISE LOG breadcrumb',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='blocked_term_hit'
          AND pg_get_functiondef(p.oid) ILIKE '%RAISE LOG%')
    -- (3) All four trigger functions still route through contains_blocked_term. The claim
    -- "one change reaches all six surfaces" is only true while this holds; if someone
    -- inlines the matcher into one of them, that surface silently stops logging while
    -- every other token here stays green. DERIVED count of the four, not a spot check.
    UNION ALL SELECT '0926_moderation_rejection_log','all 4 content-filter trigger functions still route through the matcher',
      (SELECT count(*) = 4 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public'
          AND p.proname IN ('check_ugc_on_insert','check_facility_content',
                            'check_change_request_content','check_place_content')
          AND pg_get_functiondef(p.oid) ILIKE '%contains_blocked_term%')
    -- (4) EXACTLY two policies. Counted, not named. A third would most likely be an author
    -- SELECT added in sympathy for a confused user — which hands back the oracle this
    -- design spends its whole budget denying. If a third is ever legitimate, bump the
    -- number here in the same commit and say why; that edit is the review moment.
    UNION ALL SELECT '0926_moderation_rejection_log','moderation_rejections has EXACTLY 2 policies (no author SELECT)',
      (SELECT count(*) = 2 FROM pg_policies
        WHERE schemaname='public' AND tablename='moderation_rejections')
    -- ── 0927 Tier 1. The applied-side half of check-terms-commitment.mjs, which can only
    -- see COMMITTED migrations. Both terms copies promise removal within 24 hours; before
    -- 0927 every admin UPDATE on these three tables was denied by RLS and supabase-js
    -- reported success anyway. Reproduced in production 2026-08-30: report actioned,
    -- hidden_at NULL, review still served to a signed-out visitor.
    --
    -- ⚠ THE COUNT TOKEN THAT USED TO LIVE HERE IS RETIRED (2026-08-30), not bumped.
    -- It asserted 6 policies per table. 0928 then added the owner soft-delete policy and
    -- moved reviews and questions to 7, so it went STALE/MISSING against a database that
    -- is exactly right — and 0928's own token, "policy counts are 7 / 7 / 6", was GREEN
    -- two rows below it, asserting the same fact against the current number.
    --
    -- Bumping 6 to 7 here was the wrong fix: TWO tokens counting the same set is how the
    -- stale one arose, and the second would drift again at the next policy change. One
    -- count, one owner. 0928's token owns it; this migration keeps the half that is
    -- genuinely its own — that the UPDATE policy is PERMISSIVE — which no count can see.
    --
    -- The rule this cost us: when a migration CHANGES a count another migration's token
    -- asserts, retire or move that token IN THE SAME COMMIT. A drift report carrying a
    -- known-stale row teaches the reader to skim, and the next real MISSING gets skimmed
    -- with it — which this file already warns about twice, for the same reason.
    --
    -- The sixth policy is PERMISSIVE. A restrictive UPDATE policy grants nothing, so the
    -- count above would be satisfied by a policy that leaves admin Remove exactly as
    -- broken as it was — the count and the kind have to be asserted separately.
    UNION ALL SELECT '0927_admin_ugc_update_policies','all 3 have a PERMISSIVE UPDATE policy (a RESTRICTIVE one grants nothing)',
      (SELECT count(DISTINCT tablename) = 3 FROM pg_policies
        WHERE schemaname='public' AND tablename IN ('reviews','questions','answers')
          AND cmd='UPDATE' AND permissive='PERMISSIVE')
    -- ── 0928/0929/0930 soft delete + answer gates.
    -- (1) Counts move 6/6/6 -> 7/7/6. answers only has its SELECT policy REPLACED, so it
    -- must STAY at 6: a 7 there means the DROP missed and two SELECT policies now OR
    -- together — the more permissive wins and hidden answers become readable again.
    UNION ALL SELECT '0928_ugc_soft_delete','policy counts are 7 / 7 / 6 on reviews / questions / answers',
      (SELECT count(*) = 7 FROM pg_policies WHERE schemaname='public' AND tablename='reviews')
      AND (SELECT count(*) = 7 FROM pg_policies WHERE schemaname='public' AND tablename='questions')
      AND (SELECT count(*) = 6 FROM pg_policies WHERE schemaname='public' AND tablename='answers')
    -- (2) The guard must still IGNORE the moderation columns. "Tighten" it to reject every
    -- non-deleted_at change and auto_hide_reported_content's UPDATE starts raising — and
    -- because that trigger is AFTER INSERT on content_reports, the failure lands on the
    -- REPORT. Every third report would be lost, and the symptom points nowhere near here.
    UNION ALL SELECT '0928_ugc_soft_delete','guard_owner_soft_delete still ignores hidden_at (auto-hide would break)',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='guard_owner_soft_delete'
          AND pg_get_functiondef(p.oid) ILIKE '%hidden_at%'
          AND pg_get_functiondef(p.oid) ILIKE '%hidden_reason%')
    -- (3) Both read policies gained the gate. These were drop-and-recreate of names that
    -- already existed, so policy EXISTENCE says nothing about the change.
    UNION ALL SELECT '0928_ugc_soft_delete','public read reviews + read questions both filter deleted_at',
      (SELECT count(*) = 2 FROM pg_policies
        WHERE schemaname='public' AND cmd='SELECT' AND qual ILIKE '%deleted_at%'
          AND ((tablename='reviews' AND policyname='public read reviews')
            OR (tablename='questions' AND policyname='read questions')))
    -- (4) ABSENCE of the old constraint AND the index being PARTIAL. A plain unique index
    -- passes existence while permanently barring anyone who deletes a review from ever
    -- reviewing that facility again.
    UNION ALL SELECT '0928_ugc_soft_delete','reviews_customer_facility_unique is GONE, replaced by a PARTIAL index',
      NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='reviews_customer_facility_unique')
      AND EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public'
                  AND indexname='reviews_customer_facility_live_uniq'
                  AND indexdef ILIKE '%deleted_at IS NULL%')
    -- (5) ⚠ THE 0929 TOKEN THAT LIVED HERE IS RETIRED (2026-08-31), NOT BUMPED.
    -- It asserted that reviews_appointment_live_uniq EXISTS. 20261003 DROPS that index,
    -- because its column (reviews.appointment_id) is removed by 20261004 — so the token
    -- would have gone STALE/MISSING against a database that is exactly right, which is
    -- the failure this file already warns about twice. There is nothing to bump it TO:
    -- the object it names is gone on purpose. One fact, one owner; the fact is now
    -- "the appointment coupling is gone", owned by the 1003 tokens below.
    --
    -- ── 20261003 reviews decoupled from appointments. THREE tokens, and the first is
    -- the most important assertion in this file: it is an ABSENCE that protects DATA.
    --
    -- (a) THE CASCADE IS GONE. reviews.appointment_id's FK was ON DELETE CASCADE, so
    -- while it existed ANY delete of an appointment row silently deleted the review
    -- attached to it. If this reads STALE/MISSING while the appointments table still
    -- exists, 20261003 was never applied and 20261004 MUST NOT BE RUN.
    UNION ALL SELECT '1003_reviews_decouple','reviews_appointment_id_fkey is GONE (the CASCADE that would eat reviews)',
      NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='reviews_appointment_id_fkey')
    -- (b) The INSERT policy gates on facility liveness. This is the ONE thing the
    -- decoupling ADDS rather than removes, and a policy body is invisible to Q3's
    -- count: without it, reviews accumulate on draft rows (the Girne duplicate
    -- 91338177, parked deliberately), suspended rows, and moderation-hidden rows —
    -- unreachable and unmoderatable, but still counted the moment one is published.
    UNION ALL SELECT '1003_reviews_decouple','review INSERT requires an ACTIVE, unhidden facility',
      EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='reviews'
              AND policyname='customers insert own reviews'
              AND with_check ILIKE '%active%' AND with_check ILIKE '%hidden_at%')
    -- (c) The blocked-term filter still scans the right column. check_ugc_on_insert takes
    -- its column from TG_ARGV[0]; a trigger recreated without 'comment' would scan
    -- NOTHING and pass every blocked term while existing under the right name, which
    -- section D cannot see. tgenabled='O' because a DISABLED trigger also exists.
    -- ⚠ pg_get_triggerdef, NOT tgargs. tgargs is BYTEA with null-terminated arguments,
    -- so tgargs::text renders \x636f6d6d656e7400 and can never contain the substring
    -- 'comment'. The first version of this token used position() on it and would have
    -- read STALE/MISSING forever against a perfectly correct trigger — a check phrased
    -- in a different encoding from the value it reads. LIKE, not ILIKE: 'Comment' is a
    -- different TG_ARGV value. Anchored on the whole call so a column named `comment`
    -- in a future WHEN clause cannot satisfy it.
    UNION ALL SELECT '1003_reviews_decouple','check_review_content still scans ''comment'' and is ENABLED',
      EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid='public.reviews'::regclass
              AND t.tgname='check_review_content' AND NOT t.tgisinternal
              AND t.tgenabled='O'
              AND pg_get_triggerdef(t.oid) LIKE '%check_ugc_on_insert(''comment'')%')
    -- ── 20261004 appointments removed. SIX tokens. Four until 2026-09-02, when the
    -- single three-function body token was split into one per function so that a red
    -- NAMES the function it is about. Two are pure ABSENCES, which no existence section
    -- can express; three pair an absence with a positive; the last guards a function
    -- that survived.
    UNION ALL SELECT '1004_appointments_removal','public.appointments is GONE',
      to_regclass('public.appointments') IS NULL
    -- DERIVED count, not six name checks: a count cannot go green by forgetting one.
    -- get_customer_contacts is here for a reason — its predicate required an appointment,
    -- so leaving it would mean a function returning zero rows to every caller forever,
    -- which this repo has twice mistaken for a working one.
    UNION ALL SELECT '1004_appointments_removal','all 6 booking-only functions dropped (derived count)',
      (SELECT count(*) = 0 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname IN
          ('get_customer_contacts','process_garage_pending','process_grooming_pending',
           'record_no_show','check_pending_appointment_limit','appointments_guard_requested_time'))
    -- The three EDITED functions no longer touch appointments. They were edited, not
    -- dropped — delete_own_account is the account-deletion path and a store commitment —
    -- so section C still sees all three NAMES and cannot see whether the edit happened.
    -- A body still saying FROM appointments raises at runtime, mid account-deletion.
    --
    -- ⚠ REWRITTEN 2026-09-02, AND THE FUNCTIONS WERE NEVER WRONG. The first version was
    -- ONE token asserting NOT ILIKE '%appointments%' over a count(*) = 3, and it read
    -- STALE/MISSING against three bodies that are exactly right. pg_get_functiondef()
    -- returns the PROSE — the same trap the 0827 token above documents — and all three
    -- replacements explain in a comment which appointment branch they lost:
    -- insert_notification says "keyed on appointments", the other two say
    -- "removed 20261004". The bare word is therefore present in every CORRECT body, and
    -- the only way to satisfy that token was to delete the comments that tell the next
    -- reader why the branches went and not to re-add one. The comment is the valuable
    -- half. IF ONE OF THESE GOES RED, READ THE BODY BEFORE ASSUMING A REGRESSION.
    --
    -- Three changes, each with a reason:
    -- (1) THE NEGATIVE IS CODE-SHAPED: 'FROM appointments' — the anchor 20261004's own
    --     pre-guards and its section 9(e) used. It matches `DELETE FROM appointments`
    --     and `FROM appointments a`, and it matches none of the three live comments.
    --     Verified 2026-09-02 against pasted pg_get_functiondef output, NOT against the
    --     migration file. The residual cost is real and is the price of any text check:
    --     prose in these three bodies must never contain that exact phrase.
    -- (2) ONE TOKEN PER FUNCTION. count(*) = 3 went red as a single anonymous row for
    --     any of the three, so the report named a slice instead of a function.
    -- (3) A POSITIVE BESIDE EACH NEGATIVE, because an absence passes on a function that
    --     is empty, truncated or half-replaced — the 0827 trio logic. Be honest about
    --     what each positive does: delete_own_account and insert_notification are the
    --     OLD body MINUS lines, so no marker tells new from old there and the negative
    --     carries the whole claim; those positives are emptiness guards only.
    --     notify_facility_owner is the exception — its narrowed enum literal cannot
    --     occur in the old, longer one, so there the positive discriminates too.
    -- COUNT THE NAME, MATCH THE BODY — two separate clauses, and the split is not
    -- pedantry. `count(*) = 1` with the markers inside the WHERE counts only the
    -- functions that MATCH, so a resurrected overload still querying appointments is
    -- excluded by the very negative meant to catch it and the count reads 1: green,
    -- beside a live function pointing at a dropped table. Exactly the EXISTS blindness
    -- the split was supposed to remove. So: count every function of that NAME, and
    -- require bool_and over their bodies. Two overloads go red whichever one matches.
    -- coalesce(..., false) because bool_and over zero rows is NULL, and a NULL assertion
    -- does not fire — the 20261001 lesson. One signature each, confirmed 2026-09-02.
    -- Dry-run before commit, and the surfaces are NOT the same one: the three predicates
    -- are TRUE against the 20261004 bodies as applied — each marker independently
    -- confirmed in pasted live pg_get_functiondef output, 2026-09-02 — and FALSE against
    -- the pre-1004 bodies in git (20260718 / 20260726 / 20260923).
    UNION ALL SELECT '1004_appointments_removal','delete_own_account no longer queries appointments (and still ends at auth.users)',
      (SELECT count(*) = 1 AND coalesce(bool_and(
                  pg_get_functiondef(p.oid) ILIKE '%DELETE FROM auth.users%'
              AND pg_get_functiondef(p.oid) NOT ILIKE '%FROM appointments%'), false)
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='delete_own_account')
    UNION ALL SELECT '1004_appointments_removal','insert_notification no longer queries appointments (still inserts, still denies)',
      (SELECT count(*) = 1 AND coalesce(bool_and(
                  pg_get_functiondef(p.oid) ILIKE '%INSERT INTO notifications%'
              AND pg_get_functiondef(p.oid) ILIKE '%RAISE EXCEPTION%'
              AND pg_get_functiondef(p.oid) NOT ILIKE '%FROM appointments%'), false)
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='insert_notification')
    UNION ALL SELECT '1004_appointments_removal','notify_facility_owner takes only ''question'' and no longer queries appointments',
      (SELECT count(*) = 1 AND coalesce(bool_and(
                  pg_get_functiondef(p.oid) ILIKE '%p_kind NOT IN (''question'')%'
              AND pg_get_functiondef(p.oid) NOT ILIKE '%FROM appointments%'), false)
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='notify_facility_owner')
    -- is_customer_blocked SURVIVES but is now PERMANENTLY FALSE: record_no_show was its
    -- only writer, so profiles.blocked_until can never be set again. Kept only because
    -- the questions INSERT policy references it and would break without it. Registered
    -- so the next reader does not mistake a dead guard for a live one — a guard that
    -- cannot fire is exactly the decoration this file warns about elsewhere. A future
    -- slice should give it a writer or remove it deliberately, not find it by accident.
    -- Both halves asserted: the function is here, and its writer is not.
    UNION ALL SELECT '1004_appointments_removal','is_customer_blocked kept (DEAD guard — no writer since 20261004)',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='is_customer_blocked')
      AND (SELECT count(*) = 0 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname='record_no_show')
    -- (6) BOTH gates on answers. One without the other is the more dangerous half-fix:
    -- gating the answer but not the parent leaves a removed thread's replies readable.
    UNION ALL SELECT '0930_answers_read_gates','read answers gates on its own hidden_at AND the parent question',
      EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='answers'
              AND policyname='read answers'
              AND qual ILIKE '%hidden_at%' AND qual ILIKE '%deleted_at%')
    -- ══ Profile completion gate (Slice 1) ═══════════════════════════════════
    -- SEVEN tokens. Almost nothing that makes this slice SAFE is a named object:
    -- a trigger body, an index's target column, two absences and two derived counts.
    -- Sections A-I see the names and cannot see any of it.
    --
    -- (1) The profiles filter routes through the SHARED matcher, so it inherits
    -- 20260925's normalization and 20260926's RAISE LOG breadcrumb and hit_count. If
    -- someone inlines a matcher here instead, this surface silently stops logging while
    -- section D still reports a trigger of the right name.
    UNION ALL SELECT '1001_profile_completion','profiles content filter routes through contains_blocked_term',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='check_profile_name_content'
          AND pg_get_functiondef(p.oid) ILIKE '%contains_blocked_term%')
    -- (2) Uniqueness is on the NORMALIZED form. A raw-string unique index satisfies
    -- section F's existence check identically and is defeated by the shift key or one
    -- zero-width character — the exact evasion class 20260925 closed. Both halves are
    -- asserted: the index target, and the trigger that fills it.
    UNION ALL SELECT '1001_profile_completion','display_name uniqueness is on the NORMALIZED column, not the raw string',
      EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public'
              AND indexname='profiles_display_name_norm_uniq'
              AND indexdef ILIKE '%UNIQUE%'
              AND indexdef ILIKE '%display_name_normalized%')
      AND EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='check_profile_name_content'
          AND pg_get_functiondef(p.oid) ILIKE '%normalize_display_name%')
    -- (3) The IS-DISTINCT-FROM guards survived. "Tightening" this trigger to check on
    -- EVERY update locks any user whose STORED full_name contains a blocked term out of
    -- their own row — including App.js's push_token write, which fails into a bare
    -- .then(). It would present as "this user stopped getting notifications" and point
    -- nowhere near here. The migration's DO block plants exactly that row and proves it.
    UNION ALL SELECT '1001_profile_completion','profile filter fires only on CHANGE (push_token writes stay possible)',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='check_profile_name_content'
          AND pg_get_functiondef(p.oid) ILIKE '%NEW.full_name IS DISTINCT FROM OLD.full_name%'
          AND pg_get_functiondef(p.oid) ILIKE '%NEW.display_name IS DISTINCT FROM OLD.display_name%')
    -- (4) The 13-year rule is in the TRIGGER. It cannot be a CHECK — CURRENT_DATE is
    -- STABLE and a CHECK requires IMMUTABLE — so sections B and E are structurally
    -- blind to whether it exists at all. This token is the only thing that can see it.
    -- Mirrors MIN_SIGNUP_AGE in constants/profileGate.js; npm run profile:check reads
    -- both and fails on disagreement.
    UNION ALL SELECT '1001_profile_completion','MIN_SIGNUP_AGE 13 is enforced in the trigger',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='check_profile_name_content'
          AND pg_get_functiondef(p.oid) ILIKE '%interval ''13 years''%'
          AND pg_get_functiondef(p.oid) ILIKE '%UNDERAGE%')
    -- (5) An ABSENCE, and the loudest failure in this slice lands on SIX UNRELATED
    -- SURFACES. blocked_terms feeds contains_blocked_term(), which every UGC content
    -- trigger calls, so a reserved role word in there rejects ordinary reviews,
    -- questions, answers, facility descriptions, change requests and place submissions
    -- app-wide. No existence section can express an absence.
    UNION ALL SELECT '1001_profile_completion','reserved role words are NOT in blocked_terms',
      NOT EXISTS(SELECT 1 FROM public.blocked_terms
        WHERE term IN ('ada','oli','maki','destek','support','admin','moderator','official','resmi'))
    -- (6) DERIVED policy counts, not name lists. institutions must have EXACTLY ONE
    -- (read); a second is almost certainly a write policy, which makes a
    -- service-role-only table client-writable. reserved_names must have EXACTLY TWO. If
    -- a third is ever legitimate, bump the number here IN THE SAME COMMIT and say why —
    -- that edit is the review moment a name list never creates.
    UNION ALL SELECT '1001_profile_completion','institutions has exactly 1 policy, reserved_names exactly 2',
      (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='institutions') = 1
      AND (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='reserved_names') = 2
    -- (7) The RPC is authenticated-only AND guards guests in its own body. BOTH halves,
    -- because in Supabase the 'authenticated' role INCLUDES anonymous sessions — the
    -- grant alone does not exclude them. The whole argument for allowing this one RPC
    -- past the frozen whitelist rests on these two facts; if either goes red, the
    -- argument no longer holds and the function should be re-reviewed, not re-granted.
    -- aclexplode, NOT has_function_privilege(): the latter RAISES on a function that
    -- does not exist, and absence must be REPORTABLE here rather than turning the whole
    -- drift report into a hard error on a database that has not applied 20261002.
    UNION ALL SELECT '1002_display_name_rpc','display_name_available is authenticated-only and guards anonymous sessions',
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname='display_name_available'
          AND pg_get_functiondef(p.oid) ILIKE '%is_anonymous_session%')
      AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        LEFT JOIN LATERAL aclexplode(p.proacl) a ON TRUE
        LEFT JOIN pg_roles r ON r.oid = a.grantee
        WHERE n.nspname='public' AND p.proname='display_name_available'
          AND a.privilege_type='EXECUTE' AND (a.grantee = 0 OR r.rolname = 'anon'))
  ) z

  UNION ALL
  -- ── I. RLS ENABLED on user-data tables (health app — must be ON) ───────────
  SELECT 'I-rls-enabled', '-', c.relname,
         CASE WHEN c.relrowsecurity THEN 'ON' ELSE 'OFF ← FIX' END
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN (
    'profiles','facilities','reviews','questions','answers',
    'notifications','claim_requests','facility_change_requests','job_postings',
    'content_reports','blocks','insurance_companies','esim_waitlist','module_waitlist',
    'moderation_rejections',
    'provider_documents','provider_credentials','quiz_submissions','pharmacist_scores',
    -- directory / UGC tables (Slice 5 — user-writable rows, so RLS must be ON here too)
    'beaches','landmarks','places','place_claims','events','home_services','transport_providers',
    'estate_agencies','estate_agents','properties','property_images',
    'duty_list','duty_schedule','blocked_terms','bus_routes',
    -- admin-seeded directory: no user data, but public-read + admin-write only
    -- works solely because RLS is ON. OFF here = world-writable firm listings.
    'towing_companies',
    -- push_log records who we tried to push to. RLS is the only thing keeping that
    -- delivery history off every signed-in customer. OFF here = a readable log of
    -- which providers got which alerts and when.
    'push_log',
    -- contact_events is world-INSERTABLE by design (the inverse of towing_companies).
    -- RLS is the ONLY thing making it not also world-READABLE, and `authenticated`
    -- holds a table-level SELECT grant so the future admin screen needs no migration.
    -- OFF here = every customer can read the whole contact log.
    'contact_events',
    -- Profile gate lookups. institutions is service-role-write-only and reserved_names
    -- is admin-write-only; BOTH of those are true solely because RLS is ON. OFF here
    -- means any signed-in user can add a university, or delete every reserved name and
    -- then register "ADA Destek".
    'institutions',
    'reserved_names'
  )
)
-- ─── THE VERDICT ROW ────────────────────────────────────────────────────────
-- Added 2026-08-30. Scanning ~700 rows by eye for `status <> 'OK'` is not an assertion,
-- and neither is "how many rows changed state since last time": a scoped query counting
-- headline objects reported 12 where this register carries ~47 for one slice, and the
-- gap read like a partial apply when it was a narrow query. Both failure modes are the
-- house rule — DERIVE what you assert, never eyeball it and never remember a count.
--
-- So the report now derives its own verdict and prints it as the FIRST row: either
-- "ALL n CHECKS PASS" or the number of problems, which are listed immediately below it.
-- READ THE TOP ROW. Do not count anything by hand.
SELECT section, migration, object, status FROM (
  SELECT 0 AS ord, 'Z-VERDICT' AS section, '-' AS migration,
         CASE WHEN s.n_bad = 0
              THEN 'ALL ' || s.n_all || ' CHECKS PASS'
              ELSE s.n_bad || ' PROBLEM(S) of ' || s.n_all || ' — listed immediately below'
         END AS object,
         CASE WHEN s.n_bad = 0 THEN 'OK' ELSE 'FAIL ← FIX' END AS status
    FROM (SELECT count(*) AS n_all,
                 count(*) FILTER (WHERE status NOT IN ('OK','ON')) AS n_bad
            FROM report) s
  UNION ALL
  SELECT 1, section, migration, object, status FROM report
) t
ORDER BY ord, (status IN ('OK','ON')) ASC, section, migration, object;  -- problems float to top


-- ═══════════════════════════════════════════════════════════════════════════
-- ═══ QUERY 2 / 4 — CRON JOBS — run alone ═══
-- ═══════════════════════════════════════════════════════════════════════════
-- Errors if pg_cron isn't installed (itself the finding). Expect 5 rows present.
-- Existence is NOT enough: cron.job.active can be false, and a disabled job looks
-- identical to a healthy one from the application's side. purge-moderation-rejections
-- backs a 30-day retention promise published in BOTH terms copies (§8.2), so silently
-- inactive there is a broken written commitment, not a nagging warning.
SELECT e.m migration, e.o job,
       CASE WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname=e.o AND active) THEN 'OK'
            WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname=e.o)            THEN 'INACTIVE ← FIX'
            ELSE 'MISSING' END status
FROM (VALUES
  ('0705_job_postings_auto_expire','expire-job-postings'),
  ('0809_featured_expiry_reminder','featured-expiry-reminder'),
  ('0926_moderation_rejection_log','purge-moderation-rejections')
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

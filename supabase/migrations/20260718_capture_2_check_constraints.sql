-- ============================================================================
-- CAPTURED FROM LIVE 2026-07-18 — REVIEW BEFORE APPLYING — not yet run
-- Project: trnc-health (ref jeihxnwqytnxtytgkzgf)
-- Source: read-only introspection via Supabase Management API (pg_catalog).
--
-- !!  DO NOT run this against the CURRENT live project — every object below
--     ALREADY EXISTS there; re-running will ERROR or duplicate. These files are
--     for (a) version control / review and (b) rebuilding a FRESH database.
--     See ~/ObsidianVault/10-ada/schema-backfill-report.md for apply order.
-- ============================================================================

-- FILE 2/5 — All CHECK constraints in schema public (every app table).
-- Includes status vocabularies + the role CHECK. Idempotent-guarded so a
-- rebuild won't double-add. NOT for the live project (already present).


-- appointments
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_requested_time_future;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_requested_time_future CHECK ((requested_time > now())) NOT VALID;
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'cancelled'::text, 'no_show'::text, 'completed'::text])));

-- beaches
ALTER TABLE public.beaches DROP CONSTRAINT IF EXISTS beaches_access_type_check;
ALTER TABLE public.beaches ADD CONSTRAINT beaches_access_type_check CHECK ((access_type = ANY (ARRAY['public'::text, 'private'::text])));
ALTER TABLE public.beaches DROP CONSTRAINT IF EXISTS beaches_district_check;
ALTER TABLE public.beaches ADD CONSTRAINT beaches_district_check CHECK ((district = ANY (ARRAY['nicosia'::text, 'kyrenia'::text, 'famagusta'::text, 'morphou'::text, 'iskele'::text, 'lefke'::text, 'karpaz'::text])));
ALTER TABLE public.beaches DROP CONSTRAINT IF EXISTS beaches_status_check;
ALTER TABLE public.beaches ADD CONSTRAINT beaches_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'rejected'::text])));

-- blocks
ALTER TABLE public.blocks DROP CONSTRAINT IF EXISTS blocks_check;
ALTER TABLE public.blocks ADD CONSTRAINT blocks_check CHECK ((blocker_id <> blocked_id));

-- bus_routes
ALTER TABLE public.bus_routes DROP CONSTRAINT IF EXISTS bus_routes_destination_district_check;
ALTER TABLE public.bus_routes ADD CONSTRAINT bus_routes_destination_district_check CHECK ((destination_district = ANY (ARRAY['nicosia'::text, 'kyrenia'::text, 'famagusta'::text, 'morphou'::text, 'iskele'::text, 'lefke'::text, 'karpaz'::text])));
ALTER TABLE public.bus_routes DROP CONSTRAINT IF EXISTS bus_routes_origin_district_check;
ALTER TABLE public.bus_routes ADD CONSTRAINT bus_routes_origin_district_check CHECK ((origin_district = ANY (ARRAY['nicosia'::text, 'kyrenia'::text, 'famagusta'::text, 'morphou'::text, 'iskele'::text, 'lefke'::text, 'karpaz'::text])));

-- claim_requests
ALTER TABLE public.claim_requests DROP CONSTRAINT IF EXISTS claim_requests_status_check;
ALTER TABLE public.claim_requests ADD CONSTRAINT claim_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));

-- content_reports
ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS content_reports_content_type_check;
ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_content_type_check CHECK ((content_type = ANY (ARRAY['review'::text, 'question'::text, 'answer'::text])));
ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS content_reports_details_check;
ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_details_check CHECK ((char_length(details) <= 500));
ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS content_reports_reason_check;
ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_reason_check CHECK ((reason = ANY (ARRAY['offensive'::text, 'harassment'::text, 'spam'::text, 'false_info'::text, 'other'::text])));
ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS content_reports_status_check;
ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'actioned'::text, 'dismissed'::text])));

-- estate_agencies
ALTER TABLE public.estate_agencies DROP CONSTRAINT IF EXISTS estate_agencies_status_check;
ALTER TABLE public.estate_agencies ADD CONSTRAINT estate_agencies_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'rejected'::text])));

-- estate_agents
ALTER TABLE public.estate_agents DROP CONSTRAINT IF EXISTS estate_agents_status_check;
ALTER TABLE public.estate_agents ADD CONSTRAINT estate_agents_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'rejected'::text])));

-- events
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_category_check;
ALTER TABLE public.events ADD CONSTRAINT events_category_check CHECK ((category = ANY (ARRAY['concert'::text, 'festival'::text, 'nightlife'::text, 'other'::text])));
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_description_check;
ALTER TABLE public.events ADD CONSTRAINT events_description_check CHECK ((char_length(description) <= 500));
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE public.events ADD CONSTRAINT events_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending'::text, 'approved'::text, 'rejected'::text])));

-- facilities
ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_membership_tier_check;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_membership_tier_check CHECK ((membership_tier = ANY (ARRAY['basic'::text, 'pro'::text])));
ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_status_check;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'trial'::text, 'active'::text, 'suspended'::text])));
ALTER TABLE public.facilities DROP CONSTRAINT IF EXISTS facilities_type_check;
ALTER TABLE public.facilities ADD CONSTRAINT facilities_type_check CHECK ((type = ANY (ARRAY['pharmacy'::text, 'clinic'::text, 'hospital'::text, 'dentist'::text, 'vet'::text])));

-- facility_change_requests
ALTER TABLE public.facility_change_requests DROP CONSTRAINT IF EXISTS facility_change_requests_status_check;
ALTER TABLE public.facility_change_requests ADD CONSTRAINT facility_change_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));

-- home_services
ALTER TABLE public.home_services DROP CONSTRAINT IF EXISTS home_services_contact_pref_check;
ALTER TABLE public.home_services ADD CONSTRAINT home_services_contact_pref_check CHECK ((contact_pref = ANY (ARRAY['call'::text, 'whatsapp'::text, 'both'::text])));
ALTER TABLE public.home_services DROP CONSTRAINT IF EXISTS home_services_district_check;
ALTER TABLE public.home_services ADD CONSTRAINT home_services_district_check CHECK ((district = ANY (ARRAY['nicosia'::text, 'kyrenia'::text, 'famagusta'::text, 'morphou'::text, 'iskele'::text, 'lefke'::text])));
ALTER TABLE public.home_services DROP CONSTRAINT IF EXISTS home_services_status_check;
ALTER TABLE public.home_services ADD CONSTRAINT home_services_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'rejected'::text])));

-- job_postings
ALTER TABLE public.job_postings DROP CONSTRAINT IF EXISTS job_postings_contact_pref_check;
ALTER TABLE public.job_postings ADD CONSTRAINT job_postings_contact_pref_check CHECK ((contact_pref = ANY (ARRAY['call'::text, 'whatsapp'::text, 'both'::text])));
ALTER TABLE public.job_postings DROP CONSTRAINT IF EXISTS job_postings_district_check;
ALTER TABLE public.job_postings ADD CONSTRAINT job_postings_district_check CHECK ((district = ANY (ARRAY['nicosia'::text, 'kyrenia'::text, 'famagusta'::text, 'morphou'::text, 'iskele'::text, 'lefke'::text, 'karpaz'::text])));
ALTER TABLE public.job_postings DROP CONSTRAINT IF EXISTS job_postings_employment_type_check;
ALTER TABLE public.job_postings ADD CONSTRAINT job_postings_employment_type_check CHECK ((employment_type = ANY (ARRAY['full_time'::text, 'part_time'::text, 'seasonal'::text, 'temporary'::text])));
ALTER TABLE public.job_postings DROP CONSTRAINT IF EXISTS job_postings_status_check;
ALTER TABLE public.job_postings ADD CONSTRAINT job_postings_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'rejected'::text, 'filled'::text, 'expired'::text])));

-- landmarks
ALTER TABLE public.landmarks DROP CONSTRAINT IF EXISTS landmarks_category_check;
ALTER TABLE public.landmarks ADD CONSTRAINT landmarks_category_check CHECK ((category = ANY (ARRAY['castle_fortress'::text, 'ancient_ruins'::text, 'museum'::text, 'religious_site'::text, 'monument'::text, 'nature_scenic'::text])));
ALTER TABLE public.landmarks DROP CONSTRAINT IF EXISTS landmarks_district_check;
ALTER TABLE public.landmarks ADD CONSTRAINT landmarks_district_check CHECK ((district = ANY (ARRAY['nicosia'::text, 'kyrenia'::text, 'famagusta'::text, 'morphou'::text, 'iskele'::text, 'lefke'::text, 'karpaz'::text])));
ALTER TABLE public.landmarks DROP CONSTRAINT IF EXISTS landmarks_status_check;
ALTER TABLE public.landmarks ADD CONSTRAINT landmarks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'rejected'::text])));

-- profiles
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['customer'::text, 'provider'::text, 'admin'::text, 'organizer'::text, 'estate_agent'::text])));

-- properties
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_currency_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_currency_check CHECK ((currency = ANY (ARRAY['GBP'::text, 'TRY'::text, 'EUR'::text])));
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_district_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_district_check CHECK ((district = ANY (ARRAY['nicosia'::text, 'kyrenia'::text, 'famagusta'::text, 'morphou'::text, 'iskele'::text])));
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_intent_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_intent_check CHECK ((intent = ANY (ARRAY['rent'::text, 'sale'::text, 'short_term'::text])));
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_price_period_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_price_period_check CHECK ((price_period = ANY (ARRAY['monthly'::text, 'nightly'::text, 'total'::text])));
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_property_type_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_property_type_check CHECK ((property_type = ANY (ARRAY['apartment'::text, 'villa'::text, 'studio'::text, 'house'::text, 'land'::text, 'commercial'::text])));
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_status_check;
ALTER TABLE public.properties ADD CONSTRAINT properties_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'rejected'::text, 'archived'::text])));

-- quiz_submissions
ALTER TABLE public.quiz_submissions DROP CONSTRAINT IF EXISTS quiz_submissions_status_check;
ALTER TABLE public.quiz_submissions ADD CONSTRAINT quiz_submissions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'timed_out'::text])));

-- reviews
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_rating_check;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)));

-- transport_providers
ALTER TABLE public.transport_providers DROP CONSTRAINT IF EXISTS transport_providers_airport_check;
ALTER TABLE public.transport_providers ADD CONSTRAINT transport_providers_airport_check CHECK ((airport = ANY (ARRAY['ercan'::text, 'larnaca'::text, 'both'::text])));
ALTER TABLE public.transport_providers DROP CONSTRAINT IF EXISTS transport_providers_check;
ALTER TABLE public.transport_providers ADD CONSTRAINT transport_providers_check CHECK (((type <> 'airport_transfer'::text) OR (airport IS NOT NULL)));
ALTER TABLE public.transport_providers DROP CONSTRAINT IF EXISTS transport_providers_contact_pref_check;
ALTER TABLE public.transport_providers ADD CONSTRAINT transport_providers_contact_pref_check CHECK ((contact_pref = ANY (ARRAY['call'::text, 'whatsapp'::text, 'both'::text])));
ALTER TABLE public.transport_providers DROP CONSTRAINT IF EXISTS transport_providers_district_check;
ALTER TABLE public.transport_providers ADD CONSTRAINT transport_providers_district_check CHECK ((district = ANY (ARRAY['nicosia'::text, 'kyrenia'::text, 'famagusta'::text, 'morphou'::text, 'iskele'::text, 'lefke'::text, 'karpaz'::text])));
ALTER TABLE public.transport_providers DROP CONSTRAINT IF EXISTS transport_providers_status_check;
ALTER TABLE public.transport_providers ADD CONSTRAINT transport_providers_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'rejected'::text])));
ALTER TABLE public.transport_providers DROP CONSTRAINT IF EXISTS transport_providers_type_check;
ALTER TABLE public.transport_providers ADD CONSTRAINT transport_providers_type_check CHECK ((type = ANY (ARRAY['taxi'::text, 'car_rental'::text, 'airport_transfer'::text])));
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

-- FILE 5/5 — All RLS policies in schema public, reconstructed from
-- pg_policies (PERMISSIVE/RESTRICTIVE, USING, WITH CHECK). Requires the
-- tables (FILE 1 + repo tables) and helper functions (FILE 3) to exist.


-- ── answers ──
CREATE POLICY "no_anon_delete_answers" ON public.answers
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "insert answers" ON public.answers
  FOR INSERT TO public
  WITH CHECK (((get_my_role() = 'provider'::text) AND (auth.uid() = provider_id)));
CREATE POLICY "no_anon_insert_answers" ON public.answers
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "read answers" ON public.answers
  FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM questions q
  WHERE ((q.id = answers.question_id) AND ((q.customer_id = auth.uid()) OR ((get_my_role() = 'provider'::text) AND (EXISTS ( SELECT 1
           FROM facilities f
          WHERE ((f.id = q.facility_id) AND (f.provider_id = auth.uid()))))) OR (get_my_role() = 'admin'::text))))));
CREATE POLICY "no_anon_update_answers" ON public.answers
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));

-- ── appointments ──
CREATE POLICY "admin full access appointments" ON public.appointments
  FOR ALL TO public
  USING ((get_my_role() = 'admin'::text))
  WITH CHECK ((get_my_role() = 'admin'::text));
CREATE POLICY "no_anon_delete_appointments" ON public.appointments
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "appointments_no_expired_trial" ON public.appointments
  FOR INSERT TO public
  WITH CHECK ((NOT (EXISTS ( SELECT 1
   FROM facilities
  WHERE ((facilities.id = appointments.facility_id) AND (facilities.status = 'trial'::text) AND (facilities.trial_ends_at IS NOT NULL) AND (facilities.trial_ends_at < now()))))));
CREATE POLICY "customer insert own appointments" ON public.appointments
  FOR INSERT TO public
  WITH CHECK (((auth.uid() = customer_id) AND (NOT is_customer_blocked())));
CREATE POLICY "no_anon_insert_appointments" ON public.appointments
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "customer read own appointments" ON public.appointments
  FOR SELECT TO public
  USING (((get_my_role() = 'customer'::text) AND (customer_id = auth.uid())));
CREATE POLICY "provider read facility appointments" ON public.appointments
  FOR SELECT TO public
  USING (((get_my_role() = 'provider'::text) AND (facility_id IN ( SELECT my_provider_facility_ids() AS my_provider_facility_ids))));
CREATE POLICY "customer update own appointments" ON public.appointments
  FOR UPDATE TO public
  USING (((get_my_role() = 'customer'::text) AND (customer_id = auth.uid())))
  WITH CHECK (((get_my_role() = 'customer'::text) AND (customer_id = auth.uid())));
CREATE POLICY "customers cancel own appointments" ON public.appointments
  FOR UPDATE TO public
  USING (((customer_id = auth.uid()) AND (status = ANY (ARRAY['pending'::text, 'confirmed'::text])) AND ((status = 'pending'::text) OR (requested_time > (now() + '24:00:00'::interval)))))
  WITH CHECK (((customer_id = auth.uid()) AND (status = 'cancelled'::text)));
CREATE POLICY "no_anon_update_appointments" ON public.appointments
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "provider update facility appointments" ON public.appointments
  FOR UPDATE TO public
  USING (((get_my_role() = 'provider'::text) AND (facility_id IN ( SELECT my_provider_facility_ids() AS my_provider_facility_ids))))
  WITH CHECK (((get_my_role() = 'provider'::text) AND (facility_id IN ( SELECT my_provider_facility_ids() AS my_provider_facility_ids))));
CREATE POLICY "providers can complete appointments" ON public.appointments
  FOR UPDATE TO public
  USING (((facility_id IN ( SELECT my_provider_facility_ids() AS my_provider_facility_ids)) AND (status = 'confirmed'::text) AND (requested_time < now())))
  WITH CHECK ((status = 'completed'::text));

-- ── beaches ──
CREATE POLICY "beaches_delete" ON public.beaches
  FOR DELETE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
CREATE POLICY "no_anon_delete_beaches" ON public.beaches
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "beaches_insert" ON public.beaches
  FOR INSERT TO public
  WITH CHECK ((submitted_by = auth.uid()));
CREATE POLICY "no_anon_insert_beaches" ON public.beaches
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "beaches_select" ON public.beaches
  FOR SELECT TO public
  USING (((status = 'active'::text) OR (submitted_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
CREATE POLICY "beaches_update" ON public.beaches
  FOR UPDATE TO public
  USING (((submitted_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
CREATE POLICY "no_anon_update_beaches" ON public.beaches
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));

-- ── blocked_terms ──
CREATE POLICY "blocked_terms_admin_write" ON public.blocked_terms
  FOR ALL TO public
  USING ((get_my_role() = 'admin'::text))
  WITH CHECK ((get_my_role() = 'admin'::text));
CREATE POLICY "blocked_terms_read_all" ON public.blocked_terms
  FOR SELECT TO public
  USING (true);

-- ── blocks ──
CREATE POLICY "blocks_delete_own" ON public.blocks
  FOR DELETE TO public
  USING ((blocker_id = auth.uid()));
CREATE POLICY "no_anon_delete_blocks" ON public.blocks
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "blocks_insert_own" ON public.blocks
  FOR INSERT TO public
  WITH CHECK ((blocker_id = auth.uid()));
CREATE POLICY "no_anon_insert_blocks" ON public.blocks
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "blocks_read_own" ON public.blocks
  FOR SELECT TO public
  USING ((blocker_id = auth.uid()));
CREATE POLICY "no_anon_update_blocks" ON public.blocks
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));

-- ── bus_routes ──
CREATE POLICY "br_delete_admin" ON public.bus_routes
  FOR DELETE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
CREATE POLICY "br_insert_admin" ON public.bus_routes
  FOR INSERT TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
CREATE POLICY "br_select_public" ON public.bus_routes
  FOR SELECT TO public
  USING (true);
CREATE POLICY "br_update_admin" ON public.bus_routes
  FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));

-- ── claim_requests ──
CREATE POLICY "admin manage claims" ON public.claim_requests
  FOR ALL TO public
  USING ((get_my_role() = 'admin'::text));
CREATE POLICY "no_anon_delete_claim_requests" ON public.claim_requests
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "no_anon_insert_claim_requests" ON public.claim_requests
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "providers insert own claims" ON public.claim_requests
  FOR INSERT TO public
  WITH CHECK ((requester_id = auth.uid()));
CREATE POLICY "providers read own claims" ON public.claim_requests
  FOR SELECT TO public
  USING ((requester_id = auth.uid()));
CREATE POLICY "no_anon_update_claim_requests" ON public.claim_requests
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));

-- ── content_reports ──
CREATE POLICY "no_anon_delete_content_reports" ON public.content_reports
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "no_anon_insert_content_reports" ON public.content_reports
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "reports_insert_own" ON public.content_reports
  FOR INSERT TO public
  WITH CHECK (((reporter_id = auth.uid()) AND (status = 'pending'::text) AND (resolved_at IS NULL) AND (resolved_by IS NULL)));
CREATE POLICY "reports_admin_read" ON public.content_reports
  FOR SELECT TO public
  USING ((get_my_role() = 'admin'::text));
CREATE POLICY "no_anon_update_content_reports" ON public.content_reports
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "reports_admin_update" ON public.content_reports
  FOR UPDATE TO public
  USING ((get_my_role() = 'admin'::text))
  WITH CHECK ((get_my_role() = 'admin'::text));

-- ── duty_list ──
CREATE POLICY "Anyone can read duty_list" ON public.duty_list
  FOR SELECT TO authenticated
  USING (true);

-- ── duty_schedule ──
CREATE POLICY "admin all duty" ON public.duty_schedule
  FOR ALL TO public
  USING (is_admin())
  WITH CHECK (is_admin());
CREATE POLICY "admin manage duty" ON public.duty_schedule
  FOR ALL TO public
  USING ((get_my_role() = 'admin'::text));
CREATE POLICY "public read" ON public.duty_schedule
  FOR SELECT TO public
  USING (true);

-- ── estate_agencies ──
CREATE POLICY "agencies_all_admin" ON public.estate_agencies
  FOR DELETE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
CREATE POLICY "agencies_insert_owner" ON public.estate_agencies
  FOR INSERT TO public
  WITH CHECK ((owner_id = auth.uid()));
CREATE POLICY "agencies_select_public" ON public.estate_agencies
  FOR SELECT TO public
  USING (((status = 'active'::text) OR (owner_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
CREATE POLICY "agencies_update_owner" ON public.estate_agencies
  FOR UPDATE TO public
  USING (((owner_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));

-- ── estate_agents ──
CREATE POLICY "agents_delete_admin" ON public.estate_agents
  FOR DELETE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
CREATE POLICY "no_anon_delete_estate_agents" ON public.estate_agents
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "agents_insert_self" ON public.estate_agents
  FOR INSERT TO public
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "no_anon_insert_estate_agents" ON public.estate_agents
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "agents_select_public" ON public.estate_agents
  FOR SELECT TO public
  USING (((status = 'active'::text) OR (user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
CREATE POLICY "agents_update_self" ON public.estate_agents
  FOR UPDATE TO public
  USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
CREATE POLICY "no_anon_update_estate_agents" ON public.estate_agents
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));

-- ── events ──
CREATE POLICY "admin manage all events" ON public.events
  FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
CREATE POLICY "organizer manage own events" ON public.events
  FOR ALL TO authenticated
  USING ((organizer_id = auth.uid()))
  WITH CHECK ((organizer_id = auth.uid()));
CREATE POLICY "no_anon_delete_events" ON public.events
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "no_anon_insert_events" ON public.events
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "read approved events" ON public.events
  FOR SELECT TO authenticated
  USING ((status = 'approved'::text));
CREATE POLICY "no_anon_update_events" ON public.events
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));

-- ── facilities ──
CREATE POLICY "admin all facilities" ON public.facilities
  FOR ALL TO public
  USING (is_admin())
  WITH CHECK (is_admin());
CREATE POLICY "admin manage facilities" ON public.facilities
  FOR ALL TO public
  USING ((get_my_role() = 'admin'::text));
CREATE POLICY "no_anon_delete_facilities" ON public.facilities
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "no_anon_insert_facilities" ON public.facilities
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "providers_can_insert_own_facility" ON public.facilities
  FOR INSERT TO public
  WITH CHECK ((provider_id = auth.uid()));
CREATE POLICY "Anyone can read facilities" ON public.facilities
  FOR SELECT TO anon,authenticated
  USING (true);
CREATE POLICY "Provider can update own facility" ON public.facilities
  FOR UPDATE TO public
  USING ((provider_id = auth.uid()))
  WITH CHECK ((provider_id = auth.uid()));
CREATE POLICY "no_anon_update_facilities" ON public.facilities
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));

-- ── facility_change_requests ──
CREATE POLICY "no_anon_delete_facility_change_requests" ON public.facility_change_requests
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "no_anon_insert_facility_change_requests" ON public.facility_change_requests
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "providers can submit changes" ON public.facility_change_requests
  FOR INSERT TO public
  WITH CHECK (((provider_id = auth.uid()) AND (facility_id IN ( SELECT facilities.id
   FROM facilities
  WHERE (facilities.provider_id = auth.uid())))));
CREATE POLICY "admins can read all change requests" ON public.facility_change_requests
  FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
CREATE POLICY "providers can read own change requests" ON public.facility_change_requests
  FOR SELECT TO public
  USING ((provider_id = auth.uid()));
CREATE POLICY "admins can update change requests" ON public.facility_change_requests
  FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
CREATE POLICY "no_anon_update_facility_change_requests" ON public.facility_change_requests
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));

-- ── home_services ──
CREATE POLICY "hs_delete_admin" ON public.home_services
  FOR DELETE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
CREATE POLICY "no_anon_delete_home_services" ON public.home_services
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "hs_insert_self" ON public.home_services
  FOR INSERT TO public
  WITH CHECK ((owner_id = auth.uid()));
CREATE POLICY "no_anon_insert_home_services" ON public.home_services
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "hs_select_public" ON public.home_services
  FOR SELECT TO public
  USING (((status = 'active'::text) OR (owner_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
CREATE POLICY "hs_update_self" ON public.home_services
  FOR UPDATE TO public
  USING (((owner_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
CREATE POLICY "no_anon_update_home_services" ON public.home_services
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));

-- ── job_postings ──
CREATE POLICY "jp_delete_admin" ON public.job_postings
  FOR DELETE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
CREATE POLICY "no_anon_delete_job_postings" ON public.job_postings
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "jp_insert_self" ON public.job_postings
  FOR INSERT TO public
  WITH CHECK ((owner_id = auth.uid()));
CREATE POLICY "no_anon_insert_job_postings" ON public.job_postings
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "jp_select" ON public.job_postings
  FOR SELECT TO public
  USING ((((status = 'active'::text) AND (expires_at IS NOT NULL) AND (expires_at > now())) OR (owner_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
CREATE POLICY "jp_update_self" ON public.job_postings
  FOR UPDATE TO public
  USING (((owner_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))))
  WITH CHECK (((owner_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
CREATE POLICY "no_anon_update_job_postings" ON public.job_postings
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));

-- ── landmarks ──
CREATE POLICY "landmarks_delete" ON public.landmarks
  FOR DELETE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
CREATE POLICY "no_anon_delete_landmarks" ON public.landmarks
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "landmarks_insert" ON public.landmarks
  FOR INSERT TO public
  WITH CHECK ((submitted_by = auth.uid()));
CREATE POLICY "no_anon_insert_landmarks" ON public.landmarks
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "landmarks_select" ON public.landmarks
  FOR SELECT TO public
  USING (((status = 'active'::text) OR (submitted_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
CREATE POLICY "landmarks_update" ON public.landmarks
  FOR UPDATE TO public
  USING (((submitted_by = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
CREATE POLICY "no_anon_update_landmarks" ON public.landmarks
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));

-- ── notifications ──
CREATE POLICY "no_anon_delete_notifications" ON public.notifications
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "no_anon_insert_notifications" ON public.notifications
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "service insert notifications" ON public.notifications
  FOR INSERT TO public
  WITH CHECK (false);
CREATE POLICY "users read own notifications" ON public.notifications
  FOR SELECT TO public
  USING ((user_id = auth.uid()));
CREATE POLICY "no_anon_update_notifications" ON public.notifications
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "users update own notifications" ON public.notifications
  FOR UPDATE TO public
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

-- ── pharmacist_scores ──
CREATE POLICY "anyone_read_scores" ON public.pharmacist_scores
  FOR SELECT TO authenticated
  USING (true);

-- ── profiles ──
CREATE POLICY "admin delete all" ON public.profiles
  FOR DELETE TO public
  USING (is_admin());
CREATE POLICY "no_anon_delete_profiles" ON public.profiles
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "no_anon_insert_profiles" ON public.profiles
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "admin read all" ON public.profiles
  FOR SELECT TO public
  USING (is_admin());
CREATE POLICY "admin read profiles" ON public.profiles
  FOR SELECT TO public
  USING (((id = auth.uid()) OR (get_my_role() = 'admin'::text)));
CREATE POLICY "owner read" ON public.profiles
  FOR SELECT TO public
  USING ((auth.uid() = id));
CREATE POLICY "providers read customer push token" ON public.profiles
  FOR SELECT TO public
  USING (((get_my_role() = 'provider'::text) AND (EXISTS ( SELECT 1
   FROM (appointments a
     JOIN facilities f ON ((a.facility_id = f.id)))
  WHERE ((a.customer_id = profiles.id) AND (f.provider_id = auth.uid()))))));
CREATE POLICY "admin update all" ON public.profiles
  FOR UPDATE TO public
  USING (is_admin())
  WITH CHECK (is_admin());
CREATE POLICY "no_anon_update_profiles" ON public.profiles
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "owner update" ON public.profiles
  FOR UPDATE TO public
  USING ((auth.uid() = id))
  WITH CHECK (((auth.uid() = id) AND (role = get_my_role())));

-- ── properties ──
CREATE POLICY "no_anon_delete_properties" ON public.properties
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "props_delete_admin" ON public.properties
  FOR DELETE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
CREATE POLICY "no_anon_insert_properties" ON public.properties
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "props_insert_agent" ON public.properties
  FOR INSERT TO public
  WITH CHECK ((agent_id IN ( SELECT estate_agents.id
   FROM estate_agents
  WHERE ((estate_agents.user_id = auth.uid()) AND (estate_agents.status = 'active'::text)))));
CREATE POLICY "props_select_public" ON public.properties
  FOR SELECT TO public
  USING ((((status = 'active'::text) AND (EXISTS ( SELECT 1
   FROM estate_agents ea
  WHERE ((ea.id = properties.agent_id) AND (ea.subscription_expires_at IS NOT NULL) AND (ea.subscription_expires_at > now()))))) OR (agent_id IN ( SELECT estate_agents.id
   FROM estate_agents
  WHERE (estate_agents.user_id = auth.uid()))) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
CREATE POLICY "no_anon_update_properties" ON public.properties
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "props_update_agent" ON public.properties
  FOR UPDATE TO public
  USING (((agent_id IN ( SELECT estate_agents.id
   FROM estate_agents
  WHERE (estate_agents.user_id = auth.uid()))) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));

-- ── property_images ──
CREATE POLICY "images_delete_agent" ON public.property_images
  FOR DELETE TO public
  USING (((property_id IN ( SELECT p.id
   FROM (properties p
     JOIN estate_agents ea ON ((ea.id = p.agent_id)))
  WHERE (ea.user_id = auth.uid()))) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
CREATE POLICY "no_anon_delete_property_images" ON public.property_images
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "images_insert_agent" ON public.property_images
  FOR INSERT TO public
  WITH CHECK ((property_id IN ( SELECT p.id
   FROM (properties p
     JOIN estate_agents ea ON ((ea.id = p.agent_id)))
  WHERE (ea.user_id = auth.uid()))));
CREATE POLICY "no_anon_insert_property_images" ON public.property_images
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "images_select_public" ON public.property_images
  FOR SELECT TO public
  USING (((property_id IN ( SELECT p.id
   FROM (properties p
     JOIN estate_agents ea ON ((ea.id = p.agent_id)))
  WHERE ((p.status = 'active'::text) AND (ea.subscription_expires_at IS NOT NULL) AND (ea.subscription_expires_at > now())))) OR (property_id IN ( SELECT p.id
   FROM (properties p
     JOIN estate_agents ea ON ((ea.id = p.agent_id)))
  WHERE (ea.user_id = auth.uid()))) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
CREATE POLICY "no_anon_update_property_images" ON public.property_images
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));

-- ── provider_credentials ──
CREATE POLICY "no_anon_delete_provider_credentials" ON public.provider_credentials
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "no_anon_insert_provider_credentials" ON public.provider_credentials
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "provider_credentials_provider_insert" ON public.provider_credentials
  FOR INSERT TO public
  WITH CHECK ((auth.uid() = provider_id));
CREATE POLICY "provider_credentials_admin_select" ON public.provider_credentials
  FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
CREATE POLICY "provider_credentials_provider_select" ON public.provider_credentials
  FOR SELECT TO public
  USING ((auth.uid() = provider_id));
CREATE POLICY "provider_credentials_public_select" ON public.provider_credentials
  FOR SELECT TO public
  USING ((status = 'approved'::text));
CREATE POLICY "no_anon_update_provider_credentials" ON public.provider_credentials
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "provider_credentials_admin_update" ON public.provider_credentials
  FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));

-- ── provider_documents ──
CREATE POLICY "no_anon_delete_provider_documents" ON public.provider_documents
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "no_anon_insert_provider_documents" ON public.provider_documents
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "provider_documents_provider_insert" ON public.provider_documents
  FOR INSERT TO public
  WITH CHECK ((auth.uid() = provider_id));
CREATE POLICY "provider_documents_admin_select" ON public.provider_documents
  FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
CREATE POLICY "provider_documents_provider_select" ON public.provider_documents
  FOR SELECT TO public
  USING ((auth.uid() = provider_id));
CREATE POLICY "no_anon_update_provider_documents" ON public.provider_documents
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "provider_documents_admin_update" ON public.provider_documents
  FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));

-- ── questions ──
CREATE POLICY "no_anon_delete_questions" ON public.questions
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "insert questions" ON public.questions
  FOR INSERT TO public
  WITH CHECK ((customer_id = auth.uid()));
CREATE POLICY "no_anon_insert_questions" ON public.questions
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "read questions" ON public.questions
  FOR SELECT TO public
  USING ((((hidden_at IS NULL) AND ((customer_id = auth.uid()) OR ((get_my_role() = 'provider'::text) AND (EXISTS ( SELECT 1
   FROM facilities f
  WHERE ((f.id = questions.facility_id) AND (f.provider_id = auth.uid()))))))) OR (customer_id = auth.uid()) OR (get_my_role() = 'admin'::text)));
CREATE POLICY "no_anon_update_questions" ON public.questions
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));

-- ── quiz_submissions ──
CREATE POLICY "customer_insert" ON public.quiz_submissions
  FOR INSERT TO public
  WITH CHECK ((customer_id = auth.uid()));
CREATE POLICY "customer_read_own" ON public.quiz_submissions
  FOR SELECT TO authenticated
  USING ((customer_id = auth.uid()));
CREATE POLICY "pharmacy_read_assigned" ON public.quiz_submissions
  FOR SELECT TO authenticated
  USING ((assigned_facility_id IN ( SELECT facilities.id
   FROM facilities
  WHERE (facilities.provider_id = auth.uid()))));
CREATE POLICY "customer_timeout" ON public.quiz_submissions
  FOR UPDATE TO authenticated
  USING ((customer_id = auth.uid()))
  WITH CHECK (((customer_id = auth.uid()) AND (status = 'timed_out'::text)));
CREATE POLICY "pharmacy_approve" ON public.quiz_submissions
  FOR UPDATE TO authenticated
  USING ((assigned_facility_id IN ( SELECT facilities.id
   FROM facilities
  WHERE (facilities.provider_id = auth.uid()))))
  WITH CHECK (((assigned_facility_id IN ( SELECT facilities.id
   FROM facilities
  WHERE (facilities.provider_id = auth.uid()))) AND (status = 'approved'::text)));

-- ── reviews ──
CREATE POLICY "no_anon_delete_reviews" ON public.reviews
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "customers insert own reviews" ON public.reviews
  FOR INSERT TO public
  WITH CHECK ((customer_id = auth.uid()));
CREATE POLICY "no_anon_insert_reviews" ON public.reviews
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "public read reviews" ON public.reviews
  FOR SELECT TO public
  USING ((((hidden_at IS NULL) AND ((auth.uid() IS NULL) OR (NOT (EXISTS ( SELECT 1
   FROM blocks b
  WHERE ((b.blocker_id = auth.uid()) AND (b.blocked_id = reviews.customer_id))))))) OR (customer_id = auth.uid()) OR (get_my_role() = 'admin'::text)));
CREATE POLICY "no_anon_update_reviews" ON public.reviews
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));

-- ── transport_providers ──
CREATE POLICY "no_anon_delete_transport_providers" ON public.transport_providers
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((NOT is_anonymous_session()));
CREATE POLICY "tp_delete_admin" ON public.transport_providers
  FOR DELETE TO public
  USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));
CREATE POLICY "no_anon_insert_transport_providers" ON public.transport_providers
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "tp_insert_self" ON public.transport_providers
  FOR INSERT TO public
  WITH CHECK ((owner_id = auth.uid()));
CREATE POLICY "tp_select_public" ON public.transport_providers
  FOR SELECT TO public
  USING (((status = 'active'::text) OR (owner_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
CREATE POLICY "no_anon_update_transport_providers" ON public.transport_providers
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING ((NOT is_anonymous_session()))
  WITH CHECK ((NOT is_anonymous_session()));
CREATE POLICY "tp_update_self_or_admin" ON public.transport_providers
  FOR UPDATE TO public
  USING (((owner_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text))))));
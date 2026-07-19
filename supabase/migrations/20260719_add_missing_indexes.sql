-- ─── FIX D3/V2 — add missing indexes on filtered / joined columns ───────────
--
-- The schema backfill captured tables, CHECKs, functions, triggers and RLS — but
-- NOT indexes. Postgres does not auto-index FK columns, so the columns that RLS
-- policies and app queries filter/join on every request are (as far as the repo
-- shows) unindexed → sequential scans that degrade as data grows. This adds only
-- indexes with concrete evidence of use; each is annotated with the RLS policy
-- and/or app query that justifies it.
--
-- ALREADY INDEXED — deliberately NOT re-added (would duplicate):
--   • job_postings(owner_id), job_postings(status, expires_at)   [20260702]
--   • content_reports(status, created_at), (content_type, content_id),
--     UNIQUE(reporter_id, content_type, content_id)              [20260712]
--   • reviews(customer_id)                                       [20260712]
--   • blocks PK(blocker_id, blocked_id); reviews UNIQUE(appointment_id),
--     UNIQUE(customer_id, facility_id); every table's PK.
--
-- CONSIDERED BUT SKIPPED (no evidence / not worth it — see report):
--   • answers(provider_id) — only used in single-row INSERT WITH CHECK, no scan.
--   • duty_list — no confirmed query filter observed; not speculating.
--   • properties(agent_id), property_images(property_id), estate_agents(user_id),
--     estate_agencies(owner_id), transport_providers(owner_id) — real-estate /
--     transport modules; genuine candidates but out of the current high-traffic
--     scope. Add in a follow-up if those modules grow.
--   • beaches/landmarks(submitted_by), bus_routes, blocked_terms — small curated
--     tables; a full scan is cheap.
--
-- Locking: CREATE INDEX briefly takes ACCESS EXCLUSIVE. On these tables at
-- current (closed-testing) volumes it is effectively instant, so this runs in one
-- transaction. If facilities/appointments have grown large in production, prefer
-- CREATE INDEX CONCURRENTLY for those two — note it CANNOT run inside a
-- transaction, so pull them out of the BEGIN/COMMIT and run them separately.

BEGIN;

-- ── facilities ──
-- RLS "Facilities read access" / "Provider can update own facility"
-- (provider_id = auth.uid()), my_provider_facility_ids(), and the nested
-- EXISTS/IN subqueries in appointments, questions, answers and quiz RLS all key
-- on provider_id. Highest-traffic lookup in the schema.
CREATE INDEX IF NOT EXISTS idx_facilities_provider_id ON public.facilities (provider_id);

-- ── appointments ──
-- RLS "customer read/insert/update own appointments" (customer_id = auth.uid())
-- and profiles "providers read customer push token" join on a.customer_id.
CREATE INDEX IF NOT EXISTS idx_appointments_customer_id ON public.appointments (customer_id);
-- RLS "provider read/update facility appointments" (facility_id IN
-- my_provider_facility_ids()), insert_notification() join, FK.
CREATE INDEX IF NOT EXISTS idx_appointments_facility_id ON public.appointments (facility_id);

-- ── claim_requests ──
-- claim_requests_guard_insert facility check, delete_own_account cleanup, FK
-- ON DELETE CASCADE.
CREATE INDEX IF NOT EXISTS idx_claim_requests_facility_id ON public.claim_requests (facility_id);
-- RLS "providers read own claims" (requester_id = auth.uid()).
CREATE INDEX IF NOT EXISTS idx_claim_requests_requester_id ON public.claim_requests (requester_id);

-- ── facility_change_requests ──
-- RLS "providers can submit changes" EXISTS on facility_id, admin read, FK CASCADE.
CREATE INDEX IF NOT EXISTS idx_facility_change_requests_facility_id ON public.facility_change_requests (facility_id);
-- RLS "providers can read own change requests" (provider_id = auth.uid()).
CREATE INDEX IF NOT EXISTS idx_facility_change_requests_provider_id ON public.facility_change_requests (provider_id);

-- ── reviews ──
-- ReviewsScreen.js:64 and FacilityProfileScreen.js:32/33/50/51/54
-- (.eq('facility_id', …).order('created_at')), FK CASCADE. customer_id already indexed.
CREATE INDEX IF NOT EXISTS idx_reviews_facility_id ON public.reviews (facility_id);

-- ── questions / answers ──
-- RLS "read questions" EXISTS facilities on questions.facility_id; FacilityProfile
-- Q&A; FK CASCADE.
CREATE INDEX IF NOT EXISTS idx_questions_facility_id ON public.questions (facility_id);
-- RLS "read questions" (customer_id = auth.uid()) + check_question_limit() count.
CREATE INDEX IF NOT EXISTS idx_questions_customer_id ON public.questions (customer_id);
-- RLS "read answers" joins questions on answers.question_id; FK CASCADE.
CREATE INDEX IF NOT EXISTS idx_answers_question_id ON public.answers (question_id);

-- ── quiz_submissions ──
-- RLS customer_read_own / customer_timeout (customer_id = auth.uid()), FK CASCADE.
CREATE INDEX IF NOT EXISTS idx_quiz_submissions_customer_id ON public.quiz_submissions (customer_id);
-- RLS pharmacy_read_assigned / pharmacy_approve (assigned_facility_id IN facilities…).
CREATE INDEX IF NOT EXISTS idx_quiz_submissions_assigned_facility_id ON public.quiz_submissions (assigned_facility_id);

-- ── notifications ──
-- RLS "users read own notifications" (user_id = auth.uid()); App.js:558 inbox
-- load, :484/:919 mark-read by user_id; FK CASCADE.
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications (user_id);

-- ── duty_schedule ──
-- FK ON DELETE CASCADE + delete_own_account() DELETE … WHERE facility_id = ANY(…).
CREATE INDEX IF NOT EXISTS idx_duty_schedule_facility_id ON public.duty_schedule (facility_id);

-- ── home_services ──
-- RLS hs_select_public / hs_update_self (owner_id = auth.uid()), owner dashboard.
CREATE INDEX IF NOT EXISTS idx_home_services_owner_id ON public.home_services (owner_id);

-- ── events ──
-- RLS "organizer manage own events" (organizer_id = auth.uid()).
CREATE INDEX IF NOT EXISTS idx_events_organizer_id ON public.events (organizer_id);

COMMIT;

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   BEGIN;
--   DROP INDEX IF EXISTS public.idx_facilities_provider_id;
--   DROP INDEX IF EXISTS public.idx_appointments_customer_id;
--   DROP INDEX IF EXISTS public.idx_appointments_facility_id;
--   DROP INDEX IF EXISTS public.idx_claim_requests_facility_id;
--   DROP INDEX IF EXISTS public.idx_claim_requests_requester_id;
--   DROP INDEX IF EXISTS public.idx_facility_change_requests_facility_id;
--   DROP INDEX IF EXISTS public.idx_facility_change_requests_provider_id;
--   DROP INDEX IF EXISTS public.idx_reviews_facility_id;
--   DROP INDEX IF EXISTS public.idx_questions_facility_id;
--   DROP INDEX IF EXISTS public.idx_questions_customer_id;
--   DROP INDEX IF EXISTS public.idx_answers_question_id;
--   DROP INDEX IF EXISTS public.idx_quiz_submissions_customer_id;
--   DROP INDEX IF EXISTS public.idx_quiz_submissions_assigned_facility_id;
--   DROP INDEX IF EXISTS public.idx_notifications_user_id;
--   DROP INDEX IF EXISTS public.idx_duty_schedule_facility_id;
--   DROP INDEX IF EXISTS public.idx_home_services_owner_id;
--   DROP INDEX IF EXISTS public.idx_events_organizer_id;
--   COMMIT;

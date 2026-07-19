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

-- FILE 1/5 — CREATE TABLE for tables that exist LIVE but have no CREATE in
-- supabase/migrations/. Columns/types/defaults/nullability introspected from
-- information_schema; PK/FK/UNIQUE from pg_get_constraintdef (exact). CHECK
-- constraints are in FILE 2. RLS policies in FILE 5.

-- ── profiles ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid NOT NULL,
  role text NOT NULL DEFAULT 'customer'::text,
  preferred_language text NOT NULL DEFAULT 'en'::text,
  push_token text,
  full_name text,
  phone text,
  nationality text,
  avatar_url text,
  strikes smallint NOT NULL DEFAULT 0,
  blocked_until timestamptz,
  ugc_banned_until timestamptz
);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ── facilities ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.facilities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL,
  address text,
  latitude double precision,
  longitude double precision,
  opening_hours text,
  languages text[],
  is_public boolean DEFAULT false,
  verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  provider_id uuid,
  is_quiz_partner boolean DEFAULT false,
  status text NOT NULL DEFAULT 'active'::text,
  membership_tier text NOT NULL DEFAULT 'basic'::text,
  trial_ends_at timestamptz,
  phone text,
  contact_person text,
  website text,
  cover_image_url text,
  logo_url text,
  specialty text[],
  registration_number text,
  description text,
  availability jsonb,
  photos jsonb DEFAULT '[]'::jsonb
);
ALTER TABLE public.facilities ADD CONSTRAINT facilities_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES auth.users(id);
ALTER TABLE public.facilities ADD CONSTRAINT facilities_pkey PRIMARY KEY (id);
ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;

-- ── appointments ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  requested_time timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.appointments ADD CONSTRAINT appointments_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id);
ALTER TABLE public.appointments ADD CONSTRAINT appointments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES auth.users(id);
ALTER TABLE public.appointments ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- ── reviews ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  rating smallint NOT NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  hidden_at timestamptz,
  hidden_reason text
);
ALTER TABLE public.reviews ADD CONSTRAINT reviews_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);
ALTER TABLE public.reviews ADD CONSTRAINT reviews_appointment_id_key UNIQUE (appointment_id);
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- ── questions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.questions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz DEFAULT now(),
  hidden_at timestamptz,
  hidden_reason text
);
ALTER TABLE public.questions ADD CONSTRAINT questions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.questions ADD CONSTRAINT questions_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE;
ALTER TABLE public.questions ADD CONSTRAINT questions_pkey PRIMARY KEY (id);
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

-- ── answers ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.answers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz DEFAULT now(),
  hidden_at timestamptz,
  hidden_reason text
);
ALTER TABLE public.answers ADD CONSTRAINT answers_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.answers ADD CONSTRAINT answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE;
ALTER TABLE public.answers ADD CONSTRAINT answers_pkey PRIMARY KEY (id);
ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;

-- ── notifications ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- ── claim_requests ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.claim_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  facility_id uuid,
  requester_id uuid,
  requested_tier text NOT NULL DEFAULT 'basic'::text,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamptz DEFAULT now(),
  registration_number text,
  rejection_reason text
);
ALTER TABLE public.claim_requests ADD CONSTRAINT claim_requests_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE;
ALTER TABLE public.claim_requests ADD CONSTRAINT claim_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.claim_requests ADD CONSTRAINT claim_requests_pkey PRIMARY KEY (id);
ALTER TABLE public.claim_requests ENABLE ROW LEVEL SECURITY;

-- ── facility_change_requests ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.facility_change_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  proposed_changes jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamptz NOT NULL DEFAULT now(),
  rejection_reason text
);
ALTER TABLE public.facility_change_requests ADD CONSTRAINT facility_change_requests_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE;
ALTER TABLE public.facility_change_requests ADD CONSTRAINT facility_change_requests_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.facility_change_requests ADD CONSTRAINT facility_change_requests_pkey PRIMARY KEY (id);
ALTER TABLE public.facility_change_requests ENABLE ROW LEVEL SECURITY;

-- ── duty_list ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.duty_list (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  duty_date date NOT NULL,
  open_from text NOT NULL DEFAULT '08:00'::text,
  open_until text NOT NULL DEFAULT '00:00'::text,
  name text NOT NULL,
  address text,
  phone text,
  region text
);
ALTER TABLE public.duty_list ADD CONSTRAINT duty_list_pkey PRIMARY KEY (id);
ALTER TABLE public.duty_list ENABLE ROW LEVEL SECURITY;

-- ── duty_schedule ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.duty_schedule (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL,
  date date NOT NULL
);
ALTER TABLE public.duty_schedule ADD CONSTRAINT duty_schedule_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE;
ALTER TABLE public.duty_schedule ADD CONSTRAINT duty_schedule_pkey PRIMARY KEY (id);
ALTER TABLE public.duty_schedule ENABLE ROW LEVEL SECURITY;

-- ── pharmacist_scores ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pharmacist_scores (
  facility_id uuid NOT NULL,
  total_points integer DEFAULT 0,
  total_reviews integer DEFAULT 0,
  avg_response_mins double precision DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.pharmacist_scores ADD CONSTRAINT pharmacist_scores_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE;
ALTER TABLE public.pharmacist_scores ADD CONSTRAINT pharmacist_scores_pkey PRIMARY KEY (facility_id);
ALTER TABLE public.pharmacist_scores ENABLE ROW LEVEL SECURITY;

-- ── quiz_submissions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quiz_submissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  answers jsonb NOT NULL,
  generated_result jsonb NOT NULL,
  final_result jsonb,
  assigned_facility_id uuid,
  status text NOT NULL DEFAULT 'pending'::text,
  timeout_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  reviewed_at timestamptz
);
ALTER TABLE public.quiz_submissions ADD CONSTRAINT quiz_submissions_assigned_facility_id_fkey FOREIGN KEY (assigned_facility_id) REFERENCES facilities(id);
ALTER TABLE public.quiz_submissions ADD CONSTRAINT quiz_submissions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.quiz_submissions ADD CONSTRAINT quiz_submissions_pkey PRIMARY KEY (id);
ALTER TABLE public.quiz_submissions ENABLE ROW LEVEL SECURITY;

-- ─── Garages Slice 2a — service-per-booking ──────────────────────────────────
-- Adds appointments.service_type so a garage booking can record WHICH service
-- the customer requested (a key from that garage's facilities.service_types[]).
--
-- ADDITIVE + nullable. Grooming/health bookings never set it → stay NULL → their
-- screens ignore it. No RLS change: the owner appointment/profile policies added
-- for grooming (20260726) key on my_provider_facility_ids() and already cover
-- garage owners. No cron/processor here (that's Slice 2b).
--
-- SQL editor runs as current_user='authenticated'; SET ROLE postgres switches to
-- the table owner (session_user is postgres, so it's permitted). Idempotent.

SET ROLE postgres;

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS service_type text;

COMMENT ON COLUMN public.appointments.service_type IS
  'Garage bookings only: the requested service key (matches facilities.service_types). NULL for grooming/health.';

RESET ROLE;

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   SET ROLE postgres;
--   ALTER TABLE public.appointments DROP COLUMN IF EXISTS service_type;
--   RESET ROLE;

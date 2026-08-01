-- ─── Garages 2a amendment — richer booking details (JSONB) ────────────────────
-- Replaces appointments.service_type (single text, added by 20260801) with a
-- nullable JSONB holding the full garage booking context. service_type was only
-- ever set by unmerged branch code — no live data depends on it — so dropping is
-- safe. Additive for grooming/health: they never set garage_booking_details.
-- SQL editor runs as current_user='authenticated'; SET ROLE postgres switches to
-- the table owner. Idempotent. (Apply anytime — independent of the other two.)

SET ROLE postgres;

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS garage_booking_details jsonb;

COMMENT ON COLUMN public.appointments.garage_booking_details IS
  'Garage bookings only: { services:[], car:{make,model,year,plate}, phone, notes }. NULL for grooming/health.';

ALTER TABLE public.appointments DROP COLUMN IF EXISTS service_type;

RESET ROLE;

-- Rollback:
--   SET ROLE postgres;
--   ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS service_type text;
--   ALTER TABLE public.appointments DROP COLUMN IF EXISTS garage_booking_details;
--   RESET ROLE;

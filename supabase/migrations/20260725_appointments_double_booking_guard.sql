-- Double-booking guard for appointments.
--
-- Prevents two ACTIVE bookings (pending or confirmed) for the same facility at
-- the same exact requested_time. Until now this was enforced ONLY client-side
-- (BookingScreen greys out taken chips), so two racing inserts both succeeded
-- and the same slot could be booked twice.
--
-- PARTIAL predicate is deliberate: only 'pending' / 'confirmed' occupy a slot.
-- Once a booking is 'cancelled' / 'completed' / 'no_show' it leaves the index,
-- so that slot becomes bookable again — exactly the real lifecycle.
--
-- requested_time is timestamptz (absolute instant), so equality is timezone-safe.
-- Slot-path bookings normalize seconds to :00, so equality matches cleanly. The
-- free-time picker path (facilities without an availability schedule) may carry
-- nonzero seconds, so this guard is airtight for slot bookings and best-effort
-- for free-time requests — acceptable for now.
--
-- Idempotent: drop-then-create. Small table → a plain (non-CONCURRENT) build in a
-- transaction takes only a brief write lock (milliseconds).
--
-- PRECONDITION: run the duplicate-collision check BEFORE applying. If any active
-- (facility_id, requested_time) pair already has >1 pending/confirmed row, the
-- CREATE UNIQUE INDEX will FAIL until those collisions are resolved:
--
--   SELECT facility_id, requested_time, count(*) AS collisions,
--          array_agg(id) AS appointment_ids
--   FROM appointments
--   WHERE status IN ('pending','confirmed')
--   GROUP BY facility_id, requested_time
--   HAVING count(*) > 1;

BEGIN;

DROP INDEX IF EXISTS public.appointments_active_slot_unique;

CREATE UNIQUE INDEX appointments_active_slot_unique
  ON public.appointments (facility_id, requested_time)
  WHERE status IN ('pending', 'confirmed');

COMMIT;

-- Rollback:
--   DROP INDEX IF EXISTS public.appointments_active_slot_unique;

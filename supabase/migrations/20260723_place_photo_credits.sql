-- ─── Photo attribution for landmarks & beaches ─────────────────────────────
--
-- Most curated photos come from Wikimedia Commons under CC BY-SA, which legally
-- requires visible attribution. photo_credits[i] attributes photo_urls[i]; the
-- consumer app renders the credit for the currently visible gallery photo.
--
-- Mirrors photo_urls (text[]). ADD COLUMN with a non-volatile default is
-- metadata-only in PG11+ — no table rewrite, no meaningful lock. Existing rows
-- take '{}', so no live listing changes behaviour.
--
-- NO RLS / GUARD CHANGE NEEDED. beaches & landmarks have no column-level guard
-- triggers; row-level RLS already lets the owner (submitted_by = auth.uid()) set
-- any column on their own row and admins edit anything. photo_credits inherits
-- the exact same rules as photo_urls automatically.
--
-- APPLY THIS IN SUPABASE BEFORE publishing the OTA that reads photo_credits.

BEGIN;

ALTER TABLE public.landmarks
  ADD COLUMN IF NOT EXISTS photo_credits text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.beaches
  ADD COLUMN IF NOT EXISTS photo_credits text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.landmarks.photo_credits IS
  'photo_credits[i] attributes photo_urls[i], e.g. "Photo: Ad Meskens / CC BY-SA 3.0". Empty array = no attribution required.';
COMMENT ON COLUMN public.beaches.photo_credits IS
  'photo_credits[i] attributes photo_urls[i], e.g. "Photo: Ad Meskens / CC BY-SA 3.0". Empty array = no attribution required.';

COMMIT;

-- ─── Rollback ────────────────────────────────────────────────────────────────
--   BEGIN;
--   ALTER TABLE public.landmarks DROP COLUMN IF EXISTS photo_credits;
--   ALTER TABLE public.beaches   DROP COLUMN IF EXISTS photo_credits;
--   COMMIT;

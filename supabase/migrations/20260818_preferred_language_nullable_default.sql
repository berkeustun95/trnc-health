-- ─── L1 — profiles.preferred_language: make "unset" representable as NULL ──────
--
-- DEFECT (live since launch, app-wide): the column's DB default was the CODE 'en',
-- which is TRUTHY, so `const lang = profile?.preferred_language || pendingLang`
-- (App.js:826) let 'en' WIN over the device's onboarding choice. Onboarding writes
-- only AsyncStorage/pendingLang — no session exists at that point (App.js:847-848) —
-- so the server column never received it. Every one of ~20 readers keys
-- t()/DUTY_TITLES by FULL NAME with an `|| 'English'` fallback, so a stored 'en'
-- silently renders English everywhere: in-app AND in cross-user notifications and
-- the duty-push edge function. Census 2026-08-09: 60 'en' / 5 'Turkish' / 4 'English'
-- of 69 rows → 87% of users masked into English regardless of their pick.
--
-- FIX (root cause; takes effect on the ALREADY-SHIPPED bundle, no OTA needed): make
-- the default NULL (= unset). With a NULL column, `NULL || pendingLang` resolves to
-- the device's real choice, so the masking disappears the moment this runs. Guests
-- (anonymous sessions have a real profiles row they can READ but not WRITE —
-- selectLang returns early App.js:378, no_anon_update_profiles blocks) are fixed too,
-- because their in-app resolution stops being masked. Genuine choices ('English',
-- 'Turkish' — full names written by selectLang/ProfileScreen) are LEFT UNTOUCHED.
--
-- Why NULL and not 'English': a full-name default is a valid name that would AGAIN
-- win over pendingLang, re-creating the bug for every NEW user. NULL is the only
-- default that stays distinguishable from a real choice.
--
-- Why the backfill is safe: a genuine English choice is stored as 'English'; the
-- code 'en' only ever came from the old default = "never chose". So
-- `WHERE preferred_language = 'en'` touches ONLY defaulted rows, never a real English
-- chooser. Census confirmed there are no other code-form values to remap.
--
-- Idempotent: DROP NOT NULL / DROP DEFAULT are no-ops if already applied, and the
-- backfill matches 0 rows on a second run. Apply in the SQL editor, Role = postgres.
-- Registered in verify_schema.sql (H-token 0818_preferred_language_nullable).

BEGIN;

-- 1. "unset" must be representable — drop the NOT NULL constraint.
ALTER TABLE public.profiles ALTER COLUMN preferred_language DROP NOT NULL;

-- 2. New rows default to NULL (unset), not the code 'en'. DROP DEFAULT is equivalent
--    to SET DEFAULT NULL for a nullable column, but leaves a clean "no default" that
--    the verify token asserts as column_default IS NULL.
ALTER TABLE public.profiles ALTER COLUMN preferred_language DROP DEFAULT;

-- 3. Backfill: the old code default 'en' = "never chose" → NULL. 'English' and
--    'Turkish' (genuine full-name choices) are left untouched. (Census: 60 rows.)
UPDATE public.profiles SET preferred_language = NULL WHERE preferred_language = 'en';

COMMIT;

-- Column shape metadata changed (nullability + default), so refresh PostgREST's
-- cached schema; without it the REST layer can keep reporting the column as NOT NULL.
NOTIFY pgrst, 'reload schema';

-- ── Verification (run after applying, Role = postgres) ───────────────────────
--   -- (a) schema state — expect  is_nullable = YES,  column_default = NULL:
--   SELECT is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='profiles'
--      AND column_name='preferred_language';
--
--   -- (b) re-run the census — expect NULL = 60, Turkish = 5, English = 4:
--   SELECT preferred_language, count(*) AS n
--     FROM profiles
--    GROUP BY preferred_language
--    ORDER BY n DESC NULLS FIRST;
--
-- ── Rollback (re-introduces the masking bug — only if reverting the whole slice) ─
--   BEGIN;
--   UPDATE public.profiles SET preferred_language = 'en' WHERE preferred_language IS NULL;
--   ALTER TABLE public.profiles ALTER COLUMN preferred_language SET DEFAULT 'en';
--   ALTER TABLE public.profiles ALTER COLUMN preferred_language SET NOT NULL;
--   COMMIT;
--   NOTIFY pgrst, 'reload schema';

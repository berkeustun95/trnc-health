-- ═══ profiles — drop the SECOND full-row over-share policy ══════════════════
--
-- `owner read booking customer profile` (20260726, grooming Slice 3) grants any user who
-- owns a facilities row a SELECT over the COMPLETE profile row — full_name, phone,
-- nationality, avatar_url, push_token, strikes, blocked_until, ugc_banned_until — of every
-- user who has ever booked an appointment at a facility they own.
--
-- Confirmed LIVE by pg_policies on 2026-08-27: SELECT, roles {public}. Observed, not inferred.
-- APPLIED AND VERIFIED 2026-08-27: the policy is gone from pg_policies and exactly three
-- SELECT policies remain on profiles (owner read, admin read all, admin read profiles).
--
-- ─── THIS IS THE TWIN OF A POLICY ALREADY DROPPED ───────────────────────────
--
-- 20260821 dropped `providers read customer push token` for exactly this reason.
-- 20260819's header stated the problem and it applies here VERBATIM:
--
--   "the RLS policy on profiles is row-level, so despite its name it exposes a customer's
--    ENTIRE profile row to any provider they've booked with — including phone, nationality,
--    strikes, blocked_until, ugc_banned_until — none of which any provider screen reads.
--    Postgres RLS can't limit columns, and column GRANTs can't either."
--
-- The two policies share their EXISTS predicate. The difference is that the dropped one was
-- prefixed with `get_my_role() = 'provider'`; this one is NOT, so it binds to facility
-- OWNERSHIP alone, irrespective of role. It is the wider of the two, and it outlived it.
--
-- ─── WHY 20260821 MISSED IT — the reason the CLAUDE.md rule was added ───────
--
-- 20260821's own verification comment reads:
--   "expect NO 'providers read customer push token'. Remaining SELECT policies:
--    owner read, admin read all, admin read profiles. (QUERY 3's profiles policy
--    count drops by 1.)"
--
-- There were FOUR. That list was already wrong the day it was written — it was authored
-- from the policies the migration's author had in mind, not from a query against the DB.
-- A verification block that hardcodes an expected set it did not derive cannot fail
-- correctly: it passes whenever the thing it names is absent, and stays silent about
-- everything it forgot to name. See CLAUDE.md, "A verification block must DERIVE what it
-- asserts".
--
-- ─── NOTHING READS IT — verified across client AND server, not just client ──
--
-- The earlier pass checked client code only. Re-checked 2026-08-27 across every surface
-- that can be subject to RLS:
--
--   * CLIENT (42 direct `from('profiles')` hits in screens/ components/ utils/ lib/ App.js):
--     every one is a self-read (eq('id', session.user.id)), an admin read (AdminScreen), or
--     an admin push-token lookup. Exactly three screens read a customer profile at all —
--     ProviderScreen, GroomingBookingsScreen, GarageBookingsScreen — and all three go
--     through get_customer_contacts. (HomeServiceDashboardScreen was opened and reads no
--     customer profile on any path: that module has no booking flow.)
--     Checked by COLUMN, not by name: a `full_name` grep alone would miss a direct read of
--     phone or push_token, which is precisely what this policy exposes.
--   * SECURITY DEFINER functions — bypass RLS by definition; a policy cannot be load-bearing
--     for them. (get_customer_contacts, insert_notification, record_no_show, the *_guard_*
--     triggers, get_my_role, is_admin, is_customer_blocked, delete_own_account, the cron
--     processors.)
--   * SECURITY INVOKER functions — these DO respect caller RLS, so each was read:
--     ev_guard_write, hs_guard_insert, hs_guard_owner_update, tp_guard_write,
--     facilities_guard_update. Every profiles reference in them is
--     `WHERE id = auth.uid() AND role = 'admin'` — a SELF-read, served by `owner read`.
--     None reads another user's row.
--   * VIEWS — the repo defines exactly one, contact_events_monthly (20260910). It selects
--     from contact_events only and never references profiles.
--   * EDGE FUNCTIONS — send-duty-notification and sync-novest both construct their client
--     with SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS entirely.
--
-- So the policy grants nothing any code path uses. It is pure attack surface, and dropping
-- it changes no behaviour.
--
-- ⚠ WHAT THIS DOES NOT FIX. Dropping this does NOT restore provider notifications. The
-- customer→provider read in utils/notify.js:12 was never permitted by this policy either
-- (it needs the TARGET to be the caller's booking customer; there the target is the
-- provider). That is a separate, older defect — see 2026-08-27_notify-provider-audit.md.
-- Do not expect this migration to change it, and do not "fix" that by widening RLS.
--
-- Apply by hand: SQL editor, Role = postgres. Then `node scripts/migration-ledger.mjs
-- --stamp`, re-run supabase/migration_ledger_check.sql, and run supabase/verify_schema.sql
-- (section H token added below).

SET ROLE postgres;
BEGIN;

DROP POLICY IF EXISTS "owner read booking customer profile" ON public.profiles;

-- ─── ledger:stamp:begin ──────────────────────────────────────────────
-- Machine-generated by scripts/migration-ledger.mjs --stamp. Do not hand-edit.
-- The checksum is of THIS FILE WITH THIS BLOCK STRIPPED, which is what lets the file
-- carry its own stamp. Everything between the markers is excluded from the checksum
-- but still runs — so it may contain NOTHING but this INSERT. See the note in the
-- generator: anything else here would execute on paste while leaving no trace in the
-- hash, and the ledger would be attesting a file it never actually verified.
--
-- This is also the LAST statement inside BEGIN/COMMIT: if a paste is truncated before
-- it, COMMIT is never reached and nothing applies.
INSERT INTO public.schema_migrations_applied (filename, checksum)
VALUES ('20260922_drop_grooming_profile_overshare.sql', 'fd915cbc37b20175cba597f0d95368d4d1e40abd07382604d343975757990ea8')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;
RESET ROLE;

-- No ADD COLUMN, so no PostgREST schema-cache reload is required: the cache holds
-- table/column shape, and a policy is neither.

-- ─── Verification (Role = postgres) ─────────────────────────────────────────
--   -- 1. DERIVED, not hardcoded. Print the actual remaining SELECT policy set and read it.
--   --    Do not compare against a list written from memory — that is the failure this
--   --    migration exists to correct.
--   SELECT policyname, cmd, roles, qual
--     FROM pg_policies
--    WHERE schemaname='public' AND tablename='profiles' AND cmd='SELECT'
--    ORDER BY policyname;
--   -- expect exactly 3 rows: admin read all, admin read profiles, owner read.
--   -- If ANY fourth row appears, stop and read its qual before assuming it is benign —
--   -- that is exactly how this one survived.
--
--   -- 2. the count, derived:
--   SELECT count(*) AS select_policies_on_profiles
--     FROM pg_policies
--    WHERE schemaname='public' AND tablename='profiles' AND cmd='SELECT';
--   -- expect 3
--
--   -- 3. WATCH IT REFUSE. A guard nobody has seen reject something is a decoration.
--   --    Run as a NON-ADMIN provider who owns a facility with at least one appointment.
--   --    Before this migration it returns the customer's full row; after, zero rows.
--   --    (As postgres, RLS is bypassed and this proves nothing.)
--   SELECT id, full_name, phone, nationality, push_token, strikes
--     FROM public.profiles
--    WHERE id = '<a customer uuid who has an appointment at your facility>';
--   -- expect 0 rows AFTER this migration
--
--   -- 4. the sanctioned path still works for that same provider (this is the point —
--   --    the capability is preserved, only the column over-share is removed):
--   SELECT * FROM public.get_customer_contacts(ARRAY['<same customer uuid>']::uuid[]);
--   -- expect 1 row: id, full_name, push_token, preferred_language — and nothing else.

-- ─── Rollback (RE-OPENS the full-row over-share — only if reverting) ────────
--   BEGIN;
--   CREATE POLICY "owner read booking customer profile" ON public.profiles
--     FOR SELECT TO public
--     USING (EXISTS (
--       SELECT 1 FROM appointments a JOIN facilities f ON a.facility_id = f.id
--       WHERE a.customer_id = profiles.id AND f.provider_id = auth.uid()
--     ));
--   COMMIT;
--   DELETE FROM public.schema_migrations_applied
--    WHERE filename = '20260922_drop_grooming_profile_overshare.sql';

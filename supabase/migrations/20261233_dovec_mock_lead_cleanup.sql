-- ═══════════════════════════════════════════════════════════════════════════
-- 20261233 — Döveç: remove admin mock/test enquiries, and put the admin account on English for one recording
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Data only. No table, column, policy, grant, trigger or function is created or changed. Berke's go: "delete every
-- mock/test row in dovec_leads through the approved route, so lead counts start clean ... The reference number can
-- carry on from where it is." and "switch my admin account's saved language to English ... then switch it back to
-- Turkish. You have my go for that one write and its revert." The revert is 20261234, a SEPARATE file applied in a
-- LATER supabase-migrate run, after the phone recording. Never dispatch the two together.
--
-- WHY NO IDS OR NUMBERS: supabase-migrate prints this file to a PUBLIC Actions log. Rows are chosen by predicate
-- (status / is_test / role) and every message is fixed text; nothing here names a user, an id, an email or a count.
--
-- ─── PART 1: dovec_leads ───────────────────────────────────────────────────
-- What goes: every row with status 'mock' (the dovec-lead function settles an enquiry as 'mock' when the live send is
-- switched off: no attempt, no HTTP status, no sent_at) and the one is_test row (external_id TEST-1, written only by
-- the service-only test send, user_id always NULL) ONLY when it settled as 'mock' (never sent). A pending, retry, sent,
-- rejected or failed TEST-1 aborts the file: 'pending' with attempts = 0 can be an in-flight or crashed send (deliver()
-- writes attempts / sent_at only after the POST returns), so it is no proof that Döveç never got it.
--
-- The precondition aborts the whole file unless EVERY row in the table passes all three clauses below. It is stricter
-- than "delete mock and test": a real, sent, retrying, rejected, failed or other-user enquiry means STOP and ask
-- Berke; nothing is deleted.
--   1. No send evidence: sent_at IS NULL AND attempts = 0 AND last_http_status IS NULL AND next_attempt_at IS NULL.
--   2. It settled as a mock: status = 'mock', test row or not.
--   3. Its owner is proven an admin: (is_test AND user_id IS NULL) -- the test row has no owner by design -- OR user_id
--      belongs to a profile whose role is 'admin'. A non-test row with user_id NULL (a deleted user whose row was
--      wiped by the AFTER DELETE trigger) is NOT proven admin, so it aborts.
-- Nothing else in the table can exist at apply time without stopping the file. Zero rows is a valid clean state.
--
-- FOREIGN KEYS: none references dovec_leads (grep of supabase/ for "REFERENCES ... dovec_leads": no match;
-- dovec_leads itself has only an outgoing FK, to dovec_projects), so the DELETE cannot cascade or be blocked.
-- The migration runs as postgres (table owner), which bypasses RLS and needs no service_role DELETE grant; none is added.
--
-- The reference-number sequence dovec_lead_external_seq is NOT touched: the next enquiry carries on from where it is.
-- Removing the TEST-1 row also frees the "one is_test row ever" partial unique index (dovec_leads_one_test_idx). That is
-- fine because the precondition proves it was never sent; the agreed test enquiry can still be sent once later.
--
-- ─── PART 2: the admin account's saved language ────────────────────────────
-- Exactly one profile has role = 'admin' (asserted); it must be 'Turkish' now (asserted); it becomes 'English' (a full
-- English name, never an ISO code). The BEFORE UPDATE triggers on profiles (check_profile_name_content latest body 20261016,
-- guard_profile_ban, guard_checkin_notice_columns, guard_marketplace_notice_columns, profiles_age_confirmed_stamp) neither
-- raise nor rewrite anything on a preferred_language-only change run as postgres with no auth.uid() (read in the repo
-- files; the one unguarded raise is UNDERAGE on a stored under-13 date of birth, which an admin does not have; if it
-- did, the file would roll back whole).
--
-- WHO CAN READ / WRITE WHAT: unchanged. dovec_leads keeps RLS on with zero policies and no privilege for any app role;
-- this file only deletes rows as the owner. No policy or grant is added, changed or removed.
--
-- Re-runnable: after it applies, a second run is refused by the ledger, and by the language assertion if forced.
-- Not reversible for the deleted rows (they were mock/test by proof); the language is reverted by 20261234.

SET ROLE postgres;

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Writers block until COMMIT (reads still work), so no send can land between the check and the DELETE; lock_timeout bounds the wait.
LOCK TABLE public.dovec_leads IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  v_rows int;
BEGIN
  IF to_regclass('public.dovec_leads') IS NULL THEN
    RAISE EXCEPTION '20261229 is not applied: apply it before this file';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.dovec_leads l
     WHERE NOT (
           (l.sent_at IS NULL AND l.attempts = 0 AND l.last_http_status IS NULL AND l.next_attempt_at IS NULL)
       AND l.status = 'mock'
       AND ((l.is_test AND l.user_id IS NULL)
            OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = l.user_id AND p.role = 'admin'))
     )
  ) THEN
    RAISE EXCEPTION 'dovec_leads holds a row that is not an unsent admin mock/test row: stop and ask Berke';
  END IF;

  DELETE FROM public.dovec_leads WHERE status = 'mock' OR is_test;

  IF EXISTS (SELECT 1 FROM public.dovec_leads WHERE status = 'mock' OR is_test) THEN
    RAISE EXCEPTION 'a mock or test enquiry is still in dovec_leads after the delete';
  END IF;

  IF (SELECT count(*) FROM public.profiles WHERE role = 'admin') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'there is not exactly one admin profile: stop and ask Berke';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin' AND preferred_language IS NOT DISTINCT FROM 'Turkish') THEN
    RAISE EXCEPTION 'the admin saved language is not Turkish: stop and ask Berke';
  END IF;

  UPDATE public.profiles SET preferred_language = 'English' WHERE role = 'admin';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'the admin language update did not touch exactly one profile';
  END IF;
END $$;

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
VALUES ('20261233_dovec_mock_lead_cleanup.sql', '23e7f920d4239e12e25f0d2191b082e7ce4b529f6d2bf0375b0b1130e9ed5e2c')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

RESET ROLE;

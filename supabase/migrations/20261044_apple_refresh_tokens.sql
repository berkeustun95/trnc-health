-- ═══════════════════════════════════════════════════════════════════════════
-- 20261044 — apple_refresh_tokens: what lets ADA revoke Sign in with Apple
-- ═══════════════════════════════════════════════════════════════════════════
--
-- App Store 5.1.1(v): an app offering Sign in with Apple must revoke the user's Apple
-- tokens when the account is deleted. Revoking needs a token, and Apple hands out a
-- refresh token only in exchange for the one-time authorization code from sign-in (valid
-- five minutes). So the Edge Function `apple-token` exchanges that code right after sign-in
-- and keeps the refresh token HERE, and revokes it before any in-app deletion.
-- Decision (approach B) and its alternatives: vault 2026-09-21_social-auth.md, slice 5.
--
-- ─── WHO CAN READ OR WRITE THIS TABLE: NOBODY BUT THE EDGE FUNCTION ─────────
--
-- RLS is ON with ZERO policies, and every privilege is revoked from anon AND authenticated.
-- So no app user — signed in, guest or signed out — can select, insert, update or delete a
-- single row, not even their own. Only service_role (the Edge Function, which bypasses RLS)
-- touches it. A token is useless on its own: Apple accepts it only with a client secret
-- signed by our Sign in with Apple private key, which lives in the function's secrets and
-- nowhere in the database.
--
-- ─── ON DELETE CASCADE, AND WHAT THAT COSTS ─────────────────────────────────
--
-- Deleting the auth user deletes the row, so delete_own_account needs no change and can
-- never be blocked by this table (this app's account deletion has broken on foreign keys
-- three times). The price: deleting a user from the DASHBOARD, or by any path outside the
-- app, destroys the token BEFORE anything revoked it, permanently. Hence the CLAUDE.md
-- rule — revoke first with scripts/revoke-apple-token.mjs, then delete.
--
-- Apply: SQL Editor, Role = postgres, paste the whole file. Idempotent; re-runnable.
-- New table ⇒ ends with NOTIFY pgrst: the Edge Function reaches this table through
-- PostgREST as service_role, and a stale schema cache would report it missing.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.apple_refresh_tokens (
  user_id       uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  refresh_token text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.apple_refresh_tokens IS
  'Sign in with Apple refresh tokens, kept only to revoke them on account deletion. '
  'service_role only: RLS on, zero policies, no anon/authenticated privileges. '
  'ON DELETE CASCADE — revoke BEFORE deleting a user outside the app (CLAUDE.md).';

ALTER TABLE public.apple_refresh_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.apple_refresh_tokens FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.apple_refresh_tokens TO service_role;

-- ─── Assertions. Every one DERIVES what it checks and prints what it read. ──
-- The table is looked up with to_regclass, never a bare name: if the CREATE above did not
-- land in this session (the SQL editor has lost objects created earlier in a script twice),
-- this says so in words instead of dying on 42P01.
DO $$
DECLARE
  v_rel      regclass := to_regclass('public.apple_refresh_tokens');
  v_n        int;
  v_names    text;
  v_role     text;
  v_priv     text;
BEGIN
  IF v_rel IS NULL THEN
    RAISE EXCEPTION 'apple_refresh_tokens is not visible to this DO block — the CREATE did not land in this session. Nothing was committed; re-run the file as one paste.';
  END IF;

  -- RLS on.
  IF (SELECT relrowsecurity FROM pg_class WHERE oid = v_rel) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'apple_refresh_tokens: RLS is not enabled';
  END IF;

  -- The FULL policy set on the table, counted and named: it must be ZERO. RLS is
  -- permissive-OR, so any one policy — whoever wrote it — would open rows to a client.
  SELECT count(*), coalesce(string_agg(policyname, ', '), '(none)') INTO v_n, v_names
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'apple_refresh_tokens';
  IF v_n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'apple_refresh_tokens must have ZERO policies; found %: %', v_n, v_names;
  END IF;

  -- No privilege for either client role — has_table_privilege resolves INHERITED grants,
  -- which a grantee-filtered look at information_schema would miss.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege(v_role, v_rel, v_priv) THEN
        RAISE EXCEPTION 'apple_refresh_tokens: % still holds %', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  -- …and the legitimate path still works. Without this, a table nobody at all can touch
  -- would pass every check above — including the Edge Function that has to write it.
  FOREACH v_priv IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
    IF NOT has_table_privilege('service_role', v_rel, v_priv) THEN
      RAISE EXCEPTION 'apple_refresh_tokens: service_role is missing % — the Edge Function could not use it', v_priv;
    END IF;
  END LOOP;

  -- Account deletion takes the row with it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = v_rel AND contype = 'f'
                    AND confrelid = 'auth.users'::regclass AND confdeltype = 'c') THEN
    RAISE EXCEPTION 'apple_refresh_tokens: no ON DELETE CASCADE foreign key to auth.users';
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
VALUES ('20261044_apple_refresh_tokens.sql', '18c0d5fdfa5bbf1880b786debdb82576269485b1c50a1a3df3530521fe81bdf0')
ON CONFLICT (filename) DO UPDATE
  SET checksum = excluded.checksum, applied_at = now(), applied_by = current_user;
-- ─── ledger:stamp:end ────────────────────────────────────────────────
COMMIT;

NOTIFY pgrst, 'reload schema';

-- ─── Verification after applying (read-only, run alone) ─────────────────────
--   SELECT c.relrowsecurity AS rls_on,
--          (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='apple_refresh_tokens') AS policies,
--          has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_can_select,
--          has_table_privilege('service_role',  c.oid, 'INSERT') AS service_role_can_insert
--     FROM pg_class c WHERE c.oid = to_regclass('public.apple_refresh_tokens');
--   -- expect: true | 0 | false | true

-- ─── Rollback (only if slice 5 is abandoned; revoke every stored token FIRST) ─
--   DROP TABLE IF EXISTS public.apple_refresh_tokens;
